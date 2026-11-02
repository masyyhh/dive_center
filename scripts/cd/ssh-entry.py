#!/usr/bin/env python3
"""Keep a deployment running under systemd even if the SSH connection drops."""
import datetime
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

os.umask(0o077)
config_file = '/etc/dive-cd/config.json'
config = json.loads(Path(config_file).read_text())
request = sys.stdin.buffer.read(4097)
if len(request) > 4096:
    raise SystemExit('Manifest too large')
json.loads(request)
state = Path('/var/lib/dive-cd') / config['environment']
with tempfile.NamedTemporaryFile(dir=state, prefix='request-', suffix='.json', delete=False) as file:
    file.write(request)
    request_file = file.name
unit = 'dive-cd-' + config['environment'] + '-' + datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d%H%M%S') + '-' + str(os.getpid())
try:
    result = subprocess.run(['systemd-run', '--quiet', '--wait', '--collect', '--unit', unit,
        '--property=Type=exec',
        '/usr/local/lib/dive-cd/deploy.py', '--config', config_file, '--request', request_file])
    subprocess.run(['journalctl', '--unit', unit, '--no-pager', '-n', '350', '--output=cat'])
    sys.exit(result.returncode)
finally:
    # The worker reads the request at startup; retain it if the SSH session is interrupted.
    pass
