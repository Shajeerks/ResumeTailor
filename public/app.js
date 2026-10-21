// JD Resume Tailor — front-end
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ph = s => esc(s).replace(/\[([^\]]+)\]/g, '<span class="ph">[$1]</span>'); // highlight placeholders
const arr = v => (Array.isArray(v) ? v.filter(Boolean) : []);
const words = s => (String(s || '').trim().match(/\S+/g) || []).length;

const state = { status: null, record: null, tab: 'overview' };

async function api(url, opts = {}) {
  const r = await fetch(url, opts);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(body.error || `Request failed (${r.status})`); e.status = r.status; e.field = body.field;
    if (r.status === 401 && !url.startsWith('/api/auth/') && typeof showAuth === 'function') showAuth();
    throw e;
  }
  return body;
}

let toastTimer;
function toast(msg, kind = '') {
  const t = $('#toast'); t.textContent = msg; t.className = 'toast ' + kind; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, kind === 'error' ? 7000 : 3500);
}

// ---------- routing ----------
function route() {
  if (!state.user) return;
  const hash = location.hash.replace('#', '') || 'home';
  const [view, id] = hash.split('/');
  $$('.view').forEach(v => { v.hidden = true; });
  $$('.nav-item').forEach(a => a.classList.toggle('active', a.dataset.view === (view === 'result' ? 'history' : view)));
  if (view === 'result' && id) { $('#view-result').hidden = false; state.tab = 'overview'; openRecord(id); }
  else if (view === 'history') { $('#view-history').hidden = false; loadHistory(); }
  else if (view === 'settings') { $('#view-settings').hidden = false; loadSettings(); }
  else if (view === 'account') { $('#view-account').hidden = false; loadAccount(); }
  else if (view === 'jobs') { $('#view-jobs').hidden = false; loadJobs(); }
  else if (view === 'new') { $('#view-new').hidden = false; }
  else { $('#view-home').hidden = false; loadHome(); }
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);

// ---------- status ----------
async function loadStatus() {
  try {
    state.status = await api('/api/status');
    const s = state.status, pill = $('#statusPill');
    pill.className = 'status-pill ' + (s.configured ? 'ok' : 'warn');
    const names = { demo: 'Demo mode', gemini: 'Gemini', anthropic: 'Claude', ollama: 'Ollama' };
    $('#statusText').textContent = !s.configured ? 'Setup needed' : s.provider === 'demo' ? 'Demo mode' : names[s.provider] + ' connected';
    pill.className = 'status-pill ' + (s.configured && s.provider !== 'demo' ? 'ok' : 'warn');
    fillQuick();
    $('#setupNotice').hidden = s.configured && s.provider !== 'demo';
    $('#setupText').innerHTML = s.provider === 'demo'
      ? '<strong>Demo mode is on.</strong> Results are sample answers. Connect the free Google Gemini option for real tailored output.'
      : '<strong>One-time setup needed.</strong> Finish connecting the AI so the app can write your documents.';
  } catch { $('#statusText').textContent = 'Server offline'; }
}

// ---------- new application ----------
const resumeText = $('#resumeText');
const dz = $('#dropzone'), fileInput = $('#fileInput');
['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('over'); }));
['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('over'); }));
dz.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) uploadFile(f); });
fileInput.addEventListener('change', () => { if (fileInput.files[0]) uploadFile(fileInput.files[0]); fileInput.value = ''; });

async function uploadFile(f) {
  if (f.size > 10 * 1024 * 1024) return toast('That file is larger than 10 MB.', 'error');
  const fd = new FormData(); fd.append('file', f);
  $('.dz-title').textContent = 'Reading ' + f.name + '…';
  try {
    const r = await api('/api/parse', { method: 'POST', body: fd });
    resumeText.value = r.text;
    $('#fileName').textContent = r.fileName;
    $('#fileMeta').textContent = '· ' + words(r.text).toLocaleString() + ' words extracted';
    $('#fileChip').hidden = false; dz.hidden = true;
    $('#resumeDetails').open = false;
  } catch (e) { toast(e.message, 'error'); }
  finally { $('.dz-title').textContent = 'Upload resume'; }
}
$('#clearFile').onclick = () => { resumeText.value = ''; $('#fileChip').hidden = true; dz.hidden = false; };

