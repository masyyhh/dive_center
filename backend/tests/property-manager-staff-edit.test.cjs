const test=require('node:test');const assert=require('node:assert/strict');
const {loadTypeScript,request}=require('./helpers/runtime.cjs');const {createTestDatabase}=require('./helpers/postgres.cjs');
const database=createTestDatabase('managerstaff');const {prisma}=database;
const {staffRouter}=loadTypeScript('src/routes/staff.routes.ts',{'../db':{prisma},'../middleware/auth':{requireAuth:(_req,_res,next)=>next()}});
const manager={id:'manager',role:'PROPERTY_MANAGER',assignedPropertyIds:['own']};
const call=(method,url,body,user=manager,query={})=>request(staffRouter,method,url,{body,user,query});
test.before(async()=>{
 await prisma.property.createMany({data:[{id:'own',code:'OWN',name:'Own'},{id:'other',code:'OTHER',name:'Other'}]});
 await prisma.user.create({data:{id:'manager',username:'manager-staff-edit',name:'Manager',passwordHash:'unused'}});
 await prisma.staffMember.createMany({data:[{id:'own-staff',propertyId:'own',name:'Original',roleTitle:'Instructor',hireDate:'2026-01-01'},{id:'other-staff',propertyId:'other',name:'Other',roleTitle:'Instructor',hireDate:'2026-01-01'}]});
});test.after(()=>database.dispose());
test('property managers edit own staff details, dates and pool settings with an audit trail',async()=>{
 const response=await call('PUT','/own-staff',{name:'Updated Name',email:'updated@example.com',roleTitle:'Photographer',hireDate:'2026-02-01',leavingDate:'2026-12-31',isCoursePoolSharing:false,isDivePoolSharing:false,isBaseLeaderOverride:false,isDiveStaff:false});
 assert.equal(response.status,200,JSON.stringify(response.body));assert.equal(response.body.staff.propertyId,'own');assert.equal(response.body.staff.name,'Updated Name');assert.equal(response.body.staff.isDiveStaff,false);
 const audit=await prisma.auditLog.findFirst({where:{targetId:'own-staff',action:'STAFF_UPDATE'}});const details=JSON.parse(audit.details);assert.equal(details.before.name,'Original');assert.equal(details.after.name,'Updated Name');
});
test('foreign staff, ordinary staff, account changes and property reassignment are denied',async()=>{
 assert.equal((await call('PUT','/other-staff',{name:'Forbidden'})).status,403);
 assert.equal((await call('PUT','/own-staff',{name:'Forbidden'},{...manager,role:'CENTRE_STAFF'})).status,403);
 for(const patch of [{propertyId:'other'},{userId:'manager'},{role:'GLOBAL_ADMIN'},{loginAccess:{username:'admin',password:'bad'}}])assert.equal((await call('PUT','/own-staff',patch)).status,400);
 assert.equal((await prisma.staffMember.findUnique({where:{id:'other-staff'}})).name,'Other');
});
test('invalid booleans, dates and employment windows cannot update staff',async()=>{
 for(const patch of [{isActive:'false'},{isDiveStaff:1},{isCoursePoolSharing:'true'},{hireDate:'2026-02-30'},{leavingDate:'2025-01-01'},{name:'x'}])assert.equal((await call('PUT','/own-staff',patch)).status,400,JSON.stringify(patch));
});
test('inactive roster editing is available only to managers within their property and never used for bill credit lists',async()=>{
 assert.equal((await call('PUT','/own-staff',{isActive:false})).status,200);
 const regular=await call('GET','/',{},manager,{propertyId:'own'});assert.equal(regular.body.staff.length,0);
 const roster=await call('GET','/',{},manager,{propertyId:'own',includeInactive:'true'});assert.equal(roster.status,200);assert.equal(roster.body.staff[0].id,'own-staff');
 assert.equal((await call('GET','/',{},{...manager,role:'CENTRE_STAFF'},{propertyId:'own',includeInactive:'true'})).status,403);
 assert.equal((await call('GET','/',{},manager,{propertyId:'other',includeInactive:'true'})).status,403);
 assert.equal((await call('GET','/',{},manager,{propertyId:'own',includeInactive:'true',creditOnDate:'2026-11-04'})).status,400);
 assert.equal((await call('PUT','/own-staff',{isActive:true,leavingDate:null})).status,200);
});
test('optional ER numbers persist across properties, preserve leading zeros and can be cleared',async()=>{
 const admin={...manager,role:'GLOBAL_ADMIN'};
 for(const propertyId of ['own','other']){
  const input={propertyId,name:'Employee with ER',roleTitle:'Instructor',hireDate:'2026-01-01',erNumber:'  0007-AB  '};
  const created=await call('POST','/',input,admin);
  assert.equal(created.status,201,JSON.stringify(created.body));
  const id=created.body.staff.id;
  assert.equal(created.body.staff.erNumber,'0007-AB');
  assert.equal((await prisma.staffMember.findUnique({where:{id}})).erNumber,'0007-AB');
  const edited=await call('PUT','/'+id,{name:'Renamed employee'},admin);
  assert.equal(edited.status,200);assert.equal(edited.body.staff.erNumber,'0007-AB');
  assert.equal((await call('PUT','/'+id,{erNumber:'  '},admin)).body.staff.erNumber,null);
  assert.equal((await call('PUT','/'+id,{erNumber:'ER-002'},admin)).body.staff.erNumber,'ER-002');
  assert.equal((await call('PUT','/'+id,{erNumber:null},admin)).body.staff.erNumber,null);
  const listed=await call('GET','/',{},admin,{propertyId});
  assert.equal(listed.body.staff.find(row=>row.id===id).erNumber,null);
 }
 for(const erNumber of [undefined,'',null]){
  const created=await call('POST','/',{propertyId:'own',name:'Without ER',roleTitle:'Instructor',hireDate:'2026-01-01',...(erNumber===undefined?{}:{erNumber})});
  assert.equal(created.status,201,JSON.stringify(created.body));assert.equal(created.body.staff.erNumber,null);
 }
});
test('ER numbers reject invalid types and lengths and respect staff editing permissions',async()=>{
 for(const erNumber of [123,{},'x'.repeat(101)]){
  assert.equal((await call('PUT','/own-staff',{erNumber})).status,400);
  assert.equal((await call('POST','/',{propertyId:'own',name:'Invalid ER',roleTitle:'Instructor',hireDate:'2026-01-01',erNumber})).status,400);
 }
 assert.equal((await call('PUT','/other-staff',{erNumber:'forbidden'})).status,403);
 assert.equal((await call('PUT','/own-staff',{erNumber:'forbidden'},{...manager,role:'CENTRE_STAFF'})).status,403);
 assert.equal((await prisma.staffMember.findUnique({where:{id:'other-staff'}})).erNumber,null);
});
