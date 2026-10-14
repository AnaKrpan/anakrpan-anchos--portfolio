import assert from 'node:assert/strict';
const origin='https://anakrpan-anchos-potrfolio.netlify.app';
const fetchTimed=(path,options={})=>fetch(origin+path,{...options,signal:AbortSignal.timeout(20000)});
let ready=false;
for(let attempt=0;attempt<36;attempt++){
  try { const response=await fetchTimed('/api/health');const health=await response.json();ready=response.ok&&health.ready===true&&health.build==='video-repair-v2'; } catch {}
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
}
console.log(JSON.stringify({productionReady:true,privateDraftProtected:true,videoSlots:5,publishedVideosWithValidRanges:videos.length}));
console.log('This read-only check did not modify content or upload files. Original 821 MB upload still requires an owner-device check.');