const jd = $('#jdText');
const updateCount = () => { $('#jdCount').textContent = words(jd.value).toLocaleString() + ' words'; };
jd.addEventListener('input', updateCount);
$('#sampleJd').onclick = () => {
  jd.value = `Project Manager – Healthcare IT Implementation (Sample JD)

About the role
We are hiring a Project Manager to lead the implementation of our Hospital Information System (HIS) for hospital clients across India and the GCC.

Key responsibilities
- Own end-to-end project delivery: planning, scope, schedule, risk, budget and stakeholder management.
- Lead requirement gathering, gap analysis and BRD/FRD sign-off with client stakeholders.
- Coordinate development, QA, DevOps and support teams through UAT, go-live and hypercare.
- Run steering committee meetings and provide RAG status reports to senior leadership.
- Manage change requests, effort estimation and SLA adherence.
- Mentor implementation consultants and drive continuous process improvement.

Requirements
- 8+ years of experience, including 3+ years in healthcare IT / HIS / EMR implementation.
- Strong client-facing, communication and leadership skills.
- Experience with Agile and Waterfall delivery.
- PMP or PRINCE2 certification preferred.
- Proficiency in Jira, MS Project and Excel.`;
  updateCount();
};

$('#generateBtn').onclick = async () => {
  if (state.status && !state.status.configured) { toast('Finish the AI setup in Settings first.', 'error'); location.hash = 'settings'; return; }
  if (resumeText.value.trim().length < 150) { toast('Upload a resume or paste its text first.', 'error'); $('#resumeDetails').open = true; return; }
  if (words(jd.value) < 20) { toast('Paste the full job description first.', 'error'); jd.focus(); return; }
  const payload = {
    resumeText: resumeText.value, jdText: jd.value, company: $('#company').value, manager: $('#manager').value,
    extra: $('#extra').value, region: $('#region').value, tone: $('#tone').value,
  };
  const btn = $('#generateBtn'); btn.disabled = true;
  const stop = startProgress();
  try {
    const rec = await api('/api/generate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    stop(true);
    state.record = rec; state.tab = 'overview';
    location.hash = 'result/' + rec.id;
    toast('Application ready. Review each tab, then download.', 'success');
  } catch (e) {
    stop(false);
    toast(e.message, 'error');
    if (e.status === 412) location.hash = 'settings';
  } finally { btn.disabled = false; }
};

function startProgress() {
  const ov = $('#progress'), items = $$('#progressSteps li'), t0 = Date.now();
  ov.hidden = false;
  items.forEach(li => { li.className = ''; });
  const marks = [0, 3, 8, 15, 35, 55]; // seconds when each step starts
  const tick = () => {
    const s = (Date.now() - t0) / 1000;
    $('#elapsed').textContent = Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
    items.forEach((li, i) => {
      const startAt = marks[i], next = marks[i + 1] ?? Infinity;
      li.className = s >= next ? 'done' : s >= startAt ? 'active' : '';
    });
  };
  tick(); const iv = setInterval(tick, 500);
  return ok => { clearInterval(iv); if (ok) items.forEach(li => { li.className = 'done'; }); setTimeout(() => { ov.hidden = true; }, ok ? 350 : 0); };
}

// ---------- results ----------
async function openRecord(id) {
  if (!state.record || state.record.id !== id) {
    $('#tabBody').innerHTML = '<p class="muted">Loading…</p>';
    try { state.record = await api('/api/history/' + id); state.tab = 'overview'; }
    catch (e) { $('#tabBody').innerHTML = `<div class="card empty-state"><h3>Not found</h3>${esc(e.message)}</div>`; return; }
  }
  const rec = state.record, r = rec.result;
  $('#rTitle').textContent = (r.role_title || 'Application') + (r.company ? ' · ' + r.company : '');
  $('#rSub').textContent = [rec.candidate, new Date(rec.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })].filter(Boolean).join(' · ');
  $('#dlAll').href = `/api/download/${rec.id}/all`;
  $('#demoBanner').hidden = rec.model !== 'demo';
  renderTab();
}
$$('#tabs button').forEach(b => b.onclick = () => { state.tab = b.dataset.tab; renderTab(); });

