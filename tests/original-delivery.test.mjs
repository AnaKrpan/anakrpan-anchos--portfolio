import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createPortfolio} from '../netlify/edge-functions/lib/server.js';
import initialDocument from '../netlify/edge-functions/lib/initial-document.js';
import {createOriginalStorage,originalStorageConfig,ORIGINAL_PART_SIZE} from '../netlify/edge-functions/lib/original-storage.js';
import {migrateOriginal} from '../netlify/edge-functions/lib/migrate-originals.js';
import SparkMD5 from '../netlify/edge-functions/lib/vendor/spark-md5.js';

class Store {
  values=new Map(); counter=0; deletes=0;
  async getWithMetadata(key,{type='json'}={}) { const e=this.values.get(key); return e ? {etag:e.etag,data:type==='arrayBuffer'?e.data.slice().buffer:structuredClone(e.data)}:null; }
  async get(key,options) {return (await this.getWithMetadata(key,options))?.data ?? null;}
  async setJSON(key,data,options={}) {const old=this.values.get(key);if(options.onlyIfNew && old || options.onlyIfMatch && options.onlyIfMatch!==old?.etag)return {modified:false};const etag=String(++this.counter);this.values.set(key,{data:structuredClone(data),etag});return {modified:true,etag};}
  async set(key,data) {this.values.set(key,{data:new Uint8Array(data),etag:String(++this.counter)});return {modified:true};}
  async delete() {this.deletes++;throw new Error('Original must never be deleted');}
}
function storageFixture() {
  const uploads=new Map(),objects=new Map();
  return {uploads,objects,
    async start(key,type){uploads.set(key,{type,parts:new Map()});return 'upload';},
    async list(key){return [...uploads.get(key).parts.values()].map(p=>({...p,bytes:undefined})).sort((a,b)=>a.partNumber-b.partNumber);},
    async head(key){const o=objects.get(key);return o?{size:o.bytes.length,type:o.type}:null;},
    async partURL(key,id,part,checksum){return {url:'https://'+'a'.repeat(32)+'.r2.cloudflarestorage.com/test/'+key+'?part='+part,headers:{'content-md5':checksum}};},
    async complete(key,id,parts){const u=uploads.get(key);objects.set(key,{type:u.type,bytes:new Uint8Array(Buffer.concat(parts.map(p=>Buffer.from(u.parts.get(p.partNumber).bytes))))});},
    async read(key){return new Response(objects.get(key).bytes);},
    async signedURL(key,method){return 'https://'+'a'.repeat(32)+'.r2.cloudflarestorage.com/test/'+key+'?method='+method;},
    async put(url,options){const target=new URL(url),key=target.pathname.slice('/test/'.length),part=Number(target.searchParams.get('part'));const bytes=new Uint8Array(await new Response(options.body).arrayBuffer());const checksum=createHash('md5').update(bytes).digest('base64');assert.equal(checksum,options.headers['content-md5']);const receipt={partNumber:part,size:bytes.length,checksum,etag:'"'+'a'.repeat(32)+'"',bytes};uploads.get(key).parts.set(part,receipt);return new Response(null,{headers:{etag:receipt.etag}});}
  };
}
async function seed(store,bytes) {
  const id=crypto.randomUUID(),file=id+'.mp4',partSize=512*1024;
  const manifest={id,file,type:'video/mp4',size:bytes.length,partSize};
  await store.setJSON('media/'+file,manifest);
  for(let start=0,part=1;start<bytes.length;start+=partSize,part++)await store.set('parts/'+id+'/'+part,bytes.slice(start,start+partSize));
  const document=structuredClone(initialDocument);document.videos[0]={...document.videos[0],src:'/media/'+file,present:true};
  const state={published:{document,revision:17},draft:{document:structuredClone(document),revision:29}};state.draft.document.texts[0]='Private unsaved-to-public text';
  await store.setJSON('state',state);
  return {file,manifest,state};
}

