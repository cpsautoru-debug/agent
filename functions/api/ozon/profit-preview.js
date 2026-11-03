function canonical(value) {
  if(Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if(value!==null && typeof value==='object') return `{${Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')}}`;
  return JSON.stringify(value);
}
const encoder = new TextEncoder();
function encode(bytes) {return btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
function decode(value) {if(!/^[\w-]+$/.test(value)) throw new Error('invalid_profit_preview'); return Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));}
async function hash(value){return encode(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(canonical(value)))));}
async function key(secret){if(typeof secret!=='string'||!secret)throw new Error('profit_secret_missing');return crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);}
export async function createProfitPreview(secret,actor,documentKey,value,before,now=Date.now()) {
  const payload={purpose:'ozon-profit-preview-v1',actor,key:documentKey,hash:await hash(value),version:before.version,changeId:crypto.randomUUID(),issuedAt:now,expiresAt:now+600000};
  const data=encode(encoder.encode(JSON.stringify(payload)));
  const signature=encode(new Uint8Array(await crypto.subtle.sign('HMAC',await key(secret),encoder.encode(data))));
  return {token:`${data}.${signature}`,key:documentKey,before:before.value,after:value,expiresAt:new Date(payload.expiresAt).toISOString(),warnings:['Подтверждение сохраняет новую версию. Предварительные данные не становятся формальным аудитом начислений.']};
}
export async function verifyProfitPreview(secret,actor,documentKey,value,token,now=Date.now()) {
  if(typeof token!=='string'||token.length>3000)throw new Error('invalid_profit_preview');
  const parts=token.split('.');if(parts.length!==2)throw new Error('invalid_profit_preview');
  const valid=await crypto.subtle.verify('HMAC',await key(secret),decode(parts[1]),encoder.encode(parts[0]));
  if(!valid)throw new Error('invalid_profit_preview');
  const payload=JSON.parse(new TextDecoder().decode(decode(parts[0])));
  if(payload.purpose!=='ozon-profit-preview-v1'||payload.actor!==actor||payload.key!==documentKey||payload.hash!==await hash(value)||!Number.isSafeInteger(payload.version)||payload.version<0||!Number.isSafeInteger(payload.issuedAt)||payload.issuedAt>now||!Number.isSafeInteger(payload.expiresAt)||payload.expiresAt<=now||payload.expiresAt-payload.issuedAt!==600000||typeof payload.changeId!=='string')throw new Error('invalid_or_expired_profit_preview');
  return payload;
}
