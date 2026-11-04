const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {loadTypeScript,request}=require('./helpers/runtime.cjs');
const {createTestDatabase}=require('./helpers/postgres.cjs');
const database=createTestDatabase('multiinstructors');
const {prisma}=database;
const stubs={'../db':{prisma},'../middleware/auth':{requireAuth:(_req,_res,next)=>next()}};
const {billsRouter}=loadTypeScript('src/routes/bills.routes.ts',stubs);
const {calculateCommissionForPeriod}=loadTypeScript('src/services/commissionService.ts',stubs);
const user={id:'manager',role:'PROPERTY_MANAGER',assignedPropertyIds:['own']};
let number=6000;
const item=(extra={})=>({clientLineId:'root',itemId:'course',itemName:'Course',categoryName:'Courses',quantity:3,unitPrice:100,discountPercent:20,instructorStaffIds:['one','two'],...extra});
const create=async(line=item(),extra={})=>request(billsRouter,'POST','/',{user,body:{propertyId:'own',checkNumber:number++,businessDate:'2026-11-04',guestName:'Test Guest',roomNumber:'0012',items:[line],...extra}});
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-9,`${actual} != ${expected}`);
test.before(async()=>{
 await prisma.property.createMany({data:[{id:'own',code:'OWN',name:'Own'},{id:'foreign',code:'OTHER',name:'Other'}]});
 await prisma.user.create({data:{id:'manager',username:'instructor-manager',name:'Manager',passwordHash:'unused'}});
 await prisma.category.create({data:{id:'courses',propertyId:'own',name:'Courses'}});
 await prisma.item.create({data:{id:'course',propertyId:'own',categoryId:'courses',code:'COURSE',name:'Course',price:100,poolType:'COURSE_POOL',poolContribution:10,personalRoles:'instructor',personalRatesJson:'{"instructor":10}'}});
 await prisma.staffMember.createMany({data:[
  ...['one','two'].map(id=>({id,propertyId:'own',name:id,roleTitle:'Instructor',hireDate:'2026-01-01'})),
  {id:'foreign',propertyId:'foreign',name:'Foreign',roleTitle:'Instructor',hireDate:'2026-01-01'},
  {id:'inactive',propertyId:'own',name:'Inactive',roleTitle:'Instructor',hireDate:'2026-01-01',isActive:false},
  {id:'future',propertyId:'own',name:'Future',roleTitle:'Instructor',hireDate:'2027-01-01'},
 ]});
});
test.after(()=>database.dispose());
test('each instructor earns the full catalogue amount times quantity and the compounded discount, without sharing the amount',async()=>{
 const result=await create(item({ personalCommissionsJson:'{"instructor":999}',totalPersonalCommission:999 }),{checkoutDiscountPercent:25});
 assert.equal(result.status,201,JSON.stringify(result.body));const bill=result.body.bill;
 const line=bill.items[0];near(line.discountPercent,40);near(line.totalPersonalCommission,36);
 assert.deepEqual(line.instructorCredits.map(credit=>credit.staffId).sort(),['one','two']);
 const report=await calculateCommissionForPeriod('own','2026-11-04','2026-11-04','one');
 for(const id of ['one','two'])assert.equal(report.staffResults.find(staff=>staff.staffId===id).personalCommission,18);
 const details=report.personalDetails.filter(detail=>detail.id.startsWith(line.id));
 assert.equal(details.length,2);assert.equal(new Set(details.map(detail=>detail.id)).size,2);
 assert.ok(details.every(detail=>detail.amount===18));
 assert.equal(report.breakdownDetails.find(detail=>detail.billItemId===line.id&&detail.kind==='PERSONAL').amount,18);
 assert.equal(line.poolContributionAmount,18);
});
test('duplicate, cross-property, inactive, future and malformed selections never create a bill',async()=>{
 const before=await prisma.bill.count();
 for(const ids of [['one','one'],['one','foreign'],['one','inactive'],['one','future'],['one',99],[''],null,'one']){
  const result=await create(item({instructorStaffIds:ids}));assert.equal(result.status,400,JSON.stringify(ids));
 }
 assert.equal(await prisma.bill.count(),before);
});
test('attendance and re-dating validate every instructor, including the second recipient',async()=>{
 await prisma.attendance.create({data:{propertyId:'own',staffMemberId:'two',date:'2026-11-05',status:'SICK'}});
 assert.equal((await create(item(),{businessDate:'2026-11-05'})).status,400);
 const bill=(await create()).body.bill;
 const moved=await request(billsRouter,'POST','/'+bill.id+'/re-date',{user,body:{newDate:'2026-11-05'}});
 assert.equal(moved.status,400);assert.match(moved.body.error,/unavailable/);
});
test('editing retains both recipients and saved catalogue rate; names are visible; explicitly clearing removes instructor pay',async()=>{
 const bill=(await create()).body.bill;
 const details=await request(billsRouter,'GET','/'+bill.id,{user});
 assert.equal(details.status,200);assert.deepEqual(details.body.bill.items[0].instructorCredits.map(credit=>credit.staff.name).sort(),['one','two']);
 const payload={propertyId:'own',checkNumber:bill.checkNumber,businessDate:bill.businessDate,guestName:'Corrected',roomNumber:'0012',expectedUpdatedAt:bill.updatedAt.toISOString(),editReason:'Verify multiple instructor retention',items:[item({sourceLineId:bill.items[0].id})]};
 await prisma.item.update({where:{id:'course'},data:{personalRatesJson:'{"instructor":99}'}});
 try{
  const oldClient=await request(billsRouter,'PUT','/'+bill.id,{user,body:{...payload,items:[item({sourceLineId:bill.items[0].id,instructorStaffIds:undefined,instructorStaffId:'one'})]}});
  assert.equal(oldClient.status,400);assert.match(oldClient.body.error,/Refresh/);
  const saved=await request(billsRouter,'PUT','/'+bill.id,{user,body:payload});assert.equal(saved.status,200,JSON.stringify(saved.body));
  assert.equal(saved.body.bill.items[0].instructorCredits.length,2);near(saved.body.bill.items[0].totalPersonalCommission,48);
  const cleared=await request(billsRouter,'PUT','/'+bill.id,{user,body:{...payload,expectedUpdatedAt:saved.body.bill.updatedAt.toISOString(),items:[item({sourceLineId:saved.body.bill.items[0].id,instructorStaffIds:[],instructorStaffId:null})]}});
  assert.equal(cleared.status,200);assert.equal(cleared.body.bill.items[0].totalPersonalCommission,0);assert.deepEqual(cleared.body.bill.items[0].instructorCredits,[]);
 }finally{await prisma.item.update({where:{id:'course'},data:{personalRatesJson:'{"instructor":10}'}});}
});
test('legacy single instructor requests and complimentary discounts remain compatible',async()=>{
 const legacy=await create(item({instructorStaffIds:undefined,instructorStaffId:'one',quantity:1,discountPercent:0}));
 assert.equal(legacy.status,201);assert.equal(legacy.body.bill.items[0].totalPersonalCommission,10);
 assert.equal(legacy.body.bill.items[0].instructorCredits.length,1);
 const free=await create(item({discountPercent:100}));assert.equal(free.status,201);assert.equal(free.body.bill.items[0].totalPersonalCommission,0);
});
test('the migration backfills historical recipients without changing their saved payments',async()=>{
 // This schema belongs only to this test file. Recreate the new table against legacy rows.
 const [current]=await prisma.$queryRaw`SELECT current_schema() AS name`;
 assert.equal(current.name,database.schema);
 const bill=await prisma.bill.create({data:{propertyId:'own',checkNumber:number++,businessDate:'2026-10-01',guestName:'Historical',roomNumber:'0012',createdById:'manager',grossAmount:100,discountAmount:50,serviceChargeAmount:0,taxAmount:0,netAmount:50,
  items:{create:{itemId:'course',itemName:'Course',categoryName:'Courses',quantity:1,unitPrice:100,discountPercent:50,lineTotal:50,instructorStaffId:'one',personalCommissionsJson:'{"instructor":10}',totalPersonalCommission:10}}},include:{items:true}});
 const sql=fs.readFileSync(path.join(__dirname,'../prisma/migrations/20261104010000_multiple_line_instructors/migration.sql'),'utf8');
 await prisma.$transaction(async tx=>{await tx.$executeRawUnsafe('DROP TABLE "BillItemInstructor"');for(const statement of sql.split(';').map(value=>value.trim()).filter(Boolean))await tx.$executeRawUnsafe(statement);});
 const credits=await prisma.billItemInstructor.findMany({where:{billItemId:bill.items[0].id}});assert.deepEqual(credits.map(credit=>credit.staffId),['one']);
 const report=await calculateCommissionForPeriod('own','2026-10-01','2026-10-01');assert.equal(report.staffResults.find(staff=>staff.staffId==='one').personalCommission,10);
});
