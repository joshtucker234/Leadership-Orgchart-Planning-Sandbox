/* Org Chart Sandbox -- local-only mock-up tool.
 * State is a flat map of "seats" (a box on the chart that may hold a person), a root, and a list of
 * floating (unattached) seat trees. People come from data.js (a snapshot of the club roster); a person may sit in
 * more than one seat (the live chart allows that), and anyone in no seat is "in the pool".
 */
(function () {
  'use strict';
  const SNAP = window.ORG_SNAPSHOT;
  const PEOPLE = new Map(SNAP.people.map((p) => [p.id, p]));
  const PROJECTS = new Map(SNAP.projects.map((p) => [p.id, p]));
  const $ = (s) => document.querySelector(s);

  const ROLE_LABELS = {
    new_analyst: 'New Analyst', senior_analyst: 'Senior Analyst', project_manager: 'Project Manager',
    consulting_manager: 'Consulting Manager', vp_internal: 'VP Internal', vp_external: 'VP External',
    vp_operations: 'VP Operations', president: 'President', faculty_advisor: 'Faculty Advisor',
  };
  const OFFICER = {
    treasury: 'Head of Treasury', data_management: 'Head of Data Management',
    innovation: 'Head of Technology and Development', event_planning: 'Head of Event Planning', media: 'Head of Media',
  };
  const KINDS = { fa: 'Faculty Advisor', president: 'President', vp: 'VP', cm: 'Consulting Manager', pm: 'Project Manager', analyst: 'Analyst', other: 'Other' };
  const DEFAULT_TITLE = { fa: 'Faculty Advisor', president: 'President', vp: 'VP', cm: 'Consulting Manager', pm: 'Project Manager', analyst: 'Analyst', other: 'New Seat' };
  const RANK = { president: 5, vp: 4, cm: 3, pm: 2, analyst: 1 };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const initials = (n) => n.split(' ').map((x) => x[0]).slice(0, 2).join('').toUpperCase();

  function baseKind(p) {
    switch (p.role) {
      case 'faculty_advisor': return 'fa';
      case 'president': return 'president';
      case 'vp_internal': case 'vp_external': case 'vp_operations': return 'vp';
      case 'consulting_manager': return 'cm';
      case 'project_manager': return 'pm';
      default: return 'analyst';
    }
  }
  // "Analyst" seats hold both new and senior analysts without it counting as a change.
  const normTitle = (s) => String(s || '').toLowerCase().replace(/^(new|senior) analyst$/, 'analyst').trim();

  /* ------------------------------------------------------------------ state */
  // `excluded` = people taken out of this mock entirely (leaving the org): not on the chart, not in the pool.
  const blank = () => ({ seats: {}, rootId: null, floating: [], seq: 0, excluded: [] });
  function mk(S, { kind, title, personId = null, team = null, parent = null }) {
    const id = 's' + ++S.seq;
    S.seats[id] = { id, kind, title: title ?? DEFAULT_TITLE[kind], personId, team, parent, children: [], collapsed: false };
    if (parent) S.seats[parent].children.push(id);
    return id;
  }
  // A co-seat sits side by side with its leader (e.g. co-presidents). It has no children of its own:
  // the pair shares the leader's reports, and the connector hangs from the middle of the pair.
  function mkPeer(S, leaderId, { kind, title, personId = null, team = null }) {
    const id = 's' + ++S.seq;
    S.seats[id] = { id, kind, title: title ?? DEFAULT_TITLE[kind], personId, team, parent: null, leader: leaderId, peers: [], children: [], collapsed: false };
    const l = S.seats[leaderId]; (l.peers = l.peers || []).push(id);
    return id;
  }

  // Mirrors how the club's live org chart is built.
  function buildBaseline() {
    const S = blank();
    const people = SNAP.people;
    const byRole = (r) => people.filter((p) => p.role === r);
    const fa = byRole('faculty_advisor')[0];
    const root = fa ? mk(S, { kind: 'fa', personId: fa.id }) : null;
    const pres = mk(S, { kind: 'president', personId: byRole('president')[0]?.id ?? null, parent: root });
    S.rootId = root || pres;

    const vpExt = mk(S, { kind: 'vp', title: 'VP External', personId: byRole('vp_external')[0]?.id ?? null, parent: pres });
    mk(S, { kind: 'vp', title: 'VP Operations', personId: byRole('vp_operations')[0]?.id ?? null, parent: pres });
    const vpInt = mk(S, { kind: 'vp', title: 'VP Internal', personId: byRole('vp_internal')[0]?.id ?? null, parent: pres });

    const placedProjects = new Set();
    function buildProject(project, parent) {
      const ms = SNAP.members.filter((m) => m.project_id === project.id);
      const pms = ms.filter((m) => m.role === 'project_manager').map((m) => m.user_id);
      const analysts = ms.filter((m) => m.role === 'new_analyst' || m.role === 'senior_analyst').map((m) => m.user_id);
      const pmSeat = mk(S, { kind: 'pm', personId: pms[0] ?? null, team: project.name, parent });
      pms.slice(1).forEach((id) => mk(S, { kind: 'pm', personId: id, team: project.name, parent }));
      analysts.forEach((id) => mk(S, { kind: 'analyst', personId: id, parent: pmSeat }));
    }
    function buildBranch(vpSeat, type) {
      const cms = new Map();
      for (const m of SNAP.members) {
        const pr = PROJECTS.get(m.project_id);
        if (m.role !== 'consulting_manager' || !pr || pr.type !== type) continue;
        if (!cms.has(m.user_id)) cms.set(m.user_id, []);
        cms.get(m.user_id).push(pr);
      }
      for (const p of people) if (p.role === 'consulting_manager' && p.consulting_track === type && !cms.has(p.id)) cms.set(p.id, []);
      for (const [uid, projects] of cms) {
        const cm = mk(S, { kind: 'cm', personId: uid, parent: vpSeat });
        projects.forEach((pr) => { buildProject(pr, cm); placedProjects.add(pr.id); });
      }
    }
    buildBranch(vpExt, 'external');
    buildBranch(vpInt, 'internal');
    // Teams with no consulting manager above them start out unattached.
    for (const pr of SNAP.projects) if (!placedProjects.has(pr.id)) {
      const before = S.seq;
      buildProject(pr, null);
      S.floating.push('s' + (before + 1)); // buildProject's first seat is the team's PM seat
    }
    return S;
  }

  /* ----------------------------------------------------------- persistence */
  const KEY = 'orgSandbox.v1';
  let store;
  function loadStore() {
    try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && s.scenarios && s.current && s.scenarios[s.current]) return s; } catch (e) { /* ignore */ }
    return null;
  }
  function saveStore() {
    store.scenarios[store.current].updated = Date.now();
    try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) { setStatus('Could not save to browser storage: ' + e.message); }
  }
  const uid = () => 'm' + Math.random().toString(36).slice(2, 8);
  function freshStore() {
    const id = uid();
    return { current: id, scenarios: { [id]: { name: 'Mock 1', state: buildBaseline(), updated: Date.now() } } };
  }
  store = loadStore() || freshStore();
  let st = store.scenarios[store.current].state;
  let undoStack = [], redoStack = [];

  function mutate(fn) {
    undoStack.push(JSON.stringify(st)); if (undoStack.length > 150) undoStack.shift();
    redoStack = [];
    fn();
    commit();
  }
  function commit() { store.scenarios[store.current].state = st; saveStore(); render(); }
  function undo() { if (!undoStack.length) return; redoStack.push(JSON.stringify(st)); st = JSON.parse(undoStack.pop()); commit(); }
  function redo() { if (!redoStack.length) return; undoStack.push(JSON.stringify(st)); st = JSON.parse(redoStack.pop()); commit(); }

  /* ----------------------------------------------------------------- helpers */
  const seat = (id) => st.seats[id];
  const person = (pid) => (pid ? PEOPLE.get(pid) : null);
  const seatPerson = (s) => person(s.personId);
  const seatsOf = (pid) => Object.values(st.seats).filter((s) => s.personId === pid);
  const above = (s) => (s ? s.leader || s.parent : null); // a co-seat hangs off its leader, otherwise off its parent
  const excluded = () => st.excluded || (st.excluded = []);
  function isDesc(id, ancestorId) { // is `id` the same as, or under, `ancestorId`?
    for (let cur = id; cur; cur = above(seat(cur))) if (cur === ancestorId) return true;
    return false;
  }
  function detachFromParent(id) {
    const s = seat(id);
    if (s.leader) { const l = seat(s.leader); l.peers = (l.peers || []).filter((c) => c !== id); s.leader = null; }
    if (s.parent) { const p = seat(s.parent); p.children = p.children.filter((c) => c !== id); }
    st.floating = st.floating.filter((c) => c !== id);
    s.parent = null;
  }
  function subtreeIds(id, out = []) {
    out.push(id);
    (seat(id).peers || []).forEach((c) => subtreeIds(c, out));
    seat(id).children.forEach((c) => subtreeIds(c, out));
    return out;
  }
  function managerOf(id) { // nearest ancestor holding a person (a co-seat reports to whatever its leader does)
    const s = seat(id);
    for (let cur = seat(s.leader || id).parent; cur; cur = seat(cur).parent) { const p = seatPerson(seat(cur)); if (p) return p.full_name; }
    return null;
  }

  /* ---------------------------------------------------------------- rendering */
  let query = '';
  let showAll = false;
  let forceOpen = new Set();

  function matches(s) {
    if (!query) return false;
    const p = seatPerson(s);
    return [s.title, s.team, p?.full_name, p?.email].some((x) => x && x.toLowerCase().includes(query));
  }
  function computeSearch() {
    forceOpen = new Set();
    if (!query) return;
    for (const s of Object.values(st.seats)) if (matches(s)) for (let c = above(s); c; c = above(seat(c))) forceOpen.add(c);
  }
  const cardSize = (s, vertical) => (vertical || s.kind === 'analyst' ? 'compact' : ({ president: 'president', fa: 'vp', vp: 'vp' }[s.kind] || 'cm'));

  function avatarHTML(p, cls) {
    if (p && p.avatar) return `<img class="avatar" src="${esc(p.avatar)}" alt="" draggable="false">`;
    return `<div class="ini ${cls || ''}">${p ? esc(initials(p.full_name)) : '?'}</div>`;
  }
  function wasBadge(s, p) {
    if (!p) return '';
    const cur = ROLE_LABELS[p.role];
    if (normTitle(cur) === normTitle(s.title)) return '';
    const a = RANK[baseKind(p)], b = RANK[s.kind];
    const dir = a && b ? (b > a ? ['up', '▲'] : b < a ? ['down', '▼'] : ['', '→']) : ['', '→'];
    return `<p class="was ${dir[0]}">${dir[1]} was ${esc(cur)}</p>`;
  }
  function renderCard(s, vertical) {
    const p = seatPerson(s);
    const size = cardSize(s, vertical);
    const compact = size === 'compact';
    const cls = ['card', compact ? 'compact' : 'big size-' + size, p ? '' : 'vacant', matches(s) ? 'match' : ''].join(' ');
    const off = p?.officer_position && !st.noOfficer ? `<p class="off">★ ${esc(OFFICER[p.officer_position] || p.officer_position)}</p>` : '';
    const team = s.team ? `<p class="tm">${esc(s.team)}</p>` : '';
    const tog = s.children.length
      ? `<button class="tog" data-act="collapse" title="${s.collapsed ? 'Expand' : 'Collapse'}">${s.collapsed ? '▶ ' + s.children.flatMap((c) => subtreeIds(c)).length : '▼'}</button>` : '';
    const isRoot = s.id === st.rootId;
    return `<div class="${cls}" data-seat="${s.id}" ${p ? 'draggable="true"' : ''}>
      ${avatarHTML(p)}
      <div class="txt"><p class="t">${esc(s.title)}</p><p class="s">${p ? esc(p.full_name) : 'Vacant'}</p>${team}${off}${wasBadge(s, p)}</div>
      <div class="tools">
        ${s.leader ? '' : '<button data-act="add" title="Add a seat under this one, or a co-seat beside it">+</button>'}
        <button data-act="edit" title="Edit this seat">✎</button>
        ${isRoot ? '' : '<button class="grip" draggable="true" data-grip="' + s.id + '" title="Drag to move this seat (and everyone under it)">⠇</button>'}
      </div>${tog}</div>`;
  }
  function renderNode(id, vertical) {
    const s = seat(id);
    const vert = vertical || s.kind === 'pm' || s.kind === 'analyst';
    const peers = (s.peers || []).map(seat).filter(Boolean);
    const cards = renderCard(s, vertical) + peers.map((p) => renderCard(p, vertical)).join('');
    let html = `<li>${peers.length ? `<div class="pair">${cards}</div>` : cards}`;
    if (s.children.length && (!s.collapsed || forceOpen.has(id))) {
      html += `<ul class="${vert ? 'vlist' : 'trunk'}">${s.children.map((c) => renderNode(c, vert)).join('')}</ul>`;
    }
    return html + '</li>';
  }

  function render() {
    computeSearch();
    $('#content').innerHTML = `<ul class="org">${renderNode(st.rootId, false)}</ul>`;
    renderPool();
    renderToolbar();
    const seats = Object.values(st.seats);
    const vacant = seats.filter((s) => !seatPerson(s)).length;
    setStatus(`${seats.length} seats · ${vacant} vacant · ${poolPeople().length} unplaced · saved in this browser`);
  }

  function renderToolbar() {
    const sel = $('#scenarioSelect');
    sel.innerHTML = Object.entries(store.scenarios).sort((a, b) => a[1].updated - b[1].updated)
      .map(([id, sc]) => `<option value="${id}" ${id === store.current ? 'selected' : ''}>${esc(sc.name)}</option>`).join('');
    $('#btnUndo').disabled = !undoStack.length;
    $('#btnRedo').disabled = !redoStack.length;
    $('#btnDelete').disabled = Object.keys(store.scenarios).length < 2;
  }

  function poolPeople() {
    const placed = new Set(Object.values(st.seats).map((s) => s.personId).filter(Boolean));
    return SNAP.people.filter((p) => !placed.has(p.id) && !excluded().includes(p.id));
  }
  function renderPool() {
    const placedCount = new Map();
    Object.values(st.seats).forEach((s) => s.personId && placedCount.set(s.personId, (placedCount.get(s.personId) || 0) + 1));
    let list = SNAP.people.filter((p) => showAll || (!placedCount.has(p.id) && !excluded().includes(p.id)));
    if (query) list = list.filter((p) => (p.full_name + ' ' + p.email).toLowerCase().includes(query));
    $('#poolCount').textContent = `(${showAll ? list.length + ' shown' : list.length + ' unplaced'})`;
    const groups = [['Leadership', ['fa', 'president', 'vp']], ['Consulting Managers', ['cm']], ['Project Managers', ['pm']], ['Analysts', ['analyst']]];
    let html = '';
    for (const [label, kinds] of groups) {
      const items = list.filter((p) => kinds.includes(baseKind(p)));
      if (!items.length) continue;
      html += `<div class="pgroup">${label} · ${items.length}</div>`;
      html += items.map((p) => {
        const n = placedCount.get(p.id) || 0;
        const gone = excluded().includes(p.id);
        const img = p.avatar ? `<img src="${esc(p.avatar)}" alt="" draggable="false">` : `<div class="ini" style="background:#00274c;color:#fff;display:flex;align-items:center;justify-content:center;font-size:11px">${esc(initials(p.full_name))}</div>`;
        return `<div class="pitem ${n || gone ? 'placed' : ''}" draggable="true" data-person="${p.id}" title="${esc(p.email)}">${img}
          <div><div class="nm">${esc(p.full_name)}</div><div class="rl">${esc(ROLE_LABELS[p.role])}${p.officer_position && !st.noOfficer ? ' ★' : ''}</div></div>
          ${gone ? '<span class="tag" style="color:#dc2626">removed</span>' : n ? `<span class="tag">✓ placed${n > 1 ? ' ×' + n : ''}</span>` : ''}</div>`;
      }).join('');
    }
    $('#poolList').innerHTML = html || `<div class="empty">${showAll || query ? 'No one matches.' : 'Everyone is placed on the chart. 🎉'}</div>`;
  }
  function setStatus(t) { $('#statusbar').textContent = t; }

  /* ------------------------------------------------------------- pan / zoom */
  const vp = $('#viewport'), content = $('#content');
  let T = { s: 1, x: 0, y: 0 };
  const applyT = () => { content.style.transform = `translate(${T.x}px,${T.y}px) scale(${T.s})`; };
  const clampS = (s) => Math.min(2, Math.max(0.08, s));
  function fit() {
    const r = vp.getBoundingClientRect();
    const w = content.offsetWidth, h = content.offsetHeight;
    if (!w || !h) return;
    const s = clampS(Math.min((r.width - 40) / w, (r.height - 40) / h, 1));
    T = { s, x: (r.width - w * s) / 2, y: Math.max(10, (r.height - h * s) / 2) };
    // Prefer to see the top of the chart rather than centering a very tall one.
    if (h * s > r.height - 20) T.y = 10;
    applyT();
  }
  function zoomAt(cx, cy, f) {
    const s = clampS(T.s * f), k = s / T.s;
    T = { s, x: cx - (cx - T.x) * k, y: cy - (cy - T.y) * k }; applyT();
  }
  vp.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = vp.getBoundingClientRect();
    zoomAt(e.clientX - r.left, e.clientY - r.top, 1 + -e.deltaY * 0.0015);
  }, { passive: false });
  let pan = null;
  vp.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('.card, button, .tray-head, input, select')) return;
    pan = { x: e.clientX, y: e.clientY, ox: T.x, oy: T.y, id: e.pointerId, moved: false };
  });
  vp.addEventListener('pointermove', (e) => {
    if (!pan) return;
    const dx = e.clientX - pan.x, dy = e.clientY - pan.y;
    if (!pan.moved) { if (Math.hypot(dx, dy) < 4) return; pan.moved = true; vp.setPointerCapture(pan.id); vp.classList.add('panning'); }
    T.x = pan.ox + dx; T.y = pan.oy + dy; applyT();
  });
  const endPan = () => { if (pan?.moved) { try { vp.releasePointerCapture(pan.id); } catch (e) { /* noop */ } } pan = null; vp.classList.remove('panning'); };
  vp.addEventListener('pointerup', endPan); vp.addEventListener('pointercancel', endPan);
  window.addEventListener('resize', () => { /* keep user's view on resize */ });

  function locate(seatId) {
    const s = seat(seatId); if (!s) return;
    for (let c = above(s); c; c = above(seat(c))) seat(c).collapsed = false;
    commitQuiet();
    const el = content.querySelector(`[data-seat="${seatId}"]`); if (!el) return;
    const r = el.getBoundingClientRect(), cr = content.getBoundingClientRect();
    const cx = (r.left - cr.left + r.width / 2) / T.s, cy = (r.top - cr.top + r.height / 2) / T.s;
    const vr = vp.getBoundingClientRect();
    T.s = Math.max(T.s, 0.7);
    T.x = vr.width / 2 - cx * T.s; T.y = vr.height / 2 - cy * T.s; applyT();
    el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 2600);
  }
  function commitQuiet() { store.scenarios[store.current].state = st; saveStore(); render(); }

  /* ---------------------------------------------------------- drag and drop */
  let drag = null;
  const clearDropClasses = () => document.querySelectorAll('.drop-swap,.drop-place,.drop-child,.drop-ok,.drag-src').forEach((e) => e.classList.remove('drop-swap', 'drop-place', 'drop-child', 'drop-ok', 'drag-src'));

  document.addEventListener('dragstart', (e) => {
    const t = e.target;
    if (!(t instanceof Element)) return;
    if (t.matches('[data-grip]')) {
      drag = { type: 'seat', seatId: t.dataset.grip };
      t.closest('.card')?.classList.add('drag-src');
    } else if (t.matches('.card[data-seat]')) {
      const s = seat(t.dataset.seat);
      if (!s?.personId) { e.preventDefault(); return; }
      drag = { type: 'person', personId: s.personId, fromSeat: s.id };
      t.classList.add('drag-src');
    } else if (t.matches('.pitem[data-person]')) {
      const pid = t.dataset.person;
      drag = { type: 'person', personId: pid, fromSeat: null };
    } else return;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', 'org-sandbox');
  });
  document.addEventListener('dragend', () => { drag = null; clearDropClasses(); });

  function dropKind(card) { // what would happen if the current drag were dropped on this card?
    const s = seat(card.dataset.seat);
    if (!drag || !s) return null;
    if (drag.type === 'seat') return drag.seatId !== s.id && !isDesc(s.id, drag.seatId) ? 'child' : null;
    if (drag.fromSeat === s.id) return null;
    return s.personId ? 'swap' : 'place';
  }
  vp.addEventListener('dragover', (e) => {
    if (!drag) return;
    const r = vp.getBoundingClientRect(), m = 56;
    if (e.clientX < r.left + m) T.x += 14; else if (e.clientX > r.right - m) T.x -= 14;
    if (e.clientY < r.top + m) T.y += 14; else if (e.clientY > r.bottom - m) T.y -= 14;
    applyT();
    const card = e.target.closest?.('.card[data-seat]');
    const tray = e.target.closest?.('#tray');
    document.querySelectorAll('.drop-swap,.drop-place,.drop-child').forEach((x) => x.classList.remove('drop-swap', 'drop-place', 'drop-child'));
    if (card) {
      const k = dropKind(card);
      if (k) { e.preventDefault(); card.classList.add('drop-' + k); }
    } else if (tray && drag.type === 'seat') { e.preventDefault(); tray.classList.add('drop-ok'); }
    if (!tray) $('#tray')?.classList.remove('drop-ok');
  });
  $('#pool').addEventListener('dragover', (e) => { if (drag?.type === 'person') { e.preventDefault(); $('#pool').classList.add('drop-ok'); } });
  $('#pool').addEventListener('dragleave', (e) => { if (!$('#pool').contains(e.relatedTarget)) $('#pool').classList.remove('drop-ok'); });

  vp.addEventListener('drop', (e) => {
    if (!drag) return;
    const d = drag; drag = null; clearDropClasses();
    const card = e.target.closest?.('.card[data-seat]');
    const tray = e.target.closest?.('#tray');
    if (card) {
      const target = seat(card.dataset.seat);
      if (d.type === 'seat') {
        if (d.seatId === target.id || isDesc(target.id, d.seatId)) return;
        e.preventDefault();
        mutate(() => { detachFromParent(d.seatId); seat(d.seatId).parent = target.id; target.children.push(d.seatId); target.collapsed = false; });
      } else {
        if (d.fromSeat === target.id) return;
        e.preventDefault();
        mutate(() => {
          const displaced = target.personId;
          st.excluded = excluded().filter((x) => x !== d.personId); // dragging a "removed" person back in restores them
          target.personId = d.personId;
          if (d.fromSeat) seat(d.fromSeat).personId = displaced; // swap (or just move, if the target was vacant)
        });
      }
    } else if (tray && d.type === 'seat') {
      if (d.seatId === st.rootId) return;
      e.preventDefault();
      mutate(() => { detachFromParent(d.seatId); st.floating.push(d.seatId); });
    }
  });
  $('#pool').addEventListener('drop', (e) => {
    $('#pool').classList.remove('drop-ok');
    if (!drag || drag.type !== 'person') return;
    const d = drag; drag = null; clearDropClasses(); e.preventDefault();
    if (d.fromSeat) mutate(() => { seat(d.fromSeat).personId = null; });
  });

  /* ------------------------------------------------------------ clicks, menus */
  const menu = $('#menu');
  function showMenu(x, y, items) {
    menu.innerHTML = items.map((i) => i.head ? `<div class="mh">${esc(i.head)}</div>` : `<button data-k="${i.k}">${esc(i.label)}</button>`).join('');
    menu.hidden = false;
    const w = menu.offsetWidth, h = menu.offsetHeight;
    menu.style.left = Math.min(x, innerWidth - w - 8) + 'px'; menu.style.top = Math.min(y, innerHeight - h - 8) + 'px';
    menu._items = items;
  }
  const hideMenu = () => { menu.hidden = true; };
  document.addEventListener('pointerdown', (e) => { if (!menu.hidden && !menu.contains(e.target)) hideMenu(); });

  function addSeatMenu(btn, parentId) {
    const r = btn.getBoundingClientRect();
    showMenu(r.left, r.bottom + 4, [
      ...(parentId ? [{ head: 'Beside this one' }, { k: 'peer', label: 'Co-seat (same level, shares reports)' }] : []),
      { head: parentId ? 'Add a seat under this one' : 'Add an unattached seat' },
      ...Object.entries(KINDS).map(([k, l]) => ({ k, label: l + (k === 'pm' ? ' (team)' : '') }))]);
    menu.onclick = (e) => {
      const b = e.target.closest('button[data-k]'); if (!b) return; hideMenu();
      const kind = b.dataset.k;
      if (kind === 'peer') { const l = seat(parentId); return mutate(() => { mkPeer(st, parentId, { kind: l.kind, title: l.title, team: l.team }); }); }
      mutate(() => {
        const id = mk(st, { kind, team: kind === 'pm' ? 'New Team' : null, parent: parentId });
        if (!parentId) st.floating.push(id); else seat(parentId).collapsed = false;
      });
    };
  }

  content.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]');
    const card = e.target.closest('.card[data-seat]');
    if (act) {
      e.stopPropagation();
      const a = act.dataset.act;
      if (a === 'addfloat') return addSeatMenu(act, null);
      const id = card?.dataset.seat;
      if (a === 'add') return addSeatMenu(act, id);
      if (a === 'edit') return openEditor(id);
      if (a === 'collapse') return mutate(() => { seat(id).collapsed = !seat(id).collapsed; });
    } else if (card) openEditor(card.dataset.seat);
  });
  $('#poolList').addEventListener('click', (e) => {
    const it = e.target.closest('.pitem'); if (!it) return;
    const seats = seatsOf(it.dataset.person);
    if (seats.length) locate(seats[0].id); else openPersonOnly(it.dataset.person);
  });

  /* ------------------------------------------------------------------ modals */
  const wrap = $('#modalWrap'), modal = $('#modal');
  function openModal(html, wide) { modal.className = 'modal' + (wide ? ' wide' : ''); modal.innerHTML = html; wrap.hidden = false; }
  function closeModal() { wrap.hidden = true; modal.innerHTML = ''; }
  wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) closeModal(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeModal(); hideMenu(); }
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.shiftKey && e.key.toLowerCase() === 'z' && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) { e.preventDefault(); undo(); }
    if (mod && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z')) && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) { e.preventDefault(); redo(); }
  });

  function personInfoHTML(p) {
    const row = (icon, v) => v ? `<div>${icon} ${v}</div>` : '';
    return `<div class="who">${p.avatar ? `<img src="${esc(p.avatar)}" alt="">` : `<div class="ini">${esc(initials(p.full_name))}</div>`}
      <div><div class="n">${esc(p.full_name)}</div><div class="r">${esc(ROLE_LABELS[p.role])} (today)</div>
      ${p.officer_position ? `<div class="o">★ ${esc(OFFICER[p.officer_position] || p.officer_position)}</div>` : ''}</div></div>
      <div class="info">${row('✉', `<a href="mailto:${esc(p.email)}">${esc(p.email)}</a>`)}${row('☎', esc(p.phone_number))}
      ${row('🎓', p.grad_year ? 'Class of ' + esc(p.grad_year) : '')}${row('🏫', esc(p.college))}</div>`;
  }
  function openPersonOnly(pid) {
    const p = person(pid);
    const gone = excluded().includes(pid);
    openModal(`<div class="mhead"><h3>Profile</h3><button data-close>✕</button></div><div class="mbody" data-person-editor="${pid}">${personInfoHTML(p)}
      <p class="hint" style="margin:0">${gone ? 'Removed from this mock (not on the chart, not in the People list).' : 'Not placed on the chart. Drag them onto any seat.'}</p>
      <div class="btnrow">${gone ? '<button data-pdo="restore">Restore to People list</button>' : '<button class="danger" data-pdo="exclude">Remove from this mock (leaving the org)</button>'}</div></div>`);
  }
  function openEditor(seatId) {
    const s = seat(seatId); if (!s) return;
    const p = seatPerson(s);
    const sibs = s.leader ? [] : s.parent ? seat(s.parent).children : st.floating;
    const idx = sibs.indexOf(seatId);
    const others = p ? seatsOf(p.id).length - 1 : 0;
    openModal(`<div class="mhead"><h3>${p ? 'Profile & seat' : 'Vacant seat'}</h3><button data-close>✕</button></div>
      <div class="mbody" data-seat-editor="${seatId}">
        ${p ? personInfoHTML(p) : '<p class="hint" style="margin:0 0 10px">Nobody is in this seat. Drag someone from the People list onto it.</p>'}
        <div class="sect"><h4>Seat in this mock</h4>
          <div class="field"><label>Title</label><input type="text" list="titleOptions" data-f="title" value="${esc(s.title)}"></div>
          <div class="field"><label>Level</label><select data-f="kind">${Object.entries(KINDS).map(([k, l]) => `<option value="${k}" ${k === s.kind ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
          <div class="field"><label>Team name</label><input type="text" data-f="team" placeholder="(optional)" value="${esc(s.team || '')}"></div>
          <p class="hint" style="margin:0">"Level" controls card size and how its children are laid out (PM/Analyst children stack vertically).${others > 0 ? ` This person also sits in ${others} other seat${others > 1 ? 's' : ''}.` : ''}</p>
          <div class="btnrow">
            ${p ? '<button data-do="vacate">Unseat (back to People list)</button><button data-do="exclude">Remove from mock</button>' : ''}
            <button data-do="left" ${idx <= 0 ? 'disabled' : ''}>◀ Move left</button>
            <button data-do="right" ${idx < 0 || idx >= sibs.length - 1 ? 'disabled' : ''}>Move right ▶</button>
            ${s.id === st.rootId && !(s.peers || []).length ? '' : '<button class="danger" data-do="delete">Delete seat</button>'}
          </div>
        </div></div>`);
  }
  modal.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) return closeModal();
    const pb = e.target.closest('[data-pdo]');
    if (pb) {
      const pid = modal.querySelector('[data-person-editor]')?.dataset.personEditor; if (!pid) return;
      mutate(() => { st.excluded = excluded().filter((x) => x !== pid); if (pb.dataset.pdo === 'exclude') excluded().push(pid); });
      return openPersonOnly(pid);
    }
    const b = e.target.closest('[data-do]'); if (!b) return;
    const id = modal.querySelector('[data-seat-editor]')?.dataset.seatEditor; if (!id) return;
    const s = seat(id); const what = b.dataset.do;
    if (what === 'vacate') { mutate(() => { s.personId = null; }); openEditor(id); }
    else if (what === 'exclude') {
      const pid = s.personId; if (!pid) return;
      mutate(() => { seatsOf(pid).forEach((x) => { x.personId = null; }); if (!excluded().includes(pid)) excluded().push(pid); });
      closeModal();
    }
    else if (what === 'left' || what === 'right') {
      mutate(() => {
        const arr = s.parent ? seat(s.parent).children : st.floating;
        const i = arr.indexOf(id), j = what === 'left' ? i - 1 : i + 1;
        if (j >= 0 && j < arr.length) [arr[i], arr[j]] = [arr[j], arr[i]];
      }); openEditor(id);
    } else if (what === 'delete') {
      const n = s.children.length;
      if (n && !confirm(`Delete this seat? The ${n} seat${n > 1 ? 's' : ''} directly under it will move up one level.`)) return;
      mutate(() => {
        if (s.leader) { detachFromParent(id); delete st.seats[id]; return; } // a co-seat: just drop it
        const peers = s.peers || [];
        if (peers.length) { // deleting a group's lead: the first co-seat takes over its place and its reports
          const np = peers[0], nl = seat(np), rest = peers.slice(1);
          nl.leader = null; nl.peers = rest; rest.forEach((r) => { seat(r).leader = np; });
          nl.parent = s.parent; nl.children = s.children; s.children.forEach((c) => { seat(c).parent = np; });
          if (s.parent) { const arr = seat(s.parent).children; arr[arr.indexOf(id)] = np; }
          else if (st.floating.includes(id)) st.floating[st.floating.indexOf(id)] = np;
          if (st.rootId === id) st.rootId = np;
          delete st.seats[id]; return;
        }
        const parent = s.parent;
        for (const c of [...s.children]) {
          detachFromParent(c);
          if (parent) { seat(c).parent = parent; seat(parent).children.push(c); } else st.floating.push(c);
        }
        detachFromParent(id); delete st.seats[id];
      }); closeModal();
    }
  });
  modal.addEventListener('change', (e) => {
    const f = e.target.dataset.f; if (!f) return;
    const id = modal.querySelector('[data-seat-editor]')?.dataset.seatEditor; if (!id) return;
    const v = e.target.value.trim();
    mutate(() => {
      const s = seat(id);
      if (f === 'title') s.title = v || DEFAULT_TITLE[s.kind];
      else if (f === 'team') s.team = v || null;
      else if (f === 'kind') { const old = DEFAULT_TITLE[s.kind]; s.kind = v; if (s.title === old) s.title = DEFAULT_TITLE[v]; }
    });
    openEditor(id);
  });

  /* ----------------------------------------------------- changes vs. today */
  function assignments(S) {
    const out = new Map();
    const saved = st; st = S; // managerOf/seat() read the module-level state
    try {
      for (const s of Object.values(S.seats)) if (s.personId) {
        const line = `${s.title}${s.team ? ' — ' + s.team : ''}${managerOf(s.id) ? ' (reports to ' + managerOf(s.id) + ')' : ''}`;
        if (!out.has(s.personId)) out.set(s.personId, []);
        out.get(s.personId).push(line);
      }
    } finally { st = saved; }
    out.forEach((v) => v.sort());
    return out;
  }
  function openChanges() {
    const base = assignments(buildBaseline()), cur = assignments(st);
    const rows = [];
    for (const p of SNAP.people) {
      const a = (base.get(p.id) || []).join('  +  ') || 'not placed';
      const b = (cur.get(p.id) || []).join('  +  ') || (excluded().includes(p.id) ? 'removed from the org' : 'not placed');
      if (a !== b) rows.push(`<div class="change"><span class="cn">${esc(p.full_name)}</span><br><span class="from">${esc(a)}</span><br>→ <span class="to">${esc(b)}</span></div>`);
    }
    const seats = Object.values(st.seats);
    const count = (k) => seats.filter((s) => s.kind === k).length;
    openModal(`<div class="mhead"><h3>Changes vs. today's org</h3><button data-close>✕</button></div><div class="mbody">
      <div class="summary"><span><b>${rows.length}</b> people changed</span><span><b>${seats.filter((s) => !seatPerson(s)).length}</b> vacant seats</span>
      <span><b>${poolPeople().length}</b> unplaced</span><span><b>${excluded().length}</b> removed</span><span>${count('vp')} VPs · ${count('cm')} CMs · ${count('pm')} PMs · ${count('analyst')} analysts</span></div>
      ${rows.join('') || '<p class="hint">No differences yet. This mock still matches today\'s org.</p>'}</div>`, true);
  }

  /* ---------------------------------------------------------- toolbar wiring */
  const names = () => Object.values(store.scenarios).map((s) => s.name);
  function addScenario(name, state) {
    const id = uid(); store.scenarios[id] = { name, state, updated: Date.now() };
    store.current = id; st = state; undoStack = []; redoStack = []; commit(); fit();
  }
  $('#scenarioSelect').addEventListener('change', (e) => { store.current = e.target.value; st = store.scenarios[store.current].state; undoStack = []; redoStack = []; commit(); fit(); });
  $('#btnNew').onclick = () => { const n = prompt('Name for the new mock (starts from today\'s org):', 'Mock ' + (names().length + 1)); if (n) addScenario(n, buildBaseline()); };
  $('#btnDup').onclick = () => { const n = prompt('Name for the copy:', store.scenarios[store.current].name + ' copy'); if (n) addScenario(n, JSON.parse(JSON.stringify(st))); };
  $('#btnRename').onclick = () => { const sc = store.scenarios[store.current]; const n = prompt('Rename this mock:', sc.name); if (n) { sc.name = n; saveStore(); renderToolbar(); } };
  $('#btnDelete').onclick = () => {
    if (Object.keys(store.scenarios).length < 2) return;
    if (!confirm(`Delete "${store.scenarios[store.current].name}"? This can't be undone.`)) return;
    delete store.scenarios[store.current];
    store.current = Object.keys(store.scenarios)[0]; st = store.scenarios[store.current].state; undoStack = []; redoStack = []; commit(); fit();
  };
  $('#btnReset').onclick = () => { if (confirm('Throw away all changes in this mock and go back to today\'s org? (You can undo this.)')) mutate(() => { st = buildBaseline(); }); };
  // Bulk: empty every seat of one level. The seats stay on the chart (open); the people go back to the People list.
  $('#btnBulk').onclick = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const levels = [['analyst', 'analysts'], ['pm', 'project managers'], ['cm', 'consulting managers']];
    showMenu(r.left, r.bottom + 4, [{ head: 'Empty every seat of one level' }, ...levels.map(([k, l]) => ({ k, label: 'Unseat all ' + l }))]);
    menu.onclick = (ev) => {
      const b = ev.target.closest('button[data-k]'); if (!b) return; hideMenu();
      const kind = b.dataset.k; const label = levels.find(([k]) => k === kind)[1];
      const seats = Object.values(st.seats).filter((s) => s.kind === kind && s.personId);
      if (!seats.length) return setStatus(`No ${label} are seated.`);
      mutate(() => { seats.forEach((s) => { s.personId = null; }); });
      setStatus(`Unseated ${seats.length} ${label} seat${seats.length === 1 ? '' : 's'} — they're in the People list now.`);
    };
  };
  $('#btnUndo').onclick = undo; $('#btnRedo').onclick = redo;
  $('#btnChanges').onclick = openChanges;
  $('#btnExpand').onclick = () => mutate(() => Object.values(st.seats).forEach((s) => { s.collapsed = false; }));
  $('#btnCollapse').onclick = () => mutate(() => Object.values(st.seats).forEach((s) => { s.collapsed = s.kind === 'pm' && s.children.length > 0; }));
  $('#btnFit').onclick = fit;
  $('#btnZoomIn').onclick = () => { const r = vp.getBoundingClientRect(); zoomAt(r.width / 2, r.height / 2, 1.25); };
  $('#btnZoomOut').onclick = () => { const r = vp.getBoundingClientRect(); zoomAt(r.width / 2, r.height / 2, 0.8); };
  // Collapsible People panel (remembered). The chart keeps its current pan/zoom; use Fit to re-center.
  function setPoolCollapsed(c) {
    $('#pool').classList.toggle('collapsed', c);
    $('#btnPool').textContent = c ? '☰ Show People' : '☰ People';
    try { localStorage.setItem('orgSandbox.poolCollapsed', c ? '1' : '0'); } catch (e) { /* ignore */ }
  }
  const poolCollapsed = () => $('#pool').classList.contains('collapsed');
  $('#btnPool').onclick = () => setPoolCollapsed(!poolCollapsed());
  $('#btnPoolHide').onclick = () => setPoolCollapsed(true);
  document.addEventListener('keydown', (e) => {
    if ((e.key === 'p' || e.key === 'P') && !e.ctrlKey && !e.metaKey && !e.altKey && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName) && wrap.hidden) setPoolCollapsed(!poolCollapsed());
  });
  try { if (localStorage.getItem('orgSandbox.poolCollapsed') === '1') setPoolCollapsed(true); } catch (e) { /* ignore */ }
  $('#showAll').onchange =(e) => { showAll = e.target.checked; renderPool(); };
  $('#btnPrint').onclick = () => { fit(); window.print(); };
  $('#search').addEventListener('input', (e) => { query = e.target.value.trim().toLowerCase(); render(); });
  $('#search').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !query) return;
    const hit = Object.values(st.seats).find(matches); if (hit) locate(hit.id);
  });
  $('#btnExport').onclick = () => {
    const sc = store.scenarios[store.current];
    const blob = new Blob([JSON.stringify({ app: 'org-chart-sandbox', version: 1, name: sc.name, state: st }, null, 1)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = sc.name.replace(/[^\w\-]+/g, '_') + '.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  $('#btnImport').onclick = () => $('#fileInput').click();
  $('#fileInput').addEventListener('change', async (e) => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try {
      const j = JSON.parse(await f.text());
      if (!j.state || !j.state.seats || !j.state.rootId || !j.state.seats[j.state.rootId]) throw new Error('not an Org Chart Sandbox export');
      addScenario(j.name || f.name.replace(/\.json$/i, ''), j.state);
    } catch (err) { alert('Could not import that file: ' + err.message); }
  });
  document.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeModal(); });

  // Title suggestions
  $('#titleOptions').innerHTML = [...new Set([...Object.values(ROLE_LABELS), ...Object.values(OFFICER), ...Object.values(DEFAULT_TITLE),
    'Senior Analyst', 'VP Marketing', 'VP Finance', 'Co-President', 'Associate Consulting Manager'])].map((t) => `<option value="${esc(t)}">`).join('');

  // Ready-made mocks (presets.js) are added once per browser, the first time the app sees them.
  window.OrgSandboxAPI = {
    buildBaseline, mk, mkPeer,
    personByEmail: (e) => SNAP.people.find((p) => p.email.toLowerCase() === String(e).toLowerCase()),
    withState(S, fn) { // run fn with the module's helpers pointed at state S
      const saved = st; st = S;
      try { return fn({ seat, seatsOf, detachFromParent, isDesc, excluded }); } finally { st = saved; }
    },
  };
  store.presetsApplied = store.presetsApplied || [];
  for (const pr of window.ORG_PRESETS || []) {
    if (store.presetsApplied.includes(pr.id)) continue;
    try {
      const S = pr.build(window.OrgSandboxAPI);
      const id = uid(); store.scenarios[id] = { name: pr.name, state: S, updated: Date.now() };
      store.current = id; st = S; undoStack = []; redoStack = [];
      store.presetsApplied.push(pr.id);
    } catch (err) { console.error('preset failed', pr.id, err); }
  }
  // If another tab changes the saved mocks, pick that up instead of overwriting it with this tab's older copy.
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY || !e.newValue) return;
    const fresh = loadStore(); if (!fresh) return;
    store = fresh; st = store.scenarios[store.current].state; undoStack = []; redoStack = [];
    render(); setStatus('Updated from another tab.');
  });
  saveStore();
  render();
  requestAnimationFrame(fit);
  // Avatars load async and change card heights, so re-fit once they settle (only if the user hasn't moved the view).
  window.addEventListener('load', () => requestAnimationFrame(fit));
})();
