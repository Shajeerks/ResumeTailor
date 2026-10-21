// Job finder: searches the live web for open postings that match the user's resume.
// Gemini uses "Grounding with Google Search"; Claude uses Anthropic's web search tool.
// LinkedIn / Naukri are never logged into or scraped; we search public listings and link out.
const ai = require('./ai');

const GEMINI = process.env.GEMINI_BASE || 'https://generativelanguage.googleapis.com/v1beta';
const ANTHROPIC = process.env.ANTHROPIC_BASE || 'https://api.anthropic.com/v1';
const err = (m, s = 400) => { const e = new Error(m); e.status = s; return e; };
const A = v => (Array.isArray(v) ? v.filter(Boolean) : []);
const clip = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n) + '…' : s; };
const WINDOWS = { day: 'the last 24 hours', '3days': 'the last 3 days', week: 'the last 7 days', month: 'the last 30 days' };

// ---------- profile ----------
const LINK_RULES = {
  linkedin: { re: /^https?:\/\/([a-z]{2,3}\.)?(www\.)?linkedin\.com\/in\/[^\s/]+\/?/i, msg: 'LinkedIn link should look like https://www.linkedin.com/in/your-name' },
  naukri: { re: /^https?:\/\/(www\.)?naukri\.com\//i, msg: 'Naukri link should start with https://www.naukri.com/' },
  indeed: { re: /^https?:\/\/([a-z]+\.)?indeed\.com\//i, msg: 'Indeed link should start with https://…indeed.com/' },
  other: { re: /^https?:\/\/[^\s]+\.[^\s]+/i, msg: 'Other link must start with https://' },
};
function cleanProfile(b = {}) {
  const links = {};
  for (const [k, rule] of Object.entries(LINK_RULES)) {
    let v = String(b.links?.[k] || '').trim();
    if (!v) continue;
    if (!/^https?:\/\//i.test(v)) v = 'https://' + v;
    if (!rule.re.test(v)) { const e = err(rule.msg); e.field = 'link-' + k; throw e; }
    links[k] = v.slice(0, 300);
  }
  const list = (s, max) => String(s || '').split(/[,;\n]/).map(x => x.trim()).filter(Boolean).slice(0, max).map(x => x.slice(0, 60));
  const p = b.prefs || {};
  return {
    links,
    resumeText: String(b.resumeText || '').trim().slice(0, 40000),
    resumeName: String(b.resumeName || '').slice(0, 120),
    prefs: {
      roles: list(p.roles, 6), locations: list(p.locations, 6),
      experience: Math.max(0, Math.min(50, parseInt(p.experience, 10) || 0)),
      window: WINDOWS[p.window] ? p.window : 'week',
      mode: ['any', 'onsite', 'hybrid', 'remote'].includes(p.mode) ? p.mode : 'any',
      exclude: list(p.exclude, 10),
    },
    updatedAt: new Date().toISOString(),
  };
}

// ---------- portal search links (always valid, no scraping) ----------
const enc = encodeURIComponent;
const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const GCC = /dubai|abu dhabi|uae|sharjah|qatar|doha|kuwait|saudi|riyadh|jeddah|oman|muscat|bahrain|gcc|middle east/i;
function portalLinks(profile, keywords) {
  const p = profile.prefs || {};
  const roles = (keywords && keywords.length ? keywords : p.roles).slice(0, 3);
  const locs = p.locations.length ? p.locations : [''];
  const tpr = { day: 'r86400', '3days': 'r259200', week: 'r604800', month: 'r2592000' }[p.window] || 'r604800';
  const age = { day: 1, '3days': 3, week: 7, month: 30 }[p.window] || 7;
  const out = [];
  for (const role of roles) {
    for (const loc of locs.slice(0, 3)) {
      const remote = /remote/i.test(loc);
      const l = remote ? '' : loc;
      const items = [
        { site: 'LinkedIn', url: `https://www.linkedin.com/jobs/search/?keywords=${enc(role)}&location=${enc(l || 'India')}&f_TPR=${tpr}${remote || p.mode === 'remote' ? '&f_WT=2' : ''}` },
        { site: 'Naukri', url: `https://www.naukri.com/${slug(role)}-jobs${l ? '-in-' + slug(l) : ''}${p.experience ? '?experience=' + p.experience : ''}` },
        { site: 'Indeed', url: `https://in.indeed.com/jobs?q=${enc(role)}&l=${enc(l)}&fromage=${age}` },
        { site: 'Foundit', url: `https://www.foundit.in/srp/results?query=${enc(role)}${l ? '&locations=' + enc(l) : ''}` },
      ];
      if (GCC.test(loc)) {
        items.push({ site: 'NaukriGulf', url: `https://www.naukrigulf.com/${slug(role)}-jobs${l ? '-in-' + slug(l) : ''}` });
        items.push({ site: 'Bayt', url: `https://www.google.com/search?q=${enc(`"${role}" ${l} site:bayt.com/en`)}` });
        items.push({ site: 'GulfTalent', url: `https://www.google.com/search?q=${enc(`"${role}" ${l} site:gulftalent.com`)}` });
      }
      out.push({ role, location: loc || 'Any location', items });
    }
  }
  return out.slice(0, 6);
}

// ---------- AI search ----------
function searchPrompt(profile) {
  const p = profile.prefs;
  const gcc = p.locations.some(l => GCC.test(l));
  return `TASK: JOB_SEARCH
You are an expert recruiter. Use web search to find REAL, currently open job postings that match this candidate.

SEARCH RULES
- Search job boards and career pages: LinkedIn Jobs, Naukri.com, Indeed, Foundit (Monster), Instahyre, company career pages${gcc ? ', NaukriGulf, Bayt, GulfTalent, Indeed UAE' : ''}.
- Target roles: ${p.roles.join(', ') || 'infer the best-fit roles from the resume'}.
- Locations: ${p.locations.join(', ') || 'infer from the resume'}. Work mode: ${p.mode}.
- Experience: about ${p.experience || 'infer from resume'} years. Posted within ${WINDOWS[p.window]}.
${p.exclude.length ? `- Exclude these companies: ${p.exclude.join(', ')}.` : ''}
- Run several searches with different keyword variations. Find 10 to 15 DISTINCT postings.
- NEVER invent postings, companies or URLs. Only include a job if you actually found it in search results. Use the exact URL you found; if you only found the company careers page, use that and say so in "note".
- If you are not sure a job is still open, set "status" to "check".

For each job, judge fit against the resume honestly: match_score 0-100, 2-3 match_reasons (specific resume evidence), 1-3 gaps.

Reply with ONLY one JSON object (no markdown), in this shape:
{"search_keywords":["3-5 job-title keywords that suit this candidate"],
 "summary":"2 sentences on the market for this profile",
 "jobs":[{"title":"","company":"","location":"","site":"LinkedIn|Naukri|Indeed|Foundit|Company site|Other","url":"","posted":"as stated, e.g. 3 days ago","employment_type":"","experience":"","salary":"","description":"2-3 sentences on key responsibilities and requirements","match_score":0,"match_reasons":[""],"gaps":[""],"status":"open|check","note":""}]}

=== CANDIDATE RESUME ===
${clip(profile.resumeText, 9000)}`;
}

const host = u => { try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };
const siteOf = (u, s) => {
  const h = host(u);
  if (/linkedin\./.test(h)) return 'LinkedIn'; if (/naukrigulf\./.test(h)) return 'NaukriGulf'; if (/naukri\./.test(h)) return 'Naukri';
  if (/indeed\./.test(h)) return 'Indeed'; if (/foundit\.|monster/.test(h)) return 'Foundit'; if (/bayt\./.test(h)) return 'Bayt';
  if (/gulftalent\./.test(h)) return 'GulfTalent'; if (/instahyre\./.test(h)) return 'Instahyre';
  return s || (h ? 'Company site' : 'Other');
};

function normaliseJobs(data, verify) {
  const seen = new Set();
  const jobs = A(data.jobs).map((j, i) => {
    let url = String(j.url || '').trim();
    if (!/^https?:\/\//i.test(url)) url = '';
    const title = clip(j.title, 140), company = clip(j.company, 100);
    const v = verify(url, j);
    return {
      id: 'j' + Date.now().toString(36) + i,
      title, company, location: clip(j.location, 100), site: siteOf(url, j.site), url,
      verified: v,
      searchUrl: `https://www.google.com/search?q=${enc(`"${title}" "${company}" job`)}`,
      posted: clip(j.posted, 40), employment_type: clip(j.employment_type, 40), experience: clip(j.experience, 40), salary: clip(j.salary, 60),
      description: clip(j.description, 700),
      match_score: Math.max(0, Math.min(100, Math.round(+j.match_score || 0))),
      match_reasons: A(j.match_reasons).slice(0, 3).map(x => clip(x, 200)), gaps: A(j.gaps).slice(0, 3).map(x => clip(x, 200)),
      status: j.status === 'check' ? 'check' : 'open', note: clip(j.note, 200),
    };
  }).filter(j => {
    const k = (j.title + '|' + j.company).toLowerCase();
    if (!j.title || !j.company || seen.has(k)) return false;
    seen.add(k); return true;
  }).sort((a, b) => b.match_score - a.match_score);
  return { jobs, keywords: A(data.search_keywords).slice(0, 5).map(x => clip(x, 60)), summary: clip(data.summary, 400) };
}

async function geminiSearch(cfg, prompt) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 240000);
  let r, body;
  try {
    r = await fetch(`${GEMINI}/models/${encodeURIComponent(cfg.model)}:generateContent`, {
      method: 'POST', signal: ctl.signal, headers: { 'x-goog-api-key': cfg.apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], tools: [{ google_search: {} }], generationConfig: { temperature: 0.3, maxOutputTokens: 16000 } }),
    });
    body = await r.json().catch(() => ({}));
  } catch (e) { throw err(e.name === 'AbortError' ? 'The job search took too long. Please try again.' : 'Cannot reach Gemini. Check your connection.', 503); }
  finally { clearTimeout(t); }
  if (!r.ok) {
    const msg = body?.error?.message || '';
    if (r.status === 429) throw err('Gemini free-tier limit reached for web search. Wait a minute (or until tomorrow) and try again, or use the portal links below.', 429);
    if (r.status === 400 && /search|tool|grounding/i.test(msg)) throw err(`This Gemini model cannot search the web (${msg}). In AI settings choose a Gemini "Flash" model and try again.`, 400);
    throw err(msg || `Gemini returned an error (${r.status}).`, r.status);
  }
  const cand = (body.candidates || [])[0] || {};
  const text = (cand.content?.parts || []).filter(p => !p.thought).map(p => p.text || '').join('');
  const gm = cand.groundingMetadata || {};
  const sources = A(gm.groundingChunks).map(c => ({ title: c.web?.title || '', uri: c.web?.uri || '' })).filter(s => s.uri);
  return { text, sources, queries: A(gm.webSearchQueries) };
}

