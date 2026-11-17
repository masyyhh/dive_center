#!/usr/bin/env python3
"""Iruveli-only application patch. No installs, migrations, seeds, or DB restores."""
import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys

ROOT = Path('/srv/dive-centre-prod')
HERE = Path(__file__).resolve().parent
API = 'dive-centre-prod-backend-1'
WEB = 'dive-centre-prod-web-1'
DB = 'dive-centre-prod-db-1'
OVERRIDE = ROOT / 'compose.iruveli-cents.json'


def run(args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)


def output(args):
    return subprocess.check_output(args, text=True).strip()


def inspect(name):
    return json.loads(output(['docker', 'inspect', name]))[0]


def compose(override=None):
    args = ['docker', 'compose', '--project-directory', str(ROOT), '-p', 'dive-centre-prod',
            '--env-file', '/dev/null', '-f', str(ROOT / 'compose.migration.yaml'),
            '-f', str(ROOT / 'compose.app.yaml')]
    if override:
        args += ['-f', str(override)]
    return args


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2) + '\n')
    path.chmod(0o600)


def image_override(image, env=None):
    service = {'image': image, 'entrypoint': ['node'], 'command': ['dist/index.js']}
    if env:
        service['environment'] = env
    return {'services': {'backend': service}}


def validate_candidate_config(before, after, image, env):
    expected = json.loads(json.dumps(before))
    backend = expected['services']['backend']
    backend['image'] = image
    backend['entrypoint'] = ['node']
    backend['command'] = ['dist/index.js']
    backend.setdefault('environment', {}).update(env)
    if expected != after:
        raise RuntimeError('Candidate changed more than the backend image, command, and Iruveli scope.')


def verify_payload():
    manifest = json.loads((HERE / 'manifest.json').read_text())
    for name, expected in manifest['runtime'].items():
        path = HERE / 'runtime' / name
        if path.is_symlink() or hashlib.sha256(path.read_bytes()).hexdigest() != expected:
            raise RuntimeError('Release payload checksum mismatch: ' + name)
    return manifest


def preflight(manifest):
    if os.environ.get('DOCKER_HOST') or os.environ.get('DOCKER_CONTEXT', 'default') != 'default':
        raise RuntimeError('Use the production server local Docker daemon.')
    if Path('/var/lib/dive-cd/production/active.override.json').exists():
        raise RuntimeError('CI/CD is enrolled; this manual procedure does not apply.')
    if OVERRIDE.exists():
        raise RuntimeError('This patch already has an active override; inspect it before proceeding.')
    interfaces = json.loads(output(['ip', '-j', '-4', 'addr', 'show']))
    if not any(addr.get('local') == '192.168.135.39' for row in interfaces for addr in row.get('addr_info', [])):
        raise RuntimeError('This release is scoped to production 192.168.135.39.')
    api, web, db = [inspect(name) for name in [API, WEB, DB]]
    for row in [api, web, db]:
        if row['Config']['Labels'].get('com.docker.compose.project') != 'dive-centre-prod' or not row['State']['Running']:
            raise RuntimeError('Unexpected production container scope/state.')
    if api['Image'] != manifest['backendImage'] or web['Image'] != manifest['webImage']:
        raise RuntimeError('Production images differ from the reported baseline. Nothing restarted.')
    if api['State'].get('Health', {}).get('Status') != 'healthy':
        raise RuntimeError('Baseline API is not healthy.')
    config = json.loads(output(compose() + ['config', '--format', 'json']))
    for service, row in [('backend', api), ('web', web)]:
        configured = output(['docker', 'image', 'inspect', '--format', '{{.Id}}', config['services'][service]['image']])
        if configured != row['Image']:
            raise RuntimeError('Compose does not describe the running ' + service + '.')
    mounts = {row['Destination']: row for row in db['Mounts']}
    if mounts.get('/var/lib/postgresql', {}).get('Name') != 'dive-centre-prod_postgres_data_live_20261101':
        raise RuntimeError('Unexpected production database volume.')
    if any(row['Destination'] == '/app/dist' or row['Destination'].startswith('/app/dist/') for row in api['Mounts']):
        raise RuntimeError('A content mount would override the application patch.')
    for name, expected in manifest['baseline'].items():
        actual = output(['docker', 'exec', API, 'node', '-e',
                         'const fs=require("fs"),crypto=require("crypto");process.stdout.write(crypto.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"))', '/app/' + name])
        if actual != expected:
            raise RuntimeError('Production source differs from the release baseline: ' + name + '. Nothing restarted.')
    if shutil.disk_usage(ROOT).free < 2 * 1024 ** 3:
        raise RuntimeError('At least 2 GiB free space is required.')
    return api, web


