#!/usr/bin/env node
// Synthetic data only. Never accepts an application/production database URL.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { execFileSync, spawnSync } = require('node:child_process');
const { PrismaClient } = require('@prisma/client');
const root = path.resolve(__dirname,'..');
const output = path.resolve(root,'../outputs/five-year-benchmark');
fs.mkdirSync(output,{recursive:true});

function request(router,method,url,data) {
 return new Promise((resolve,reject)=>{
  const req={method,url,body:{},query:{},params:{},headers:{},...data};
  const res={statusCode:200,status(code){this.statusCode=code;return this;},json(body){resolve({status:this.statusCode,body});return this;}};
  router.handle(req,res,error=>reject(error||Error('Route did not respond')));
 });
}

function compileSources() {
 const ts=require('typescript');
 const legacy=JSON.parse(fs.readFileSync(path.join(output,'baseline-sources.json'),'utf8'));
 const files=[];
 function walk(dir){for(const f of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,f.name);if(f.isDirectory())walk(p);else if(p.endsWith('.ts'))files.push(path.relative(root,p));}}
 walk(path.join(root,'src'));
 for(const [label,overrides] of [['baseline',legacy],['optimized',{}]]){
  const compiled=Object.fromEntries(files.map(file=>[file,ts.transpileModule(overrides[file]??fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText]));
  fs.writeFileSync(path.join(output,`compiled-${label}.json`),JSON.stringify(compiled));
 }
}

function validateUrl(value, requireSchema=false) {
 const url=new URL(value||'');
 if(!['postgresql:','postgres:'].includes(url.protocol)||!['127.0.0.1','localhost'].includes(url.hostname)||!url.pathname.endsWith('_test')) throw Error('Benchmark requires an explicit loopback PostgreSQL database ending in _test.');
 if(requireSchema&&!/^dcm_test_fiveyearbenchmark_[a-f0-9]+$/.test(url.searchParams.get('schema')||'')) throw Error('Not a dedicated benchmark schema.');
 return url;
}

