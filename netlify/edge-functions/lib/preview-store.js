import '../../../public/project-model.js';
export async function previewStore(primary,isolated){
  let baseline=await isolated.get('preview-baseline',{type:'json',consistency:'strong'});
  if(!baseline){
    const state=await primary.get('state',{type:'json',consistency:'strong'});
    if(!state?.published?.document)throw Error('Javni izvor za probno okruženje nije dostupan.');
    await isolated.setJSON('preview-baseline',state.published,{onlyIfNew:true});
    baseline=await isolated.get('preview-baseline',{type:'json',consistency:'strong'});
  }
  let stateEntry=await isolated.getWithMetadata('state',{type:'json',consistency:'strong'});
  if(!stateEntry){
    await isolated.setJSON('state',{published:baseline,draft:{...baseline,revision:0}},{onlyIfNew:true});
    stateEntry=await isolated.getWithMetadata('state',{type:'json',consistency:'strong'});
  }
  // Reuse this request's strong read once; CAS still protects every mutation.
  let stateReadAvailable=!!stateEntry;
  const takeState=()=>{stateReadAvailable=false;return structuredClone(stateEntry);};
  const files=new Set(globalThis.PortfolioProjectModel.refs(baseline.document).map(src=>src.slice(7))),ids=new Set([...files].map(file=>file.split('.')[0]));
  const mayRead=key=>(key.startsWith('media/')&&files.has(key.slice(6)))||(key.startsWith('viewing-copies/')&&files.has(key.slice(15)))||(key.startsWith('parts/')&&ids.has(key.split('/')[1]));
  return {
    publicMediaURL(path){return path.startsWith('/media/')&&files.has(path.slice(7))?'https://anakrpan-anchos-potrfolio.netlify.app'+path:null;},
    async get(key,options){if(key==='state'&&stateReadAvailable)return takeState().data;const result=await isolated.get(key,options);return result??(mayRead(key)?primary.get(key,options):null);},
    async getWithMetadata(key,options){if(key==='state'&&stateReadAvailable)return takeState();const result=await isolated.getWithMetadata(key,options);return result??(mayRead(key)?primary.getWithMetadata(key,options):null);},
    getMetadata:(...args)=>isolated.getMetadata(...args),
    setJSON:(...args)=>{if(args[0]==='state')stateReadAvailable=false;return isolated.setJSON(...args);},set:(...args)=>{if(args[0]==='state')stateReadAvailable=false;return isolated.set(...args);},delete:(...args)=>{if(args[0]==='state')stateReadAvailable=false;return isolated.delete(...args);}
  };
}
