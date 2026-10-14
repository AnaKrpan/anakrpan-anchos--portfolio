let editing = false;
let selectedPhoto = null;
let pendingFiles = 0;
const panel = document.querySelector('#editor-panel');
const status = document.querySelector('#editor-status');
const exportButton = document.querySelector('#export-site');
const dialog = document.querySelector('#image-dialog');
const dialogImage = document.querySelector('#dialog-image');
const dialogTitle = document.querySelector('#dialog-title');
function message(text) { status.textContent = text; }
function setEditing(value) {
  editing = value;
  PortfolioCollaborations.syncEditing(value);
  panel.hidden = !value;
  document.body.classList.toggle('editing', value);
  document.querySelectorAll('[data-edit]').forEach(el => {
    if (value) { el.setAttribute('contenteditable', 'true'); el.setAttribute('spellcheck', 'true'); }
    else { el.removeAttribute('contenteditable'); el.removeAttribute('spellcheck'); }
  });
  if (value) { syncFields(); panel.scrollIntoView({ behavior: 'smooth' }); }
}
function syncFields() {
  document.querySelector('#edit-title').value = document.title;
  document.querySelector('#edit-description').value = document.querySelector('meta[name="description"]').content;
  document.querySelector('#edit-email').value = document.querySelector('#contact-email').textContent;
  document.querySelector('#edit-phone').value = document.querySelector('#contact-phone').textContent;
  const style = getComputedStyle(document.documentElement);
  for (const name of ['paper', 'sand', 'ink']) document.querySelector('#edit-' + name).value = style.getPropertyValue('--' + name).trim();
}
document.querySelector('#start-edit').addEventListener('click', async () => { await draftReady; if(location.pathname!=='/uredi'){location.href='/uredi';return;}setEditing(true); });
document.querySelector('#end-edit').addEventListener('click', () => {location.href='/';});
document.addEventListener('click', event => {
  if (editing && event.target.closest('a[data-edit],a:has([data-edit])')) event.preventDefault();
});
document.querySelector('#edit-title').addEventListener('input', event => { document.title = event.target.value; });
document.querySelector('#edit-description').addEventListener('input', event => { document.querySelector('meta[name="description"]').content = event.target.value; });
document.querySelector('#edit-email').addEventListener('input', event => {
  const email = event.target.value.trim();
  document.querySelector('#contact-email').textContent = email;
  document.querySelectorAll('[data-email-link]').forEach(link => { link.href = 'mailto:' + email + '?subject=Upit%20za%20suradnju'; });
});
document.querySelector('#edit-phone').addEventListener('input', event => {
  const phone = event.target.value;
  const link = document.querySelector('#contact-phone');
  link.textContent = phone;
  link.href = 'tel:' + phone.replace(/[^+\d]/g, '');
});
for (const name of ['paper', 'sand', 'ink']) {
  document.querySelector('#edit-' + name).addEventListener('input', event => {
    document.documentElement.style.setProperty('--' + name, event.target.value);
    if (name === 'sand') document.querySelector('meta[name="theme-color"]').content = event.target.value;
  });
}
document.querySelectorAll('[data-edit]').forEach(el => {
  el.addEventListener('paste', event => {
    if (!editing) return;
    event.preventDefault();
    const selection = window.getSelection();
    if (!selection.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (!el.contains(range.commonAncestorContainer)) return;
    range.deleteContents();
    const text = document.createTextNode(event.clipboardData.getData('text/plain'));
    range.insertNode(text); range.setStartAfter(text); range.collapse(true);
    selection.removeAllRanges(); selection.addRange(range);
  });
});
const photoInput = document.querySelector('#photo-input');
document.querySelectorAll('[data-photo]').forEach(photo => {
  photo.addEventListener('click', event => {
    if (!editing) return;
    event.preventDefault(); event.stopPropagation();
    selectedPhoto = photo;
    const description = document.querySelector('#edit-photo-description');
    description.disabled = false; description.value = photo.alt;
    photoInput.value = ''; photoInput.click();
  });
});
document.querySelector('#edit-photo-description').addEventListener('input', event => { if (selectedPhoto) selectedPhoto.alt = event.target.value; });
photoInput.addEventListener('change', () => {
  const target = selectedPhoto;
  const file = photoInput.files[0]; photoInput.value = '';
  addPhoto(file, target);
});
document.querySelectorAll('.gallery-item').forEach(button => {
  button.addEventListener('click', () => {
    if (editing) return;
    const image = button.querySelector('img');
    dialogImage.src = image.src; dialogImage.alt = image.alt;
    dialogTitle.textContent = button.querySelector('.card-label span').textContent;
    dialog.showModal(); document.body.classList.add('dialog-open');
  });
});
document.querySelector('#close-dialog').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', event => {
  const bounds = dialog.getBoundingClientRect();
  if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
});
dialog.addEventListener('close', () => document.body.classList.remove('dialog-open'));
function captureDraft() {
  return {
    collaborations: PortfolioCollaborations.capture(),
    version: 2, updatedAt: Date.now(), title: document.title,
    description: document.querySelector('meta[name="description"]').content,
    texts: Array.from(document.querySelectorAll('[data-edit]'), el => el.innerHTML),
    photos: Array.from(document.querySelectorAll('[data-photo]'), el => ({ src: el.getAttribute('src'), alt: el.alt })),
    email: document.querySelector('#contact-email').textContent, phone: document.querySelector('#contact-phone').textContent,
    colors: ['paper','sand','ink'].map(name => getComputedStyle(document.documentElement).getPropertyValue('--' + name).trim()),
    videos: Array.from(document.querySelectorAll('[data-video-slot]'), card => ({ slot: card.dataset.videoSlot, key: card.dataset.mediaKey || '', name: card.dataset.mediaName || '', src: (card.querySelector('video').getAttribute('src') || '').replace(/^blob:.*$/, ''), present: !!card.querySelector('video').getAttribute('src') }))
  };
}
function safeTextHTML(value) {
  const template = document.createElement('template'); template.innerHTML = String(value);
  template.content.querySelectorAll('script,style,iframe,object,embed,img,video,audio').forEach(el => el.remove());
  template.content.querySelectorAll('*').forEach(el => {
    if (!['BR','EM','STRONG','SPAN','B','I'].includes(el.tagName)) el.replaceWith(document.createTextNode(el.textContent));
    else Array.from(el.attributes).forEach(attr => el.removeAttribute(attr.name));
  });
  return template.innerHTML;
}
let revision = 0, canEdit = false, dirty = false, serial = 0, saving = null, publishing=false, saveTimer;
const photoEpochs = new WeakMap(), videoEpochs = new Map();
const failedVideoSlots=new Set();
const failedVideoNames=()=>Array.from(failedVideoSlots,slot=>document.querySelector('[data-video-slot="'+slot+'"] .card-label')?.textContent.trim()||slot).join(', ');
let canPrepareOriginals=false;
const globalNotice = document.querySelector('#online-notice');
function markDirty() {
  dirty = true; serial++;
  document.querySelector('#draft-status').textContent = 'Spremam privatni nacrt…';
  clearTimeout(saveTimer); saveTimer = setTimeout(() => saveChanges(), 1200);
}
async function requestJSON(path, options = {}) {
  let response;
  try { response = await fetch(path, { credentials:'same-origin', ...options }); }
  catch (error) { throw new Error(error.name === 'AbortError' ? 'Veza je prespora ili je prekinuta.' : 'Veza sa stranicom je prekinuta.'); }
  let data; try { data = await response.json(); } catch (_) { throw new Error('Veza sa stranicom nije dostupna. Izmjene su zadržane u ovoj kartici.'); }
  if (!response.ok) { const error = new Error(data.error || 'Spremanje nije uspjelo.'); error.status = response.status; error.trace = data.trace; throw error; }
  return data;
}
function setSaveButton() { exportButton.disabled = !!saving || publishing || pendingFiles > 0 || !canEdit; exportButton.textContent = publishing ? 'Objavljujem…' : saving ? 'Spremam nacrt…' : 'Spremi i objavi'; }
async function saveChanges() {
  if (saving) return saving;
  if (!canEdit) return;
  if (!dirty) { if (!pendingFiles&&!failedVideoSlots.size) message('Sve izmjene su već spremljene na istoj adresi.'); return; }
  const savedSerial = serial;
  const snapshot = captureDraft();
  saving = (async () => {
    try {
      let data;
      try { data = await requestJSON('/api/draft', { method:'PUT', headers:{'content-type':'application/json'}, body:JSON.stringify({document:snapshot,revision}) }); }
      catch (error) {
        if (error.status !== 409) throw error;
        const latest = await requestJSON('/api/draft');
        if (JSON.stringify(latest.document) !== JSON.stringify(snapshot)) throw error;
        data = {revision:latest.revision,updatedAt:latest.updatedAt};
      }
      revision = data.revision;
      if (serial === savedSerial) dirty = false;
      document.querySelector('#draft-status').textContent = 'Privatni nacrt spremljen: ' + new Date(data.updatedAt).toLocaleTimeString('hr-HR') + '. Za javnu objavu klikni „Spremi i objavi”.';
      if (!pendingFiles&&!failedVideoSlots.size) message('Nacrt je spremljen. Posjetitelji vide prethodnu objavljenu verziju dok ne klikneš „Spremi i objavi”.');
      if(failedVideoSlots.size)document.querySelector('#draft-status').textContent='Nacrt je spremljen, ali prijenos nije uspio za: '+failedVideoNames()+'. Poruka greške ostaje ispod tog videa.';
      return true;
    } catch (error) {
      message(error.message + ' Nemoj zatvoriti ovu karticu dok spremanje ne uspije.');
      document.querySelector('#draft-status').textContent = 'Izmjene još nisu spremljene online.';
      return false;
    }
  })();
  setSaveButton();
  const result = await saving;
  saving = null; setSaveButton();
  if (result && dirty) { clearTimeout(saveTimer); saveTimer = setTimeout(() => saveChanges(),300); }
  return result;
}
const uploads = PortfolioUploads.createUploader({request:requestJSON});
const uploadFile = (file,type,report=message) => uploads.upload(file,type,report);
async function addPhoto(file,target) {
  if (!file || !target) return;
  const epoch = (photoEpochs.get(target)||0)+1; photoEpochs.set(target,epoch);
  pendingFiles++; setSaveButton(); message('Pripremam i spremam fotografiju…');
  try {
    const photo = await PortfolioPhotos.preparePhoto(file);
    const result = await uploadFile(photo,photo.type);
    if (photoEpochs.get(target)!==epoch) return;
    target.src = result.url; markDirty(); await saveChanges();
  } catch (error) { message(error.message+' Prethodna fotografija je zadržana.'); }
  finally { pendingFiles--; setSaveButton(); if (dirty && !pendingFiles) saveChanges(); }
}
document.querySelectorAll('[data-video-slot]').forEach(card => {
  const video = card.querySelector('video'), slot = card.dataset.videoSlot;
  const progress = document.createElement('p'); progress.setAttribute('role','status'); progress.setAttribute('aria-live','polite'); progress.style.cssText='margin:5px 0;font-size:13px;overflow-wrap:anywhere'; card.querySelector('.video-edit-tools').append(progress);
  const report = text => { progress.textContent = text; message(text); };
  card.querySelector('.video-input').addEventListener('change',async event => {
    const file = event.target.files[0]; event.target.value=''; if (!file) return;
    if (!PortfolioFiles.acceptsVideo(file)) { message('Odaberi video datoteku.'); return; }
    const epoch=(videoEpochs.get(slot)||0)+1; videoEpochs.set(slot,epoch);
    failedVideoSlots.delete(slot);
    pendingFiles++; setSaveButton();
    try {
      const byExt={mp4:'video/mp4',mov:'video/quicktime',webm:'video/webm',m4v:'video/x-m4v',ogv:'video/ogg'};
      const type=byExt[(file.name.split('.').pop()||'').toLowerCase()] || file.type;
      const result=await uploadFile(file,type,report);
      if (videoEpochs.get(slot)!==epoch) return;
      video.pause(); video.src=result.url; video.hidden=false; video.load(); card.querySelector('.video-placeholder').hidden=true;
      card.dataset.mediaName=file.name; markDirty(); const saved = await saveChanges();
      failedVideoSlots.delete(slot);
      progress.textContent = saved === true && !dirty ? 'Video i nacrt su spremljeni. Klikni „Spremi i objavi”.' : 'Video je prenesen, ali nacrt još nije spremljen. Klikni „Spremi i objavi” i pričekaj potvrdu.';
      if(saved===true&&canPrepareOriginals)requestJSON('/api/originals/migrate',{method:'POST'}).catch(()=>{});
    } catch (error) { failedVideoSlots.add(slot); report(error.message+' Prethodni video i ostale izmjene su zadržani.'); }
    finally { pendingFiles--; setSaveButton(); if (dirty && !pendingFiles) saveChanges(); }
  });
  card.querySelector('.remove-video').addEventListener('click',() => {
    videoEpochs.set(slot,(videoEpochs.get(slot)||0)+1);
    video.pause(); video.removeAttribute('src'); video.load(); video.hidden=true;
    card.querySelector('.video-placeholder').hidden=false; delete card.dataset.mediaName; markDirty();
  });
  video.addEventListener('play',() => {video.preload='auto';document.querySelectorAll('video').forEach(other => {if(other!==video){other.pause();other.preload='none';}});});
  video.addEventListener('error',() => {if(editing&&!failedVideoSlots.size)message('Pregled videa se nije pokrenuo. Spremljena datoteka i tekst ostaju sačuvani.');});
});
if('IntersectionObserver' in window){
  const nearVideos=new IntersectionObserver(entries=>{for(const entry of entries){const video=entry.target.querySelector('video');if(entry.isIntersecting&&video.paused)video.preload='metadata';}},{rootMargin:'100px'});
  document.querySelectorAll('[data-video-slot]').forEach(card=>nearVideos.observe(card));
}else document.querySelectorAll('video').forEach(video=>video.preload='metadata');
function applyDocument(doc) {
  PortfolioCollaborations.restore(doc.collaborations);
  document.title=doc.title; document.querySelector('meta[name="description"]').content=doc.description;
  document.querySelectorAll('[data-edit]').forEach((el,i) => {if(typeof doc.texts[i]==='string')el.innerHTML=safeTextHTML(doc.texts[i]);});
  document.querySelectorAll('[data-photo]').forEach((el,i) => {const photo=doc.photos[i];if(photo){el.src=photo.src;el.alt=photo.alt;}});
  document.querySelector('#contact-email').textContent=doc.email;
  document.querySelectorAll('[data-email-link]').forEach(el => el.href='mailto:'+doc.email+'?subject=Upit%20za%20suradnju');
  const phone=document.querySelector('#contact-phone');phone.textContent=doc.phone;phone.href='tel:'+doc.phone.replace(/[^+\d]/g,'');
  ['paper','sand','ink'].forEach((name,i) => document.documentElement.style.setProperty('--'+name,doc.colors[i]));
  document.querySelector('meta[name="theme-color"]').content=doc.colors[1];
  for(const state of doc.videos){
    const card=document.querySelector('[data-video-slot="'+state.slot+'"]');if(!card)continue;
    const video=card.querySelector('video');
    if(state.src){video.src=state.src;video.hidden=false;card.querySelector('.video-placeholder').hidden=true;}
    else{video.removeAttribute('src');video.hidden=true;card.querySelector('.video-placeholder').hidden=false;}
    card.dataset.mediaName=state.name||'';
  }
}
exportButton.addEventListener('click',async () => {
  if(pendingFiles || publishing)return;
  if(revision===0 && !dirty)markDirty();
  const saved=await saveChanges();
  if(saved===false || dirty || saving)return;
  publishing=true;setSaveButton();
  try{
    const result=await requestJSON('/api/publish',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({revision})});
    message(failedVideoSlots.size?'Spremljene izmjene su objavljene, ali prijenos nije uspio za: '+failedVideoNames()+'.':'Objavljeno! Svatko tko otvori tvoj javni link vidi ove izmjene.');
    document.querySelector('#draft-status').textContent='Objavljeno: '+new Date(result.updatedAt).toLocaleTimeString('hr-HR')+'. Link ostaje isti.';
  }catch(error){message(error.message+' Tvoj nacrt je zadržan.');}
  finally{publishing=false;setSaveButton();}
});
document.addEventListener('input',event => {if(editing&&(event.target.closest('[data-edit]')||event.target.closest('.editor-fields')))markDirty();});
window.addEventListener('beforeunload',event => {if(dirty||pendingFiles||saving||uploads.hasInterrupted()){event.preventDefault();event.returnValue='';}});
const draftReady = (async () => {
  document.querySelector('#start-edit').hidden=true;
  try {
    const [session,content]=await Promise.all([requestJSON('/api/session'),requestJSON(location.pathname==='/uredi'?'/api/draft':'/api/content')]);
    if(content.document)applyDocument(content.document);
    revision=content.revision;canEdit=session.canEdit;
    canPrepareOriginals=!!session.canPrepareOriginals;
    document.querySelector('#start-edit').hidden=!canEdit;
    document.querySelector('#owner-signin').hidden=canEdit;
    globalNotice.hidden=true; setSaveButton();
    if(canEdit && location.pathname==='/uredi')setEditing(true);
    if(canEdit && location.pathname==='/uredi' && session.migrationNeeded) {
      // Production-only migration preserves both published and draft documents.
      requestJSON('/api/originals/migrate',{method:'POST'}).then(()=>{
        message('Postojeći originali prenose se u novu pohranu. Možeš nastaviti uređivati; sadržaj ostaje sačuvan.');
        let checks=0;
        const check=async()=>{
          try{
            const progress=await requestJSON('/api/originals/status');
            if(progress.verified===progress.total){
              message('Svi postojeći originali su provjereni i pripremljeni za gledanje. Javni link i sadržaj ostaju isti.');
              document.querySelectorAll('video').forEach(video=>{if(video.paused && video.getAttribute('src'))video.load();});
              return;
            }
            if(progress.paused){message('Kopiranje jednog originala je pauzirano. Stari video je sačuvan. Ponovno otvori uređivanje da nastaviš.');return;}
            if(++checks<90)setTimeout(check,10000);
          }catch(_){if(++checks<90)setTimeout(check,10000);}
        };
        setTimeout(check,10000);
      }).catch(()=>message('Prijenos postojećih originala još nije pokrenut. Prethodni videi i sve izmjene su zadržani.'));
    }
  } catch(error) {
    globalNotice.hidden=false;globalNotice.textContent='Spremljeni portfolio nije moguće učitati: '+error.message+' Osvježi stranicu i pokušaj ponovno.';
  }
})();

PortfolioCollaborations.init({onChange: () => markDirty(), message});

document.querySelector('#sign-out').addEventListener('click',async()=>{if(dirty||pendingFiles){message('Prvo spremi izmjene i pričekaj da učitavanje završi.');return;}try{await requestJSON('/api/logout',{method:'POST'});location.href='/';}catch(error){message(error.message);}});
