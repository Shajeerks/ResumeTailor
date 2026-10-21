// JD Resume Tailor — interview Q&A tab and mock-interview practice tab
/* global state, api, esc, ph, arr, words, toast, $, $$ */

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const canSpeak = 'speechSynthesis' in window;
const canRecord = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
const SCORE_LABELS = { communication: 'Communication', language: 'Language & grammar', domain_knowledge: 'Domain knowledge', relevance: 'Relevance to the JD', structure: 'Answer structure', confidence: 'Confidence', conciseness: 'Conciseness' };
const TYPE_LABELS = { mixed: 'Full interview (mixed)', hr: 'HR screening', manager: 'Hiring manager', technical: 'Technical / domain', behavioural: 'Behavioural (STAR)' };
const FILLERS = /\b(um+|uh+|er+|ah+|hmm+|you know|basically|actually|i mean|kind of|sort of|literally)\b/gi;
const countFillers = t => (String(t || '').match(FILLERS) || []).length;
const fmtTime = s => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
const prefs = (() => { try { return JSON.parse(localStorage.getItem('ivPrefs') || '{}'); } catch { return {}; } })();
const savePrefs = p => { try { localStorage.setItem('ivPrefs', JSON.stringify(p)); } catch { /* ignore */ } };
const scoreClass = s => (s >= 75 ? 'g' : s >= 55 ? 'a' : 'r');

// =====================================================================
// TAB 1 — Interview Q&A
// =====================================================================
const qaView = { filter: 'All', pendingOnly: false };

function renderQA(body) {
  const rec = state.record, qa = rec.qa;
  if (!qa) {
    body.innerHTML = `<div class="card qa-empty">
      <h3>Prepare for the interview</h3>
      <p>Get 18–22 questions this interviewer is likely to ask for <b>${esc(rec.result.role_title || 'this role')}</b>, each with a model answer built from your own resume, what the interviewer is testing, key points and a mistake to avoid. You also get questions to ask them and topics to revise.</p>
      <button class="btn btn-primary" id="genQA">Generate interview questions</button>
      <p class="muted small" id="qaMsg">Takes about 30–90 seconds.</p></div>`;
    $('#genQA').onclick = () => generateQA(false);
    return;
  }
  const qs = qa.questions, done = qs.filter(q => q.prepared).length;
  const cats = ['All', ...new Set(qs.map(q => q.category))];
  const shown = qs.map((q, i) => ({ q, i })).filter(({ q }) => (qaView.filter === 'All' || q.category === qaView.filter) && (!qaView.pendingOnly || !q.prepared));
  body.innerHTML = `
    ${qa.sample ? '<div class="demo-banner"><span><b>Sample questions.</b> Made in demo mode. Connect Gemini or Claude for questions based on your JD.</span><a class="link" href="#settings">Connect a real AI</a></div>' : ''}
    <div class="doc-toolbar"><div class="title">${qs.length} likely questions</div><div class="actions">
      <button class="btn btn-secondary btn-sm" id="regenQA">Regenerate</button>
      <button class="btn btn-secondary btn-sm" id="practiceQA">Practise in a mock interview</button>
      <a class="btn btn-primary btn-sm" href="/api/download/${rec.id}/qa">Download .docx</a></div></div>
    <div class="card prep-bar"><div class="prep-top"><span><b>${done} of ${qs.length}</b> questions marked as prepared</span><span class="muted small">Tick a question once you can answer it confidently without reading.</span></div>
      <div class="bar"><span style="width:${qs.length ? (done / qs.length) * 100 : 0}%"></span></div></div>
    <div class="qa-layout">
      <div>
        <div class="filters">${cats.map(c => `<button class="fchip ${c === qaView.filter ? 'on' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`).join('')}
          <label class="fcheck"><input type="checkbox" id="pendingOnly" ${qaView.pendingOnly ? 'checked' : ''}> Not prepared only</label></div>
        <div class="qa-list">${shown.map(({ q, i }) => `
          <article class="card qa-item ${q.prepared ? 'is-prepared' : ''}">
            <div class="qa-head"><span class="qnum">Q${i + 1}</span>
              <div class="qa-q">${esc(q.question)}</div>
              <label class="prep-toggle"><input type="checkbox" data-prep="${i}" ${q.prepared ? 'checked' : ''}> Prepared</label></div>
            <div class="qa-meta"><span class="tag cat">${esc(q.category)}</span><span class="tag diff-${q.difficulty.toLowerCase()}">${q.difficulty}</span>
              ${q.why ? `<span class="muted small">Tests: ${esc(q.why)}</span>` : ''}</div>
            <details class="qa-answer"><summary>Model answer</summary>
              <p>${ph(q.answer)}</p>
              ${q.key_points.length ? `<div class="sec-title">Remember</div><ul class="list">${q.key_points.map(k => `<li>${esc(k)}</li>`).join('')}</ul>` : ''}
              ${q.avoid ? `<p class="avoid"><b>Avoid:</b> ${esc(q.avoid)}</p>` : ''}
              ${canSpeak ? `<button class="link" data-read="${i}">Read answer aloud</button>` : ''}
            </details></article>`).join('') || '<p class="muted">No questions match this filter.</p>'}</div>
      </div>
      <aside class="qa-side">
        <div class="card"><div class="sec-title">Questions to ask the interviewer</div><ul class="list">${arr(qa.questions_to_ask).map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>
        <div class="card"><div class="sec-title">Topics to revise</div><ul class="list">${arr(qa.focus_areas).map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>
      </aside></div>`;
  body.querySelectorAll('[data-cat]').forEach(b => b.onclick = () => { qaView.filter = b.dataset.cat; renderQA(body); });
  $('#pendingOnly').onchange = e => { qaView.pendingOnly = e.target.checked; renderQA(body); };
  body.querySelectorAll('[data-prep]').forEach(cb => cb.onchange = async () => {
    const i = +cb.dataset.prep; qs[i].prepared = cb.checked;
    try { await api(`/api/history/${rec.id}/qa/${i}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prepared: cb.checked }) }); }
    catch (e) { toast(e.message, 'error'); }
    renderQA(body);
  });
  body.querySelectorAll('[data-read]').forEach(b => b.onclick = () => speak(qs[+b.dataset.read].answer.replace(/\[[^\]]*\]/g, '')));
  $('#regenQA').onclick = () => { if ($('#regenQA').dataset.c !== '1') { $('#regenQA').dataset.c = '1'; $('#regenQA').textContent = 'Confirm: replace all'; return; } generateQA(true); };
  $('#practiceQA').onclick = () => { state.tab = 'practice'; renderTab(); };
}

