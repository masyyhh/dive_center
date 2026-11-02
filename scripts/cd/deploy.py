#!/usr/bin/env python3
"""Root-owned, fixed-scope deployment entry point. Input is a small release JSON on stdin."""
import argparse
import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import tarfile
from urllib.parse import urlsplit, urlunsplit

def sha256_file(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


REGISTRY = 'ghcr.io/masyyhh/dive_center'
SCOPES = {
    'testing': ('/srv/dive-centre-testing-independent', 'dive-centre-testing-standalone', 'dive_center_testing', '192.168.130.3', '8080'),
    'production': ('/srv/dive-centre-prod', 'dive-centre-prod', 'dive_center', '192.168.135.39', '18080'),
}

def validate_manifest(value):
    if set(value) != {'release', 'backend', 'web', 'run_id'}:
        raise ValueError('Unexpected manifest fields')
    if not re.fullmatch(r'[a-f0-9]{40}', value['release']):
        raise ValueError('Release must be a full Git commit SHA')
    if not re.fullmatch(r'[0-9]{1,20}', str(value['run_id'])):
        raise ValueError('Invalid release workflow run ID')
    for service in ('backend', 'web'):
        if not re.fullmatch(re.escape(REGISTRY + '-' + service) + r'@sha256:[a-f0-9]{64}', value[service]):
            raise ValueError('Only digest-pinned images in the configured application registry are accepted')
    return value


def override(manifest, environment, runtime_file):
    return {'services': {
        'backend': {'image': manifest['backend'], 'pull_policy': 'never', 'environment': {
            'TESTING_LIVE_AUTH': 'false',
            'AUTHENTICATOR_ISSUER': 'Dive Centre Manager Testing' if environment == 'testing' else 'Dive Centre Manager',
        }},
        'web': {'image': manifest['web'], 'pull_policy': 'never', 'volumes': [
            {'type': 'bind', 'source': str(runtime_file), 'target': '/srv/environment.js', 'read_only': True},
        ]},
    }}


class Deployment:
    def __init__(self, config, manifest):
        self.c = config
        self.m = validate_manifest(manifest)
        self.env = config['environment']
        self.root, self.project, self.dbname, self.ip, self.port = SCOPES[self.env]
        self.root = Path(self.root)
        self.state = Path('/var/lib/dive-cd') / self.env
        self.active = self.state / 'active.override.json'
        self.files = [self.root / f for f in config['compose_files']]
        self.base = ['docker', 'compose', '--project-directory', str(self.root), '-p', self.project, '--env-file', config['env_file']]
        for file in self.files:
            self.base += ['-f', str(file)]
        self.clone = 'dive_cd_' + manifest['release'][:16] + '_' + str(os.getpid())
        self.clone_exists = False
        self.frozen = False
        self.migration_started = False
        self.reopened = False

    def cmd(self, args, **kwargs):
        return subprocess.run(args, check=True, cwd=self.root, **kwargs)

    def capture(self, args, **kwargs):
        return self.cmd(args, stdout=subprocess.PIPE, text=True, **kwargs).stdout.strip()

    def compose(self, args, layer=None, **kwargs):
        command = self.base.copy()
        if layer is None and self.active.exists():
            layer = self.active
        if layer:
            command += ['-f', str(layer)]
        return self.cmd(command + args, **kwargs)

    def inspect(self, name):
        return json.loads(self.capture(['docker', 'inspect', name]))[0]

    def assert_scope(self):
        db = self.inspect(self.project + '-db-1')
        if db['Config']['Labels'].get('com.docker.compose.project') != self.project or not db['State']['Running']:
            raise ValueError('Database project/running state differs from installed configuration')
        mounts = [m for m in db['Mounts'] if m['Destination'] == '/var/lib/postgresql']
        if len(mounts) != 1 or mounts[0].get('Name') != self.c['volume']:
            raise ValueError('Database volume differs from the explicitly enrolled volume')
        addresses = json.loads(self.capture(['ip', '-j', '-4', 'addr', 'show']))
        if not any(a.get('local') == self.ip for dev in addresses for a in dev.get('addr_info', [])):
            raise ValueError('Wrong deployment server')
        for service in ('backend', 'web'):
            item = self.inspect(self.project + '-' + service + '-1')
            if item['Config']['Labels'].get('com.docker.compose.project') != self.project:
                raise ValueError('Wrong application project')
        source = urlsplit(Path(self.c['secrets']['database_url']).read_text().strip())
        if source.hostname != 'db' or source.path != '/' + self.dbname:
            raise ValueError('Unexpected database URL; no action taken')
        web = self.inspect(self.project + '-web-1')
        ports = web['HostConfig']['PortBindings'].get('8080/tcp', [])
        if ports != [{'HostIp': self.ip, 'HostPort': self.port}]:
            raise ValueError('Unexpected web port mapping; preserve and investigate existing configuration')
        backend = self.inspect(self.project + '-backend-1')
        env = dict(entry.split('=', 1) for entry in backend['Config']['Env'] if '=' in entry)
        if env.get('ENABLE_DIVE_CENTRE', env.get('ENABLE_WATER_SPORTS', 'false')) != 'false':
            raise ValueError('This pipeline currently builds the water-sports-disabled variant only')
        if env.get('TESTING_LIVE_AUTH', '') not in ('', 'false'):
            raise ValueError('Legacy shared testing authentication must remain disabled')
        if self.env == 'testing' and Path(self.c['secrets']['pms_api_key']).read_bytes().strip():
            raise ValueError('Testing must not have a live PMS key')

    def sql(self, sql):
        # Database names are generated internally or selected from SCOPES, never from stdin.
        secret = self.c['admin_secret']
        return self.compose(['exec', '-T', 'db', 'sh', '-eu', '-c',
            'export PGPASSWORD="$(cat "$1")"; exec psql -h 127.0.0.1 -U postgres -d postgres --no-psqlrc -v ON_ERROR_STOP=1', 'sh', secret], input=sql.encode())

    def backup(self, name):
        self.assert_scope()
        destination = self.release_dir / name
        destination.mkdir(mode=0o700)
        with (destination / 'database.dump.partial').open('xb') as stream:
            self.compose(['exec', '-T', 'db', 'sh', '-eu', '-c',
                'export PGPASSWORD="$(cat "$1")"; exec pg_dump -h 127.0.0.1 -U "$2" -d "$2" -Fc --no-owner --no-acl',
                'sh', self.c['database_secret'], self.dbname], stdout=stream)
        dump = destination / 'database.dump.partial'
        if not dump.stat().st_size:
            raise ValueError('Empty backup')
        with dump.open('rb') as stream:
            self.compose(['exec', '-T', 'db', 'pg_restore', '--list'], stdin=stream, stdout=subprocess.DEVNULL)
        dump.rename(destination / 'database.dump')
        with tarfile.open(destination / 'configuration.tar.gz', 'w:gz') as tar:
            paths = self.files + [Path(self.c['env_file'])] + [Path(p) for p in self.c['secrets'].values()]
            paths += [Path(self.c['caddy_file'])]
            if self.active.exists():
                paths += [self.active]
            for index, file in enumerate(paths):
                if file.is_file() and str(file) != '/dev/null':
                    tar.add(file, arcname=f'{index}-{file.name}')
        hashes = {p.name: sha256_file(p) for p in destination.iterdir() if p.is_file()}
        (destination / 'checksums.json').write_text(json.dumps(hashes, indent=2))
        print('Private backup:', destination, flush=True)
        return destination

    def restore(self, dump, database):
        self.assert_scope()
        with dump.open('rb') as stream:
            self.compose(['exec', '-T', 'db', 'sh', '-eu', '-c',
                'export PGPASSWORD="$(cat "$1")"; exec pg_restore -h 127.0.0.1 -U "$2" -d "$3" --no-owner --no-acl --exit-on-error --single-transaction',
                'sh', self.c['database_secret'], self.dbname, database], stdin=stream)

    def run_image(self, image, url, args, **kwargs):
        command = ['docker', 'run', '--rm', '-i', '--network', self.c['network'], '--read-only',
            '--tmpfs', '/tmp:size=64m,mode=1777', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
            '--memory', '512m', '--pids-limit', '128', '-e', 'NODE_ENV=production', '-e', 'TESTING_LIVE_AUTH=false']
        keys = {'database_url': 'DATABASE_URL_FILE', 'jwt_secret': 'JWT_SECRET_FILE',
                'authenticator_key': 'AUTHENTICATOR_ENCRYPTION_KEY_FILE', 'pms_api_key': 'PMS_API_KEY_FILE'}
        for key, variable in keys.items():
            path = url if key == 'database_url' else self.c['secrets'][key]
            command += ['-e', variable + '=/run/secrets/' + key, '--mount', f'type=bind,src={path},dst=/run/secrets/{key},readonly']
        issuer = 'Dive Centre Manager Testing' if self.env == 'testing' else 'Dive Centre Manager'
        command += ['-e', 'AUTHENTICATOR_ISSUER=' + issuer]
        return self.cmd(command + [image] + args, **kwargs)

    def fingerprint(self, image, url):
        script = r'''
const {prisma}=require('./dist/db'); const crypto=require('node:crypto');
(async()=>{const output={};for(const [table,key] of [['User','id'],['Authenticator','userId'],['UserProperty','id'],['PasswordReset','userId']]){
const [row]=await prisma.$queryRawUnsafe(`SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY "${key}"),'[]'::jsonb) AS data FROM "${table}" t`);
output[table]=crypto.createHash('sha256').update(JSON.stringify(row.data)).digest('hex');} console.log(JSON.stringify(output));
})().catch(()=>{console.error('Account verification failed');process.exitCode=1}).finally(()=>prisma.$disconnect());
'''
        result = self.run_image(image, url, ['node', '-'], input=script, stdout=subprocess.PIPE, text=True)
        return json.loads(result.stdout)

    def crypto_check(self, url):
        script = r'''
const {prisma}=require('./dist/db'); const {decryptSecret,totp}=require('./dist/services/authenticatorService');
(async()=>{if(totp('JBSWY3DPEHPK3PXP').issuer!==process.env.AUTHENTICATOR_ISSUER)throw Error('Issuer');
const bindings=await prisma.authenticator.findMany();for(const row of bindings)for(const value of [row.secretCiphertext,row.pendingCiphertext])if(value)decryptSecret(row.userId,value);
console.log('Authenticator encryption verified:',bindings.length);
})().catch(()=>{console.error('Authenticator verification failed');process.exitCode=1}).finally(()=>prisma.$disconnect());
'''
        self.run_image(self.m['backend'], url, ['node', '-'], input=script, text=True)

    def migrate(self, url):
        self.run_image(self.m['backend'], url, ['node', 'tools/prisma.cjs', 'migrate', 'deploy'])

    def cleanup_clone(self):
        if self.clone_exists:
            self.sql(f'DROP DATABASE IF EXISTS "{self.clone}" WITH (FORCE);\n')
            self.clone_exists = False
        if hasattr(self, 'clone_url'):
            self.clone_url.unlink(missing_ok=True)

    def rollback(self):
        print('Deployment failed before reopening. Recovering the previous version.', flush=True)
        self.compose(['stop', 'web', 'backend'])
        if self.migration_started:
            dump = self.final_backup / 'database.dump'
            hashes = json.loads((self.final_backup / 'checksums.json').read_text())
            if sha256_file(dump) != hashes['database.dump']:
                raise ValueError('Recovery backup checksum mismatch. Keep site offline.')
            self.sql(f'DROP DATABASE "{self.dbname}" WITH (FORCE);\nCREATE DATABASE "{self.dbname}" OWNER "{self.dbname}";\nREVOKE CONNECT ON DATABASE "{self.dbname}" FROM PUBLIC;\nGRANT CONNECT ON DATABASE "{self.dbname}" TO "{self.dbname}";\n')
            self.restore(dump, self.dbname)
        if self.previous_override is None:
            self.active.unlink(missing_ok=True)
        else:
            self.active.write_bytes(self.previous_override)
        # Explicitly pin old images, including the first adoption of this pipeline.
        recovery = self.release_dir / 'recovery.override.json'
        old = json.loads(self.previous_override) if self.previous_override else {'services': {'backend': {}, 'web': {}}}
        for service in ('backend', 'web'):
            old['services'][service]['image'] = self.old_images[service]
            old['services'][service]['pull_policy'] = 'never'
        recovery.write_text(json.dumps(old))
        self.compose(['up', '-d', '--no-deps', '--no-build', '--force-recreate', '--wait', '--wait-timeout', '180', 'backend'], layer=recovery)
        self.compose(['up', '-d', '--no-deps', '--no-build', '--force-recreate', '--wait', '--wait-timeout', '120', 'web'], layer=recovery)
        print('Previous application and pre-deployment data restored.', flush=True)

    def deploy(self):
        self.assert_scope()
        if shutil.disk_usage('/var/lib/docker').free < self.c['minimum_free_bytes']:
            raise ValueError('Insufficient free disk space. Stop; do not prune other applications.')
        stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
        self.release_dir = self.state / 'releases' / (stamp + '-' + self.m['release'][:12] + '-' + str(os.getpid()))
        self.release_dir.mkdir(parents=True, mode=0o700)
        (self.release_dir / 'manifest.json').write_text(json.dumps(self.m, indent=2))
        self.previous_override = self.active.read_bytes() if self.active.exists() else None
        self.old_images = {s: self.inspect(self.project + '-' + s + '-1')['Image'] for s in ('backend', 'web')}
        (self.release_dir / 'previous-images.json').write_text(json.dumps(self.old_images))
        if self.previous_override:
            (self.release_dir / 'previous.override.json').write_bytes(self.previous_override)
        # Stable tags protect the previous release from accidental dangling-image cleanup.
        for service, image in self.old_images.items():
            self.cmd(['docker', 'image', 'tag', image, f'dive-cd-rollback-{service}:{stamp}'])
        for service in ('backend', 'web'):
            self.cmd(['docker', 'pull', self.m[service]])
            image = json.loads(self.capture(['docker', 'image', 'inspect', self.m[service]]))[0]
            if image['Architecture'] != 'amd64' or image['Config'].get('Labels', {}).get('org.opencontainers.image.revision') != self.m['release']:
                raise ValueError('Image architecture/revision does not match release')
        if shutil.disk_usage('/var/lib/docker').free < self.c['minimum_after_pull_bytes']:
            raise ValueError('Insufficient headroom after image download. Existing site remains online.')
        runtime = self.state / 'environment.js'
        runtime.write_text("document.documentElement.dataset.appEnvironment=" + json.dumps(self.env) + ';\n')
        runtime.chmod(0o644)
        candidate = self.release_dir / 'candidate.override.json'
        candidate.write_text(json.dumps(override(self.m, self.env, runtime), indent=2))
        self.compose(['config', '--quiet'], layer=candidate)
        self.cmd(['docker', 'run', '--rm', '--network', 'none', '--read-only', '--tmpfs', '/tmp:size=64m,mode=1777',
            '--mount', f'type=bind,src={self.c["caddy_file"]},dst=/etc/caddy/Caddyfile,readonly', '--entrypoint', 'caddy',
            self.m['web'], 'validate', '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile'])
        online_backup = self.backup('rehearsal-backup')
        self.sql(f'CREATE DATABASE "{self.clone}" OWNER "{self.dbname}";\n')
        self.clone_exists = True
        self.restore(online_backup / 'database.dump', self.clone)
        source = urlsplit(Path(self.c['secrets']['database_url']).read_text().strip())
        self.clone_url = self.release_dir / 'clone_database_url'
        self.clone_url.write_text(urlunsplit((source.scheme, source.netloc, '/' + self.clone, source.query, source.fragment)))
        self.clone_url.chmod(0o444)
        before = self.fingerprint(self.old_images['backend'], str(self.clone_url))
        self.migrate(str(self.clone_url))
        if before != self.fingerprint(self.m['backend'], str(self.clone_url)):
            raise ValueError('Migration changed testing/production accounts; live database untouched')
        self.crypto_check(str(self.clone_url))
        self.cleanup_clone()
        print('Migration rehearsal passed. Beginning short maintenance window.', flush=True)
        self.frozen = True
        self.compose(['stop', 'web', 'backend'])
        self.final_backup = self.backup('final-backup')
        before = self.fingerprint(self.old_images['backend'], self.c['secrets']['database_url'])
        self.migration_started = True
        self.migrate(self.c['secrets']['database_url'])
        if before != self.fingerprint(self.m['backend'], self.c['secrets']['database_url']):
            raise ValueError('Account preservation failed')
        self.crypto_check(self.c['secrets']['database_url'])
        temporary = self.active.with_suffix('.next.json')
        temporary.write_bytes(candidate.read_bytes())
        temporary.replace(self.active)
        self.compose(['up', '-d', '--no-deps', '--no-build', '--force-recreate', '--wait', '--wait-timeout', '180', 'backend'])
        self.compose(['exec', '-T', 'backend', 'node', '-e',
            'fetch("http://127.0.0.1:5001/api/ready").then(r=>{console.log("API readiness",r.status);process.exit(r.ok?0:1)}).catch(()=>process.exit(1))'])
        # Once web starts it can accept writes. Never restore a database automatically after this point.
        self.reopened = True
        self.compose(['up', '-d', '--no-deps', '--no-build', '--force-recreate', '--wait', '--wait-timeout', '120', 'web'])
        self.frozen = False
        self.assert_scope()
        (self.release_dir / 'SUCCESS').write_text(stamp + '\n')
        (self.state / 'current.json').write_text(json.dumps(self.m, indent=2))
        print('Deployment complete:', self.env, self.m['release'], flush=True)
        print('Recovery files:', self.release_dir, flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--config', required=True)
    parser.add_argument('--request')
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise ValueError('Run through the installed root-owned SSH entry point')
    os.umask(0o077)
    def interrupted(signum, frame):
        raise RuntimeError('Deployment interrupted by signal ' + str(signum))
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    config_path = Path(args.config)
    if config_path.stat().st_uid != 0 or config_path.stat().st_mode & 0o022:
        raise ValueError('Deployment configuration must be root-owned and not group/world writable')
    config = json.loads(config_path.read_text())
    request = Path(args.request).read_bytes() if args.request else sys.stdin.buffer.read(4097)
    if len(request) > 4096:
        raise ValueError('Manifest too large')
    deployment = Deployment(config, json.loads(request))
    with (deployment.state / 'deploy.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        try:
            deployment.deploy()
        except BaseException:
            if deployment.frozen and not deployment.reopened:
                try:
                    deployment.rollback()
                except BaseException:
                    print('AUTOMATIC RECOVERY FAILED. Keep site offline and use the final backup with an administrator.', file=sys.stderr)
            elif deployment.reopened:
                print('Web startup began; records may have been written. No automatic database restore. Investigate before recovery.', file=sys.stderr)
            raise
        finally:
            try:
                deployment.cleanup_clone()
            except BaseException:
                print('Temporary clone cleanup needs administrator attention: ' + deployment.clone, file=sys.stderr)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('Deployment stopped: ' + str(error), file=sys.stderr)
        sys.exit(1)
