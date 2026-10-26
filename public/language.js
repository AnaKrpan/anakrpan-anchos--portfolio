(function(root){
  const group=document.querySelector('.language-switch');
  if(!group)return;
  const editingPage=location.pathname==='/uredi';
  group.hidden=editingPage;
  const normalise=value=>{const template=document.createElement('template');template.innerHTML=String(value);return template.content.textContent.replace(/\s+/g,' ').replace(/([.!?])\s*/g,'$1 ').trim();};
  const translations=new Map((root.PortfolioEnglishTranslations||[]).filter(([hr])=>normalise(hr)).map(([hr,en])=>[normalise(hr),en]));
  const translate=value=>translations.get(normalise(value));
  let language=!editingPage&&new URL(location.href).searchParams.get('lang')==='en'?'en':'hr';
  let entries=[],originalTitle=document.title,originalDescription='';
  const ignored=el=>el?.closest('script,style,#editor-panel,.video-edit-tools,.collaboration-controls,.language-switch');
  function capture(){
    entries=[];originalTitle=document.title;originalDescription=document.querySelector('meta[name="description"]').content;
    document.querySelectorAll('[data-edit]').forEach(el=>{entries.push({node:el,type:'html',original:el.innerHTML,english:translate(el.innerHTML)});});
    const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
    while(walker.nextNode()){
      const node=walker.currentNode;if(ignored(node.parentElement)||node.parentElement?.closest('[data-edit]'))continue;
      const english=translate(node.nodeValue);if(english!==undefined)entries.push({node,type:'text',original:node.nodeValue,english:node.nodeValue.match(/^\s*/)[0]+english.trim()+node.nodeValue.match(/\s*$/)[0]});
    }
    document.querySelectorAll('[alt],[aria-label],[title]').forEach(el=>{
      if(ignored(el))return;
      for(const attr of ['alt','aria-label','title'])if(el.hasAttribute(attr)){
        const value=el.getAttribute(attr),english=translate(value);if(english!==undefined)entries.push({node:el,type:attr,original:value,english});
      }
    });
    document.querySelectorAll('a[data-email-link]').forEach(el=>{
      const href=el.getAttribute('href'),url=new URL(href,location.href);
      if(url.searchParams.has('subject')){url.searchParams.set('subject','Collaboration enquiry');entries.push({node:el,type:'href',original:href,english:url.href});}
    });
  }
  function write(entry,value){
    if(entry.type==='html')entry.node.innerHTML=value;
    else if(entry.type==='text')entry.node.nodeValue=value;
    else entry.node.setAttribute(entry.type,value);
  }
  function restore(){
    entries.forEach(entry=>write(entry,entry.original));document.title=originalTitle;
    document.querySelector('meta[name="description"]').content=originalDescription;document.documentElement.lang='hr';
  }
  function syncDialog(){
    const dialog=document.querySelector('#image-dialog');if(!dialog?.open)return;
    const image=dialog.querySelector('img'),card=[...document.querySelectorAll('.gallery-item')].find(card=>card.querySelector('img')?.src===image.src);
    if(card){image.alt=card.querySelector('img').alt;document.querySelector('#dialog-title').textContent=card.querySelector('.card-label span').textContent;}
  }
  function render(){
    restore();
    if(language==='en'){
      entries.forEach(entry=>{if(entry.english!==undefined)write(entry,entry.english);});
      document.title=translate(originalTitle)||originalTitle;
      document.querySelector('meta[name="description"]').content=translate(originalDescription)||originalDescription;
      document.documentElement.lang='en';
    }
    group.querySelectorAll('button').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.language===language)));
    syncDialog();
  }
  function setLanguage(next){
    if(editingPage||!['hr','en'].includes(next))return;
    language=next;render();const url=new URL(location.href);
    if(next==='en')url.searchParams.set('lang','en');else url.searchParams.delete('lang');
    history.replaceState(history.state,'',url.pathname+url.search+url.hash);
  }
  group.querySelectorAll('button').forEach(button=>button.addEventListener('click',()=>setLanguage(button.dataset.language)));
  root.PortfolioLanguage={
    get language(){return language;},
    setLanguage,
    hasTranslation:value=>!normalise(value)||translations.has(normalise(value)),
    beforeDocument(){restore();},
    afterDocument(){capture();render();},
    withCroatian(callback){const previous=language;restore();language='hr';try{return callback();}finally{language=previous;render();}}
  };
  capture();render();
})(globalThis);