async function generateQA() {
  const rec = state.record, body = $('#tabBody');
  body.innerHTML = `<div class="card qa-empty"><div class="thinking"><span class="spinner"></span><div><h3>Writing your interview questions…</h3>
    <p class="muted">Reading the job description and your resume. This usually takes 30–90 seconds.</p></div></div></div>`;
  try { rec.qa = await api(`/api/history/${rec.id}/qa`, { method: 'POST' }); toast('Interview questions ready.', 'success'); }
  catch (e) { toast(e.message, 'error'); }
  if (state.tab === 'qa') renderQA($('#tabBody'));
}

// =====================================================================
// Shared speech helpers
// =====================================================================
let voices = [];
function loadVoices() { if (canSpeak) voices = speechSynthesis.getVoices().filter(v => /^en/i.test(v.lang)); }
if (canSpeak) { loadVoices(); speechSynthesis.onvoiceschanged = loadVoices; }
function pickVoice(lang) {
  const pref = prefs.voice && voices.find(v => v.name === prefs.voice);
  return pref || voices.find(v => v.lang.replace('_', '-') === lang) || voices.find(v => /en-(IN|GB)/i.test(v.lang)) || voices[0];
}
function speak(text, onEnd) {
  if (!canSpeak || !text) { onEnd && onEnd(); return; }
  let ended = false; const finish = () => { if (!ended) { ended = true; onEnd && onEnd(); } };
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const v = pickVoice(prefs.lang || 'en-IN');
    try { if (v) { u.voice = v; u.lang = v.lang; } } catch { /* voice not usable */ }
    u.rate = prefs.rate || 1; u.pitch = 1;
    u.onend = finish; u.onerror = finish;
    speechSynthesis.speak(u);
  } catch { finish(); return; }
  // Safety net: some browsers never fire onend
  setTimeout(finish, Math.max(4000, text.split(/\s+/).length * 520));
}

// =====================================================================
// TAB 2 — Interview practice (mock interview agent)
// =====================================================================
let iv = null;       // live session
let viewSession = null; // report being viewed

function renderPractice(body) {
  if (iv && iv.recId !== state.record.id) { stopListening(); cleanupMedia(); iv = null; }
  if (viewSession && !arr(state.record.practice).some(p => p.id === viewSession.id)) viewSession = null;
  if (iv) return renderRoom(body);
  if (viewSession) return renderReport(body, viewSession);
  renderLobby(body);
}

function readiness(rec) {
  const ps = arr(rec.practice), qs = arr(rec.qa?.questions);
  const latest = ps.length ? ps[ps.length - 1].report.overall_score : null;
  const best = ps.length ? Math.max(...ps.map(p => p.report.overall_score)) : null;
  const prepPct = qs.length ? Math.round(qs.filter(q => q.prepared).length / qs.length * 100) : null;
  const ats = rec.result?.match_score_after ?? rec.result?.match_score ?? null;
  // Readiness = latest mock score 60%, Q&A prepared 25%, tailored resume match 15%
  const parts = [[latest, 0.6], [prepPct, 0.25], [ats, 0.15]].filter(([v]) => v !== null);
  const wsum = parts.reduce((a, [, w]) => a + w, 0);
  const score = parts.length && latest !== null ? Math.round(parts.reduce((a, [v, w]) => a + v * w, 0) / wsum) : null;
  const avg = {}; Object.keys(SCORE_LABELS).forEach(k => { const v = ps.map(p => p.report.scores?.[k]).filter(x => x != null); avg[k] = v.length ? Math.round(v.slice(-3).reduce((a, b) => a + b, 0) / Math.min(3, v.length)) : null; });
  const weakest = Object.entries(avg).filter(([, v]) => v != null).sort((a, b) => a[1] - b[1])[0];
  return { ps, latest, best, prepPct, ats, score, weakest, qsCount: qs.length };
}

