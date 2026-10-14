import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {boxHeader,relocateMovieBox,fastStartPrefix} from '../netlify/edge-functions/lib/fast-start.js';
import {preparePlayback} from '../netlify/edge-functions/lib/prepare-playback.js';
import {ORIGINAL_PART_SIZE} from '../netlify/edge-functions/lib/original-storage.js';
import {createOriginalStorage} from '../netlify/edge-functions/lib/original-storage.js';
import {createPortfolio} from '../netlify/edge-functions/lib/server.js';
import initialDocument from '../netlify/edge-functions/lib/initial-document.js';

function box(type,payload){const b=Buffer.alloc(payload.length+8);b.writeUInt32BE(b.length);b.write(type,4,4,'ascii');Buffer.from(payload).copy(b,8);return b;}
function fixture(){
 const prefix=box('ftyp',Buffer.alloc(16)),data=Uint8Array.from({length:ORIGINAL_PART_SIZE+217},(_,i)=>i%251),mdat=box('mdat',data);
 const entries=Buffer.alloc(16);entries.writeUInt32BE(2,4);entries.writeUInt32BE(prefix.length+8,8);entries.writeUInt32BE(prefix.length+98,12);
 const movie=box('moov',box('trak',box('mdia',box('minf',box('stbl',box('stco',entries))))));
 const source=Buffer.concat([prefix,mdat,movie]);return {source,prefix,mdat,movie,insertAt:prefix.length,oldStart:prefix.length+mdat.length};
}
class Store{
 values=new Map();n=0;deletes=0;
 async getWithMetadata(k){const v=this.values.get(k);return v?{data:structuredClone(v.data),etag:v.etag}:null;}
 async get(k){return (await this.getWithMetadata(k))?.data ?? null;}
 async setJSON(k,data,o={}){const old=this.values.get(k);if(o.onlyIfNew&&old||o.onlyIfMatch&&old?.etag!==o.onlyIfMatch)return {modified:false};const etag=String(++this.n);this.values.set(k,{data:structuredClone(data),etag});return {modified:true,etag};}
 async delete(){this.deletes++;throw Error('No original deletion allowed');}
}
function storage(sourceKey,source){
 const objects=new Map([[sourceKey,{bytes:source,type:'video/mp4'}]]),uploads=new Map();let copies=0;
 const api={objects,uploads,copies:()=>copies,
  async readRange(k,start,end,total){const bytes=objects.get(k).bytes;assert.equal(bytes.length,total);return new Response(bytes.subarray(start,end+1),{status:206,headers:{'content-range':'bytes '+start+'-'+end+'/'+total}});},
  async start(k,type){uploads.set(k,{type,parts:new Map()});return 'upload';},
  async head(k){const o=objects.get(k);return o?{size:o.bytes.length,type:o.type}:null;},
  async list(k){return [...uploads.get(k).parts.values()].map(({bytes,...p})=>p).sort((a,b)=>a.partNumber-b.partNumber);},
  async partURL(k,id,part,checksum){return {url:'https://test.invalid/'+k+'?part='+part,headers:{'content-md5':checksum}};},
  async put(url,options){const u=new URL(url),k=u.pathname.slice(1),part=Number(u.searchParams.get('part')),bytes=Buffer.from(options.body);assert.equal(createHash('md5').update(bytes).digest('base64'),options.headers['content-md5']);api.receipt(k,part,bytes);return new Response(null);},
  receipt(k,part,bytes){uploads.get(k).parts.set(part,{partNumber:part,size:bytes.length,checksum:createHash('md5').update(bytes).digest('base64'),etag:'"'+createHash('md5').update(bytes).digest('hex')+'"',bytes});},
  async copyPart(k,id,part,src,start,end){copies++;api.receipt(k,part,objects.get(src).bytes.subarray(start,end+1));return uploads.get(k).parts.get(part).etag;},
  async complete(k,id,parts){objects.set(k,{type:uploads.get(k).type,bytes:Buffer.concat(parts.map(p=>uploads.get(k).parts.get(p.partNumber).bytes))});},
  async read(k){return new Response(objects.get(k).bytes);}
 };return api;
}
test('movie relocation changes only chunk offsets and preserves the file size and all media bytes',()=>{
 const f=fixture(),moved=relocateMovieBox(f.movie,f.insertAt,f.oldStart),result=fastStartPrefix(f.prefix,moved,f.mdat);
 assert.equal(result.length,f.source.length);assert(Buffer.from(result.subarray(f.prefix.length+moved.length)).equals(f.mdat));
 const stco=Buffer.from(moved).indexOf(Buffer.from('stco')),view=new DataView(moved.buffer,moved.byteOffset,moved.byteLength);
 assert.equal(view.getUint32(stco+12),f.prefix.length+8+moved.length);assert.equal(view.getUint32(stco+16),f.prefix.length+98+moved.length);
 assert.equal(boxHeader(result,f.prefix.length).type,'moov');
});
test('playback preparation uses provider copies, verifies the entire relocated file and retains original and documents',async()=>{
 const f=fixture(),store=new Store(),sourceKey='originals/'+crypto.randomUUID()+'.mp4',file=crypto.randomUUID()+'.mp4';
 const original={backend:'r2',objectKey:sourceKey,type:'video/mp4',size:f.source.length,sha256:createHash('sha256').update(f.source).digest('hex')};
 const state={published:{document:{text:'original design'}},draft:{document:{text:'private edits'}}};await store.setJSON('state',state);await store.setJSON('media/'+file,original);
 const api=storage(sourceKey,f.source);const result=await preparePlayback({store,originals:api,file,transport:api.put});assert.equal(result.verified,true);
 const manifest=(await store.getWithMetadata('media/'+file)).data;assert.equal(manifest.objectKey,sourceKey);assert.equal(manifest.playback.lossless,true);assert.equal(manifest.playback.size,f.source.length);assert(api.copies()>0);
 assert.deepEqual(api.objects.get(sourceKey).bytes,f.source);assert.deepEqual((await store.getWithMetadata('state')).data,state);assert.equal(store.deletes,0);
 const expected=fastStartPrefix(f.prefix,relocateMovieBox(f.movie,f.insertAt,f.oldStart),f.mdat);assert(api.objects.get(manifest.playback.key).bytes.equals(Buffer.from(expected)));
 assert([...store.values.keys()].some(k=>k.startsWith('original-manifest-history/')));
});
test('failed copied-file integrity leaves the original manifest and media unchanged',async()=>{
 const f=fixture(),store=new Store(),sourceKey='originals/'+crypto.randomUUID()+'.mp4',file=crypto.randomUUID()+'.mp4',manifest={backend:'r2',objectKey:sourceKey,type:'video/mp4',size:f.source.length};await store.setJSON('media/'+file,manifest);
 const api=storage(sourceKey,f.source);api.read=async k=>{const b=api.objects.get(k).bytes.slice();b[100]^=1;return new Response(b);};
 await assert.rejects(preparePlayback({store,originals:api,file,transport:api.put}),/integrity/);assert.deepEqual((await store.getWithMetadata('media/'+file)).data,manifest);assert.deepEqual(api.objects.get(sourceKey).bytes,f.source);
});

