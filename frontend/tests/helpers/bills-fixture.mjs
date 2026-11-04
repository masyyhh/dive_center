import {readFileSync, existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import React from 'react';
import ts from 'typescript';
const require=createRequire(import.meta.url);
const root=new URL('../../src/components/',import.meta.url);
export const sampleBill={id:'bill-1',propertyId:'a',checkNumber:101,businessDate:'2026-08-04',guestName:'Test Guest',roomNumber:'0012',nationality:'Other',departureDate:null,grossAmount:200,discountAmount:50,serviceChargeAmount:15,taxAmount:26.4,tipAmount:0,netAmount:191.4,status:'ACTIVE',items:[],updatedAt:'v1'};
export function fixture(options={}){
 const values=[],refs=[],effects=[],calls=[],pendingDetails=[];let state=0,ref=0,effect=0,pending=[];
 let bill={...sampleBill,...options.bill};
 const hooks={...React,useState(initial){const index=state++;if(!(index in values))values[index]=typeof initial==='function'?initial():initial;return[values[index],value=>{values[index]=typeof value==='function'?value(values[index]):value;}];},useRef(initial){const index=ref++;return refs[index]??={current:initial};},useEffect(callback,deps){const index=effect++;if(!effects[index]||deps.some((value,i)=>!Object.is(value,effects[index][i]))){effects[index]=deps;pending.push(callback);}}};
 const property={id:'a',name:'Test Property',currencySymbol:'$'};
 const api=async(url,request={})=>{
  calls.push({url,...request});
  if(request.method==='DELETE')return{};
  if(request.method==='POST'){
   const body=JSON.parse(request.body);
   if(url.endsWith('/rebate'))bill={...bill,status:'REBATED',rebateReason:body.reason};
   if(url.endsWith('/re-date'))bill={...bill,businessDate:body.newDate};
   return{bill};
  }
  if(url.startsWith('/bills?'))return{bills:options.bills??[bill]};
  if(url.startsWith('/bills/'))return options.deferDetails?new Promise(resolve=>pendingDetails.push(resolve)):{bill};
  throw Error('Unexpected request '+url);
 };
 const stubs={
  '../context/AuthContext':{useAuth:()=>({user:{role:options.role??'PROPERTY_MANAGER'}})},
  '../context/PropertyContext':{useProperty:()=>({activeProperty:property})},
  '../hooks/useMonthLock':{useMonthLock:()=>({locked:options.locked??false,error:'',retry(){}})},
  '../services/api':{apiFetch:api},
  './Modal':{Modal:({children,label})=>React.createElement('div',{role:'dialog','aria-label':label},children)},
  './NewBillView':{NewBillView:()=>null},
 };
 const normalize=url=>url.pathname.replace(/\.(tsx|ts)$/,'');
 const byPath=Object.fromEntries(Object.entries(stubs).map(([name,value])=>[normalize(new URL(name,new URL('BillsView.tsx',root))),value]));
 const components=new Set();
 function load(url){
  const js=ts.transpileModule(readFileSync(url,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  const module={exports:{}};
  new Function('require','module','exports',js)(name=>{
   if(name==='react')return hooks;
   if(!name.startsWith('.'))return require(name);
   const base=new URL(name,url.pathname==='/tmp/BillsView-before.tsx'?new URL('BillsView.tsx',root):url);
   if(byPath[normalize(base)])return byPath[normalize(base)];
   const target=['.ts','.tsx'].map(ext=>new URL(base.href+ext)).find(existsSync);
   const result=load(target);
   if(target.pathname.includes('/components/bills/'))for(const value of Object.values(result))if(typeof value==='function')components.add(value);
   return result;
  },module,module.exports);
  return module.exports;
 }
 const {BillsView}=load(options.sourceFile??new URL('BillsView.tsx',root));
 function expand(node){
  if(Array.isArray(node))return node.map((child,index)=>{const value=expand(child);return React.isValidElement(value)?React.cloneElement(value,{key:value.key??index}):value;});
  if(!React.isValidElement(node))return node;
  if(components.has(node.type))return expand(node.type(node.props));
  return node.props.children===undefined?node:React.cloneElement(node,{},expand(node.props.children));
 }
 const render=()=>{state=0;ref=0;effect=0;return expand(BillsView({section:options.section,savedCheck:options.savedCheck??null,onDismissSaved(){},onSetup(){}}));};
 const flush=async()=>{const current=pending;pending=[];for(const callback of current)callback();for(let i=0;i<10;i++)await Promise.resolve();};
 return{render,flush,calls,pendingDetails};
}
export const nodes=node=>node==null||typeof node==='boolean'?[]:Array.isArray(node)?node.flatMap(nodes):!React.isValidElement(node)?[]:[node,...nodes(node.props.children)];
export const text=node=>typeof node==='string'?node:Array.isArray(node)?node.map(text).join(''):React.isValidElement(node)?text(node.props.children):'';
export const button=(tree,name)=>nodes(tree).find(node=>node.type==='button'&&text(node)===name);