function trendChart(ps) {
  if (ps.length < 2) return '<p class="muted small">Your score trend appears after two practice sessions.</p>';
  const W = 320, H = 110, P = 24, n = ps.length;
  const x = i => P + (i * (W - 2 * P)) / (n - 1), y = v => H - 18 - (v / 100) * (H - 36);
  const pts = ps.map((p, i) => [x(i), y(p.report.overall_score)]);
  const line = pts.map(([a, b], i) => (i ? 'L' : 'M') + a.toFixed(1) + ',' + b.toFixed(1)).join(' ');
  return `<svg viewBox="0 0 ${W} ${H}" class="trend" role="img" aria-label="Interview score trend">
    ${[50, 75].map(v => `<line x1="${P}" x2="${W - P}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)" stroke-dasharray="3 3"/><text x="2" y="${y(v) + 4}" font-size="10" fill="var(--muted)">${v}</text>`).join('')}
    <path d="${line} L${pts[n - 1][0]},${H - 18} L${pts[0][0]},${H - 18} Z" fill="var(--accent-soft)"/>
    <path d="${line}" fill="none" stroke="var(--accent)" stroke-width="2"/>
    ${pts.map(([a, b], i) => `<circle cx="${a}" cy="${b}" r="${i === n - 1 ? 4.5 : 3}" fill="${i === n - 1 ? 'var(--accent)' : '#fff'}" stroke="var(--accent)" stroke-width="1.5"/>`).join('')}
    <text x="${pts[n - 1][0]}" y="${pts[n - 1][1] - 9}" font-size="11" font-weight="700" text-anchor="end" fill="var(--ink)">${ps[n - 1].report.overall_score}</text>
    <text x="${P}" y="${H - 3}" font-size="10" fill="var(--muted)">Session 1</text><text x="${W - P}" y="${H - 3}" font-size="10" text-anchor="end" fill="var(--muted)">Session ${n}</text></svg>`;
}

