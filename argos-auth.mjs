/** ARGOS P12: autenticação real. Apenas chave pública; autorização real é RLS. */
const SESSION_KEY='argos_original_supabase_session_v1';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function createArgosAuth({projectUrl,publishableKey,storage,transport=fetch}){
  if(!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(String(projectUrl||'')))throw Error('URL Supabase não configurada');
  if(!/^sb_publishable_[A-Za-z0-9_-]{15,}$/.test(String(publishableKey||'')))throw Error('Chave pública Supabase não configurada');
  if(!storage||typeof storage.getItem!=='function'||typeof storage.setItem!=='function')throw Error('Session storage indisponível');
  let session=null,refreshInFlight=null;
  function clear(){session=null;try{storage.removeItem(SESSION_KEY);}catch{}}
  // P91: diagnóstico sem segredo de por que a sessão local foi removida (etapa, HTTP e mensagem própria).
  function note(stage,e){if(e&&e.argosNoted)return;try{storage.setItem('argos_auth_last_clear',JSON.stringify({at:new Date().toISOString(),stage,status:Number.isInteger(e&&e.status)?e.status:null,reason:String(e&&e.message||e||'').slice(0,160)}));}catch{}if(e&&typeof e==='object')e.argosNoted=true;}
  function save(next){
    if(!next?.access_token||!next?.refresh_token||!UUID.test(next?.user?.id))throw Error('Sessão incompleta');
    session={access_token:next.access_token,refresh_token:next.refresh_token,expires_at:Math.floor(Date.now()/1000)+Math.max(1,Number(next.expires_in)||3600),user:{id:next.user.id,email:next.user.email||''}};
    storage.setItem(SESSION_KEY,JSON.stringify(session));return session;
  }
  async function request(path,{method='GET',body,authenticated=false,token}={}){
    let res;try{res=await transport(projectUrl+path,{method,cache:'no-store',mode:'cors',headers:{apikey:publishableKey,'Content-Type':'application/json',...(authenticated?{Authorization:'Bearer '+(token||session?.access_token)}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});}catch(e){const err=Error('Falha de rede ao falar com a autenticação');err.cause=e;err.network=true;throw err;}
    let data=null;try{data=await res.json();}catch{}
    if(!res.ok){
      const fail=m=>Object.assign(Error(m),{status:res.status});
      if(res.status===401||res.status===403)throw fail('Sessão inválida ou sem autorização');
      if(res.status===400&&path.startsWith('/auth/'))throw fail(path.includes('grant_type=refresh_token')?'Renovação da sessão recusada':'E-mail ou senha incorretos');
      throw fail('Falha de comunicação ('+res.status+')');
    }
    return data;
  }
  async function refresh(){
    if(!session?.refresh_token)throw Error('Sem refresh token');
    /* P110: login lembrado no aparelho. Se outra aba/janela do app já renovou a sessão, usa a renovada
       (o refresh token antigo deixa de valer e reutilizá-lo derrubaria o login). */
    try{const st=JSON.parse(storage.getItem(SESSION_KEY)||'null');if(st?.refresh_token&&st.access_token&&st.user?.id===session.user.id&&st.refresh_token!==session.refresh_token){session=st;if(Number(st.expires_at)>Date.now()/1000+60)return session;}}catch{}
    /* Falha de rede não apaga o login lembrado: tenta de novo quando a conexão voltar. */
    if(!refreshInFlight)refreshInFlight=(async()=>save(await request('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:{refresh_token:session.refresh_token}})))().catch(e=>{if(!e?.network)clear();note('refresh',e);throw e;}).finally(()=>{refreshInFlight=null;});
    return refreshInFlight;
  }
  async function ensureFresh(){if(!session?.access_token)throw Error('Entre novamente');if(Number(session.expires_at)<=Date.now()/1000+60)await refresh();return session;}
  async function verify(){
    await ensureFresh();
    let user;
    try{user=await request('/auth/v1/user',{authenticated:true});}
    catch(e){if(/Sessão inválida/.test(String(e.message))){await refresh();user=await request('/auth/v1/user',{authenticated:true});}else throw e;}
    if(!UUID.test(user?.id)||user.id!==session.user.id)throw Error('Identidade divergente');
    const rows=await request('/rest/v1/argos_user_roles?select=user_id,role,display_name&user_id=eq.'+encodeURIComponent(user.id),{authenticated:true});
    if(!Array.isArray(rows)||rows.length!==1||rows[0].user_id!==user.id||!['admin','personal'].includes(rows[0].role))throw Error('Conta sem papel autorizado no ARGOS');
    return {uid:user.id,email:user.email||session.user.email,role:rows[0].role,displayName:rows[0].display_name||''};
  }
  async function signIn(email,password){
    if(!String(email||'').includes('@')||!password)throw Error('Informe e-mail e senha');
    clear();const next=await request('/auth/v1/token?grant_type=password',{method:'POST',body:{email:String(email).trim(),password}});
    save(next);try{return await verify();}catch(e){clear();throw e;}
  }
  async function restore(){
    try{const prior=JSON.parse(storage.getItem(SESSION_KEY)||'null');if(!prior?.refresh_token||!prior?.access_token||!UUID.test(prior?.user?.id)){clear();return null;}session=prior;return await verify();}
    catch(e){if(e?.network){note('restore',e);throw e;}clear();note('restore',e);return null;}
  }
  async function signOut(){const token=session?.access_token;clear();if(token)try{await request('/auth/v1/logout',{method:'POST',authenticated:true,token});}catch{}}
  /* P109: o profissional cria a própria senha pelo link do convite (ou de recuperação) que o Supabase envia ao e-mail.
     Ninguém digita, envia ou vê a senha de outra pessoa. O link traz um token de uso único no fragmento (#), que não vai ao servidor do site. */
  function readLink(hash){
    const h=String(hash||'').replace(/^#/,'');if(!h)return null;
    const p=new URLSearchParams(h);
    if(p.get('error')||p.get('error_code')){const code=p.get('error_code')||p.get('error');return {error:code==='otp_expired'?'Esse link expirou ou já foi usado. Toque em "Esqueci minha senha" para receber outro.':'Não foi possível validar o link do e-mail. Toque em "Esqueci minha senha" para receber outro.'};}
    const type=p.get('type');if(!['invite','recovery','signup','magiclink'].includes(type)||!p.get('access_token')||!p.get('refresh_token'))return null;
    return {type,access_token:p.get('access_token'),refresh_token:p.get('refresh_token'),expires_in:Number(p.get('expires_in'))||3600};
  }
  async function adoptLink(link){
    if(!link?.access_token||!link?.refresh_token)throw Error('Link inválido');
    clear();
    const user=await request('/auth/v1/user',{authenticated:true,token:link.access_token});
    if(!UUID.test(user?.id))throw Error('Link inválido');
    save({access_token:link.access_token,refresh_token:link.refresh_token,expires_in:link.expires_in,user});
    return {uid:user.id,email:user.email||''};
  }
  async function setPassword(password){
    const pw=String(password||'');
    if(pw.length<8||!/[A-Za-z]/.test(pw)||!/\d/.test(pw))throw Error('Use pelo menos 8 caracteres, com letras e números');
    await ensureFresh();
    let res;try{res=await transport(projectUrl+'/auth/v1/user',{method:'PUT',cache:'no-store',mode:'cors',headers:{apikey:publishableKey,'Content-Type':'application/json',Authorization:'Bearer '+session.access_token},body:JSON.stringify({password:pw})});}catch(e){throw Error('Falha de rede ao salvar a senha');}
    if(res.ok)return true;
    let data=null;try{data=await res.json();}catch{}
    const msg=String(data?.msg||data?.message||data?.error_description||'');
    if(res.status===422&&/different/i.test(msg))throw Error('A nova senha precisa ser diferente da anterior');
    if(res.status===422||/weak|password/i.test(msg))throw Error('Senha fraca: use uma senha mais longa, misturando letras, números e símbolos');
    if(res.status===401||res.status===403)throw Error('O link expirou. Toque em "Esqueci minha senha" para receber outro');
    throw Error('Não foi possível salvar a senha ('+res.status+')');
  }
  async function recover(email,redirectTo){
    const e=String(email||'').trim();if(!e.includes('@'))throw Error('Informe o e-mail cadastrado');
    if(!/^(https:\/\/[^\s]+|http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/[^\s]*)$/.test(String(redirectTo||'')))throw Error('Endereço de retorno inválido');
    let res;try{res=await transport(projectUrl+'/auth/v1/recover?redirect_to='+encodeURIComponent(redirectTo),{method:'POST',cache:'no-store',mode:'cors',headers:{apikey:publishableKey,'Content-Type':'application/json'},body:JSON.stringify({email:e})});}catch(err){throw Error('Falha de rede ao pedir o link');}
    if(res.status===429)throw Error('Muitos pedidos seguidos. Aguarde alguns minutos e tente de novo');
    // Mesma resposta para e-mail cadastrado ou não: não revela quem tem conta.
    return true;
  }
  return {signIn,restore,verify,signOut,clear,readLink,adoptLink,setPassword,recover,getAccessToken:async()=>{await ensureFresh();return session.access_token;}};
}
