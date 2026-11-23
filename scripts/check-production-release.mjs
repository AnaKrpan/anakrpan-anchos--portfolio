import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const origin='https://anakrpan-anchos-potrfolio.netlify.app';
let ready=false;
for(let n=0;n<30;n++){
  try{const r=await fetch(origin+'/api/release-status',{signal:AbortSignal.timeout(10000)});if(r.ok&&(await r.json()).ready){ready=true;break;}}catch{}
  await new Promise(r=>setTimeout(r,10000));
}
assert(ready,'Production release has not passed data validation');
const response=await fetch(origin+'/api/content');assert(response.ok);const {document:doc}=await response.json();
assert(doc.projects?.some(p=>p.id==='holiday-house-the-view'&&p.status==='published'));
assert(doc.projects.every(p=>['published','comingSoon'].includes(p.status)));
// The owner completed the existing pet collaboration card and kept its client name private.
assert(doc.projects.some(p=>(/barkode/i.test([p.client,p.title?.hr,p.title?.en].join(' '))||(p.id==='upcoming-pet'&&/affiliate/i.test(p.title?.en||'')))&&p.status==='published'&&p.videos.some(v=>v.src)),'Approved Barkode collaboration must be public, including when its client name is hidden');
assert(doc.projects.some(p=>(p.category==='jewelry'||/naušnic|earrings/i.test(JSON.stringify(p.title)))&&p.status==='published'));
const videos=doc.projects.filter(p=>p.status==='published').flatMap(p=>p.videos);
assert(videos.length>=5);assert(videos.every(v=>v.src));
for(const v of videos.filter(v=>v.src.startsWith('/media/'))){
  const head=await fetch(origin+v.src,{method:'HEAD',signal:AbortSignal.timeout(20000)});
  assert(head.ok&&Number(head.headers.get('content-length'))>0,'Public video HEAD must succeed');
  const range=await fetch(origin+v.src,{headers:{range:'bytes=0-63'},signal:AbortSignal.timeout(20000)});
  if(range.status!==206){await range.body?.cancel();throw Error('Public video must support byte ranges');}
  assert.equal((await range.arrayBuffer()).byteLength,64);
}
assert.equal((await fetch(origin+'/api/draft')).status,401);
const editor=await fetch(origin+'/uredi',{redirect:'manual'});assert.equal(editor.status,302);assert.equal(new URL(editor.headers.get('location'),origin).pathname,'/prijava.html');
const browser=await chromium.launch();
try{
 for(const viewport of [{width:390,height:844},{width:1280,height:900}]){
  const page=await browser.newPage({viewport}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin);await page.waitForSelector('#project-gallery [data-project-id]');
  assert.equal(await page.locator('#editor-panel').isVisible(),false);
  assert.equal(await page.locator('#project-gallery > .project-card').first().getAttribute('data-project-id'),'holiday-house-the-view');
  assert.equal(await page.locator('#project-gallery video').count(),videos.length);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.getByRole('button',{name:'English',exact:true}).click();
  assert.equal(await page.locator('#project-gallery [data-project-id="holiday-house-the-view"] .project-title').innerText(),'One Location. Three Creative Approaches.');
  assert.equal(await page.locator('#project-filters button:visible').nth(1).innerText(),'Travel & Hospitality');
  await page.getByRole('button',{name:'Hrvatski',exact:true}).click();
  assert.equal(await page.locator('#project-filters button:visible').nth(1).innerText(),'Smještaj i putovanja');
  assert.equal(await page.locator('#contact-phone').getAttribute('href'),'tel:+385911513866');assert.deepEqual(errors,[]);
  console.log(JSON.stringify({viewport,productionPublicHRandEN:true,publishedProjects:doc.projects.map(p=>({id:p.id,status:p.status})),publicVideoCount:videos.length,noEmptyVideos:true,privateDraftProtected:true}));
  await page.close();
 }
}finally{await browser.close();}
