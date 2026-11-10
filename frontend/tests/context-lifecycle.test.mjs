import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const deferred = () => { let resolve, reject; const promise = new Promise((yes,no) => { resolve=yes; reject=no; }); return { promise, resolve, reject }; };
class ApiError extends Error { constructor(message,status) { super(message);this.status=status; } }
function provider(file, name, dependencies, props = {}, extract = node => node.props.value) {
 const states=[],refs=[],effects=[];let si=0,ri=0,ei=0,pending=[];
 const hooks={...React,useState(initial){const i=si++;if(!(i in states))states[i]=typeof initial==='function'?initial():initial;return[states[i],v=>{states[i]=typeof v==='function'?v(states[i]):v;}];},useRef(initial){return refs[ri++]??={current:initial};},useEffect(callback,deps){const i=ei++;if(!effects[i]||deps.some((v,j)=>!Object.is(v,effects[i].deps[j]))){const old=effects[i];effects[i]={deps,cleanup:null};pending.push(()=>{old?.cleanup?.();effects[i].cleanup=callback();});}}};
 const js=ts.transpileModule(readFileSync(new URL('../src/context/'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
 const module={exports:{}};new Function('require','module','exports',js)(dep=>dep==='react'?hooks:dep in dependencies?dependencies[dep]:require(dep),module,module.exports);
 const render=()=>{si=ri=ei=0;return extract(module.exports[name]({children:null,...props}));};
 const effectsRun=()=>{const batch=pending;pending=[];batch.forEach(callback=>callback());};
 return {render,effectsRun};
}
test('stale profile refreshes cannot overwrite a new login or restore a signed-out user',async()=>{
 let token='old';const old=deferred();
 const api={ApiError,getAuthToken:()=>token,setAuthToken:value=>{token=value;},apiFetch:async endpoint=>endpoint==='/auth/login'?{token:'new',user:{id:'new-user'}}:old.promise,revokeSession:async()=>{token=null;},connectTestingLiveSignIn:async()=>({token:'new',user:{id:'new-user'}})};
 const f=provider('AuthContext.tsx','AuthProvider',{'../services/api':api});
 let value=f.render();const refresh=value.refreshUser();await value.login('login','password');old.resolve({user:{id:'old-user'}});await refresh;
 assert.equal(token,'new');assert.equal(f.render().user.id,'new-user');
 const pending=deferred();api.apiFetch=()=>pending.promise;value=f.render();const another=value.refreshUser();await value.logout();pending.resolve({user:{id:'new-user'}});await another;
 assert.equal(f.render().user,null);assert.equal(token,null);
});
test('temporary profile failures preserve a valid session but 401 clears it',async()=>{
 let token='valid';let failure=new Error('Temporary outage');
 const api={ApiError,getAuthToken:()=>token,setAuthToken:value=>{token=value;},apiFetch:async endpoint=>{if(endpoint==='/auth/login')return{token:'valid',user:{id:'user'}};throw failure;}};
 const f=provider('AuthContext.tsx','AuthProvider',{'../services/api':api});await f.render().login('login','password');await f.render().refreshUser();
 assert.equal(f.render().user.id,'user');assert.equal(token,'valid');failure=new ApiError('Expired',401);await f.render().refreshUser();assert.equal(token,null);assert.equal(f.render().user,null);
});
test('an old properties response cannot repopulate the workspace after sign out',async()=>{
 let user={id:'one',authenticatorEnabled:true,role:'GLOBAL_ADMIN'};let stored='a';const response=deferred();
 const f=provider('PropertyContext.tsx','PropertyProvider',{'./AuthContext':{useAuth:()=>({user})},'../services/api':{apiFetch:()=>response.promise,getStoredPropertyId:()=>stored,setStoredPropertyId:value=>{stored=value;}}});
 f.render();f.effectsRun();user=null;f.render();f.effectsRun();response.resolve({properties:[{id:'a',name:'Old property'}]});await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(f.render().properties,[]);assert.equal(f.render().activeProperty,null);assert.equal(stored,null);assert.equal(f.render().loading,false);
});


test('a recompute finishing after a property switch cannot reload the previous property report',async()=>{
 let property={id:'a',currencySymbol:'$'};const recompute=deferred();const requests=[];
 const Panel=()=>null;
 const apiFetch=async(url,options={})=>{requests.push(url);if(url==='/reports/recompute')return recompute.promise;return {source:url,period:{isLocked:false},headline:{certificationPoolTotal:0}};};
 const dependencies={
  '../utils/dashboardNavigation':{investigationPeriod:()=>null},'../utils/csv':{serializeCsv:()=>''},'../utils/format':{formatMoney:value=>String(value)},
  './Modal':{Modal:()=>null},'./PayrollBreakdown':{PayrollBreakdown:()=>null},'../utils/dates':{businessToday:()=> '2026-11-09',isBusinessDate:value=>/^\d{4}-\d{2}-\d{2}$/.test(value),monthRange:()=>({start:'2026-11-01',end:'2026-11-30'})},
  '../context/PropertyContext':{useProperty:()=>({activeProperty:property})},'../context/AuthContext':{useAuth:()=>({user:{role:'GLOBAL_ADMIN'}})},'../services/api':{apiFetch},
  './reporting/PerformancePanel':{PerformancePanel:Panel},'./reporting/CommissionPanel':{CommissionPanel:Panel},'./reporting/ExportPanel':{ExportPanel:Panel},
 };
 const f=provider('../components/ReportingView.tsx','ReportingView',dependencies,{section:'commissions',onSectionChange(){}},node=>node);
 const nodes=node=>!React.isValidElement(node)?[]:[node,...React.Children.toArray(node.props.children).flatMap(nodes)];
 const panel=()=>nodes(f.render()).find(node=>node.type===Panel);
 f.render();f.effectsRun();await new Promise(resolve=>setImmediate(resolve));
 const pending=panel().props.handleRecompute();property={id:'b',currencySymbol:'$'};f.render();f.effectsRun();await new Promise(resolve=>setImmediate(resolve));
 assert.match(panel().props.report.source,/propertyId=b/);
 recompute.resolve({});await pending;
 assert.equal(requests.filter(url=>url.includes('propertyId=a')).length,1);
 assert.match(panel().props.report.source,/propertyId=b/);
});


test('property load failures are retryable and distinct from an empty assigned-property list',async()=>{
 let fail=true;const user={id:'one',authenticatorEnabled:true,role:'GLOBAL_ADMIN'};
 const f=provider('PropertyContext.tsx','PropertyProvider',{'./AuthContext':{useAuth:()=>({user})},'../services/api':{apiFetch:async()=>{if(fail)throw Error('Server unavailable');return{properties:[{id:'a',name:'Property'}]};},getStoredPropertyId:()=>null,setStoredPropertyId(){}}});
 await f.render().refreshProperties();assert.equal(f.render().error,'Server unavailable');assert.equal(f.render().loading,false);
 fail=false;await f.render().refreshProperties();assert.equal(f.render().error,'');assert.equal(f.render().activeProperty.id,'a');
});
