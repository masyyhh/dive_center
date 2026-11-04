import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {fixture} from './helpers/admin-fixture.mjs';
const nodes=node=>node==null||typeof node==='boolean'?[]:Array.isArray(node)?node.flatMap(nodes):!React.isValidElement(node)?[]:[node,...nodes(node.props.children)];
test('property managers can open a populated staff editor and submit typed changes to that staff member',async()=>{
 const f=fixture();f.render();await f.flush();let tree=f.render();
 const edit=nodes(tree).find(node=>node.type==='button'&&node.props['aria-label']==='Edit staff Original Name');assert.ok(edit);edit.props.onClick();tree=f.render();
 const input=nodes(tree).find(node=>node.type==='input'&&node.props.id==='adminview-field-11');assert.equal(input.props.value,'Original Name');input.props.onChange({target:{value:'Corrected Name'}});
 tree=f.render();const form=nodes(tree).find(node=>node.type==='form'&&nodes(node).some(child=>child.props?.id==='adminview-field-11'));assert.ok(form);await form.props.onSubmit({preventDefault(){}});
 const update=f.calls.find(call=>call.method==='PUT');assert.equal(update.url,'/staff/member');const body=JSON.parse(update.body);assert.equal(body.name,'Corrected Name');assert.equal(body.isActive,true);assert.equal(body.email,'old@example.com');assert.equal(body.hireDate,'2026-01-01');assert.equal('propertyId' in body,false);assert.equal('loginAccess' in body,false);
 assert.ok(f.calls.some(call=>call.url.includes('includeInactive=true')));
});
test('ordinary staff have no roster edit action',async()=>{
 const f=fixture('CENTRE_STAFF');f.render();await f.flush();const tree=f.render();assert.equal(nodes(tree).some(node=>node.type==='button'&&node.props['aria-label']==='Edit staff Original Name'),false);
});

test('only global administrators can access property creation after section extraction',async()=>{
 const global=fixture('GLOBAL_ADMIN','properties');let tree=global.render();await global.flush();tree=global.render();
 const create=nodes(tree).find(node=>node.type==='button'&&nodes(node).some(child=>child.type==='span'&&child.props.children==='New Property'));
 assert.ok(create);create.props.onClick();tree=global.render();
 assert.ok(nodes(tree).find(node=>node.props?.id==='adminview-field-1'));
 const manager=fixture('PROPERTY_MANAGER','properties');manager.render();await manager.flush();
 assert.equal(nodes(manager.render()).some(node=>node.type==='button'&&nodes(node).some(child=>child.type==='span'&&child.props.children==='New Property')),false);
});
test('closing the staff dialog discards unsaved edits without issuing an update',async()=>{
 const f=fixture();f.render();await f.flush();let tree=f.render();
 nodes(tree).find(node=>node.type==='button'&&node.props['aria-label']==='Edit staff Original Name').props.onClick();
 tree=f.render();nodes(tree).find(node=>node.props?.id==='adminview-field-11').props.onChange({target:{value:'Unsaved change'}});
 tree=f.render();nodes(tree).find(node=>node.type==='button'&&node.props.children==='Cancel').props.onClick();
 assert.equal(nodes(f.render()).some(node=>node.props?.id==='adminview-field-11'),false);
 assert.equal(f.calls.some(call=>call.method==='PUT'),false);
});
test('property deletion still requires the exact property code and cancellation sends no request',async()=>{
 const f=fixture('GLOBAL_ADMIN','properties');f.render();await f.flush();let tree=f.render();
 nodes(tree).find(node=>node.props?.['aria-label']==='Delete property Own Property').props.onClick();
 const confirm=tree=>nodes(tree).find(node=>node.type==='button'&&node.props.type==='submit'&&node.props.children==='Delete property');
 tree=f.render();assert.equal(confirm(tree).props.disabled,true);
 nodes(tree).find(node=>node.props?.id==='delete-property-code').props.onChange({target:{value:'WRONG'}});
 tree=f.render();assert.equal(confirm(tree).props.disabled,true);
 nodes(tree).find(node=>node.props?.id==='delete-property-code').props.onChange({target:{value:'OWN'}});
 tree=f.render();assert.equal(confirm(tree).props.disabled,false);
 nodes(tree).find(node=>node.type==='button'&&node.props.children==='Cancel').props.onClick();
 assert.equal(nodes(f.render()).some(node=>node.props?.id==='delete-property-code'),false);
 assert.equal(f.calls.some(call=>call.method==='DELETE'),false);
});
