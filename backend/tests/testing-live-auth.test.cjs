const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadTypeScript, request } = require('./helpers/runtime.cjs');
const { createTestDatabase } = require('./helpers/postgres.cjs');
const database = createTestDatabase('testingliveauth'); const { prisma } = database;
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dcm-live-auth-'));
const allowedFile = path.join(directory, 'allowed.json');
const previous = Object.fromEntries(['TESTING_LIVE_AUTH','TESTING_LIVE_AUTH_ORIGIN','TESTING_ALLOWED_USER_IDS_FILE','AUTHENTICATOR_ENCRYPTION_KEY','AUTHENTICATOR_ENCRYPTION_KEY_FILE','JWT_SECRET','JWT_SECRET_FILE'].map(name => [name,process.env[name]]));
process.env.TESTING_LIVE_AUTH='true'; process.env.TESTING_LIVE_AUTH_ORIGIN='https://live.example.test'; process.env.TESTING_ALLOWED_USER_IDS_FILE=allowedFile;
process.env.JWT_SECRET='testing-only-jwt-secret-that-is-independent'; delete process.env.JWT_SECRET_FILE;
process.env.AUTHENTICATOR_ENCRYPTION_KEY='ab'.repeat(32); delete process.env.AUTHENTICATOR_ENCRYPTION_KEY_FILE;
const identity = { id:'selected', username:'tester', name:'Selected Tester', email:'tester@example.test', role:'PROPERTY_MANAGER', authenticatorEnabled:true,
  assignedProperties:[{id:'property',code:'TEST',name:'Property shell',currency:'USD',currencySymbol:'$',taxRate:16,serviceChargeRate:10,isActive:true,pmsPropertyCode:'PRIVATE',nextCheckNumber:999}] };