test('provider copy binds the immutable source range and rejects embedded HTTP 200 errors',async()=>{
 const config={accountId:'a'.repeat(32),bucket:'ugcoriginals',accessKeyId:'test-access',secretAccessKey:'test-secret'};
 const source='originals/'+crypto.randomUUID()+'.mp4',target='playback/'+crypto.randomUUID()+'.mp4';
 const api=createOriginalStorage(config,{fetch:async request=>{assert.equal(request.method,'PUT');assert.equal(request.headers.get('x-amz-copy-source'),'/ugcoriginals/'+source);assert.equal(request.headers.get('x-amz-copy-source-range'),'bytes=100-8388707');return new Response('<CopyPartResult><ETag>"'+ 'a'.repeat(32)+'"</ETag></CopyPartResult>');}});
 assert.equal(await api.copyPart(target,'upload',2,source,100,8388707),'"'+'a'.repeat(32)+'"');
 const broken=createOriginalStorage(config,{fetch:async()=>new Response('<Error><Code>InvalidRange</Code></Error>')});await assert.rejects(broken.copyPart(target,'upload',2,source,100,8388707),/potvrđena/);
});

test('public playback chooses the prepared copy but an original download still selects the original object',async()=>{
 const store=new Store(),file=crypto.randomUUID()+'.mp4',original='originals/'+file,playback='playback/'+crypto.randomUUID()+'.mp4';
 await store.setJSON('media/'+file,{backend:'r2',objectKey:original,type:'video/mp4',size:123,playback:{ready:true,key:playback,size:123}});
 const document=structuredClone(initialDocument);document.videos[0].src='/media/'+file;await store.setJSON('state',{published:{document}});
 const calls=[],app=createPortfolio({store,initialDocument,password:'test-password-long-enough',originals:{async signedURL(key,method,query,expires){calls.push({key,expires});return 'https://storage.test/'+key;}},log:()=>{}});
 assert.equal((await app.fetch(new Request('https://site.test/media/'+file))).status,307);assert.equal(calls[0].key,playback);assert.equal(calls[0].expires,21600);
 assert.equal((await app.fetch(new Request('https://site.test/media/'+file+'?original=1'))).status,307);assert.equal(calls[1].key,original);
});
