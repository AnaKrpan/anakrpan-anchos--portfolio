import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import '../public/project-model.js';
import {createPortfolio} from '../netlify/edge-functions/lib/server.js';
import {previewStore} from '../netlify/edge-functions/lib/preview-store.js';
import {upgradeProjects} from '../netlify/edge-functions/lib/project-seeds.js';
const M=globalThis.PortfolioProjectModel;
const baseline=JSON.parse(await readFile(new URL('./fixtures/language-content.json',import.meta.url))).document;
class Store{
  values=new Map();n=0;writes=0;
  async get(key){return structuredClone(this.values.get(key)?.data??null);}
  async getWithMetadata(key){return structuredClone(this.values.get(key)??null);}
  async getMetadata(key){return this.values.has(key)?{etag:this.values.get(key).etag}:null;}
  async setJSON(key,data,options={}){const old=this.values.get(key);if(options.onlyIfNew&&old||options.onlyIfMatch&&old?.etag!==options.onlyIfMatch)return {modified:false};this.writes++;this.values.set(key,{data:structuredClone(data),etag:String(++this.n)});return {modified:true};}
  async set(key,data){return this.setJSON(key,data);}
  async delete(){throw Error('Originals must not be deleted');}
}
async function fixture(){
  const store=new Store();await store.setJSON('state',{published:{document:baseline,revision:91},draft:{document:structuredClone(baseline),revision:0}});
  for(const src of M.refs(baseline))await store.setJSON('media/'+src.slice(7),{backend:'r2',objectKey:'originals/'+src.slice(7),size:10,type:src.endsWith('.jpg')?'image/jpeg':'video/mp4'});
  const app=createPortfolio({store,password:'test-password-long-enough',initialDocument:baseline,projectsEnabled:true,log:()=>{}});
  const login=await app.fetch(new Request('https://site.test/api/login',{method:'POST',headers:{origin:'https://site.test'},body:JSON.stringify({password:'test-password-long-enough'})}));const cookie=login.headers.get('set-cookie').split(';')[0];
  const request=(path,{body,method='GET',owner=true,origin='https://site.test'}={})=>app.fetch(new Request('https://site.test'+path,{method,headers:{...(owner?{cookie}:{}),origin,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}));
  return {store,app,request};
}
async function review(p,languages=['hr','en']){const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(M.reviewPayload(p))));p.reviewed={digest:[...bytes].map(b=>b.toString(16).padStart(2,'0')).join(''),languages};}
test('legacy migration retains five exact video sources, covers, all photographs, biography and comments',()=>{
  const original=structuredClone(baseline),doc=upgradeProjects(original);
  assert.deepEqual(original,baseline);assert.deepEqual(doc.videos,baseline.videos);assert.deepEqual(doc.photos,baseline.photos);assert.deepEqual(doc.texts,baseline.texts);assert.deepEqual(doc.collaborations,baseline.collaborations);
  const imported=doc.projects.filter(p=>p.legacySlot);assert.equal(imported.length,5);assert.deepEqual(imported.map(p=>p.videos[0].src),baseline.videos.map(v=>v.src));assert(imported.every(p=>p.videos[0].poster.endsWith('-first-frame.jpg')));
  assert.equal(doc.phone,'+385 91 151 3866');assert.equal(doc.projects.filter(p=>p.status==='comingSoon').length,2);assert(doc.projects[0].upcoming.hr);
  const holiday=doc.projects.find(p=>p.id==='holiday-house-the-view');assert.equal(holiday.status,'draft');assert.equal(holiday.videos.length,3);assert(holiday.videos.every(v=>!v.src));
  assert(!M.publicDocument(doc).projects.some(p=>p.id===holiday.id));
});
test('projects and grouped videos are not restricted to five slots',()=>{
  const doc=M.upgrade(baseline),project=structuredClone(doc.projects[0]);project.id='many-videos';delete project.legacySlot;project.videos=Array.from({length:12},(_,i)=>({...structuredClone(project.videos[0]),id:'video-'+i}));
  doc.projects.push(project,...Array.from({length:10},()=>M.emptyProject()));assert.doesNotThrow(()=>M.validate(doc));assert.equal(doc.projects.find(p=>p.id==='many-videos').videos.length,12);
});
test('private project, brand, raw draft video and cover stay inaccessible until reviewed publication',async()=>{
  const f=await fixture(),response=await f.request('/api/draft'),draft=await response.json(),doc=draft.document;
  const p=M.emptyProject();Object.assign(p,{title:M.pair('Privatni projekt','Private project'),client:'Tajni brend',privateClient:'Privatni ugovor',hideClient:true,description:M.pair('Opis','Description'),category:'pets',status:'published'});
  const src='/media/'+crypto.randomUUID()+'.mp4',poster='/media/'+crypto.randomUUID()+'.jpg';p.videos=[{...M.emptyVideo(),src,poster}];
  await f.store.setJSON('media/'+src.slice(7),{backend:'r2',objectKey:'originals/private.mp4',size:12});await f.store.setJSON('media/'+poster.slice(7),{size:12});doc.projects.push(p);
  assert.equal((await f.request('/api/draft',{method:'PUT',body:{document:doc,revision:0}})).status,200);
  let publicText=await(await f.request('/api/content',{owner:false})).text();assert(!publicText.includes('Privatni projekt')&&!publicText.includes(src));
  assert.equal((await f.request(src,{owner:false})).status,401);assert.equal((await f.request(poster,{owner:false})).status,401);assert.equal((await f.request('/api/draft',{owner:false})).status,401);
  assert.equal((await f.request('/api/projects/publish',{method:'POST',body:{id:p.id,revision:1},owner:false})).status,401);
  assert.equal((await f.request('/api/projects/publish',{method:'POST',body:{id:p.id,revision:1}})).status,400);
  await review(p,['hr']);assert.equal((await f.request('/api/draft',{method:'PUT',body:{document:doc,revision:1}})).status,200);
  assert.equal((await f.request('/api/projects/publish',{method:'POST',body:{id:p.id,revision:2}})).status,400);
  await review(p);assert.equal((await f.request('/api/draft',{method:'PUT',body:{document:doc,revision:2}})).status,200);
  const published=await f.request('/api/projects/publish',{method:'POST',body:{id:p.id,revision:3}});assert.equal(published.status,200,await published.text());
  publicText=await(await f.request('/api/content',{owner:false})).text();assert(publicText.includes('Privatni projekt')&&publicText.includes(src));assert(!publicText.includes('Tajni brend')&&!publicText.includes('Privatni ugovor')&&!publicText.includes('reviewed'));
  const stored=await f.store.get('state');assert.deepEqual(stored.draft.document.photos,baseline.photos);assert.deepEqual(stored.published.document.texts,baseline.texts);assert([...f.store.values.keys()].some(k=>k.startsWith('history/')));
});
test('Coming Soon becomes a finished project with the same id; unrelated drafts are not published',async()=>{
  const f=await fixture(),draft=await(await f.request('/api/draft')).json(),doc=draft.document;
  const p=doc.projects.find(p=>p.id==='upcoming-biljarica'),id=p.id;await review(p);
  await f.request('/api/draft',{method:'PUT',body:{document:doc,revision:0}});assert.equal((await f.request('/api/projects/publish',{method:'POST',body:{id,revision:1}})).status,200);
  p.status='published';p.videos=[structuredClone(doc.projects[0].videos[0])];p.videos[0].id='finished';await review(p);
  await f.request('/api/draft',{method:'PUT',body:{document:doc,revision:1}});assert.equal((await f.request('/api/projects/publish',{method:'POST',body:{id,revision:2}})).status,200);
  const pub=(await(await f.request('/api/content',{owner:false})).json()).document;assert.equal(pub.projects.filter(p=>p.id===id).length,1);assert.equal(pub.projects.find(p=>p.id===id).status,'published');assert(!pub.projects.some(p=>p.id==='holiday-house-the-view'));
});
test('unsafe links, missing media, changed previews, cross-origin publication and old-editor overwrites are rejected',async()=>{
  const f=await fixture(),doc=(await(await f.request('/api/draft')).json()).document,p=M.emptyProject();Object.assign(p,{title:M.pair('Test','Test'),category:'pets',status:'published',videos:[{...M.emptyVideo(),kind:'link',src:'javascript:alert(1)'}]});doc.projects.push(p);await review(p);
  await f.request('/api/draft',{method:'PUT',body:{document:doc,revision:0}});assert.equal((await f.request('/api/projects/publish',{method:'POST',body:{id:p.id,revision:1}})).status,400);
  assert.equal((await f.request('/api/projects/publish',{method:'POST',origin:'https://evil.test',body:{id:p.id,revision:1}})).status,403);
  p.videos[0].src='https://example.com/video';await review(p);p.title.hr='Promijenjeno nakon pregleda';await f.request('/api/draft',{method:'PUT',body:{document:doc,revision:1}});
  assert.equal((await f.request('/api/projects/publish',{method:'POST',body:{id:p.id,revision:2}})).status,400);
  assert.equal((await f.request('/api/draft',{method:'PUT',body:{document:baseline,revision:2}})).status,409);
});
test('preview writes are isolated; fallback can only read previously public media',async()=>{
  const primary=new Store(),isolated=new Store();await primary.setJSON('state',{published:{document:baseline,revision:91},draft:{document:{secret:'PRIVATE-DRAFT'},revision:99}});
  const source=M.refs(baseline)[0];await primary.setJSON('media/'+source.slice(7),{size:9});await primary.setJSON('media/99999999-9999-4999-8999-999999999999.jpg',{secret:true});
  const writes=primary.writes,adapter=await previewStore(primary,isolated);assert(!JSON.stringify(await adapter.get('state')).includes('PRIVATE-DRAFT'));
  await adapter.setJSON('state',{previewOnly:true});assert.equal(primary.writes,writes);assert.equal((await primary.get('state')).draft.document.secret,'PRIVATE-DRAFT');
  assert.deepEqual(await adapter.get('media/'+source.slice(7)),{size:9});assert.equal(await adapter.get('media/99999999-9999-4999-8999-999999999999.jpg'),null);
  assert.equal(adapter.publicMediaURL(source),'https://anakrpan-anchos-potrfolio.netlify.app'+source);
  assert.equal(adapter.publicMediaURL('/media/99999999-9999-4999-8999-999999999999.jpg'),null);
});

