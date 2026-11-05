const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTypeScript, request } = require('./helpers/runtime.cjs');
const { createTestDatabase } = require('./helpers/postgres.cjs');
const database = createTestDatabase('checkoutdiscount');
const { prisma } = database;
const user = { id:'manager', role:'PROPERTY_MANAGER', assignedPropertyIds:['centre'] };
const { billsRouter } = loadTypeScript('src/routes/bills.routes.ts', {
  '../db': { prisma }, '../middleware/auth': { requireAuth: (req,res,next)=>next() },
});
let checkNumber=2000;
const line=(id,quantity,price,discountPercent=0)=>({clientLineId:id,itemId:id,itemName:id,categoryName:'Dives',quantity,unitPrice:price,discountPercent});
const save=(items,checkoutDiscountPercent,extra={})=>request(billsRouter,'POST','/',{user,body:{propertyId:'centre',checkNumber:checkNumber++,businessDate:'2026-11-02',guestName:'Guest',roomNumber:'104',items,...(checkoutDiscountPercent===undefined?{}:{checkoutDiscountPercent}),...extra}});
test.before(async()=>{
  await prisma.property.create({data:{id:'centre',code:'CHECKOUT',name:'Checkout centre',serviceChargeRate:10,taxRate:16,autoPhotoPrice:41.975,autoPhotoCommission:4.5}});
  await prisma.user.create({data:{id:'manager',username:'checkout-manager',name:'Manager',passwordHash:'unused'}});
  await prisma.category.create({data:{id:'dives',propertyId:'centre',name:'Dives'}});
  await prisma.staffMember.create({data:{id:'seller',propertyId:'centre',name:'Seller',roleTitle:'Instructor',hireDate:'2026-01-01'}});
  await prisma.item.createMany({data:[
    {id:'dive',propertyId:'centre',categoryId:'dives',code:'DIVE',name:'Dive',price:100,poolType:'DIVE_POOL',poolContribution:10,personalRoles:'seller',personalRatesJson:'{"seller":5}'},
    {id:'rental',propertyId:'centre',categoryId:'dives',code:'RENT',name:'Rental',price:50},
    {id:'media',propertyId:'centre',categoryId:'dives',code:'MEDIA',name:'Photo activity',price:100,includesComplimentaryMedia:true},
  ]});
});
test.after(()=>database.dispose());
test('checkout percentage compounds after line discounts and before charges; personal commissions reduce proportionally and tips remain fixed',async()=>{
  const result=await save([{...line('dive',2,100,10),sellerStaffId:'seller'},line('rental',1,50)],20,{tipAmount:10});
  assert.equal(result.status,201,JSON.stringify(result.body));
  const bill=result.body.bill;
  assert.equal(bill.grossAmount,250); assert.equal(bill.discountAmount,66);
  assert.equal(bill.serviceChargeAmount,18.4); assert.equal(bill.taxAmount,32.38); assert.equal(bill.netAmount,244.78);
  const dive=bill.items.find(row=>row.itemId==='dive');
  assert.equal(dive.discountPercent,28); assert.equal(dive.lineTotal,144);
  assert.equal(dive.poolContributionAmount,14.4); assert.ok(Math.abs(dive.totalPersonalCommission-7.2)<1e-9);
  const audit=await prisma.auditLog.findFirst({where:{targetId:bill.id,action:'BILL_CREATE'}});
  assert.equal(JSON.parse(audit.details).checkoutDiscountPercent,20);
});
test('checkout discount applies once to linked Photo lines and reduces photographer commission proportionally',async()=>{
  const result=await save([line('media',2,100),{clientLineId:'photo',autoPhotoFor:'media',itemName:'Photo',categoryName:'Photo & Video',quantity:2,unitPrice:41.975,photoStaffId:'seller'}],10);
  assert.equal(result.status,201,JSON.stringify(result.body));
  const bill=result.body.bill; assert.equal(bill.grossAmount,283.95); assert.equal(bill.discountAmount,28.4);
  const photo=bill.items.find(row=>row.autoPhotoForLineId);
  assert.equal(photo.discountPercent,10); assert.ok(Math.abs(photo.lineTotal-75.555)<1e-9); assert.equal(photo.totalPersonalCommission,8.1);
});
test('zero and omitted checkout discounts preserve existing line discounts; 100 percent discounts exclude tips',async()=>{
  for(const percent of [undefined,0]){
    const response=await save([line('dive',1,100,10)],percent);
    assert.equal(response.status,201); assert.equal(response.body.bill.items[0].discountPercent,10); assert.equal(response.body.bill.discountAmount,10);
  }
  const free=await save([line('dive',1,100)],100,{tipAmount:5});
  assert.equal(free.status,201); assert.equal(free.body.bill.discountAmount,100); assert.equal(free.body.bill.serviceChargeAmount,0); assert.equal(free.body.bill.taxAmount,0); assert.equal(free.body.bill.netAmount,5);
});
test('invalid checkout percentages reject the bill without writing any records',async()=>{
  const count=await prisma.bill.count();
  for(const value of [-1,100.01,'10',null]) assert.equal((await save([line('dive',1,100)],value)).status,400);
  assert.equal(await prisma.bill.count(),count);
});
test('individual product price overrides persist with existing discounts and leave other products and catalogue prices intact',async()=>{
  const result=await save([{...line('dive',3,62.5,20),sellerStaffId:'seller'},line('rental',1,50)],0);
  assert.equal(result.status,201,JSON.stringify(result.body));
  const saved=await prisma.bill.findUnique({where:{id:result.body.bill.id},include:{items:true}});
  const dive=saved.items.find(row=>row.itemId==='dive');
  assert.equal(dive.unitPrice,62.5); assert.equal(dive.lineTotal,150); assert.equal(dive.discountPercent,20);
  assert.equal(dive.poolContributionAmount,15); assert.equal(dive.totalPersonalCommission,12);
  assert.equal(saved.items.find(row=>row.itemId==='rental').unitPrice,50);
  assert.equal(saved.serviceChargeAmount,20); assert.equal(saved.taxAmount,35.2); assert.equal(saved.netAmount,255.2);
  assert.equal((await prisma.item.findUnique({where:{id:'dive'}})).price,100);
});
