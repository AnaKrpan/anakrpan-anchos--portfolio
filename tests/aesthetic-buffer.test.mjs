import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(new URL('../public/video-loading.js',import.meta.url),'utf8');
function fixture(){
  const listeners=new Map(),attrs=new Map(),button={setAttribute(){},addEventListener(){},hidden:false};
  let lead=.1,plays=0,pauses=0,loads=0,clock=0;
  const video={currentTime:50,duration:60,paused:false,seeking:false,ended:false,preload:'none',controls:false,hidden:false,dataset:{},parentElement:{append(){}},
    buffered:{length:1,start:()=>0,end:()=>video.currentTime+lead},
    addEventListener(name,fn){listeners.set(name,fn);},getAttribute:k=>attrs.get(k)||null,setAttribute(k,v){attrs.set(k,v);},removeAttribute:k=>attrs.delete(k),
    pause(){pauses++;video.paused=true;},play(){plays++;video.paused=false;listeners.get('play')?.();return Promise.resolve();},load(){loads++;}};
  Object.defineProperty(video,'src',{get:()=>attrs.get('src'),set:v=>attrs.set('src',v)});
  const context=vm.createContext({document:{createElement:()=>button,querySelectorAll:()=>[]},addEventListener(){},setTimeout,clearTimeout,Date:{now:()=>clock},Number,WeakMap});
  vm.runInContext(source,context);
  const control=context.PortfolioVideoLoading.controller(video);control.set('/media/test.mp4');control.play();video.currentTime=50;
  return {video,control,fire:name=>listeners.get(name)?.(),lead:v=>lead=v,tick:ms=>clock+=ms,counts:()=>({plays,pauses,loads})};
}
test('only opted-in video buffers one real end underrun without another load or source change',()=>{
  const f=fixture();f.control.bufferEnd(true);const before=f.counts();f.fire('waiting');
  assert.equal(f.video.paused,true);assert.equal(f.counts().loads,before.loads);
  f.lead(3);f.fire('progress');assert.equal(f.video.paused,false);assert.equal(f.counts().plays,before.plays+1);
  const after=f.counts();f.lead(.1);f.fire('waiting');assert.deepEqual(f.counts(),after);
});
test('other videos and startup playback are untouched',()=>{
  const f=fixture(),before=f.counts();f.fire('waiting');assert.deepEqual(f.counts(),before);
  f.control.bufferEnd(true);f.video.currentTime=1;f.fire('waiting');assert.deepEqual(f.counts(),before);
});
test('resetting or switching away cancels the end buffer and cannot restart hidden media',()=>{
  const f=fixture();f.control.bufferEnd(true);f.fire('waiting');f.control.reset();const before=f.counts();
  f.lead(3);f.fire('progress');assert.deepEqual(f.counts(),before);assert.equal(f.video.getAttribute('src'),null);
});

test('tail buffering has a five-second deadline and cannot lock the player indefinitely',()=>{
  const f=fixture();f.control.bufferEnd(true);f.fire('waiting');assert.equal(f.video.paused,true);
  f.tick(5100);f.fire('progress');assert.equal(f.video.paused,false);
});
