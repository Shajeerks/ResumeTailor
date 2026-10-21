// JD Resume Tailor — Express application (used by server.js locally and api/index.js on Vercel)
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const ROOT = path.join(__dirname, '..');
const ENV_PATH = path.join(ROOT, '.env');
require('dotenv').config({ path: ENV_PATH });

// Local runs create their own secret on first start. On Vercel, APP_SECRET must be set as an environment variable.
if (!process.env.APP_SECRET && !process.env.VERCEL) {
  const s = crypto.randomBytes(32).toString('hex');
  try { fs.appendFileSync(ENV_PATH, `\nAPP_SECRET=${s}\n`, { mode: 0o600 }); } catch { /* read-only */ }
  process.env.APP_SECRET = s;
}

const express = require('express');
const multer = require('multer');
const { extractText } = require('./parse');
const ai = require('./ai');
const docs = require('./docx');
const interview = require('./interview');
const jobs = require('./jobs');
const auth = require('./auth');
const { createStore, publicUser } = require('./store');

const store = createStore(ROOT);
const app = express();
app.set('trust proxy', true);
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(ROOT, 'public')));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 4 * 1024 * 1024 } });

const asyncRoute = fn => (req, res, next) => fn(req, res, next).catch(e => {
  if (!e.status || e.status >= 500) console.error('[error]', e.message);
  res.status(e.status || 400).json({ error: e.message || 'Something went wrong.', field: e.field });
});
const fail = (msg, status = 400) => { const e = new Error(msg); e.status = status; return e; };

// =====================================================================
// Accounts
// =====================================================================
app.get('/api/health', (req, res) => res.json({ ok: true, storage: store.kind }));

app.post('/api/auth/signup', asyncRoute(async (req, res) => {
  const b = req.body || {};
  const name = auth.cleanName(b.name), email = auth.cleanEmail(b.email), mobile = auth.cleanMobile(b.mobile), password = auth.cleanPassword(b.password);
  if (await store.findUserByEmail(email)) throw Object.assign(fail('An account with this email already exists. Sign in instead.', 409), { field: 'email' });
  if (await store.findUserByMobile(mobile)) throw Object.assign(fail('An account with this mobile number already exists. Sign in instead.', 409), { field: 'mobile' });
  const user = await store.createUser({ name, email, mobile, passwordHash: await auth.hashPassword(password), ai: importLocalKeys() });
  auth.setSession(req, res, user);
  res.json({ user: publicUser(user) });
}));

// The first account on a computer inherits the keys that were saved in .env before sign-in existed.
let imported = false;
function importLocalKeys() {
  if (imported || store.kind !== 'local' || process.env.VERCEL) return {};
  const usersFile = path.join(ROOT, 'data', 'users.json');
  if (fs.existsSync(usersFile) && JSON.parse(fs.readFileSync(usersFile, 'utf8') || '[]').length) return {};
  imported = true;
  const e = process.env, out = {};
  if (e.GEMINI_API_KEY) out.gemini = { key: auth.encrypt(e.GEMINI_API_KEY), model: e.GEMINI_MODEL || '' };
  if (e.ANTHROPIC_API_KEY) out.anthropic = { key: auth.encrypt(e.ANTHROPIC_API_KEY), model: e.CLAUDE_MODEL || '' };
  if (e.OLLAMA_MODEL) out.ollama = { url: e.OLLAMA_URL || 'http://localhost:11434', model: e.OLLAMA_MODEL };
  if (['gemini', 'anthropic', 'ollama'].includes(e.AI_PROVIDER) && out[e.AI_PROVIDER]) out.provider = e.AI_PROVIDER;
  return out;
}

app.post('/api/auth/signin', asyncRoute(async (req, res) => {
  const login = String(req.body?.login || '').trim(), password = String(req.body?.password || '');
  if (!login || !password) throw fail('Enter your email or mobile number and your password.');
  const rateKey = (req.ip || '') + '|' + login.toLowerCase();
  auth.checkRate(rateKey);
  let user = null;
  if (auth.isEmail(login)) user = await store.findUserByEmail(login.toLowerCase());
  else { let m; try { m = auth.cleanMobile(login); } catch { m = null; } if (m) user = await store.findUserByMobile(m); }
  if (!user || !(await auth.verifyPassword(password, user.passwordHash))) throw fail('Email/mobile or password is incorrect.', 401);
  auth.clearRate(rateKey);
  auth.setSession(req, res, user);
  res.json({ user: publicUser(user) });
}));