test('changing an imported project also requires fresh HR and EN reviews',async()=>{
  const f=await fixture(),doc=(await(await f.request('/api/draft')).json()).document,p=doc.projects[0];
  p.title.hr='Izmijenjeni naslov';p.title.en='Updated title';p.needsReview=true;
  await f.request('/api/draft',{method:'PUT',body:{document:doc,revision:0}});
  assert.equal((await f.request('/api/projects/publish',{method:'POST',body:{id:p.id,revision:1}})).status,400);
  await review(p);await f.request('/api/draft',{method:'PUT',body:{document:doc,revision:1}});
  assert.equal((await f.request('/api/projects/publish',{method:'POST',body:{id:p.id,revision:2}})).status,200);
});

test('private project seed is not embedded in browser scripts',async()=>{
  const browserModel=await readFile(new URL('../public/project-model.js',import.meta.url),'utf8');
  assert(!browserModel.includes('Holiday House The View'));
  const f=await fixture(),publicBody=await(await f.request('/api/content',{owner:false})).text();
  assert(!publicBody.includes('Holiday House The View'));
  assert((await(await f.request('/api/draft')).text()).includes('Holiday House The View'));
});

test('jewelry is a private bilingual seed, survives upgrades and follows finished brands',async()=>{
  const upgraded=upgradeProjects(baseline),jewelry=upgraded.projects.find(p=>p.id==='jewelry-accessories');
  assert.equal(jewelry.status,'draft');assert.equal(jewelry.client,'');assert.equal(jewelry.category,'jewelry');
  assert(jewelry.title.hr&&jewelry.title.en&&jewelry.description.hr&&jewelry.description.en);
  assert.deepEqual(jewelry.videos[0].types,['Influencer Marketing']);assert.equal(jewelry.videos[0].src,'');
  assert(jewelry.order>Math.max(...upgraded.projects.filter(p=>p.legacySlot).map(p=>p.order)));
  assert.equal(upgradeProjects(upgraded).projects.filter(p=>p.id===jewelry.id).length,1);
  const stored=structuredClone(upgraded);stored.projects.find(p=>p.id===jewelry.id).title.hr='Vlastiti naslov';
  assert.equal(upgradeProjects(stored).projects.find(p=>p.id===jewelry.id).title.hr,'Vlastiti naslov');
  const oldProjects=M.upgrade(baseline);assert(upgradeProjects(oldProjects).projects.some(p=>p.id===jewelry.id));
  const f=await fixture(),pub=await(await f.request('/api/content',{owner:false})).text(),draft=await(await f.request('/api/draft')).json();
  assert(!pub.includes('jewelry-accessories'));assert(draft.document.projects.some(p=>p.id===jewelry.id));
  const categories=[...draft.document.categories].sort((a,b)=>a.order-b.order);
  assert.equal(categories[0].id,'travel');assert.equal(categories[0].hr,'Smještaj i putovanja');
});

