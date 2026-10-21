// Talks to the AI provider (demo, Google Gemini, Anthropic Claude or local Ollama) and returns structured JSON.
const VERSION = '2023-06-01';

const REGION_RULES = {
  india: 'Target market: India. Include a short Personal Details section (date of birth, languages, nationality, notice period) only with values that appear in the resume; keep [placeholders] as they are.',
  gcc: 'Target market: Middle East / GCC. Include a short Personal Details section (nationality, date of birth, languages, visa status, notice period) only with values present in the resume; keep [placeholders].',
  global: 'Target market: US / UK / Europe / global. Do NOT include date of birth, age, marital status, nationality or photo. Personal details may list only languages, work authorisation and notice period if present.',
};
const TONES = {
  professional: 'Tone: polished, formal and professional.',
  confident: 'Tone: confident and results-driven, with strong ownership language, never arrogant.',
  warm: 'Tone: warm, personable and enthusiastic while staying professional.',
};

function buildPrompt({ resumeText, jdText, company, manager, extra, region, tone, links }) {
  return `You are a senior HR recruiter and hiring manager with 20 years of experience who writes ATS-optimised job applications.

TASK: Tailor the candidate's application to the job description.

STRICT RULES
1. Use ONLY facts found in the candidate resume. Never invent employers, job titles, dates, degrees, certifications, tools, team sizes, metrics or achievements. If the JD asks for something the candidate lacks, list it in missing_keywords and gaps; never claim it.
2. You may rephrase, reorder and emphasise true experience, using the JD's exact keywords where they are truthful.
3. Keep every [bracketed placeholder] from the resume exactly as written.
4. Resume bullets: begin with a strong action verb, 1-2 lines each, most JD-relevant first. 4-8 bullets for recent roles, 2-3 for older roles. Keep every role from the resume with its real title, company and dates.
5. ATS-safe plain text only: no tables, emojis, icons or decorative symbols.
6. Cover letter: 280-380 words in 4 paragraphs (hook naming the role; most relevant experience with evidence; fit with the company's needs from the JD; close with call to action).
7. Email: 110-170 words, to accompany the attached resume and cover letter.
8. Self-introductions: spoken, first person, natural. intro_30 = 60-80 words, intro_60 = 140-170 words, intro_120 = 280-320 words. Aim them at this role.
9. Scores must be honest. match_score = fit of the ORIGINAL resume to the JD; match_score_after = expected fit of your tailored resume.
${REGION_RULES[region] || REGION_RULES.india}
${TONES[tone] || TONES.professional}
${company ? `Company name: ${company}` : 'Read the company name from the JD; if absent use "your organisation".'}
${manager ? `Address the cover letter and email to: ${manager}` : 'If no hiring manager is named in the JD, use "Dear Hiring Manager".'}
${extra ? `The candidate also wants to highlight: ${extra}` : ''}
${links && Object.keys(links).length ? `Candidate profile links (put the LinkedIn URL in the contact line instead of a LinkedIn placeholder; mention other links only if useful): ${Object.entries(links).map(([k, v]) => k + ': ' + v).join(', ')}` : ''}

Reply with ONLY one valid JSON object (no markdown fences, no commentary) in exactly this shape:
{
 "role_title": "job title from the JD",
 "company": "company name",
 "match_score": 0,
 "match_score_after": 0,
 "verdict": "one or two sentences summarising fit",
 "matched_keywords": ["..."],
 "missing_keywords": ["..."],
 "strengths": ["3-4 strongest selling points for this JD"],
 "gaps": ["each real gap and how to address it honestly"],
 "tips": ["3-5 specific actions before applying"],
 "resume": {
   "name": "", "headline": "role-targeted headline", "contact": "one line: city | phone | email | LinkedIn",
   "summary": "4-5 sentence professional summary aimed at this JD",
   "competencies": [{"label": "group name", "items": "comma separated skills"}],
   "experience": [{"title": "", "company": "", "location": "", "dates": "", "intro": "optional one-line scope", "bullets": ["..."]}],
   "achievements": ["..."],
   "skills": [{"label": "", "items": ""}],
   "education": [{"degree": "", "school": "", "year": "", "detail": ""}],
   "certifications": ["..."],
   "personal": ["Label: value"]
 },
 "cover_letter": {"greeting": "Dear ...,", "paragraphs": ["...", "...", "...", "..."], "closing": "Sincerely,"},
 "email": {"subject": "", "body": "full email including greeting and sign-off with the candidate's name"},
 "intro_30": "", "intro_60": "", "intro_120": ""
}

=== CANDIDATE RESUME ===
${resumeText}

=== JOB DESCRIPTION ===
${jdText}`;
}

