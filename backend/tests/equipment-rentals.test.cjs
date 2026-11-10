const test = require('node:test');
const assert = require('node:assert/strict');
const { z } = require('zod');
const { createTestDatabase } = require('./helpers/postgres.cjs');
const { loadTypeScript, request } = require('./helpers/runtime.cjs');
const database = createTestDatabase('equipment');
const { prisma } = database;
let lookups=0;
const guest={fullName:'Rental Guest',roomNumber:'0012',confirmationNumber:'BOOK-12',arrivalDate:'2026-11-01',checkoutDate:'2099-12-01',propertyCode:'SW',guestType:'main',nationality:null,nationalityCode:null};
const pms={pmsPropertyCodeSchema:z.enum(['SW']),PmsLookupError:class extends Error{},lookupInhouseGuests:async()=>{lookups++;return {guests:[guest]};}};
const stubs={
 '../db':{prisma},'../../db':{prisma},
 '../middleware/auth':{requireAuth:(req,res,next)=>req.user?next():res.status(401).json({error:'Unauthorized'})},
 '../middleware/security':{pmsLookupLimiter:(_r,_s,n)=>n()},
 '../pmsService':pms,'../services/pmsService':pms,
 '../disclaimerTesting':{disclaimerTestGuestsEnabled:()=>false},'../services/disclaimerTesting':{disclaimerTestGuestsEnabled:()=>false},
 'express-rate-limit':()=> (_r,_s,n)=>n(),
};
const {equipmentRouter}=loadTypeScript('src/routes/equipment.routes.ts',stubs);
const {waterSportsRouter}=loadTypeScript('src/routes/water-sports.routes.ts',stubs);
const actor={id:'manager',role:'PROPERTY_MANAGER',assignedPropertyIds:['male']};
const invoke=(method,url,body={},user=actor)=>request(equipmentRouter,method,url,{user,body,query:{propertyId:'male'}});
const tablet=(token,method,url,body={})=>request({handle(req,res,next){res.setHeader=()=>{};waterSportsRouter.handle(req,res,next);}},method,'/tablet'+url,{user:null,headers:{authorization:`Bearer ${token}`},body});
const stockData=(code,extra={})=>({propertyId:'male',code,name:'Fins',category:'Fins',size:'M',condition:'GOOD',quantity:3,priceCents:1500,...extra});
const createStock=async(code,extra)=>{const r=await invoke('POST','/inventory',stockData(code,extra));assert.equal(r.status,201,JSON.stringify(r.body));return r.body;};
const draftData=(stock,quantity=1)=>({propertyId:'male',guest:{roomNumber:'0012',fullName:guest.fullName,confirmationNumber:guest.confirmationNumber,propertyCode:'SW'},expectedReturnDate:'2099-12-01',assignedStaffId:'employee',lines:[{stockId:stock.id,quantity}]});
const createDraft=async(stock,quantity)=>{const r=await invoke('POST','/rentals',draftData(stock,quantity));assert.equal(r.status,201,JSON.stringify(r.body));return r.body;};
const versionBody=r=>({propertyId:'male',version:r.version});
async function sign(rental){
 const link=await invoke('POST',`/rentals/${rental.id}/agreement`,versionBody(rental));assert.equal(link.status,201,JSON.stringify(link.body));
 const opened=await tablet(link.body.token,'GET','');assert.equal(opened.status,200);
 assert(opened.body.documents[0].body.includes(rental.reference));assert(opened.body.documents[0].body.includes('Fins'));
 const count=lookups;const guests=await tablet(link.body.token,'POST','/guests',{roomNumber:'0012'});assert.equal(guests.status,200);assert.equal(guests.body.guests.length,1);assert.equal(lookups,count);
 const signed=await tablet(link.body.token,'POST','/sign',{candidateId:guests.body.guests[0].id,documentId:opened.body.documents[0].id,acknowledged:true,isMinor:false,guardianName:'',signature:[[[10,20],[100,50]]]});assert.equal(signed.status,200,JSON.stringify(signed.body));
 return link.body.token;
}
test.before(async()=>{
 await prisma.property.createMany({data:[{id:'male',code:'SW',name:'Siyam World'},{id:'other',code:'OTHER',name:'Other'}]});
 await prisma.user.create({data:{id:'manager',username:'rental-manager',name:'Manager',passwordHash:'test'}});
 await prisma.staffMember.createMany({data:[{id:'employee',propertyId:'male',name:'Instructor',roleTitle:'Instructor',hireDate:'2020-01-01'},{id:'foreign-staff',propertyId:'other',name:'Other staff',roleTitle:'Instructor',hireDate:'2020-01-01'}]});
});
test.after(()=>database.dispose());
test('inventory validates types, serial uniqueness, sizes, manager role and property access',async()=>{
 const staff={...actor,role:'CENTRE_STAFF'};
 assert.equal((await invoke('POST','/inventory',stockData('deny'),staff)).status,403);
 assert.equal((await invoke('GET','/inventory',{},null)).status,401);
 assert.equal((await invoke('POST','/inventory',stockData('deny',{propertyId:'other'}))).status,403);
 for(const extra of [{quantity:'2'},{quantity:1.5},{priceCents:-1},{priceCents:0.5},{size:'XXXS'},{serialNumber:'S1',quantity:2},{condition:'broken'}])assert.equal((await invoke('POST','/inventory',stockData('invalid',extra))).status,400);
 const s=await createStock('SERIAL',{serialNumber:'S1',quantity:1});assert(s.id);
 assert.equal((await invoke('POST','/inventory',stockData('OTHER-SERIAL',{serialNumber:'S1',quantity:1}))).status,409);
});
test('draft does not reserve stock, requires valid guest and staff, and cannot confirm unsigned',async()=>{
 const s=await createStock('DRAFT');const r=await createDraft(s,2);
 assert.equal(r.totalCents,3000);assert.equal(r.guestSnapshot.roomNumber,'0012');
 const inv=await invoke('GET','/inventory');assert.equal(inv.body.find(x=>x.id===s.id).availableQuantity,3);
 assert.equal((await invoke('POST',`/rentals/${r.id}/confirm`,versionBody(r))).status,409);
 assert.equal((await invoke('POST','/rentals',{...draftData(s),assignedStaffId:'foreign-staff'})).status,409);
 assert.equal((await invoke('POST','/rentals',{...draftData(s),guest:{...draftData(s).guest,fullName:'Forged'}})).status,409);
 assert.equal((await invoke('POST','/rentals',{...draftData(s),lines:[{stockId:s.id,quantity:4}]})).status,409);
 assert.equal((await invoke('POST','/rentals',{...draftData(s),lines:[{stockId:s.id,quantity:1},{stockId:s.id,quantity:1}]})).status,400);
});
test('signature gate, partial returns, damaged quarantine, duplicate returns and closure preserve history',async()=>{
 const s=await createStock('RETURN');const r=await createDraft(s,3);await sign(r);
 const confirmed=await invoke('POST',`/rentals/${r.id}/confirm`,versionBody(r));assert.equal(confirmed.status,200);let current=confirmed.body;assert.equal(current.status,'ACTIVE');
 assert.equal((await invoke('PUT',`/inventory/${s.id}`,stockData(s.code))).status,409);
 assert.equal((await invoke('POST',`/rentals/${r.id}/close`,versionBody(current))).status,409);
 const line=current.lines[0];const input={...versionBody(current),lines:[{lineId:line.id,quantity:1,condition:'DAMAGED',note:'Split blade'}]};
 const returned=await invoke('POST',`/rentals/${r.id}/return`,input);assert.equal(returned.status,200);current=returned.body;assert.equal(current.status,'PARTIALLY_RETURNED');
 assert.equal((await invoke('POST',`/rentals/${r.id}/return`,input)).status,409);
 let inv=(await invoke('GET','/inventory')).body.find(x=>x.id===s.id);assert.equal(inv.damagedQuantity,1);assert.equal(inv.availableQuantity,0);
 assert.equal((await invoke('POST',`/rentals/${r.id}/return`,{...versionBody(current),lines:[{lineId:line.id,quantity:3,condition:'GOOD'}]})).status,409);
 const rest=await invoke('POST',`/rentals/${r.id}/return`,{...versionBody(current),lines:[{lineId:line.id,quantity:2,condition:'GOOD'}]});assert.equal(rest.status,200);current=rest.body;assert.equal(current.status,'RETURNED');
 inv=(await invoke('GET','/inventory')).body.find(x=>x.id===s.id);assert.equal(inv.availableQuantity,2);
 const closed=await invoke('POST',`/rentals/${r.id}/close`,versionBody(current));assert.equal(closed.status,200);assert.equal(closed.body.status,'CLOSED');assert(closed.body.agreements[0].session.record);
 assert.equal(await prisma.rentalEvent.count({where:{rentalId:r.id,action:'RETURN'}}),2);
 assert.equal(await prisma.auditLog.count({where:{targetId:r.id,action:'EQUIPMENT_RETURN'}}),2);
});
test('concurrent confirmations cannot overbook one serialised item',async()=>{
 const s=await createStock('RACE',{quantity:1,serialNumber:'RACE-SERIAL'});const a=await createDraft(s),b=await createDraft(s);await sign(a);await sign(b);
 const results=await Promise.all([a,b].map(r=>invoke('POST',`/rentals/${r.id}/confirm`,versionBody(r))));assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
 assert.equal((await invoke('GET','/inventory')).body.find(x=>x.id===s.id).availableQuantity,0);
});
test('draft editing preserves old signatures, revokes invitations and requires a new version signature',async()=>{
 const s=await createStock('EDIT');const r=await createDraft(s);const oldToken=await sign(r);
 const edit=await invoke('PUT',`/rentals/${r.id}`,{...draftData(s,2),version:r.version});assert.equal(edit.status,200,JSON.stringify(edit.body));const edited=edit.body;assert.equal(edited.version,r.version+1);assert(edited.agreements[0].session.record);
 assert.equal((await invoke('POST',`/rentals/${r.id}/confirm`,versionBody(edited))).status,409);
 assert.equal((await invoke('PUT',`/rentals/${r.id}`,{...draftData(s),version:r.version})).status,409);
 assert.equal((await tablet(oldToken,'POST','/sign',{})).status,200); // Idempotent read of the old completed agreement.
 await sign(edited);assert.equal((await invoke('POST',`/rentals/${r.id}/confirm`,versionBody(edited))).status,200);
});
test('foreign rental IDs and return lines cannot change stock; overdue is derived without losing partial state',async()=>{
 const s=await createStock('ISOLATION');const r=await createDraft(s);await sign(r);const active=(await invoke('POST',`/rentals/${r.id}/confirm`,versionBody(r))).body;
 assert.equal((await invoke('POST',`/rentals/${r.id}/return`,{...versionBody(active),lines:[{lineId:'foreign',quantity:1,condition:'GOOD'}]})).status,409);
 const stranger={...actor,assignedPropertyIds:['other']};assert.equal((await invoke('GET',`/rentals/${r.id}`,{},stranger)).status,403);
 await prisma.equipmentRental.update({where:{id:r.id},data:{expectedReturnDate:'2020-01-01'}});
 const detail=await invoke('GET',`/rentals/${r.id}`);assert.equal(detail.body.status,'ACTIVE');assert.equal(detail.body.displayStatus,'OVERDUE');
});
test('changed equipment details invalidate handover until the draft is re-signed',async()=>{
 const s=await createStock('CHANGED');const r=await createDraft(s);await sign(r);
 assert.equal((await invoke('PUT',`/inventory/${s.id}`,stockData(s.code,{condition:'FAIR'}))).status,200);
 assert.equal((await invoke('POST',`/rentals/${r.id}/confirm`,versionBody(r))).status,409);
 const edited=(await invoke('PUT',`/rentals/${r.id}`,{...draftData(s),version:r.version})).body;assert.equal(edited.lines[0].condition,'FAIR');await sign(edited);
 assert.equal((await invoke('POST',`/rentals/${r.id}/confirm`,versionBody(edited))).status,200);
});
test('saved disclaimer guests can be reused without PMS and closed drafts revoke unsigned links',async()=>{
 const s=await createStock('SAVED-GUEST');const original=await createDraft(s);await sign(original);
 const signed=(await invoke('GET',`/rentals/${original.id}`)).body.agreements[0].session.record;
 const count=lookups;const r=await invoke('POST','/rentals',{...draftData(s),guest:{recordId:signed.id}});assert.equal(r.status,201);assert.equal(lookups,count);assert.equal(r.body.guestSnapshot.fullName,guest.fullName);
 const draft=r.body;const invitation=await invoke('POST',`/rentals/${draft.id}/agreement`,versionBody(draft));assert.equal(invitation.status,201);
 assert.equal((await invoke('POST',`/rentals/${draft.id}/close`,versionBody(draft))).status,200);
 assert.equal((await tablet(invitation.body.token,'GET','')).status,410);
});
test('serviceable bulk returns downgrade the batch condition; expired invitations cannot be signed',async()=>{
 const s=await createStock('FAIR');const r=await createDraft(s);await sign(r);const active=(await invoke('POST',`/rentals/${r.id}/confirm`,versionBody(r))).body;
 const response=await invoke('POST',`/rentals/${r.id}/return`,{...versionBody(active),lines:[{lineId:active.lines[0].id,quantity:1,condition:'FAIR',note:'Signs of wear'}]});assert.equal(response.status,200);
 assert.equal((await invoke('GET','/inventory')).body.find(x=>x.id===s.id).condition,'FAIR');
 const d=await createDraft(s);const invitation=await invoke('POST',`/rentals/${d.id}/agreement`,versionBody(d));assert.equal(invitation.status,201);
 const {createHash}=require('node:crypto');await prisma.waterSportsSession.update({where:{tokenHash:createHash('sha256').update(invitation.body.token).digest('hex')},data:{expiresAt:new Date('2020-01-01')}});
 assert.equal((await tablet(invitation.body.token,'POST','/sign',{})).status,410);
});