app.post('/api/auth/signout', (req, res) => { auth.clearSession(req, res); res.json({ ok: true }); });

// Every other /api route needs a signed-in user.
app.use('/api', asyncRoute(async (req, res, next) => {
  const s = auth.readSession(req);
  const user = s && await store.getUser(s.uid);
  if (!user || (user.sessionVersion || 0) !== (s.v || 0)) { auth.clearSession(req, res); throw fail('Please sign in to continue.', 401); }
  req.user = user;
  next();
}));

app.get('/api/me', (req, res) => res.json({ user: publicUser(req.user), hosted: !!process.env.VERCEL }));

app.put('/api/me', asyncRoute(async (req, res) => {
  const b = req.body || {};
  const patch = { name: auth.cleanName(b.name), email: auth.cleanEmail(b.email), mobile: auth.cleanMobile(b.mobile) };
  if (patch.email !== req.user.email) { const o = await store.findUserByEmail(patch.email); if (o && o.id !== req.user.id) throw Object.assign(fail('Another account already uses this email.', 409), { field: 'email' }); }
  if (patch.mobile !== req.user.mobile) { const o = await store.findUserByMobile(patch.mobile); if (o && o.id !== req.user.id) throw Object.assign(fail('Another account already uses this mobile number.', 409), { field: 'mobile' }); }
  res.json({ user: publicUser(await store.updateUser(req.user.id, patch)) });
}));

app.put('/api/me/password', asyncRoute(async (req, res) => {
  if (!(await auth.verifyPassword(req.body?.current, req.user.passwordHash))) throw Object.assign(fail('Current password is incorrect.'), { field: 'current' });
  const p = auth.cleanPassword(req.body?.password);
  // Bumping the session version signs out every other device.
  const user = await store.updateUser(req.user.id, { passwordHash: await auth.hashPassword(p), sessionVersion: (req.user.sessionVersion || 0) + 1 });
  auth.setSession(req, res, user);
  res.json({ ok: true });
}));

app.delete('/api/me', asyncRoute(async (req, res) => {
  if (!(await auth.verifyPassword(req.body?.password, req.user.passwordHash))) throw Object.assign(fail('Password is incorrect.'), { field: 'password' });
  await store.deleteUser(req.user.id);
  auth.clearSession(req, res);
  res.json({ ok: true });
}));

// =====================================================================
// AI settings (per user; keys encrypted at rest)
// =====================================================================
const PROVIDER_IDS = ['demo', 'gemini', 'anthropic', 'ollama'];
const allowedProviders = () => (process.env.VERCEL ? ['demo', 'gemini', 'anthropic'] : PROVIDER_IDS);
function config(user) {
  const s = user.ai || {};
  let provider = process.env.MOCK_AI === '1' ? 'demo' : (s.provider || 'demo');
  if (!allowedProviders().includes(provider)) provider = 'demo';
  const all = {
    anthropic: { apiKey: auth.decrypt(s.anthropic?.key), model: s.anthropic?.model || '' },
    gemini: { apiKey: auth.decrypt(s.gemini?.key), model: s.gemini?.model || '' },
    ollama: { url: s.ollama?.url || 'http://localhost:11434', model: s.ollama?.model || '' },
    demo: {},
  };
  const cfg = all[provider];
  const ready = provider === 'demo' || (provider === 'ollama' ? !!cfg.model : !!(cfg.apiKey && cfg.model));
  return { provider, cfg, all, ready, forcedDemo: process.env.MOCK_AI === '1' };
}
const hint = k => (k ? k.slice(0, 8) + '…' + k.slice(-4) : '');
async function saveAi(user, patch) {
  const ai2 = { ...(user.ai || {}), ...patch };
  const u = await store.updateUser(user.id, { ai: ai2 });
  user.ai = u.ai; return u;
}