// Free-tier search quotas are counted per model, so when one model is out of quota try the next best ones.
async function geminiSearchWithFallback(cfg, prompt) {
  try { return { ...(await geminiSearch(cfg, prompt)), model: cfg.model }; }
  catch (e) {
    if (e.status !== 429) throw e;
    let models = [];
    try { models = ai.rankGemini(await ai.listModels('gemini', cfg)).filter(m => m !== cfg.model && /flash/.test(m)).slice(0, 3); } catch { /* ignore */ }
    for (const model of models) {
      try { return { ...(await geminiSearch({ ...cfg, model }, prompt)), model }; }
      catch (e2) { if (e2.status !== 429 && e2.status !== 404 && e2.status !== 400) throw e2; }
    }
    throw err('Gemini web-search limit reached on this API key (free tier). Options: add a separate Job finder key in AI settings, turn on billing for the key in Google AI Studio, wait until tomorrow, or use the job-site links below.', 429);
  }
}

async function claudeSearch(cfg, prompt) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 280000);
  let r, body;
  try {
    r = await fetch(`${ANTHROPIC}/messages`, {
      method: 'POST', signal: ctl.signal, headers: { 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: cfg.model, max_tokens: 12000, tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 6 }], messages: [{ role: 'user', content: prompt }] }),
    });
    body = await r.json().catch(() => ({}));
  } catch (e) { throw err(e.name === 'AbortError' ? 'The job search took too long. Please try again.' : 'Cannot reach Claude. Check your connection.', 503); }
  finally { clearTimeout(t); }
  if (!r.ok) {
    const msg = body?.error?.message || '';
    if (/web.?search|tool/i.test(msg)) throw err(`Claude web search is not available for this key or model (${msg}). Enable web search in console.anthropic.com > Settings > Privacy, or use Gemini.`, 400);
    if (r.status === 400 && /credit|balance|billing/i.test(msg)) throw err('Your Anthropic account has no credit left. Add credit at console.anthropic.com > Billing, or switch to Gemini.', 400);
    throw err(msg || `Claude returned an error (${r.status}).`, r.status);
  }
  const blocks = A(body.content);
  const text = blocks.filter(b => b.type === 'text').map(b => b.text).join('');
  const sources = blocks.filter(b => b.type === 'web_search_tool_result').flatMap(b => A(b.content)).filter(c => c.type === 'web_search_result').map(c => ({ title: c.title || '', uri: c.url }));
  const queries = blocks.filter(b => b.type === 'server_tool_use').map(b => b.input?.query).filter(Boolean);
  return { text, sources, queries };
}

