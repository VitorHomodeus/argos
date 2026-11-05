/** Read-only rescue of browser-era ARGOS storage; never grants ownership or uploads data. */
const RAW = /^(otd_|hist_)/;
const LEGACY = /^argos_db_([a-z][a-z0-9_-]{1,31})__(otd_|hist_)(.*)$/i;
const RESERVED = /^uid_/i;
const MAX_KEYS = 20000;
const MAX_BYTES = 8_000_000;

export function discoverLegacySources(storage) {
  if (!storage || typeof storage.key !== 'function' || typeof storage.getItem !== 'function') throw Error('Armazenamento indisponível');
  const grouped = new Map();
  if (storage.length > MAX_KEYS) throw Error('Muitas chaves no navegador: análise manual necessária');
  for (let i=0;i<storage.length;i++) {
    const name=storage.key(i);
    if(typeof name!=='string')continue;
    const m=LEGACY.exec(name);
    let source, logical;
    if(m && !RESERVED.test(m[1])){source=m[1].toLowerCase();logical=m[2]+m[3];}
    else if(RAW.test(name)){source='sem-conta';logical=name;}
    else continue;
    if(!grouped.has(source))grouped.set(source,new Map());
    grouped.get(source).set(logical,name);
  }
  return [...grouped.entries()].map(([source,keys])=>({source,records:keys.size,studentList:keys.has('otd_people')})).sort((a,b)=>a.source.localeCompare(b.source));
}

export function buildLegacyRescue(storage,source){
  if(typeof source!=='string'|| !/^(sem-conta|[a-z][a-z0-9_-]{1,31})$/.test(source) || RESERVED.test(source))throw Error('Origem inválida');
  const data={};let size=0;let excludedPhotoMetadataKeys=0;
  for(let i=0;i<storage.length;i++){
    const physical=storage.key(i);if(typeof physical!=='string')continue;
    let logical=null;
    if(source==='sem-conta' && RAW.test(physical))logical=physical;
    else {
      const m=LEGACY.exec(physical);
      if(m && m[1].toLowerCase()===source && !RESERVED.test(m[1]))logical=m[2]+m[3];
    }
    if(!logical)continue;
    // Image keys live in IndexedDB and cannot be represented by this JSON-only export.
    if(/_fotos$/.test(logical)){excludedPhotoMetadataKeys++;continue;}
    const value=storage.getItem(physical);
    if(typeof value!=='string')continue;
    size+=physical.length+value.length;
    if(size>MAX_BYTES)throw Error('Mais de 8 MB; preserve o backup pelo aplicativo original');
    if(Object.hasOwn(data,logical))throw Error('Chave duplicada no armazenamento legado');
    data[logical]=value;
  }
  if(!Object.keys(data).length)throw Error('Origem antiga vazia');
  // No account is inferred from aliases such as "vitor" or this device.
  return {app:'ARGOS',v:2,backupType:'data-only',account:null,sourceLabel:source,
          warning:'BACKUP SEM FOTOS. Não comprova titularidade. Requer concessão do administrador por UID + SHA256 do arquivo.',
          exportedAt:new Date().toISOString(),excludedPhotoMetadataKeys,data,photos:{}};
}
