import {readFile,writeFile,mkdir,realpath} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,relative,isAbsolute,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {buildMoyskladDiscrepancyReport} from './moysklad-reconcile.mjs';
import {createMoyskladClient} from './moysklad.mjs';
import {observeDocument} from './audit-ledger.mjs';

// Explicit local operator command; never started by server.mjs or a scheduler.
try{
  const args=process.argv.slice(2);
  if(args.length===1&&args[0]==='--probe'){
    console.log(JSON.stringify(await createMoyskladClient().connection()));
  }else if(args.length===2&&args[0]==='--input'){
    const root=await realpath(fileURLToPath(new URL('../../',import.meta.url)));
    const privateRoot=join(root,'private','moysklad');await mkdir(privateRoot,{recursive:true});
    const safeRoot=await realpath(privateRoot),rel=relative(root,safeRoot);
    if(isAbsolute(rel)||rel==='..'||rel.startsWith('..\\')||rel.startsWith('../'))throw Error('unsafe-private-directory');
    const source=await realpath(resolve(args[1])),sourceRelative=relative(safeRoot,source);
    if(isAbsolute(sourceRelative)||sourceRelative==='..'||sourceRelative.startsWith('..\\')||sourceRelative.startsWith('../'))throw Error('input-must-be-in-private-moysklad');
    const raw=await readFile(source);if(raw.length>20*1024*1024)throw Error('input-too-large');
    const report=buildMoyskladDiscrepancyReport(JSON.parse(raw.toString('utf8')));
    report.localObservations=[];
    for(const entry of report.documentReview?.proposedLedger||[]){
      const [accountId,type,documentId]=entry.key.split(':');
      report.localObservations.push(await observeDocument(join(safeRoot,'audit-ledger'),{accountId,type,documentId,hash:entry.hash,updated:entry.updated,applied:entry.applied}));
    }
    const output=join(safeRoot,'reconciliation-'+randomUUID()+'.json');
    await writeFile(output,JSON.stringify(report,null,2),{flag:'wx',mode:0o600});
    console.log(JSON.stringify({readOnly:true,report:output,commercialDataInOutput:true}));
  }else{console.error('Usage: node moysklad-report.mjs --probe | --input <private/moysklad/input.json>');process.exitCode=2;}
}catch{console.error('Read-only audit failed. Check private inputs and documentation; no data was written to MoySklad or Sheets.');process.exitCode=1;}
