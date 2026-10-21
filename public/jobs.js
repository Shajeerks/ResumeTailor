// JD Resume Tailor — Job finder
/* global state, api, esc, arr, words, toast, $, $$ */

const jfState = { profile: null, saved: [], last: null, portals: [], searching: false };
const STATUS_LABELS = { saved: 'Saved', applied: 'Applied', interview: 'Interviewing', offer: 'Offer', rejected: 'Not selected' };
const SITE_CLASS = s => ({ LinkedIn: 'li', Naukri: 'nk', NaukriGulf: 'nk', Indeed: 'in', Foundit: 'fd' }[s] || 'ot');
const scoreCls = v => (v >= 75 ? 'g' : v >= 55 ? 'a' : 'r');
const ago = iso => { const m = Math.round((Date.now() - new Date(iso)) / 60000); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' days ago'; };

async function loadJobs() {
  $('#jfMain').innerHTML = '<p class="muted">Loading…</p>';
  try { Object.assign(jfState, await api('/api/jobs')); }
  catch (e) { $('#jfMain').innerHTML = `<div class="card empty-state"><h3>Could not load</h3>${esc(e.message)}</div>`; return; }
  fillProfileForm();
  renderJobsMain();
}

// ---------- profile form ----------
let jfResume = { text: '', name: '' };
function fillProfileForm() {
  const p = jfState.profile || { links: {}, prefs: {} };
  const pr = p.prefs || {};
  $('#jfLinkedin').value = p.links?.linkedin || ''; $('#jfNaukri').value = p.links?.naukri || '';
  $('#jfIndeed').value = p.links?.indeed || ''; $('#jfOther').value = p.links?.other || '';
  $('#jfRoles').value = arr(pr.roles).join(', '); $('#jfLocations').value = arr(pr.locations).join(', ');
  $('#jfExp').value = pr.experience || ''; $('#jfWindow').value = pr.window || 'week'; $('#jfMode').value = pr.mode || 'any';
  $('#jfExclude').value = arr(pr.exclude).join(', ');
  jfResume = { text: p.resumeText || '', name: p.resumeName || '' };
  $('#jfResumeText').value = jfResume.text;
  $('#jfSaved').textContent = p.updatedAt ? 'Saved ' + ago(p.updatedAt) : '';
  paintResumeState();
}
function paintResumeState() {
  const t = jfResume.text;
  $('#jfResumeState').innerHTML = t
    ? `<div class="file-chip"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 2.5h6.5L15 6v11.5H5z M11.5 2.5V6H15"/></svg><span><b>${esc(jfResume.name || 'Resume text')}</b></span><span class="muted">· ${words(t).toLocaleString()} words</span></div>`
    : '<p class="notice-inline">Add your resume so the search can match jobs to your experience.</p>';
}
$('#jfResumeText').addEventListener('input', () => { jfResume.text = $('#jfResumeText').value; if (!jfResume.name) jfResume.name = 'Pasted text'; paintResumeState(); });
$('#jfFile').addEventListener('change', async () => {
  const f = $('#jfFile').files[0]; $('#jfFile').value = ''; if (!f) return;
  const fd = new FormData(); fd.append('file', f);
  try { const r = await api('/api/parse', { method: 'POST', body: fd }); jfResume = { text: r.text, name: r.fileName }; $('#jfResumeText').value = r.text; paintResumeState(); toast('Resume loaded. Press Save profile.', 'success'); }
  catch (e) { toast(e.message, 'error'); }
});
$('#jfFromApp').onclick = async () => {
  try {
    const { items } = await api('/api/history');
    if (!items.length) { toast('No applications yet. Upload a resume instead.', 'error'); return; }
    const rec = await api('/api/history/' + items[0].id);
    jfResume = { text: rec.input?.resumeText || '', name: 'From: ' + (rec.role || 'latest application') };
    $('#jfResumeText').value = jfResume.text; paintResumeState();
    if (!$('#jfRoles').value && rec.role) $('#jfRoles').value = rec.role.replace(/\s*\(.*?\)\s*/g, ' ').trim();
    toast('Resume copied from your latest application. Press Save profile.', 'success');
  } catch (e) { toast(e.message, 'error'); }
};
$('#jfForm').onsubmit = async e => {
  e.preventDefault(); $('#jfErr').textContent = '';
  $$('#jfForm input').forEach(i => i.classList.remove('invalid'));
  const body = {
    links: { linkedin: $('#jfLinkedin').value, naukri: $('#jfNaukri').value, indeed: $('#jfIndeed').value, other: $('#jfOther').value },
    resumeText: jfResume.text, resumeName: jfResume.name,
    prefs: { roles: $('#jfRoles').value, locations: $('#jfLocations').value, experience: $('#jfExp').value, window: $('#jfWindow').value, mode: $('#jfMode').value, exclude: $('#jfExclude').value },
  };
  try {
    const r = await api('/api/jobs/profile', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    jfState.profile = r.profile; jfState.portals = r.portals;
    $('#jfSaved').textContent = 'Saved just now'; toast('Job profile saved.', 'success'); renderJobsMain();
  } catch (err) {
    $('#jfErr').textContent = err.message;
    const map = { 'link-linkedin': '#jfLinkedin', 'link-naukri': '#jfNaukri', 'link-indeed': '#jfIndeed', 'link-other': '#jfOther' };
    if (map[err.field]) { $(map[err.field]).classList.add('invalid'); $(map[err.field]).focus(); }
  }
};

// ---------- main column ----------
function renderJobsMain() {
  const s = state.status || {}, p = jfState.profile, last = jfState.last;
  const js = s.jobsearch;
  const canSearch = !!js || (['gemini', 'anthropic', 'demo'].includes(s.provider) && s.configured);
  const scorerName = s.configured ? ({ gemini: 'Gemini', anthropic: 'Claude', ollama: 'Ollama' }[s.provider] || '') : '';
  const aiLine = js ? (js.provider === 'jsearch' ? `JSearch live listings (LinkedIn, Indeed, Naukri…)${scorerName ? ', scored by ' + scorerName : ', keyword scoring'}` : `Separate Job finder key: ${js.provider === 'gemini' ? 'Google Gemini with Google Search' : 'Claude with web search'} (${js.keyHint})`) : s.provider === 'gemini' ? 'Google Gemini with Google Search (free tier)' : s.provider === 'anthropic' ? 'Claude with web search (about US$0.01 per search, plus usage)'
    : s.provider === 'demo' ? 'Demo mode: sample results only' : 'This AI cannot search the web';
  const ready = p && (p.resumeText || '').length >= 150;
  $('#jfMain').innerHTML = `
    <div class="card search-card">
      <div class="search-row">
        <div><h2>Search current openings</h2>
          <p class="muted small">${esc(aiLine)} · <a class="link" href="#settings">Change</a>${last ? ` · Last search ${esc(ago(last.at))}` : ''}</p></div>
        <button class="btn btn-primary btn-lg" id="jfSearch" ${ready && canSearch ? '' : 'disabled'}>${last ? 'Search again' : 'Find matching jobs'}</button>
      </div>
      ${!ready ? '<p class="notice-inline">Save your job profile with a resume first.</p>' : ''}
      ${ready && !canSearch ? '<p class="notice-inline">Job search needs Google Gemini (free) or Claude. Choose one in <a class="link" href="#settings">AI settings</a>.</p>' : ''}
    </div>
    <div id="jfResults">${renderResults(last)}</div>
    ${renderPortals()}
    ${renderSaved()}`;
  if ($('#jfSearch')) $('#jfSearch').onclick = runSearch;
  bindJobActions();
}

function renderResults(last) {
  if (!last) return `<div class="card empty-state"><div class="empty-art" aria-hidden="true"><svg viewBox="0 0 64 64"><circle cx="28" cy="28" r="14"/><path d="M38 38l12 12"/></svg></div>
    <h3>No search yet</h3><p>Save your profile, then press <b>Find matching jobs</b>. A search takes about 30–90 seconds.</p></div>`;
  if (last.limited) return `<div class="card limited-card">
  <h3>Google did not allow live web search on this Gemini key</h3>
  <p class="muted">Normal Gemini works on this key, but Google Search (used to find live postings) is a separate quota, and on free keys it is often <b>0</b> or used up. A new key in the <b>same Google project</b> shares the same quota, so changing the key does not help.</p>
  ${last.google ? `<p class="small">Google's reason: <code>${esc(last.google)}</code></p>` : ''}
  <p class="small"><b>To get live job results:</b> in Google AI Studio turn on billing for the project (Google then charges a small fee per search), <b>or</b> create the key in a brand-new Google project, <b>or</b> add a Claude key as the Job finder key in <a class="link" href="#settings">AI settings</a>.</p>
  ${last.keywords.length ? `<div class="sec-title sm">Best-fit job titles for your resume</div><div class="chips">${last.keywords.map(k => `<span class="chip kw">${esc(k)}</span>`).join('')}</div>` : ''}
  ${last.summary ? `<p class="muted">${esc(last.summary)}</p>` : ''}
  ${(last.tips || []).length ? `<ul class="list">${last.tips.map(t => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
  <p class="small muted">Use the job-site buttons below — they search these titles directly on LinkedIn, Naukri, Indeed and more.</p></div>`;
  const savedKeys = new Set(jfState.saved.map(x => (x.title + '|' + x.company).toLowerCase()));
  return `
    ${last.sample ? '<div class="demo-banner"><span><b>Sample results.</b> Demo mode does not search the web. Connect Gemini in AI settings for real postings.</span><a class="link" href="#settings">AI settings</a></div>' : ''}
    <div class="card results-head">
      <div><b>${last.jobs.length} matching jobs</b> <span class="muted small">· ${esc(new Date(last.at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }))}</span></div>
      ${last.summary ? `<p class="muted">${esc(last.summary)}</p>` : ''}
      ${last.keywords.length ? `<div class="chips">${last.keywords.map(k => `<span class="chip kw">${esc(k)}</span>`).join('')}</div>` : ''}
      ${last.provider === 'jsearch' ? `<p class="small muted">Live postings from JSearch${last.queries.length ? ' for: ' + last.queries.map(esc).join(' · ') : ''}. ${last.scoredBy === 'keywords' ? 'Scored by keyword overlap (set up Gemini or Claude in AI settings for smarter scoring).' : 'Match scores by your AI.'}</p>` : '<p class="small muted">Always open the posting to confirm it is still open. Links marked <span class="vlink ok">Found in search</span> came from pages the AI actually searched; others may be outdated.</p>'}
    </div>
    <div class="job-list">${last.jobs.map(j => {
      const isSaved = savedKeys.has((j.title + '|' + j.company).toLowerCase());
      return `<article class="card job" data-id="${esc(j.id)}">
        <div class="job-score ${scoreCls(j.match_score)}"><b>${j.match_score}</b><span>match</span></div>
        <div class="job-body">
          <div class="job-top"><h3>${esc(j.title)}</h3><span class="site-tag ${SITE_CLASS(j.site)}">${esc(j.site)}</span></div>
          <div class="job-meta">${esc(j.company)}${j.location ? ' · ' + esc(j.location) : ''}${j.posted ? ' · ' + esc(j.posted) : ''}${j.experience ? ' · ' + esc(j.experience) : ''}${j.salary ? ' · ' + esc(j.salary) : ''}</div>
          ${j.description ? `<p class="job-desc">${esc(j.description)}</p>` : ''}
          <div class="job-why">
            ${j.match_reasons.length ? `<div><div class="sec-title sm">Why it fits</div><ul class="list">${j.match_reasons.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
            ${j.gaps.length ? `<div><div class="sec-title sm">Gaps</div><ul class="list">${j.gaps.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
          </div>
          <div class="job-actions">
            ${j.url ? `<a class="btn btn-secondary btn-sm" href="${esc(j.url)}" target="_blank" rel="noopener">Open posting</a>` : ''}
            <a class="btn btn-secondary btn-sm" href="${esc(j.searchUrl)}" target="_blank" rel="noopener">Search this job</a>
            <button class="btn btn-secondary btn-sm" data-save="${esc(j.id)}" ${isSaved ? 'disabled' : ''}>${isSaved ? 'Saved' : 'Save'}</button>
            <button class="btn btn-primary btn-sm" data-tailor="${esc(j.id)}">Tailor my resume</button>
            ${j.url ? `<span class="vlink ${j.verified ? 'ok' : 'warn'}">${last.provider === 'jsearch' ? 'Live listing' : j.verified ? 'Found in search' : 'Link not confirmed'}</span>` : '<span class="vlink warn">No direct link found</span>'}
          ${j.note ? `<span class="muted small">${esc(j.note)}</span>` : ''}
          </div>
        </div></article>`;
    }).join('') || '<div class="card empty-state"><h3>No matching postings found</h3><p>Try wider locations, more role titles or a longer "posted within" period, or use the job-site links below.</p></div>'}</div>
    ${last.sources.length ? `<details class="card sources"><summary>Pages searched (${last.sources.length})</summary><ul class="list">${last.sources.map(s => `<li><a href="${esc(s.uri)}" target="_blank" rel="noopener">${esc(s.title || s.uri)}</a></li>`).join('')}</ul>
      ${last.queries.length ? `<p class="small muted">Searches: ${last.queries.map(esc).join(' · ')}</p>` : ''}</details>` : ''}`;
}

function renderPortals() {
  const groups = jfState.portals || [];
  if (!groups.length) return '';
  return `<div class="card"><div class="card-head"><h2>Search directly on job sites</h2></div>
    <p class="muted small">Ready-made searches for your roles and locations. They open in a new tab; sign in there to apply.</p>
    <div class="portal-groups">${groups.map(g => `<div class="portal-group"><div class="pg-title"><b>${esc(g.role)}</b> <span class="muted">· ${esc(g.location)}</span></div>
      <div class="pg-links">${g.items.map(i => `<a class="site-btn ${SITE_CLASS(i.site)}" href="${esc(i.url)}" target="_blank" rel="noopener">${esc(i.site)}</a>`).join('')}</div></div>`).join('')}</div></div>`;
}

function renderSaved() {
  const list = jfState.saved;
  const counts = Object.keys(STATUS_LABELS).map(k => [k, list.filter(s => s.status === k).length]);
  return `<div class="card flush"><div class="card-head pad"><h2>Saved jobs</h2>
    <div class="pipeline push">${counts.map(([k, n]) => `<span class="pipe ${k}"><b>${n}</b> ${STATUS_LABELS[k]}</span>`).join('')}</div></div>
    ${list.length ? `<div class="table-scroll"><table><thead><tr><th>Job</th><th>Match</th><th>Status</th><th></th></tr></thead><tbody>
      ${list.map(s => `<tr><td><b>${esc(s.title)}</b><div class="muted small">${esc(s.company)}${s.location ? ' · ' + esc(s.location) : ''}${s.site ? ' · ' + esc(s.site) : ''}</div></td>
        <td>${s.match_score ? `<span class="badge ${scoreCls(s.match_score)}">${s.match_score}</span>` : '–'}</td>
        <td><select class="status-select" data-status="${esc(s.id)}">${Object.entries(STATUS_LABELS).map(([k, l]) => `<option value="${k}" ${s.status === k ? 'selected' : ''}>${l}</option>`).join('')}</select></td>
        <td><div class="actions">${s.url || s.searchUrl ? `<a class="link" href="${esc(s.url || s.searchUrl)}" target="_blank" rel="noopener">Open</a>` : ''}
          ${s.appId ? `<a class="link" href="#result/${esc(s.appId)}">Application</a>` : `<button class="link" data-tailor-saved="${esc(s.id)}">Tailor</button>`}
          <button class="link danger" data-unsave="${esc(s.id)}">Remove</button></div></td></tr>`).join('')}</tbody></table></div>`
    : '<div class="empty-state"><p>Save jobs from the results to track your applications here.</p></div>'}</div>`;
}

function bindJobActions() {
  const find = id => (jfState.last?.jobs || []).find(j => j.id === id);
  $$('[data-save]').forEach(b => b.onclick = async () => {
    const j = find(b.dataset.save); if (!j) return;
    try { const r = await api('/api/jobs/saved', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(j) }); jfState.saved = r.saved; toast('Job saved.', 'success'); renderJobsMain(); }
    catch (e) { toast(e.message, 'error'); }
  });
  $$('[data-tailor]').forEach(b => b.onclick = () => tailorFor(find(b.dataset.tailor)));
  $$('[data-tailor-saved]').forEach(b => b.onclick = () => tailorFor(jfState.saved.find(s => s.id === b.dataset.tailorSaved), true));
  $$('[data-unsave]').forEach(b => b.onclick = async () => {
    if (b.dataset.c !== '1') { b.dataset.c = '1'; b.textContent = 'Confirm'; return; }
    try { jfState.saved = (await api('/api/jobs/saved/' + b.dataset.unsave, { method: 'DELETE' })).saved; renderJobsMain(); }
    catch (e) { toast(e.message, 'error'); }
  });
  $$('[data-status]').forEach(sel => sel.onchange = async () => {
    try { jfState.saved = (await api('/api/jobs/saved/' + sel.dataset.status, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: sel.value }) })).saved; renderJobsMain(); toast('Status updated.'); }
    catch (e) { toast(e.message, 'error'); }
  });
}

