import '../../../public/project-model.js';
const M=globalThis.PortfolioProjectModel;
const opts={type:'json',consistency:'strong'};
export const HOLIDAY_RELEASE='holiday-influencer-approved-2026-11-23';
const holiday=doc=>doc?.projects?.find(p=>p.id==='holiday-house-the-view');
const influencer=v=>v.types?.includes('Influencer Marketing')||/influencer/i.test(v.title?.en||'');
// One-time owner-approved addition. Never publish another project's draft edits.
export async function releaseHolidayInfluencer(primary,review,current){
  if(current.data.holidayInfluencerRelease?.id===HOLIDAY_RELEASE)return current;
  const published=holiday(current.data.published?.document);
  if(!published||published.status!=='published')throw Error('Holiday must already be public');
  const snapshot=await review.getWithMetadata('state',opts);
  const existing=new Set(published.videos.map(v=>v.src));
  const sources=[current.data.draft?.document,snapshot?.data.draft?.document,snapshot?.data.published?.document];
  const candidates=new Map();
  for(const doc of sources)for(const video of holiday(doc)?.videos||[]){
    if(video.src&&!existing.has(video.src)&&influencer(video)){
      if(!candidates.has(video.src))candidates.set(video.src,structuredClone(video));
    }
  }
  if(candidates.size>1)throw Error('Conflicting Holiday influencer uploads; no automatic publication');
  const next=structuredClone(current.data);
  let status=published.videos.some(influencer)?'already-published':'not-found';
  if(status!=='already-published'&&candidates.size===1){
    const video=[...candidates.values()][0];
    if(published.videos.some(v=>v.id===video.id))throw Error('Holiday video identity conflict');
    const target=holiday(next.published.document);target.videos.push(video);
    next.published.document=M.publicDocument(next.published.document);
    M.validate(next.published.document,true);
    for(const src of [video.src,video.poster].filter(s=>s?.startsWith('/media/'))){
      if(!await primary.get('media/'+src.slice(7),opts)&&!await review.get('media/'+src.slice(7),opts))throw Error('Holiday upload is not complete');
    }
    const draft=holiday(next.draft?.document);
    if(draft&&!draft.videos.some(v=>v.src===video.src)){
      const slot=draft.videos.findIndex(v=>v.id===video.id&&!v.src);
      if(slot>=0)draft.videos[slot]=structuredClone(video);else draft.videos.push(structuredClone(video));
      delete draft.reviewed;draft.needsReview=true;
      next.draft.revision=(next.draft.revision||0)+1;
    }
    next.published.revision=(next.published.revision||0)+1;
    next.published.updatedAt=new Date().toISOString();status='published';
  }
  if((await review.getWithMetadata('state',opts))?.etag!==snapshot?.etag)throw Error('Review changed during Holiday publication');
  next.holidayInfluencerRelease={id:HOLIDAY_RELEASE,status,at:new Date().toISOString()};
  await primary.setJSON('production-releases/'+HOLIDAY_RELEASE+'/before/'+encodeURIComponent(current.etag),current.data,{onlyIfNew:true});
  const result=await primary.setJSON('state',next,{onlyIfMatch:current.etag});
  const fresh=await primary.getWithMetadata('state',opts);
  if(!result.modified&&fresh?.data.holidayInfluencerRelease?.id!==HOLIDAY_RELEASE)throw Error('Production changed during Holiday publication');
  return fresh;
}