test('Barkode seed adds Affiliate Marketing without replacing existing Holiday or jewelry data',()=>{
  const existing=upgradeProjects(baseline);
  existing.projects=existing.projects.filter(p=>p.id!=='barkode');delete existing.barkodeDraftPrepared;
  const holiday=existing.projects.find(p=>p.id==='holiday-house-the-view'),jewelry=existing.projects.find(p=>p.id==='jewelry-accessories');
  holiday.description=M.pair('Moj spremljeni opis','My saved description');
  holiday.videos[0].src=baseline.videos[0].src;holiday.videos[1].src=baseline.videos[1].src;
  jewelry.description=M.pair('Moje naušnice','My earrings');jewelry.videos[0].src=baseline.videos[2].src;
  const before=structuredClone(existing.projects),upgraded=upgradeProjects(existing);
  for(const p of before)assert.deepEqual(upgraded.projects.find(next=>next.id===p.id),p);
  const barkode=upgraded.projects.find(p=>p.id==='barkode');
  assert.equal(barkode.status,'draft');assert.equal(barkode.category,'pets');assert.equal(barkode.videos[0].src,'');
  assert.deepEqual(barkode.videos[0].types,['Influencer Marketing','Affiliate Marketing']);
  assert.equal(barkode.title.hr,'Barkode – Influencer & Affiliate suradnja');
  assert.equal(barkode.title.en,'Barkode – Influencer & Affiliate Collaboration');
  assert(M.types.includes('Affiliate Marketing'));assert.doesNotThrow(()=>M.validate(upgraded));
  assert(!M.publicDocument(upgraded).projects.some(p=>p.id===barkode.id));
  const manuallyCreated=structuredClone(existing),manual=M.copy(barkode);manual.id='owner-barkode';manual.description.hr='Vlastiti opis';
  manuallyCreated.projects.push(manual);
  const reused=upgradeProjects(manuallyCreated);assert.equal(reused.projects.filter(p=>p.client==='Barkode').length,1);
  assert.equal(reused.projects.find(p=>p.id==='owner-barkode').description.hr,'Vlastiti opis');
});