function parseJson(text) {
  const t = String(text || '').trim();
  const tries = [t];
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) tries.push(fence[1]);
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) tries.push(t.slice(a, b + 1));
  for (const s of tries) { try { return JSON.parse(s); } catch { /* next */ } }
  throw new Error('The AI answer could not be read. Please press Generate again.');
}

// ---------- providers ----------
// Base URLs can be overridden (used by the automated tests).
const ANTHROPIC = process.env.ANTHROPIC_BASE || 'https://api.anthropic.com/v1';
const GEMINI = process.env.GEMINI_BASE || 'https://generativelanguage.googleapis.com/v1beta';

function err(msg, status) { const e = new Error(msg); if (status) e.status = status; return e; }

async function call(url, opts, timeoutMs, label) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...opts, signal: controller.signal });
    const body = await r.json().catch(() => ({}));
    return { r, body };
  } catch (e) {
    if (e.name === 'AbortError') throw err(`${label} took too long to answer. Please try again.`);
    const code = e.cause?.code;
    if (label === 'Ollama' && (code === 'ECONNREFUSED' || code === 'ENOTFOUND')) throw err('Ollama is not running. Open the Ollama app (or run "ollama serve") and try again.');
    if (code === 'ENOTFOUND' || code === 'ECONNREFUSED' || code === 'ETIMEDOUT' || code === 'EAI_AGAIN') throw err(`Cannot reach ${label}. Check your internet connection and try again.`);
    throw err(`Could not connect to ${label}: ${e.message}`);
  } finally { clearTimeout(timer); }
}

