(function(root){
  const M=root.PortfolioProjectModel;
  function mount(container,filterContainer){
    const cards=new Map(),filterButtons=new Map();let doc,language='hr',selected='all',preview=false;
    const text=(hr,en)=>language==='en'?en:hr;
    function createVideo(v){
      const box=document.createElement('div');box.className='project-video';box.dataset.projectVideo=v.id;
      const frame=document.createElement('div');frame.className='video-frame';box.append(frame);
      const title=document.createElement('p');title.className='project-video-title';const tags=document.createElement('p');tags.className='project-tags';box.append(title,tags);
      const source=v.src||'';let media;
      if(source&&M.safeSource(source)&&(!(v.kind==='link')||/\.(mp4|webm|mov|m4v)(?:[?#]|$)/i.test(source))){
        media=document.createElement('video');media.playsInline=true;media.preload='none';media.setAttribute('aria-label','Portfolio video');frame.append(media);
        root.PortfolioVideoLoading.controller(media).set(source,v.poster||'');
        media.addEventListener('play',()=>document.querySelectorAll('video').forEach(other=>{if(other!==media){other.pause();other.preload='none';}}));
      }else if(source&&M.safeLink(source)){
        const a=document.createElement('a');a.className='project-external';a.href=source;a.target='_blank';a.rel='noopener noreferrer';frame.append(a);
        if(v.poster&&M.safePoster(v.poster)){const image=document.createElement('img');image.src=v.poster;image.alt='';image.loading='lazy';a.append(image);}
        const label=document.createElement('span');a.append(label);media={external:label};
      }else{const missing=document.createElement('p');missing.className='project-missing';frame.append(missing);media={missing};}
      return {box,update(next){title.textContent=M.local(next.title,language);const lang=next.language==='hr'?text('Hrvatski','Croatian-language content'):next.language==='en'?'English':next.language==='none'?text('Bez govora','No speech'):'';tags.textContent=[...next.types,lang].filter(Boolean).join(' · ');if(media.external)media.external.textContent=text('Pogledaj video ↗','Watch video ↗');if(media.missing)media.missing.textContent=text('Video još nije dostavljen.','Video not supplied yet.');}};
    }
    function makeCard(p){
      const element=document.createElement('article');element.className='project-card';element.dataset.projectId=p.id;
      const eyebrow=document.createElement('p');eyebrow.className='project-category';
      const client=document.createElement('p');client.className='project-client';
      const title=document.createElement('h3');title.className='project-title';
      const location=document.createElement('p');location.className='project-location';
      const description=document.createElement('p');description.className='project-description';
      const badge=document.createElement('span');badge.className='project-badge';
      const videos=document.createElement('div');videos.className='project-videos';
      const upcoming=document.createElement('p');upcoming.className='project-upcoming';
      element.append(eyebrow,client,title,location,description,badge,videos,upcoming);
      let signature='',children=[];
      return {element,update(next){
        element.classList.toggle('project-featured',!!next.featured);element.classList.toggle('project-coming',next.status==='comingSoon');
        const category=doc.categories.find(c=>c.id===next.category);eyebrow.textContent=category?.[language]||'';
        client.textContent=next.hideClient?'':next.client;client.hidden=!client.textContent;
        title.textContent=M.local(next.title,language);if(title.textContent===client.textContent)client.hidden=true;
        location.textContent=M.local(next.location,language);location.hidden=!location.textContent;
        description.textContent=M.local(next.description,language);description.hidden=!description.textContent;
        badge.textContent=next.status==='comingSoon'?text('Uskoro','Coming Soon'):next.featured?text('Istaknuti projekt','Featured Project'):'';badge.hidden=!badge.textContent;
        const list=next.status==='comingSoon'?[]:(next.videos||[]).map(v=>({...v,poster:v.poster||next.cover||''}));
        const fingerprint=JSON.stringify(list.map(v=>[v.id,v.src,v.poster,v.kind]));
        if(signature!==fingerprint){children.forEach(c=>c.box.querySelector('video')?.pause());videos.replaceChildren();children=list.map(createVideo);children.forEach(c=>videos.append(c.box));signature=fingerprint;}
        children.forEach((c,i)=>{c.update(list[i]);c.box.hidden=!M.visible(list[i],language);if(c.box.hidden)c.box.querySelector('video')?.pause();});
        upcoming.textContent=M.local(next.upcoming,language);upcoming.hidden=!upcoming.textContent;
        element.hidden=(!M.visible(next,language))||(selected!=='all'&&next.category!==selected);
        if(element.hidden)element.querySelectorAll('video').forEach(v=>v.pause());
      }};
    }
    function render(next,lang='hr',options={}){
      doc=next;language=lang;preview=!!options.preview;
      const projects=doc.projects.filter(p=>options.only?p.id===options.only:['published','comingSoon'].includes(p.status)).sort((a,b)=>Number(b.featured)-Number(a.featured)||(a.status==='comingSoon')-(b.status==='comingSoon')||a.order-b.order);
      const available=new Set(projects.filter(p=>M.visible(p,language)||preview).map(p=>p.category));
      if(selected!=='all'&&!available.has(selected))selected='all';
      if(filterContainer){
        const filters=[{id:'all',hr:'Svi radovi',en:'All Work'},...doc.categories.filter(c=>available.has(c.id)).sort((a,b)=>a.order-b.order)];
        for(const f of filters){let button=filterButtons.get(f.id);if(!button){button=document.createElement('button');button.type='button';button.dataset.category=f.id;button.addEventListener('click',()=>{selected=f.id;render(doc,language,options);});filterButtons.set(f.id,button);filterContainer.append(button);}button.textContent=f[language];button.setAttribute('aria-pressed',String(selected===f.id));button.hidden=false;}
        filterButtons.forEach((button,id)=>{if(!filters.some(f=>f.id===id))button.hidden=true;});
      }
      const ids=projects.map(p=>p.id);
      cards.forEach((card,id)=>{if(!ids.includes(id)){card.element.querySelectorAll('video').forEach(v=>v.pause());card.element.remove();cards.delete(id);}});
      for(const p of projects){let card=cards.get(p.id);if(!card){card=makeCard(p);cards.set(p.id,card);}card.update(p);}
      const current=[...container.children].map(el=>el.dataset.projectId);
      if(JSON.stringify(ids)!==JSON.stringify(current))ids.forEach(id=>container.append(cards.get(id).element));
    }
    return {render};
  }
  root.PortfolioProjectGallery={mount};
})(globalThis);