function toolbar(title, kind) {
  return `<div class="doc-toolbar"><div class="title">${title}</div><div class="actions">
    <button class="btn btn-secondary btn-sm" data-copy="${kind}">Copy text</button>
    <a class="btn btn-primary btn-sm" href="/api/download/${state.record.id}/${kind}">Download .docx</a></div></div>`;
}

function ring(score, after) {
  const R = 62, C = 2 * Math.PI * R;
  const col = score >= 75 ? 'var(--good)' : score >= 55 ? 'var(--warn)' : 'var(--bad)';
  return `<svg class="ring" viewBox="0 0 150 150" role="img" aria-label="Match score ${score} of 100">
    <circle cx="75" cy="75" r="${R}" fill="none" stroke="var(--line)" stroke-width="11"/>
    <circle cx="75" cy="75" r="${R}" fill="none" stroke="var(--accent-soft)" stroke-width="11" stroke-dasharray="${C * after / 100} ${C}" transform="rotate(-90 75 75)"/>
    <circle cx="75" cy="75" r="${R}" fill="none" stroke="${col}" stroke-width="11" stroke-dasharray="${C * score / 100} ${C}" transform="rotate(-90 75 75)"/>
    <text x="75" y="80" text-anchor="middle" font-size="34" font-weight="700" fill="var(--ink)" font-family="Source Sans 3, sans-serif">${score}</text>
    <text x="75" y="100" text-anchor="middle" font-size="12" fill="var(--muted)" font-family="Source Sans 3, sans-serif">out of 100</text></svg>`;
}

