import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('iruveli_deploy', Path(__file__).with_name('deploy.py'))
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)


class ReleaseTests(unittest.TestCase):
    def test_only_backend_image_command_and_explicit_scope_can_change(self):
        before = {'services': {'backend': {'image': 'old', 'entrypoint': ['entrypoint.sh'], 'command': ['node', 'dist/index.js'], 'environment': {'SECRET_FILE': '/run/secrets/key'}}, 'web': {'image': 'web'}}, 'volumes': {'database': {}}}
        env = {'IRUVELI_COMMISSION_PROPERTY_ID': 'id', 'IRUVELI_COMMISSION_EFFECTIVE_DATE': '2026-11-17'}
        after = copy.deepcopy(before)
        after['services']['backend'].update(deploy.image_override('new', env)['services']['backend'])
        after['services']['backend']['environment'] = dict(before['services']['backend']['environment'], **env)
        deploy.validate_candidate_config(before, after, 'new', env)
        for mutation in ['frontend', 'secret', 'database']:
            changed = copy.deepcopy(after)
            if mutation == 'frontend':
                changed['services']['web']['image'] = 'other'
            elif mutation == 'secret':
                changed['services']['backend']['environment']['SECRET_FILE'] = '/wrong'
            else:
                changed['volumes'] = {}
            with self.assertRaisesRegex(RuntimeError, 'changed more'):
                deploy.validate_candidate_config(before, changed, 'new', env)

    def test_override_bypasses_migration_entrypoint(self):
        value = deploy.image_override('old')['services']['backend']
        self.assertEqual(value['entrypoint'], ['node'])
        self.assertEqual(value['command'], ['dist/index.js'])
        self.assertNotIn('environment', value)

    def test_tampered_payload_fails_before_docker(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'runtime').mkdir()
            (root / 'runtime/module.js').write_text('changed')
            (root / 'manifest.json').write_text(json.dumps({'runtime': {'module.js': 'wrong'}}))
            with patch.object(deploy, 'HERE', root), patch.object(deploy, 'run') as run:
                with self.assertRaisesRegex(RuntimeError, 'checksum mismatch'):
                    deploy.verify_payload()
                run.assert_not_called()

    def test_rollback_refuses_unrelated_directory(self):
        with self.assertRaisesRegex(RuntimeError, 'Invalid rollback'):
            deploy.rollback(Path('/tmp/not-a-release'))

    def test_remote_docker_override_is_rejected(self):
        with patch.dict('os.environ', {'DOCKER_HOST': 'tcp://other:2375'}), patch.object(deploy, 'run') as run:
            with self.assertRaisesRegex(RuntimeError, 'local Docker'):
                deploy.preflight({})
            run.assert_not_called()

    def test_unexpected_image_stops_before_backup_or_restart(self):
        row = {'Config': {'Labels': {'com.docker.compose.project': 'dive-centre-prod'}}, 'State': {'Running': True}, 'Image': 'unexpected'}
        with patch.dict('os.environ', {'DOCKER_HOST': '', 'DOCKER_CONTEXT': 'default'}), patch.object(deploy, 'inspect', return_value=row), patch.object(deploy, 'output', return_value='[{"addr_info":[{"local":"192.168.135.39"}]}]'), patch.object(deploy.Path, 'exists', return_value=False), patch.object(deploy, 'run') as run:
            with self.assertRaisesRegex(RuntimeError, 'images differ'):
                deploy.preflight({'backendImage': 'expected', 'webImage': 'expected-web'})
            run.assert_not_called()


if __name__ == '__main__':
    unittest.main()
