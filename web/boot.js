/* Sign-in gate + data loading. Nothing sensitive is in this site's files: people, photos and mocks are fetched
 * from Supabase only after an allow-listed email signs in. */
(function () {
  const sb = supabase.createClient(SB_CONFIG.url, SB_CONFIG.key, { auth: { persistSession: true, autoRefreshToken: true } });
  const gate = document.getElementById('gate');
  const $g = (s) => gate.querySelector(s);
  const LAST = 'orgSandbox.lastEmail';
  let started = false;

  function show(step, msg, isErr) {
    document.body.classList.add('locked');
    gate.hidden = false;
    $g('#gateEmailStep').hidden = step !== 'email';
    $g('#gateCodeStep').hidden = step !== 'code';
    $g('#gateLoading').hidden = step !== 'loading';
    const m = $g('#gateMsg'); m.textContent = msg || ''; m.className = isErr ? 'err' : '';
  }

  async function sendCode() {
    const email = $g('#gateEmail').value.trim().toLowerCase();
    if (!email) return;
    show('loading', 'Sending…');
    // shouldCreateUser:false -- accounts exist only for people the owner added, so strangers can't even start a sign-in.
    const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: location.origin + '/' } });
    if (error) {
      const generic = /not allowed|signups|not found|Invalid/i.test(error.message);
      return show('email', generic ? "That address isn't on the access list." : error.message, true);
    }
    try { localStorage.setItem(LAST, email); } catch (e) { /* ignore */ }
    gate.dataset.email = email;
    show('code', 'We emailed a sign-in link to ' + email + '. Open it on this device to finish signing in (check spam if it does not arrive).');
  }

  async function start(session) {
    if (started) return; started = true;
    show('loading', 'Loading…');
    try {
      const me = session.user.email.toLowerCase();
      const [snapRes, scRes] = await Promise.all([
        sb.from('snapshot').select('data').eq('id', 1).maybeSingle(),
        sb.from('scenarios').select('*'),
      ]);
      if (snapRes.error) throw snapRes.error;
      if (scRes.error) throw scRes.error;
      if (!snapRes.data) throw new Error("Your address isn't on the access list for this site.");
      const snap = snapRes.data.data;
      const files = snap.people.map((p) => p.avatar).filter(Boolean);
      if (files.length) {
        const { data: signed } = await sb.storage.from('avatars').createSignedUrls(files, 60 * 60 * 24);
        const urls = Object.fromEntries((signed || []).filter((x) => x.signedUrl).map((x) => [x.path, x.signedUrl]));
        for (const p of snap.people) p.avatar = p.avatar ? urls[p.avatar] || null : null;
      }
      window.ORG_SNAPSHOT = snap;
      const toSc = (r) => ({ name: r.name, state: r.state, updated: Date.parse(r.updated_at), created_by: r.created_by, updated_by: r.updated_by });
      const initial = {}; for (const r of scRes.data) initial[r.id] = toSc(r);
      let cb = () => {};
      window.ORG_REMOTE = {
        me, initial,
        onChange(fn) { cb = fn; },
        async save(id, sc) {
          const { data, error } = await sb.from('scenarios').upsert({ id, name: sc.name, state: sc.state }).select('updated_at,updated_by').single();
          if (error) throw error;
          return { updated: Date.parse(data.updated_at), updated_by: data.updated_by };
        },
        async remove(id) { const { error } = await sb.from('scenarios').delete().eq('id', id); if (error) throw error; },
      };
      sb.channel('scenarios').on('postgres_changes', { event: '*', schema: 'public', table: 'scenarios' }, (p) => {
        if (p.eventType === 'DELETE') cb('DELETE', p.old.id);
        else cb(p.eventType, p.new.id, toSc(p.new));
      }).subscribe();

      await new Promise((ok, bad) => { const s = document.createElement('script'); s.src = 'app.js'; s.onload = ok; s.onerror = () => bad(new Error('app.js failed to load')); document.body.appendChild(s); });
      gate.hidden = true; document.body.classList.remove('locked');
      const right = document.querySelector('#toolbar .group.right');
      const who = document.createElement('span'); who.className = 'who-am-i'; who.textContent = me; who.title = 'Signed in';
      const out = document.createElement('button'); out.textContent = 'Sign out';
      out.onclick = async () => { await sb.auth.signOut(); location.reload(); };
      const sv = document.createElement('span'); sv.id = 'saveBadge'; sv.className = 'save-badge'; sv.textContent = '✓ All changes saved';
      right.prepend(sv);
      right.append(who, out);
    } catch (e) {
      started = false;
      await sb.auth.signOut();
      show('email', e.message || String(e), true);
    }
  }

  $g('#gateSend').onclick = sendCode;
  $g('#gateEmail').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendCode(); });
  $g('#gateBack').onclick = () => show('email');
  try { $g('#gateEmail').value = localStorage.getItem(LAST) || ''; } catch (e) { /* ignore */ }

  sb.auth.onAuthStateChange((ev, session) => { if (session) start(session); });
  sb.auth.getSession().then(({ data }) => { if (data.session) start(data.session); else show('email'); });
})();