function renderTab() {
  const r = state.record.result, body = $('#tabBody');
  $$('#tabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === state.tab));
  if (state.tab === 'qa') return renderQA(body);
  if (state.tab === 'practice') return renderPractice(body);
  if (state.tab === 'overview') {
    body.innerHTML = `<div class="overview">
      <div class="card score-card">
        <div class="sec-title">ATS match</div>${ring(r.match_score, r.match_score_after)}
        <div class="score-row"><div><b>${r.match_score}</b>Original</div><div><b style="color:var(--accent)">${r.match_score_after}</b>Tailored</div></div>
        <p class="verdict">${esc(r.verdict)}</p>
      </div>
      <div class="card">
        <div class="sec-title">Keywords matched</div><div class="chips">${arr(r.matched_keywords).map(k => `<span class="chip hit">${esc(k)}</span>`).join('') || '<span class="muted">None</span>'}</div>
        <div class="sec-title">Keywords missing from the resume</div><div class="chips">${arr(r.missing_keywords).map(k => `<span class="chip miss">${esc(k)}</span>`).join('') || '<span class="muted">None</span>'}</div>
        <div class="cols-2">
          <div><div class="sec-title">Strengths for this role</div><ul class="list">${arr(r.strengths).map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>
          <div><div class="sec-title">Gaps and how to handle them</div><ul class="list">${arr(r.gaps).map(x => `<li>${esc(x)}</li>`).join('') || '<li>No major gaps found.</li>'}</ul></div>
        </div>
        <div class="sec-title">Before you apply</div><ul class="list">${arr(r.tips).map(x => `<li>${esc(x)}</li>`).join('')}</ul>
      </div></div>`;
  } else if (state.tab === 'resume') {
    body.innerHTML = toolbar('ATS resume', 'resume') + `<div class="paper-wrap"><div class="paper cv">${resumeHtml(r.resume || {})}</div></div>
      <p class="muted small">Text highlighted in yellow is a placeholder to fill in. It stays highlighted in the Word file so it is easy to find.</p>`;
  } else if (state.tab === 'cover') {
    const cl = r.cover_letter || {};
    body.innerHTML = toolbar('Cover letter', 'cover') + `<div class="paper-wrap"><div class="paper letter">${letterHead(r)}
      <p>${esc(new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }))}</p>
      <p><b>Re: Application for ${esc(r.role_title || 'the advertised position')}</b></p>
      <p>${ph(cl.greeting || 'Dear Hiring Manager,')}</p>${arr(cl.paragraphs).map(p => `<p>${ph(p)}</p>`).join('')}
      <p>${esc(cl.closing || 'Sincerely,')}</p><p class="sig">${ph(r.resume?.name)}</p></div></div>`;
  } else if (state.tab === 'email') {
    body.innerHTML = toolbar('Application email', 'email') + `<div class="paper-wrap"><div class="paper letter">
      <p><b>Subject:</b> ${ph(r.email?.subject)}</p><hr style="border:none;border-top:1px solid #ddd;margin:14px 0 18px">
      ${String(r.email?.body || '').split(/\n\s*\n/).map(p => `<p>${ph(p).replace(/\n/g, '<br>')}</p>`).join('')}</div></div>
      <p class="muted small">Copy this into your email, then attach the resume and cover letter.</p>`;
  } else if (state.tab === 'intro') {
    const blk = (t, s) => `<div class="intro-block"><h5>${t} <span class="words">· ${words(s)} words</span></h5>${String(s || '').split(/\n\s*\n/).map(p => `<p>${ph(p)}</p>`).join('')}</div>`;
    body.innerHTML = toolbar('Self-introduction', 'intro') + `<div class="paper-wrap"><div class="paper letter">
      ${blk('30-second version · networking or HR screening', r.intro_30)}
      ${blk('60-second version · “Tell me about yourself”', r.intro_60)}
      ${blk('2-minute version · hiring manager or panel', r.intro_120)}</div></div>`;
  }
  body.querySelectorAll('[data-copy]').forEach(b => b.onclick = () => copyText(b.dataset.copy, b));
}

function letterHead(r) {
  return `<div class="lh-name">${ph(r.resume?.name)}</div><div class="lh-contact">${ph(r.resume?.contact)}</div>`;
}

function resumeHtml(v) {
  let h = `<div class="nm">${ph(String(v.name || '').toUpperCase())}</div><div class="hl">${ph(v.headline)}</div><div class="ct">${ph(v.contact)}</div>`;
  if (v.summary) h += `<h4>Professional Summary</h4><p>${ph(v.summary)}</p>`;
  if (arr(v.competencies).length) h += `<h4>Core Competencies</h4><ul>${v.competencies.map(x => `<li><b>${ph(x.label)}:</b> ${ph(x.items)}</li>`).join('')}</ul>`;
  if (arr(v.experience).length) h += `<h4>Professional Experience</h4>` + v.experience.map(j => `
    <div class="jh"><span>${ph(j.title)}</span><span>${ph(j.dates)}</span></div>
    <div class="jc"><span>${ph(j.company)}</span><span>${ph(j.location)}</span></div>
    ${j.intro ? `<p style="margin:3px 0"><i>${ph(j.intro)}</i></p>` : ''}<ul>${arr(j.bullets).map(b => `<li>${ph(b)}</li>`).join('')}</ul>`).join('');
  if (arr(v.achievements).length) h += `<h4>Key Achievements</h4><ul>${v.achievements.map(b => `<li>${ph(b)}</li>`).join('')}</ul>`;
  if (arr(v.skills).length) h += `<h4>Tools &amp; Technologies</h4><ul>${v.skills.map(x => `<li><b>${ph(x.label)}:</b> ${ph(x.items)}</li>`).join('')}</ul>`;
  if (arr(v.education).length) h += `<h4>Education</h4>` + v.education.map(e => `<div class="jh"><span>${ph(e.degree)}</span><span>${ph(e.year)}</span></div>
    <div class="jc"><span>${ph([e.school, e.detail].filter(Boolean).join('  |  '))}</span></div>`).join('');
  if (arr(v.certifications).length) h += `<h4>Certifications</h4><ul>${v.certifications.map(b => `<li>${ph(b)}</li>`).join('')}</ul>`;
  if (arr(v.personal).length) h += `<h4>Personal Details</h4><p>${v.personal.map(ph).join(' &nbsp;|&nbsp; ')}</p>`;
  return h;
}

function plainText(kind) {
  const r = state.record.result, v = r.resume || {};
  if (kind === 'cover') { const cl = r.cover_letter || {}; return [cl.greeting, ...arr(cl.paragraphs), cl.closing, v.name].filter(Boolean).join('\n\n'); }
  if (kind === 'email') return `Subject: ${r.email?.subject || ''}\n\n${r.email?.body || ''}`;
  if (kind === 'intro') return `30-second version\n${r.intro_30}\n\n60-second version\n${r.intro_60}\n\n2-minute version\n${r.intro_120}`;
  const L = [v.name, v.headline, v.contact, '', 'PROFESSIONAL SUMMARY', v.summary, ''];
  if (arr(v.competencies).length) L.push('CORE COMPETENCIES', ...v.competencies.map(x => `- ${x.label}: ${x.items}`), '');
  L.push('PROFESSIONAL EXPERIENCE');
  arr(v.experience).forEach(j => { L.push(`${j.title} | ${j.dates}`, [j.company, j.location].filter(Boolean).join(' | ')); if (j.intro) L.push(j.intro); arr(j.bullets).forEach(b => L.push('- ' + b)); L.push(''); });
  if (arr(v.achievements).length) L.push('KEY ACHIEVEMENTS', ...v.achievements.map(b => '- ' + b), '');
  if (arr(v.skills).length) L.push('TOOLS & TECHNOLOGIES', ...v.skills.map(x => `- ${x.label}: ${x.items}`), '');
  if (arr(v.education).length) L.push('EDUCATION', ...v.education.map(e => [e.degree, e.school, e.year, e.detail].filter(Boolean).join(' | ')), '');
  if (arr(v.certifications).length) L.push('CERTIFICATIONS', ...v.certifications.map(b => '- ' + b), '');
  if (arr(v.personal).length) L.push('PERSONAL DETAILS', v.personal.join(' | '));
  return L.join('\n');
}

async function copyText(kind, btn) {
  const text = plainText(kind);
  try { await navigator.clipboard.writeText(text); }
  catch { const ta = document.createElement('textarea'); ta.value = text; document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
  btn.textContent = 'Copied'; setTimeout(() => { btn.textContent = 'Copy text'; }, 1800);
}

// ---------- history ----------
async function loadHistory() {
  const card = $('#historyCard');
  card.innerHTML = '<p class="muted" style="padding:20px">Loading…</p>';
  try {
    const { items } = await api('/api/history');
    if (!items.length) {
      card.innerHTML = `<div class="empty-state"><h3>No applications yet</h3><p>Generated applications are saved here automatically.</p>
        <a class="btn btn-primary" href="#new">Create the first one</a></div>`; return;
    }
    const badge = s => `<span class="badge ${s >= 75 ? 'g' : s >= 55 ? 'a' : 'r'}">${s}</span>`;
    card.innerHTML = `<div class="table-scroll"><table><thead><tr><th>Date</th><th>Candidate</th><th>Role</th><th>Company</th><th>Match</th><th>Interview</th><th></th></tr></thead><tbody>
      ${items.map(i => `<tr>
        <td class="muted">${esc(new Date(i.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }))}</td>
        <td><b>${esc(i.candidate || '—')}</b></td><td>${esc(i.role || '—')}</td><td>${esc(i.company || '—')}</td>
        <td>${badge(i.score)} <span class="muted small">→ ${i.scoreAfter}</span></td>
        <td>${i.sessions ? badge(i.bestInterview) + ` <span class="muted small">${i.sessions} session${i.sessions > 1 ? 's' : ''}</span>` : '<span class="muted small">Not practised</span>'}</td>
        <td><div class="actions"><a class="link" href="#result/${i.id}">Open</a><a class="link" href="/api/download/${i.id}/all">Download</a>
          <button class="link danger" data-del="${i.id}">Delete</button></div></td></tr>`).join('')}
      </tbody></table></div>`;
    card.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
      if (b.dataset.confirm !== '1') { b.dataset.confirm = '1'; b.textContent = 'Confirm delete'; setTimeout(() => { b.dataset.confirm = ''; b.textContent = 'Delete'; }, 3000); return; }
      try { await api('/api/history/' + b.dataset.del, { method: 'DELETE' }); toast('Deleted.'); loadHistory(); } catch (e) { toast(e.message, 'error'); }
    });
  } catch (e) { card.innerHTML = `<div class="empty-state"><h3>Could not load history</h3>${esc(e.message)}</div>`; }
}

