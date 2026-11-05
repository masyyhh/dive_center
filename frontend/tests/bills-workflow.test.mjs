import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,nodes,button,sampleBill,text} from './helpers/bills-fixture.mjs';
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

test('Siyam World opens selected bills in the reading pane while other properties keep the modal',async()=>{
 for(const propertyName of ['Siyam World','Sun Siyam World','Iru Fushi']){
  const f=fixture({propertyName});f.render();await f.flush();
  const split=propertyName.includes('World');
  assert.equal(nodes(f.render()).some(node=>node.props?.className==='siyam-bills-split'),split);
  if(split)assert.match(text(nodes(f.render()).find(node=>node.props?.id==='bill-reading-pane')),/Select a bill/);
  nodes(f.render()).find(node=>node.props?.['aria-label']==='View bill 101').props.onClick({stopPropagation(){}});
  await f.flush();const tree=f.render();
  assert.equal(nodes(tree).some(node=>node.props?.label==='Bill details'),!split);
  if(split){
   const pane=nodes(tree).find(node=>node.props?.id==='bill-reading-pane');
   assert.match(text(pane),/Check #101/);
   assert.ok(button(pane,'Edit bill'));assert.ok(button(pane,'Rebate'));assert.ok(button(pane,'Print Bill'));
   assert.equal(nodes(tree).find(node=>node.props?.['aria-label']==='View bill 101').props['aria-pressed'],true);
   nodes(pane).find(node=>node.props?.['aria-label']==='Close bill details').props.onClick();
   assert.match(text(nodes(f.render()).find(node=>node.props?.id==='bill-reading-pane')),/Select a bill/);
  }
 }
});

test('Siyam reading pane does not display old bill details while a different selection loads',async()=>{
 const second={...sampleBill,id:'bill-2',checkNumber:102,guestName:'Second guest'};
 const f=fixture({propertyName:'Siyam World',bills:[sampleBill,second],deferDetails:true});
 f.render();await f.flush();
 const select=check=>nodes(f.render()).find(node=>node.props?.['aria-label']===`View bill ${check}`).props.onClick();
 const pane=()=>nodes(f.render()).find(node=>node.props?.id==='bill-reading-pane');
 select(101);select(102);
 assert.equal(pane().props['aria-busy'],true);
 f.pendingDetails[0]({bill:sampleBill});await f.flush();
 assert.equal(pane().props['aria-busy'],true);
 assert.doesNotMatch(text(pane()),/Check #101/);
 f.pendingDetails[1]({bill:second});await f.flush();
 assert.equal(pane().props['aria-busy'],false);
 assert.match(text(pane()),/Check #102/);
 assert.equal(nodes(f.render()).find(node=>node.props?.['aria-label']==='View bill 102').props['aria-pressed'],true);
 select(101);
 assert.doesNotMatch(text(pane()),/Check #102/);
 assert.match(text(pane()),/Loading bill details/);
});

test('Siyam detail failures can be retried from the reading pane',async()=>{
 const options={propertyName:'Siyam World',detailError:'Detail service unavailable'};
 const f=await open(options);
 const pane=()=>nodes(f.render()).find(node=>node.props?.id==='bill-reading-pane');
 assert.match(text(pane()),/Detail service unavailable/);
 assert.equal(pane().props['aria-busy'],false);
 options.detailError='';
 await button(pane(),'Retry bill details').props.onClick();await f.flush();
 assert.match(text(pane()),/Check #101/);
 assert.equal(button(pane(),'Retry bill details'),undefined);
});

test('Siyam filters clear the reading pane when the selected bill is no longer in the list',async()=>{
 const options={propertyName:'Siyam World',bills:[sampleBill]};
 const f=await open(options);
 options.bills=[];
 nodes(f.render()).find(node=>node.type==='form').props.onSubmit({preventDefault(){}});
 await f.flush();f.render();await f.flush();
 const tree=f.render();
 assert.match(text(nodes(tree).find(node=>node.props?.id==='bill-reading-pane')),/Select a bill/);
 assert.equal(nodes(tree).some(node=>node.props?.['aria-label']==='View bill 101'),false);
});

test('Siyam uses compact filters without a hidden discount-only restriction',async()=>{
 const fullPrice={...sampleBill,id:'full-price',checkNumber:102,discountAmount:0};
 for(const propertyName of ['Siyam World','Iru Fushi']){
  const f=fixture({propertyName,bills:[sampleBill,fullPrice],section:'range?startDate=2026-11-01&endDate=2026-11-05&discounted=true'});
  f.render();await f.flush();const tree=f.render();const compact=propertyName==='Siyam World';
  assert.equal(text(tree).includes('Only bills with discounts'),!compact);
  assert.equal(nodes(tree).some(node=>node.props?.className==='results-toolbar'),!compact);
  assert.equal(nodes(tree).some(node=>node.props?.['aria-label']==='View bill 102'),compact);
  if(compact){
   assert.match(text(tree),/2 bills found/);
   assert.equal(nodes(tree).find(node=>node.props?.['aria-label']==='Bills from date').props.value,'2026-11-01');
   assert.ok(nodes(tree).find(node=>node.props?.['aria-label']==='Bill status'));
  }
 }
});
