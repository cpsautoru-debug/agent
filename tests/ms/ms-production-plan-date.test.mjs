import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyProductionPlanDate} from '../../web/office/ms-production-plan-date.mjs';

const incomplete={status:'incomplete'};
const complete={status:'complete'};
const unknown={status:'unverified'};
const now=Date.parse('2026-11-20T10:00:00+04:00');

test('past planned Samara calendar day is flagged only for verified incomplete jobs',()=>{
  const task={plannedDate:'2026-11-18 23:30:00'};
  assert.equal(classifyProductionPlanDate(task,incomplete,now),'past');
  assert.equal(classifyProductionPlanDate(task,complete,now),'not_applicable');
  assert.equal(classifyProductionPlanDate(task,unknown,now),'unverified');
});

test('Moscow to Samara midnight shift does not create false overdue warning',()=>{
  assert.equal(classifyProductionPlanDate(
    {plannedDate:'2026-11-19 23:30:00'},incomplete,now),'today');
  assert.equal(classifyProductionPlanDate(
    {plannedDate:'2026-11-21 00:00:00'},incomplete,now),'future');
  assert.equal(classifyProductionPlanDate(
    {plannedDate:'2026-11-20'},incomplete,now),'today');
});

test('missing, invalid and unverified planned dates cannot be counted overdue',()=>{
  assert.equal(classifyProductionPlanDate({},incomplete,now),'not_set');
  assert.equal(classifyProductionPlanDate({plannedDate:null},incomplete,now),'not_set');
  assert.equal(classifyProductionPlanDate({plannedDate:'2026-02-31'},incomplete,now),'unverified');
  assert.equal(classifyProductionPlanDate({plannedDate:'not-a-date'},incomplete,now),'unverified');
  assert.equal(classifyProductionPlanDate({plannedDate:'2026-11-19'},incomplete,NaN),'unverified');
  assert.equal(classifyProductionPlanDate({plannedDate:'2026-11-19'},incomplete,now),'past');
});
