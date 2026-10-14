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
  if (!response.ok) { const error = new Error(data.error || 'Spremanje nije uspjelo.'); error.status = response.status; throw error; }
  return data;
}
function setSaveButton() { exportButton.disabled = !!saving || publishing || pendingFiles > 0 || !canEdit; exportButton.textContent = publishing ? 'Objavljujem…' : saving ? 'Spremam nacrt…' : 'Spremi i objavi'; }
async function saveChanges() {
  if (saving) return saving;
  if (!canEdit) return;
  if (!dirty) { if (!pendingFiles) message('Sve izmjene su već spremljene na istoj adresi.'); return; }
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
      if (!pendingFiles) message('Nacrt je spremljen. Posjetitelji vide prethodnu objavljenu verziju dok ne klikneš „Spremi i objavi”.');
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
let uploadQueue = Promise.resolve();
const unfinishedUploads = new Map();
async function requestUploadPart(path, options, report) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);
    try { return await requestJSON(path, {...options, signal:controller.signal}); }
    catch (error) {
      const retryable = !error.status || [408,429,500,502,503,504].includes(error.status);
      if (!retryable || attempt === 3) throw error;
      report('Veza je zapela. Ponavljam ovaj dio videa…');
      await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
    } finally { clearTimeout(timeout); }
  }
}
function uploadFile(file, type, report = message) {
  const transfer = async () => {
    const fileKey = [file.name || '',file.size,file.lastModified || 0,type].join(':');
    let state = unfinishedUploads.get(fileKey);
    if (!state) {
      report('Počinjem učitavanje…');
      const created = await requestJSON('/api/media/start', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type,size:file.size})});
      state = {created,parts:[],verified:0}; unfinishedUploads.set(fileKey,state);
    }
    const created = state.created;
    try {
      const parts = state.parts, partSize = created.partSize || 512*1024;
      for (let offset = parts.length*partSize, part = parts.length+1; offset < file.size; offset += partSize, part++) {
        const result = await requestUploadPart('/api/media/part?id='+encodeURIComponent(created.id)+'&part='+part, {method:'PUT',headers:{'content-type':'application/octet-stream'},body:file.slice(offset,offset+partSize)}, report);
        parts.push(result);
        report('Učitano: ' + Math.round(Math.min(offset+partSize,file.size)/file.size*100) + ' %');
      }
      for (let offset = state.verified; offset < parts.length;) {
        report('Video je prenesen. Provjeravam spremanje: ' + Math.round(offset/parts.length*100) + ' %…');
        const result = await requestUploadPart('/api/media/complete', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:created.id,offset,parts:parts.slice(offset,offset+64)})}, report);
        if (result.url) { unfinishedUploads.delete(fileKey); return result; }
        if (!result.continue || !Number.isInteger(result.nextPart) || result.nextPart <= offset || result.nextPart >= parts.length) throw new Error('Provjera datoteke nije završena. Pokušaj ponovno.');
        offset = result.nextPart; state.verified = offset;
      }
      throw new Error('Spremanje videa nije završeno.');
    } catch (error) {
      if ([404,410].includes(error.status)) unfinishedUploads.delete(fileKey);
      throw new Error(error.message + ' Ostavi ovu karticu otvorenu i ponovno odaberi istu datoteku da nastaviš učitavanje.');
    }
  };
  report('Datoteka čeka svoj red za učitavanje…');
  const task = uploadQueue.then(transfer);
  uploadQueue = task.catch(() => {});
  return task;
}
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
    pendingFiles++; setSaveButton();
    try {
      const byExt={mp4:'video/mp4',mov:'video/quicktime',webm:'video/webm',m4v:'video/x-m4v',ogv:'video/ogg'};
      const type=byExt[(file.name.split('.').pop()||'').toLowerCase()] || file.type;
      const result=await uploadFile(file,type,report);
      if (videoEpochs.get(slot)!==epoch) return;
      video.pause(); video.src=result.url; video.hidden=false; video.load(); card.querySelector('.video-placeholder').hidden=true;
      card.dataset.mediaName=file.name; markDirty(); await saveChanges(); progress.textContent='Video je učitan. Klikni „Spremi i objavi” za javnu objavu.';
    } catch (error) { report(error.message+' Prethodni video i ostale izmjene su zadržani.'); }
    finally { pendingFiles--; setSaveButton(); if (dirty && !pendingFiles) saveChanges(); }
  });
  card.querySelector('.remove-video').addEventListener('click',() => {
    videoEpochs.set(slot,(videoEpochs.get(slot)||0)+1);
    video.pause(); video.removeAttribute('src'); video.load(); video.hidden=true;
    card.querySelector('.video-placeholder').hidden=false; delete card.dataset.mediaName; markDirty();
  });
  video.addEventListener('play',() => document.querySelectorAll('video').forEach(other => {if(other!==video)other.pause();}));
  video.addEventListener('error',() => {if(editing)message('Preglednik ne može reproducirati ovaj video. Pokušaj MP4 s H.264 kodiranjem. Spremljeni tekst nije obrisan.');});
});
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
    message('Objavljeno! Svatko tko otvori tvoj javni link vidi ove izmjene.');
    document.querySelector('#draft-status').textContent='Objavljeno: '+new Date(result.updatedAt).toLocaleTimeString('hr-HR')+'. Link ostaje isti.';
  }catch(error){message(error.message+' Tvoj nacrt je zadržan.');}
  finally{publishing=false;setSaveButton();}
});
document.addEventListener('input',event => {if(editing&&(event.target.closest('[data-edit]')||event.target.closest('.editor-fields')))markDirty();});
window.addEventListener('beforeunload',event => {if(dirty||pendingFiles||saving){event.preventDefault();event.returnValue='';}});
const draftReady = (async () => {
  document.querySelector('#start-edit').hidden=true;
  try {
    const [session,content]=await Promise.all([requestJSON('/api/session'),requestJSON(location.pathname==='/uredi'?'/api/draft':'/api/content')]);
    if(content.document)applyDocument(content.document);
    revision=content.revision;canEdit=session.canEdit;
    document.querySelector('#start-edit').hidden=!canEdit;
    document.querySelector('#owner-signin').hidden=canEdit;
    globalNotice.hidden=true; setSaveButton();
    if(canEdit && location.pathname==='/uredi')setEditing(true);
  } catch(error) {
    globalNotice.hidden=false;globalNotice.textContent='Spremljeni portfolio nije moguće učitati: '+error.message+' Osvježi stranicu i pokušaj ponovno.';
  }
})();

PortfolioCollaborations.init({onChange: () => markDirty(), message});

document.querySelector('#sign-out').addEventListener('click',async()=>{if(dirty||pendingFiles){message('Prvo spremi izmjene i pričekaj da učitavanje završi.');return;}try{await requestJSON('/api/logout',{method:'POST'});location.href='/';}catch(error){message(error.message);}});