// ---------- settings ----------
const HELP = {
  demo: `<div class="card-head"><h2>About demo mode</h2></div>
    <p>Demo mode returns a fixed sample application instantly, without any AI. Use it to check the screens, downloads and history.</p>
    <p class="muted small">For real output tailored to each resume and JD, choose Google Gemini (free) or Anthropic Claude.</p>`,
  gemini: `<div class="card-head"><h2>Get a free Gemini key</h2></div>
    <ol class="steps-list">
      <li>Go to <b>aistudio.google.com</b> and sign in with any Google account.</li>
      <li>Click <b>Get API key</b>, then <b>Create API key</b>.</li>
      <li>Copy the key (it starts with <code>AIza</code> or <code>AQ.</code>), paste it here and press <b>Test &amp; save</b>.</li>
    </ol>
    <p class="muted small">No card is needed. The free tier allows a limited number of requests per minute and per day, which is plenty for testing. If you see a limit message, wait and try again. Google may use free-tier prompts to improve its products, so use Claude for anything confidential.</p>`,
  anthropic: `<div class="card-head"><h2>Get a Claude key</h2></div>
    <ol class="steps-list">
      <li>Go to <b>console.anthropic.com</b> and sign in or create an account.</li>
      <li>Open <b>Billing</b> and add a small amount of credit (for example $5).</li>
      <li>Open <b>API Keys</b> and choose <b>Create Key</b>.</li>
      <li>Copy the key (it starts with <code>sk-ant-</code>), paste it here and press <b>Test &amp; save</b>.</li>
    </ol>
    <p class="muted small">Each application costs roughly US$0.05–0.15 depending on the model and resume length.</p>`,
  ollama: `<div class="card-head"><h2>Set up Ollama</h2></div>
    <ol class="steps-list">
      <li>Download and install Ollama from <b>ollama.com</b>, then open it.</li>
      <li>In Terminal run <code>ollama pull llama3.1:8b</code> (about 5 GB, one time).</li>
      <li>Press <b>Test &amp; save</b> here.</li>
    </ol>
    <p class="muted small">Completely free and private, but each application can take several minutes and the writing is weaker than Gemini or Claude. Needs 16 GB of memory or more.</p>`,
};
let selProvider = 'demo';

