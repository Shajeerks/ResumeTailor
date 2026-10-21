// JD Resume Tailor — sign-in, sign-up, dashboard and account page
/* global state, api, esc, toast, $, $$, route, loadStatus */

// ---------- auth screen ----------
function showAuth(mode) {
  state.user = null;
  $('#appShell').hidden = true;
  $('#authScreen').hidden = false;
  setAuthMode(mode || 'signin');
}
function setAuthMode(mode) {
  const up = mode === 'signup';
  $('#signinForm').hidden = up; $('#signupForm').hidden = !up;
  $('#tabSignin').setAttribute('aria-selected', !up); $('#tabSignup').setAttribute('aria-selected', up);
  $('#siErr').textContent = ''; $('#suErr').textContent = '';
  setTimeout(() => (up ? $('#suName') : $('#siLogin')).focus(), 30);
}
$('#tabSignin').onclick = () => setAuthMode('signin');
$('#tabSignup').onclick = () => setAuthMode('signup');
$('#goSignup').onclick = () => setAuthMode('signup');
$('#goSignin').onclick = () => setAuthMode('signin');
$$('.pw-toggle').forEach(b => b.onclick = () => {
  const i = document.getElementById(b.dataset.for); const show = i.type === 'password';
  i.type = show ? 'text' : 'password'; b.textContent = show ? 'Hide' : 'Show';
});

function markField(formSel, field) {
  $$(formSel + ' input').forEach(i => i.classList.remove('invalid'));
  const map = { signin: { login: '#siLogin', password: '#siPassword' }, signup: { name: '#suName', email: '#suEmail', mobile: '#suMobile', password: '#suPassword' },
    profile: { name: '#pfName', email: '#pfEmail', mobile: '#pfMobile' }, pw: { current: '#pwCurrent', password: '#pwNew' }, del: { password: '#delPw' } };
  const el = field && map[formSel.replace('#', '').replace('Form', '')]?.[field];
  if (el) { $(el).classList.add('invalid'); $(el).focus(); }
}
const busy = (btn, on, label) => { btn.disabled = on; if (label) btn.textContent = label; };

// Quick checks in the browser; the server validates again.
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)*\.[a-z]{2,}$/i;
function checkSignup() {
  if ($('#suName').value.trim().length < 2) return ['name', 'Enter your full name.'];
  if (!$('#suEmail').value.trim()) return ['email', 'Email address is required.'];
  if (!EMAIL_RE.test($('#suEmail').value.trim())) return ['email', 'Enter a valid email address, for example name@gmail.com.'];
  const m = $('#suMobile').value.replace(/[\s\-().]/g, '');
  if (!m) return ['mobile', 'Mobile number is required.'];
  if (!/^\+?\d{10,15}$/.test(m)) return ['mobile', 'Enter a valid mobile number, for example +91 98765 43210.'];
  const p = $('#suPassword').value;
  if (p.length < 8 || !/[A-Za-z]/.test(p) || !/\d/.test(p)) return ['password', 'Password must be at least 8 characters with a letter and a number.'];
  return null;
}

$('#signupForm').onsubmit = async e => {
  e.preventDefault();
  const bad = checkSignup();
  if (bad) { $('#suErr').textContent = bad[1]; markField('signup', bad[0]); return; }
  const btn = $('#suBtn'); busy(btn, true, 'Creating account…'); $('#suErr').textContent = '';
  try {
    const r = await api('/api/auth/signup', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: $('#suName').value, email: $('#suEmail').value, mobile: $('#suMobile').value, password: $('#suPassword').value }) });
    await enterApp(r.user, true);
  } catch (err) { $('#suErr').textContent = err.message; markField('signup', err.field); }
  finally { busy(btn, false, 'Create account'); }
};

$('#signinForm').onsubmit = async e => {
  e.preventDefault();
  if (!$('#siLogin').value.trim()) { $('#siErr').textContent = 'Enter your email or mobile number.'; markField('signin', 'login'); return; }
  if (!$('#siPassword').value) { $('#siErr').textContent = 'Enter your password.'; markField('signin', 'password'); return; }
  const btn = $('#siBtn'); busy(btn, true, 'Signing in…'); $('#siErr').textContent = '';
  try {
    const r = await api('/api/auth/signin', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ login: $('#siLogin').value, password: $('#siPassword').value }) });
    $('#siPassword').value = '';
    await enterApp(r.user);
  } catch (err) { $('#siErr').textContent = err.message; markField('signin', err.status === 401 ? 'password' : err.field); }
  finally { busy(btn, false, 'Sign in'); }
};

