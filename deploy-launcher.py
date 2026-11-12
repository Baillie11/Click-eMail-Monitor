"""Use a direct Node launcher within this account's existing web-process hard limit."""
import json
import os
from pathlib import Path
import re
import subprocess

root = Path('/home/clickeco/clickemailmonitor')
public = Path('/home/clickeco/mailmonitor-public')
node = Path('/opt/alt/alt-nodejs22/root/usr/bin/node')
if Path.cwd() != root or not node.is_file():
    raise SystemExit('Unexpected application directory or missing Node binary')
os.umask(0o077)
launcher = root / 'node-launcher'
launcher.write_text('''#!/bin/bash
ulimit -Su 60
export UV_THREADPOOL_SIZE=1
export NODE_OPTIONS=--v8-pool-size=1
cd /home/clickeco/clickemailmonitor || exit 1
exec /opt/alt/alt-nodejs22/root/usr/bin/node --v8-pool-size=1 "$@"
''')
os.chmod(launcher, 0o700)
result = json.loads(subprocess.check_output([
    'cloudlinux-selector', 'start', '--json', '--interpreter', 'nodejs',
    '--app-root', 'clickemailmonitor']))
if result.get('result') != 'success':
    raise SystemExit('Application start failed')
htaccess = public / '.htaccess'
original = htaccess.read_text()
(root / 'htaccess-before-launcher.txt').write_text(original)
updated, count = re.subn(r'(?m)^\s*PassengerNodejs\s+[^\n]+',
                        'PassengerNodejs /home/clickeco/clickemailmonitor/node-launcher', original)
if count != 1:
    raise SystemExit('Expected exactly one application Node directive')
htaccess.write_text(updated)
os.chmod(htaccess, 0o644)
(root / 'tmp').mkdir(exist_ok=True)
(root / 'tmp/restart.txt').touch()
print('Direct Node launcher installed for this application only.')
