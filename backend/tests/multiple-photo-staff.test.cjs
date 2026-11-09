const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');
const {loadTypeScript,request}=require('./helpers/runtime.cjs');const {createTestDatabase}=require('./helpers/postgres.cjs');
const database=createTestDatabase('multiphoto');const {prisma}=database;
const stubs={'../db':{prisma},'../middleware/auth':{requireAuth:(_req,_res,next)=>next()}};
const {billsRouter}=loadTypeScript('src/routes/bills.routes.ts',stubs);
const {calculateCommissionForPeriod}=loadTypeScript('src/services/commissionService.ts',stubs);
const user={id:'manager',role:'PROPERTY_MANAGER',assignedPropertyIds:['own']};let number=7000;
const line=(extra={})=>({clientLineId:'photo',itemId:'photo',itemName:'Photo',categoryName:'Media',quantity:2,unitPrice:100,discountPercent:20,photoStaffIds:['one','two'],...extra});
const call=(method,url,body)=>request(billsRouter,method,url,{user,body});
const save=(items=[line()],extra={})=>call('POST','/',{propertyId:'own',checkNumber:number++,businessDate:'2026-11-04',guestName:'Test Guest',roomNumber:'0012',items,...extra});
const paired=()=>[{clientLineId:'root',itemId:'included',itemName:'Dive',categoryName:'Dives',quantity:3,unitPrice:100,discountPercent:0},{...line({clientLineId:'auto',itemId:null,autoPhotoFor:'root',quantity:3,unitPrice:41.975})}];
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-8,`${actual} != ${expected}`);
test.before(async()=>{
 await prisma.property.createMany({data:[{id:'own',code:'OWN',name:'Own',autoPhotoPrice:41.975,autoPhotoCommission:4.5},{id:'foreign',code:'FOREIGN',name:'Foreign'}]});
 await prisma.user.create({data:{id:'manager',username:'photo-manager',name:'Manager',passwordHash:'unused'}});
 await prisma.category.create({data:{id:'media',propertyId:'own',name:'Media'}});
 await prisma.item.createMany({data:[{id:'photo',propertyId:'own',categoryId:'media',code:'PHOTO',name:'Photo',price:100,personalRoles:'photo',personalRatesJson:'{"photo":10}'},{id:'included',propertyId:'own',categoryId:'media',code:'INCLUDED',name:'Dive',price:100,includesComplimentaryMedia:true}]});
 await prisma.staffMember.createMany({data:[...['one','two'].map(id=>({id,propertyId:'own',name:id,roleTitle:'Photographer',hireDate:'2026-01-01'})),{id:'foreign',propertyId:'foreign',name:'Foreign',roleTitle:'Photographer',hireDate:'2026-01-01'},{id:'inactive',propertyId:'own',name:'Inactive',roleTitle:'Photographer',hireDate:'2026-01-01',isActive:false}]});
});
test.after(()=>database.dispose());
test('standalone Photo pays the full saved catalogue rate to each person after line and checkout discounts',async()=>{
 const result=await save([line({personalCommissionsJson:'{"photo":999}'})],{checkoutDiscountPercent:25});assert.equal(result.status,201,JSON.stringify(result.body));
 const row=result.body.bill.items[0];near(row.totalPersonalCommission,24);assert.equal(row.photoCredits.length,2);
 const report=await calculateCommissionForPeriod('own','2026-11-04','2026-11-04','one');
 for(const id of ['one','two'])assert.equal(report.staffResults.find(person=>person.staffId===id).personalCommission,12);
 assert.equal(report.breakdownDetails.find(detail=>detail.billItemId===row.id&&detail.kind==='PERSONAL').amount,12);
});
test('Include Photo creates one charge and pays each selected Photo staff member the full property rate',async()=>{
 const result=await save(paired(),{businessDate:'2026-11-06'});assert.equal(result.status,201,JSON.stringify(result.body));
 const photo=result.body.bill.items.find(row=>row.autoPhotoForLineId);assert.equal(photo.photoCredits.length,2);near(photo.totalPersonalCommission,21.6);
 assert.equal(result.body.bill.items.length,2);near(result.body.bill.grossAmount,425.93);
 const report=await calculateCommissionForPeriod('own','2026-11-06','2026-11-06');for(const id of ['one','two'])assert.equal(report.staffResults.find(person=>person.staffId===id).personalCommission,10.8);
 const invalid=paired();invalid[0].photoStaffIds=['one','two'];assert.equal((await save(invalid)).status,400);
});
test('duplicate, foreign and inactive Photo recipients are rejected on standalone and automatic Photo lines',async()=>{
 const before=await prisma.bill.count();
 for(const ids of [['one','one'],['one','foreign'],['one','inactive'],['one',123],null]){
  assert.equal((await save([line({photoStaffIds:ids})])).status,400);
  const lines=paired();lines[1].photoStaffIds=ids;assert.equal((await save(lines)).status,400);
 }
 assert.equal(await prisma.bill.count(),before);
});
test('re-dates and attendance check every Photo recipient',async()=>{
 await prisma.attendance.create({data:{propertyId:'own',staffMemberId:'two',date:'2026-11-05',status:'SICK'}});
 assert.equal((await save([line()],{businessDate:'2026-11-05'})).status,400);
 const bill=(await save()).body.bill;assert.equal((await call('POST','/'+bill.id+'/re-date',{newDate:'2026-11-05'})).status,400);
});
test('editing Include Photo preserves both recipients and original Photo rates; old editors cannot silently drop recipients',async()=>{
 const bill=(await save(paired())).body.bill;
 const detail=await request(billsRouter,'GET','/'+bill.id,{user});const photo=detail.body.bill.items.find(row=>row.autoPhotoForLineId);
 assert.deepEqual(photo.photoCredits.map(credit=>credit.staff.name).sort(),['one','two']);
 const payload={propertyId:'own',checkNumber:bill.checkNumber,businessDate:bill.businessDate,guestName:'Corrected',roomNumber:'0012',expectedUpdatedAt:bill.updatedAt.toISOString(),editReason:'Verify multiple Photo recipients',items:bill.items.map(row=>({...row,sourceLineId:row.id,clientLineId:row.id,autoPhotoFor:row.autoPhotoForLineId,photoStaffIds:row.photoCredits.map(credit=>credit.staffId)}))};
 const old={...payload,items:payload.items.map(row=>({...row,photoStaffIds:undefined}))};assert.equal((await call('PUT','/'+bill.id,old)).status,400);
 await prisma.property.update({where:{id:'own'},data:{autoPhotoPrice:99,autoPhotoCommission:99}});
 try{const saved=await call('PUT','/'+bill.id,payload);assert.equal(saved.status,200,JSON.stringify(saved.body));const row=saved.body.bill.items.find(row=>row.autoPhotoForLineId);assert.equal(row.unitPrice,41.975);near(row.totalPersonalCommission,21.6);assert.equal(row.photoCredits.length,2);}
 finally{await prisma.property.update({where:{id:'own'},data:{autoPhotoPrice:41.975,autoPhotoCommission:4.5}});}
});
test('the migration retains historical single photographers and their original payments',async()=>{
 const [schema]=await prisma.$queryRaw`SELECT current_schema() AS name`;assert.equal(schema.name,database.schema);
 const bill=await prisma.bill.create({data:{propertyId:'own',checkNumber:number++,businessDate:'2026-10-01',guestName:'Historical',roomNumber:'0012',createdById:'manager',grossAmount:100,discountAmount:50,serviceChargeAmount:0,taxAmount:0,netAmount:50,items:{create:{itemId:'photo',itemName:'Photo',categoryName:'Media',quantity:1,unitPrice:100,discountPercent:50,lineTotal:50,photoStaffId:'one',personalCommissionsJson:'{"photo":10}',totalPersonalCommission:10}}},include:{items:true}});
 const sql=fs.readFileSync(path.join(__dirname,'../prisma/migrations/20261104020000_multiple_photo_staff/migration.sql'),'utf8');
 await prisma.$transaction(async tx=>{await tx.$executeRawUnsafe('DROP TABLE "BillItemPhotoStaff"');for(const statement of sql.split(';').map(value=>value.trim()).filter(Boolean))await tx.$executeRawUnsafe(statement);});
 assert.equal(await prisma.billItemPhotoStaff.count({where:{billItemId:bill.items[0].id,staffId:'one'}}),1);
 const report=await calculateCommissionForPeriod('own','2026-10-01','2026-10-01');assert.equal(report.staffResults.find(person=>person.staffId==='one').personalCommission,10);
});
