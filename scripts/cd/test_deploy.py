import importlib.util
import json
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('dive_cd', Path(__file__).with_name('deploy.py'))
cd = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cd)

def manifest():
    return {'release': 'a'*40, 'run_id': '123', 'backend': cd.REGISTRY+'-backend@sha256:'+'b'*64, 'web': cd.REGISTRY+'-web@sha256:'+'c'*64}

class ReleaseValidation(unittest.TestCase):
    def test_accepts_only_immutable_application_images(self):
        self.assertEqual(cd.validate_manifest(manifest()), manifest())
        for key, bad in [('release', 'main'), ('run_id', '123;rm -rf /'), ('backend', 'postgres:18'), ('web', cd.REGISTRY+'-web:latest'), ('backend', 'ghcr.io/attacker/backend@sha256:'+'b'*64)]:
            value=manifest(); value[key]=bad
            with self.assertRaises(ValueError): cd.validate_manifest(value)
        value=manifest(); value['environment']='production'
        with self.assertRaises(ValueError): cd.validate_manifest(value)

    def test_override_changes_application_only_and_preserves_auth_modes(self):
        for environment, issuer in [('testing','Dive Centre Manager Testing'), ('production','Dive Centre Manager')]:
            value=cd.override(manifest(), environment, '/var/lib/dive-cd/environment.js')
            self.assertEqual(set(value), {'services'})
            self.assertEqual(set(value['services']), {'backend','web'})
            self.assertEqual(value['services']['backend']['environment']['AUTHENTICATOR_ISSUER'], issuer)
            self.assertEqual(value['services']['backend']['environment']['TESTING_LIVE_AUTH'], 'false')
            self.assertEqual(value['services']['web']['volumes'][0]['target'], '/srv/environment.js')
            for service in value['services'].values():
                self.assertNotIn('ports', service)
                self.assertNotIn('networks', service)
                self.assertNotIn('secrets', service)

class FailureRecovery(unittest.TestCase):
    def deployment(self):
        instance=cd.Deployment.__new__(cd.Deployment)
        instance.project='dive-centre-testing-standalone'
        instance.dbname='dive_center_testing'
        instance.frozen=True; instance.migration_started=False; instance.reopened=False
        return instance

    def test_database_restore_never_happens_before_migrations(self):
        from tempfile import TemporaryDirectory
        with TemporaryDirectory() as directory:
            deployment=self.deployment()
            deployment.release_dir=Path(directory)
            deployment.active=Path(directory)/'active.json'
            deployment.previous_override=None
            deployment.old_images={'backend':'sha256:'+'a'*64,'web':'sha256:'+'b'*64}
            with patch.object(deployment,'compose') as compose, patch.object(deployment,'sql') as sql, patch.object(deployment,'restore') as restore:
                deployment.rollback()
                sql.assert_not_called(); restore.assert_not_called()
                self.assertEqual(compose.call_args_list[0].args[0],['stop','web','backend'])
                self.assertTrue((Path(directory)/'recovery.override.json').exists())

    def test_database_restore_refuses_corrupted_checkpoint(self):
        from tempfile import TemporaryDirectory
        with TemporaryDirectory() as directory:
            deployment=self.deployment(); deployment.migration_started=True
            deployment.final_backup=Path(directory)
            (Path(directory)/'database.dump').write_bytes(b'bad')
            (Path(directory)/'checksums.json').write_text(json.dumps({'database.dump':'0'*64}))
            with patch.object(deployment,'compose'),patch.object(deployment,'sql') as sql,patch.object(deployment,'restore') as restore:
                with self.assertRaisesRegex(ValueError,'checksum'): deployment.rollback()
                sql.assert_not_called(); restore.assert_not_called()

class ScopeChecks(unittest.TestCase):
    def instance(self):
        config={'environment':'testing','compose_files':['compose.yaml'],'env_file':'/dev/null','volume':'dive-centre-testing-standalone_testing_data','secrets':{'database_url':'/not-read-before-volume-check'}}
        return cd.Deployment(config, manifest())

    def test_wrong_database_volume_prevents_all_mutation(self):
        deployment=self.instance()
        inspected={'Config':{'Labels':{'com.docker.compose.project':deployment.project}},'State':{'Running':True},'Mounts':[{'Destination':'/var/lib/postgresql','Name':'production-data'}]}
        with patch.object(deployment,'inspect',return_value=inspected), patch.object(deployment,'cmd') as cmd:
            with self.assertRaisesRegex(ValueError,'volume'): deployment.assert_scope()
            cmd.assert_not_called()

    def test_wrong_database_project_prevents_all_mutation(self):
        deployment=self.instance()
        inspected={'Config':{'Labels':{'com.docker.compose.project':'dive-centre-prod'}},'State':{'Running':True}}
        with patch.object(deployment,'inspect',return_value=inspected), patch.object(deployment,'cmd') as cmd:
            with self.assertRaisesRegex(ValueError,'project'): deployment.assert_scope()
            cmd.assert_not_called()

    def test_candidate_retains_project_scope_and_original_files(self):
        deployment=self.instance()
        with patch.object(deployment,'cmd') as cmd:
            deployment.compose(['config','--quiet'],layer='/tmp/candidate.json')
            args=cmd.call_args.args[0]
            self.assertEqual(args[args.index('-p')+1], 'dive-centre-testing-standalone')
            self.assertIn('/srv/dive-centre-testing-independent/compose.yaml',args)
            self.assertEqual(args[-4:],['-f','/tmp/candidate.json','config','--quiet'])

if __name__=='__main__': unittest.main()
