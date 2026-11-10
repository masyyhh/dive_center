import hashlib
import importlib.util
from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('manual_production', ROOT / 'scripts/install-manual-production.py')
manual = importlib.util.module_from_spec(spec)
spec.loader.exec_module(manual)


class ManualProduction(unittest.TestCase):
    def test_release_disables_both_backend_flags_and_frontend_module(self):
        commit = 'a' * 40
        release, helper, fingerprint = manual.render(ROOT, commit)
        self.assertEqual(release, commit[:12])
        self.assertIn('commit=' + commit, helper)
        self.assertNotIn('0ce1e232', helper)
        self.assertIn('--build-arg VITE_ENABLE_WATER_SPORTS=false', helper)
        self.assertNotIn('--build-arg "VITE_ENABLE_WATER_SPORTS=$feature"', helper)
        self.assertIn("'ENABLE_DIVE_CENTRE':'false','ENABLE_WATER_SPORTS':'false'", helper)
        self.assertIn('process.env.ENABLE_DIVE_CENTRE!=="false"', helper)
        self.assertIn(hashlib.sha256(fingerprint.encode()).hexdigest(), helper)
        subprocess.run(['bash', '-n'], input=helper, text=True, check=True)

    def test_original_data_checks_and_release_guards_remain(self):
        _, helper, fingerprint = manual.render(ROOT, 'b' * 40)
        for guard in ['flock -n', 'active.override.json', 'compare_data "$before_file" "$after_file"',
                      'verify_authenticators', 'backup "$work/cutover"', 'test ! -e "$work/STARTED"']:
            self.assertIn(guard, helper)
        self.assertIn("throw Error('Unexpected new production table.')", fingerprint)
        self.assertIn("throw Error('An original table or column is missing: ' + name)", fingerprint)

    def test_rental_table_checks_fail_closed(self):
        _, _, fingerprint = manual.render(ROOT, 'c' * 40)
        # Execute only the verification helper against a synthetic Prisma stub.
        harness = r'''
const moduleFixture = {exports:{}};
new Function('require','module',__FINGERPRINT__)(require,moduleFixture);
const rentalTables=__TABLES__;
async function verify(extra,missing,unexpected){
 const names=['Existing',...rentalTables.filter(t=>t!==missing),...(unexpected?['Unapproved']:[])];
 const prisma={
  $executeRawUnsafe:async()=>{},
  $queryRawUnsafe:async(sql)=>{
   if(sql.includes('information_schema.columns'))return names.map(table_name=>({table_name,column_name:'id'}));
   if(sql.includes('COUNT(*)::text AS count'))return [{count:extra?'1':'0',sha256:'unchanged'}];
   throw Error('unexpected query');
  }
 };
 try{await moduleFixture.exports.fingerprint(prisma,{tables:{Existing:{columns:['id']}}});return 'accepted';}
 catch(e){return e.message;}
}
(async()=>{
 for(const [args,expected] of [
  [[true,null,false],'New rental table must be empty:'],
  [[false,'RentalEvent',false],'Missing rental table:'],
  [[false,null,true],'Unexpected new production table.']
 ]){
  const result=await verify(...args);if(!result.startsWith(expected))throw Error(result);
 }
})().catch(e=>{console.error(e);process.exitCode=1});
'''
        import json
        harness = harness.replace('__FINGERPRINT__', json.dumps(fingerprint)).replace('__TABLES__', json.dumps(manual.RENTAL_TABLES))
        subprocess.run(['node'], input=harness, text=True, check=True, cwd=ROOT)

    def test_bad_revision_and_changed_template_are_rejected(self):
        with self.assertRaises(ValueError):
            manual.render(ROOT, 'main')
        with self.assertRaises(ValueError):
            manual.replace_once('changed source', 'expected marker', 'replacement')