test('migration verifies every original byte, preserves public/private documents and all old source parts',async()=>{
  const store=new Store(), originals=storageFixture();
  const bytes=Uint8Array.from({length:ORIGINAL_PART_SIZE+137},(_,i)=>i%251),before=await seed(store,bytes);
  const fetchBefore=globalThis.fetch;globalThis.fetch=originals.put.bind(originals);
  try {
    const result=await migrateOriginal({store,originals,file:before.file});assert.equal(result.verified,true);
    assert.equal(result.sha256,createHash('sha256').update(bytes).digest('hex'));
    assert.deepEqual(await store.get('state'),before.state);
    const migrated=await store.get('media/'+before.file);assert.deepEqual(migrated.legacy,before.manifest);assert.equal(migrated.backend,'r2');
    assert.deepEqual(originals.objects.get(migrated.objectKey).bytes,bytes);
    assert.equal(store.deletes,0);assert(store.values.has('parts/'+before.manifest.id+'/1'));
    assert([...store.values.keys()].some(k=>k.startsWith('original-manifest-history/')));
    const app=createPortfolio({store,originals,password:'test-password-long-enough',initialDocument,log:()=>{}});
    const response=await app.fetch(new Request('https://site.test/media/'+before.file,{headers:{range:'bytes=10-20'}}));assert.equal(response.status,307);assert.match(response.headers.get('location'),/r2\.cloudflarestorage\.com/);
    assert.equal((await app.fetch(new Request('https://site.test/api/draft'))).status,401);
    // Rollback remains possible by disabling external delivery; original Range bytes remain available.
    const fallback=createPortfolio({store,password:'test-password-long-enough',initialDocument,log:()=>{}});
    const ranged=await fallback.fetch(new Request('https://site.test/media/'+before.file,{headers:{range:'bytes=10-20'}}));assert.equal(ranged.status,206);assert.deepEqual(new Uint8Array(await ranged.arrayBuffer()),bytes.slice(10,21));
  } finally {globalThis.fetch=fetchBefore;}
});

test('failed full-file integrity verification cannot replace the original manifest or delete any content',async()=>{
  const store=new Store(),originals=storageFixture(),before=await seed(store,new Uint8Array(1024).fill(7));
  originals.read=async key=>{const bytes=originals.objects.get(key).bytes.slice();bytes[0]^=1;return new Response(bytes);};
  const fetchBefore=globalThis.fetch;globalThis.fetch=originals.put.bind(originals);
  try {await assert.rejects(migrateOriginal({store,originals,file:before.file}),/SHA-256/);assert.deepEqual(await store.get('media/'+before.file),before.manifest);assert.deepEqual(await store.get('state'),before.state);assert.equal(store.deletes,0);}
  finally{globalThis.fetch=fetchBefore;}
});

test('interrupted migration resumes storage parts and never changes video URLs in the document',async()=>{
  const store=new Store(),originals=storageFixture(),before=await seed(store,new Uint8Array(ORIGINAL_PART_SIZE+128).fill(5));
  const fetchBefore=globalThis.fetch;let puts=0,fail=true;
  globalThis.fetch=async(url,options)=>{puts++;if(puts===2 && fail)throw new Error('Interrupted connection');return originals.put(url,options);};
  try {await assert.rejects(migrateOriginal({store,originals,file:before.file}),/Interrupted/);assert.deepEqual(await store.get('media/'+before.file),before.manifest);fail=false;await migrateOriginal({store,originals,file:before.file});assert.equal(puts,3);assert.deepEqual(await store.get('state'),before.state);}
  finally{globalThis.fetch=fetchBefore;}
});

