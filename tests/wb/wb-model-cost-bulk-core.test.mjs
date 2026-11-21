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

test('server rejects any attempt to bulk-set seat-cover cost on door-card SKUs',()=>{
  const door='карты_лада_веста_красные_соты';
  assert.throws(()=>validateModelCostBatch({
    ...good,vendorCodes:['Веста коричневая',door]
  }),/family_mismatch/);
  assert.throws(()=>validateModelCostBatch({
    ...good,vendorCodes:[door]
  }),/family_mismatch/);
  const isolated=validateModelCostBatch({
    ...good,familyId:'door_inserts',vendorCodes:[door],
    source:'Внутренний расчёт дверных вставок: материал и пошив',
    status:'preliminary',explicitlyConfirmed:false
  });
  assert.equal(isolated.familyId,'door_inserts');
  assert.equal(isolated.status,'preliminary');
  assert.equal(isolated.vendorCodes[0],door);
});
test('a documented internal costing explanation is valid without invented tech-card number',()=>{
  const model=validateModelCostBatch({...good,
    source:'Внутренний расчёт: материалы, швея, закройщик',
    status:'preliminary',explicitlyConfirmed:false
  });
  assert.match(model.source,/Внутренний расчёт/);
});
