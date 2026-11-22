import '../../../public/project-model.js';
const M=globalThis.PortfolioProjectModel;
export function upgradeProjects(doc){
  const result=M.upgrade(doc);
  if(!Array.isArray(doc.projects)){
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
  return result;
}