test('only the empty generated Barkode duplicate is retired; completed work and every other project remain exact',()=>{
  const doc=upgradeProjects(baseline),finished=M.copy(doc.projects.find(p=>p.id==='barkode'));
  finished.id='owner-finished-barkode';finished.videos[0].src=baseline.videos[0].src;
  finished.description.hr='Moj gotovi Barkode rad';doc.projects.push(finished);
  const untouched=structuredClone(doc.projects.filter(p=>p.id!=='barkode'));
  const result=upgradeProjects(doc);
  assert.equal(result.projects.find(p=>p.id==='barkode').status,'archived');
  assert.equal(result.projects.find(p=>p.id==='barkode').retiredEmptyBarkodeTemplate,true);
  for(const p of untouched)assert.deepEqual(result.projects.find(next=>next.id===p.id),p);
  assert.deepEqual(M.refs(result),M.refs(doc));
  const uploaded=structuredClone(doc);uploaded.projects.find(p=>p.id==='barkode').videos[0].src=baseline.videos[1].src;
  assert.deepEqual(upgradeProjects(uploaded).projects.find(p=>p.id==='barkode'),uploaded.projects.find(p=>p.id==='barkode'));
  const alone=upgradeProjects(baseline);assert.equal(alone.projects.find(p=>p.id==='barkode').status,'draft');
});

