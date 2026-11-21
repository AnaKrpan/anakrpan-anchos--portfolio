import '../../../public/project-model.js';
export async function previewStore(primary,isolated){
  let baseline=await isolated.get('preview-baseline',{type:'json',consistency:'strong'});
  if(!baseline){
    const state=await primary.get('state',{type:'json',consistency:'strong'});
    if(!state?.published?.document)throw Error('Javni izvor za probno okruženje nije dostupan.');
    await isolated.setJSON('preview-baseline',state.published,{onlyIfNew:true});
    baseline=await isolated.get('preview-baseline',{type:'json',consistency:'strong'});
  }
  await isolated.setJSON('state',{published:baseline,draft:{...baseline,revision:0}},{onlyIfNew:true});
  const files=new Set(globalThis.PortfolioProjectModel.refs(baseline.document).map(src=>src.slice(7))),ids=new Set([...files].map(file=>file.split('.')[0]));
  const mayRead=key=>(key.startsWith('media/')&&files.has(key.slice(6)))||(key.startsWith('viewing-copies/')&&files.has(key.slice(15)))||(key.startsWith('parts/')&&ids.has(key.split('/')[1]));
  return {
    async get(key,options){const result=await isolated.get(key,options);return result??(mayRead(key)?primary.get(key,options):null);},
    async getWithMetadata(key,options){const result=await isolated.getWithMetadata(key,options);return result??(mayRead(key)?primary.getWithMetadata(key,options):null);},
    getMetadata:(...args)=>isolated.getMetadata(...args),
    setJSON:(...args)=>isolated.setJSON(...args),set:(...args)=>isolated.set(...args),delete:(...args)=>isolated.delete(...args)
  };
}
