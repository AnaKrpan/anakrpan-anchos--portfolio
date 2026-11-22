import '../../../public/project-model.js';
const M=globalThis.PortfolioProjectModel;
export function upgradeProjects(doc){
  const result=M.upgrade(doc);
  if(!result.projects.some(p=>p.id==='holiday-house-the-view')){
  const {emptyProject,emptyVideo,pair}=M;
    const holiday=emptyProject();Object.assign(holiday,{id:'holiday-house-the-view',client:'Holiday House The View',category:'travel',featured:true,order:-1,title:pair('Jedna lokacija. Tri kreativna pristupa.','One Location. Three Creative Approaches.'),description:pair('Tri različita kreativna pristupa predstavljanju istog turističkog smještaja – od estetske prezentacije prostora, preko promotivnog UGC videa na engleskom jeziku, do autentičnog influencer iskustva.','Three creative approaches to showcasing one holiday property – from an aesthetic visual tour and an English-language UGC promotional video to authentic influencer storytelling.'),location:pair('Međimurje, Hrvatska','Međimurje, Croatia')});
    holiday.videos=[['UGC promotivni video','UGC Promotional Video','en',['UGC','Voiceover']],['Estetski prikaz smještaja','Aesthetic Property Showcase','none',['Aesthetic Showcase']],['Influencer iskustvo i recenzija','Influencer Experience & Review','hr',['Influencer Marketing']]].map(([hr,en,language,tags])=>({...emptyVideo(),title:pair(hr,en),language,types:tags}));
  result.projects.push(holiday);
  }
  if(!result.jewelryDraftPrepared){
    if(!result.projects.some(p=>p.id==='jewelry-accessories')){
      const p=M.emptyProject();
      Object.assign(p,{id:'jewelry-accessories',client:'',hideClient:true,category:'jewelry',order:Math.max(5,...result.projects.filter(p=>p.status==='published').map(p=>p.order+1)),title:M.pair('Nakit i modni dodaci','Jewelry & Accessories'),description:M.pair('Influencer video s nakitom i modnim dodacima.','An influencer video featuring jewelry and accessories.')});
      p.videos=[{...M.emptyVideo(),title:M.pair('Influencer video — nakit','Influencer Video — Jewelry'),types:['Influencer Marketing']}];
      result.projects.push(p);
    }
    result.jewelryDraftPrepared=true;
  }
  if(!result.barkodeDraftPrepared){
    const existing=result.projects.find(p=>p.id==='barkode'||p.client?.trim().toLowerCase()==='barkode'||/^barkode\b/i.test(p.title?.hr||''));
    if(!existing){
      const p=M.emptyProject();
      Object.assign(p,{id:'barkode',client:'Barkode',category:'pets',order:Math.max(6,...result.projects.filter(p=>p.status!=='comingSoon').map(p=>p.order+1)),title:M.pair('Barkode – Influencer & Affiliate suradnja','Barkode – Influencer & Affiliate Collaboration'),description:M.pair('Promotivni video nastao u sklopu influencer i affiliate suradnje s brendom Barkode, koji nudi dodatke prehrani i proizvode za njegu pasa. Sadržaj se temelji na autentičnom predstavljanju proizvoda, osobnom iskustvu i preporuci publici.','Promotional video created as part of an influencer and affiliate collaboration with Barkode, a brand offering supplements and care products for dogs. The content focuses on authentic product presentation, personal experience and audience recommendations.')});
      p.videos=[{...M.emptyVideo(),title:M.pair('Barkode – Influencer & Affiliate suradnja','Barkode – Influencer & Affiliate Collaboration'),types:['Influencer Marketing','Affiliate Marketing']}];
      result.projects.push(p);
    }
    result.barkodeDraftPrepared=true;
  }
  return result;
}
