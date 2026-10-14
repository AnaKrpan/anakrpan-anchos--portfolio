(function(root){
  const controllers=new WeakMap();
  function controller(video){
    if(controllers.has(video))return controllers.get(video);
    const button=document.createElement('button');button.type='button';button.className='video-start';button.setAttribute('aria-label','Pokreni video');
    button.innerHTML='<span aria-hidden="true"></span>';video.parentElement.append(button);
    let source='';
    function play(){
      if(!source)return;
      if(video.getAttribute('src')!==source){video.preload='auto';video.src=source;video.load();}
      video.controls=true;button.hidden=true;
      const started=video.play();
      started?.catch(()=>{button.hidden=false;});
    }
    button.addEventListener('click',play);
    const control={
      set(src,poster='',force=false){
        if(source===src&&src&&!force)return;
        video.pause();video.removeAttribute('src');video.preload='none';video.load();
        source=src||'';video.dataset.mediaSrc=source;video.controls=false;
        if(poster)video.poster=poster;else video.removeAttribute('poster');
        video.hidden=!source;button.hidden=!source;
      },
      play,
      reset(){control.set(source,video.getAttribute('poster')||'',true);}
    };
    controllers.set(video,control);return control;
  }
  root.PortfolioVideoLoading={controller};
  function resetPageVideos(){document.querySelectorAll('video').forEach(video=>controllers.get(video)?.reset());}
  root.addEventListener('pagehide',resetPageVideos);
  root.addEventListener('pageshow',resetPageVideos);
})(globalThis);