const anthropic = {
  label: 'Claude',
  error(status, body) {
    const msg = body?.error?.message || '';
    if (status === 401) return 'Your Anthropic API key was rejected. Open Settings and paste a valid key.';
    if (status === 403) return 'This API key is not allowed to use the selected model. Choose another model in Settings.';
    if (status === 404) return 'The selected model was not found. Open Settings and press "Test & save" to pick an available model.';
    if (status === 429) return 'Rate limit reached on your Anthropic account. Wait a minute and try again.';
    if (status === 400 && /credit|balance|billing/i.test(msg)) return 'Your Anthropic account has no credit left. Add credit at console.anthropic.com > Billing, or switch to the free Gemini option in Settings.';
    if (status === 529 || status >= 500) return 'Claude is busy right now. Wait a moment and press Generate again.';
    return msg || `Claude returned an error (${status}).`;
  },
  async models({ apiKey }) {
    const { r, body } = await call(`${ANTHROPIC}/models?limit=100`, { headers: { 'x-api-key': apiKey, 'anthropic-version': VERSION } }, 30000, 'Claude');
    if (!r.ok) throw err(this.error(r.status, body));
    return (body.data || []).map(m => ({ id: m.id, name: m.display_name || m.id }));
  },
  pick(models) { return (models.find(m => /sonnet/i.test(m.id)) || models.find(m => /opus/i.test(m.id)) || models[0] || {}).id; },
  async complete({ apiKey, model }, prompt) {
    const { r, body } = await call(`${ANTHROPIC}/messages`, {
      method: 'POST', headers: { 'x-api-key': apiKey, 'anthropic-version': VERSION, 'content-type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: 16000, messages: [{ role: 'user', content: prompt }] }),
    }, 300000, 'Claude');
    if (!r.ok) throw err(this.error(r.status, body));
    if (body.stop_reason === 'max_tokens') throw err('The answer was too long and got cut off. Shorten the resume or JD a little and try again.');
    return (body.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
  },
};

const gemini = {
  label: 'Gemini',
  error(status, body) {
    const msg = body?.error?.message || '';
    const reason = JSON.stringify(body?.error?.details || '') + msg;
    if (/API_KEY_INVALID|API key not valid/i.test(reason) || status === 401) return 'Your Google Gemini API key was rejected. Create a key at aistudio.google.com and paste it in Settings.';
    if (status === 403) return 'This Gemini key is not allowed to use the API. Check the key at aistudio.google.com.';
    if (status === 404) return 'Gemini model not available for this key' + (msg ? ` (Google says: ${msg})` : '') + '. Open Settings, choose another model and press "Test & save".';
    if (status === 429) return 'Gemini free-tier limit reached. Wait a minute (or until tomorrow for the daily limit) and try again.';
    if (status >= 500) return 'Gemini is busy right now. Wait a moment and press Generate again.';
    return msg || `Gemini returned an error (${status}).`;
  },
  async models({ apiKey }) {
    const { r, body } = await call(`${GEMINI}/models?pageSize=200`, { headers: { 'x-goog-api-key': apiKey } }, 30000, 'Gemini');
    if (!r.ok) throw err(this.error(r.status, body));
    return (body.models || [])
      .filter(m => (m.supportedGenerationMethods || []).includes('generateContent') && /gemini/i.test(m.name) && !/(image|tts|audio|live|embed|vision|robotics|computer)/i.test(m.name))
      .map(m => ({ id: m.name.replace(/^models\//, ''), name: m.displayName || m.name }));
  },
  rank(models) {
    const ver = id => parseFloat((id.match(/gemini-(\d+(?:\.\d+)?)/) || [])[1] || 0);
    const score = id => {
      if (id === 'gemini-flash-latest') return 1000;
      let s = ver(id) * 10;
      if (/flash/.test(id)) s += 100;
      if (/lite/.test(id)) s -= 30;
      if (/preview|exp/.test(id)) s -= 50;
      if (/pro/.test(id)) s -= 20;
      return s;
    };
    return [...models].sort((a, b) => score(b.id) - score(a.id)).map(m => m.id);
  },
  pick(models) {
    const ver = id => parseFloat((id.match(/gemini-(\d+(?:\.\d+)?)/) || [])[1] || 0);
    const stable = models.filter(m => /^gemini-[\d.]+-flash$/.test(m.id)).sort((a, b) => ver(b.id) - ver(a.id));
    return (stable[0] || models.find(m => m.id === 'gemini-flash-latest') || models.find(m => /flash/.test(m.id) && !/lite/.test(m.id)) || models.find(m => /flash/.test(m.id)) || models[0] || {}).id;
  },
  // If the saved model is retired or not enabled for this key (404), try the other available models automatically.
  async completeWithFallback(cfg, prompt) {
    try { return { text: await this.complete(cfg, prompt), model: cfg.model }; }
    catch (e) {
      if (e.status !== 404) throw e;
      let lastErr = e;
      const tried = new Set([cfg.model]);
      const candidates = this.rank(await this.models(cfg)).filter(id => !tried.has(id)).slice(0, 5);
      for (const model of candidates) {
        try { const text = await this.complete({ ...cfg, model }, prompt); console.log(`[gemini] ${cfg.model} unavailable, switched to ${model}`); return { text, model }; }
        catch (e2) { lastErr = e2; if (e2.status !== 404) throw e2; }
      }
      throw lastErr;
    }
  },
  async complete({ apiKey, model }, prompt) {
    const { r, body } = await call(`${GEMINI}/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST', headers: { 'x-goog-api-key': apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.4, maxOutputTokens: 32000 } }),
    }, 300000, 'Gemini');
    if (!r.ok) throw err(this.error(r.status, body), r.status);
    const cand = (body.candidates || [])[0];
    if (!cand) throw err('Gemini returned no answer' + (body.promptFeedback?.blockReason ? ` (blocked: ${body.promptFeedback.blockReason})` : '') + '. Please try again.');
    if (cand.finishReason === 'MAX_TOKENS') throw err('The answer was too long and got cut off. Shorten the resume or JD a little and try again.');
    return (cand.content?.parts || []).filter(p => !p.thought).map(p => p.text || '').join('');
  },
};

const ollama = {
  label: 'Ollama',
  base: cfg => String(cfg.url || 'http://localhost:11434').replace(/\/+$/, ''),
  async models(cfg) {
    const { r, body } = await call(`${this.base(cfg)}/api/tags`, {}, 15000, 'Ollama');
    if (!r.ok) throw err(`Ollama returned an error (${r.status}).`);
    const list = (body.models || []).map(m => ({ id: m.name, name: m.name }));
    if (!list.length) throw err('Ollama is running but has no models. In Terminal run: ollama pull llama3.1:8b');
    return list;
  },
  pick(models) {
    const pref = [/qwen2\.5:(14|32)b/, /llama3\.[1-9]/, /qwen/, /gemma/, /mistral/];
    for (const p of pref) { const m = models.find(x => p.test(x.id)); if (m) return m.id; }
    return models[0]?.id;
  },
  async complete(cfg, prompt) {
    const { r, body } = await call(`${this.base(cfg)}/api/chat`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: cfg.model, stream: false, format: 'json', options: { num_ctx: 16384, temperature: 0.4 },
        messages: [{ role: 'user', content: prompt }] }),
    }, 900000, 'Ollama');
    if (!r.ok) throw err(body?.error ? `Ollama: ${body.error}` : `Ollama returned an error (${r.status}).`);
    return body.message?.content || '';
  },
};

const PROVIDERS = { anthropic, gemini, ollama };

async function listModels(provider, cfg) {
  const p = PROVIDERS[provider];
  if (!p) throw err('Unknown AI provider.');
  return p.models(cfg);
}
function pickModel(provider, models) { return PROVIDERS[provider].pick(models); }

// Gemini lists some models that a key cannot actually use. Send a tiny request to find one that works.
// Gemini lists some models a key cannot actually use. Check the best candidates at the same time with a
// tiny request (a few output tokens, short timeout) and keep the highest-ranked one that answers.
async function pingGemini(cfg, model) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetch(`${GEMINI}/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST', signal: ctl.signal, headers: { 'x-goog-api-key': cfg.apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Reply with {"ok":true}' }] }],
        generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 16 } }),
    });
    const body = await r.json().catch(() => ({}));
    return { model, status: r.status, body };
  } catch (e) { return { model, status: e.name === 'AbortError' ? 408 : 0, body: {} }; }
  finally { clearTimeout(t); }
}
async function verifyGemini(cfg, models, preferred) {
  const order = [preferred, ...gemini.rank(models).filter(id => id !== preferred)].filter(Boolean).slice(0, 5);
  const results = await Promise.all(order.map(m => pingGemini(cfg, m)));
  const ok = results.find(r => r.status === 200);
  if (ok) return ok.model;
  const authFail = results.find(r => r.status === 401 || r.status === 403 || /API_KEY_INVALID|API key not valid/i.test(JSON.stringify(r.body)));
  if (authFail) throw err(gemini.error(authFail.status, authFail.body), authFail.status);
  const limited = results.find(r => r.status === 429);
  if (limited) return limited.model; // key and model are fine; only the free-tier minute limit was hit
  const last = results.find(r => r.status) || results[0];
  if (!last || !last.status) throw err('Cannot reach Gemini right now. Check your connection and try again.');
  throw err(gemini.error(last.status, last.body), last.status);
}

