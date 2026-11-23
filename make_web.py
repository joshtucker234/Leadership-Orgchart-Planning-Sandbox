"""Builds web/index.html from index.html (gate + cloud scripts) and appends gate styles. Run from this folder."""
import os
HERE = os.path.dirname(os.path.abspath(__file__))
s = open(os.path.join(HERE, 'index.html'), encoding='utf-8').read()
s = s.replace('<link rel="stylesheet" href="style.css">',
              '<link rel="stylesheet" href="style.css">\n<meta name="robots" content="noindex, nofollow">')
gate = """<div id="gate" class="gate">
  <div class="gate-card">
    <div class="logo">TECH <b>PLUS</b></div>
    <h1>Org Chart Sandbox</h1>
    <p class="gate-sub">Private. Sign in with an approved email address.</p>
    <div id="gateEmailStep"><input id="gateEmail" type="email" placeholder="you@example.com" autocomplete="email"><button id="gateSend" class="primary">Email me a sign-in link</button></div>
    <div id="gateCodeStep" hidden><button id="gateBack">Use a different email</button></div>
    <div id="gateLoading" hidden>Working&hellip;</div>
    <p id="gateMsg"></p>
  </div>
</div>
"""
assert '<body>\n' in s
s = s.replace('<body>\n', '<body class="locked">\n' + gate, 1)
old = '<script src="data.js"></script>\n<script src="presets.js"></script>\n<script src="app.js"></script>'
assert old in s
s = s.replace(old, '<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>\n<script src="config.js"></script>\n<script src="boot.js"></script>')
open(os.path.join(HERE, 'web', 'index.html'), 'w', encoding='utf-8').write(s)

css = open(os.path.join(HERE, 'style.css'), encoding='utf-8').read() + """
/* ---- sign-in gate (cloud version) ---- */
body.locked #toolbar, body.locked #layout { display: none; }
.gate { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; background: #00274c; z-index: 1000; padding: 16px; }
.gate[hidden] { display: none; }
.gate-card { background: #fff; border-radius: 12px; padding: 28px 28px 22px; width: 100%; max-width: 380px; text-align: center; box-shadow: 0 10px 40px rgba(0,0,0,.35); }
.gate-card .logo { font-weight: 700; letter-spacing: .08em; color: #00274c; }
.gate-card .logo b { color: #c8a400; }
.gate-card h1 { font-size: 20px; margin: 8px 0 4px; color: #00274c; }
.gate-sub { color: #555; font-size: 13px; margin: 0 0 16px; }
.gate-card input { width: 100%; box-sizing: border-box; padding: 10px 12px; font-size: 16px; border: 1px solid #bbb; border-radius: 8px; margin-bottom: 10px; }
.gate-card button { width: 100%; padding: 10px; font-size: 15px; margin-top: 4px; cursor: pointer; }
#gateMsg { font-size: 13px; min-height: 18px; margin: 12px 0 0; color: #333; }
#gateMsg.err { color: #b00020; }
.who-am-i { font-size: 12px; color: #ccd; align-self: center; margin: 0 4px; }
.save-badge { font-size: 12px; color: #9fd8a8; align-self: center; margin-right: 8px; white-space: nowrap; }
.save-badge.bad { color: #ffb4a8; font-weight: 600; }
/* ---- view-only mocks ---- */
body.readonly .tools, body.readonly .grip { display: none !important; }
body.readonly .pitem, body.readonly .card { cursor: default; }
#roBanner { position: absolute; top: 10px; left: 50%; transform: translateX(-50%); z-index: 50; background: #fff8e1; border: 1px solid #e0b400; color: #5a4300; padding: 8px 14px; border-radius: 10px; font-size: 13px; box-shadow: 0 4px 16px rgba(0,0,0,.18); display: flex; gap: 12px; align-items: center; white-space: nowrap; }
#roBanner[hidden] { display: none; }
#roBanner.nudge { animation: roNudge .7s; }
@keyframes roNudge { 0%,100% { transform: translateX(-50%) scale(1); } 30% { transform: translateX(-50%) scale(1.06); background: #ffe58a; } }
"""
open(os.path.join(HERE, 'web', 'style.css'), 'w', encoding='utf-8').write(css)
print('web/ built')