test('browser direct upload sends unchanged bytes and resumes after lost browser progress',async()=>{
  const source=await readFile(new URL('../public/upload-tools.js',import.meta.url),'utf8');
  const context=vm.createContext({crypto,TextEncoder,Uint8Array,URL,btoa,structuredClone,AbortController,setTimeout,clearTimeout,Map,Set});vm.runInContext(source,context);
  const originals=storageFixture(),store=new Store(),app=createPortfolio({store,originals,password:'test-password-long-enough',initialDocument,log:()=>{}});
  const response=await app.fetch(new Request('https://site.test/api/login',{method:'POST',headers:{origin:'https://site.test'},body:JSON.stringify({password:'test-password-long-enough'})}));const cookie=response.headers.get('set-cookie').split(';')[0];
  const request=async(path,options={})=>{const headers=new Headers(options.headers);headers.set('cookie',cookie);if(options.method)headers.set('origin','https://site.test');const r=await app.fetch(new Request('https://site.test'+path,{...options,headers}));const result=await r.json();if(!r.ok)throw Object.assign(new Error(result.error),{status:r.status});return result;};
  let puts=0;
  const directRequest=async(url,options)=>{puts++;if(puts===2)throw new Error('Connection interrupted');return originals.put(url,options);};
  const persistence={get:async()=>null,set:async()=>{},remove:async()=>{}};
  const file=new Blob([new Uint8Array(ORIGINAL_PART_SIZE+97).fill(13)]);
  const create=()=>context.PortfolioUploads.createUploader({request,directRequest,storage:persistence,attempts:1});
  await assert.rejects(create().upload(file,'video/mp4'),/Ponovno odaberi isti video/);
  const result=await create().upload(file,'video/mp4');assert(result.url.startsWith('/media/'));assert.equal(puts,3);
  const manifest=await store.get('media/'+result.url.slice(7));assert.equal(manifest.backend,'r2');assert.deepEqual(originals.objects.get(manifest.objectKey).bytes,new Uint8Array(await file.arrayBuffer()));
});

test('configured R2 signing binds upload to one object, part and Content-MD5 without exposing secret',async()=>{
  const config={accountId:'a'.repeat(32),bucket:'anchos-originals',accessKeyId:'test-access',secretAccessKey:'test-secret'};
  const originals=createOriginalStorage(config,{now:()=>new Date('2026-10-14T00:00:00Z')});
  const key='originals/'+crypto.randomUUID()+'.mp4',checksum=createHash('md5').update('original').digest('base64');
  const result=await originals.partURL(key,'upload-id',2,checksum);const url=new URL(result.url);
  assert.equal(url.searchParams.get('partNumber'),'2');assert.equal(url.searchParams.get('uploadId'),'upload-id');assert.equal(url.searchParams.get('X-Amz-Expires'),'1800');assert.match(url.searchParams.get('X-Amz-SignedHeaders'),/content-md5/);assert(!result.url.includes('test-secret'));
  await assert.rejects(originals.signedURL('../outside.mp4'),/putanja/);
  assert.equal(originalStorageConfig(()=>undefined),null);
  assert.throws(()=>originalStorageConfig(name=>name==='ORIGINAL_VIDEO_STORAGE'?'r2':undefined),/povezana/);
});

test('storage HTTP 200 completion errors and malformed original checksums are rejected',async()=>{
  const config={accountId:'a'.repeat(32),bucket:'anchos-originals',accessKeyId:'test-access',secretAccessKey:'test-secret'};
  const key='originals/'+crypto.randomUUID()+'.mp4';
  const errors=createOriginalStorage(config,{fetch:async()=>new Response('<Error><Code>InvalidPart</Code></Error>')});
  await assert.rejects(errors.complete(key,'upload',[]),/potvrđen/);
  const incomplete=createOriginalStorage(config,{fetch:async()=>new Response('<ListPartsResult><Part><PartNumber>1</PartNumber><Size>5</Size><ETag>"'+ 'a'.repeat(32)+'-2"</ETag></Part></ListPartsResult>')});
  await assert.rejects(incomplete.list(key,'upload'),/izvornih bajtova/);
});

