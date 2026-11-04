import {readFileSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import React from 'react';
import ts from 'typescript';
const require=createRequire(import.meta.url);
const property={id:'own',name:'Own Property',code:'OWN',currencySymbol:'$'};
const staff={id:'member',propertyId:'own',name:'Original Name',email:'old@example.com',roleTitle:'Instructor',hireDate:'2026-01-01',leavingDate:null,isActive:true,isDiveStaff:true,isCoursePoolSharing:true,isDivePoolSharing:true,isBaseLeaderOverride:false};
export function fixture(role='PROPERTY_MANAGER', section='staff', sourceFile=new URL('../../src/components/AdminView.tsx',import.meta.url)){
 const values=[],refs=[],effects=[];let state=0,ref=0,effect=0,pending=[];const calls=[];
 const hooks={...React,useState(initial){const index=state++;if(!(index in values))values[index]=typeof initial==='function'?initial():initial;return[values[index],next=>{values[index]=typeof next==='function'?next(values[index]):next;}];},useRef(initial){const index=ref++;return refs[index]??=( {current:initial});},useEffect(callback,deps){const index=effect++;if(!effects[index]||deps.some((value,i)=>!Object.is(value,effects[index][i]))){effects[index]=deps;pending.push(callback);}}};
 const api=async(url,options={})=>{calls.push({url,...options});if(options.method==='PUT')return{staff:{...staff,...JSON.parse(options.body)}};if(url.startsWith('/staff/role-titles'))return{roleTitles:['Instructor','Photographer']};if(url.startsWith('/staff?'))return{staff:[staff]};if(url==='/users')return{users:[]};if(url.startsWith('/items?'))return{items:[],categories:[]};if(url.startsWith('/audit?'))return{logs:[],nextCursor:null};throw Error('Unexpected request '+url);};
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
 const adminComponents=new Set();
 const componentRoot=new URL('../../src/components/',import.meta.url);
 const canonical=url=>url.pathname.replace(/\.(tsx|ts)$/,'');
 const byPath=Object.fromEntries(Object.entries(stubs).filter(([name])=>name.startsWith('.')).map(([name,value])=>[canonical(new URL(name, new URL('AdminView.tsx',componentRoot))),value]));
 function load(url){
  const source=readFileSync(url,'utf8');
  const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  const module={exports:{}};
  new Function('require','module','exports','setTimeout',js)(name=>{
   if(name==='react')return hooks;
   if(!name.startsWith('.'))return require(name);
   const base=new URL(name,url.pathname==='/tmp/AdminView-before.tsx'?new URL('AdminView.tsx',componentRoot):url);
   const stub=byPath[canonical(base)];if(stub)return stub;
   const resolved=['.ts','.tsx'].map(ext=>new URL(base.href+ext)).find(existsSync);
   if(resolved.pathname.includes('/components/')&&!resolved.pathname.includes('/components/admin/'))return components;
   const result=load(resolved);
   if(resolved.pathname.includes('/components/admin/'))for(const value of Object.values(result))if(typeof value==='function')adminComponents.add(value);
   return result;
  },module,module.exports,()=>0);
  return module.exports;
 }
 const {AdminView}=load(sourceFile);
 function expand(node){
  if(Array.isArray(node))return node.map((child,index)=>{const value=expand(child);return React.isValidElement(value)?React.cloneElement(value,{key:value.key??index}):value;});
  if(!React.isValidElement(node))return node;
  if(adminComponents.has(node.type))return expand(node.type(node.props));
  return node.props.children===undefined?node:React.cloneElement(node,{},expand(node.props.children));
 }
 const render=()=>{state=0;ref=0;effect=0;return expand(AdminView({section,onSectionChange(){}}));};
 const flush=async()=>{const current=pending;pending=[];for(const effect of current)effect();for(let i=0;i<8;i++)await Promise.resolve();};
 return{render,flush,calls};
}
