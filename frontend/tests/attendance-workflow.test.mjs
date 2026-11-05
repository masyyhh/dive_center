import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,nodes,button,sampleStaff} from './helpers/attendance-fixture.mjs';
const status=tree=>nodes(tree).find(node=>node.props?.['aria-label']==='Attendance for Instructor One');
const save=tree=>nodes(tree).find(node=>node.type==='button'&&String(node.props.children?.[1]?.props?.children).startsWith('Save attendance'));
async function loaded(options={}){const f=fixture(options);f.render();await f.flush();return f;}
test('changing attendance stays local until save and preserves the property, date and notes',async()=>{
 const f=await loaded();assert.equal(f.dirty,false);
 status(f.render()).props.onChange({target:{value:'SICK'}});
 let tree=f.render();assert.equal(f.dirty,true);assert.equal(f.calls.some(c=>c.method==='POST'),false);
 await save(tree).props.onClick();await f.flush();tree=f.render();
 const request=f.calls.find(c=>c.method==='POST');assert.equal(request.url,'/presence/day');
 const body=JSON.parse(request.body);assert.equal(body.propertyId,'a');assert.equal(body.date,'2026-11-04');
 assert.deepEqual(body.records[0],{staffMemberId:'staff-1',status:'SICK',note:'Existing note'});
 assert.equal(f.dirty,false);assert.equal(save(tree).props.disabled,true);
 assert.ok(f.calls.some(c=>c.action==='release-guard'));
});
test('payroll lock checks fail closed for both managers and staff',async()=>{
 for(const role of ['PROPERTY_MANAGER','CENTRE_STAFF'])for(const locked of [true,null]){
  const f=await loaded({role,locked});const tree=f.render();
  assert.equal(status(tree).props.disabled,true);assert.equal(button(tree,'All Present').props.disabled,true);assert.equal(save(tree).props.disabled,true);
  await save(tree).props.onClick();assert.equal(f.calls.some(c=>c.method==='POST'),false);
 }
});
test('failed attendance saves retain the draft and unsaved-work protection',async()=>{
 const f=await loaded({failSave:true});status(f.render()).props.onChange({target:{value:'ANNUAL_LEAVE'}});
 await save(f.render()).props.onClick();const tree=f.render();
 assert.equal(status(tree).props.value,'ANNUAL_LEAVE');assert.equal(f.dirty,true);assert.equal(save(tree).props.disabled,false);
 assert.equal(f.calls.some(c=>c.action==='release-guard'),false);assert.ok(nodes(tree).some(n=>n.props?.children==='Save rejected'));
});
test('all-present remains an unsaved bulk edit and empty rosters cannot save',async()=>{
 const f=await loaded();button(f.render(),'All Present').props.onClick();const tree=f.render();
 assert.ok(nodes(tree).filter(n=>n.type==='select').every(n=>n.props.value==='PRESENT'));
 assert.equal(f.dirty,true);assert.equal(f.calls.some(c=>c.method==='POST'),false);
 const empty=await loaded({staff:[]});assert.equal(save(empty.render()).props.disabled,true);
});
test('changing month goes through the navigation guard and cancellation keeps the selected date',async()=>{
 const f=await loaded({blockNavigation:true});status(f.render()).props.onChange({target:{value:'SICK'}});
 nodes(f.render()).find(n=>n.props?.title==='Next month').props.onClick();
 assert.ok(f.calls.some(c=>c.action==='navigation-guard'));assert.equal(f.dirty,true);
 await f.flush();assert.equal(f.calls.some(c=>c.url?.includes('yearMonth=2026-12')),false);
});
test('unchanged recorded attendance cannot be submitted again',async()=>{
 const f=await loaded({staff:[{...sampleStaff,isSaved:true}]});assert.equal(save(f.render()).props.disabled,true);assert.equal(f.dirty,false);
});

test('the compact attendance layout applies only to Siyam World',async()=>{
 for(const name of ['Siyam World','Sun Siyam World','Olhuveli','Iru Fushi','Sun Siyam Vilu Reef']){
  const f=await loaded({propertyName:name});const tree=f.render();const compact=name.endsWith('World');
  assert.equal(nodes(tree).some(n=>n.props?.className==='siyam-attendance-roster'),compact);
  assert.equal(nodes(tree).some(n=>n.props?.id==='siyam-attendance-date'),compact);
  assert.equal(nodes(tree).filter(n=>n.type==='time').length,compact?2:0);
 }
});
test('Siyam World retains saved status until explicitly saved and preserves existing notes',async()=>{
 const f=await loaded({propertyName:'Siyam World',staff:[{...sampleStaff,isSaved:true}]});
 status(f.render()).props.onChange({target:{value:'SICK'}});let tree=f.render();
 const saved=nodes(tree).find(n=>n.props?.className==='siyam-attendance-saved');
 assert.ok(nodes(saved).some(n=>n.type==='strong'&&n.props.children==='Present'));
 assert.equal(f.calls.some(c=>c.method==='POST'),false);
 await save(tree).props.onClick();await f.flush();
 const body=JSON.parse(f.calls.find(c=>c.method==='POST').body);
 assert.equal(body.propertyId,'a');assert.equal(body.date,'2026-11-04');
 assert.deepEqual(body.records[0],{staffMemberId:'staff-1',status:'SICK',note:'Existing note'});
});
test('Siyam World date changes respect the unsaved-work guard and locked payroll prevents edits',async()=>{
 const guarded=await loaded({propertyName:'Siyam World',blockNavigation:true});
 status(guarded.render()).props.onChange({target:{value:'SICK'}});
 nodes(guarded.render()).find(n=>n.props?.id==='siyam-attendance-date').props.onChange({target:{value:'2026-11-03'}});
 assert.ok(guarded.calls.some(c=>c.action==='navigation-guard'));
 assert.equal(nodes(guarded.render()).find(n=>n.props?.id==='siyam-attendance-date').props.value,'2026-11-04');
 for(const locked of [true,null]){
  const f=await loaded({propertyName:'Siyam World',locked});const tree=f.render();
  assert.equal(status(tree).props.disabled,true);assert.equal(save(tree).props.disabled,true);
  assert.equal(button(tree,'All Present').props.disabled,true);
 }
});
