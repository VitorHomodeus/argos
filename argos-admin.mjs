/** ARGOS P16: gestão com RPC de privilégio server-side, jamais chave service_role. */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST=/^[a-f0-9]{64}$/;
export function createArgosAdmin({url,publishableKey,uid,getToken,transport=fetch}){
 if(!UUID.test(uid)||!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(String(url||''))||
   !/^sb_publishable_[A-Za-z0-9_-]{15,}$/.test(String(publishableKey||''))||typeof getToken!=='function')throw Error('Painel admin: configuração inválida');
 async function rpc(name,params={}){
  const token=await getToken();if(!token)throw Error('Sessão indisponível');
  const r=await transport(url+'/rest/v1/rpc/'+name,{method:'POST',cache:'no-store',mode:'cors',headers:{apikey:publishableKey,Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(params)});
  if(!r.ok){if([401,403].includes(r.status))throw Error('Somente administrador autorizado pode executar');throw Error('Ação administrativa recusada ('+r.status+')');}
  return await r.json();
 }
 return {
  async list(){const data=await rpc('argos_admin_list_professionals');if(!Array.isArray(data)||data.some(x=>!UUID.test(x.user_id)||!['personal','inactive'].includes(x.role)))throw Error('Resposta administrativa inválida');return data;},
  async setProfessional(userId,enabled,displayName){if(!UUID.test(userId)||userId.toLowerCase()===uid.toLowerCase()||typeof enabled!=='boolean')throw Error('Profissional ou operação inválida');if(displayName!=null&&(typeof displayName!=='string'||displayName.trim().length>100))throw Error('Nome inválido');return await rpc('argos_admin_set_professional',{p_user_id:userId,p_enabled:enabled,p_display_name:displayName||null});},
  async approveLegacy(target,sha,label){if(!UUID.test(target)||!DIGEST.test(sha)||typeof label!=='string'||label.trim().length<2||label.trim().length>100)throw Error('Destino, SHA-256 ou origem inválidos');return rpc('argos_admin_approve_legacy_import',{p_target_user_id:target,p_sha256:sha,p_source_label:label.trim()});}
 };
}
