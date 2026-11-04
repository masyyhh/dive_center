import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,nodes,button,sampleBill} from './helpers/bills-fixture.mjs';
async function open(options={}){
 const f=fixture(options);f.render();await f.flush();
 nodes(f.render()).find(node=>node.props?.['aria-label']==='View bill 101').props.onClick({stopPropagation(){}});
 await f.flush();return f;
}
test('posted bill editor remains limited to managers/admins and open payroll months',async()=>{
 for(const role of ['GLOBAL_ADMIN','PROPERTY_MANAGER','CENTRE_STAFF']){
  for(const locked of [false,true]){
   const f=await open({role,locked});const edit=button(f.render(),'Edit bill');
   if(role==='CENTRE_STAFF')assert.equal(edit,undefined);
   else {assert.ok(edit);assert.equal(edit.props.disabled,locked);}
  }
 }
});
test('rebates require a reason and submit it to the selected bill',async()=>{
 const f=await open();button(f.render(),'Rebate').props.onClick();
 assert.equal(button(f.render(),'Confirm Rebate').props.disabled,true);
 nodes(f.render()).find(node=>node.props?.id==='billsview-field-2').props.onChange({target:{value:'  Medical cancellation  '}});
 assert.equal(button(f.render(),'Confirm Rebate').props.disabled,false);
 await button(f.render(),'Confirm Rebate').props.onClick();await f.flush();
 const request=f.calls.find(call=>call.url.endsWith('/rebate'));
 assert.equal(request.url,'/bills/bill-1/rebate');assert.equal(request.method,'POST');
 assert.deepEqual(JSON.parse(request.body),{reason:'Medical cancellation'});
});
test('re-dating submits the selected date without changing bill financial fields',async()=>{
 const f=await open();button(f.render(),'Re-date').props.onClick();
 nodes(f.render()).find(node=>node.props?.id==='billsview-field-1').props.onChange({target:{value:'2026-08-05'}});
 await button(f.render(),'Apply Re-date').props.onClick();await f.flush();
 const request=f.calls.find(call=>call.url.endsWith('/re-date'));
 assert.equal(request.url,'/bills/bill-1/re-date');assert.deepEqual(JSON.parse(request.body),{newDate:'2026-08-05'});
});
test('soft delete remains a confirmation step; cancelling does not delete the bill',async()=>{
 const f=await open();button(f.render(),'Delete').props.onClick();
 const dialog=nodes(f.render()).find(node=>node.props?.label==='Delete bill');
 assert.ok(dialog);button(dialog,'Cancel').props.onClick();assert.equal(f.calls.some(call=>call.method==='DELETE'),false);
 button(f.render(),'Delete').props.onClick();await button(f.render(),'Confirm Soft Delete').props.onClick();await f.flush();
 assert.equal(f.calls.find(call=>call.method==='DELETE').url,'/bills/bill-1');
 assert.equal(nodes(f.render()).some(node=>node.props?.label==='Bill details'),false);
});
test('older detail responses cannot replace a newer selection',async()=>{
 const f=fixture({deferDetails:true});f.render();await f.flush();
 const click=()=>nodes(f.render()).find(node=>node.props?.['aria-label']==='View bill 101').props.onClick({stopPropagation(){}});
 click();click();assert.equal(f.pendingDetails.length,2);
 f.pendingDetails[1]({bill:{...sampleBill,guestName:'Latest selection'}});await f.flush();
 f.pendingDetails[0]({bill:{...sampleBill,guestName:'Stale selection'}});await f.flush();
 assert.ok(nodes(f.render()).some(node=>node.props?.children==='Latest selection'));
 assert.equal(nodes(f.render()).some(node=>node.props?.children==='Stale selection'),false);
});
