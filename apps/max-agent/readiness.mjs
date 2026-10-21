const SAFE_CODES=new Set(['unauthorized','configuration-invalid','account-mismatch','unavailable','invalid-response','retry-exhausted','stopped']);
/** Startup checks only. A successful check is never run twice in this process. */
export function createStartupChecks(tasks,{wait}={}){
  const state=Object.fromEntries(Object.keys(tasks).map(name=>[name,{status:'pending',attempts:0,code:null}]));
  let pending=null,started=false,stopped=false,timer=null,wake=null;
  const pause=wait||((ms)=>new Promise(resolve=>{wake=resolve;timer=setTimeout(()=>{timer=null;wake=null;resolve();},ms);}));
  async function run(name,task){
    const item=state[name];
    for(let attempt=1;attempt<=3&&!stopped;attempt++){
      item.status='checking';item.attempts=attempt;
      let result;try{result=await task();}catch{result={ok:false,code:'unavailable'};}
      if(stopped)break;
      if(result?.ok===true){item.status='ready';item.code=null;return;}
      item.code=SAFE_CODES.has(result?.code)?result.code:'unavailable';
      if(result?.terminal===true||attempt===3){item.status='failed';return;}
      item.status='backoff';await pause(1000*attempt);
    }
    if(stopped){item.status='stopped';item.code='stopped';}
  }
  return {
    start(){
      if(started)return pending;
      started=true;
      // Sequential checks keep one cancellable timer and avoid retrying registration
      // while a different dependency is unavailable.
      pending=(async()=>{for(const [name,task] of Object.entries(tasks))await run(name,task);})().catch(()=>{
        for(const item of Object.values(state))if(!['ready','failed','stopped'].includes(item.status)){item.status='failed';item.code='unavailable';}
      });
      return pending;
    },
    stop(){stopped=true;if(timer!==null){clearTimeout(timer);timer=null;}if(wake){const resolve=wake;wake=null;resolve();}},
    snapshot(){return {started,ready:Object.values(state).every(item=>item.status==='ready'),checks:structuredClone(state)};}
  };
}
