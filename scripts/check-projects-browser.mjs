import assert from 'node:assert/strict';
import https from 'node:https';
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
import {createPortfolio} from '../netlify/edge-functions/lib/server.js';
import {previewStore} from '../netlify/edge-functions/lib/preview-store.js';
import '../public/project-model.js';
const M=globalThis.PortfolioProjectModel,baseline=JSON.parse(await readFile('tests/fixtures/language-content.json','utf8')).document;
class Store{
  values=new Map();n=0;writes=0;
  async get(key,{type='json'}={}){const d=this.values.get(key)?.data;if(d===undefined)return null;return type==='arrayBuffer'?new Uint8Array(d).slice().buffer:structuredClone(d);}
  async getWithMetadata(key,options={}){const e=this.values.get(key);return e?{etag:e.etag,data:await this.get(key,options)}:null;}
  async getMetadata(key){return this.values.has(key)?{etag:this.values.get(key).etag,metadata:structuredClone(this.values.get(key).metadata||{})}:null;}
  async setJSON(key,data,options={}){const old=this.values.get(key);if(options.onlyIfNew&&old||options.onlyIfMatch&&options.onlyIfMatch!==old?.etag)return {modified:false};this.writes++;this.values.set(key,{data:structuredClone(data),metadata:structuredClone(options.metadata||{}),etag:String(++this.n)});return {modified:true};}
  async set(key,data,options){return this.setJSON(key,new Uint8Array(data),options);}
  async delete(){throw Error('No media deletion permitted');}
}
execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout','/tmp/anchos-project-test.key','-out','/tmp/anchos-project-test.crt','-days','1','-subj','/CN=localhost'],{stdio:'ignore'});
const browser=await chromium.launch();
try{
 for(const viewport of [{width:360,height:800},{width:390,height:844},{width:1280,height:900}]){
  const primary=new Store(),isolated=new Store();await primary.setJSON('state',{published:{document:baseline,revision:91},draft:{document:{secret:'PRODUCTION-PRIVATE-DRAFT'},revision:99}});
  for(const src of M.refs(baseline))await primary.setJSON('media/'+src.slice(7),{backend:'r2',objectKey:'originals/'+src.slice(7),size:1000,type:src.endsWith('.jpg')?'image/jpeg':'video/mp4'});
  const originalState=await primary.get('state'),originalWrites=primary.writes,password='isolated-browser-test-password';let origin;
  async function staticResponse(path){try{const name=resolve('public','.'+(path==='/'?'/index.html':path));if(!name.startsWith(resolve('public')+'/'))throw Error();const body=await readFile(name);return new Response(body,{headers:{'content-type':name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.jpg')?'image/jpeg':name.endsWith('.webp')?'image/webp':'text/html'}});}catch{return new Response('Not found',{status:404});}}
  const server=https.createServer({key:await readFile('/tmp/anchos-project-test.key'),cert:await readFile('/tmp/anchos-project-test.crt')},async(req,res)=>{
   try{
    const path=new URL(req.url,origin).pathname;let response;
    if(path.startsWith('/api/')||path.startsWith('/media/')||path==='/uredi'){
      const chunks=[];for await(const block of req)chunks.push(block);const body=Buffer.concat(chunks);
      const request=new Request(origin+req.url,{method:req.method,headers:req.headers,...(body.length?{body}:{} )});
      const store=await previewStore(primary,isolated);
      response=await createPortfolio({store,password,initialDocument:baseline,projectsEnabled:true,sandbox:true,directUploads:false,originals:{signedURL:async key=>'https://storage.test/'+key},log:entry=>{if(entry.status>=500)console.log('LOCAL_API_ERROR',JSON.stringify(entry));}}).fetch(request,{ip:'test',rewrite:staticResponse});
    }else response=await staticResponse(path);
    res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
   }catch(e){res.writeHead(500);res.end(e.message);}
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='https://127.0.0.1:'+server.address().port;
  const context=await browser.newContext({viewport,ignoreHTTPSErrors:true}),page=await context.newPage(),errors=[];let videoRequests=0;
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin!==origin){route.abort();return;}if(url.pathname.startsWith('/media/')&&/\.(mp4|webm)$/.test(url.pathname))videoRequests++;route.continue();});
  const publicData=async()=>{const r=await context.request.get(origin+'/api/content');return (await r.json()).document;};
  await page.goto(origin);await page.waitForFunction(()=>document.querySelector('#project-gallery [data-project-id]'));
  const publicBefore=await publicData();assert.equal(publicBefore.phone,'+385 91 151 3866');assert(!JSON.stringify(publicBefore).includes('holiday-house-the-view'));
  assert.equal(await page.locator('#project-gallery .project-video video').count(),5);
  assert.deepEqual(await page.locator('#project-gallery .project-video video').evaluateAll(vs=>vs.map(v=>v.dataset.mediaSrc)),[0,2,1,4,3].map(i=>baseline.videos[i].src));
  assert.equal(await page.getByRole('button',{name:'Smještaj i putovanja',exact:true}).count(),0);
  assert.equal(await page.getByRole('button',{name:'Nakit i modni dodaci',exact:true}).count(),0);
  assert.equal(await page.locator('#project-gallery [data-project-id="jewelry-accessories"]').count(),0);
  assert.equal(await page.locator('.project-coming .video-start').count(),0);
  assert.equal(await page.locator('#project-gallery > .project-upcoming-section .project-coming').count(),2);
  assert.equal(await page.locator('#project-gallery > .project-card.project-coming').count(),0);
  assert.equal(await page.locator('#project-gallery > :last-child').getAttribute('class'),'project-upcoming-section');
  if(viewport.width<=600){
    const boxes=await page.locator('#project-gallery .project-upcoming-grid > .project-coming').evaluateAll(cards=>cards.map(c=>{const r=c.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,right:r.right,overflow:c.scrollWidth>c.clientWidth};}));
    assert.equal(boxes.length,2);assert(Math.abs(boxes[0].y-boxes[1].y)<1,'Mobile announcements must share a row');assert(boxes[1].x>=boxes[0].right,'Mobile announcements must not overlap');assert(boxes.every(b=>b.width<viewport.width/2&&!b.overflow),'Mobile announcements must be compact without clipping');
  }

  assert.deepEqual(await page.locator('#project-gallery > .project-card').evaluateAll(cards=>cards.map(c=>c.dataset.projectId)),['legacy-1','legacy-3','legacy-2','legacy-5','legacy-4']);
  const brandRows=await page.locator('#project-gallery > .project-card').evaluateAll(cards=>cards.map(c=>{const r=c.getBoundingClientRect();return {top:r.top,bottom:r.bottom};}));
  assert(brandRows.every((row,i)=>i===0||row.top>=brandRows[i-1].bottom),'Each brand must start a new row');
  const flova=page.locator('#project-gallery [data-project-id="legacy-1"]');
  assert.equal(await flova.locator('.project-videos > .project-inline-announcement').count(),1);
  assert.equal(await flova.locator('.project-inline-announcement video,.project-inline-announcement button').count(),0);
  if(viewport.width<=600){
    const layout=await flova.locator('.project-videos').evaluate(el=>{const [v,n]=el.children;const vr=v.getBoundingClientRect(),nr=n.getBoundingClientRect();return {videoWidth:vr.width,sameRow:Math.abs(vr.top-nr.top)<1,scrollable:el.scrollWidth>el.clientWidth};});
    assert(layout.videoWidth>=200&&layout.sameRow&&layout.scrollable,'Mobile brand videos must stay readable and scroll horizontally');
  }
  await page.evaluate(()=>{window.originalGalleryVideos=[...document.querySelectorAll('#project-gallery video')];});
  assert.equal(await page.locator('#contact-phone').getAttribute('href'),'tel:+385911513866');
  const photos=await page.locator('[data-photo]').evaluateAll(images=>images.map(i=>i.getAttribute('src')));assert.deepEqual(photos,baseline.photos.map(p=>p.src));
  await page.getByRole('button',{name:'English',exact:true}).click();await page.getByRole('button',{name:'Pet & Animal Care',exact:true}).click();assert.equal(await page.locator('#project-gallery .project-card:visible').count(),2);
  await page.getByRole('button',{name:'Hrvatski',exact:true}).click();assert.equal(await page.locator('#project-gallery .project-card:visible').count(),2);assert.equal(videoRequests,0);
  assert.equal(await page.locator('#project-gallery > .project-upcoming-section').count(),0);
  assert.equal(await page.locator('#project-gallery > .project-card.project-coming:visible').count(),1);
  assert.equal(await page.locator('#project-gallery').evaluate(el=>el.classList.contains('projects-all-work')),false);
  assert.equal(await page.locator('#project-gallery .project-inline-announcement').count(),0);
  await page.getByRole('button',{name:'Svi radovi',exact:true}).click();
  assert.equal(await page.locator('#project-gallery > .project-upcoming-section .project-coming:visible').count(),2);
  assert.equal(await page.locator('#project-gallery > .project-upcoming-section > h3').innerText(),'Uskoro');
  await page.getByRole('button',{name:'English',exact:true}).click();
  assert.equal(await page.locator('#project-gallery > .project-upcoming-section > h3').innerText(),'Coming Soon');
  assert(await page.evaluate(()=>window.originalGalleryVideos.every(v=>v.isConnected&&document.querySelector('#project-gallery').contains(v))));
  assert.equal(videoRequests,0);
  await page.getByRole('button',{name:'Hrvatski',exact:true}).click();
  assert.equal((await context.request.get(origin+'/api/draft')).status(),401);
  await page.goto(origin+'/uredi');await page.locator('#password').fill(password);await page.getByRole('button',{name:'Prijavi se',exact:true}).click();
  await page.waitForFunction(()=>document.body.classList.contains('editing'));
  assert(await page.locator('#sandbox-notice').isVisible());
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Mobile editor must not overflow horizontally');
  await page.locator('[data-edit-project="jewelry-accessories"]').click();
  assert.equal(await page.getByLabel('Naslov projekta — HR',{exact:true}).inputValue(),'Nakit i modni dodaci');
  assert.equal(await page.getByLabel('Naslov projekta — EN',{exact:true}).inputValue(),'Jewelry & Accessories');
  assert.equal(await page.getByLabel('Stanje nakon objave',{exact:true}).inputValue(),'draft');
  assert.equal(await page.getByLabel('Industrija',{exact:true}).inputValue(),'jewelry');
  assert(await page.getByLabel('Influencer Marketing',{exact:true}).isChecked());

  await page.getByRole('button',{name:'Pregled cijele galerije',exact:true}).click();
  assert(await page.locator('#private-gallery-preview-notice').isVisible());
  assert.equal(await page.locator('#project-gallery > .project-card').first().getAttribute('data-project-id'),'holiday-house-the-view');
  assert.equal(await page.locator('#project-gallery [data-project-id="holiday-house-the-view"] .project-missing').count(),3);
  assert.equal(await page.locator('#project-filters button:visible').nth(1).innerText(),'Smještaj i putovanja');
  await page.getByRole('button',{name:'Smještaj i putovanja',exact:true}).click();
  assert.equal(await page.locator('#project-gallery .project-card:visible').first().getAttribute('data-project-id'),'holiday-house-the-view');
  await page.getByRole('button',{name:'Galerija EN',exact:true}).click();
  assert.equal(await page.locator('#project-filters button:visible').nth(1).innerText(),'Travel & Hospitality');
  await page.getByRole('button',{name:'All Work',exact:true}).click();
  assert.equal(await page.locator('#project-gallery > .project-card').first().getAttribute('data-project-id'),'holiday-house-the-view');
  await page.getByRole('button',{name:'Galerija HR',exact:true}).click();
  await page.locator('[data-edit-project="holiday-house-the-view"]').click();await page.getByRole('button',{name:'Pregled HR',exact:true}).click();
  assert.equal(await page.locator('.project-preview-dialog .project-missing').count(),3);await page.getByRole('button',{name:'Zatvori pregled',exact:true}).click();
  const fixture=await page.evaluate(async()=>{const canvas=document.createElement('canvas');canvas.width=180;canvas.height=320;const c=canvas.getContext('2d');c.fillStyle='#ddd0c7';c.fillRect(0,0,180,320);c.fillStyle='#382f29';c.font='20px sans-serif';c.fillText('TEST ONLY',28,160);const cover=canvas.toDataURL('image/jpeg').split(',')[1];const stream=canvas.captureStream(10),recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8'}),parts=[];recorder.ondataavailable=e=>parts.push(e.data);const finished=new Promise(r=>recorder.onstop=r);recorder.start();await new Promise(r=>setTimeout(r,350));c.fillText('TEST',40,220);await new Promise(r=>setTimeout(r,350));recorder.stop();await finished;stream.getTracks().forEach(t=>t.stop());const bytes=new Uint8Array(await new Blob(parts).arrayBuffer());let value='';for(const b of bytes)value+=String.fromCharCode(b);return {video:btoa(value),cover};});
  for(let i=0;i<3;i++){
    await page.getByLabel('Dodaj / zamijeni originalni video',{exact:true}).nth(i).setInputFiles({name:'private-holiday-test-'+i+'.webm',mimeType:'video/webm',buffer:Buffer.from(fixture.video,'base64')});
    await page.waitForFunction(()=>!document.querySelector('#project-editor input[type=file]')?.disabled);await page.waitForTimeout(500);
    await page.getByLabel('Dodaj / zamijeni naslovnicu',{exact:true}).nth(i).setInputFiles({name:'private-holiday-cover-'+i+'.jpg',mimeType:'image/jpeg',buffer:Buffer.from(fixture.cover,'base64')});
    await page.waitForFunction(()=>!document.querySelector('#project-editor input[type=file]')?.disabled);await page.waitForTimeout(500);
  }
  const holidayDraft=(await(await context.request.get(origin+'/api/draft')).json()).document.projects.find(p=>p.id==='holiday-house-the-view');
  assert.equal(holidayDraft.status,'draft');assert(holidayDraft.videos.every(v=>v.src&&v.poster));
  assert(!(await publicData()).projects.some(p=>p.id==='holiday-house-the-view'));
  const outsider=await browser.newContext({ignoreHTTPSErrors:true});
  assert.equal((await outsider.request.get(origin+'/api/draft')).status(),401);
  for(const v of holidayDraft.videos)assert.equal((await outsider.request.get(origin+v.src)).status(),401);
  await outsider.close();
  for(const lang of ['HR','EN']){await page.getByRole('button',{name:'Pregled '+lang,exact:true}).click();assert.equal(await page.locator('.project-preview-dialog video').count(),3);await page.getByRole('button',{name:'Zatvori pregled',exact:true}).click();}


  await page.locator('[data-edit-project="legacy-1"]').click();
  await page.getByRole('button',{name:'Dodaj gotov video umjesto najave',exact:true}).click();
  assert.equal(await page.locator('#project-editor fieldset').count(),2);
  await page.getByRole('button',{name:'Spremi nacrt',exact:true}).click();await page.waitForTimeout(500);
  const convertedDraft=(await(await context.request.get(origin+'/api/draft')).json()).document.projects.find(p=>p.id==='legacy-1');
  assert.equal(convertedDraft.videos.length,2);assert.equal(convertedDraft.upcoming.hr,'');assert.equal(convertedDraft.videos[1].src,'');
  assert.equal((await publicData()).projects.find(p=>p.id==='legacy-1').videos.length,1);
  await page.locator('[data-edit-project="legacy-3"]').click();await page.getByRole('button',{name:'↑ Gore',exact:true}).click();
  for(const lang of ['HR','EN']){await page.getByRole('button',{name:'Pregled '+lang,exact:true}).click();await page.getByRole('button',{name:'Zatvori pregled',exact:true}).click();}
  await page.getByRole('button',{name:'Objavi odabrani projekt',exact:true}).click();await page.waitForTimeout(500);
  const reordered=(await publicData()).projects.filter(p=>p.legacySlot).sort((a,b)=>a.order-b.order);
  assert.deepEqual(reordered.map(p=>p.id),['legacy-3','legacy-1','legacy-2','legacy-5','legacy-4']);
  assert.equal(reordered.find(p=>p.id==='legacy-1').videos.length,1,'Reordering must not publish another brand unfinished video');

  await page.getByText('Upravljaj kategorijama',{exact:true}).click();await page.getByRole('button',{name:'＋ Nova kategorija',exact:true}).click();
  const categoryRow=page.locator('#project-editor details .project-fields').last();await categoryRow.getByLabel('Naziv HR',{exact:true}).fill('Probna industrija');await categoryRow.getByLabel('Naziv EN',{exact:true}).fill('Test industry');
  await page.getByText('Upravljaj kategorijama',{exact:true}).click();
  await page.getByRole('button',{name:'＋ Novi projekt',exact:true}).click();
  await page.getByLabel('Javni naziv klijenta / brenda',{exact:true}).fill('Privatni probni brend');await page.getByLabel('Prikaži naziv klijenta',{exact:true}).selectOption('no');
  await page.getByLabel('Privatni naziv brenda (ne objavljuje se)',{exact:true}).fill('SECRET-CONTRACT');
  await page.getByLabel('Naslov projekta — HR',{exact:true}).fill('Probni projekt');await page.getByLabel('Naslov projekta — EN',{exact:true}).fill('Test project');
  await page.getByLabel('Kratak opis — HR',{exact:true}).fill('Privatna probna najava.');await page.getByLabel('Kratak opis — EN',{exact:true}).fill('Private test announcement.');
  await page.getByLabel('Industrija',{exact:true}).selectOption({label:'Probna industrija'});await page.getByLabel('Stanje nakon objave',{exact:true}).selectOption('comingSoon');
  await page.getByRole('button',{name:'Spremi nacrt',exact:true}).click();await page.waitForTimeout(1400);
  let draft=(await(await context.request.get(origin+'/api/draft')).json()).document;let project=draft.projects.find(p=>p.title.hr==='Probni projekt');assert(project);const id=project.id;
  assert(!(await publicData()).projects.some(p=>p.id===id));
  await page.getByRole('button',{name:'Objavi odabrani projekt',exact:true}).click();assert(!(await publicData()).projects.some(p=>p.id===id));
  async function previews(){for(const lang of ['HR','EN']){await page.getByRole('button',{name:'Pregled '+lang,exact:true}).click();await page.getByRole('button',{name:'Zatvori pregled',exact:true}).click();}}
  await previews();await page.getByRole('button',{name:'Objavi odabrani projekt',exact:true}).click();await page.waitForTimeout(300);
  assert((await publicData()).projects.some(p=>p.id===id&&p.status==='comingSoon'));assert(!JSON.stringify(await publicData()).includes('SECRET-CONTRACT'));assert(!JSON.stringify(await publicData()).includes('Privatni probni brend'));
  await page.getByRole('button',{name:'＋ Dodaj video ili poveznicu',exact:true}).click();
  await page.getByLabel('Dodaj / zamijeni originalni video',{exact:true}).setInputFiles({name:'private-test.webm',mimeType:'video/webm',buffer:Buffer.from(fixture.video,'base64')});
  await page.waitForFunction(()=>!document.querySelector('#project-editor input[type=file]')?.disabled);
  await page.waitForTimeout(500);
  await page.getByLabel('Dodaj / zamijeni naslovnicu',{exact:true}).setInputFiles({name:'private-test.jpg',mimeType:'image/jpeg',buffer:Buffer.from(fixture.cover,'base64')});await page.waitForFunction(()=>!document.querySelector('#project-editor input[type=file]')?.disabled);await page.waitForTimeout(500);
  draft=(await(await context.request.get(origin+'/api/draft')).json()).document;project=draft.projects.find(p=>p.id===id);assert(project.videos[0].src&&project.videos[0].poster,JSON.stringify({video:project.videos[0],status:await page.locator('#project-editor p[role=status]').innerText(),global:await page.locator('#editor-status').innerText()}));
  const file=project.videos[0].src,manifest=await isolated.get('media/'+file.slice(7));const chunks=[];for(let i=1;i<=Math.ceil(manifest.size/manifest.partSize);i++)chunks.push(Buffer.from(await isolated.get('parts/'+manifest.id+'/'+i,{type:'arrayBuffer'})));assert.deepEqual(Buffer.concat(chunks),Buffer.from(fixture.video,'base64'),'Uploaded original video bytes changed');
  const anonymous=await browser.newContext({ignoreHTTPSErrors:true});assert.equal((await anonymous.request.get(origin+file)).status(),401);
  await page.getByLabel('Naslov videa — HR',{exact:true}).fill('Probni video');await page.getByLabel('Naslov videa — EN',{exact:true}).fill('Test video');await page.getByLabel('Jezik videa',{exact:true}).selectOption('hr');await page.getByLabel('Stanje nakon objave',{exact:true}).selectOption('published');
  await page.getByRole('button',{name:'Pregled HR',exact:true}).click();await page.locator('.project-preview-dialog .video-start').click();
  await page.waitForFunction(()=>{const v=document.querySelector('.project-preview-dialog video');return v&&v.videoWidth===180&&v.videoHeight===320;});
  await page.getByRole('button',{name:'Zatvori pregled',exact:true}).click();
  await page.getByRole('button',{name:'Pregled EN',exact:true}).click();assert.match(await page.locator('.project-preview-dialog').innerText(),/Croatian-language content/);await page.getByRole('button',{name:'Zatvori pregled',exact:true}).click();
  await page.getByRole('button',{name:'Objavi odabrani projekt',exact:true}).click();await page.waitForTimeout(300);
  let pub=await publicData();assert.equal(pub.projects.filter(p=>p.id===id).length,1);assert.equal(pub.projects.find(p=>p.id===id).status,'published');assert(pub.categories.some(c=>c.hr==='Probna industrija'&&c.en==='Test industry'));assert.equal((await anonymous.request.get(origin+file,{headers:{range:'bytes=0-31'}})).status(),206);
  await page.getByLabel('Kratak opis — HR',{exact:true}).fill('Uređeni privatni nacrt.');await page.getByRole('button',{name:'Spremi nacrt',exact:true}).click();await page.waitForTimeout(300);assert.equal((await publicData()).projects.find(p=>p.id===id).description.hr,'Privatna probna najava.');
  await page.getByLabel('Stanje nakon objave',{exact:true}).selectOption('archived');await page.getByRole('button',{name:'Objavi odabrani projekt',exact:true}).click();await page.waitForTimeout(300);assert(!(await publicData()).projects.some(p=>p.id===id));assert.equal((await anonymous.request.get(origin+file)).status(),401);
  const preserved=(await isolated.get('state')).draft.document;assert.deepEqual(preserved.texts,baseline.texts);assert.deepEqual(preserved.photos,baseline.photos);assert.deepEqual(preserved.collaborations,baseline.collaborations);assert.equal(preserved.email,baseline.email);
  assert.deepEqual(await primary.get('state'),originalState);assert.equal(primary.writes,originalWrites);assert.deepEqual(errors,[]);
  console.log(JSON.stringify({viewport,fiveOriginalVideosPreserved:true,filtersAndLanguages:true,privateDraft:true,HRandENPreviewRequired:true,comingSoonConvertedWithSameId:true,uploadBytesUnchanged:true,privateVideoProtected:true,categoryCreation:true,verticalVideoPlayback:true,productionStoreUntouched:true}));
  await anonymous.close();await context.close();await new Promise(r=>server.close(r));
 }
}finally{await browser.close();}