def properties():
    return json.loads(output(['docker', 'exec', API, 'node', '-e',
        'const {prisma}=require("/app/dist/db");prisma.property.findMany({where:{isActive:true,deletedAt:null},select:{id:true,name:true,currency:true}}).then(rows=>console.log(JSON.stringify(rows))).catch(()=>{console.error("Cannot read property list");process.exitCode=1}).finally(()=>prisma.$disconnect())']))


def ready(override):
    run(compose(override) + ['up', '-d', '--no-deps', '--no-build', '--pull', 'never', '--wait', '--wait-timeout', '120', 'backend'])
    run(compose(override) + ['up', '-d', '--no-deps', '--no-build', '--pull', 'never', 'web'])
    run(['curl', '--retry', '5', '--retry-all-errors', '--retry-delay', '2', '--connect-timeout', '10',
         '--max-time', '20', '--fail', '--silent', '--show-error', 'https://diving.ssrsys.com/api/ready'])


def rollback(directory):
    directory = directory.resolve()
    if directory.parent != ROOT / 'backups' or not directory.name.startswith('iruveli-cents-'):
        raise RuntimeError('Invalid rollback records directory.')
    record = json.loads((directory / 'release.json').read_text())
    if inspect(API)['Image'] not in [record['previousBackend'], record.get('candidateBackend')] or inspect(WEB)['Image'] != record['previousWeb']:
        raise RuntimeError('Running release changed; stop and review before rollback.')
    for name, expected in record['configHashes'].items():
        if hashlib.sha256((ROOT / name).read_bytes()).hexdigest() != expected:
            raise RuntimeError('Base Compose configuration changed; review before rollback.')
    rollback_file = directory / 'rollback.json'
    write_json(rollback_file, image_override(record['previousBackend']))
    run(compose(OVERRIDE if OVERRIDE.exists() else None) + ['stop', 'web', 'backend'])
    ready(rollback_file)
    # Keep a documented no-migration override for subsequent maintenance commands.
    write_json(OVERRIDE, image_override(record['previousBackend']))
    print('\nPrevious application image restored. No database restore or migration was run.')