async function runSearch() {
  if (jfState.searching) return;
  jfState.searching = true;
  const btn = $('#jfSearch'); btn.disabled = true; btn.textContent = 'Searching…';
  const t0 = Date.now();
  $('#jfResults').innerHTML = `<div class="card qa-empty"><div class="thinking"><span class="spinner"></span><div><h3>Searching job sites…</h3>
    <p class="muted">Looking for current openings on LinkedIn, Naukri, Indeed and company career pages, then scoring each against your resume. <span id="jfTimer">0:00</span></p></div></div></div>`;
  const iv = setInterval(() => { const s = (Date.now() - t0) / 1000; const el = $('#jfTimer'); if (el) el.textContent = Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0'); }, 1000);
  try {
    jfState.last = await api('/api/jobs/search', { method: 'POST' });
    jfState.portals = (await api('/api/jobs')).portals;
    toast(jfState.last.limited ? 'Live search was blocked by Google. Showing best-fit titles and job-site links.' : `${jfState.last.jobs.length} jobs found.`, jfState.last.limited ? 'error' : 'success');
  } catch (e) { toast(e.message, 'error'); }
  finally { clearInterval(iv); jfState.searching = false; renderJobsMain(); }
}

// Open "New application" with the resume and what we know about the job.
async function tailorFor(job, fromSaved) {
  if (!job) return;
  const p = jfState.profile || {};
  location.hash = 'new';
  await new Promise(r => setTimeout(r, 50));
  $('#resumeText').value = p.resumeText || '';
  if (p.resumeText) { $('#fileName').textContent = p.resumeName || 'Job profile resume'; $('#fileMeta').textContent = '· ' + words(p.resumeText).toLocaleString() + ' words'; $('#fileChip').hidden = false; $('#dropzone').hidden = true; }
  $('#jdText').value = `${job.title} – ${job.company}${job.location ? ' (' + job.location + ')' : ''}\n\n${job.description || ''}\n\n[Open the posting and paste the FULL job description here for the best result]\n${job.url || job.searchUrl || ''}`;
  $('#jdText').dispatchEvent(new Event('input'));
  $('#company').value = job.company || '';
  $('#jdText').focus();
  toast('Paste the full job description from the posting, then press Generate.', 'success');
  if (!fromSaved && !jfState.saved.some(s => s.title === job.title && s.company === job.company)) {
    try { jfState.saved = (await api('/api/jobs/saved', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...job, status: 'saved' }) })).saved; } catch { /* already saved */ }
  }
}

