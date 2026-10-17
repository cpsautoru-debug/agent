import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
process.chdir(root);
if(fs.existsSync('.env'))process.loadEnvFile('.env');
if(process.env.HOST&&!['127.0.0.1','localhost'].includes(process.env.HOST))throw Error('Для запуска на сервере используйте node server.mjs; этот запуск только локальный.');
const port=Number(process.env.PORT||8766);
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Неверный порт');
const base=`http://127.0.0.1:${port}/`;
async function healthy(){try{const r=await fetch(base+'health',{signal:AbortSignal.timeout(500)});return (await r.json()).app==='anton-instagram-agent';}catch{return false;}}
if(!await healthy()){
 fs.mkdirSync('data',{recursive:true});const log=fs.openSync('data/server.log','a');
 const child=spawn(process.execPath,['--env-file-if-exists=.env','server.mjs'],{cwd:root,detached:true,windowsHide:true,stdio:['ignore',log,log]});child.unref();fs.closeSync(log);
}
for(let i=0;i<30&&!await healthy();i++)await new Promise(resolve=>setTimeout(resolve,500));
if(!await healthy())throw Error('Помощник не запустился. Смотрите data/server.log.');
let key=process.env.ADMIN_TOKEN||'';
if(!key&&fs.existsSync('data/admin-token.txt'))key=fs.readFileSync('data/admin-token.txt','utf8').trim();
const url=/^[a-f0-9]{64}$/.test(key)?base+'#key='+key:base;
if(process.platform==='win32')spawn('cmd.exe',['/d','/c','start','',url],{windowsHide:true,stdio:'ignore'}).unref();
else console.log('Откройте '+base+' и введите ключ из data/admin-token.txt.');
console.log('Помощник запущен. Отправка в Instagram по умолчанию выключена.');