test('reopening preview storage never attempts another initialization write and state reads remain fresh after edits',async()=>{
  const primary=new Store(),isolated=new Store();
  await primary.setJSON('state',{published:{document:baseline,revision:91},draft:{document:baseline,revision:99}});
  await previewStore(primary,isolated);
  let attempts=0;const setJSON=isolated.setJSON.bind(isolated);isolated.setJSON=async(...args)=>{attempts++;return setJSON(...args);};
  const adapter=await previewStore(primary,isolated);assert.equal(attempts,0);
  assert.equal((await adapter.getWithMetadata('state',{type:'json'})).data.published.revision,91);
  await adapter.setJSON('state',{published:{revision:92}});
  assert.equal((await adapter.get('state',{type:'json'})).published.revision,92);
  await previewStore(primary,isolated);assert.equal(attempts,1);
});

test('three replacement slots unlink only requested sources, retain every other field, archive originals and never detach new uploads twice',()=>{
  const doc=upgradeProjects(baseline),holiday=doc.projects.find(p=>p.id==='holiday-house-the-view'),barkode=doc.projects.find(p=>p.id==='barkode'),jewelry=doc.projects.find(p=>p.id==='jewelry-accessories');
  holiday.videos.forEach((v,i)=>v.src=baseline.videos[i].src);
  barkode.videos[0].src=baseline.videos[3].src;jewelry.videos[0].src=baseline.videos[4].src;
  const before=M.copy(doc),result=M.prepare1080ReplacementSlots(doc),after=result.document;
  assert.deepEqual(doc,before);assert.equal(result.targets.length,3);
  assert.deepEqual(after.projects.find(p=>p.id===holiday.id).videos[0],holiday.videos[0]);
  assert.deepEqual(after.projects.find(p=>p.id===holiday.id).videos[2],holiday.videos[2]);
  const selected=new Set(result.targets.map(t=>t.projectId+':'+t.videoId));
  for(const p of before.projects){
    const expected=M.copy(p);expected.videos.forEach(v=>{if(selected.has(p.id+':'+v.id))v.src='';});
    assert.deepEqual(after.projects.find(next=>next.id===p.id),expected);
  }
  assert.deepEqual(after.originalVideoReplacements.archive.map(t=>t.before.src),[holiday.videos[1].src,barkode.videos[0].src,jewelry.videos[0].src]);
  after.projects.find(p=>p.id===holiday.id).videos[1].src='/media/99999999-9999-4999-8999-999999999999.mp4';
  assert(M.prepare1080ReplacementSlots(after).alreadyApplied);
  assert.equal(M.prepare1080ReplacementSlots(after).document.projects.find(p=>p.id===holiday.id).videos[1].src,'/media/99999999-9999-4999-8999-999999999999.mp4');
  assert.deepEqual(M.publicDocument(after).originalVideoReplacements,{applied:true});
  const ambiguous=M.copy(doc),duplicate=M.copy(barkode);duplicate.id='another-barkode';ambiguous.projects.push(duplicate);
  assert.throws(()=>M.prepare1080ReplacementSlots(ambiguous),/jednoznačno/);assert.deepEqual(ambiguous.projects.find(p=>p.id===holiday.id),holiday);
});