$('#signOut').onclick = async () => {
  try { await api('/api/auth/signout', { method: 'POST' }); } catch { /* ignore */ }
  state.record = null;
  location.hash = '';
  showAuth('signin');
};

const initials = n => String(n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');
function paintUser() {
  const u = state.user;
  $('#userInitials').textContent = initials(u.name);
  $('#userName').textContent = u.name;
  $('#userEmail').textContent = u.email;
}

async function enterApp(user, isNew) {
  state.user = user;
  $('#authScreen').hidden = true;
  $('#appShell').hidden = false;
  paintUser();
  await loadStatus();
  if (isNew) { location.hash = 'home'; toast(`Welcome, ${user.name.split(' ')[0]}. Your account is ready.`, 'success'); }
  route();
}

async function boot() {
  try { const r = await api('/api/me'); state.hosted = r.hosted; await enterApp(r.user); }
  catch { showAuth('signin'); }
}

// ---------- dashboard ----------
const greet = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };
async function loadHome() {
  const u = state.user;
  $('#homeHello').textContent = `${greet()}, ${u.name.split(' ')[0]}`;
  $('#homeDate').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  const body = $('#homeBody');
  body.innerHTML = '<p class="muted">Loading…</p>';
  let items = [];
  try { items = (await api('/api/history')).items; } catch (e) { body.innerHTML = `<div class="card empty-state"><h3>Could not load</h3>${esc(e.message)}</div>`; return; }
  const s = state.status || {};
  const realAi = s.configured && s.provider !== 'demo';
  const avg = a => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null);
  const sessions = items.reduce((a, i) => a + (i.sessions || 0), 0);
  const best = items.filter(i => i.bestInterview != null).reduce((m, i) => Math.max(m, i.bestInterview), -1);
  const kpi = (v, l, sub) => `<div class="kpi"><div class="kpi-v">${v ?? '–'}</div><div class="kpi-l">${l}</div>${sub ? `<div class="kpi-s">${sub}</div>` : ''}</div>`;
  const badge = v => (v == null ? '<span class="muted small">–</span>' : `<span class="badge ${v >= 75 ? 'g' : v >= 55 ? 'a' : 'r'}">${v}</span>`);

  const steps = [
    { done: realAi, t: 'Connect an AI', d: 'Use the free Google Gemini key, or Claude for best quality.', href: '#settings', cta: 'AI settings' },
    { done: items.length > 0, t: 'Create your first application', d: 'Upload your resume and paste a job description.', href: '#new', cta: 'New application' },
    { done: items.some(i => i.qa), t: 'Prepare interview answers', d: 'Generate likely questions with model answers.', href: items[0] ? `#result/${items[0].id}` : '#new', cta: 'Open application' },
    { done: sessions > 0, t: 'Practise a mock interview', d: 'Speak with the AI interviewer and get scored.', href: items[0] ? `#result/${items[0].id}` : '#new', cta: 'Start practice' },
  ];
  const next = steps.find(x => !x.done);
  const latest = items[0];

  body.innerHTML = `
    <div class="kpi-row">
      ${kpi(items.length, 'Applications', items.length ? 'tailored so far' : 'none yet')}
      ${kpi(avg(items.map(i => i.scoreAfter).filter(v => v != null)), 'Average ATS match', 'after tailoring')}
      ${kpi(sessions, 'Mock interviews', 'practice sessions')}
      ${kpi(best >= 0 ? best : null, 'Best interview score', 'out of 100')}
    </div>
    <div class="home-grid">
      <div class="card flush">
        <div class="card-head pad"><h2>Recent applications</h2>${items.length ? '<a class="link push" href="#history">View all</a>' : ''}</div>
        ${items.length ? `<ul class="app-list">${items.slice(0, 6).map(i => `
          <li><a href="#result/${i.id}" class="app-row">
            <div class="app-ico">${esc(initials(i.company || i.role || '?'))}</div>
            <div class="app-main"><b>${esc(i.role || 'Untitled role')}</b><span>${esc(i.company || '—')} · ${esc(new Date(i.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }))}</span></div>
            <div class="app-stat"><span class="muted small">Match</span>${badge(i.scoreAfter)}</div>
            <div class="app-stat"><span class="muted small">Interview</span>${badge(i.bestInterview)}</div>
            <svg class="chev" viewBox="0 0 20 20" aria-hidden="true"><path d="M8 5l5 5-5 5"/></svg></a></li>`).join('')}</ul>`
        : `<div class="empty-state"><div class="empty-art" aria-hidden="true"><svg viewBox="0 0 64 64"><rect x="14" y="8" width="36" height="48" rx="4"/><path d="M22 20h20M22 28h20M22 36h12"/></svg></div>
            <h3>No applications yet</h3><p>Tailor your resume to a job description to get started.</p><a class="btn btn-primary" href="#new">Create application</a></div>`}
      </div>
      <div class="stack">
        <div class="card">
          <div class="card-head"><h2>Getting ready</h2><span class="muted small push">${steps.filter(x => x.done).length} of ${steps.length} done</span></div>
          <ol class="checklist">${steps.map(x => `<li class="${x.done ? 'done' : ''} ${x === next ? 'current' : ''}"><span class="ck" aria-hidden="true"></span>
            <div><b>${x.t}</b><span>${x.d}</span>${x === next ? `<a class="btn btn-primary btn-sm" href="${x.href}">${x.cta}</a>` : ''}</div></li>`).join('')}</ol>
        </div>
        ${latest ? `<div class="card soft"><div class="sec-title">Latest application</div>
          <div class="latest"><b>${esc(latest.role || 'Untitled role')}</b><span class="muted">${esc(latest.company || '')}</span></div>
          <div class="latest-row"><span>Interview Q&amp;A</span><b>${latest.qa ? 'Ready' : 'Not generated'}</b></div>
          <div class="latest-row"><span>Practice sessions</span><b>${latest.sessions || 0}</b></div>
          <div class="latest-row"><span>Last interview score</span><b>${latest.lastInterview ?? '–'}</b></div>
          <a class="btn btn-secondary btn-sm" href="#result/${latest.id}">Open</a></div>` : ''}
        <div class="card soft ai-card"><div class="sec-title">AI in use</div>
          <div class="latest"><b>${esc({ demo: 'Demo mode', gemini: 'Google Gemini', anthropic: 'Anthropic Claude', ollama: 'Ollama' }[s.provider] || 'Not set')}</b>
          <span class="muted">${realAi ? esc(s.model || '') : 'Sample answers only'}</span></div>
          <a class="link" href="#settings">Change</a></div>
      </div>
    </div>`;
}

