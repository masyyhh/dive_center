const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createTestDatabase}=require('./helpers/postgres.cjs');
const {fingerprint}=require('../../scripts/production-data-fingerprint.cjs');
const database=createTestDatabase('productionfingerprint');
const {prisma,schema}=database;
let before;
test.before(async()=>{
 await prisma.property.create({data:{id:'p',code:'VERIFY',name:'Production rehearsal fixture'}});
 await prisma.user.create({data:{id:'u',username:'release-check',name:'Fixture',passwordHash:'private-fixture-hash'}});
 await prisma.staffMember.create({data:{id:'s',propertyId:'p',name:'Fixture staff',roleTitle:'Instructor',hireDate:'2026-01-01'}});
 await prisma.category.create({data:{id:'c',propertyId:'p',name:'Fixture category'}});
 await prisma.item.create({data:{id:'i',propertyId:'p',categoryId:'c',code:'FIXTURE',name:'Fixture item',price:100}});
 await prisma.bill.create({data:{id:'bill',propertyId:'p',checkNumber:1001,businessDate:'2026-11-04',guestName:'Fixture guest',roomNumber:'0012',createdById:'u',grossAmount:100,discountAmount:20,serviceChargeAmount:8,taxAmount:14.08,netAmount:102.08,
  items:{create:{id:'line',itemId:'i',itemName:'Fixture item',categoryName:'Fixture category',quantity:1,unitPrice:100,discountPercent:20,lineTotal:80,instructorStaffId:'s',photoStaffId:'s',personalCommissionsJson:'{"instructor":10,"photo":4.5}',totalPersonalCommission:14.5}}}});
 const [current]=await prisma.$queryRaw`SELECT current_schema() AS name`;assert.equal(current.name,schema);
 await prisma.$executeRawUnsafe('DROP TABLE "BillItemInstructor"');
 await prisma.$executeRawUnsafe('DROP TABLE "BillItemPhotoStaff"');
 await prisma.$executeRawUnsafe('ALTER TABLE "Bill" DROP COLUMN "serviceChargeRateSnapshot", DROP COLUMN "taxRateSnapshot"');
 await prisma.$executeRawUnsafe('ALTER TABLE "BillItem" DROP COLUMN "poolRateSnapshot", DROP COLUMN "commissionDiscountFactor"');
 before=await fingerprint(prisma,undefined,schema);
});
test.after(()=>database.dispose());
test('all original business values survive the exact three production migrations while historical recipients are backfilled',async()=>{
 for(const migration of ['20261104000000_posted_bill_edits_and_discount_commission','20261104010000_multiple_line_instructors','20261104020000_multiple_photo_staff']){
  const sql=fs.readFileSync(path.join(__dirname,'../prisma/migrations',migration,'migration.sql'),'utf8');
  for(const statement of sql.replace(/^--.*$/gm,'').split(';').map(value=>value.trim()).filter(Boolean))await prisma.$executeRawUnsafe(statement);
 }
 const after=await fingerprint(prisma,before,schema);
 assert.deepEqual(after,before);
 assert.equal(after.tables.Bill.count,'1');assert.equal(after.tables.BillItem.count,'1');
 assert.equal(after.tables.User.count,'1');assert.equal(after.tables.StaffMember.count,'1');
 assert.equal(await prisma.billItemInstructor.count(),1);
 assert.equal(await prisma.billItemPhotoStaff.count(),1);
});
test('a financial value change is detected, without including financial data in the fingerprint output',async()=>{
 await prisma.bill.update({where:{id:'bill'},data:{netAmount:999}});
 const after=await fingerprint(prisma,before,schema);
 assert.notEqual(after.tables.Bill.sha256,before.tables.Bill.sha256);
 const text=JSON.stringify(after);
 for(const privateValue of ['Fixture guest','private-fixture-hash','Fixture staff'])assert.equal(text.includes(privateValue),false);
 await prisma.bill.update({where:{id:'bill'},data:{netAmount:102.08,updatedAt:new Date('2020-01-01T00:00:00.000Z')}});
});
test('a missing historical instructor credit blocks verification',async()=>{
 await prisma.billItemInstructor.deleteMany();
 await assert.rejects(()=>fingerprint(prisma,before,schema),/Historical credit backfill/);
 await prisma.billItemInstructor.create({data:{billItemId:'line',staffId:'s'}});
});
test('a missing original column blocks verification',async()=>{
 await prisma.$executeRawUnsafe('ALTER TABLE "Bill" RENAME COLUMN "guestName" TO "renamedGuest"');
 await assert.rejects(()=>fingerprint(prisma,before,schema),/original table or column is missing/);
 await prisma.$executeRawUnsafe('ALTER TABLE "Bill" RENAME COLUMN "renamedGuest" TO "guestName"');
});
