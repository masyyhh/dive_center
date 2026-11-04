import {readFileSync, existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import React from 'react';
import ts from 'typescript';
const require=createRequire(import.meta.url);
const root=new URL('../../src/components/',import.meta.url);
export const sampleStaff={staffMemberId:'staff-1',staffName:'Instructor One',roleTitle:'Instructor',isCoursePoolSharing:true,isDivePoolSharing:true,isBaseLeaderOverride:false,status:'PRESENT',note:'Existing note',isSaved:false};

export function fixture(options={}){
 const values=[],refs=[],effects=[],calls=[];let state=0,ref=0,effect=0,pending=[];
 const staff=options.staff??[{...sampleStaff},{...sampleStaff,staffMemberId:'staff-2',staffName:'Instructor Two',status:'OFF'}];let dirty=false;
 const hooks={...React,useState(initial){const index=state++;if(!(index in values))values[index]=typeof initial==='function'?initial():initial;return[values[index],value=>{values[index]=typeof value==='function'?value(values[index]):value;}];},useRef(initial){const index=ref++;return refs[index]??={current:initial};},useEffect(callback,deps){const index=effect++;if(!effects[index]||deps.some((value,i)=>!Object.is(value,effects[index][i]))){effects[index]=deps;pending.push(callback);}}};
 const property={id:'a',name:'Test Property',currencySymbol:'$'};
 const api=async(url,request={})=>{
  calls.push({url,...request});
  if(request.method==='POST'){
   if(options.failSave)throw Error('Save rejected');
   return{};
  }
  if(url.startsWith('/presence/month-status'))return options.monthStatus??{yearMonth:'2026-11',missingDaysCount:1,dayStatuses:{'2026-11-04':{status:'partial',markedCount:1,expectedCount:2}}};
  if(url.startsWith('/presence/day?'))return{date:new URL('http://test'+url).searchParams.get('date'),staff};
  throw Error('Unexpected request '+url);
 };

 const stubs={
  '../context/AuthContext':{useAuth:()=>({user:{role:options.role??'PROPERTY_MANAGER'}})},
  '../context/PropertyContext':{useProperty:()=>({activeProperty:property})},
  '../hooks/useMonthLock':{useMonthLock:()=>({locked:options.locked===undefined?false:options.locked,error:'',retry(){}})},
  '../services/api':{apiFetch:api},
  '../context/NavigationContext':{useNavigation:()=>({requestNavigation:action=>{calls.push({action:'navigation-guard'});if(!options.blockNavigation)action();}}),useUnsavedChanges:value=>{dirty=value;return()=>calls.push({action:'release-guard'});}},
 };
 const normalize=url=>url.pathname.replace(/\.(tsx|ts)$/,'');
 const byPath=Object.fromEntries(Object.entries(stubs).map(([name,value])=>[normalize(new URL(name,new URL('PresenceView.tsx',root))),value]));
 const components=new Set();
 function load(url){
  const js=ts.transpileModule(readFileSync(url,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  const module={exports:{}};
  new Function('require','module','exports',js)(name=>{
   if(name==='react')return hooks;
   if(!name.startsWith('.'))return require(name);
   const base=new URL(name,url.pathname==='/tmp/PresenceView-before.tsx'?new URL('PresenceView.tsx',root):url);
   if(byPath[normalize(base)])return byPath[normalize(base)];
   const target=['.ts','.tsx'].map(ext=>new URL(base.href+ext)).find(existsSync);
   const result=load(target);
   if(target.pathname.includes('/components/attendance/'))for(const value of Object.values(result))if(typeof value==='function')components.add(value);
   return result;
  },module,module.exports);
  return module.exports;
 }
 const {PresenceView}=load(options.sourceFile??new URL('PresenceView.tsx',root));
 function expand(node){
  if(Array.isArray(node))return node.map((child,index)=>{const value=expand(child);return React.isValidElement(value)?React.cloneElement(value,{key:value.key??index}):value;});
  if(!React.isValidElement(node))return node;
  if(components.has(node.type))return expand(node.type(node.props));
  return node.props.children===undefined?node:React.cloneElement(node,{},expand(node.props.children));
 }
 const render=()=>{state=0;ref=0;effect=0;return expand(PresenceView({initialDate:options.date??'2026-11-04',onSetup(){calls.push({action:'setup'});},onPayroll(){calls.push({action:'payroll'});}}));};
 const flush=async()=>{const current=pending;pending=[];for(const callback of current)callback();for(let i=0;i<10;i++)await Promise.resolve();};
 return{render,flush,calls,get dirty(){return dirty;}};
}
export const nodes=node=>node==null||typeof node==='boolean'?[]:Array.isArray(node)?node.flatMap(nodes):!React.isValidElement(node)?[]:[node,...nodes(node.props.children)];
export const text=node=>typeof node==='string'?node:Array.isArray(node)?node.map(text).join(''):React.isValidElement(node)?text(node.props.children):'';
export const button=(tree,name)=>nodes(tree).find(node=>node.type==='button'&&text(node)===name);