function renderLobby(body) {
  const rec = state.record, R = readiness(rec);
  const p = { type: 'mixed', length: 6, difficulty: 'standard', mode: 'coach', voiceOut: true, autoMic: true, lang: 'en-IN', ...prefs };
  const status = R.score == null ? { t: 'Not assessed yet', c: '' } : R.score >= 75 ? { t: 'Interview ready', c: 'g' } : R.score >= 55 ? { t: 'Almost ready', c: 'a' } : { t: 'Needs more practice', c: 'r' };
  const voiceNote = !SR ? 'Voice answers are not supported in this browser. Use Chrome, Edge or Safari, or type your answers.'
    : !window.isSecureContext ? 'Voice needs http://localhost on the computer running the app. On other devices, type your answers.' : '';
  body.innerHTML = `
  <div class="practice-grid">
    <div class="card readiness">
      <div class="sec-title">Your interview status</div>
      <div class="ready-top"><div class="ready-score ${status.c}">${R.score ?? '–'}</div>
        <div><div class="ready-label ${status.c}">${status.t}</div><div class="muted small">Readiness for ${esc(rec.result.role_title || 'this role')}</div></div></div>
      <div class="kpis">
        <div><b>${R.latest ?? '–'}</b><span>Last interview</span></div>
        <div><b>${R.best ?? '–'}</b><span>Best</span></div>
        <div><b>${R.ps.length}</b><span>Sessions</span></div>
        <div><b>${R.prepPct == null ? '–' : R.prepPct + '%'}</b><span>Q&amp;A prepared</span></div>
      </div>
      ${trendChart(R.ps)}
      ${R.weakest ? `<p class="small"><b>Focus next:</b> ${SCORE_LABELS[R.weakest[0]]} (${R.weakest[1]}/100 average of recent sessions)</p>` : ''}
      <p class="muted small">Readiness combines your latest mock interview (60%), prepared Q&amp;A (25%) and resume match (15%).</p>
    </div>
    <div class="card">
      <div class="card-head"><h2>Start a mock interview</h2></div>
      <div class="fields two">
        <div class="field"><label for="ivType">Interview type</label><select id="ivType">${Object.entries(TYPE_LABELS).map(([k, v]) => `<option value="${k}" ${p.type === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
        <div class="field"><label for="ivLen">Questions</label><select id="ivLen">${[3, 5, 6, 8, 10].map(n => `<option ${+p.length === n ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
        <div class="field"><label for="ivDiff">Difficulty</label><select id="ivDiff">
          <option value="easy" ${p.difficulty === 'easy' ? 'selected' : ''}>Friendly</option><option value="standard" ${p.difficulty === 'standard' ? 'selected' : ''}>Realistic</option><option value="tough" ${p.difficulty === 'tough' ? 'selected' : ''}>Tough</option></select></div>
        <div class="field"><label for="ivMode">Feedback</label><select id="ivMode">
          <option value="coach" ${p.mode === 'coach' ? 'selected' : ''}>Coach: tip after each answer</option><option value="real" ${p.mode === 'real' ? 'selected' : ''}>Real: report at the end only</option></select></div>
        <div class="field"><label for="ivLang">Your accent / language</label><select id="ivLang">
          ${[['en-IN', 'English (India)'], ['en-GB', 'English (UK)'], ['en-US', 'English (US)'], ['en-AE', 'English (UAE)']].map(([v, l]) => `<option value="${v}" ${p.lang === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="field"><label for="ivVoice">Interviewer voice</label><select id="ivVoice" ${canSpeak ? '' : 'disabled'}>
          <option value="">Automatic</option>${voices.map(v => `<option value="${esc(v.name)}" ${p.voice === v.name ? 'selected' : ''}>${esc(v.name)} (${esc(v.lang)})</option>`).join('')}</select></div>
      </div>
      <div class="toggles">
        <label><input type="checkbox" id="ivVoiceOut" ${p.voiceOut ? 'checked' : ''} ${canSpeak ? '' : 'disabled'}> Interviewer speaks the questions</label>
        <label><input type="checkbox" id="ivAutoMic" ${p.autoMic ? 'checked' : ''} ${SR ? '' : 'disabled'}> Start my microphone automatically after each question</label>
        <label><input type="checkbox" id="ivRecord" ${p.record !== false ? 'checked' : ''} ${canRecord ? '' : 'disabled'}> Record my audio for playback</label>
      </div>
      ${voiceNote ? `<p class="notice-inline">${voiceNote}</p>` : ''}
      <div class="row-actions"><button class="btn btn-primary btn-lg" id="ivStart">Start interview</button>
        <span class="muted small">Use headphones so the microphone does not pick up the interviewer.</span></div>
    </div>
  </div>
  <div class="card flush" style="margin-top:18px">
    <div class="card-head pad"><h2>Practice sessions</h2></div>
    ${R.ps.length ? `<div class="table-scroll"><table><thead><tr><th>Date</th><th>Type</th><th>Questions</th><th>Score</th><th>Verdict</th><th></th></tr></thead><tbody>
      ${[...R.ps].reverse().map(s => `<tr><td class="muted">${esc(new Date(s.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }))}</td>
        <td>${esc(TYPE_LABELS[s.settings.type] || s.settings.type)}${s.report.sample ? ' <span class="tag paid">Demo</span>' : ''}</td><td>${s.metrics.answers}</td>
        <td><span class="badge ${scoreClass(s.report.overall_score)}">${s.report.overall_score}</span></td><td>${esc(s.report.verdict)}</td>
        <td><div class="actions"><button class="link" data-open="${s.id}">Report</button>
          <a class="link" href="/api/download/${rec.id}/practice/${s.id}">Download</a>
          <button class="link danger" data-del="${s.id}">Delete</button></div></td></tr>`).join('')}</tbody></table></div>`
    : '<div class="empty-state"><h3>No practice sessions yet</h3><p>Start a mock interview above. Your scores and progress will appear here.</p></div>'}
  </div>`;
  const read = () => ({ type: $('#ivType').value, length: +$('#ivLen').value, difficulty: $('#ivDiff').value, mode: $('#ivMode').value,
    lang: $('#ivLang').value, voice: $('#ivVoice').value, voiceOut: $('#ivVoiceOut').checked, autoMic: $('#ivAutoMic').checked, record: $('#ivRecord').checked });
  body.querySelectorAll('select, input').forEach(el => el.onchange = () => { Object.assign(prefs, read()); savePrefs(prefs); });
  $('#ivStart').onclick = () => { Object.assign(prefs, read()); savePrefs(prefs); startInterview(read()); };
  body.querySelectorAll('[data-open]').forEach(b => b.onclick = () => { viewSession = R.ps.find(s => s.id === b.dataset.open); renderPractice($('#tabBody')); });
  body.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    if (b.dataset.c !== '1') { b.dataset.c = '1'; b.textContent = 'Confirm delete'; return; }
    try { await api(`/api/history/${rec.id}/practice/${b.dataset.del}`, { method: 'DELETE' }); rec.practice = rec.practice.filter(s => s.id !== b.dataset.del); renderLobby(body); toast('Session deleted.'); }
    catch (e) { toast(e.message, 'error'); }
  });
}

// ---------- live interview ----------
async function startInterview(settings) {
  const rec = state.record;
  iv = { recId: rec.id, settings, transcript: [], started: Date.now(), busy: false, done: false, recognizing: false, finalText: '', interim: '',
    answerStart: 0, chunks: [], recorder: null, stream: null, tips: {}, timer: null, recog: null };
  if (settings.record && canRecord) {
    try {
      iv.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(t => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) || '';
      iv.recorder = new MediaRecorder(iv.stream, type ? { mimeType: type } : undefined);
      iv.recorder.ondataavailable = e => { if (e.data && e.data.size) iv.chunks.push(e.data); };
      iv.recorder.start(1000);
    } catch (e) { toast('Microphone not available for recording: ' + (e.message || e.name) + '. You can still type answers.', 'error'); iv.recorder = null; }
  }
  iv.timer = setInterval(updateClock, 1000);
  renderPractice($('#tabBody'));
  nextTurn();
}

function mainCount() { return iv.transcript.filter(t => t.role === 'interviewer' && t.main).length; }

async function nextTurn() {
  if (!iv) return;
  iv.busy = true; renderRoomState('thinking');
  try {
    const r = await api(`/api/history/${state.record.id}/interview/turn`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ settings: iv.settings, transcript: iv.transcript }) });
    if (!iv) return;
    const lastCand = [...iv.transcript].reverse().find(t => t.role === 'candidate');
    if (r.tip && lastCand) lastCand.tip = r.tip;
    iv.transcript.push({ role: 'interviewer', text: r.say, main: !!r.is_main_question });
    iv.done = !!r.done; iv.busy = false;
    renderConversation(); renderRoomState('speaking');
    const after = () => { if (!iv) return; if (iv.done) { finishInterview(); return; } renderRoomState('your-turn'); if (iv.settings.autoMic && SR && window.isSecureContext) startListening(); };
    if (iv.settings.voiceOut) speak(r.say, after); else after();
  } catch (e) {
    if (!iv) return;
    iv.busy = false; renderRoomState('error', e.message);
  }
}

function renderRoom(body) {
  const s = iv.settings;
  body.innerHTML = `
  <div class="room">
    <div class="room-bar">
      <div class="who"><div class="avatar" aria-hidden="true">IN</div><div><b>Interviewer</b><div class="muted small">${esc(TYPE_LABELS[s.type])} · ${s.difficulty === 'tough' ? 'Tough' : s.difficulty === 'easy' ? 'Friendly' : 'Realistic'} · ${s.mode === 'coach' ? 'Coach mode' : 'Real mode'}</div></div></div>
      <div class="room-meta"><span id="ivProgress"></span><span id="ivClock" class="mono">0:00</span>
        ${iv.recorder ? '<span class="rec"><span class="rec-dot"></span>Recording</span>' : ''}
        <button class="btn btn-secondary btn-sm" id="ivEnd">End &amp; get report</button></div>
    </div>
    <div class="conversation" id="ivConv" aria-live="polite"></div>
    <div class="composer">
      <div class="composer-status" id="ivStatus"></div>
      <textarea id="ivAnswer" rows="4" placeholder="${SR ? 'Press the microphone and speak your answer. You can edit the text before sending.' : 'Type your answer here.'}"></textarea>
      <div class="composer-actions">
        ${SR && window.isSecureContext ? '<button class="mic" id="ivMic" type="button" aria-label="Start answering"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg><span id="ivMicLabel">Answer</span></button>' : ''}
        <span class="muted small" id="ivAnsMeta"></span>
        <div class="push composer-btns">
          ${canSpeak ? '<button class="btn btn-secondary btn-sm" id="ivRepeat" type="button">Repeat question</button>' : ''}
          <button class="btn btn-secondary btn-sm" id="ivSkip" type="button">Skip</button>
          <button class="btn btn-primary" id="ivSend" type="button">Send answer</button></div>
      </div>
    </div>
  </div>`;
  $('#ivEnd').onclick = () => {
    if (!iv.transcript.some(t => t.role === 'candidate')) { if ($('#ivEnd').dataset.c !== '1') { $('#ivEnd').dataset.c = '1'; $('#ivEnd').textContent = 'No answers yet. Click to cancel'; return; } cancelInterview(); return; }
    finishInterview();
  };
  $('#ivSend').onclick = sendAnswer;
  $('#ivSkip').onclick = () => { $('#ivAnswer').value = '(I would like to skip this question.)'; iv.finalText = ''; sendAnswer(true); };
  if ($('#ivRepeat')) $('#ivRepeat').onclick = () => { const q = [...iv.transcript].reverse().find(t => t.role === 'interviewer'); if (q) { stopListening(); speak(q.text, () => { if (iv?.settings.autoMic) startListening(); }); } };
  if ($('#ivMic')) $('#ivMic').onclick = () => (iv.recognizing ? stopListening() : startListening());
  $('#ivAnswer').addEventListener('input', () => { iv.finalText = $('#ivAnswer').value; iv.interim = ''; updateAnswerMeta(); });
  $('#ivAnswer').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); sendAnswer(); } });
  renderConversation(); updateClock(); renderRoomState(iv.busy ? 'thinking' : 'your-turn');
}

function renderConversation() {
  const box = $('#ivConv'); if (!box) return;
  box.innerHTML = iv.transcript.map(t => t.role === 'interviewer'
    ? `<div class="msg them"><div class="bubble">${esc(t.text)}</div></div>`
    : `<div class="msg me"><div class="bubble">${esc(t.text)}</div><div class="msg-meta">${t.seconds ? fmtTime(t.seconds) + ' · ' : ''}${t.words} words${t.wpm ? ' · ' + t.wpm + ' wpm' : ''}${t.fillers ? ' · ' + t.fillers + ' fillers' : ''}</div>
       ${t.tip ? `<div class="tip"><b>Coach:</b> ${esc(t.tip)}</div>` : ''}</div>`).join('');
  box.scrollTop = box.scrollHeight;
  const n = mainCount(); const p = $('#ivProgress'); if (p) p.textContent = `Question ${Math.min(n, iv.settings.length)} of ${iv.settings.length}`;
}

function renderRoomState(st, msg) {
  const el = $('#ivStatus'); if (!el || !iv) return;
  const send = $('#ivSend'), mic = $('#ivMic');
  const lock = st === 'thinking' || st === 'speaking' || st === 'finishing';
  if (send) send.disabled = lock; if (mic) mic.disabled = lock;
  ['#ivSkip', '#ivRepeat'].forEach(s => { if ($(s)) $(s).disabled = lock; });
  el.className = 'composer-status ' + st;
  el.innerHTML = {
    thinking: '<span class="spinner sm"></span> Interviewer is thinking…',
    speaking: '<span class="wave"><i></i><i></i><i></i></span> Interviewer is speaking…',
    'your-turn': iv.recognizing ? '<span class="rec-dot"></span> Listening… speak your answer, then press Send.' : 'Your turn. ' + (SR && window.isSecureContext ? 'Press <b>Answer</b> to speak, or type.' : 'Type your answer.'),
    finishing: '<span class="spinner sm"></span> Preparing your report…',
    error: `<span class="err-text">${esc(msg || 'Something went wrong.')}</span> <button class="link" id="ivRetry">Try again</button>`,
  }[st] || '';
  if (st === 'error' && $('#ivRetry')) $('#ivRetry').onclick = nextTurn;
}

function updateClock() { const c = $('#ivClock'); if (c && iv) c.textContent = fmtTime((Date.now() - iv.started) / 1000); updateAnswerMeta(); }
function updateAnswerMeta() {
  const m = $('#ivAnsMeta'); if (!m || !iv) return;
  const text = $('#ivAnswer')?.value || '';
  const sec = iv.answerStart ? (Date.now() - iv.answerStart) / 1000 : 0;
  m.textContent = text ? `${words(text)} words${sec ? ' · ' + fmtTime(sec) : ''}${sec > 150 ? ' · try to wrap up' : ''}` : '';
}

function startListening() {
  if (!SR || !iv || iv.recognizing || iv.busy) return;
  if (canSpeak) speechSynthesis.cancel();
  const r = new SR(); iv.recog = r;
  r.lang = iv.settings.lang || 'en-IN'; r.continuous = true; r.interimResults = true;
  iv.finalText = $('#ivAnswer').value ? $('#ivAnswer').value.trim() + ' ' : '';
  if (!iv.answerStart) iv.answerStart = Date.now();
  r.onresult = e => {
    if (!iv || iv.recog !== r) return;
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) iv.finalText += t.trim() + ' '; else interim += t;
    }
    iv.interim = interim;
    const ta = $('#ivAnswer'); if (ta) ta.value = (iv.finalText + interim).replace(/\s+/g, ' ').trimStart();
    updateAnswerMeta();
  };
  r.onerror = e => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { toast('Microphone permission was blocked. Allow it in the browser address bar, or type your answer.', 'error'); iv.recognizing = false; iv.wantListen = false; }
    else if (e.error === 'network') toast('Speech recognition needs an internet connection. You can type instead.', 'error');
  };
  r.onend = () => { if (iv && iv.wantListen) { try { r.start(); } catch { /* restarting */ } } else if (iv) { iv.recognizing = false; micUI(); renderRoomState('your-turn'); } };
  iv.wantListen = true; iv.recognizing = true;
  try { r.start(); } catch { /* already started */ }
  micUI(); renderRoomState('your-turn');
}
function stopListening() {
  if (!iv) return;
  iv.wantListen = false;
  if (iv.recog) { try { iv.recog.stop(); } catch { /* ignore */ } }
  iv.recognizing = false; micUI();
}
function micUI() { const b = $('#ivMic'); if (!b) return; b.classList.toggle('on', !!iv?.recognizing); $('#ivMicLabel').textContent = iv?.recognizing ? 'Stop' : 'Answer'; }

function sendAnswer(skipped) {
  if (!iv || iv.busy) return;
  stopListening();
  const text = ($('#ivAnswer').value || '').replace(/\s+/g, ' ').trim();
  if (!text) { toast('Say or type your answer first.', 'error'); return; }
  const sec = iv.answerStart ? Math.round((Date.now() - iv.answerStart) / 1000) : 0;
  const w = words(text);
  iv.transcript.push({ role: 'candidate', text, seconds: skipped === true ? 0 : sec, words: w, wpm: sec >= 5 && skipped !== true ? Math.round(w / (sec / 60)) : 0, fillers: countFillers(text) });
  $('#ivAnswer').value = ''; iv.finalText = ''; iv.interim = ''; iv.answerStart = 0; updateAnswerMeta();
  renderConversation();
  nextTurn();
}

function stopRecording() {
  return new Promise(resolve => {
    if (!iv?.recorder || iv.recorder.state === 'inactive') { resolve(null); return; }
    const rec = iv.recorder;
    rec.onstop = () => { const blob = iv.chunks.length ? new Blob(iv.chunks, { type: rec.mimeType || 'audio/webm' }) : null; resolve(blob); };
    try { rec.stop(); } catch { resolve(null); }
  });
}
function cleanupMedia() {
  if (canSpeak) speechSynthesis.cancel();
  if (iv?.stream) iv.stream.getTracks().forEach(t => t.stop());
  if (iv?.timer) clearInterval(iv.timer);
}
async function cancelInterview() { stopListening(); await stopRecording(); cleanupMedia(); iv = null; renderPractice($('#tabBody')); }

async function finishInterview() {
  if (!iv || iv.finishing) return;
  iv.finishing = true; stopListening(); renderRoomState('finishing');
  const pending = ($('#ivAnswer')?.value || '').trim();
  if (pending) { const w = words(pending); iv.transcript.push({ role: 'candidate', text: pending, seconds: 0, words: w, wpm: 0, fillers: countFillers(pending) }); }
  const blob = await stopRecording();
  const durationSec = (Date.now() - iv.started) / 1000;
  const payload = { settings: iv.settings, transcript: iv.transcript, durationSec, audioType: blob && blob.size > 1000 ? (blob.type || 'audio/webm') : '' };
  showFinishing();
  try {
    const session = await api(`/api/history/${state.record.id}/interview/evaluate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    if (payload.audioType && session.upload) {
      try {
        const up = session.upload;
        if (up.mode === 'signed') {
          const r1 = await fetch(up.url, { method: 'PUT', headers: { 'content-type': blob.type || 'audio/webm', 'x-upsert': 'true' }, body: blob });
          if (!r1.ok) throw new Error('upload');
          await api(`/api/history/${state.record.id}/practice/${session.id}/audio`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: up.key }) });
          session.audio = up.key;
        } else {
          const r2 = await fetch(up.url, { method: 'POST', headers: { 'content-type': blob.type || 'audio/webm' }, body: blob });
          if (r2.ok) session.audio = (await r2.json()).file;
        }
      } catch { toast('Report saved, but the audio recording could not be uploaded.', 'error'); }
    }
    delete session.upload;
    state.record.practice = [...(state.record.practice || []), session];
    cleanupMedia(); iv = null; viewSession = session;
    toast('Interview report ready.', 'success');
  } catch (e) {
    toast(e.message, 'error');
    iv.finishing = false; renderPractice($('#tabBody')); renderRoomState('error', e.message + ' Your conversation is kept; press End again to retry.');
    return;
  }
  renderPractice($('#tabBody'));
}
function showFinishing() {
  $('#tabBody').innerHTML = `<div class="card qa-empty"><div class="thinking"><span class="spinner"></span><div><h3>Evaluating your interview…</h3>
    <p class="muted">Scoring your language, knowledge, structure and confidence, and writing stronger answers. About 30–60 seconds.</p></div></div></div>`;
}