async function generate({ provider, cfg, input }) {
  if (provider === 'demo') return mockResult(input);
  const p = PROVIDERS[provider];
  if (!p) throw err('Choose an AI provider in Settings.');
  const prompt = buildPrompt(input);
  const { text, model } = p.completeWithFallback ? await p.completeWithFallback(cfg, prompt) : { text: await p.complete(cfg, prompt), model: cfg.model };
  const result = normalise(parseJson(text));
  Object.defineProperty(result, '_model', { value: model, enumerable: false });
  return result;
}

// Generic JSON call used by the interview features.
async function runJson({ provider, cfg, prompt }) {
  const p = PROVIDERS[provider];
  if (!p) throw err('Choose an AI provider in Settings.');
  const { text, model } = p.completeWithFallback ? await p.completeWithFallback(cfg, prompt) : { text: await p.complete(cfg, prompt), model: cfg.model };
  return { data: parseJson(text), model };
}

const A = v => (Array.isArray(v) ? v.filter(x => x !== null && x !== undefined && x !== '') : []);
function normalise(r) {
  r.resume = r.resume || {};
  const v = r.resume;
  ['competencies', 'experience', 'achievements', 'skills', 'education', 'certifications', 'personal'].forEach(k => { v[k] = A(v[k]); });
  v.experience.forEach(j => { j.bullets = A(j.bullets); });
  ['matched_keywords', 'missing_keywords', 'strengths', 'gaps', 'tips'].forEach(k => { r[k] = A(r[k]); });
  if (typeof r.cover_letter === 'string') r.cover_letter = { greeting: '', paragraphs: r.cover_letter.split(/\n\s*\n/), closing: '' };
  r.cover_letter = r.cover_letter || { paragraphs: [] };
  r.cover_letter.paragraphs = A(r.cover_letter.paragraphs);
  r.email = r.email || { subject: '', body: '' };
  r.match_score = Math.max(0, Math.min(100, Math.round(+r.match_score || 0)));
  r.match_score_after = Math.max(r.match_score, Math.min(100, Math.round(+r.match_score_after || r.match_score)));
  return r;
}

