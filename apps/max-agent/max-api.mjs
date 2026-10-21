import https from 'node:https';
import {readFileSync} from 'node:fs';
const certificates=['russian-root.crt','russian-sub.crt'].map(file=>readFileSync(new URL('./certs/'+file,import.meta.url),'utf8'));
export function maxApi(token,path='/me',body=null,transport=https.request){
  return new Promise(resolve=>{
    let finished=false;
    const finish=value=>{if(!finished){finished=true;resolve(value);}};
    const req=transport('https://platform-api2.max.ru'+path,{
      method:body?'POST':'GET',headers:{Authorization:token,...(body?{'Content-Type':'application/json'}:{})},ca:certificates,rejectUnauthorized:true,
    },res=>{
      let body='';
      res.setEncoding('utf8');
      res.on('data',chunk=>{body+=chunk;if(body.length>65536){res.destroy();finish({connected:false,reason:'oversized-response'});}});
      res.on('error',()=>finish({connected:false,reason:'network-error'}));
      res.on('end',()=>{
        if(res.statusCode!==200)return finish({ok:false,http:res.statusCode,reason:'api-error'});
        try{
          finish({ok:true,data:JSON.parse(body)});
        }catch{finish({connected:false,reason:'invalid-response'});}
      });
    });
    req.setTimeout(10000,()=>{req.destroy();finish({connected:false,reason:'timeout'});});
    req.on('error',()=>finish({connected:false,reason:'tls-or-network-error'}));
    req.end(body?JSON.stringify(body):undefined);
  });
}