app.get('/api/status', (req, res) => {
  const c = config(req.user);
  const js = req.user.ai?.jobsearch;
  res.json({
    jobsearch: js?.provider && js[js.provider]?.key ? { provider: js.provider, keyHint: hint(auth.decrypt(js[js.provider].key)), model: js[js.provider].model } : null,
    provider: c.provider, configured: c.ready, forcedDemo: c.forcedDemo, model: c.cfg.model || '', providersAllowed: allowedProviders(),
    providers: {
      anthropic: { keyHint: hint(c.all.anthropic.apiKey), model: c.all.anthropic.model },
      gemini: { keyHint: hint(c.all.gemini.apiKey), model: c.all.gemini.model },
      ollama: { url: c.all.ollama.url, model: c.all.ollama.model },
    },
  });
});

app.post('/api/settings', asyncRoute(async (req, res) => {
  const provider = String(req.body.provider || '');
  if (!allowedProviders().includes(provider)) throw fail('Choose an AI provider.');
  if (provider === 'demo') { await saveAi(req.user, { provider: 'demo' }); return res.json({ ok: true, provider, model: '', models: [] }); }
  const current = config(req.user).all[provider];
  const cfg = { ...current };
  if (provider === 'ollama') {
    cfg.url = String(req.body.url || '').trim() || current.url;
  } else {
    cfg.apiKey = String(req.body.apiKey || '').trim() || current.apiKey;
    if (!cfg.apiKey) throw fail('Paste your API key first.');
    if (provider === 'anthropic' && !/^sk-ant-/.test(cfg.apiKey)) throw fail('That does not look like an Anthropic API key. It should start with "sk-ant-".');
    if (provider === 'gemini' && !/^(AIza[\w-]{20,}|AQ\.[\w.-]{20,})$/.test(cfg.apiKey)) throw fail('That does not look like a Google Gemini API key. It should start with "AIza" or "AQ.".');
  }
  const models = await ai.listModels(provider, cfg);
  if (!models.length) throw fail('The connection works, but no usable models were found on this account.');
  let model = String(req.body.model || '').trim();
  if (!model || !models.some(m => m.id === model)) model = ai.pickModel(provider, models);
  if (provider === 'gemini') model = await ai.verifyGemini(cfg, models, model);
  const entry = provider === 'ollama' ? { url: cfg.url, model } : { key: auth.encrypt(cfg.apiKey), model };
  await saveAi(req.user, { provider, [provider]: entry });
  res.json({ ok: true, provider, model, models });
}));

// Optional separate key used only by the Job finder (e.g. a Gemini key with billing turned on).
app.post('/api/settings/jobsearch', asyncRoute(async (req, res) => {
  const provider = String(req.body.provider || '');
  if (!['gemini', 'anthropic'].includes(provider)) throw fail('Choose Google Gemini or Anthropic Claude for job search.');
  const existing = req.user.ai?.jobsearch;
  const apiKey = String(req.body.apiKey || '').trim() || (existing?.provider === provider ? auth.decrypt(existing[provider]?.key) : '');
  if (!apiKey) throw fail('Paste the API key for job search.');
  if (provider === 'anthropic' && !/^sk-ant-/.test(apiKey)) throw fail('That does not look like an Anthropic API key. It should start with "sk-ant-".');
  if (provider === 'gemini' && !/^(AIza[\w-]{20,}|AQ\.[\w.-]{20,})$/.test(apiKey)) throw fail('That does not look like a Google Gemini API key. It should start with "AIza" or "AQ.".');
  const cfg = { apiKey };
  const models = await ai.listModels(provider, cfg);
  if (!models.length) throw fail('The key works, but no usable models were found.');
  let model = ai.pickModel(provider, models);
  if (provider === 'gemini') model = await ai.verifyGemini(cfg, models, model);
  await saveAi(req.user, { jobsearch: { provider, [provider]: { key: auth.encrypt(apiKey), model } } });
  res.json({ ok: true, provider, model, keyHint: hint(apiKey) });
}));
app.delete('/api/settings/jobsearch', asyncRoute(async (req, res) => { await saveAi(req.user, { jobsearch: null }); res.json({ ok: true }); }));

app.get('/api/models', asyncRoute(async (req, res) => {
  const c = config(req.user);
  const provider = String(req.query.provider || c.provider);
  const cfg = c.all[provider];
  if (!cfg || provider === 'demo') return res.json({ models: [], model: '' });
  if (provider !== 'ollama' && !cfg.apiKey) return res.json({ models: [], model: cfg.model });
  res.json({ models: await ai.listModels(provider, cfg), model: cfg.model });
}));

