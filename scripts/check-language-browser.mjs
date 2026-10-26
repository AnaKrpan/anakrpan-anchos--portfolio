import assert from 'node:assert/strict';
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from 'playwright';

let data;try{data=JSON.parse(await readFile('/tmp/anchos-language-content.json','utf8'));}catch{data=JSON.parse(await readFile('tests/fixtures/language-content.json','utf8'));}
const writes=[];
const server=http.createServer(async(req,res)=>{
  if(req.url==='/api/content'||req.url==='/api/draft'){
    if(req.method==='PUT'){let body='';for await(const part of req)body+=part;writes.push(JSON.parse(body));res.setHeader('content-type','application/json');res.end(JSON.stringify({revision:data.revision+1,updatedAt:new Date().toISOString()}));return;}
    res.setHeader('content-type','application/json');res.end(JSON.stringify(data));return;
  }
  if(req.url==='/api/session'){res.setHeader('content-type','application/json');res.end(JSON.stringify({canEdit:true}));return;}
  try{const pathname=new URL(req.url,'http://localhost').pathname,path=resolve('public','.'+(['/','/uredi'].includes(pathname)?'/index.html':pathname));if(!path.startsWith(resolve('public')+'/'))throw Error();
    const bytes=await readFile(path);res.setHeader('content-type',path.endsWith('.js')?'text/javascript':path.endsWith('.jpg')?'image/jpeg':path.endsWith('.webp')?'image/webp':'text/html');res.end(bytes);
  }catch{res.writeHead(404);res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch();
const snapshot=page=>page.evaluate(()=>({
  texts:[...document.querySelectorAll('[data-edit]')].map(el=>el.innerHTML),
  collaborations:PortfolioCollaborations.capture(),
  photos:[...document.querySelectorAll('[data-photo]')].map(el=>({src:el.getAttribute('src'),alt:el.alt})),
  media:[...document.querySelectorAll('video')].map(el=>({source:el.dataset.mediaSrc,src:el.getAttribute('src'),poster:el.poster,time:el.currentTime})),
  title:document.title,description:document.querySelector('meta[name="description"]').content,
  emails:[...document.querySelectorAll('[data-email-link]')].map(el=>el.getAttribute('href'))
}));
try{
  for(const viewport of [{width:360,height:800},{width:390,height:844},{width:1280,height:900}]){
    const page=await browser.newPage({viewport}),requests=[],errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/*',route=>{
      const url=new URL(route.request().url());if(url.origin!==origin){route.abort();return;}
      if(url.pathname.startsWith('/media/')){if(url.pathname.endsWith('.mp4'))requests.push({path:url.pathname,method:route.request().method()});route.abort();return;}
      if(url.pathname.startsWith('/api/'))requests.push({path:url.pathname,method:route.request().method()});
      route.continue();
    });
    await page.goto(origin);await page.waitForFunction(()=>document.querySelector('video').dataset.mediaSrc);
    const hr=await snapshot(page),baselineRequests=requests.length;
    assert(await page.evaluate(doc=>doc.texts.every(t=>PortfolioLanguage.hasTranslation(t))&&Object.values(doc.collaborations.labels).every(t=>PortfolioLanguage.hasTranslation(t))&&doc.collaborations.items.every(item=>PortfolioLanguage.hasTranslation(item.comment)),data.document),'Every current published text and testimonial must have a translation');
    for(let cycle=0;cycle<3;cycle++){
      await page.getByRole('button',{name:'English',exact:true}).click();
      assert.equal(await page.locator('html').getAttribute('lang'),'en');
      assert.match(await page.locator('.intro-copy').innerText(),/understanding a brand/);
      assert.match(await page.locator('#collaborations').innerText(),/Clients and their feedback/);
      assert.match(await page.locator('#collaborations').innerText(),/34\.5%/);
      assert(!await page.locator('main').innerText().then(t=>/KREATORICA|KLIJENTI|Pogledaj fotografiju|Poštovana|Surađujem/.test(t)));
      const en=await snapshot(page);assert.deepEqual(en.media,hr.media);assert.deepEqual(en.photos.map(p=>p.src),hr.photos.map(p=>p.src));
      const draft=await page.evaluate(()=>{const doc=captureDraft();delete doc.updatedAt;return doc;});
      const hrDraft=await page.evaluate(()=>PortfolioLanguage.withCroatian(()=>{const doc=captureDraft();delete doc.updatedAt;return doc;}));assert.deepEqual(draft,hrDraft,'English must never leak into a saved Croatian draft');
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'English layout must fit the viewport');
      await page.getByRole('button',{name:'Hrvatski',exact:true}).click();assert.deepEqual(await snapshot(page),hr,'Croatian content and every media source must return exactly');
    }
    for(const paragraph of [data.document.texts[13].replace('. Zato','.Zato'),data.document.texts[13].replace('. Zato','.\n\nZato'),data.document.texts[13].replace('. Zato','.<br>Zato')]){
      await page.evaluate(({doc,paragraph})=>{doc.texts[13]=paragraph;applyDocument(doc);PortfolioLanguage.setLanguage('en');},{doc:structuredClone(data.document),paragraph});
      assert.match(await page.locator('.intro-copy').innerText(),/I believe great content begins with understanding a brand/,'Equivalent sentence spacing must not disable translation');
      await page.evaluate(()=>PortfolioLanguage.setLanguage('hr'));
    }
    await page.evaluate(doc=>applyDocument(doc),data.document);
    assert.deepEqual(await snapshot(page),hr,'Formatting regression checks must preserve current Croatian content');
    assert.equal(await page.evaluate(()=>PortfolioLanguage.hasTranslation('Ovo je potpuno nov tekst o drugoj temi.')),false,'Changed words must not use an unrelated translation');
    assert.equal(requests.length,baselineRequests,'Switching languages must not make API or video requests');
    assert(!requests.some(r=>r.method!=='GET'),'Language selection must never write to the server');
    await page.goto(origin+'/?lang=en');await page.waitForFunction(()=>document.querySelector('video').dataset.mediaSrc);
    assert.equal(await page.locator('html').getAttribute('lang'),'en');assert.match(await page.locator('.intro-copy').innerText(),/understanding a brand/);
    const galleryEnglish=await page.locator('.gallery-item .card-label span').first().innerText();
    await page.locator('.gallery-item').first().click();assert.equal(await page.locator('#image-dialog').isVisible(),true);assert.equal(await page.locator('#dialog-title').innerText(),galleryEnglish);
    await page.evaluate(()=>PortfolioLanguage.setLanguage('hr'));assert.equal(await page.locator('#dialog-title').innerHTML(),hr.texts[33]);await page.locator('#close-dialog').click();
    await page.locator('[data-video-slot="1"] .video-start').click();await page.waitForTimeout(100);
    await page.evaluate(()=>{document.querySelector('video').currentTime=17;});const selected=await snapshot(page);
    await page.evaluate(()=>PortfolioLanguage.setLanguage('en'));assert.deepEqual((await snapshot(page)).media,selected.media,'Changing language must not restart or reload a video');
    await page.goto(origin+'/uredi?lang=en');await page.waitForFunction(()=>document.body.classList.contains('editing'));
    assert.equal(await page.locator('html').getAttribute('lang'),'hr');assert.equal(await page.locator('.language-switch').isVisible(),false);
    await page.locator('.intro-copy h2').fill('Provjera privatnog nacrta');
    await page.waitForTimeout(1600);assert(writes.length>0);const saved=writes.at(-1).document;
    assert(saved.texts.includes('Provjera privatnog nacrta'));assert(saved.texts.includes('KREATORICA SADRŽAJA<br>UGC KREATOR<br>INFLUENCER'));
    assert.deepEqual(saved.videos.map(v=>v.src),data.document.videos.map(v=>v.src));assert.equal(saved.collaborations.items[0].comment,hr.collaborations.items[0].comment);
    assert.deepEqual(errors,[]);console.log(JSON.stringify({viewport,croatianRestoredExactly:true,allCurrentTextTranslated:true,mediaUnchanged:true,noLanguageNetworkRequests:true,privateCroatianEditingPreserved:true}));await page.close();
  }
}finally{await browser.close();server.close();}
