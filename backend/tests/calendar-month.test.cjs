const test=require('node:test');
const assert=require('node:assert/strict');
const {loadTypeScript}=require('./helpers/runtime.cjs');
const {businessMonth}=loadTypeScript('src/utils/dates.ts');
test('month boundaries retain the requested year, including years below 100 and leap years',()=>{
 for(const [month,end] of [['0000-02','0000-02-29'],['0001-02','0001-02-28'],['0099-12','0099-12-31'],['2000-02','2000-02-29'],['2100-02','2100-02-28'],['2026-11','2026-11-30'],['9999-12','9999-12-31']])assert.deepEqual(businessMonth(month),{start:month+'-01',end});
 assert.equal(businessMonth('2026-13'),null);assert.equal(businessMonth('bad'),null);
});
