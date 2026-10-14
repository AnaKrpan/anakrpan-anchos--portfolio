(function (root) {
  const memory = new Map();
  let database;
  function openDatabase() {
    if (database) return database;
    database = new Promise((resolve, reject) => {
      if (!root.indexedDB) { reject(new Error('IndexedDB unavailable')); return; }
      let expired = false;
      const timer = setTimeout(() => { expired = true; reject(new Error('Progress database timed out')); }, 4000);
      const request = root.indexedDB.open('anchos-upload-progress-v1', 1);
      request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains('progress')) request.result.createObjectStore('progress'); };
      request.onerror = () => { clearTimeout(timer); reject(request.error); };
      request.onblocked = () => { clearTimeout(timer); expired = true; reject(new Error('Progress database blocked')); };
      request.onsuccess = () => { clearTimeout(timer); if (expired) { request.result.close(); return; } request.result.onversionchange = () => request.result.close(); resolve(request.result); };
    });
    return database;
  }
  const storage = {
    async get(key) {
      try { const db = await openDatabase(); return await new Promise((resolve, reject) => { const tx = db.transaction('progress', 'readonly'), request = tx.objectStore('progress').get(key); tx.oncomplete = () => resolve(request.result); tx.onabort = tx.onerror = () => reject(tx.error); }); }
      catch (_) { return memory.get(key); }
    },
    async set(key, value) {
      memory.set(key, structuredClone(value));
      try { const db = await openDatabase(); await new Promise((resolve, reject) => { const tx = db.transaction('progress', 'readwrite'); tx.objectStore('progress').put(value, key); tx.oncomplete = resolve; tx.onabort = tx.onerror = () => reject(tx.error); }); } catch (_) { /* The server index can recover progress even when local storage is unavailable. */ }
    },
    async remove(key) {
      memory.delete(key);
      try { const db = await openDatabase(); await new Promise((resolve, reject) => { const tx = db.transaction('progress', 'readwrite'); tx.objectStore('progress').delete(key); tx.oncomplete = resolve; tx.onabort = tx.onerror = () => reject(tx.error); }); } catch (_) {}
    }
  };
  async function fingerprint(file, type) {
    // Read only small samples; never load a multi-GB video into browser memory.
    const head = new Uint8Array(await file.slice(0, 65536).arrayBuffer());
    const tail = new Uint8Array(await file.slice(Math.max(0, file.size - 65536), file.size).arrayBuffer());
    const identity = new TextEncoder().encode(JSON.stringify({ size: file.size, type }));
    const bytes = new Uint8Array(head.length + tail.length + identity.length);
    bytes.set(head); bytes.set(tail, head.length); bytes.set(identity, head.length + tail.length);
    const digest = await root.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
  }
  function createUploader({ request, directRequest = (...args) => root.fetch(...args), storage: progressStorage = storage, report: defaultReport = () => {}, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), attempts = 4 }) {
    let queue = Promise.resolve();
    const interrupted = new Set();
    async function reliable(path, options, report, stage, send = request, timeoutMs = 35000) {
      for (let attempt = 0; attempt < attempts; attempt++) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        try { return await send(path, { ...options, signal: controller.signal }); }
        catch (error) {
          if (error.status && ![408,429,500,502,503,504].includes(error.status) || attempt === attempts - 1) {
            error.stage = stage;
            throw error;
          }
          report(stage + ': veza je zapela. Nastavljam od spremljenog dijela…');
          await sleep(Math.min(15000, 1500 * 2 ** attempt));
        } finally { clearTimeout(timeout); }
      }
    }
    function upload(file, type, report = defaultReport) {
      const transfer = async () => {
        if (!file || file.size < 1) throw new Error('Odabrana datoteka je prazna.');
        if (file.size > 2 * 1024 ** 3) throw new Error('Video je veći od dopuštenih 2 GB.');
        report('Provjeravam izvornu datoteku…');
        const key = await fingerprint(file, type);
        interrupted.add(key);
        const persist = async state => { try { await progressStorage.set(key, state); } catch (_) {} };
        try {
          const created = await reliable('/api/media/start', { method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type,size:file.size,fingerprint:key}) }, report, 'Početak prijenosa');
          if (created.direct) {
            const partSize=created.partSize;
            if (!Number.isInteger(partSize) || partSize < 5*1024*1024 || partSize > 16*1024*1024) throw new Error('Neispravna veličina dijela originala.');
            const status=await reliable('/api/media/status?id='+encodeURIComponent(created.id),{},report,'Provjera izvornog prijenosa');
            if (status.completed && status.url) { await progressStorage.remove(key).catch(()=>{}); interrupted.delete(key); return {url:status.url}; }
            const receipts=new Map((status.receipts || []).map(p=>[p.partNumber,p]));
            const state={created,parts:[...receipts.values()]};
            let sent=0;
            for (let offset=0,part=1;offset<file.size;offset+=partSize,part++) {
              const blob=file.slice(offset,offset+partSize), size=blob.size;
              const digest=new Uint8Array(await root.crypto.subtle.digest('SHA-256',await blob.arrayBuffer()));
              const checksum=root.btoa(String.fromCharCode(...digest));
              const saved=receipts.get(part);
              // Server receipts are authoritative; do not resend confirmed parts.
              if (saved?.size !== size || saved?.checksum !== checksum) {
                const sendPart=async (_path,options)=> {
                  const signed=await request('/api/media/part-url',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:created.id,part,checksum}),signal:options.signal});
                  const target=new URL(signed.url);
                  if (target.protocol !== 'https:' || !/^[a-f0-9]{32}\.r2\.cloudflarestorage\.com$/.test(target.hostname) || signed.headers?.['x-amz-checksum-sha256'] !== checksum) throw new Error('Odredište originala nije potvrđeno.');
                  const response=await directRequest(signed.url,{method:'PUT',headers:signed.headers,body:blob,signal:options.signal,credentials:'omit',redirect:'error'});
                  if (!response.ok) { await response.body?.cancel(); throw Object.assign(new Error('Prijenos originala nije potvrđen ('+response.status+').'),{status:response.status}); }
                  const etag=response.headers.get('etag');
                  await response.body?.cancel();
                  if (!etag) throw new Error('Pohrana nije vratila potvrdu dijela.');
                  return {partNumber:part,size,checksum,etag};
                };
                const receipt=await reliable('',{},report,'Izravni prijenos originala',sendPart,180000);
                receipts.set(part,receipt);
              }
              sent+=size;
              state.parts=[...receipts.values()]; await persist(state);
              report('Preneseno: '+Math.floor(sent/file.size*100)+' %. Izvorna kvaliteta je zadržana.');
            }
            const result=await reliable('/api/media/complete',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:created.id})},report,'Provjera spremljenog originala');
            if (!result.url) throw new Error('Nedostaje potvrda spremljenog originala.');
            await progressStorage.remove(key).catch(()=>{}); interrupted.delete(key); return result;
          }
          let saved; try { saved = await progressStorage.get(key); } catch (_) {}
          const state = saved?.created?.id === created.id && Array.isArray(saved.parts) ? saved : { created, parts:[], verified:0 };
          state.created = created;
          const partSize = created.partSize || 512 * 1024;
          if (created.resumed) {
            report('Pronalazim već spremljene dijelove…');
            // A status read also recovers acknowledgements lost after a server write.
            let offset = Math.min(state.parts.length, Math.ceil(file.size / partSize) - 1);
            if (offset < state.parts.length) state.parts.length = offset;
            for (;;) {
              const status = await reliable('/api/media/status?id='+encodeURIComponent(created.id)+'&offset='+offset, {}, report, 'Nastavak prijenosa');
              if (status.completed && status.url) { await progressStorage.remove(key).catch(() => {}); interrupted.delete(key); return { url:status.url }; }
              state.verified = status.verified || 0;
              for (const receipt of status.receipts || []) {
                if (receipt.partNumber !== state.parts.length + 1) throw new Error('Potvrde dijelova nisu u ispravnom redoslijedu.');
                state.parts.push(receipt);
              }
              await persist(state);
              if (!status.more) break;
              if (!Number.isInteger(status.nextPart) || status.nextPart <= offset) throw new Error('Nastavak prijenosa nije potvrđen.');
              offset = status.nextPart;
            }
          }
          await persist(state);
          for (let offset = state.parts.length * partSize, part = state.parts.length + 1; offset < file.size; offset += partSize, part++) {
            const receipt = await reliable('/api/media/part?id='+encodeURIComponent(created.id)+'&part='+part, { method:'PUT',headers:{'content-type':'application/octet-stream'},body:file.slice(offset,offset+partSize) }, report, 'Prijenos videa');
            state.parts.push(receipt);
            await persist(state);
            report('Preneseno: '+Math.floor(Math.min(offset+partSize,file.size)/file.size*100)+' %. Spremanje još traje.');
          }
          const batchSize = created.verifyBatch || 64;
          if (state.verified >= state.parts.length) state.verified = Math.max(0, state.parts.length - batchSize);
          for (let offset = state.verified; offset < state.parts.length;) {
            report('Provjeravam spremanje: '+Math.floor(offset/state.parts.length*100)+' %…');
            const result = await reliable('/api/media/complete', { method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:created.id,offset,parts:state.parts.slice(offset,offset+batchSize)}) }, report, 'Završna provjera');
            if (result.url) { await progressStorage.remove(key).catch(() => {}); interrupted.delete(key); return result; }
            if (!result.continue || !Number.isInteger(result.nextPart) || result.nextPart <= offset || result.nextPart >= state.parts.length) throw new Error('Završna provjera nije potvrđena.');
            offset = result.nextPart; state.verified = offset; await persist(state);
          }
          throw new Error('Nedostaje potvrda dovršenog videa.');
        } catch (error) {
          const detail = error.trace ? ' Oznaka greške: '+error.trace+'.' : '';
          const wrapped = new Error((error.stage ? error.stage+': ' : '')+error.message+detail+' Ponovno odaberi isti video da nastaviš prijenos.');
          wrapped.status = error.status; wrapped.trace = error.trace;
          throw wrapped;
        }
      };
      report('Datoteka čeka svoj red…');
      const task = queue.then(transfer); queue = task.catch(() => {}); return task;
    }
    return { upload, hasInterrupted: () => interrupted.size > 0 };
  }
  root.PortfolioUploads = { createUploader, fingerprint, storage };
})(typeof globalThis === 'undefined' ? window : globalThis);