function aiReady(user) {
  const c = config(user);
  if (!c.ready) throw fail('Finish the AI setup in AI settings first.', 412);
  return c;
}
async function rememberModel(user, c, used) {
  if (c.provider === 'gemini' && used && used !== c.cfg.model) await saveAi(user, { gemini: { ...(user.ai.gemini || {}), model: used } });
}

// =====================================================================
// Applications
// =====================================================================
app.post('/api/parse', (req, res, next) => upload.single('file')(req, res, e => {
  if (e) return res.status(400).json({ error: e.code === 'LIMIT_FILE_SIZE' ? 'That file is larger than 4 MB. Save a smaller PDF or paste the text.' : e.message });
  next();
}), asyncRoute(async (req, res) => {
  if (!req.file) throw fail('No file received. Choose a .docx, .pdf or .txt file.');
  const text = await extractText(req.file);
  res.json({ text, chars: text.length, fileName: req.file.originalname });
}));

app.post('/api/generate', asyncRoute(async (req, res) => {
  const b = req.body || {};
  const input = {
    resumeText: String(b.resumeText || '').trim().slice(0, 40000),
    jdText: String(b.jdText || '').trim().slice(0, 30000),
    company: String(b.company || '').trim().slice(0, 120),
    manager: String(b.manager || '').trim().slice(0, 120),
    extra: String(b.extra || '').trim().slice(0, 500),
    region: ['india', 'gcc', 'global'].includes(b.region) ? b.region : 'india',
    tone: ['professional', 'confident', 'warm'].includes(b.tone) ? b.tone : 'professional',
  };
  if (input.resumeText.length < 150) throw fail('Add the resume first: upload a file or paste the text.');
  input.links = jf(req.user).profile?.links || {};
  if (input.jdText.length < 100) throw fail('Paste the full job description (responsibilities and requirements).');
  const c = aiReady(req.user);
  const started = Date.now();
  const result = await ai.generate({ provider: c.provider, cfg: c.cfg, input });
  const usedModel = result._model || c.cfg.model;
  await rememberModel(req.user, c, usedModel);
  const id = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14) + '-' + crypto.randomBytes(3).toString('hex');
  const record = {
    id, createdAt: new Date().toISOString(), provider: c.provider, model: c.provider === 'demo' ? 'demo' : usedModel, seconds: Math.round((Date.now() - started) / 1000),
    candidate: result.resume?.name || '', role: result.role_title || '', company: result.company || '',
    score: result.match_score, scoreAfter: result.match_score_after, input, result,
  };
  await store.saveApp(req.user.id, record);
  res.json(record);
}));

app.get('/api/history', asyncRoute(async (req, res) => res.json({ items: await store.listApps(req.user.id) })));
app.get('/api/history/:id', asyncRoute(async (req, res) => res.json(await store.getApp(req.user.id, req.params.id))));
app.delete('/api/history/:id', asyncRoute(async (req, res) => { await store.deleteApp(req.user.id, req.params.id); res.json({ ok: true }); }));

// =====================================================================
// Interview preparation
// =====================================================================
const sid = () => new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14) + crypto.randomBytes(2).toString('hex');

app.post('/api/history/:id/qa', asyncRoute(async (req, res) => {
  const rec = await store.getApp(req.user.id, req.params.id), c = aiReady(req.user);
  rec.qa = await interview.generateQA({ provider: c.provider, cfg: c.cfg, rec });
  await store.saveApp(req.user.id, rec);
  res.json(rec.qa);
}));

app.put('/api/history/:id/qa/:index', asyncRoute(async (req, res) => {
  const rec = await store.getApp(req.user.id, req.params.id), i = parseInt(req.params.index, 10);
  if (!rec.qa?.questions?.[i]) throw fail('Question not found.');
  rec.qa.questions[i].prepared = !!req.body.prepared;
  await store.saveApp(req.user.id, rec);
  res.json({ ok: true });
}));

app.post('/api/history/:id/interview/turn', asyncRoute(async (req, res) => {
  const rec = await store.getApp(req.user.id, req.params.id), c = aiReady(req.user);
  res.json(await interview.interviewerTurn({ provider: c.provider, cfg: c.cfg, rec, settings: req.body.settings, transcript: req.body.transcript }));
}));

