import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import '../public/project-model.js';
import {createPortfolio} from '../netlify/edge-functions/lib/server.js';
import {previewStore} from '../netlify/edge-functions/lib/preview-store.js';
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
  const original=structuredClone(baseline),doc=M.upgrade(original);
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
});

test('changing an imported project also requires fresh HR and EN reviews',async()=>{
  const f=await fixture(),doc=(await(await f.request('/api/draft')).json()).document,p=doc.projects[0];
  p.title.hr='Izmijenjeni naslov';p.title.en='Updated title';p.needsReview=true;
  await f.request('/api/draft',{method:'PUT',body:{document:doc,revision:0}});
  assert.equal((await f.request('/api/projects/publish',{method:'POST',body:{id:p.id,revision:1}})).status,400);
  await review(p);await f.request('/api/draft',{method:'PUT',body:{document:doc,revision:1}});
  assert.equal((await f.request('/api/projects/publish',{method:'POST',body:{id:p.id,revision:2}})).status,200);
});