test('unpublished direct original and migration endpoint remain owner-only',async()=>{
  const store=new Store(),originals=storageFixture(),file=crypto.randomUUID()+'.mp4';
  await store.setJSON('media/'+file,{backend:'r2',objectKey:'originals/'+file,size:123,type:'video/mp4'});
  let dispatched=0;
  const app=createPortfolio({store,originals,migrationEnabled:true,dispatch:async()=>{dispatched++;return new Response(null,{status:202});},password:'test-password-long-enough',initialDocument,log:()=>{}});
  assert.equal((await app.fetch(new Request('https://site.test/media/'+file))).status,401);
  assert.equal((await app.fetch(new Request('https://site.test/api/originals/migrate',{method:'POST',headers:{origin:'https://site.test'}}))).status,401);assert.equal(dispatched,0);
  const login=await app.fetch(new Request('https://site.test/api/login',{method:'POST',headers:{origin:'https://site.test'},body:JSON.stringify({password:'test-password-long-enough'})}));const cookie=login.headers.get('set-cookie').split(';')[0];
  assert.equal((await app.fetch(new Request('https://site.test/media/'+file,{headers:{cookie}}))).status,307);
  assert.equal((await app.fetch(new Request('https://site.test/api/originals/migrate',{method:'POST',headers:{cookie,origin:'https://other.test'}}))).status,403);assert.equal(dispatched,0);
  assert.equal((await app.fetch(new Request('https://site.test/api/originals/migrate',{method:'POST',headers:{cookie,origin:'https://site.test'}}))).status,200);assert.equal(dispatched,1);
});

test('owner storage probe verifies full original bytes and ranges without modifying published or private content',async()=>{
  const store=new Store(),originals=storageFixture(),seeded=await seed(store,new Uint8Array(101).fill(9));
  const dispatch=async(url,options)=>{
    if(options.method==='PUT')return originals.put(url,options);
    const target=new URL(url),key=target.pathname.slice('/test/'.length),bytes=originals.objects.get(key).bytes;
    assert.equal(options.headers.range,'bytes=31-94');
    return new Response(bytes.slice(31,95),{status:206,headers:{'content-range':'bytes 31-94/'+bytes.length}});
  };
  const app=createPortfolio({store,originals,dispatch,password:'test-password-long-enough',initialDocument,log:()=>{}});
  const url='https://site.test/api/originals/check';
  assert.equal((await app.fetch(new Request(url,{method:'POST',headers:{origin:'https://site.test'}}))).status,401);assert.equal(originals.uploads.size,0);
  const login=await app.fetch(new Request('https://site.test/api/login',{method:'POST',headers:{origin:'https://site.test'},body:JSON.stringify({password:'test-password-long-enough'})}));const cookie=login.headers.get('set-cookie').split(';')[0];
  const result=await app.fetch(new Request(url,{method:'POST',headers:{cookie,origin:'https://site.test'}}));assert.equal(result.status,200);assert.equal((await result.json()).verified,true);
  assert.deepEqual(await store.get('state'),seeded.state);assert.deepEqual(await store.get('media/'+seeded.file),seeded.manifest);assert.equal(store.deletes,0);
  assert(await store.get('original-storage-checks/site.test'));
});

test('transport MD5 matches the independent Node implementation at block boundaries and video chunk size',()=>{
  for(const length of [0,1,55,56,63,64,65,127,128,65536,ORIGINAL_PART_SIZE]) {
    const bytes=Uint8Array.from({length},(_,i)=>i%251);
    assert.equal(SparkMD5.ArrayBuffer.hash(bytes.buffer),createHash('md5').update(bytes).digest('hex'));
  }
});

test('real adapter uses supported R2 part checksums and derives resume receipts from MD5 ETags',async()=>{
  const config={accountId:'a'.repeat(32),bucket:'ugcoriginals',accessKeyId:'test-access',secretAccessKey:'test-secret'};
  const expected=createHash('md5').update('original').digest('hex');
  const originals=createOriginalStorage(config,{fetch:async request=>{
    assert.equal(request.headers.has('x-amz-checksum-algorithm'),false);
    if(request.method==='POST')return new Response('<InitiateMultipartUploadResult><UploadId>test</UploadId></InitiateMultipartUploadResult>');
    return new Response('<ListPartsResult><Part><PartNumber>1</PartNumber><Size>8</Size><ETag>"'+expected+'"</ETag></Part></ListPartsResult>');
  }});
  const key='originals/'+crypto.randomUUID()+'.mp4';
  await originals.start(key,'video/mp4');
  const parts=await originals.list(key,'test');assert.equal(parts[0].checksum,createHash('md5').update('original').digest('base64'));
  const signed=await originals.partURL(key,'test',1,parts[0].checksum);assert.deepEqual(signed.headers,{'content-md5':parts[0].checksum});assert.match(new URL(signed.url).searchParams.get('X-Amz-SignedHeaders'),/content-md5/);
});
