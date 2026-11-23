import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {releaseHolidayInfluencer} from '../netlify/edge-functions/lib/holiday-influencer-release.js';
import {upgradeProjects} from '../netlify/edge-functions/lib/project-seeds.js';
const M=globalThis.PortfolioProjectModel;
class Store{
  values=new Map();version=0;writes=0;
  async get(k){return structuredClone(this.values.get(k)?.data??null);}
  async getWithMetadata(k){return structuredClone(this.values.get(k)??null);}
  async setJSON(k,data,o={}){const old=this.values.get(k);if(o.onlyIfNew&&old||o.onlyIfMatch&&old?.etag!==o.onlyIfMatch)return {modified:false};this.writes++;this.values.set(k,{data:structuredClone(data),etag:String(++this.version)});return {modified:true};}
}
async function fixture(){
 const baseline=JSON.parse(await readFile('tests/fixtures/language-content.json','utf8')).document;
 const doc=upgradeProjects(baseline),hh=doc.projects.find(p=>p.id==='holiday-house-the-view');
 hh.status='published';hh.videos[0].src=baseline.videos[0].src;hh.videos[1].src=baseline.videos[1].src;
 for(const v of hh.videos)v.poster='/viewing-videos/33f0e71d-f955-4d52-b154-dd6ed2a07090-first-frame.jpg';
 const video=structuredClone(hh.videos[2]);video.src='/media/77777777-7777-4777-8777-777777777777.mp4';
 const primary=new Store(),review=new Store();
 await primary.setJSON('state',{published:{document:M.publicDocument(doc),revision:91},draft:{document:doc,revision:100}});
 const draft=structuredClone(doc);draft.projects.find(p=>p.id===hh.id).videos[2]=video;
 draft.phone='PRIVATE EDIT MUST NOT PUBLISH';
 await review.setJSON('state',{draft:{document:draft,revision:30}});
 await review.setJSON('media/'+video.src.slice(7),{size:200,type:'video/mp4'});
 return {primary,review,video};
}
test('approved third video is added once; existing public media, descriptions, other projects and private edits remain intact',async()=>{
 const {primary,review,video}=await fixture(),before=await primary.getWithMetadata('state'),reviewBefore=await review.get('state');
 const result=await releaseHolidayInfluencer(primary,review,before),doc=result.data.published.document;
 const oldHH=before.data.published.document.projects.find(p=>p.id==='holiday-house-the-view');
 const hh=doc.projects.find(p=>p.id===oldHH.id);
 assert.deepEqual(hh.videos,[...oldHH.videos,video]);
 assert.deepEqual({...hh,videos:[]},{...oldHH,videos:[]});
 assert.deepEqual(doc.projects.filter(p=>p.id!==hh.id),before.data.published.document.projects.filter(p=>p.id!==hh.id));
 assert.equal(doc.phone,before.data.published.document.phone);
 assert.equal(result.data.published.revision,92);assert.equal(result.data.holidayInfluencerRelease.status,'published');
 assert.equal(result.data.draft.document.projects.find(p=>p.id===hh.id).videos[2].src,video.src);
 assert.deepEqual(await review.get('state'),reviewBefore);
 const backup=[...primary.values.entries()].find(([k])=>k.includes('/before/'));assert.deepEqual(backup[1].data,before.data);
 const writes=primary.writes;await releaseHolidayInfluencer(primary,review,result);assert.equal(primary.writes,writes);
});
test('missing upload does not publish or enable automatic publication of future uploads',async()=>{
 const {primary,review}=await fixture();await review.setJSON('state',{});
 const before=await primary.getWithMetadata('state'),result=await releaseHolidayInfluencer(primary,review,before);
 assert.deepEqual(result.data.published,before.data.published);assert.equal(result.data.holidayInfluencerRelease.status,'not-found');
});
test('incomplete upload leaves production unchanged',async()=>{
 const {primary,review,video}=await fixture();review.values.delete('media/'+video.src.slice(7));
 const before=await primary.getWithMetadata('state');await assert.rejects(releaseHolidayInfluencer(primary,review,before),/complete/);
 assert.deepEqual(await primary.getWithMetadata('state'),before);
});
