const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTypeScript, request } = require('./helpers/runtime.cjs');
const { createTestDatabase } = require('./helpers/postgres.cjs');
const db = createTestDatabase('packagesreadonly');
const { prisma } = db;
const { packagesRouter } = loadTypeScript('src/routes/packages.routes.ts', { '../db': { prisma }, '../middleware/auth': { requireAuth: (req,res,next) => req.user ? next() : res.status(401).json({ error:'Sign in.' }) } });
const router = { handle(req,res,next) { packagesRouter.handle(req,res,error => error ? next(error) : res.status(404).json({ error:'Not found.' })); } };
const user = { id:'manager', role:'PROPERTY_MANAGER', assignedPropertyIds:['a'] };
test.before(async () => {
 await prisma.property.create({data:{id:'a',name:'Centre',code:'A'}});
 await prisma.category.create({data:{id:'cat',propertyId:'a',name:'Dives'}});
 await prisma.item.create({data:{id:'item',propertyId:'a',categoryId:'cat',code:'DIV',name:'Dive',price:90}});
 await prisma.divePackage.create({data:{id:'package',propertyId:'a',code:'OLD',name:'Existing package',price:1,items:{create:{itemId:'item',quantity:2}}}});
});
test.after(()=>db.dispose());
test('existing packages remain readable with current catalogue totals and property authorization',async()=>{
 const result=await request(router,'GET','/',{user,query:{propertyId:'a'}});
 assert.equal(result.status,200);assert.equal(result.body.packages[0].price,180);
 assert.equal((await request(router,'GET','/',{user:{...user,assignedPropertyIds:['b']},query:{propertyId:'a'}})).status,403);
 assert.equal((await request(router,'GET','/',{user:null,query:{propertyId:'a'}})).status,401);
});
test('package builder mutations no longer exist, even for global administrators',async()=>{
 const before=await prisma.divePackage.findMany({include:{items:true}});
 for(const [method,url] of [['POST','/'],['PUT','/package'],['DELETE','/package']]) {
  assert.equal((await request(router,method,url,{user:{...user,role:'GLOBAL_ADMIN'},body:{propertyId:'a',name:'Changed'}})).status,404);
 }
 assert.deepEqual(await prisma.divePackage.findMany({include:{items:true}}),before);
});
