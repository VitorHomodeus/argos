/* ARGOS P14 — Fotos privadas no Supabase Storage: UID no prefixo e RLS no bucket.
   Nunca gerar URL pública ou assinar links para contas de terceiros. */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PHOTO=/^[a-zA-Z0-9_-]{1,180}$/;
const MIME=new Set(['image/jpeg','image/png','image/webp']);
const BUCKET='argos-original-photos';
export function createArgosPhotoCloud({url,publishableKey,uid,getToken,transport=fetch}){
  if(!UUID.test(uid)||!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(String(url||''))||!/^sb_publishable_[A-Za-z0-9_-]{15,}$/.test(publishableKey)||typeof getToken!=='function')throw Error('Fotos: configuração inválida');
  const id=uid.toLowerCase();
  const path=name=>{if(!PHOTO.test(name))throw Error('Identificador de foto inválido');return id+'/'+name;};
  async function headers(extra={}){
    const token=await getToken();if(!token)throw Error('Sessão de fotos indisponível');
    return {apikey:publishableKey,Authorization:'Bearer '+token,...extra};
  }
  async function send(urlPath,method,body,h={}){
    const options={method,cache:'no-store',mode:'cors',headers:await headers(h),...(body==null?{}:{body})};
    let r;
    try{r=await transport(url+urlPath,options);}catch(error){
      if(error instanceof TypeError||/^(Failed to fetch|Load failed|NetworkError)/.test(String(error.message||error)))throw Error('Falha na conexão com o servidor de fotos. Verifique a conexão e tente novamente.');
      throw error;
    }
    // Storage can wrap a legacy object-not-found response in HTTP 400.
    // Only an authenticated GET of a missing object admits this fallback.
    if(method==='GET'&&r.status===400){
      let detail;try{detail=await r.clone().json();}catch{}
      const status=Number(detail?.statusCode??detail?.httpStatusCode??404);
      if(status===404&&(detail?.code==='NoSuchKey'||detail?.error==='not_found'&&detail?.message==='Object not found'))return null;
    }
    if(!r.ok&&!(method==='GET'&&r.status===404)){if(r.status===401||r.status===403)throw Error('Permissão de fotos negada');throw Error('Storage de fotos falhou ('+r.status+')');}
    return r;
  }
  return {
    async put(name,blob,{upsert=true}={}){
      if(!(blob instanceof Blob)||!blob.size||blob.size>20*1024*1024||!MIME.has(blob.type))throw Error('Foto JPEG, PNG ou WebP inválida');
      const r=await send('/storage/v1/object/'+BUCKET+'/'+path(name),'POST',blob,{'Content-Type':blob.type,'x-upsert':String(!!upsert)});
      return await r.json();
    },
    async get(name){
      const r=await send('/storage/v1/object/authenticated/'+BUCKET+'/'+path(name),'GET');
      if(!r||r.status===404)return null;
      const blob=await r.blob();
      if(!(blob instanceof Blob)||!blob.size||!MIME.has(blob.type))throw Error('Foto retornada inválida');
      return blob;
    },
    async remove(names){
      const unique=[...new Set(names)].filter(Boolean);
      if(!unique.length)return;
      const paths=unique.map(path);
      const r=await send('/storage/v1/object/'+BUCKET,'DELETE',JSON.stringify({prefixes:paths}),{'Content-Type':'application/json'});
      const deleted=await r.json();
      // P89: com RLS sem DELETE, o Storage responde 200 e uma lista vazia sem apagar nada.
      // Só confirmar o que voltou na lista; para o resto, reler e falhar se ainda existir.
      const listed=new Set((Array.isArray(deleted)?deleted:[]).map(x=>typeof x==='string'?x:x?.name));
      const remaining=[];
      for(const name of unique)if(!listed.has(path(name))&&await this.get(name))remaining.push(name);
      if(remaining.length)throw Error('O servidor não confirmou a exclusão de '+remaining.length+' foto(s); elas continuam armazenadas.');
      return deleted;
    }
  };
}
