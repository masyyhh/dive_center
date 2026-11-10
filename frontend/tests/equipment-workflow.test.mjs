import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {readFileSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
const require=createRequire(import.meta.url);
const root=new URL('../src/components/equipment/',import.meta.url);
const stock={id:'stock-1',name:'Fins',code:'FIN-M',category:'Fins',size:'M',serialNumber:null,condition:'GOOD',quantity:3,availableQuantity:3,assignedQuantity:0,damagedQuantity:0,priceCents:1500,isActive:true};
const guest={id:'guest-1',fullName:'Guest One',roomNumber:'0012',confirmationNumber:'BOOK-1',arrivalDate:'2026-11-01',checkoutDate:'2099-12-01',propertyCode:'SW',selector:{recordId:'record-1'}};
const rental={id:'rental-1',reference:'RENT-1',guestSnapshot:guest,expectedReturnDate:'2099-12-01',assignedStaffId:'staff-1',assignedStaffName:'Instructor',currency:'USD',status:'DRAFT',displayStatus:'DRAFT',version:3,totalCents:3000,lines:[{...stock,id:'line-1',stockId:stock.id,quantity:2,returnedQuantity:0}],agreements:[],history:[]};
const nodes=n=>n==null||typeof n==='boolean'?[]:Array.isArray(n)?n.flatMap(nodes):!React.isValidElement(n)?[]:[n,...nodes(n.props.children)];
const text=n=>typeof n==='string'||typeof n==='number'?String(n):Array.isArray(n)?n.map(text).join(''):React.isValidElement(n)?text(n.props.children):'';
const button=(tree,name)=>nodes(tree).find(n=>n.type==='button'&&text(n)===name);
function fixture(component,props={}){
 const values=[],calls=[];let state=0;
 const hooks={...React,useState(initial){const i=state++;if(!(i in values))values[i]=typeof initial==='function'?initial():initial;return[values[i],value=>values[i]=typeof value==='function'?value(values[i]):value];},useEffect(){}};
 const load=url=>{const module={exports:{}};const js=ts.transpileModule(readFileSync(url,'utf8').replace(/import\.meta\.env\.VITE_DEPLOYMENT_MODE/g, '"production"'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true,target:ts.ScriptTarget.ES2020}}).outputText;
 new Function('require','module','exports',js)(name=>{if(name==='react')return hooks;if(name.includes('services/api'))return{apiFetch:async(url,options)=>{calls.push({url,...options});return rental;}};if(name.includes('NavigationContext'))return{useUnsavedChanges:()=>()=>calls.push({clearGuard:true})};if(name.includes('Modal')||name.includes('TableScroll')||name.includes('DisclaimerShared'))return new Proxy({},{get:()=>()=>null});if(!name.startsWith('.'))return require(name);const base=new URL(name,url);return load(['.ts','.tsx'].map(ext=>new URL(base.href+ext)).find(existsSync));},module,module.exports);return module.exports;};
 const Component=load(new URL(component+'.tsx',root))[component];return{calls,render(){state=0;return Component(props);}};
}
test('assignment defaults to guest departure, preserves leading-zero room and validates quantity before save',async()=>{
 const f=fixture('AssignmentForm',{propertyId:'a',currency:'USD',stocks:[stock],staff:[{id:'staff-1',name:'Instructor'}],initialRental:rental,onSaved:r=>f.calls.push({saved:r}),onCancel(){}});
 let tree=f.render();assert.equal(nodes(tree).find(n=>n.type==='input'&&n.props.type==='date').props.value,'2099-12-01');assert.equal(nodes(tree).find(n=>n.type==='input'&&n.props.inputMode==='numeric').props.value,'0012');
 const quantity=()=>nodes(f.render()).find(n=>n.props?.['aria-label']==='Quantity for Fins FIN-M');quantity().props.onChange({target:{value:'4'}});
 await f.render().props.onSubmit({preventDefault(){}});assert.equal(f.calls.length,0);assert(text(f.render()).includes('available stock'));
 quantity().props.onChange({target:{value:'1.5'}});await f.render().props.onSubmit({preventDefault(){}});assert.equal(f.calls.length,0);
 quantity().props.onChange({target:{value:'2'}});await f.render().props.onSubmit({preventDefault(){}});
 const request=f.calls.find(c=>c.method);assert.equal(request.method,'PUT');assert.equal(request.url,'/equipment/rentals/rental-1');assert.deepEqual(JSON.parse(request.body),{propertyId:'a',guest:{recordId:'record-1'},expectedReturnDate:'2099-12-01',assignedStaffId:'staff-1',lines:[{stockId:'stock-1',quantity:2}],version:3});assert(f.calls.some(c=>c.clearGuard));
});
test('equipment removal updates summary and an empty assignment cannot save',async()=>{
 const f=fixture('AssignmentForm',{propertyId:'a',currency:'USD',stocks:[stock],staff:[],initialRental:rental,onSaved(){},onCancel(){}});
 assert(text(f.render()).includes('1 items · 2 units'));nodes(f.render()).find(n=>n.props?.['aria-label']==='Remove Fins FIN-M').props.onClick();assert(text(f.render()).includes('0 items · 0 units'));await f.render().props.onSubmit({preventDefault(){}});assert.equal(f.calls.length,0);
});
test('confirmation only enables for an agreement signed against the current draft version',()=>{
 for(const [agreements,disabled] of [[[],true],[[{version:2,session:{record:{id:'signed'}}}],true],[[{version:3,session:{record:{id:'signed'}}}],false]]){
 const f=fixture('RentalDetail',{rental:{...rental,agreements},propertyId:'a',busy:false,onAction(){},onRefresh(){},onAdditional(){},onEdit(){}});assert.equal(button(f.render(),'Confirm & assign equipment').props.disabled,disabled);
 }
});
test('return entry rejects fractions and excessive quantities without opening confirmation or making a request',()=>{
 const f=fixture('RentalDetail',{rental:{...rental,status:'ACTIVE',displayStatus:'ACTIVE'},propertyId:'a',busy:false,onAction(){},onRefresh(){},onAdditional(){},onEdit(){}});
 for(const value of ['3','1.5']){nodes(f.render()).find(n=>n.props?.['aria-label']==='Return quantity for Fins FIN-M').props.onChange({target:{value}});button(f.render(),'Record selected returns').props.onClick();assert(text(f.render()).includes('Return quantities must be whole'));assert.equal(f.calls.length,0);}
});