function demoSearch(profile) {
  const role = profile.prefs.roles[0] || 'Project Manager', loc = profile.prefs.locations[0] || 'Bengaluru';
  const mk = (title, company, site, score) => ({ title, company, location: loc, site, url: '', posted: 'Sample', employment_type: 'Full-time', experience: '8-12 years', salary: '',
    description: 'Sample listing for demo mode. Connect Gemini in AI settings to search real, current job postings.', match_score: score,
    match_reasons: ['Sample: relevant delivery experience'], gaps: ['Sample: certification listed as preferred'], status: 'check', note: 'Demo data' });
  return { text: JSON.stringify({ search_keywords: [role, role + ' Healthcare IT', 'Implementation Manager'], summary: 'Sample results in demo mode. These are not real postings.',
    jobs: [mk(role, 'Example Health Systems', 'LinkedIn', 84), mk('Implementation Manager', 'Sample Hospitals Ltd', 'Naukri', 78), mk('Delivery Manager – HIS', 'Demo Medtech', 'Indeed', 71)] }), sources: [], queries: [] };
}

async function search({ provider, cfg, profile, separate }) {
  if (!profile?.resumeText || profile.resumeText.length < 150) throw err('Add your resume in the job profile first.');
  const prompt = searchPrompt(profile);
  let out;
  if (provider === 'demo') out = demoSearch(profile);
  else if (provider === 'gemini') out = await geminiSearchWithFallback(cfg, prompt);
  else if (provider === 'anthropic') out = await claudeSearch(cfg, prompt);
  else throw err('Job search needs Google Gemini or Anthropic Claude (web access). Choose one in AI settings.');
  let data;
  try { data = ai.parseJson(out.text); } catch { throw err('The AI answer could not be read. Please search again.', 502); }

  // A job link is "verified" when it was among the pages the search actually returned.
  const hosts = new Set(out.sources.map(s => (s.title || '').toLowerCase().replace(/^www\./, '')).concat(out.sources.map(s => host(s.uri))).filter(Boolean));
  const urls = new Set(out.sources.map(s => s.uri.split('#')[0].replace(/\/$/, '')));
  const verify = url => {
    if (!url) return false;
    if (/vertexaisearch\.cloud\.google\.com/.test(url)) return true; // Google's own redirect to a page it searched
    if (urls.has(url.split('#')[0].replace(/\/$/, ''))) return true;
    const h = host(url);
    return provider === 'gemini' && !!h && [...hosts].some(x => x === h || x.endsWith('.' + h) || h.endsWith('.' + x));
  };
  const n = normaliseJobs(data, verify);
  return {
    at: new Date().toISOString(), provider, model: provider === 'demo' ? 'demo' : (out.model || cfg.model), sample: provider === 'demo',
    summary: n.summary, keywords: n.keywords, jobs: n.jobs,
    queries: out.queries.slice(0, 10), sources: out.sources.slice(0, 20).map(s => ({ title: clip(s.title, 80), uri: s.uri })),
    portals: portalLinks(profile, n.keywords), separateKey: !!separate,
  };
}

// ---------- saved jobs ----------
const STATUSES = ['saved', 'applied', 'interview', 'offer', 'rejected'];
function cleanSaved(j = {}) {
  return {
    id: String(j.id || 's' + Date.now().toString(36)).slice(0, 40), title: clip(j.title, 140), company: clip(j.company, 100), location: clip(j.location, 100),
    site: clip(j.site, 30), url: /^https?:\/\//i.test(j.url || '') ? String(j.url).slice(0, 600) : '', searchUrl: /^https?:\/\//i.test(j.searchUrl || '') ? String(j.searchUrl).slice(0, 600) : '',
    description: clip(j.description, 700), match_score: Math.max(0, Math.min(100, +j.match_score || 0)),
    status: STATUSES.includes(j.status) ? j.status : 'saved', notes: clip(j.notes, 500), appId: clip(j.appId, 40),
    savedAt: j.savedAt || new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
}

module.exports = { cleanProfile, search, portalLinks, cleanSaved, STATUSES };
