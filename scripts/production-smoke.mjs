import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import viewingCopies from '../netlify/edge-functions/lib/viewing-copies.js';
const origin='https://anakrpan-anchos-potrfolio.netlify.app';
const fetchTimed=(path,options={})=>fetch(origin+path,{...options,signal:AbortSignal.timeout(20000)});
let ready=false;
for(let attempt=0;attempt<36;attempt++){
  try { const response=await fetchTimed('/api/health');const health=await response.json();ready=response.ok&&health.ready===true&&health.build==='mobile-viewing-v5'&&health.originalStorageConfigured===true; } catch {}
  if(ready)break;
  if(attempt<35)await new Promise(resolve=>setTimeout(resolve,10000));
}
assert(ready,'The repaired production deployment is not available yet.');
const home=await fetchTimed('/');assert.equal(home.status,200);assert.match(await home.text(),/upload-tools\.js/);
const session=await fetchTimed('/api/session');assert.equal((await session.json()).canEdit,false);
assert.equal((await fetchTimed('/api/draft')).status,401);
const contentResponse=await fetchTimed('/api/content');assert.equal(contentResponse.status,200);
const {document:doc}=await contentResponse.json();assert.equal(doc.videos.length,5);assert(Array.isArray(doc.texts));
const videos=doc.videos.filter(video=>video.src?.startsWith('/media/'));
for(const video of videos){
  const response=await fetchTimed(video.src,{headers:{range:'bytes=0-63'}});
  assert.equal(response.status,206);assert.match(response.headers.get('content-range'),/^bytes 0-63\//);
  assert.equal((await response.arrayBuffer()).byteLength,64);
  const copy=viewingCopies[video.src];
  if(copy){
    assert.equal(new URL(response.url).pathname,copy.url);
    assert.equal(response.headers.get('content-range'),'bytes 0-63/'+copy.size);
    const full=await fetchTimed(copy.url);assert.equal(full.status,200);
    const bytes=new Uint8Array(await full.arrayBuffer());assert.equal(bytes.length,copy.size);
    assert.equal(createHash('sha256').update(bytes).digest('hex'),copy.sha256);
    const head=Buffer.from(bytes.subarray(0,262144));assert(head.indexOf('moov')>0&&head.indexOf('moov')<head.indexOf('mdat'));
    const original=await fetchTimed(video.src+'?original=1',{headers:{range:'bytes=0-63'}});
    assert.equal(original.status,206);assert.equal(original.headers.get('content-range'),'bytes 0-63/'+copy.originalSize);
    assert.equal((await original.arrayBuffer()).byteLength,64);
  }
}
console.log(JSON.stringify({productionReady:true,privateDraftProtected:true,videoSlots:5,publishedVideosWithValidRanges:videos.length}));
console.log('Viewing copies match verified checksums; raw original routes remain available. This read-only check did not modify content.');
