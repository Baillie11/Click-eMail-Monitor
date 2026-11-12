"""Install only ClickeMailMonitor's bounded 15-minute cron, preserving others."""
import os
from pathlib import Path
import subprocess
import time

root = Path('/home/clickeco/clickemailmonitor')
if Path.cwd() != root or Path.home() != root.parent:
    raise SystemExit('Unexpected deployment directory/account')
os.umask(0o077)
node = Path('/opt/alt/alt-nodejs22/root/usr/bin/node')
if not node.exists():
    raise SystemExit('Node environment is missing')
script = '''#!/bin/bash
set -eu
cd /home/clickeco/clickemailmonitor
export UV_THREADPOOL_SIZE=1
export NODE_OPTIONS=--v8-pool-size=1
exec /opt/alt/alt-nodejs22/root/usr/bin/node --v8-pool-size=1 dist/server/worker-main.js --once
'''
(root / 'run-worker.sh').write_text(script)
os.chmod(root / 'run-worker.sh', 0o700)
read = subprocess.run(['crontab', '-l'], stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True)
if read.returncode not in (0, 1):
    raise SystemExit('Cannot read existing cron schedule')
previous = read.stdout
marker = '# ClickeMailMonitor'
if previous.count(marker) > 1:
    raise SystemExit('Multiple application cron entries; review required')
(root / ('cron-before-' + str(int(time.time())) + '.txt')).write_text(previous)
line = '*/15 * * * * ulimit -Su 65; exec /bin/flock -F -n /home/clickeco/clickemailmonitor/.worker.lock /bin/timeout 180s /bin/bash /home/clickeco/clickemailmonitor/run-worker.sh >> /home/clickeco/clickemailmonitor/worker.log 2>&1 ' + marker
if subprocess.run(['crontab', '-l'], stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True).stdout != previous:
    raise SystemExit('Cron changed concurrently; not modified')
subprocess.run(['crontab', '-'], input='\n'.join(x for x in previous.splitlines() if marker not in x).rstrip() + '\n' + line + '\n', universal_newlines=True, check=True)
print('15-minute application cron installed; existing entries preserved.')