async function seed(prisma, properties) {
 const run=sql=>prisma.$executeRawUnsafe(sql);
 await run(`INSERT INTO "User" (id,username,name,"passwordHash",role,"updatedAt") VALUES ('benchmark-user','synthetic-benchmark','Synthetic user','not-a-login','GLOBAL_ADMIN',now())`);
 for(let p=1;p<=properties;p++) {
  const property=`property-${p}`;
  await run(`INSERT INTO "Property" (id,code,name,"updatedAt") VALUES ('${property}','BENCH-${p}','Synthetic Centre ${p}',now())`);
  await run(`INSERT INTO "StaffMember" (id,"propertyId",name,"roleTitle","hireDate","isDiveStaff","isCoursePoolSharing","isBaseLeaderOverride","updatedAt")
   SELECT 'staff-${p}-'||s,'${property}','Synthetic staff '||s,CASE WHEN s=1 THEN 'Base Leader' WHEN s=10 THEN 'Store attendant' ELSE 'Instructor' END,
    '2021-11-09',s<>10,s<=5,s=1,now() FROM generate_series(1,10) s`);
  await run(`INSERT INTO "Category" (id,"propertyId",name,"updatedAt") SELECT 'cat-${p}-'||s,'${property}',
    (ARRAY['Courses','Dives','Rentals','Retail','Photo & Video'])[s],now() FROM generate_series(1,5) s`);
  await run(`INSERT INTO "Item" (id,"propertyId","categoryId",code,name,price,"poolType","poolContribution","updatedAt")
   SELECT 'item-${p}-'||s,'${property}','cat-${p}-'||s,'BENCH-'||s,'Synthetic activity '||s,
    (ARRAY[100,80,20,30,41.975])[s],CASE WHEN s=1 THEN 'COURSE_POOL' WHEN s=2 THEN 'DIVE_POOL' ELSE 'NONE' END,CASE WHEN s<=2 THEN 10 ELSE 0 END,now() FROM generate_series(1,5) s`);
  await run(`INSERT INTO "Attendance" (id,"propertyId","staffMemberId",date,status,"updatedAt")
   SELECT 'att-${p}-'||d||'-'||s,'${property}','staff-${p}-'||s,to_char('2021-11-09'::date+d,'YYYY-MM-DD'),
    CASE WHEN (d+s)%17=0 THEN 'ABSENT' WHEN (d+s)%7=0 THEN 'OFF' ELSE 'PRESENT' END,now()
   FROM generate_series(0,1825)d CROSS JOIN generate_series(1,10)s`);
  for(let year=0;year<5;year++) {
   const first=year*366, last=Math.min(1825,(year+1)*366-1);
   await run(`INSERT INTO "Bill" (id,"propertyId","checkNumber","businessDate","guestName","roomNumber",nationality,"grossAmount","discountAmount","serviceChargeAmount","taxAmount","tipAmount","netAmount","tipStaffIdsJson",status,"createdById","createdAt","updatedAt")
    SELECT 'bill-${p}-'||n,'${property}',n+1000,to_char('2021-11-09'::date+((n-1)/100),'YYYY-MM-DD'),'Synthetic guest '||(n%10000),lpad((100+n%300)::text,4,'0'),
     (ARRAY['Maldivian','British','German','Chinese','Other'])[n%5+1],271.975,CASE WHEN n%10=0 THEN 27.1975 ELSE 0 END,
     271.975*f*0.1,271.975*f*1.1*0.17,CASE WHEN n%7=0 THEN 5 ELSE 0 END,round((271.975*f*1.287+CASE WHEN n%7=0 THEN 5 ELSE 0 END)::numeric,2),
     '["staff-${p}-1","staff-${p}-2"]',CASE WHEN n%50=0 THEN 'DELETED' WHEN n%25=0 THEN 'REBATED' ELSE 'ACTIVE' END,'benchmark-user',
     ('2021-11-09'::date+((n-1)/100))::timestamp+((n%100)||' minutes')::interval,now()
    FROM generate_series(${first*100+1},${(last+1)*100}) n CROSS JOIN LATERAL (SELECT CASE WHEN n%10=0 THEN 0.9 ELSE 1.0 END f) factor`);
   await run(`INSERT INTO "BillItem" (id,"billId","itemId","itemName","categoryName",quantity,"unitPrice","discountPercent","lineTotal","poolRateSnapshot","poolTypeSnapshot","poolContributionAmount","storeAttendantRateSnapshot","storeAttendantPoolAmount","linePosition","instructorStaffId","guideStaffId","photoStaffId","personalCommissionsJson","totalPersonalCommission","commissionDiscountFactor")
    SELECT 'line-${p}-'||n||'-'||s,'bill-${p}-'||n,'item-${p}-'||s,'Synthetic activity '||s,(ARRAY['Courses','Dives','Rentals','Retail','Photo & Video'])[s],1,
     price,CASE WHEN n%10=0 THEN 10 ELSE 0 END,price*f,CASE WHEN s<=2 THEN 10 ELSE 0 END,CASE WHEN s=1 THEN 'COURSE_POOL' WHEN s=2 THEN 'DIVE_POOL' ELSE 'NONE' END,
     CASE WHEN s<=2 THEN price*f*0.1 ELSE 0 END,CASE WHEN s=4 THEN 5 ELSE NULL END,CASE WHEN s=4 THEN round((price*f*0.05)::numeric,2) ELSE NULL END,s,
     CASE WHEN s=1 THEN 'staff-${p}-2' ELSE NULL END,CASE WHEN s=2 THEN 'staff-${p}-3' ELSE NULL END,CASE WHEN s=5 THEN 'staff-${p}-9' ELSE NULL END,
     CASE WHEN s=1 THEN '{"instructor":20}' WHEN s=2 THEN '{"guide":5}' WHEN s=5 THEN '{"photo":4.5}' ELSE NULL END,
     CASE WHEN s=1 THEN 20*f WHEN s=2 THEN 5*f WHEN s=5 THEN 4.5*f ELSE 0 END,f
    FROM generate_series(${first*100+1},${(last+1)*100}) n CROSS JOIN generate_series(1,5)s
    CROSS JOIN LATERAL (SELECT CASE WHEN n%10=0 THEN 0.9 ELSE 1.0 END f,(ARRAY[100,80,20,30,41.975])[s] price) factor`);
  }
  await run(`INSERT INTO "BillItemInstructor" ("billItemId","staffId") SELECT 'line-${p}-'||n||'-1','staff-${p}-2' FROM generate_series(1,182600)n`);
  await run(`INSERT INTO "BillItemPhotoStaff" ("billItemId","staffId") SELECT 'line-${p}-'||n||'-5','staff-${p}-9' FROM generate_series(1,182600)n`);
  console.log(`Seeded property ${p}/${properties}: 182,600 bills, 913,000 lines.`);
 }
 await run('ANALYZE');
}