app.post('/api/history/:id/interview/evaluate', asyncRoute(async (req, res) => {
  const rec = await store.getApp(req.user.id, req.params.id), c = aiReady(req.user);
  const out = await interview.evaluate({ provider: c.provider, cfg: c.cfg, rec, settings: req.body.settings, transcript: req.body.transcript, durationSec: req.body.durationSec });
  const session = { id: sid(), createdAt: new Date().toISOString(), provider: c.provider, model: c.provider === 'demo' ? 'demo' : c.cfg.model, ...out, audio: null };
  rec.practice = [...(rec.practice || []), session];
  await store.saveApp(req.user.id, rec);
  const ext = /mp4|m4a|aac/.test(req.body.audioType || '') ? 'm4a' : /ogg/.test(req.body.audioType || '') ? 'ogg' : 'webm';
  if (req.body.audioType) session.upload = await store.audioUploadTarget(req.user.id, rec.id, session.id, ext).catch(() => null);
  res.json(session);
}));

const findSession = (rec, id) => {
  const s = (rec.practice || []).find(p => p.id === id);
  if (!s) throw fail('Practice session not found.', 404);
  return s;
};
// Local mode: the audio file comes through this server.
app.post('/api/history/:id/practice/:sid/audio', express.raw({ type: () => true, limit: '200mb' }), asyncRoute(async (req, res) => {
  if (store.kind !== 'local') throw fail('Upload audio with the signed upload link.');
  const rec = await store.getApp(req.user.id, req.params.id), s = findSession(rec, req.params.sid);
  if (!req.body || !req.body.length) throw fail('No audio received.');
  const ext = /mp4|m4a|aac/.test(req.headers['content-type'] || '') ? 'm4a' : /ogg/.test(req.headers['content-type'] || '') ? 'ogg' : 'webm';
  s.audio = await store.putAudio(`${rec.id}_${s.id}.${ext}`, req.body);
  await store.saveApp(req.user.id, rec);
  res.json({ ok: true, file: s.audio });
}));
// Hosted mode: the browser uploaded to storage directly; record where it went.
app.put('/api/history/:id/practice/:sid/audio', asyncRoute(async (req, res) => {
  const rec = await store.getApp(req.user.id, req.params.id), s = findSession(rec, req.params.sid);
  const key = String(req.body?.key || '');
  if (!key.startsWith(req.user.id + '/' + rec.id + '_' + s.id)) throw fail('Invalid recording reference.');
  s.audio = key;
  await store.saveApp(req.user.id, rec);
  res.json({ ok: true });
}));
app.get('/api/history/:id/practice/:sid/audio', asyncRoute(async (req, res) => {
  const rec = await store.getApp(req.user.id, req.params.id), s = findSession(rec, req.params.sid);
  if (!s.audio) throw fail('No recording for this session.', 404);
  const r = await store.audioRead(s.audio);
  if (r.url) return res.redirect(302, r.url + (req.query.download ? '&download=' + encodeURIComponent(`Mock_Interview_${s.id}.${s.audio.split('.').pop()}`) : ''));
  if (req.query.download) res.setHeader('Content-Disposition', `attachment; filename="Mock_Interview_${s.id}.${s.audio.split('.').pop()}"`);
  res.sendFile(r.file);
}));
app.delete('/api/history/:id/practice/:sid', asyncRoute(async (req, res) => {
  const rec = await store.getApp(req.user.id, req.params.id), s = findSession(rec, req.params.sid);
  if (s.audio) await store.deleteAudio(s.audio);
  rec.practice = rec.practice.filter(p => p.id !== s.id);
  await store.saveApp(req.user.id, rec);
  res.json({ ok: true });
}));


// =====================================================================
// Job finder (profile links, base resume, preferences, web search, saved jobs)
// =====================================================================
const jf = user => ({ profile: null, saved: [], last: null, ...(user.ai?.jobfinder || {}) });
async function saveJf(user, patch) { await saveAi(user, { jobfinder: { ...jf(user), ...patch } }); }

app.get('/api/jobs', (req, res) => {
  const j = jf(req.user);
  res.json({ profile: j.profile, saved: j.saved, last: j.last, portals: j.profile ? jobs.portalLinks(j.profile, j.last?.keywords) : [] });
});

