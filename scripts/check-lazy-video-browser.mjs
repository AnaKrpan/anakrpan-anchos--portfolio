import assert from 'node:assert/strict';
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
import initial from '../netlify/edge-functions/lib/initial-document.js';
import copies from '../netlify/edge-functions/lib/viewing-copies.js';

const document=structuredClone(initial);
document.videos.forEach((v,i)=>{v.src=Object.keys(copies)[i];v.present=true;});
const server=http.createServer(async(req,res)=>{
  if(req.url==='/api/content'){res.setHeader('content-type','application/json');res.end(JSON.stringify({document,revision:1,canEdit:false}));return;}
  try{const path=resolve('public','.'+(req.url==='/'?'/index.html':req.url));if(!path.startsWith(resolve('public')+'/'))throw Error();
    const data=await readFile(path);res.setHeader('content-type',path.endsWith('.js')?'text/javascript':path.endsWith('.jpg')?'image/jpeg':path.endsWith('.webp')?'image/webp':'text/html');res.end(data);
  }catch{res.writeHead(404);res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch();
try{
  for(const viewport of [{width:390,height:844},{width:1280,height:900}]){
    const page=await browser.newPage({viewport}),media=[],api=[];
    await page.route('**/*',route=>{
      const url=new URL(route.request().url());
      if(url.origin!==origin){route.abort();return;}
      if(url.pathname.startsWith('/media/')){media.push(url.pathname);route.abort();return;}
      if(url.pathname.startsWith('/api/'))api.push(url.pathname);
      route.continue();
    });
    await page.goto(origin);await page.waitForFunction(()=>document.querySelector('video').dataset.mediaSrc);
    await page.locator('[data-video-slot="5"]').scrollIntoViewIfNeeded();await page.waitForTimeout(300);
    assert.deepEqual(media,[],'Scrolling must not request any video bytes');assert.deepEqual(api,['/api/content']);
    const before=await page.evaluate(()=>({videos:[...document.querySelectorAll('video')].map(v=>({src:v.getAttribute('src'),poster:v.poster,preload:v.preload})),draft:captureDraft()}));
    assert(before.videos.every(v=>!v.src&&v.poster&&v.preload==='none'));
    assert.deepEqual(before.draft.videos.map(v=>v.src),Object.keys(copies));assert(before.draft.videos.every(v=>v.present));
    await page.locator('[data-video-slot="1"] .video-start').click();await page.waitForTimeout(500);
    assert.deepEqual(media,[Object.keys(copies)[0]],'Only the explicitly selected video may request data');
    const after=await page.evaluate(()=>captureDraft());assert.deepEqual(after.videos.map(v=>v.src),before.draft.videos.map(v=>v.src));
    await page.evaluate(()=>{document.querySelector('video').currentTime=17;window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));});
    const restored=await page.evaluate(()=>[...document.querySelectorAll('video')].map(v=>({src:v.getAttribute('src'),time:v.currentTime,poster:v.poster,paused:v.paused,button:v.parentElement.querySelector('.video-start').hidden})));
    assert(restored.every(v=>!v.src&&v.time===0&&v.poster&&v.paused&&!v.button),'Restored page must show posters at the beginning without loading video');
    await page.reload();await page.waitForFunction(()=>document.querySelector('video').dataset.mediaSrc);
    assert.equal(media.length,1,'Reload must not fetch any video');
    assert(await page.evaluate(()=>[...document.querySelectorAll('video')].every(v=>!v.getAttribute('src')&&v.currentTime===0&&v.poster)));
    console.log(JSON.stringify({viewport,initialVideoRequests:0,scrollVideoRequests:0,clickedVideoRequests:media.length,unplayedVideosPreservedInDraft:true}));
    await page.close();
  }
}finally{await browser.close();server.close();}
