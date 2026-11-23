import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {releaseStore,RELEASE_ID} from '../netlify/edge-functions/lib/release-store.js';
import {upgradeProjects} from '../netlify/edge-functions/lib/project-seeds.js';
const M=globalThis.PortfolioProjectModel,baseline=JSON.parse(await readFile('tests/fixtures/language-content.json','utf8')).document;
class Store{
  values=new Map();n=0;writes=0;
  async get(key){return structuredClone(this.values.get(key)?.data??null);}
  async getWithMetadata(key){return structuredClone(this.values.get(key)??null);}
  async getMetadata(key){const e=this.values.get(key);return e?{etag:e.etag}:null;}
  async setJSON(key,data,options={}){const old=this.values.get(key);if(options.onlyIfNew&&old||options.onlyIfMatch&&options.onlyIfMatch!==old?.etag)return {modified:false};this.writes++;this.values.set(key,{data:structuredClone(data),etag:String(++this.n)});return {modified:true};}
  async set(...args){return this.setJSON(...args);}
  async delete(){throw Error('Release must not delete any data');}
}
async function fixture(approved=true){
  const primary=new Store(),review=new Store(),doc=upgradeProjects(baseline),hh=doc.projects.find(p=>p.id==='holiday-house-the-view');
  hh.status=approved?'published':'draft';hh.videos[0].src=baseline.videos[0].src;hh.videos[0].poster='/viewing-videos/33f0e71d-f955-4d52-b154-dd6ed2a07090-first-frame.jpg';
  hh.videos[1].src=baseline.videos[1].src;hh.videos[1].poster='/viewing-videos/b044c36d-62ae-4771-a9ef-3a294ad4a923-first-frame.jpg';
  const privateProject=doc.projects.find(p=>p.id==='jewelry-accessories');privateProject.privateClient='PRIVATE-CONTRACT';
  privateProject.videos[0].src='/media/88888888-8888-4888-8888-888888888888.mp4';
  await primary.setJSON('state',{published:{document:baseline,revision:91},draft:{document:baseline,revision:100}});
  const publicDoc=M.publicDocument(doc);
  await review.setJSON('state',{published:{document:publicDoc,revision:12},draft:{document:doc,revision:25}});
  for(const src of M.refs(baseline))await primary.setJSON('media/'+src.slice(7),{id:src.slice(7).split('.')[0],size:10,type:'video/mp4'});
  await review.setJSON('media/88888888-8888-4888-8888-888888888888.mp4',{id:'88888888-8888-4888-8888-888888888888',size:10,type:'video/mp4'});
  await review.setJSON('parts/88888888-8888-4888-8888-888888888888/1',[1,2,3]);
  return {primary,review,doc};
}
test('production release copies only marked public work, retains full private slots, backs up state and never alters review files',async()=>{
  const {primary,review,doc}=await fixture(),old=await primary.get('state'),reviewBefore=await review.get('state'),writes=review.writes;
  const adapter=await releaseStore(primary,review),state=await adapter.get('state');
  assert.equal(state.projectRelease.id,RELEASE_ID);assert(!JSON.stringify(state.published).includes('PRIVATE-CONTRACT'));
  assert(!state.published.document.projects.some(p=>p.id==='jewelry-accessories'));
  assert.equal(state.published.document.projects.find(p=>p.id==='holiday-house-the-view').videos.length,2);
  assert.deepEqual(state.draft.document,doc);assert.equal(state.draft.document.projects.find(p=>p.id==='holiday-house-the-view').videos.length,3);
  const backup=[...primary.values.entries()].find(([key])=>key.includes('/before/'));assert.deepEqual(backup[1].data,old);
  assert.equal(review.writes,writes);assert.deepEqual(await review.get('state'),reviewBefore);
  assert.deepEqual(await adapter.get('parts/88888888-8888-4888-8888-888888888888/1'),[1,2,3]);
  assert.equal(await adapter.get('media/99999999-9999-4999-8999-999999999999.mp4'),null);
});
test('release refuses to make Holiday draft public and performs no production writes',async()=>{
  const {primary,review}=await fixture(false),before=primary.writes;
  await assert.rejects(releaseStore(primary,review),/Holiday/);assert.equal(primary.writes,before);
});
test('release applies once and never replaces subsequent production edits with stale preview data',async()=>{
  const {primary,review}=await fixture();await releaseStore(primary,review);
  const current=await primary.get('state');current.draft.document.phone='owner-edited-value';await primary.setJSON('state',current);
  const before=primary.writes;await releaseStore(primary,review);assert.equal(primary.writes,before);assert.equal((await primary.get('state')).draft.document.phone,'owner-edited-value');
});

test('explicit final approval publishes only the three named ready drafts and retains all other drafts privately',async()=>{
  const {primary,review}=await fixture(false),snapshot=await review.get('state'),doc=snapshot.draft.document;
  const barkode=doc.projects.find(p=>p.id==='barkode'),jewelry=doc.projects.find(p=>p.id==='jewelry-accessories');
  barkode.videos[0].src='/media/99999999-9999-4999-8999-999999999999.mp4';
  barkode.videos[0].poster=jewelry.videos[0].poster='/viewing-videos/33f0e71d-f955-4d52-b154-dd6ed2a07090-first-frame.jpg';
  const other=M.emptyProject();other.id='still-private';other.category='pets';other.title=M.pair('Privatni nacrt','Private draft');other.videos=[structuredClone(barkode.videos[0])];doc.projects.push(other);
  await review.setJSON('state',snapshot);await review.setJSON('media/99999999-9999-4999-8999-999999999999.mp4',{size:10,type:'video/mp4'});
  const released=await releaseStore(primary,review,{approveAddedProjects:true}),state=await released.get('state');
  for(const id of ['holiday-house-the-view','barkode','jewelry-accessories'])assert(state.published.document.projects.some(p=>p.id===id&&p.status==='published'));
  assert(!state.published.document.projects.some(p=>p.id===other.id));assert(state.draft.document.projects.some(p=>p.id===other.id));
  assert(state.published.document.projects.some(p=>p.status==='comingSoon'));assert.equal(state.draft.document.projects.find(p=>p.id==='holiday-house-the-view').videos.length,3);
  assert.equal(state.published.document.projects.find(p=>p.id==='holiday-house-the-view').videos.length,2);
});
