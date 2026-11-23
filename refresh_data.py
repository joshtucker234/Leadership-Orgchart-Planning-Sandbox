#!/usr/bin/env python3
"""Snapshot the current org from your Supabase roster into this sandbox (read-only).

Writes data.js (people, projects, memberships) and downloads every avatar into ./avatars/
so the sandbox works fully offline. Re-run any time you want a fresh baseline; your saved
scenarios live in the browser and are not touched.

Reads SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF from the environment or from the env file named by
ORG_SANDBOX_CRED (default ../credentials.env). Nothing is copied into this folder.
"""
import json, os, re, urllib.request, urllib.parse, mimetypes

HERE = os.path.dirname(os.path.abspath(__file__))


def _local_env():
    env = dict(os.environ)
    p = os.path.join(HERE, 'cloud.env')  # git-ignored, holds your private settings
    if os.path.exists(p):
        for line in open(p, encoding='utf-8'):
            if '=' in line and not line.lstrip().startswith('#'):
                k, v = line.strip().split('=', 1)
                env.setdefault(k, v.strip().strip('"').strip("'"))
    return env


ENV = _local_env()
CRED = ENV.get('ORG_SANDBOX_CRED') or os.path.join(HERE, '..', 'credentials.env')
REF = ENV.get('SUPABASE_PROJECT_REF', '')
if not REF:
    raise SystemExit('Set SUPABASE_PROJECT_REF (the Supabase project that holds your roster), e.g. in cloud.env')


def load_token():
    if ENV.get('SUPABASE_ACCESS_TOKEN'):
        return ENV['SUPABASE_ACCESS_TOKEN']
    for line in open(CRED, encoding='utf-8'):
        line = line.strip()
        if line.startswith('SUPABASE_ACCESS_TOKEN='):
            return line.split('=', 1)[1].strip().strip('"').strip("'")
    raise SystemExit('SUPABASE_ACCESS_TOKEN not found in ' + CRED)


TOKEN = load_token()


def sql(q):
    req = urllib.request.Request(
        f'https://api.supabase.com/v1/projects/{REF}/database/query',
        data=json.dumps({'query': q}).encode(),
        headers={'Authorization': 'Bearer ' + TOKEN, 'Content-Type': 'application/json', 'User-Agent': 'curl/8'})
    return json.load(urllib.request.urlopen(req))


# Same filters the live org chart uses: active people only, no archived projects,
# and not the auto-managed Leadership board.
people = sql("""select id, email, full_name, avatar_url, role, officer_position, phone_number,
                       grad_year, college, consulting_track
                from profiles where is_active order by full_name""")
projects = sql("""select id, key, name, type, icon_url from projects
                  where not is_archived and not is_leadership_board order by name""")
members = sql("""select pm.user_id, pm.role, pm.project_id from project_members pm
                 join profiles p on p.id = pm.user_id join projects pr on pr.id = pm.project_id
                 where p.is_active and not pr.is_archived and not pr.is_leadership_board""")

os.makedirs(os.path.join(HERE, 'avatars'), exist_ok=True)
ok = fail = 0
for p in people:
    url = p.get('avatar_url')
    p['avatar'] = None
    if not url:
        continue
    # Google avatars are tiny (=s96-c); ask for a bit bigger so the 96px cards stay crisp.
    fetch_url = re.sub(r'=s\d+-c$', '=s192-c', url)
    try:
        req = urllib.request.Request(fetch_url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=30) as r:
            data = r.read()
            ctype = r.headers.get_content_type()
        ext = mimetypes.guess_extension(ctype) or '.jpg'
        if ext == '.jpe':
            ext = '.jpg'
        fn = f"{p['id']}{ext}"
        open(os.path.join(HERE, 'avatars', fn), 'wb').write(data)
        p['avatar'] = 'avatars/' + fn
        ok += 1
    except Exception as e:  # keep going; the card falls back to initials
        print('avatar failed:', p['full_name'], e)
        fail += 1
    p.pop('avatar_url', None)

snapshot = {'generated': __import__('datetime').datetime.now().isoformat(timespec='seconds'),
            'people': people, 'projects': projects, 'members': members}
open(os.path.join(HERE, 'data.js'), 'w', encoding='utf-8').write(
    'window.ORG_SNAPSHOT = ' + json.dumps(snapshot, ensure_ascii=False, indent=1) + ';\n')
print(f'{len(people)} people, {len(projects)} projects, {len(members)} memberships; avatars ok={ok} failed={fail}')
