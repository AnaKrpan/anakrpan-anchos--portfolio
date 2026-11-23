import '../../../public/project-model.js';
import {releaseHolidayInfluencer} from './holiday-influencer-release.js';
const M=globalThis.PortfolioProjectModel;
export const RELEASE_ID='portfolio-projects-2026-11-23';
const options={type:'json',consistency:'strong'};
function publicReady(doc){
  const out=M.publicDocument(M.upgrade(doc));
  for(const p of out.projects)if(p.status==='published')p.videos=p.videos.filter(v=>v.src);
  M.validate(out,true);
  if(!out.projects.some(p=>p.id==='holiday-house-the-view'&&p.status==='published'))throw Error('Approved Holiday project is not published in the review store');
  return out;
}
function references(doc){
  return new Set([...M.refs(doc),...(doc?.originalVideoReplacements?.archive||[]).flatMap(item=>[item.before?.src,item.before?.poster])].filter(src=>/^\/media\/[a-f0-9-]{36}\.[a-z0-9]+$/.test(src)));
}
function approvedDocument(state,approveAddedProjects){
  if(!approveAddedProjects)return {document:state.published.document,draft:state.draft?structuredClone(state.draft):null};
  if(!state.draft?.document?.projects)throw Error('Approved private review snapshot is missing');
  const draft=structuredClone(state.draft),doc=draft.document;
  const active=doc.projects.filter(p=>p.status!=='archived'&&p.videos?.some(v=>v.src));
  const name=p=>[p.client,p.title?.hr,p.title?.en].join(' ');
  const select=(predicate,label)=>{const matches=active.filter(predicate);if(matches.length!==1)throw Error(label+' is missing or ambiguous');matches[0].status='published';};
  select(p=>p.id==='holiday-house-the-view','Holiday');
  select(p=>/\bbarkode\b/i.test(name(p)),'Barkode');
  select(p=>p.id==='jewelry-accessories'||p.category==='jewelry'||/naušnic|earrings|nakit/i.test(name(p)),'Jewelry');
  return {document:doc,draft};
}
export async function releaseStore(primary,review,{approveAddedProjects=false}={}){

  let current=await primary.getWithMetadata('state',options);
  if(current?.data.projectRelease?.id!==RELEASE_ID){
    const snapshot=await review.getWithMetadata('state',options);
    if(!snapshot?.data.published?.document||(!approveAddedProjects&&!snapshot.data.published.document.projects))throw Error('Review has no published project snapshot');
    const selected=approvedDocument(snapshot.data,approveAddedProjects),doc=publicReady(selected.document),draft=selected.draft;
    if(draft)M.validate(draft.document);
    const publicRefs=references(doc),oldRefs=M.refs(current?.data.published?.document);
    for(const src of oldRefs)if(!publicRefs.has(src))throw Error('Release would omit an existing public file');
    for(const src of publicRefs){
      const key='media/'+src.slice(7);
      if(!await primary.get(key,options)&&!await review.get(key,options))throw Error('A public file is incomplete or missing');
    }
    if((await review.getWithMetadata('state',options))?.etag!==snapshot.etag)throw Error('Review changed during release validation');
    const next={...current?.data,published:{...snapshot.data.published,document:doc},draft,projectRelease:{id:RELEASE_ID,sourceRevision:snapshot.data.published.revision,at:new Date().toISOString()}};
    await primary.setJSON('production-releases/'+RELEASE_ID+'/before/'+encodeURIComponent(current?.etag||'empty'),current?.data||{},{onlyIfNew:true});
    await primary.setJSON('production-releases/'+RELEASE_ID+'/review/'+encodeURIComponent(snapshot.etag),snapshot.data,{onlyIfNew:true});
    const result=await primary.setJSON('state',next,current?{onlyIfMatch:current.etag}:{onlyIfNew:true});
    current=await primary.getWithMetadata('state',options);
    if(!result.modified&&current?.data.projectRelease?.id!==RELEASE_ID)throw Error('Production changed; release was not applied');
  }
  current=await releaseHolidayInfluencer(primary,review,current);
  const allowed=new Set([...references(current.data.published?.document),...references(current.data.draft?.document)].map(src=>src.slice(7)));
  const ids=new Set([...allowed].map(file=>file.split('.')[0]));
  const mayRead=key=>key.startsWith('media/')&&allowed.has(key.slice(6))||key.startsWith('parts/')&&ids.has(key.split('/')[1])||key.startsWith('viewing-copies/')&&allowed.has(key.slice(15));
  let cached=true;
  const take=()=>{cached=false;return structuredClone(current);};
  return {
    release:{id:RELEASE_ID,ready:true,holidayInfluencer:current.data.holidayInfluencerRelease?.status},
    async get(key,opts){if(key==='state'&&cached)return take().data;return await primary.get(key,opts)??(mayRead(key)?review.get(key,opts):null);},
    async getWithMetadata(key,opts){if(key==='state'&&cached)return take();return await primary.getWithMetadata(key,opts)??(mayRead(key)?review.getWithMetadata(key,opts):null);},
    async getMetadata(key){return await primary.getMetadata(key)??(mayRead(key)?review.getMetadata(key):null);},
    setJSON(key,...args){if(key==='state')cached=false;return primary.setJSON(key,...args);},
    set(key,...args){if(key==='state')cached=false;return primary.set(key,...args);},
    delete(key){if(key==='state')cached=false;return primary.delete(key);}
  };
}

