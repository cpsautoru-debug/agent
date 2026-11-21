import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateFinanceProductLinkDraft,validatedFinanceProductLinkRead
} from '../../web/office/finance-product-links-core.mjs';

const sample={
  wbVendorCode:'веста №2',ozonSku:'OZ-VESTA-2',
  verifiedFrom:'2026-11-21',
  evidence:'Сверены фотографии, крой, материал и комплектация сидений',
  identicalPhysicalProduct:true,noAutomaticCostTransfer:true
};
test('a link requires two owner attestations and evidence, never copies a price',()=>{
  const value=validateFinanceProductLinkDraft(sample);
  assert.equal(value.wbVendorCode,'веста №2');
  assert.equal(value.ozonSku,'OZ-VESTA-2');
  assert.equal(value.verifiedFrom,'2026-11-21');
  assert.equal(Object.hasOwn(value,'costKopecks'),false);
  assert.equal(Object.hasOwn(value,'status'),false);
  assert.deepEqual(validateFinanceProductLinkDraft(value),value);
});
test('no automatic links from model name, weak source or incomplete verification',()=>{
  for(const invalid of [
    {...sample,wbVendorCode:''},
    {...sample,ozonSku:' '},
    {...sample,evidence:'Vesta'},
    {...sample,identicalPhysicalProduct:false},
    {...sample,noAutomaticCostTransfer:false},
    {...sample,verifiedFrom:'2026-02-30'},
    {...sample,verifiedFrom:'2026-11-21junk'},
    {...sample,wbVendorCode:'Vesta\nWith new line'},
    {...sample,ozonSku:'OZ-1 '},
  ])assert.throws(()=>validateFinanceProductLinkDraft(invalid));
});
test('read validates unique 1:1 verified links and hides actor and cost values',()=>{
  const db={
    wb_vendor_code:'веста №2',ozon_sku:'OZ-VESTA-2',
    ozon_seller_article:'VESTA_BROWN_2',model_name:'Lada Vesta',
    verified_from:'2026-11-21',evidence:sample.evidence,
    actor:'private-sub'
  };
  const links=validatedFinanceProductLinkRead([db]);
  assert.equal(links[0].costTransferred,false);
  assert.equal(links[0].status,'verified_identity_only');
  assert.equal(Object.hasOwn(links[0],'actor'),false);
  assert.equal(Object.hasOwn(links[0],'costKopecks'),false);
  assert.throws(()=>validatedFinanceProductLinkRead([db,db]));
  assert.throws(()=>validatedFinanceProductLinkRead([
    db,{...db,wb_vendor_code:'another-wb'}
  ]));
  assert.throws(()=>validatedFinanceProductLinkRead(null));
});
