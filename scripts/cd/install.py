#!/usr/bin/env python3
"""Enroll one existing application without restarting or altering its services."""
import argparse
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from deploy import Deployment, SCOPES

parser = argparse.ArgumentParser()
parser.add_argument('environment', choices=SCOPES)
parser.add_argument('public_key', type=Path)
args = parser.parse_args()
if os.geteuid() != 0:
    raise SystemExit('Run sudo python3 install.py testing|production /path/to/key.pub')
os.umask(0o077)
if Path('/etc/dive-cd/config.json').exists():
    raise SystemExit('Already enrolled. Stop and inspect the installed configuration; no files changed.')
key = args.public_key.read_text().strip()
if not re.fullmatch(r'ssh-ed25519 [A-Za-z0-9+/=]+(?: [^\n\r]+)?', key):
    raise SystemExit('Provide a single Ed25519 public key')
root, project, database, ip, port = SCOPES[args.environment]
root = Path(root)
def inspect(service):
    return json.loads(subprocess.check_output(['docker', 'inspect', project + '-' + service + '-1']))[0]
def mounts(item):
    return {entry['Destination']: entry for entry in item['Mounts']}
db, backend, web = (inspect(service) for service in ('db', 'backend', 'web'))
for item in (db, backend, web):
    if item['Config']['Labels'].get('com.docker.compose.project') != project or not item['State']['Running']:
        raise SystemExit('Expected application is not running; installation stopped')
bm, dm, wm = mounts(backend), mounts(db), mounts(web)
volume = dm['/var/lib/postgresql']['Name']
allowed = ['dive-centre-testing-standalone_testing_data'] if args.environment == 'testing' else ['dive-centre-prod_postgres_data_live_20261101']
if volume not in allowed:
    raise SystemExit('Unexpected database volume: ' + volume + '. Report this before enrolling; no changes made.')
network = project + ('_database' if args.environment == 'testing' else '_default')
if network not in db['NetworkSettings']['Networks'] or network not in backend['NetworkSettings']['Networks']:
    raise SystemExit('Unexpected database network')
secret_names = ['database_url', 'jwt_secret', 'authenticator_key', 'pms_api_key']
secrets = {name: bm['/run/secrets/' + name]['Source'] for name in secret_names}
admin_secret = '/run/secrets/' + ('testing_postgres_password' if args.environment == 'testing' else 'postgres_admin_password')
database_secret = '/run/secrets/' + ('testing_database_password' if args.environment == 'testing' else 'database_password')
secrets['postgres_admin_password'] = dm[admin_secret]['Source']
secrets['database_password'] = dm[database_secret]['Source']
config = {
    'environment': args.environment,
    'compose_files': ['compose.yaml'] if args.environment == 'testing' else ['compose.migration.yaml', 'compose.app.yaml'],
    'env_file': str(root / '.env.testing') if args.environment == 'testing' else '/dev/null',
    'volume': volume, 'network': network, 'admin_secret': admin_secret, 'database_secret': database_secret,
    'secrets': secrets, 'caddy_file': wm['/etc/caddy/Caddyfile']['Source'],
    'minimum_free_bytes': 4 * 1024**3, 'minimum_after_pull_bytes': 2 * 1024**3,
}
for name in config['compose_files']:
    if not (root / name).is_file():
        raise SystemExit('Missing existing Compose file: ' + name)
manifest = {'release': '0'*40, 'run_id': '1', 'backend': 'ghcr.io/masyyhh/dive_center-backend@sha256:'+'0'*64, 'web': 'ghcr.io/masyyhh/dive_center-web@sha256:'+'0'*64}
Deployment(config, manifest).assert_scope()
# No Docker mutations above or below: enrollment only installs the deployment entry point.
state = Path('/var/lib/dive-cd') / args.environment
state.mkdir(parents=True, mode=0o700)
Path('/etc/dive-cd').mkdir(mode=0o700)
Path('/usr/local/lib/dive-cd').mkdir(parents=True, exist_ok=True, mode=0o755)
for name in ['deploy.py', 'ssh-entry.py']:
    destination = Path('/usr/local/lib/dive-cd') / name
    shutil.copyfile(Path(__file__).with_name(name), destination)
    destination.chmod(0o755)
Path('/etc/dive-cd/config.json').write_text(json.dumps(config, indent=2))
if subprocess.run(['id', 'dive-deploy'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0:
    raise SystemExit('dive-deploy user already exists. Review it before creating access; configuration installed but no SSH access granted.')
subprocess.run(['useradd', '--create-home', '--shell', '/bin/bash', '--password', '*', 'dive-deploy'], check=True)
# A root-owned home prevents the deployment account from replacing authorized_keys.
home = Path('/home/dive-deploy')
os.chown(home, 0, 0); home.chmod(0o755)
ssh = home / '.ssh'; ssh.mkdir(mode=0o755)
forced = 'restrict,command="sudo -n /usr/local/lib/dive-cd/ssh-entry.py" '
(ssh / 'authorized_keys').write_text(forced + key + '\n')
(ssh / 'authorized_keys').chmod(0o644)
sudoers = Path('/etc/sudoers.d/dive-cd')
sudoers.write_text('dive-deploy ALL=(root) NOPASSWD: /usr/local/lib/dive-cd/ssh-entry.py ""\n')
sudoers.chmod(0o440)
subprocess.run(['visudo', '-cf', str(sudoers)], check=True)
print('Enrolled:', args.environment, project)
print('No containers, volumes, ports, application passwords or proxy settings changed.')
print('Next: authenticate root Docker to GHCR using a read:packages token.')