// ---------- report ----------
function bar(label, v) {
  return `<div class="sbar"><div class="sbar-top"><span>${label}</span><b>${v}</b></div><div class="bar ${scoreClass(v)}"><span style="width:${v}%"></span></div></div>`;
}
function renderReport(body, s) {
  const rec = state.record, r = s.report, m = s.metrics;
  const prev = arr(rec.practice).filter(p => p.createdAt < s.createdAt).pop();
  const delta = prev ? r.overall_score - prev.report.overall_score : null;
  const wpmNote = !m.words_per_minute ? 'n/a (typed)' : m.words_per_minute < 110 ? 'a little slow' : m.words_per_minute > 170 ? 'too fast' : 'good pace';
  body.innerHTML = `
  ${r.sample ? '<div class="demo-banner"><span><b>Sample evaluation.</b> Made in demo mode. Connect Gemini or Claude for a real assessment.</span><a class="link" href="#settings">Connect a real AI</a></div>' : ''}
  <div class="doc-toolbar"><button class="link" id="repBack">← Practice home</button><div class="actions">
    <button class="btn btn-secondary btn-sm" id="repAgain">Practise again</button>
    <a class="btn btn-primary btn-sm" href="/api/download/${rec.id}/practice/${s.id}">Download report (.docx)</a></div></div>
  <div class="report-grid">
    <div class="card score-card">
      <div class="sec-title">Interview score</div>
      <div class="big-score ${scoreClass(r.overall_score)}">${r.overall_score}<small>/100</small></div>
      <div class="verdict-pill ${scoreClass(r.overall_score)}">${esc(r.verdict)}</div>
      ${delta !== null ? `<div class="small ${delta >= 0 ? 'ok-text' : 'err-text'}">${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta)} vs previous session</div>` : ''}
      <p class="verdict">${esc(r.summary)}</p>
      <div class="muted small">${esc(new Date(s.createdAt).toLocaleString())} · ${esc(TYPE_LABELS[s.settings.type] || '')}</div>
      ${s.audio ? `<div class="audio-box"><div class="sec-title">Your recording</div><audio controls preload="none" src="/api/history/${rec.id}/practice/${s.id}/audio"></audio>
        <a class="link small" href="/api/history/${rec.id}/practice/${s.id}/audio?download=1">Download audio</a></div>` : ''}
    </div>
    <div class="card">
      <div class="sec-title">Skill scores</div>
      <div class="sbars">${Object.entries(SCORE_LABELS).map(([k, l]) => bar(l, r.scores[k] ?? 0)).join('')}</div>
      <div class="metric-row">
        <div><b>${m.words_per_minute || '–'}</b><span>Words per minute<br><i>${wpmNote}</i></span></div>
        <div><b>${m.filler_words}</b><span>Filler words<br><i>${m.fillers_per_100_words} per 100 words</i></span></div>
        <div><b>${m.avg_answer_seconds ? fmtTime(m.avg_answer_seconds) : '–'}</b><span>Average answer<br><i>${m.avg_words_per_answer} words</i></span></div>
        <div><b>${fmtTime(m.duration_seconds)}</b><span>Interview length<br><i>${m.answers} answers</i></span></div>
      </div>
    </div>
  </div>
  <div class="cols-3">
    <div class="card"><div class="sec-title">Strengths</div><ul class="list">${arr(r.strengths).map(x => `<li>${esc(x)}</li>`).join('') || '<li>—</li>'}</ul></div>
    <div class="card"><div class="sec-title">To improve</div><ul class="list">${arr(r.improvements).map(x => `<li>${esc(x)}</li>`).join('') || '<li>—</li>'}</ul></div>
    <div class="card"><div class="sec-title">Next steps</div><ul class="list">${arr(r.next_steps).map(x => `<li>${esc(x)}</li>`).join('') || '<li>—</li>'}
      ${arr(r.knowledge_gaps).length ? `</ul><div class="sec-title">Knowledge to revise</div><ul class="list">${r.knowledge_gaps.map(x => `<li>${esc(x)}</li>`).join('')}` : ''}</ul></div>
  </div>
  <div class="card"><div class="sec-title">Language &amp; communication</div>
    ${r.language_feedback.fluency ? `<p>${esc(r.language_feedback.fluency)}</p>` : ''}
    ${arr(r.language_feedback.grammar).length ? `<div class="sec-title sm">Grammar and phrasing</div><ul class="list">${r.language_feedback.grammar.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    ${arr(r.language_feedback.vocabulary).length ? `<div class="sec-title sm">Vocabulary</div><ul class="list">${r.language_feedback.vocabulary.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
  </div>
  <div class="card"><div class="sec-title">Question by question</div>
    ${arr(r.answers).map((a, i) => `<details class="qa-answer qfb"><summary><span class="badge ${scoreClass(a.score * 10)}">${a.score}/10</span> Q${i + 1}. ${esc(a.question)}</summary>
      ${a.went_well ? `<p><b>Went well:</b> ${esc(a.went_well)}</p>` : ''}${a.improve ? `<p><b>Improve:</b> ${esc(a.improve)}</p>` : ''}
      ${a.better_answer ? `<div class="better"><div class="sec-title sm">Stronger answer</div><p>${ph(a.better_answer)}</p></div>` : ''}</details>`).join('')}
  </div>
  <details class="card transcript"><summary>Full transcript</summary>
    ${arr(s.transcript).map(t => `<p><b>${t.role === 'interviewer' ? 'Interviewer' : 'You'}:</b> ${esc(t.text)}</p>`).join('')}</details>`;
  $('#repBack').onclick = () => { viewSession = null; renderPractice($('#tabBody')); };
  $('#repAgain').onclick = () => { viewSession = null; startInterview({ type: 'mixed', length: 6, difficulty: 'standard', mode: 'coach', voiceOut: true, autoMic: true, lang: 'en-IN', record: true, ...prefs }); };
}

// Leaving the tab during an interview stops speech output.
window.addEventListener('hashchange', () => { if (canSpeak) speechSynthesis.cancel(); });
