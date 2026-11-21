import test from 'node:test';
import assert from 'node:assert/strict';
import {validateModelCostBatch} from '../../web/office/wb-model-cost-bulk-core.mjs';

const good={
  familyId:'vesta',
  vendorCodes:['Веста коричневая','Vesta 3 black'],
  costKopecks:420000,validFrom:'2026-10-01',
  status:'confirmed',
  source:'Техкарта Vesta 2026 проверена',
  sameTechCardConfirmed:true,
  includesMaterialsSeamstressCutterOnly:true,
  explicitlyConfirmed:true
};
test('reviewed model group has one effective-dated unit cost but multiple actual articles',()=>{
  const model=validateModelCostBatch(good);
  assert.equal(model.familyId,'vesta');
  assert.equal(model.vendorCodes.length,2);
  assert.equal(model.costKopecks,420000);
  assert.equal(model.status,'confirmed');
  assert.equal(model.validFrom,'2026-10-01');
  assert.equal(model.source,'Техкарта Vesta 2026 проверена');
  assert.deepEqual(validateModelCostBatch(model),model);
});
test('no automatic writes for accessories, unknowns, ambiguous or wrong family',()=>{
  for(const bad of [
    {...good,familyId:'accessories'},
    {...good,familyId:'unrecognized'},
    {...good,familyId:'priora'},
    {...good,vendorCodes:['Веста коричневая','Priora 2']},
    {...good,vendorCodes:['Веста коричневая','Коврики EVA Vesta']},
    {...good,vendorCodes:['Веста коричневая','Vesta Priora combo']},
    {...good,vendorCodes:['Веста коричневая','Веста коричневая']}
  ])assert.throws(()=>validateModelCostBatch(bad),/invalid|mismatch/);
});
test('confirmation, composition, history date and source are mandatory',()=>{
  for(const bad of [
    {...good,sameTechCardConfirmed:false},
    {...good,includesMaterialsSeamstressCutterOnly:false},
    {...good,explicitlyConfirmed:false},
    {...good,validFrom:'2026-02-30'},
    {...good,source:''},
    {...good,costKopecks:0},
    {...good,costKopecks:4200.25},
    {...good,vendorCodes:[]},
    {...good,vendorCodes:Array.from({length:26},(_,i)=>'Vesta model '+i)}
  ])assert.throws(()=>validateModelCostBatch(bad));
});
test('preliminary price remains preliminary and not verified profit',()=>{
  const preliminary=validateModelCostBatch({
    ...good,status:'preliminary',explicitlyConfirmed:false
  });
  assert.equal(preliminary.status,'preliminary');
  assert.equal(preliminary.explicitlyConfirmed,false);
});
