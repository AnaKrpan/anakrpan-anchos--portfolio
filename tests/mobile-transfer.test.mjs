import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {createPortfolio} from '../netlify/edge-functions/lib/server.js';
import initialDocument from '../netlify/edge-functions/lib/initial-document.js';

const source=await readFile(new URL('../public/upload-tools.js',import.meta.url),'utf8');
function load(extra={}){const context=vm.createContext({crypto,TextEncoder,Uint8Array,URL,btoa,Response,structuredClone,AbortController,setTimeout,clearTimeout,Map,Set,...extra});vm.runInContext(source,context);return context.PortfolioUploads;}
test('upload sends the same in-memory bytes that were hashed, without reading a mobile file part twice',async()=>{
 const bytes=new Uint8Array(2*1024*1024).fill(17),reads=[];
 const file={size:bytes.length,slice(start,end){const stop=Math.min(end ?? bytes.length,bytes.length),blob=new Blob([bytes.slice(start,stop)]);return {size:blob.size,arrayBuffer:async()=>{reads.push([start,stop]);return blob.arrayBuffer();}};}};
 const api=load(),reports=[];
 const request=async(path,options={})=>{
  if(path.endsWith('/start'))return {id:'test',direct:true,partSize:8*1024*1024};
  if(path.includes('/status'))return {receipts:[]};
  if(path.endsWith('/part-url')){const data=JSON.parse(options.body);return {url:'https://'+'a'.repeat(32)+'.r2.cloudflarestorage.com/bucket/original.mp4',headers:{'content-md5':data.checksum}};}
  if(path.endsWith('/complete'))return {url:'/media/test.mp4'};
  throw Error(path);
 };
 const uploader=api.createUploader({request,storage:{get:async()=>null,set:async()=>{},remove:async()=>{}},report:t=>reports.push(t),directRequest:async(url,options)=>{
  assert(options.body instanceof ArrayBuffer);const received=Buffer.from(options.body);assert(received.equals(Buffer.from(bytes)));assert.equal(createHash('md5').update(received).digest('base64'),options.headers['content-md5']);options.onProgress(received.length/2);return new Response(null,{headers:{etag:'"'+createHash('md5').update(received).digest('hex')+'"'}});
 }});
 assert.equal((await uploader.upload(file,'video/mp4')).url,'/media/test.mp4');assert.equal(reads.filter(([start,end])=>start===0&&end===bytes.length).length,1);assert.equal(reads.length,3);assert(reports.some(t=>t.includes('50.0 %')));
});
test('an active slow transfer keeps its idle allowance while a genuinely stalled transfer aborts',async()=>{
 let clock=0,sequence=0;const timers=new Map();
 const set=(fn,ms)=>{const id=++sequence;timers.set(id,{fn,at:clock+ms});return id;};
 const clear=id=>timers.delete(id);
 const advance=ms=>{clock+=ms;for(const [id,t]of [...timers])if(t.at<=clock){timers.delete(id);t.fn();}};
 class XHR{constructor(){XHR.last=this;this.upload={};this.status=200;this.responseText='';}open(){}setRequestHeader(){}getResponseHeader(){return '"'+ 'a'.repeat(32)+'"';}send(body){this.body=body;}abort(){this.aborted=true;this.onabort();}}
 const api=load({XMLHttpRequest:XHR,setTimeout:set,clearTimeout:clear});
 const promise=api.nativeDirectRequest('https://storage.test',{body:new ArrayBuffer(16),headers:{}}),xhr=XHR.last;
 advance(179000);xhr.upload.onprogress({loaded:1});advance(2000);assert.equal(xhr.aborted,undefined);xhr.onload();assert.equal((await promise).status,200);assert.equal(timers.size,0);
 const stalled=api.nativeDirectRequest('https://storage.test',{body:new ArrayBuffer(16),headers:{}});advance(180001);await assert.rejects(stalled,/zastao/);assert.equal(XHR.last.aborted,true);
});

test('incomplete legacy uploads switch to direct storage while completed originals return immediately and old data is retained',async()=>{
 const values=new Map();let sequence=0,starts=0;
 const store={async getWithMetadata(k){const v=values.get(k);return v?{data:structuredClone(v.data),etag:v.etag}:null;},async get(k){return (await this.getWithMetadata(k))?.data ?? null;},async setJSON(k,data,o={}){const old=values.get(k);if(o.onlyIfMatch&&old?.etag!==o.onlyIfMatch||o.onlyIfNew&&old)return {modified:false};const etag=String(++sequence);values.set(k,{data:structuredClone(data),etag});return {modified:true,etag};}};
 const oldId=crypto.randomUUID(),fingerprint='b'.repeat(64),session={id:oldId,file:oldId+'.mp4',type:'video/mp4',size:10*1024*1024,partSize:512*1024,createdAt:Date.now(),fingerprint};
 await store.setJSON('uploads/'+oldId,session);await store.setJSON('upload-index/'+fingerprint,{id:oldId});await store.setJSON('parts/'+oldId+'/1',{retained:true});
 const app=createPortfolio({store,initialDocument,password:'test-long-password-originals',originals:{async start(){starts++;return 'new-upload';}},log:()=>{}});
 const login=await app.fetch(new Request('https://site.test/api/login',{method:'POST',headers:{origin:'https://site.test'},body:JSON.stringify({password:'test-long-password-originals'})}));const cookie=login.headers.get('set-cookie').split(';')[0];
 const request=()=>new Request('https://site.test/api/media/start',{method:'POST',headers:{origin:'https://site.test',cookie},body:JSON.stringify({fingerprint,type:session.type,size:session.size})});
 const first=await (await app.fetch(request())).json();assert.equal(first.direct,true);assert.notEqual(first.id,oldId);assert.equal(starts,1);assert.deepEqual(await store.get('uploads/'+oldId),session);assert.deepEqual(await store.get('parts/'+oldId+'/1'),{retained:true});
 const newSession=await store.get('uploads/'+first.id);await store.setJSON('media/'+newSession.file,{...newSession});
 const next=await (await app.fetch(request())).json();assert.equal(next.completedUrl,'/media/'+newSession.file);assert.equal(starts,1);
});
