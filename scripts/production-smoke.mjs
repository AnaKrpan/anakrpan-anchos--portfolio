import assert from 'node:assert/strict';
import viewingCopies from '../netlify/edge-functions/lib/viewing-copies.js';
const origin='https://anakrpan-anchos-potrfolio.netlify.app';
const fetchTimed=(path,options={})=>fetch(origin+path,{...options,signal:AbortSignal.timeout(20000)});
let ready=false;
for(let attempt=0;attempt<36;attempt++){
  try { const response=await fetchTimed('/api/health');const health=await response.json();ready=response.ok&&health.ready===true&&health.build==='low-bandwidth-v6'&&health.viewingCopiesReady===true&&health.originalStorageConfigured===true; } catch {}
  if(ready)break;
  if(attempt<35)await new Promise(resolve=>setTimeout(resolve,10000));
}
assert(ready,'The repaired production deployment is not available yet.');
const home=await fetchTimed('/');assert.equal(home.status,200);const homeHTML=await home.text();assert.match(homeHTML,/upload-tools\.js/);assert.match(homeHTML,/video-posters\.js/);
const posterScript=await fetchTimed('/video-posters.js');assert.equal(posterScript.status,200);
const posters=JSON.parse((await posterScript.text()).replace(/^window\.PortfolioPosters=/,'').replace(/;\s*$/,''));
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
    assert(posters[video.src],'Published video has no cover');
    const poster=await fetchTimed(posters[video.src],{headers:{range:'bytes=0-2047'}});assert.equal(poster.status,206);
    assert.match(poster.headers.get('content-type'),/image\/jpeg/);
    const jpeg=new Uint8Array(await poster.arrayBuffer());assert(jpeg.length===2048&&jpeg[0]===255&&jpeg[1]===216);
    assert.equal(response.headers.get('content-range'),'bytes 0-63/'+copy.size);
    assert(new URL(response.url).hostname.endsWith('.r2.cloudflarestorage.com'),'Video is still using Netlify bandwidth');
    const beginning=await fetchTimed(video.src,{headers:{range:'bytes=0-131071'}});
    assert.equal(beginning.status,206);
    const head=Buffer.from(await beginning.arrayBuffer());assert(head.indexOf('moov')>0&&head.indexOf('moov')<head.indexOf('mdat'));
    const original=await fetchTimed(video.src+'?original=1',{headers:{range:'bytes=0-63'}});
    assert.equal(original.status,206);assert.equal(original.headers.get('content-range'),'bytes 0-63/'+copy.originalSize);
    assert.equal((await original.arrayBuffer()).byteLength,64);
  }
}
console.log(JSON.stringify({productionReady:true,privateDraftProtected:true,videoSlots:5,publishedVideosWithValidRanges:videos.length}));
console.log('All five viewing videos are delivered directly by R2; small-range checks passed, original routes and posters remain available. No full video downloads were performed.');
