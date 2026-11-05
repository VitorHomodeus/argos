/* ARGOS P13 — estado por profissional no PostgreSQL sob RLS.
   Armazenamento exclusivo em memória até a confirmação no servidor.
   Não importa chaves legadas nem opera offline silenciosamente. */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEY=/^(otd_|hist_|recovery_before_import$)/;
const LIMIT=2_000_000;
export function validateCloudPayload(data){
  if(!data||typeof data!=='object'||Array.isArray(data))throw Error('Snapshot inválido');
  const out={};
  for(const [k,v] of Object.entries(data)){
    if(!KEY.test(k)||k.length>220||typeof v!=='string'||v.length>LIMIT)throw Error('Chave de dados inválida: '+k);
    out[k]=v;
  }
  if(JSON.stringify(out).length>LIMIT)throw Error('Dados excedem limite de sincronização');
  return out;
}
export function createArgosCloud({url,publishableKey,getToken,uid,transport=fetch}){
  if(!UUID.test(uid))throw Error('UID inválido');
  if(!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(String(url||'')))throw Error('URL Supabase inválida');
  if(!/^sb_publishable_[A-Za-z0-9_-]{15,}$/.test(String(publishableKey||'')))throw Error('Chave pública inválida');
  if(typeof getToken!=='function')throw Error('Token inválido');
  let revision=0,loaded=false,uncertain=null;
  // P87: jsonb reordena chaves; compara snapshots pelo conteúdo (todas as chaves e valores string).
  const same=(a,b)=>{const ka=Object.keys(a),kb=Object.keys(b||{});return ka.length===kb.length&&ka.every(k=>Object.prototype.hasOwnProperty.call(b,k)&&b[k]===a[k]);};
  async function readRow(){
    const rows=await req('/rest/v1/argos_account_snapshots?select=user_id,revision,data&user_id=eq.'+encodeURIComponent(uid),'GET');
    if(!Array.isArray(rows)||rows.length>1)throw Error('Resposta do servidor inválida');
    const row=rows[0];
    if(row&&(!UUID.test(row.user_id)||row.user_id.toLowerCase()!==uid.toLowerCase()||!Number.isSafeInteger(row.revision)||row.revision<1))throw Error('Identidade ou revisão divergente');
    return row;
  }
  // P87: depois de uma gravação sem resposta, relê o servidor antes de enviar de novo.
  // Revisão +1 com o mesmo conteúdo: o commit aconteceu. Revisão igual: não aconteceu. Outro estado: conflito real.
  async function reconcile(){
    const row=await readRow(),rev=row?.revision||0;
    if(rev===uncertain.expected+1&&same(uncertain.data,validateCloudPayload(row?.data||{}))){revision=rev;uncertain=null;return true;}
    if(rev===uncertain.expected){uncertain=null;return false;}
    throw Error('Conflito: outra aba alterou os dados. Recarregue e revise antes de continuar');
  }
  async function req(path,method,body){
    const token=await getToken();
    if(!token||typeof token!=='string')throw Error('Sessão indisponível');
    let r;
    try{r=await transport(url+path,{method,mode:'cors',cache:'no-store',headers:{apikey:publishableKey,Authorization:'Bearer '+token,'Content-Type':'application/json',Accept:'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});}
    catch{throw Error('Falha de conexão com o servidor. '+(method==='POST'?'A gravação não foi confirmada; tente sincronizar novamente.':'Não foi possível carregar os dados; verifique a conexão e tente novamente.'));}
    let value;try{value=await r.json();}catch{value=null;}
    if(!r.ok){if(r.status===409||r.status===400&&String(value?.code)==='40001')throw Error('Conflito: outra aba alterou os dados. Recarregue e revise antes de continuar');if(r.status===401||r.status===403)throw Error('Sessão ou permissão inválida');throw Error('Falha ao salvar dados no servidor ('+r.status+')');}
    return value;
  }
  return {
    async load(){
      const row=await readRow();
      const data=validateCloudPayload(row?.data||{});
      revision=row?.revision||0;loaded=true;uncertain=null;
      return {data,revision};
    },
    async save(data){
      if(!loaded)throw Error('Estado remoto ainda não carregado');
      const validated=validateCloudPayload(data);
      if(uncertain){const prev=uncertain.data;if(await reconcile()&&same(validated,prev))return revision;}
      let next;
      try{next=await req('/rest/v1/rpc/argos_save_account_snapshot','POST',{p_expected_revision:revision,p_data:validated});}
      catch(error){if(/Falha de conexão/.test(error.message))uncertain={expected:revision,data:validated};throw error;}
      if(!Number.isSafeInteger(next)||next!==revision+1)throw Error('Confirmação de gravação inválida');
      revision=next;return revision;
    },
    get revision(){return revision;}
  };
}
