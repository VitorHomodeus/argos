/** ARGOS P15: migração legada só após grant de administrador para hash + UID. */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST=/^[a-f0-9]{64}$/;
export function isLegacyAccount(account,uid){
  if(!UUID.test(uid))throw Error('Conta de destino inválida');
  return account==null||account===''||typeof account==='string'&&!UUID.test(account);
}
export async function hashLegacyBackup(text,cryptoApi=globalThis.crypto){
  if(typeof text!=='string'||!text.trim()||text.length>8_000_000)throw Error('Backup vazio ou excessivo');
  if(!cryptoApi?.subtle?.digest)throw Error('Ambiente HTTPS seguro obrigatório');
  const bytes=new TextEncoder().encode(text);
  const hash=await cryptoApi.subtle.digest('SHA-256',bytes);
  return [...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
export function createLegacyMigration({url,publishableKey,uid,getToken,transport=fetch,cryptoApi=globalThis.crypto}){
  if(!UUID.test(uid)||!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(String(url||''))||
     !/^sb_publishable_[A-Za-z0-9_-]{15,}$/.test(String(publishableKey||''))||typeof getToken!=='function')throw Error('Configuração de migração inválida');
  async function rpc(method,params){
    const token=await getToken();if(!token)throw Error('Sessão indisponível');
    const res=await transport(url+'/rest/v1/rpc/'+method,{method:'POST',cache:'no-store',mode:'cors',headers:{apikey:publishableKey,Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(params)});
    if(!res.ok){if(res.status===401||res.status===403)throw Error('Migração não autorizada para esta conta');throw Error('Falha de verificação de migração ('+res.status+')');}
    return await res.json();
  }
  return {
    digest:text=>hashLegacyBackup(text,cryptoApi),
    async authorize(text){const sha=await hashLegacyBackup(text,cryptoApi);if(!DIGEST.test(sha)||await rpc('argos_authorize_legacy_import',{p_sha256:sha})!==true)throw Error('Backup legado sem autorização do administrador para esta conta e hash');return sha;},
    async complete(sha){if(!DIGEST.test(sha)||await rpc('argos_complete_legacy_import',{p_sha256:sha})!==true)throw Error('Confirmação final da migração não reconhecida pelo servidor');return true;}
  };
}
