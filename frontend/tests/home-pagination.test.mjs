import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';
const require=createRequire(import.meta.url);

test('overview totals use the full report day when recent bills contain only a partial page',()=>{
 const today='2026-11-09';
 const report={headline:{turnover:20000,billCount:100,averageBill:200},period:{isLocked:false},charts:{dailyTrends:[{date:today,revenue:20000,billsCount:100}]}};
 const bills=Array.from({length:6},(_,i)=>({id:String(i),checkNumber:100+i,guestName:'Recent guest',roomNumber:'101',status:'ACTIVE',netAmount:10}));
 const values=['line',false,'',report,null,null,bills,true];let index=0;
 const hooks={...React,useState:()=>[values[index++],()=>{}],useEffect(){}};
 const root=new URL('../src/components/HomeDashboard.tsx',import.meta.url);
 const stubs={react:hooks,
  '../context/PropertyContext':{useProperty:()=>({activeProperty:{id:'a',name:'Centre',currency:'USD',currencySymbol:'$'}})},
  '../context/AuthContext':{useAuth:()=>({user:{role:'PROPERTY_MANAGER'}})},
  '../services/api':{apiFetch(){throw Error('Effects disabled');}},
  './SetupChecklist':{SetupChecklist:()=>null},
  './TableScroll':{TableScroll:({children})=>children},
  '../utils/dates':{businessToday:()=>today,displayDate:date=>date},
  recharts:Object.fromEntries(['ResponsiveContainer','BarChart','Bar','LineChart','Line','XAxis','YAxis','Tooltip','CartesianGrid'].map(name=>[name,()=>null])),
 };
 function load(url){
  const module={exports:{}};
  const js=ts.transpileModule(readFileSync(url,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  new Function('require','module','exports',js)(name=>{
   if(name in stubs)return stubs[name];
   if(!name.startsWith('.'))return require(name);
   const base=new URL(name,url),target=['.ts','.tsx'].map(ext=>new URL(base.href+ext)).find(existsSync);
   return load(target);
  },module,module.exports);
  return module.exports;
 }
 const html=renderToStaticMarkup(load(root).HomeDashboard({onNavigate(){}}));
 assert.match(html,/\$20,000\.00/);
 assert.match(html,/100 active bills today/);
 assert.doesNotMatch(html,/\$60\.00|6 active bills today/);
 assert.equal((html.match(/Recent guest/g)||[]).length,6);
});