app.put('/api/jobs/profile', asyncRoute(async (req, res) => {
  const profile = jobs.cleanProfile(req.body || {});
  await saveJf(req.user, { profile });
  res.json({ profile, portals: jobs.portalLinks(profile, jf(req.user).last?.keywords) });
}));

app.post('/api/jobs/search', asyncRoute(async (req, res) => {
  const j = jf(req.user);
  if (!j.profile) throw fail('Save your job profile first.');
  const js = req.user.ai?.jobsearch;
  const sep = js?.provider && js[js.provider]?.key ? { provider: js.provider, cfg: { apiKey: auth.decrypt(js[js.provider].key), model: js[js.provider].model } } : null;
  const c = sep || aiReady(req.user);
  const result = await jobs.search({ provider: c.provider, cfg: c.cfg, profile: j.profile, separate: !!sep });
  if (sep && sep.provider === 'gemini' && result.model && result.model !== sep.cfg.model) await saveAi(req.user, { jobsearch: { ...js, gemini: { ...js.gemini, model: result.model } } });
  await saveJf(req.user, { last: result });
  res.json(result);
}));

app.post('/api/jobs/saved', asyncRoute(async (req, res) => {
  const j = jf(req.user);
  const item = jobs.cleanSaved(req.body || {});
  if (!item.title) throw fail('Missing job title.');
  if (j.saved.some(s => s.id === item.id || (s.title === item.title && s.company === item.company))) throw fail('This job is already in your saved list.', 409);
  const saved = [item, ...j.saved].slice(0, 200);
  await saveJf(req.user, { saved });
  res.json({ saved });
}));

app.put('/api/jobs/saved/:id', asyncRoute(async (req, res) => {
  const j = jf(req.user);
  const i = j.saved.findIndex(s => s.id === req.params.id);
  if (i < 0) throw fail('Saved job not found.', 404);
  const b = req.body || {};
  const next = jobs.cleanSaved({ ...j.saved[i], ...(b.status ? { status: b.status } : {}), ...(b.notes !== undefined ? { notes: b.notes } : {}), ...(b.appId ? { appId: b.appId } : {}) });
  const saved = [...j.saved]; saved[i] = next;
  await saveJf(req.user, { saved });
  res.json({ saved });
}));

app.delete('/api/jobs/saved/:id', asyncRoute(async (req, res) => {
  const saved = jf(req.user).saved.filter(s => s.id !== req.params.id);
  await saveJf(req.user, { saved });
  res.json({ saved });
}));

// =====================================================================
// Downloads
// =====================================================================
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
app.get('/api/download/:id/qa', asyncRoute(async (req, res) => {
  const rec = await store.getApp(req.user.id, req.params.id);
  if (!rec.qa) throw fail('Generate the interview questions first.');
  res.setHeader('Content-Type', DOCX);
  res.setHeader('Content-Disposition', `attachment; filename="${docs.fileName(rec.result, 'resume').replace('_Resume', '_Interview_QA')}"`);
  res.send(await docs.buildQaDocx(rec.result, rec.qa));
}));
app.get('/api/download/:id/practice/:sid', asyncRoute(async (req, res) => {
  const rec = await store.getApp(req.user.id, req.params.id), s = findSession(rec, req.params.sid);
  res.setHeader('Content-Type', DOCX);
  res.setHeader('Content-Disposition', `attachment; filename="${docs.fileName(rec.result, 'resume').replace('_Resume', '_Mock_Interview_' + s.id.slice(0, 8))}"`);
  res.send(await docs.buildPracticeDocx(rec.result, s));
}));
app.get('/api/download/:id/:kind', asyncRoute(async (req, res) => {
  const rec = await store.getApp(req.user.id, req.params.id), r = rec.result, kind = req.params.kind;
  let buf, name, type;
  if (kind === 'all') {
    buf = await docs.buildZip(r, rec.qa);
    name = docs.fileName(r, 'resume').replace(/_Resume/, '_Application_Pack').replace(/\.docx$/, '.zip');
    type = 'application/zip';
  } else {
    if (!docs.KINDS.includes(kind)) throw fail('Unknown document type.');
    buf = await docs.buildDocx(r, kind); name = docs.fileName(r, kind); type = DOCX;
  }
  res.setHeader('Content-Type', type);
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.send(buf);
}));

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

app.storeKind = store.kind;
module.exports = app;
