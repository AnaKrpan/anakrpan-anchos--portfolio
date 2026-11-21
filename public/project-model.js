(function(root){
  const categories=[
    ['travel','Turizam i smještaj','Travel & Hospitality'],['wellness','Wellness i životni stil','Wellness & Lifestyle'],
    ['beauty','Ljepota, moda i osobna njega','Beauty, Fashion & Personal Care'],['pets','Kućni ljubimci','Pet & Animal Care'],
    ['home','Dom i životni stil','Home & Lifestyle'],['creative','Kreativne i tehnološke usluge','Creative & Technology']
  ].map(([id,hr,en],order)=>({id,hr,en,order}));
  const types=['UGC','Influencer Marketing','Voiceover','Aesthetic Showcase'];
  const copy=value=>JSON.parse(JSON.stringify(value));
  const pair=(hr='',en='')=>({hr,en});
  const mediaPattern=/^\/media\/[a-f0-9-]{36}\.(jpg|png|webp|mp4|mov|m4v|webm|ogv)$/;
  const assetPattern=/^(?:\/?assets\/[a-zA-Z0-9_-]+\.(?:webp|jpg|png)|\/viewing-videos\/[a-f0-9-]{36}(?:-first-frame)?\.jpg)$/;
  const knownIds=['33f0e71d-f955-4d52-b154-dd6ed2a07090','b044c36d-62ae-4771-a9ef-3a294ad4a923','bf80cc54-077f-4878-be58-36d292b58916','14592b90-e095-40f9-a4d4-db27d8313b27','4ee0abc1-3fc0-42e4-aab4-b1485c362f8a'];
  function posterFor(src){const id=(src||'').split('/').pop()?.replace(/\.mp4$/,'');return knownIds.includes(id)?'/viewing-videos/'+id+'-first-frame.jpg':'';}
  function safeLink(src){try{const u=new URL(src);return u.protocol==='https:'&&!u.username&&!u.password;}catch{return false;}}
  function safeSource(src){return /^\/media\/[a-f0-9-]{36}\.(mp4|mov|m4v|webm|ogv)$/.test(src||'')||safeLink(src);}
  function safePoster(src){return !src||/^\/media\/[a-f0-9-]{36}\.(jpg|png|webp)$/.test(src)||assetPattern.test(src);}
  function emptyProject(){return {id:crypto.randomUUID(),client:'',privateClient:'',hideClient:false,title:pair(),description:pair(),category:'',status:'draft',visibility:'both',order:Date.now(),featured:false,cover:'',location:pair(),videos:[],upcoming:pair()};}
  function emptyVideo(){return {id:crypto.randomUUID(),title:pair(),src:'',kind:'file',poster:'',types:[],language:'other',visibility:'both'};}
  function upgrade(doc){
    const result=copy(doc);if(Array.isArray(result.projects))return result;
    result.version=3;result.phone='+385 91 151 3866';result.categories=copy(categories);
    const names=['FLOVA','HERBOXA','PERO','T&T 3D STUDIO','LUIDO PET GEAR'],industries=['wellness','wellness','home','creative','pets'];
    result.projects=(result.videos||[]).filter(v=>v.src).map(v=>{
      const i=Number(v.slot)-1,p=emptyProject();p.id='legacy-'+v.slot;p.legacySlot=v.slot;p.client=names[i]||v.name;p.title=pair(p.client,p.client);p.category=industries[i];p.status='published';p.order=i;
      p.videos=[{...emptyVideo(),id:'legacy-video-'+v.slot,title:pair(p.client,p.client),src:v.src,poster:posterFor(v.src),legacyName:v.name||'',language:'other'}];
      if(v.slot==='1')p.upcoming=pair('Drugi video je u pripremi.','A second video is coming soon.');return p;
    });
    const biljarica=emptyProject();Object.assign(biljarica,{id:'upcoming-biljarica',client:'Biljarica',title:pair('Biljarica','Biljarica'),description:pair('Prirodni kruti šampon i regenerator.','Natural solid shampoo & conditioner.'),category:'beauty',status:'comingSoon',order:100});
    const pet=emptyProject();Object.assign(pet,{id:'upcoming-pet',client:'',hideClient:true,title:pair('Nova suradnja za kućne ljubimce','New pet collaboration'),description:pair('Suradnja u pripremi. Detalji uskoro.','A collaboration in preparation. Details coming soon.'),category:'pets',status:'comingSoon',order:101});
    const holiday=emptyProject();Object.assign(holiday,{id:'holiday-house-the-view',client:'Holiday House The View',category:'travel',featured:true,order:-1,title:pair('Jedna lokacija. Tri kreativna pristupa.','One Location. Three Creative Approaches.'),description:pair('Tri različita kreativna pristupa predstavljanju istog turističkog smještaja – od estetske prezentacije prostora, preko promotivnog UGC videa na engleskom jeziku, do autentičnog influencer iskustva.','Three creative approaches to showcasing one holiday property – from an aesthetic visual tour and an English-language UGC promotional video to authentic influencer storytelling.'),location:pair('Međimurje, Hrvatska','Međimurje, Croatia')});
    holiday.videos=[['UGC promotivni video','UGC Promotional Video','en',['UGC','Voiceover']],['Estetski prikaz smještaja','Aesthetic Property Showcase','none',['Aesthetic Showcase']],['Influencer iskustvo i recenzija','Influencer Experience & Review','hr',['Influencer Marketing']]].map(([hr,en,language,tags])=>({...emptyVideo(),title:pair(hr,en),language,types:tags}));
    result.projects.push(biljarica,pet,holiday);return result;
  }
  function publicDocument(doc){
    const out=copy(doc);if(!out.projects)return out;
    out.projects=out.projects.filter(p=>['published','comingSoon'].includes(p.status)).map(p=>{
      delete p.privateClient;delete p.reviewed;if(p.hideClient)p.client='';
      if(p.status==='comingSoon')p.videos=[];
      return p;
    });
    const allowed=new Set(out.projects.flatMap(p=>p.videos||[]).map(v=>v.src));
    out.videos=(out.videos||[]).map(v=>allowed.has(v.src)?v:{...v,src:'',present:false});return out;
  }
  function refs(doc){return [...new Set([...(doc?.photos||[]).map(p=>p.src),...(doc?.videos||[]).map(v=>v.src),...(doc?.projects||[]).flatMap(p=>[p.cover,...(p.videos||[]).flatMap(v=>[v.src,v.poster])])].filter(src=>typeof src==='string'&&mediaPattern.test(src)))];}
  function visible(p,lang){return p.visibility==='both'||p.visibility===lang;}
  function local(value,lang){return value?.[lang]||'';}
  function reviewPayload(p){const c=copy(p);delete c.reviewed;return JSON.stringify(c);}
  function validate(doc,publish=false){
    if(!doc.projects)return;
    const bad=message=>{throw Object.assign(new Error(message),{status:400});};
    const str=(value,max=20000)=>typeof value==='string'&&value.length<=max;
    const bilingual=value=>value&&str(value.hr)&&str(value.en);
    if(!Array.isArray(doc.projects)||!Array.isArray(doc.categories))bad('Nedostaju projekti ili kategorije.');
    const cats=new Set();for(const c of doc.categories){if(!c||!str(c.id,100)||!c.id||cats.has(c.id)||!str(c.hr,120)||!c.hr.trim()||!str(c.en,120)||!c.en.trim()||!Number.isFinite(c.order))bad('Provjeri kategorije na oba jezika.');cats.add(c.id);}
    const ids=new Set();for(const p of doc.projects){
      if(!p||!str(p.id,100)||!p.id||ids.has(p.id)||!['draft','comingSoon','published','archived'].includes(p.status)||!['hr','en','both'].includes(p.visibility)||!str(p.client,500)||!str(p.privateClient||'',500)||!bilingual(p.title)||!bilingual(p.description)||!bilingual(p.upcoming||pair())||!bilingual(p.location||pair())||!str(p.category,100)||!Number.isFinite(p.order)||!Array.isArray(p.videos)||!safePoster(p.cover))bad('Neispravni podaci projekta.');
      ids.add(p.id);if(p.category&&!cats.has(p.category)&&p.status!=='archived')bad('Odaberi postojeću kategoriju.');
      const vids=new Set();for(const v of p.videos){if(!v||!str(v.id,100)||!v.id||vids.has(v.id)||!bilingual(v.title)||!str(v.src,4096)||!safePoster(v.poster)||!['file','link'].includes(v.kind)||!Array.isArray(v.types)||v.types.some(t=>!types.includes(t))||!['hr','en','none','other'].includes(v.language)||!['hr','en','both'].includes(v.visibility))bad('Provjeri podatke videa.');vids.add(v.id);}
      if(publish&&['published','comingSoon'].includes(p.status)){
        if(!cats.has(p.category)||!p.title.hr.trim()||!p.title.en.trim())bad('Projekt treba kategoriju i naslov na oba jezika.');
        if(Boolean(p.description.hr.trim())!==Boolean(p.description.en.trim()))bad('Dodaj opis na oba jezika.');
        if(p.status==='comingSoon'&&(!p.description.hr.trim()||!p.description.en.trim()))bad('Najava treba kratak opis na oba jezika.');
        if(p.status==='published'&&(!p.videos.length||p.videos.some(v=>!safeSource(v.src))))bad('Gotov projekt mora imati dovršene videe ili ispravne HTTPS poveznice.');
        if(p.status==='published'&&p.videos.some(v=>(v.kind==='file'||/\.(mp4|webm|mov|m4v)(?:[?#]|$)/i.test(v.src))&&!v.poster&&!p.cover))bad('Dodaj naslovnicu za svaki video prije objave.');
      }
    }
  }
  root.PortfolioProjectModel={categories,types,copy,pair,emptyProject,emptyVideo,upgrade,publicDocument,refs,visible,local,reviewPayload,validate,safeLink,safeSource,safePoster};
})(globalThis);