async function loadSettings() {
  await loadStatus();
  $('#ollamaCard').hidden = !((state.status || {}).providersAllowed || []).includes('ollama');
  selectProvider((state.status || {}).provider || 'demo');
}

async function selectProvider(p) {
  selProvider = p;
  const s = state.status || {}, ps = (s.providers || {})[p] || {};
  $$('.provider').forEach(b => b.setAttribute('aria-checked', b.dataset.provider === p));
  $('#providerHelp').innerHTML = HELP[p];
  $('#pfTitle').textContent = { demo: 'Demo mode', gemini: 'Google Gemini connection', anthropic: 'Anthropic Claude connection', ollama: 'Ollama connection' }[p];
  $('#activeTag').hidden = !(s.provider === p && s.configured);
  $('#pfDemo').hidden = p !== 'demo';
  $('#pfKeyField').hidden = !(p === 'gemini' || p === 'anthropic');
  $('#pfUrlField').hidden = p !== 'ollama';
  $('#pfModelField').hidden = p === 'demo';
  $('#apiKey').value = ''; $('#saveMsg').innerHTML = '';
  $('#apiKey').placeholder = p === 'gemini' ? 'AIza… or AQ.…' : 'sk-ant-…';
  $('#apiKeyLabel').textContent = p === 'gemini' ? 'Gemini API key' : 'Anthropic API key';
  $('#ollamaUrl').value = ps.url || 'http://localhost:11434';
  const saved = p === 'ollama' ? !!ps.model : !!ps.keyHint;
  $('#saveKey').textContent = p === 'demo' ? 'Use demo mode' : (saved && s.provider !== p) ? 'Switch to this AI' : 'Test & save';
  $('#keyHint').textContent = s.forcedDemo ? 'The app was started with "npm run demo", so demo mode is always used. Start it with "npm start" to use a real AI.'
    : p === 'demo' || p === 'ollama' ? '' : ps.keyHint ? `Saved key: ${ps.keyHint}. Leave the box empty to keep it.` : 'No key saved yet.';
  fillModels([], ps.model);
  if ((p === 'gemini' || p === 'anthropic') && ps.keyHint || (p === 'ollama' && ps.model)) {
    try {
      const { models, model } = await api('/api/models?provider=' + p);
      if (selProvider === p) fillModels(models, model);
    } catch (e) { if (selProvider === p) $('#saveMsg').innerHTML = `<span class="err-text">${esc(e.message)}</span>`; }
  }
}
$$('.provider').forEach(b => b.onclick = () => selectProvider(b.dataset.provider));