function sourceLoader(prisma, legacy) {
 const sources=JSON.parse(fs.readFileSync(path.join(output,`compiled-${legacy?'baseline':'optimized'}.json`),'utf8'));
 const cache=new Map();
 function load(relative) {
  const filename=path.resolve(root,relative);
  if(cache.has(filename))return cache.get(filename).exports;
  const code=sources[path.relative(root,filename)];
  if(!code)throw Error('Missing compiled benchmark module '+filename);
  const module={exports:{}};cache.set(filename,module);
  const req=name=>{
   if(name==='../db')return{prisma};
   if(name==='../middleware/auth')return{requireAuth:(_q,_s,next)=>next()};
   if(name.startsWith('.'))return load(path.relative(root,path.resolve(path.dirname(filename),name+'.ts')));
   return require(name);
  };
  new Function('require','module','exports','__dirname',code)(req,module,module.exports,path.dirname(filename));
  return module.exports;
 }
 return load;
}

async function worker() {
 const url=validateUrl(process.env.BENCHMARK_DATABASE_URL,true);
 const spec=JSON.parse(process.argv[3]);
 let queryCount=0,billReads=0;
 const prisma=new PrismaClient({datasources:{db:{url:url.toString()}},log:[{emit:'event',level:'query'}]});
 prisma.$on('query',event=>{queryCount++;if(/FROM\s+(?:"[^".]+"\.)?"Bill"/.test(event.query))billReads++;});
 const load=sourceLoader(prisma,spec.legacy);
 const {Router}=require('express');
 const reports=Router();load('src/routes/report.read.ts').registerReportReadRoutes(reports);
 const bills=Router();load('src/routes/bill.read.ts').registerBillReadRoutes(bills);
 const query={propertyId:'property-1',startDate:spec.start||'2026-10-01',endDate:spec.end||'2026-10-31'};
 const user={id:'benchmark-user',role:'GLOBAL_ADMIN',assignedPropertyIds:[]};
 const {generateMonthlyExcelWorkbook}=load('src/services/monthlyExcelWorkbook.ts');
 const {generateDailyPdfReport,generateMonthlyPdfReport}=load('src/services/pdfReportService.ts');
 let last;
 async function operation(){
  if(spec.kind==='monthly-xlsx')return generateMonthlyExcelWorkbook('property-1','2026-10');
  if(spec.kind==='daily-pdf')return generateDailyPdfReport('property-1','2026-10-31');
  if(spec.kind==='monthly-pdf')return generateMonthlyPdfReport('property-1','2026-10');
  const route=spec.kind==='global'?'/global-dashboard':spec.kind==='list'||spec.kind==='search'?'/':'/dashboard';
  const input=spec.kind==='list'||spec.kind==='search'?{...query,limit:'50',...(spec.kind==='search'?{search:'guest 9876'}:{})}:query;
  const execute=async()=>{
   const result=await request(spec.kind==='list'||spec.kind==='search'?bills:reports,'GET',route,{query:input,user});
   assert.equal(result.status,200,JSON.stringify(result.body));
   last=result.body;return Buffer.from(JSON.stringify(result.body));
  };
  if(spec.kind==='concurrent')return Promise.all(Array.from({length:4},execute));
  return execute();
 }
 try {
  await prisma.$connect();
  // First sample is a connected-client first request; subsequent ones reuse caches.
  const samples=[];
  for(let i=0;i<(spec.repeats||3);i++){
   last=undefined;global.gc?.();await new Promise(setImmediate);queryCount=0;billReads=0;
   const start=performance.now();const result=await operation();await new Promise(setImmediate);
   const bytes=Array.isArray(result)?result.reduce((a,b)=>a+b.length,0):result.length;
   samples.push({ms:performance.now()-start,queries:queryCount,billReads,bytes,rssMB:process.memoryUsage().rss/1048576});
  }
  const totals=last?.headline?{headline:last.headline,staffCommissions:last.staffCommissions,categoryRevenue:last.charts.categoryRevenue}:null;
  console.log(JSON.stringify({spec,samples,peakRssMB:process.resourceUsage().maxRSS/1024,totals}));
 }finally{await prisma.$disconnect();}
}

async function main(){
 const baseUrl=validateUrl(process.env.BENCHMARK_DATABASE_URL);
 process.env.TEST_DATABASE_URL=baseUrl.toString();
 const statePath=path.join(output,'state.json');
 let state,db;
 if(process.argv.includes('--resume')){state=JSON.parse(fs.readFileSync(statePath,'utf8'));validateUrl(state.databaseUrl,true);}
 else {
  const {createTestDatabase}=require('../tests/helpers/postgres.cjs');
  db=createTestDatabase('fiveyearbenchmark');
  const properties=Number(process.env.BENCHMARK_PROPERTIES||10);assert(Number.isInteger(properties)&&properties>=1&&properties<=10);
  state={databaseUrl:db.databaseUrl,properties};fs.writeFileSync(statePath,JSON.stringify(state));
  await seed(db.prisma,properties);await db.prisma.$disconnect();
 }
 const url=validateUrl(state.databaseUrl,true);
 const prisma=new PrismaClient({datasources:{db:{url:url.toString()}}});
 const migration=fs.readFileSync(path.join(root,'prisma/migrations/20261109000000_read_performance/migration.sql'),'utf8');
 const indexNames=[...migration.matchAll(/CREATE INDEX IF NOT EXISTS "([^"]+)"/g)].map(m=>m[1]);
 const revision=execFileSync('git',['rev-parse',process.env.BENCHMARK_BASELINE_REVISION||'HEAD'],{cwd:root,encoding:'utf8'}).trim();
 const sourceFiles=['src/routes/bill.read.ts','src/routes/report.read.ts','src/services/commissionService.ts'];
 fs.writeFileSync(path.join(output,'baseline-sources.json'),JSON.stringify(Object.fromEntries(sourceFiles.map(f=>[f,execFileSync('git',['show',`${revision}:backend/${f}`],{cwd:root,encoding:'utf8'})]))));
 compileSources();
 const counts=await prisma.$queryRawUnsafe(`SELECT (SELECT count(*)::int FROM "Bill") bills,(SELECT count(*)::int FROM "BillItem") lines,(SELECT count(*)::int FROM "Attendance") attendance`);
 assert.equal(counts[0].bills,state.properties*182600,'Seed must be complete before measuring');
 assert.equal(counts[0].lines,state.properties*913000,'Seed must be complete before measuring');
 const settings=await prisma.$queryRawUnsafe(`SELECT version(),current_setting('shared_buffers') AS shared_buffers,current_setting('work_mem') AS work_mem,current_setting('max_connections') AS max_connections`);
 const results={createdAt:new Date().toISOString(),revision,properties:state.properties,period:'2021-11-09 through 2026-11-08',counts:counts[0],hardware:{platform:os.platform(),arch:os.arch(),cpus:os.cpus().length,cpu:os.cpus()[0]?.model,ramGB:os.totalmem()/1073741824,node:process.version,heapLimitMB:384,postgres:settings[0]},runs:[]};
 const save=()=>fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(results,null,2));
 async function run(spec){
  console.log(`Measuring ${spec.legacy?'baseline':'optimized'} ${spec.kind} ${spec.start||''}…`);
  const start=performance.now();
  const child=spawnSync(process.execPath,['--max-old-space-size=384','--expose-gc',__filename,'--worker',JSON.stringify(spec)],{cwd:root,env:{...process.env,BENCHMARK_DATABASE_URL:url.toString()},encoding:'utf8',timeout:180000,maxBuffer:2*1024*1024});
  if(child.status!==0){results.runs.push({spec,errorKind:/heap out of memory|heap limit/i.test(child.stderr)?'heap_exhaustion':child.error?.code||'worker_failure',error:child.error?.message||child.stderr.slice(0,1800)+'\n'+child.stderr.slice(-1000),status:child.status,signal:child.signal,elapsedMs:performance.now()-start});console.log('Failed:',child.signal||child.status);}
  else {const result=JSON.parse(child.stdout.trim().split('\n').at(-1));results.runs.push(result);console.log(result.samples.map(s=>`${s.ms.toFixed(0)}ms`).join(', '));}
  save();
 }
 try{
  for(const name of indexNames)await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS "${name}"`);
  await prisma.$executeRawUnsafe('ANALYZE');
  for(const kind of ['list','search','dashboard'])await run({kind,legacy:true});
  for(const statement of migration.split(';').filter(s=>s.includes('CREATE INDEX')))await prisma.$executeRawUnsafe(statement);
  await prisma.$executeRawUnsafe('ANALYZE');
  for(const kind of ['list','search','dashboard','daily-pdf','monthly-pdf','monthly-xlsx','concurrent'])await run({kind});
  await run({kind:'dashboard',start:'2025-01-01',end:'2025-12-31',repeats:2});
  await run({kind:'search',start:'2021-11-09',end:'2026-11-08'});
  await run({kind:'dashboard',start:'2021-11-09',end:'2026-11-08',repeats:1});
  await run({kind:'global',repeats:2});
  const baseline=results.runs.find(r=>r.spec.legacy&&r.spec.kind==='dashboard');
  const optimized=results.runs.find(r=>!r.spec.legacy&&r.spec.kind==='dashboard'&&!r.spec.start);
  assert.deepEqual(optimized.totals,baseline.totals,'Monthly dashboard/payroll totals must remain identical');
  results.reconciliation='PASS: baseline and optimized dashboard totals, category revenue and employee commissions are identical.';
  const monthControl=await prisma.bill.aggregate({where:{propertyId:'property-1',status:'ACTIVE',businessDate:{gte:'2026-10-01',lte:'2026-10-31'}},_count:{_all:true},_sum:{netAmount:true}});
  assert.equal(optimized.totals.headline.billCount,monthControl._count._all);
  assert(Math.abs(optimized.totals.headline.netRevenue-monthControl._sum.netAmount)<0.01);
  const plans={};
  for(const [name,sql] of Object.entries({list:`SELECT id FROM "Bill" WHERE "propertyId"='property-1' AND "businessDate">='2026-10-01' AND "businessDate"<='2026-10-31' ORDER BY "businessDate" DESC,"checkNumber" DESC,id DESC LIMIT 51`,lines:`SELECT * FROM "BillItem" WHERE "billId"='bill-1-180001' ORDER BY "linePosition"`}))plans[name]=await prisma.$queryRawUnsafe('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) '+sql);
  fs.writeFileSync(path.join(output,'query-plans.json'),JSON.stringify(plans,null,2));save();
  console.log(results.reconciliation);console.log('Results:',path.join(output,'results.json'));
 }finally{await prisma.$disconnect();}
 // Retain only this synthetic schema for repeatability; no other schemas are touched.
}
if(process.argv.includes('--compile-only'))compileSources();
else (process.argv[2]==='--worker'?worker():main()).catch(error=>{console.error(error);process.exitCode=1;});
