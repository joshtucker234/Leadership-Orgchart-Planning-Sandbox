#!/usr/bin/env python3
"""Push the local snapshot (data.js + avatars/) to the private Supabase project.

  python push_to_cloud.py              # snapshot + photos (run after refresh_data.py)
  python push_to_cloud.py --drafts     # also load the Draft_*.json / Next_Semester_*.json exports as shared mocks
  python push_to_cloud.py --users      # create login accounts for everyone in allowed_emails

Phone numbers are stripped before upload. Reads SUPABASE_URL and SUPABASE_SECRET from cloud.env (next to this
file, never deployed) or from the environment. The secret key bypasses row-level security: keep it on this computer.
"""
import glob, hashlib, json, mimetypes, os, re, sys, urllib.error, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))


def load_env():
    env = dict(os.environ)
    p = os.path.join(HERE, 'cloud.env')
    if os.path.exists(p):
        for line in open(p, encoding='utf-8'):
            if '=' in line and not line.lstrip().startswith('#'):
                k, v = line.strip().split('=', 1)
                env[k] = v.strip().strip('"').strip("'")
    return env


ENV = load_env()
URL = ENV['SUPABASE_URL'].rstrip('/')
KEY = ENV['SUPABASE_SECRET']
OWNER = ENV.get('DRAFT_OWNER_EMAIL', '').lower()  # who owns drafts loaded with --drafts


def call(method, path, body=None, headers=None, raw=False):
    h = {'apikey': KEY, 'Authorization': 'Bearer ' + KEY, 'User-Agent': 'curl/8'}
    h.update(headers or {})
    data = body if raw else (json.dumps(body).encode() if body is not None else None)
    if body is not None and not raw:
        h.setdefault('Content-Type', 'application/json')
    req = urllib.request.Request(URL + path, data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            t = r.read()
            return json.loads(t) if t and not raw else t
    except urllib.error.HTTPError as e:
        raise SystemExit(f'{method} {path} -> {e.code}: {e.read().decode()[:400]}')


def upsert(table, rows):
    call('POST', f'/rest/v1/{table}', rows, {'Prefer': 'resolution=merge-duplicates,return=minimal'})


def push_snapshot():
    src = open(os.path.join(HERE, 'data.js'), encoding='utf-8').read()
    snap = json.loads(re.sub(r'^window\.ORG_SNAPSHOT\s*=\s*|;\s*$', '', src.strip()))
    uploaded = 0
    for p in snap['people']:
        p.pop('phone_number', None)
        a = p.get('avatar')
        if not a:
            continue
        fn = os.path.basename(a)
        path = os.path.join(HERE, 'avatars', fn)
        if not os.path.exists(path):
            p['avatar'] = None
            continue
        ctype = mimetypes.guess_type(fn)[0] or 'image/jpeg'
        call('POST', f'/storage/v1/object/avatars/{fn}', open(path, 'rb').read(),
             {'Content-Type': ctype, 'x-upsert': 'true'}, raw=True)
        p['avatar'] = fn
        uploaded += 1
    upsert('snapshot', [{'id': 1, 'data': snap, 'updated_at': __import__('datetime').datetime.utcnow().isoformat() + 'Z'}])
    print(f"snapshot: {len(snap['people'])} people, {len(snap['projects'])} teams; {uploaded} photos uploaded; phones stripped")


def push_drafts():
    if not OWNER:
        raise SystemExit('Set DRAFT_OWNER_EMAIL in cloud.env before using --drafts')
    files = sorted(glob.glob(os.path.join(HERE, 'Draft_*.json')) + glob.glob(os.path.join(HERE, 'Next_Semester_*.json')))
    rows = []
    for f in files:
        j = json.load(open(f, encoding='utf-8'))
        if not j.get('state') or not j['state'].get('seats'):
            continue
        sid = 'i' + hashlib.sha1(j['name'].encode()).hexdigest()[:8]  # stable id: re-running updates, not duplicates
        rows.append({'id': sid, 'name': j['name'], 'state': j['state'], 'created_by': OWNER, 'updated_by': OWNER})
        print('draft:', j['name'])
    if rows:
        upsert('scenarios', rows)


def make_users():
    emails = [r['email'] for r in call('GET', '/rest/v1/allowed_emails?select=email')]
    for e in emails:
        try:
            call('POST', '/auth/v1/admin/users', {'email': e, 'email_confirm': True})
            print('created login:', e)
        except SystemExit as ex:
            print('skip', e, '-', str(ex)[:120])


if __name__ == '__main__':
    args = sys.argv[1:]
    if '--users' in args:
        make_users()
    else:
        push_snapshot()
        if '--drafts' in args:
            push_drafts()