const liveToken='live.fixture.signed-session';
const calls=[]; let liveStatus=200; let currentIdentity=structuredClone(identity); let fail=false;
const fakeFetch=async (url,options) => { calls.push({url,options}); if(fail)throw Error('unavailable'); return { ok:liveStatus===200,status:liveStatus,text:async()=>JSON.stringify({user:currentIdentity}) }; };
const stubs={ '../db':{prisma} };
const globals={fetch:fakeFetch};
const service=loadTypeScript('src/services/testingLiveAuth.ts',stubs,globals);
const { requireAuth, requireLogoutAuth }=loadTypeScript('src/middleware/auth.ts',stubs,globals);
const { Router }=require('express');
const router=Router(); router.get('/', requireAuth, (req,res)=>res.json({user:req.user}));
router.post('/logout-test',requireLogoutAuth,(req,res)=>res.json({sessionId:req.testingLiveSessionId}));
const {testingAuthRouter}=loadTypeScript('src/routes/testing-auth.routes.ts',stubs,globals);
const allow=ids=>fs.writeFileSync(allowedFile,JSON.stringify(ids));
const auth=token=>request(router,'GET','/',{user:undefined,headers:{authorization:`Bearer ${token}`}});
let token;
test.before(()=>allow(['selected']));
test.after(async()=>{await database.dispose();fs.rmSync(directory,{recursive:true,force:true});for(const[name,value]of Object.entries(previous)){if(value===undefined)delete process.env[name];else process.env[name]=value;}});
test('selected enrolled live users receive an opaque test session and only identity/property shells are copied',async()=>{
 const result=await service.createTestingLiveSession(liveToken); token=result.token;
 assert.match(token,/^test_live_[a-f0-9]{64}$/);assert.equal(result.user.authenticatorEnabled,true);assert.equal(result.user.username,'tester');
 const user=await prisma.user.findUnique({where:{id:'live:selected'},include:{authenticator:true}});
 assert.equal(user.passwordHash,'!LIVE-AUTH-ONLY');assert.equal(user.authenticator,null);assert.equal(user.role,'PROPERTY_MANAGER');
 const property=await prisma.property.findUnique({where:{id:'property'}});assert.equal(property.nextCheckNumber,1001);assert.equal(property.pmsPropertyCode,null);
 assert.equal(await prisma.bill.count(),0);assert.equal(await prisma.staffMember.count(),0);
 const session=await prisma.testingLiveSession.findFirst();assert.notEqual(session.liveTokenCiphertext,liveToken);assert.notEqual(session.tokenHash,token);
 assert(!JSON.stringify(result).includes(liveToken));
 assert(calls.every(call=>call.url==='https://live.example.test/api/auth/me'&&call.options.method==='GET'&&call.options.redirect==='error'));
});
test('every testing request rechecks live status, preserves scoped roles and never accepts a live JWT directly',async()=>{
 const result=await auth(token);assert.equal(result.status,200);assert.equal(result.body.user.role,'PROPERTY_MANAGER');assert.deepEqual(result.body.user.assignedPropertyIds,['property']);
 assert.equal((await auth(liveToken)).status,401);
 await prisma.user.update({where:{id:'live:selected'},data:{role:'GLOBAL_ADMIN'}});
 assert.equal((await auth(token)).body.user.role,'PROPERTY_MANAGER');
 const me=await request(testingAuthRouter,'GET','/me',{user:undefined,headers:{authorization:`Bearer ${token}`}});assert.equal(me.status,200);assert.equal(me.body.user.username,'tester');
});
test('nonselected or unenrolled users cannot exchange live sessions and local authentication/setup cannot bypass selection',async()=>{
 allow([]);await assert.rejects(service.createTestingLiveSession(liveToken),error=>error.status===403);allow(['selected']);
 currentIdentity={...identity,authenticatorEnabled:false};await assert.rejects(service.createTestingLiveSession(liveToken),error=>error.status===403);currentIdentity=structuredClone(identity);
 for(const url of ['/login','/authenticator/setup','/password-reset/verify'])assert.equal((await request(testingAuthRouter,'POST',url,{body:{username:'tester',password:'password'}})).status,403);
});
test('removal from the selected list revokes the active testing session, and re-adding does not restore it',async()=>{
 allow([]);assert.equal((await auth(token)).status,403);assert.equal(await prisma.testingLiveSession.count(),0);
 allow(['selected']);assert.equal((await auth(token)).status,401);token=(await service.createTestingLiveSession(liveToken)).token;
});
test('live outages fail closed but testing logout works without revoking the live token',async()=>{
 fail=true;assert.equal((await auth(token)).status,503);const count=calls.length;
 const result=await request(testingAuthRouter,'POST','/logout',{user:undefined,headers:{authorization:`Bearer ${token}`}});
 assert.equal(result.status,200);assert.equal(calls.length,count);assert.equal(await prisma.testingLiveSession.count(),0);fail=false;
 token=(await service.createTestingLiveSession(liveToken)).token;liveStatus=401;assert.equal((await auth(token)).status,401);assert.equal(await prisma.testingLiveSession.count(),0);liveStatus=200;
});
test('expired sessions, missing selection configuration and invalid origins never grant access',async()=>{
 token=(await service.createTestingLiveSession(liveToken)).token;await prisma.testingLiveSession.updateMany({data:{expiresAt:new Date(0)}});assert.equal((await auth(token)).status,401);
 fs.unlinkSync(allowedFile);await assert.rejects(service.createTestingLiveSession(liveToken),error=>error.status===503);allow(['selected']);
 for(const origin of ['http://live.example.test','https://live.example.test/elsewhere','https://user:pass@live.example.test']){process.env.TESTING_LIVE_AUTH_ORIGIN=origin;await assert.rejects(service.createTestingLiveSession(liveToken),error=>error.status===503);}process.env.TESTING_LIVE_AUTH_ORIGIN='https://live.example.test';
});
test('changing live property assignments removes stale testing permissions and changes live roles immediately',async()=>{
 currentIdentity=structuredClone(identity);token=(await service.createTestingLiveSession(liveToken)).token;
 currentIdentity={...identity,role:'CENTRE_STAFF',assignedProperties:[]};const result=await auth(token);assert.equal(result.status,200);assert.equal(result.body.user.role,'CENTRE_STAFF');assert.deepEqual(result.body.user.assignedPropertyIds,[]);
 currentIdentity=structuredClone(identity);
});
