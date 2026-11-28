import test from 'node:test';
import assert from 'node:assert/strict';
import {createStaffSession,authorizeStaff} from '../functions/api/auth/staff-session.mjs';
import {createSession,verifySession} from '../functions/api/auth/session.js';
const now=Date.parse('2026-11-28T04:00:00Z');
const env={OFFICE_STAFF_SESSION_SECRET:'staff-test-secret-longer-than-32-characters',OFFICE_SESSION_SECRET:'owner-test-secret',OZON_FINANCE_DB:{prepare(sql){assert.match(sql,/office_staff_access/);return {bind(sub){assert.equal(sub,'staff1');return {first:async()=>({role:'sewing',enabled:1,revision:1})}}}}}};
const req=cookie=>new Request('https://autosklad63-office-staging.pages.dev/api/staff/me',{headers:{Cookie:cookie}});
test('staff session is isolated from owner session and role is resolved server side',async()=>{
 const cookie=(await createStaffSession({sub:'staff1',revision:1},env,now)).split(';')[0];
 assert.deepEqual(await authorizeStaff(req(cookie),env,now),{status:200,sub:'staff1',role:'sewing'});
 assert.equal(await verifySession(req(cookie),env.OFFICE_SESSION_SECRET),null);
 const owner=(await createSession('owner',env.OFFICE_SESSION_SECRET)).split(';')[0];
 assert.equal((await authorizeStaff(req(owner),env,now)).status,401);
 assert.equal((await authorizeStaff(req(cookie),env,now+28800000)).status,401);
 assert.equal((await authorizeStaff(req(cookie+'; '+cookie),env,now)).status,401);
});
test('disabled, revoked, unrecognized roles fail closed',async()=>{
 const cookie=(await createStaffSession({sub:'staff1',revision:1},env,now)).split(';')[0];
 for(const row of [null,{role:'sewing',enabled:0,revision:1},{role:'owner',enabled:1,revision:1},{role:'sewing',enabled:1,revision:2}]){
 const e={...env,OZON_FINANCE_DB:{prepare:()=>({bind:()=>({first:async()=>row})})}};
 assert.equal((await authorizeStaff(req(cookie),e,now)).status,403);
 }
 assert.equal((await authorizeStaff(req(cookie),{...env,OFFICE_STAFF_SESSION_SECRET:env.OFFICE_SESSION_SECRET},now)).status,503);
});
