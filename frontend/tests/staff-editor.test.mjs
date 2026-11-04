import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import React from 'react';
import ts from 'typescript';
const require=createRequire(import.meta.url);
const property={id:'own',name:'Own Property',code:'OWN',currencySymbol:'$'};
const staff={id:'member',propertyId:'own',name:'Original Name',email:'old@example.com',roleTitle:'Instructor',hireDate:'2026-01-01',leavingDate:null,isActive:true,isDiveStaff:true,isCoursePoolSharing:true,isDivePoolSharing:true,isBaseLeaderOverride:false};
function fixture(role='PROPERTY_MANAGER'){
 const values=[],refs=[],effects=[];let state=0,ref=0,effect=0,pending=[];const calls=[];
 const hooks={...React,useState(initial){const index=state++;if(!(index in values))values[index]=typeof initial==='function'?initial():initial;return[values[index],next=>{values[index]=typeof next==='function'?next(values[index]):next;}];},useRef(initial){const index=ref++;return refs[index]??=( {current:initial});},useEffect(callback,deps){const index=effect++;if(!effects[index]||deps.some((value,i)=>!Object.is(value,effects[index][i]))){effects[index]=deps;pending.push(callback);}}};
 const api=async(url,options={})=>{calls.push({url,...options});if(options.method==='PUT')return{staff:{...staff,...JSON.parse(options.body)}};if(url.startsWith('/staff/role-titles'))return{roleTitles:['Instructor','Photographer']};if(url.startsWith('/staff?'))return{staff:[staff]};throw Error('Unexpected request '+url);};
 const stubs={
  react:hooks,
  '../context/AuthContext':{useAuth:()=>({user:{id:'manager',role,assignedProperties:[property]},refreshUser(){}})},
  '../context/PropertyContext':{useProperty:()=>({activeProperty:property,properties:[property],refreshProperties(){},setActiveProperty(){}})},
  '../context/NavigationContext':{useNavigation:()=>({requestNavigation(){}}),useUnsavedChanges(){}},
  '../services/api':{apiFetch:api},
  './Modal':{Modal:({children})=>React.createElement('div',null,children)},
  './PasswordRecoveryView':{passwordHelp:'Password help',passwordPattern:'.*'},
 };
 const components=new Proxy({},{get:()=>()=>null});
 function load(url){const source=readFileSync(url,'utf8');const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText;const module={exports:{}};new Function('require','module','exports','setTimeout',js)(name=>name in stubs?stubs[name]:name.startsWith('./')&&url.pathname.endsWith('/AdminView.tsx')?components:name.startsWith('.')?load(new URL(name+'.ts',url)):require(name),module,module.exports,()=>0);return module.exports;}
 const {AdminView}=load(new URL('../src/components/AdminView.tsx',import.meta.url));
 const render=()=>{state=0;ref=0;effect=0;return AdminView({section:'staff',onSectionChange(){}});};
 const flush=async()=>{const current=pending;pending=[];for(const effect of current)effect();for(let i=0;i<8;i++)await Promise.resolve();};
 return{render,flush,calls};
}
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