def deploy(manifest, api, web):
    rows = properties()
    for row in rows:
        print(row['id'], row['name'], row['currency'])
    property_id = input('Enter the Iruveli property ID from the list: ').strip()
    selected = next((row for row in rows if row['id'] == property_id), None)
    if not selected:
        raise RuntimeError('Choose an active property ID from the list.')
    if 'iruveli' not in re.sub('[^a-z0-9]', '', selected['name'].lower()):
        raise RuntimeError('Selected property is not identifiable as Iruveli. Nothing restarted.')
    date = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=5))).date().isoformat()
    if date < '2026-11-17':
        raise RuntimeError('Unexpected server date.')
    print('Iruveli scope:', selected['name'], property_id, '| first business date:', date)
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    directory = ROOT / 'backups' / ('iruveli-cents-' + stamp)
    directory.mkdir(mode=0o700, parents=True, exist_ok=False)
    record = {'previousBackend': api['Image'], 'previousWeb': web['Image'], 'propertyId': property_id,
              'effectiveDate': date, 'configHashes': {}}
    for name in ['compose.app.yaml', 'compose.migration.yaml']:
        shutil.copy2(ROOT / name, directory / name)
        record['configHashes'][name] = hashlib.sha256((ROOT / name).read_bytes()).hexdigest()
    write_json(directory / 'release.json', record)
    candidate_tag = 'dive-centre-backend:iruveli-cents-' + stamp.lower()
    base_tag = 'dive-centre-backend:iruveli-cents-base-' + api['Image'].split(':')[1][:12]
    run(['docker', 'image', 'tag', api['Image'], base_tag])
    run(['docker', 'build', '--pull=false', '--network=none', '--build-arg', 'PRODUCTION_BACKEND_IMAGE=' + base_tag,
         '-t', candidate_tag, str(HERE)])
    candidate = output(['docker', 'image', 'inspect', '--format', '{{.Id}}', candidate_tag])
    run(['docker', 'run', '--rm', '--network', 'none', '--read-only', '--cap-drop', 'ALL',
         '--security-opt', 'no-new-privileges:true', '--entrypoint', 'node',
         '--mount', 'type=bind,src=' + str(HERE / 'smoke.cjs') + ',dst=/tmp/smoke.cjs,readonly', candidate, '/tmp/smoke.cjs'])
    # pg_dump reads the existing database; no SQL migrations or fixture writes.
    with (directory / 'production.dump').open('xb') as target:
        run(['docker', 'exec', DB, 'sh', '-ec', 'export PGPASSWORD="$(cat /run/secrets/database_password)"; exec pg_dump -h127.0.0.1 -U dive_center -d dive_center -Fc --no-owner --no-acl'], stdout=target)
    with (directory / 'production.dump').open('rb') as source:
        run(['docker', 'exec', '-i', DB, 'pg_restore', '--list'], stdin=source, stdout=subprocess.DEVNULL)
    # Recheck scope after building and backing up, before any interruption.
    preflight(manifest)
    record['candidateBackend'] = candidate
    write_json(directory / 'release.json', record)
    candidate_file = directory / 'candidate.json'
    value = image_override(candidate, {'IRUVELI_COMMISSION_PROPERTY_ID': property_id, 'IRUVELI_COMMISSION_EFFECTIVE_DATE': date})
    write_json(candidate_file, value)
    before = json.loads(output(compose() + ['config', '--format', 'json']))
    after = json.loads(output(compose(candidate_file) + ['config', '--format', 'json']))
    validate_candidate_config(before, after, candidate, value['services']['backend']['environment'])
    print('Backup and rollback records:', directory)
    try:
        run(compose() + ['stop', 'web', 'backend'])
        ready(candidate_file)
        write_json(OVERRIDE, value)
        (directory / 'COMPLETE').write_text('Application patch healthy; no migrations run.\n')
    except BaseException:
        rollback(directory)
        raise
    print('\nDeployment complete. Frontend, schema, and historical records were not changed.')
    print('Rollback: sudo python3', str(HERE / 'deploy.py'), 'rollback', str(directory))
    print('Include -f', str(OVERRIDE), 'in future Compose maintenance commands.')


def main():
    os.umask(0o077)
    if os.geteuid() != 0:
        raise RuntimeError('Run with sudo on production.')
    mode = sys.argv[1] if len(sys.argv) > 1 else 'check'
    if mode not in ['check', 'deploy', 'rollback']:
        raise RuntimeError('Usage: deploy.py check|deploy|rollback [records-directory]')
    with (ROOT / '.manual-release.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        manifest = verify_payload()
        if mode == 'rollback':
            rollback(Path(sys.argv[2]))
        else:
            api, web = preflight(manifest)
            if mode == 'check':
                print('PASS: exact production image, schema, patched-module baselines and release payload verified. Nothing restarted.')
            else:
                deploy(manifest, api, web)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('STOP:', error, file=sys.stderr)
        sys.exit(1)
