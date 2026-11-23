(function(root){
  const controllers=new WeakMap();
  function controller(video){
    if(controllers.has(video))return controllers.get(video);
    const button=document.createElement('button');button.type='button';button.className='video-start';button.setAttribute('aria-label','Pokreni video');
    button.innerHTML='<span aria-hidden="true"></span>';video.parentElement.append(button);
    let source='',endBuffering=false,tailUsed=false,tailTimer=null,tailDeadline=0,holding=false;
    const stopTail=()=>{holding=false;clearTimeout(tailTimer);tailTimer=null;};
    function bufferedAhead(){
      const time=video.currentTime,ranges=video.buffered;
      for(let i=0;i<ranges.length;i++)if(ranges.start(i)<=time+.1&&ranges.end(i)>=time)return ranges.end(i)-time;
      return 0;
    }
    function continueTail(){
      clearTimeout(tailTimer);
      if(!holding)return;
      const remaining=video.duration-video.currentTime;
      if(video.ended||!source||video.getAttribute('src')!==source){stopTail();return;}
      if(bufferedAhead()>=Math.min(2.5,Math.max(0,remaining-.1))||Date.now()>=tailDeadline){
        stopTail();video.play()?.catch(()=>{button.hidden=false;});return;
      }
      tailTimer=setTimeout(continueTail,150);
    }
    video.addEventListener('waiting',()=>{
      const remaining=video.duration-video.currentTime;
      if(!endBuffering||tailUsed||holding||video.paused||video.seeking||!Number.isFinite(remaining)||remaining>15||remaining<.25||bufferedAhead()>=1)return;
      // Only after a real underrun, keep the existing request and buffer the tail once.
      // Never reload, seek, change speed, or prefetch another video.
      tailUsed=true;holding=true;tailDeadline=Date.now()+5000;video.pause();continueTail();
    });
    video.addEventListener('progress',()=>{if(holding)continueTail();});
    video.addEventListener('play',()=>{if(holding)stopTail();});
    video.addEventListener('seeking',()=>{stopTail();if(video.currentTime<1)tailUsed=false;});

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
        stopTail();tailUsed=false;video.pause();video.removeAttribute('src');video.preload='none';video.load();
        try{video.currentTime=0;}catch{}
        source=src||'';video.dataset.mediaSrc=source;video.controls=false;
        if(poster)video.poster=poster;else video.removeAttribute('poster');
        video.hidden=!source;button.hidden=!source;
      },
      play,
      bufferEnd(enabled){endBuffering=!!enabled;if(!endBuffering)stopTail();},
      reset(){control.set(source,video.getAttribute('poster')||'',true);}
    };
    controllers.set(video,control);return control;
  }
  root.PortfolioVideoLoading={controller};
  function resetPageVideos(){document.querySelectorAll('video').forEach(video=>controllers.get(video)?.reset());}
  root.addEventListener('pagehide',resetPageVideos);
  root.addEventListener('pageshow',resetPageVideos);
})(globalThis);