function fillModels(models, current) {
  const sel = $('#modelSelect');
  sel.innerHTML = models.length
    ? models.map(m => `<option value="${esc(m.id)}" ${m.id === current ? 'selected' : ''}>${esc(m.name)}${m.name !== m.id ? ' (' + esc(m.id) + ')' : ''}</option>`).join('')
    : current ? `<option value="${esc(current)}">${esc(current)}</option>` : '<option value="">Chosen automatically after testing</option>';
}

$('#saveKey').onclick = async () => {
  const btn = $('#saveKey'), msg = $('#saveMsg'), p = selProvider;
  btn.disabled = true; msg.innerHTML = `<span class="muted">${p === 'demo' ? 'Saving…' : 'Testing the connection…'}</span>`;
  try {
    const r = await api('/api/settings', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: p, apiKey: $('#apiKey').value, url: $('#ollamaUrl').value, model: $('#modelSelect').value }) });
    await loadStatus();
    await selectProvider(p);
    fillModels(r.models, r.model);
    $('#saveMsg').innerHTML = `<span class="ok-text">${p === 'demo' ? 'Demo mode is on.' : 'Connected. Using ' + esc(r.model) + '.'}</span>`;
  } catch (e) { msg.innerHTML = `<span class="err-text">${esc(e.message)}</span>`; }
  finally { btn.disabled = false; }
};


// ---------- quick AI switch (New application page) ----------
const PNAMES = { demo: 'Demo mode (sample)', gemini: 'Google Gemini (free)', anthropic: 'Anthropic Claude', ollama: 'Ollama (offline)' };
function savedProviders() {
  const ps = (state.status || {}).providers || {};
  const allowed = (state.status || {}).providersAllowed || ['demo', 'gemini', 'anthropic', 'ollama'];
  return allowed.filter(p => p === 'demo' || (p === 'ollama' ? ps.ollama?.model : ps[p]?.keyHint));
}
function fillQuick() {
  const sel = $('#providerQuick'), s = state.status || {};
  const list = savedProviders();
  sel.innerHTML = list.map(p => `<option value="${p}" ${p === s.provider ? 'selected' : ''}>${PNAMES[p]}</option>`).join('')
    + '<option value="__settings">Set up another AI…</option>';
  sel.disabled = !!s.forcedDemo;
}
$('#providerQuick').addEventListener('change', async e => {
  const p = e.target.value;
  if (p === '__settings') { fillQuick(); location.hash = 'settings'; return; }
  e.target.disabled = true;
  try {
    const r = await api('/api/settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: p }) });
    toast(p === 'demo' ? 'Switched to demo mode.' : `Switched to ${PNAMES[p]} · ${r.model}`, 'success');
  } catch (err) { toast(err.message, 'error'); }
  finally { await loadStatus(); e.target.disabled = false; }
});

// ---------- start ----------
// boot() runs from account.js once all scripts are loaded
