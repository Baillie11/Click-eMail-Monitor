"""Run only on the named cPanel account after uploading the release.

Creates an isolated database/user and private configuration. Never changes any
existing credential or grants access to another application's database.
"""
import json
import os
from pathlib import Path
import secrets
import subprocess

ROOT = Path('/home/clickeco/clickemailmonitor')
NAME = 'clickeco_cmm2026'
if Path.home() != Path('/home/clickeco') or Path.cwd() != ROOT:
    raise SystemExit('Unexpected deployment account/directory')
os.umask(0o077)
if (ROOT / '.env').exists():
    raise SystemExit('Configuration already exists; refusing to replace secrets')

def api(function, **kwargs):
    command = ['uapi', '--output=json', 'Mysql', function]
    command.extend(k + '=' + v for k, v in kwargs.items())
    result = json.loads(subprocess.check_output(command))['result']
    if result['status'] != 1:
        # Do not print command arguments or raw replies that may include secrets.
        raise RuntimeError('cPanel database operation failed: ' + function)
    return result.get('data')

if any(item['database'] == NAME for item in api('list_databases')):
    raise SystemExit('Database already exists; refusing to reuse it')
if any(item['user'] == NAME for item in api('list_users')):
    raise SystemExit('Database user already exists; refusing to reuse it')
password = secrets.token_hex(32)
api('create_database', name=NAME)
api('create_user', name=NAME, password=password)
api('set_privileges_on_database', user=NAME, database=NAME,
    privileges='SELECT,INSERT,UPDATE,DELETE,CREATE,ALTER,INDEX,REFERENCES')
env = '\n'.join([
    'NODE_ENV=production', 'DEMO_MODE=false', 'PORT=3100', 'HOST=127.0.0.1',
    'APP_ORIGIN=https://mailmonitor.clickecommerce.com.au',
    'DATABASE_URL=mysql://' + NAME + ':' + password + '@127.0.0.1:3306/' + NAME,
    'CREDENTIAL_KEY=' + secrets.token_hex(32),
    'MIN_POLL_SECONDS=900', 'WORKER_BATCH_SIZE=10', 'MAILBOX_LIMIT=10',
    'SIGNUP_LIMIT=20', 'ACCOUNT_SENDMAIL=true',
    'ACCOUNT_FROM="ClickeMailMonitor <noreply@mailmonitor.clickecommerce.com.au>"',
    'TRUST_PROXY_HOPS=0', '',
])
with (ROOT / '.env').open('x') as file:
    file.write(env)
print('Dedicated database, limited database user and private .env created.')