// ---------- account page ----------
function loadAccount() {
  const u = state.user;
  $('#pfName').value = u.name; $('#pfEmail').value = u.email; $('#pfMobile').value = u.mobile;
  $('#pfMeta').textContent = 'Member since ' + new Date(u.createdAt).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  ['#pfErr', '#pwErr', '#delErr'].forEach(s => { $(s).textContent = ''; });
  $('#pwForm').reset(); $('#delForm').reset();
}
$('#profileForm').onsubmit = async e => {
  e.preventDefault(); $('#pfErr').textContent = '';
  if (!$('#pfEmail').value.trim()) { $('#pfErr').textContent = 'Email address is required.'; markField('#profileForm', 'email'); return; }
  if (!$('#pfMobile').value.trim()) { $('#pfErr').textContent = 'Mobile number is required.'; markField('#profileForm', 'mobile'); return; }
  try {
    const r = await api('/api/me', { method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: $('#pfName').value, email: $('#pfEmail').value, mobile: $('#pfMobile').value }) });
    state.user = r.user; paintUser(); loadAccount(); toast('Profile saved.', 'success');
  } catch (err) { $('#pfErr').textContent = err.message; markField('#profileForm', err.field); }
};
$('#pwForm').onsubmit = async e => {
  e.preventDefault(); $('#pwErr').textContent = '';
  try {
    await api('/api/me/password', { method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ current: $('#pwCurrent').value, password: $('#pwNew').value }) });
    $('#pwForm').reset(); toast('Password updated. Other devices were signed out.', 'success');
  } catch (err) { $('#pwErr').textContent = err.message; markField('#pwForm', err.field); }
};
$('#delForm').onsubmit = async e => {
  e.preventDefault(); $('#delErr').textContent = '';
  const btn = $('#delForm button');
  if (btn.dataset.c !== '1') { btn.dataset.c = '1'; btn.textContent = 'Click again to permanently delete'; setTimeout(() => { btn.dataset.c = ''; btn.textContent = 'Delete my account'; }, 5000); return; }
  try {
    await api('/api/me', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: $('#delPw').value }) });
    location.hash = ''; showAuth('signup'); toast('Your account and data were deleted.');
  } catch (err) { $('#delErr').textContent = err.message; markField('#delForm', err.field); }
};

boot();
