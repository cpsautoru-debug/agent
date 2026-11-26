// Shared HMAC for a fixed read-only Pages bridge. No MoySklad token is
// copied into a Worker. Never emit this secret or any authorization headers.
const encoder=new TextEncoder();
const HEX=/^[0-9a-f]{64}$/;
const SECRET=/^[A-Za-z0-9_-]{43}$/;
const MAX_SKEW_MS=60000;

export function validBridgeSecret(secret){
  return typeof secret==='string'&&SECRET.test(secret);
}
const message=(stamp,pathAndQuery)=>stamp+'\n'+pathAndQuery;
async function keyFor(secret){
  return crypto.subtle.importKey('raw',encoder.encode(secret),
    {name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
}
export async function signBridgeRequest(secret,stamp,pathAndQuery){
  if(!validBridgeSecret(secret)||!Number.isSafeInteger(Number(stamp))||
    !/^\d{13}$/.test(String(stamp))||
    typeof pathAndQuery!=='string'||!['/api/ms/production-bridge?','/api/ms/sales-bridge?'].some(prefix=>pathAndQuery.startsWith(prefix)))
    throw Error('invalid_ms_bridge_signature_input');
  const bytes=new Uint8Array(await crypto.subtle.sign('HMAC',await keyFor(secret),
    encoder.encode(message(String(stamp),pathAndQuery))));
  return [...bytes].map(x=>x.toString(16).padStart(2,'0')).join('');
}
export async function verifyBridgeRequest(secret,stamp,signature,pathAndQuery,nowMs=Date.now()){
  if(!validBridgeSecret(secret)||!/^\d{13}$/.test(String(stamp))||
    typeof signature!=='string'||!HEX.test(signature)||
    !Number.isSafeInteger(nowMs)||Math.abs(Number(stamp)-nowMs)>MAX_SKEW_MS||
    typeof pathAndQuery!=='string'||!['/api/ms/production-bridge?','/api/ms/sales-bridge?'].some(prefix=>pathAndQuery.startsWith(prefix)))
    return false;
  const bytes=Uint8Array.from(signature.match(/../g),pair=>parseInt(pair,16));
  return crypto.subtle.verify('HMAC',await keyFor(secret),bytes,
    encoder.encode(message(String(stamp),pathAndQuery)));
}
