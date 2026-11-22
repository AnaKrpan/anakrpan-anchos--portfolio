(function(root){
  const M=root.PortfolioProjectModel;
  function mount(container,options){
    let doc,currentId='',busy=0;const status=document.createElement('p');status.setAttribute('role','status');
    const toolbar=document.createElement('div');toolbar.className='project-toolbar';
    const list=document.createElement('div');list.className='project-edit-list';const form=document.createElement('div');form.className='project-edit-form';
    const categories=document.createElement('details');const summary=document.createElement('summary');summary.textContent='Upravljaj kategorijama';categories.append(summary);const categoryFields=document.createElement('div');categories.append(categoryFields);
    container.append(toolbar,status,list,form,categories);
    const dialog=document.createElement('dialog');dialog.className='project-preview-dialog';dialog.setAttribute('aria-label','Privatni pregled projekta');
    const close=document.createElement('button');close.type='button';close.textContent='Zatvori pregled';const previewInfo=document.createElement('p');const previewRoot=document.createElement('div');previewRoot.className='projects-grid';previewRoot.dataset.projectUi='';dialog.append(close,previewInfo,previewRoot);document.body.append(dialog);
    close.addEventListener('click',()=>dialog.close());dialog.addEventListener('close',()=>previewRoot.querySelectorAll('video').forEach(v=>v.pause()));
    const previewGallery=PortfolioProjectGallery.mount(previewRoot,null);
    function message(value){status.textContent=value;options.message?.(value);}
    function button(label,action,parent=toolbar){const b=document.createElement('button');b.type='button';b.textContent=label;b.addEventListener('click',()=>Promise.resolve().then(action).catch(e=>message(e.message)));parent.append(b);return b;}
    function changed(project){if(project){delete project.reviewed;project.needsReview=true;}options.change();renderList();options.refresh();}
    function field(parent,label,value,set,{type='text',choices}={}){
      const wrap=document.createElement('label');wrap.textContent=label;
      const input=document.createElement(choices?'select':type==='textarea'?'textarea':'input');
      if(choices){for(const [id,title] of choices){const option=document.createElement('option');option.value=id;option.textContent=title;input.append(option);}}
      else if(type!=='textarea')input.type=type;
      input.setAttribute('aria-label',label);input.value=value??'';input.addEventListener(choices?'change':'input',()=>set(input.value));wrap.append(input);parent.append(wrap);return input;
    }
    function bilingual(parent,label,value,set){field(parent,label+' — HR',value?.hr||'',v=>set('hr',v),{type:'textarea'});field(parent,label+' — EN',value?.en||'',v=>set('en',v),{type:'textarea'});}
    function current(){return doc?.projects.find(p=>p.id===currentId);}
    async function digest(project){const data=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(M.reviewPayload(project)));return [...new Uint8Array(data)].map(b=>b.toString(16).padStart(2,'0')).join('');}
    async function preview(lang){
      const p=current();if(!p)return;
      p.reviewed={digest:await digest(p),languages:[...new Set([...(p.reviewed?.digest===await digest(p)?p.reviewed.languages:[]),lang])]};
      options.change();previewInfo.textContent=(lang==='hr'?'Privatni pregled — hrvatski':'Private preview — English')+' · '+(lang==='en'?(p.status==='draft'?'This project is a private draft. It is not published.':'Preview before publishing.'):(p.status==='draft'?'Projekt je nacrt. Nije objavljen.':'Ovo je pregled prije objave.'));close.textContent=lang==='en'?'Close preview':'Zatvori pregled';dialog.setAttribute('aria-label',lang==='en'?'Private project preview':'Privatni pregled projekta');
      previewGallery.render(doc,lang,{preview:true,only:p.id});dialog.showModal();
      message('Pregledano: '+p.reviewed.languages.map(l=>l.toUpperCase()).join(' / ')+'. Izmjena projekta traži novi pregled.');
    }
    async function publish(){
      const p=current();if(!p||busy)return;
      if(p.status==='draft')throw Error('Odaberi Uskoro ili Gotov rad, pa pregledaj projekt na oba jezika.');
      M.validate({...doc,projects:[p]},true);
      if((!p.legacySlot||p.needsReview)&&p.status!=='archived'&&(p.reviewed?.digest!==await digest(p)||!['hr','en'].every(l=>p.reviewed?.languages?.includes(l))))throw Error('Prije objave otvori Pregled HR i Pregled EN za ovu verziju projekta.');
      const saved=await options.save();if(saved===false)throw Error('Prvo dovrši spremanje nacrta.');
      const result=await options.publish(p.id);message(result.sandbox?'Objavljeno samo u probnom okruženju. Javna stranica nije promijenjena.':'Projekt je objavljen na postojećem javnom linku.');renderList();
    }
    button('＋ Novi projekt',()=>{if(!doc||busy)return;const p=M.emptyProject();p.order=doc.projects.length;doc.projects.push(p);currentId=p.id;changed(p);renderForm();});
    button('Spremi nacrt',async()=>{if(busy)return;const saved=await options.save();if(saved!==false)message('Privatni nacrt spremljen. Nove izmjene još nisu objavljene.');});
    button('Pregled cijele galerije',()=>options.fullPreview?.());
    button('Galerija HR',()=>options.fullPreview?.('hr'));button('Galerija EN',()=>options.fullPreview?.('en'));
    button('Pregled HR',()=>preview('hr'));button('Pregled EN',()=>preview('en'));button('Objavi odabrani projekt',publish);
    function renderList(){
      list.replaceChildren();if(!doc)return;
      for(const p of [...doc.projects].sort((a,b)=>a.order-b.order)){
        const b=button((p.title.hr||p.client||'Novi projekt')+' · '+({draft:'nacrt',published:'gotov rad',comingSoon:'uskoro',archived:'uklonjen iz prikaza'}[p.status]),()=>{if(busy)return;currentId=p.id;renderForm();renderList();},list);
        b.setAttribute('aria-pressed',String(p.id===currentId));b.dataset.editProject=p.id;
      }
    }
    async function upload(file,video,poster=false){
      if(!file||busy)return;const p=current();if(!p)return;busy++;container.querySelectorAll('input[type=file]').forEach(input=>input.disabled=true);message(poster?'Spremam naslovnicu…':'Prenosim originalni video…');
      try{
        let target=file,type=file.type;
        if(poster){target=await PortfolioPhotos.preparePhoto(file);type=target.type;}
        else{const extension=file.name.split('.').pop().toLowerCase();type={mp4:'video/mp4',mov:'video/quicktime',m4v:'video/x-m4v',webm:'video/webm',ogv:'video/ogg'}[extension]||type;if(!type.startsWith('video/'))throw Error('Odaberi video datoteku.');}
        const result=await options.upload(target,type,message);
        if(poster)video.poster=result.url;else{video.src=result.url;video.kind='file';video.originalName=file.name;}
        changed(p);const saved=await options.save();if(saved===false)throw Error('Datoteka je prenesena, ali nacrt nije spremljen. Pritisni Spremi nacrt prije zatvaranja.');message(poster?'Naslovnica spremljena u privatni nacrt.':'Video spremljen bez dodatne kompresije. Pregledaj projekt prije objave.');
      }finally{busy--;renderForm();}
    }
    function renderForm(){
      form.replaceChildren();const p=current();if(!p){form.textContent='Odaberi projekt ili pritisni Novi projekt.';return;}
      const h=document.createElement('h3');h.textContent=p.title.hr||'Novi projekt';form.append(h);
      const note=document.createElement('p');note.textContent='Sve izmjene najprije su privatni nacrt. Status se javno mijenja tek nakon gumba Objavi.';form.append(note);
      const fields=document.createElement('div');fields.className='project-fields';form.append(fields);
      field(fields,'Javni naziv klijenta / brenda',p.client,v=>{p.client=v;changed(p);});
      field(fields,'Privatni naziv brenda (ne objavljuje se)',p.privateClient||'',v=>{p.privateClient=v;changed(p);});
      field(fields,'Prikaži naziv klijenta',p.hideClient?'no':'yes',v=>{p.hideClient=v==='no';changed(p);},{choices:[['yes','Da'],['no','Ne — koristi samo naslov projekta']]});
      bilingual(fields,'Naslov projekta',p.title,(lang,v)=>{p.title[lang]=v;changed(p);});
      bilingual(fields,'Kratak opis',p.description,(lang,v)=>{p.description[lang]=v;changed(p);});
      bilingual(fields,'Lokacija (opcionalno)',p.location||M.pair(),(lang,v)=>{p.location??=M.pair();p.location[lang]=v;changed(p);});
      field(fields,'Industrija',p.category,v=>{p.category=v;changed(p);},{choices:[['','Odaberi kategoriju'],...doc.categories.map(c=>[c.id,c.hr])]});
      field(fields,'Stanje nakon objave',p.status,v=>{p.status=v;changed(p);},{choices:[['draft','Nacrt — privatno'],['comingSoon','Uskoro / Coming Soon'],['published','Gotov rad'],['archived','Uklonjen iz javnog prikaza']]});
      field(fields,'Prikaži na',p.visibility,v=>{p.visibility=v;changed(p);},{choices:[['both','HR i EN'],['hr','Samo HR'],['en','Samo EN']]});
      field(fields,'Istaknuti projekt',p.featured?'yes':'no',v=>{p.featured=v==='yes';changed(p);},{choices:[['no','Ne'],['yes','Da']]});
      bilingual(fields,'Najava dodatnog videa unutar projekta',p.upcoming||M.pair(),(lang,v)=>{p.upcoming??=M.pair();p.upcoming[lang]=v;changed(p);});
      if(p.upcoming?.hr||p.upcoming?.en)button('Dodaj gotov video umjesto najave',()=>{
        if(busy)return;
        const video=M.emptyVideo();p.videos.push(video);p.upcoming=M.pair();changed(p);renderForm();
        message('Dodaj gotov video i naslovnicu u novo mjesto. Promjena ostaje privatni nacrt do pregleda i objave.');
      },form);
      const coverLabel=document.createElement('label');coverLabel.textContent='Naslovnica projekta / najave (opcionalno)';
      const coverInput=document.createElement('input');coverInput.type='file';coverInput.accept='image/jpeg,image/png,image/webp';coverInput.disabled=busy>0;
      coverInput.addEventListener('change',()=>upload(coverInput.files[0],{set poster(url){p.cover=url;}},true).catch(e=>message(e.message)));
      coverLabel.append(coverInput);form.append(coverLabel);
      if(p.cover){const cover=document.createElement('img');cover.src=p.cover;cover.alt='Naslovnica projekta';cover.className='project-cover-check';form.append(cover);}
      const order=document.createElement('div');order.className='project-toolbar';form.append(order);
      function move(delta){const sorted=[...doc.projects].sort((a,b)=>a.order-b.order),i=sorted.findIndex(x=>x.id===p.id),j=i+delta;if(j<0||j>=sorted.length)return;[sorted[i],sorted[j]]=[sorted[j],sorted[i]];sorted.forEach((item,n)=>item.order=n);changed(p);renderList();}
      button('↑ Gore',()=>move(-1),order);button('↓ Dolje',()=>move(1),order);
      button('Ukloni iz prikaza',()=>{if(busy)return;if(confirm('Ukloniti projekt iz prikaza? Datoteke ostaju sačuvane.')){p.status='archived';changed(p);renderForm();}},order);
      p.videos.forEach((v,i)=>{
        const section=document.createElement('fieldset');const legend=document.createElement('legend');legend.textContent='Video '+(i+1);section.append(legend);form.append(section);
        const vf=document.createElement('div');vf.className='project-fields';section.append(vf);
        bilingual(vf,'Naslov videa',v.title,(lang,value)=>{v.title[lang]=value;changed(p);});
        field(vf,'Vrsta izvora',v.kind,value=>{v.kind=value;changed(p);},{choices:[['file','Video datoteka'],['link','Poveznica']]});
        field(vf,'Poveznica ili spremljena adresa videa',v.src,value=>{v.src=value;changed(p);});
        field(vf,'Jezik videa',v.language,value=>{v.language=value;changed(p);},{choices:[['other','Još nije označeno / drugi jezik'],['hr','Hrvatski'],['en','Engleski'],['none','Bez govora']]});
        field(vf,'Prikaz videa',v.visibility,value=>{v.visibility=value;changed(p);},{choices:[['both','HR i EN'],['hr','Samo HR'],['en','Samo EN']]});
        const types=document.createElement('div');types.className='project-type-options';section.append(types);
        M.types.forEach(type=>{const label=document.createElement('label'),check=document.createElement('input');check.type='checkbox';check.checked=v.types.includes(type);check.addEventListener('change',()=>{v.types=check.checked?[...v.types,type]:v.types.filter(t=>t!==type);changed(p);});label.append(check,document.createTextNode(type));types.append(label);});
        const files=document.createElement('div');files.className='project-fields';section.append(files);
        function inputFile(label,accept,handler){const wrap=document.createElement('label');wrap.textContent=label;const input=document.createElement('input');input.type='file';input.setAttribute('aria-label',label);input.accept=accept;input.disabled=busy>0;input.addEventListener('change',()=>handler(input.files[0]).catch(e=>message(e.message)));wrap.append(input);files.append(wrap);}
        inputFile('Dodaj / zamijeni originalni video','video/*',file=>upload(file,v));
        inputFile('Dodaj / zamijeni naslovnicu','image/jpeg,image/png,image/webp',file=>upload(file,v,true));
        if(v.poster){const image=document.createElement('img');image.className='project-cover-check';image.src=v.poster;image.alt='Naslovnica videa '+(i+1);section.append(image);}
        button('↑ Video gore',()=>{if(i>0&&!busy){[p.videos[i-1],p.videos[i]]=[p.videos[i],p.videos[i-1]];changed(p);renderForm();}},section);
        button('↓ Video dolje',()=>{if(i<p.videos.length-1&&!busy){[p.videos[i+1],p.videos[i]]=[p.videos[i],p.videos[i+1]];changed(p);renderForm();}},section);
        button('Ukloni ovaj video iz projekta',()=>{if(!busy&&confirm('Ukloniti video iz projekta? Datoteka ostaje sačuvana.')){p.videos.splice(i,1);changed(p);renderForm();}},section);
      });
      button('＋ Dodaj video ili poveznicu',()=>{if(busy)return;p.videos.push(M.emptyVideo());changed(p);renderForm();},form);
    }
    function renderCategories(){
      categoryFields.replaceChildren();if(!doc)return;
      for(const c of [...doc.categories].sort((a,b)=>a.order-b.order)){
        const row=document.createElement('div');row.className='project-fields';categoryFields.append(row);
        field(row,'Naziv HR',c.hr,v=>{c.hr=v;changed();});field(row,'Naziv EN',c.en,v=>{c.en=v;changed();});
        button('↑',()=>{const sorted=[...doc.categories].sort((a,b)=>a.order-b.order),i=sorted.findIndex(x=>x.id===c.id);if(i>0){[sorted[i-1],sorted[i]]=[sorted[i],sorted[i-1]];sorted.forEach((v,n)=>v.order=n);changed();renderCategories();}},row);
        button('Ukloni praznu kategoriju',()=>{if(doc.projects.some(p=>p.category===c.id&&p.status!=='archived'))throw Error('Prvo premjesti projekte iz ove kategorije.');doc.categories=doc.categories.filter(x=>x.id!==c.id);changed();renderCategories();renderForm();},row);
      }
      button('＋ Nova kategorija',()=>{doc.categories.push({id:'category-'+crypto.randomUUID(),hr:'Nova kategorija',en:'New category',order:doc.categories.length});changed();renderCategories();renderForm();},categoryFields);
    }
    return {setDocument(next){doc=next;renderList();renderForm();renderCategories();},busy:()=>busy>0,validatePublish:async()=>{for(const p of doc?.projects||[])if(['published','comingSoon'].includes(p.status)&&(!p.legacySlot||p.needsReview)&&(p.reviewed?.digest!==await digest(p)||!['hr','en'].every(l=>p.reviewed?.languages?.includes(l))))throw Error('Prije zajedničke objave pregledaj HR i EN za: '+p.title.hr);},preview};
  }
  root.PortfolioProjectEditor={mount};
})(globalThis);