// Demo / test mode: a realistic answer without calling the API.
function mockResult(input) {
  const name = (input.resumeText.split('\n').find(l => l.trim()) || 'Candidate Name').trim();
  return new Promise(res => setTimeout(() => res(normalise({
    role_title: 'Project Manager – Healthcare IT', company: input.company || 'Example Health Systems',
    match_score: 71, match_score_after: 86,
    verdict: 'Strong delivery and client-management fit for an HIS implementation role. The main gap is a formal PM certification.',
    matched_keywords: ['Project Delivery', 'Stakeholder Management', 'Requirement Gathering', 'Gap Analysis', 'BRD', 'UAT', 'Go-Live', 'SLA', 'Change Requests'],
    missing_keywords: ['PMP', 'MS Project', 'Jira', 'Budget Management'],
    strengths: ['Owns full HIS implementation lifecycle', 'Leads five cross-functional teams', 'Direct C-level reporting'],
    gaps: ['No PMP/PRINCE2: mention you are preparing for CAPM/PMP if true', 'Budget ownership not stated: describe effort and commercial approvals you handled'],
    tips: ['Add 2-3 numbers (go-lives, users trained, TAT %)', 'Mirror the JD title in your LinkedIn headline', 'Prepare a 2-minute go-live story using STAR'],
    resume: {
      name, headline: 'Project Manager | Healthcare IT Implementation | Client Delivery',
      contact: '[City], India | [+91 XXXXX XXXXX] | [email@example.com] | [linkedin.com/in/profile]',
      summary: 'Project Manager with 12+ years of experience, including 6+ years in healthcare operations and HIS delivery. Leads end-to-end implementations and 24x7 support for hospital clients across India, UAE and Kuwait. Skilled in requirement and gap analysis, BRDs, UAT, go-live and stakeholder management.',
      competencies: [{ label: 'Project Management', items: 'End-to-End Delivery, Scope & Change Management, Risk Management, Go-Live Planning' }, { label: 'Stakeholder Management', items: 'Client Governance, Executive Reporting, Escalation Management' }],
      experience: [
        { title: '[Project Manager]', company: 'dWise Healthcare IT Solutions Pvt. Ltd.', location: 'India', dates: 'Mar 2022 – Present', intro: 'HIS product company; reports to CEO, COO and CIO.', bullets: ['Lead implementation, enhancement and 24x7 support for 7 healthcare clients across India, UAE and Kuwait.', 'Drive requirement gathering, gap analysis and BRD sign-off with client SPOCs.', 'Coordinate Development, QA and DevOps through UAT, deployment and go-live.'] },
        { title: 'Senior Associate – Emergency Department Operations', company: 'Aster DM Healthcare', location: 'India', dates: 'Jan 2020 – Feb 2022', bullets: ['Managed daily ED operations across operations, clinical and paramedical teams.', 'Coordinated inter-hospital and international air-ambulance transfers.'] },
      ],
      achievements: ['Built a 24x7 multi-shift support function serving 7 clients in 3 countries.'],
      skills: [{ label: 'Tools', items: 'Redmine, MS Excel, MS PowerPoint, AI tools' }],
      education: [{ degree: 'Bachelor of Business Administration (BBA)', school: 'Madurai Kamaraj University', year: '[Year]', detail: 'First Class (60%)' }],
      certifications: [], personal: ['Languages: English, [Others]', 'Notice Period: [30 days]'],
    },
    cover_letter: { greeting: input.manager ? `Dear ${input.manager},` : 'Dear Hiring Manager,', paragraphs: [
      'I am writing to apply for the Project Manager – Healthcare IT role. With over 12 years of experience, including six in healthcare operations and hospital information system delivery, I am confident I can lead your implementations to successful go-lives.',
      'At dWise Healthcare IT Solutions I lead end-to-end HIS implementation and 24x7 support for seven hospital and clinic clients across India, UAE and Kuwait, coordinating Support, Implementation, QA, Development and DevOps teams and reporting directly to the CEO, COO and CIO.',
      'Your focus on client-facing delivery, requirement analysis and UAT matches the work I do every week: running client governance reviews, authoring BRDs, securing effort approvals and planning go-live and hypercare.',
      'I would welcome the opportunity to discuss how I can contribute to your team. Thank you for your time and consideration.'], closing: 'Sincerely,' },
    email: { subject: 'Application for Project Manager – Healthcare IT | ' + name, body: `Dear Hiring Manager,\n\nPlease find attached my resume and cover letter for the Project Manager – Healthcare IT position.\n\nI bring 12+ years of experience, including end-to-end HIS implementation and 24x7 support for seven healthcare clients across India and the GCC.\n\nI would welcome the chance to discuss how I can contribute to your team.\n\nKind regards,\n${name}\n[Phone] | [Email]` },
    intro_30: 'Hi, I am a Project Manager with over 12 years of experience, the last six in healthcare operations and Healthcare IT, leading HIS implementations and 24x7 support for seven hospital clients across three countries.',
    intro_60: 'Thank you for the opportunity. I am a Project Manager with more than 12 years of experience across sales, healthcare operations and Healthcare IT delivery. I currently manage seven healthcare clients, owning the full lifecycle from pre-sales demos to go-live, and I lead a 24x7 support team.',
    intro_120: 'Good morning. I hold a BBA from Madurai Kamaraj University and have over 12 years of experience, moving from client relationship roles at HDFC Life and Maruti Suzuki NEXA into healthcare operations at Aster DM Healthcare and then into Healthcare IT delivery at dWise, where I manage seven clients across India, UAE and Kuwait.',
  })), 900));
}

module.exports = { generate, runJson, listModels, pickModel, verifyGemini, buildPrompt, parseJson };
