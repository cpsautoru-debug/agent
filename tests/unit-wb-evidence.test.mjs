import test from 'node:test';
import assert from 'node:assert/strict';
import {wbUnitEvidence} from '../web/office/unit-wb-evidence.mjs';
const article={vendorCode:'Vesta',soldUnits:20,returnedUnits:3,unknownSoldUnits:0,unverifiedCostSoldUnits:0,payoutKopecks:14000000,platformFeesKopecks:2000000,knownManufacturingCogsKopecks:7400000,contributionAfterKnownCogsKopecks:6600000,blockers:[]};
const data={code:'wb_unit_economics_preview',source:'WB_FINANCE_API_D1',costEvidenceScope:'SOLD_UNITS_IN_COMPLETED_REPORTS_NOT_CALENDAR_MONTH',readOnly:true,changedRecords:0,reconciliation:'matched',articles:[article]};
test('reconciled evidence never authorizes advertising',()=>{const [a]=wbUnitEvidence(data);assert.equal(a.cost,7400000);assert.equal(a.contribution,6600000);assert.equal(a.approvedBudget,null);assert.equal(a.review,'Проверить возвраты');});
test('reject invalid scope, mutation, reconciliation and duplicates',()=>{for(const patch of [{costEvidenceScope:'month'},{readOnly:false},{changedRecords:1},{reconciliation:'failed'},{articles:[article,article]}])assert.equal(wbUnitEvidence({...data,...patch}),null);});
test('unknown costs and blockers suppress contribution',()=>{for(const patch of [{unknownSoldUnits:1},{unverifiedCostSoldUnits:1},{blockers:['unallocated']}]){const [a]=wbUnitEvidence({...data,articles:[{...article,...patch}]});assert.equal(a.contribution,null);assert.equal(a.approvedBudget,null);}});
test('zero sales excluded; negative payout retained',()=>{const [a]=wbUnitEvidence({...data,articles:[{...article,payoutKopecks:-10},{...article,vendorCode:'zero',soldUnits:0}]});assert.equal(a.payout,-10);assert.equal(a.sku,'Vesta');});
