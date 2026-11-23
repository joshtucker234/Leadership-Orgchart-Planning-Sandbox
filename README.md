# Leadership Orgchart Planning Sandbox

A drag-and-drop tool for mocking up next semester's org structure for a student org: people, seats, teams, who reports
to whom. Start from today's org, rearrange it, and compare against what exists now.

This repo is **code only**. No roster, photos, drafts or credentials are in it, and the `.gitignore` keeps them out.

## Features
- Drag a person onto a seat to place or swap them; drag a seat (and everyone under it) to move a team; co-seats for co-presidents.
- "Changes vs. today" lists everyone whose seat, team or manager differs from the current org.
- Several named mocks, undo/redo, search, print/PDF, export/import as JSON.
- **Cloud version:** shared mocks behind an email allow-list. Everyone allowed in can read every mock; only a mock's creator can
  edit it, and others duplicate it to make their own. Edits autosave and sync live.

## Two ways to run it
### 1. Local only (no accounts)
Needs Python. Create `data.js` (see "Data" below), then `python -m http.server 8791 --bind 127.0.0.1` and open
http://127.0.0.1:8791/. Mocks are saved in your browser's `localStorage`.

### 2. Private cloud (free tiers: Supabase + Vercel)
Architecture: the website (`web/`) is static and contains **no data**. The roster, photos and mocks live in Supabase and are only
returned to signed-in, allow-listed emails, enforced by row-level security in the database. Sign-in is an emailed magic link and
public sign-ups are disabled.

1. Create a Supabase project. Edit the emails in `supabase_schema.sql`, run it in the SQL editor.
2. Authentication > Sign In / Providers: turn **off** "Allow new users to sign up". Authentication > URL Configuration: set the Site URL to your site.
3. Copy `web/config.example.js` to `web/config.js` and fill in the project URL and **publishable** key.
4. Create `cloud.env` (git-ignored) with `SUPABASE_URL=...` and `SUPABASE_SECRET=...` (the secret key stays on your machine only), plus
   `DRAFT_OWNER_EMAIL=you@example.com` if you load drafts. Then `python push_to_cloud.py` (roster + photos), `python push_to_cloud.py --users`
   (creates logins for the allow-list), optionally `--drafts`.
5. Deploy `web/` as a static site (e.g. `cd web && npx vercel deploy --prod`).

Add or remove people: edit `allowed_emails` in the SQL editor, then `python push_to_cloud.py --users`.

## Data
`data.js` must define `window.ORG_SNAPSHOT = { people: [...], projects: [...], members: [...] }`. `refresh_data.py` builds it from a Supabase
roster (set `SUPABASE_PROJECT_REF` and an access token in `cloud.env`); adapt the queries to your own schema. People have
`id, email, full_name, role, officer_position, grad_year, college, consulting_track, avatar`. Keep `data.js` and `avatars/` private.

## Files
`index.html`, `style.css`, `app.js` (local app) · `web/` (cloud build: `boot.js` handles sign-in and loading, `app.js` is the cloud variant)
· `make_web.py` (generates `web/index.html` and `web/style.css`) · `supabase_schema.sql` · `push_to_cloud.py` · `refresh_data.py`.