// ---------- separate Job finder key (AI settings page) ----------
function paintJobKey() {
  const js = (state.status || {}).jobsearch;
  $('#jsActive').hidden = !js; $('#jsRemove').hidden = !js; $('#jsMsg').innerHTML = ''; $('#jsKey').value = '';
  if (js) $('#jsProvider').value = js.provider;
  const nm = { gemini: 'Gemini', anthropic: 'Claude', jsearch: 'JSearch' };
  $('#jsHint').textContent = js ? `Saved ${nm[js.provider]} key ${js.keyHint}${js.provider === 'jsearch' ? '' : ' · model ' + js.model}. Leave the box empty to keep it.` : 'Not set: Job finder uses the main AI above.';
}
$('#jsSave').onclick = async () => {
  const btn = $('#jsSave'); btn.disabled = true; $('#jsMsg').innerHTML = '<span class="muted">Testing the key…</span>';
  try {
    const r = await api('/api/settings/jobsearch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: $('#jsProvider').value, apiKey: $('#jsKey').value }) });
    await loadStatus(); paintJobKey();
    $('#jsMsg').innerHTML = `<span class="ok-text">Saved. Job finder now uses this key (${esc(r.model)}).</span>`;
  } catch (e) { $('#jsMsg').innerHTML = `<span class="err-text">${esc(e.message)}</span>`; }
  finally { btn.disabled = false; }
};
$('#jsRemove').onclick = async () => {
  const b = $('#jsRemove');
  if (b.dataset.c !== '1') { b.dataset.c = '1'; b.textContent = 'Confirm remove'; setTimeout(() => { b.dataset.c = ''; b.textContent = 'Remove'; }, 4000); return; }
  try { await api('/api/settings/jobsearch', { method: 'DELETE' }); await loadStatus(); paintJobKey(); toast('Job finder key removed.'); }
  catch (e) { toast(e.message, 'error'); }
};
