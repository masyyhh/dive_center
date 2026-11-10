const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestDatabase } = require('./helpers/postgres.cjs');
const { loadTypeScript, request } = require('./helpers/runtime.cjs');
const database = createTestDatabase('readperformance');
const { prisma } = database;
const stubs = { '../db': { prisma }, '../middleware/auth': { requireAuth: (_q, _s, next) => next() } };
const { billsRouter } = loadTypeScript('src/routes/bills.routes.ts', stubs);
const { reportsRouter } = loadTypeScript('src/routes/reports.routes.ts', stubs);
const query = { propertyId:'male',startDate:'2022-01-01',endDate:'2026-12-31' };
const list = patch => request(billsRouter,'GET','/',{query:{...query,...patch}});
test.before(async()=>{
 await prisma.property.createMany({data:[{id:'male',code:'A',name:'A'},{id:'other',code:'B',name:'B'}]});
 await prisma.user.create({data:{id:'creator',username:'creator',name:'Creator',passwordHash:'test'}});
 const rows=Array.from({length:123},(_,i)=>({id:`bill-${String(i).padStart(3,'0')}`,propertyId:'male',createdById:'creator',businessDate:i<65?'2026-11-08':'2026-11-07',checkNumber:1000+i,guestName:i===4?'Literal 50%_\\ Test':i===5?'Guest 50abcdef Test':'Sample Guest',roomNumber:String(100+i),nationality:i===6?'Maldivian':'Other',grossAmount:100,discountAmount:i%3===0?10:0,netAmount:100,status:i%10===0?'DELETED':'ACTIVE'}));
 // A deleted row can share the date/check of a live bill; id must break ties.
 rows[10].checkNumber=1009;
 await prisma.bill.createMany({data:[...rows,{...rows[0],id:'other-bill',propertyId:'other',guestName:'Private other guest'}]});
});
test.after(()=>database.dispose());
test('cursor pages cover each bill exactly once with stable date/check/id ordering and summary-only payloads',async()=>{
 let cursor,seen=[];
 do {
  const r=await list({limit:'17',...(cursor?{cursor}:{})});assert.equal(r.status,200);assert(r.body.bills.length<=17);
  seen.push(...r.body.bills);cursor=r.body.nextCursor;
  for(const row of r.body.bills){assert.equal(row.propertyId,'male');assert.equal(row.items,undefined);assert.equal(row.notes,undefined);}
 }while(cursor);
 const ordered=await prisma.bill.findMany({where:{propertyId:'male'},orderBy:[{businessDate:'desc'},{checkNumber:'desc'},{id:'desc'}],select:{id:true}});
 assert.deepEqual(seen.map(b=>b.id),ordered.map(b=>b.id));assert.equal(new Set(seen.map(b=>b.id)).size,123);
});
test('database search preserves case-insensitive literal substrings and numeric check substrings',async()=>{
 for(const [search,expected] of [['50%_\\',['bill-004']],['mAlDiViAn',['bill-006']],['1012',['bill-012']],['Private other',[]],["' OR 1=1 --",[]]]){
  const r=await list({search,limit:'100'});assert.equal(r.status,200);assert.deepEqual(r.body.bills.map(b=>b.id),expected);
 }
});
test('status and discount filters apply before paging; malformed and mismatched cursors fail',async()=>{
 const r=await list({status:'ACTIVE',discountedOnly:'true',limit:'5'});assert.equal(r.status,200);
 assert(r.body.bills.every(b=>b.status==='ACTIVE'&&b.discountAmount>0));assert(r.body.nextCursor);
 assert.equal((await list({cursor:r.body.nextCursor,status:'DELETED'})).status,400);
 for(const patch of [{limit:'0'},{limit:'101'},{cursor:'invalid'},{discountedOnly:'maybe'},{search:'x'.repeat(201)}]) assert.equal((await list(patch)).status,400);
 const forbidden=await request(billsRouter,'GET','/',{query:{...query,propertyId:'other'}});assert.equal(forbidden.status,403);
});
test('dashboard performs one bill read and its commission totals match standalone payroll',async()=>{
 const reads=[];
 const wrapped=new Proxy(prisma,{get(target,key){
  if(key==='bill')return new Proxy(target.bill,{get(model,action){if(action==='findMany')return args=>{reads.push(args);return model.findMany(args);};return model[action];}});
  return target[key];
 }});
 const {reportsRouter:router}=loadTypeScript('src/routes/reports.routes.ts',{...stubs,'../db':{prisma:wrapped}});
 const response=await request(router,'GET','/dashboard',{query});assert.equal(response.status,200);assert.equal(reads.length,1);
 const {calculateCommissionForPeriod}=loadTypeScript('src/services/commissionService.ts',stubs);
 const result=await calculateCommissionForPeriod('male',query.startDate,query.endDate);
 assert.equal(response.body.headline.totalCommission,result.grandTotal);
 assert.equal(response.body.headline.billCount,110);
});
