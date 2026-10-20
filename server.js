// JD Resume Tailor — local web app server
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const ENV_PATH = path.join(__dirname, '.env');
require('dotenv').config({ path: ENV_PATH });

const express = require('express');
const multer = require('multer');
const { extractText } = require('./lib/parse');
const ai = require('./lib/ai');
const docs = require('./lib/docx');
const interview = require('./lib/interview');

const PORT = Number(process.env.PORT) || 3020;
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = process.env.VERCEL ? path.join(os.tmpdir(), 'resume-tailor') : path.join(__dirname, 'data');
const HISTORY_DIR = path.join(DATA_DIR, 'history');
fs.mkdirSync(HISTORY_DIR, { recursive: true });
const AUDIO_DIR = path.join(DATA_DIR, 'audio');
fs.mkdirSync(AUDIO_DIR, { recursive: true });

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const PROVIDER_IDS = ['demo', 'gemini', 'anthropic', 'ollama'];
function config() {
  const env = process.env;
  let provider = env.MOCK_AI === '1' ? 'demo' : (env.AI_PROVIDER || (env.ANTHROPIC_API_KEY ? 'anthropic' : 'demo'));
  if (!PROVIDER_IDS.includes(provider)) provider = 'demo';
  const all = {
    anthropic: { apiKey: env.ANTHROPIC_API_KEY || '', model: env.CLAUDE_MODEL || '' },
    gemini: { apiKey: env.GEMINI_API_KEY || '', model: env.GEMINI_MODEL || '' },
    ollama: { url: env.OLLAMA_URL || 'http://localhost:11434', model: env.OLLAMA_MODEL || '' },
    demo: {},
  };
  const cfg = all[provider];
  const ready = provider === 'demo' || (provider === 'ollama' ? !!cfg.model : !!(cfg.apiKey && cfg.model));
  return { provider, cfg, all, ready, forcedDemo: env.MOCK_AI === '1' };
}
const hint = k => (k ? k.slice(0, 8) + '…' + k.slice(-4) : '');
const ENV_KEYS = {
  anthropic: { apiKey: 'ANTHROPIC_API_KEY', model: 'CLAUDE_MODEL' },
  gemini: { apiKey: 'GEMINI_API_KEY', model: 'GEMINI_MODEL' },
  ollama: { url: 'OLLAMA_URL', model: 'OLLAMA_MODEL' },
};

function saveEnv(updates) {
  const current = {};
  if (fs.existsSync(ENV_PATH)) {
    fs.readFileSync(ENV_PATH, 'utf8').split('\n').forEach(l => {
      const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*)$/); if (m) current[m[1]] = m[2];
    });
  }
  Object.assign(current, updates);
  Object.entries(updates).forEach(([k, v]) => { process.env[k] = v; });
  fs.writeFileSync(ENV_PATH, Object.entries(current).map(([k, v]) => `${k}=${v}`).join('\n') + '\n', { mode: 0o600 });
}

const asyncRoute = fn => (req, res) => fn(req, res).catch(e => {
  console.error('[error]', e.message);
  res.status(e.status || 400).json({ error: e.message || 'Something went wrong.' });
});

// ---------- settings ----------
app.get('/api/status', (req, res) => {
  const c = config();
  res.json({
    provider: c.provider, configured: c.ready, forcedDemo: c.forcedDemo, model: c.cfg.model || '',
    providers: {
      anthropic: { keyHint: hint(c.all.anthropic.apiKey), model: c.all.anthropic.model },
      gemini: { keyHint: hint(c.all.gemini.apiKey), model: c.all.gemini.model },
      ollama: { url: c.all.ollama.url, model: c.all.ollama.model },
    },
  });
});

// Test the connection, pick a model and save everything to .env
app.post('/api/settings', asyncRoute(async (req, res) => {
  const provider = String(req.body.provider || '');
  if (!PROVIDER_IDS.includes(provider)) throw new Error('Choose an AI provider.');
  if (provider === 'demo') { saveEnv({ AI_PROVIDER: 'demo' }); return res.json({ ok: true, provider, model: '', models: [] }); }
  const current = config().all[provider];
  const cfg = { ...current };
  if (provider === 'ollama') {
    cfg.url = String(req.body.url || '').trim() || current.url;
  } else {
    cfg.apiKey = String(req.body.apiKey || '').trim() || current.apiKey;
    if (!cfg.apiKey) throw new Error('Paste your API key first.');
    if (provider === 'anthropic' && !/^sk-ant-/.test(cfg.apiKey)) throw new Error('That does not look like an Anthropic API key. It should start with "sk-ant-".');
    if (provider === 'gemini' && !/^(AIza[\w-]{20,}|AQ\.[\w.-]{20,})$/.test(cfg.apiKey)) throw new Error('That does not look like a Google Gemini API key. It should start with "AIza" or "AQ.".');
  }
  const models = await ai.listModels(provider, cfg);
  if (!models.length) throw new Error('The connection works, but no usable models were found on this account.');
  let model = String(req.body.model || '').trim();
  if (!model || !models.some(m => m.id === model)) model = ai.pickModel(provider, models);
  if (provider === 'gemini') model = await ai.verifyGemini(cfg, models, model);
  const keys = ENV_KEYS[provider], updates = { AI_PROVIDER: provider, [keys.model]: model };
  if (keys.apiKey) updates[keys.apiKey] = cfg.apiKey;
  if (keys.url) updates[keys.url] = cfg.url;
  saveEnv(updates);
  res.json({ ok: true, provider, model, models });
}));

app.get('/api/models', asyncRoute(async (req, res) => {
  const provider = String(req.query.provider || config().provider);
  const cfg = config().all[provider];
  if (!cfg || provider === 'demo') return res.json({ models: [], model: '' });
  if (provider !== 'ollama' && !cfg.apiKey) return res.json({ models: [], model: cfg.model });
  res.json({ models: await ai.listModels(provider, cfg), model: cfg.model });
}));

// ---------- resume parsing ----------
app.post('/api/parse', upload.single('file'), asyncRoute(async (req, res) => {
  if (!req.file) throw new Error('No file received. Choose a .docx, .pdf or .txt file.');
  const text = await extractText(req.file);
  res.json({ text, chars: text.length, fileName: req.file.originalname });
}));

// ---------- generation ----------
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
  if (input.resumeText.length < 150) throw new Error('Add the resume first: upload a file or paste the text.');
  if (input.jdText.length < 100) throw new Error('Paste the full job description (responsibilities and requirements).');
  const c = config();
  if (!c.ready) { const e = new Error('Finish the AI setup in Settings before generating.'); e.status = 412; throw e; }

  const started = Date.now();
  const result = await ai.generate({ provider: c.provider, cfg: c.cfg, input });
  const usedModel = result._model || c.cfg.model;
  if (c.provider === 'gemini' && usedModel && usedModel !== c.cfg.model) saveEnv({ GEMINI_MODEL: usedModel });
  const id = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14) + '-' + crypto.randomBytes(3).toString('hex');
  const record = {
    id, createdAt: new Date().toISOString(), provider: c.provider, model: c.provider === 'demo' ? 'demo' : usedModel, seconds: Math.round((Date.now() - started) / 1000),
    candidate: result.resume?.name || '', role: result.role_title || '', company: result.company || '',
    score: result.match_score, scoreAfter: result.match_score_after, input, result,
  };
  fs.writeFileSync(path.join(HISTORY_DIR, id + '.json'), JSON.stringify(record, null, 2));
  res.json(record);
}));

// ---------- history ----------
const recordPath = id => {
  if (!/^[\w-]+$/.test(id)) { const e = new Error('Not found.'); e.status = 404; throw e; }
  const p = path.join(HISTORY_DIR, id + '.json');
  if (!fs.existsSync(p)) { const e = new Error('This application was not found. It may have been deleted.'); e.status = 404; throw e; }
  return p;
};
const loadRecord = id => JSON.parse(fs.readFileSync(recordPath(id), 'utf8'));

app.get('/api/history', asyncRoute(async (req, res) => {
  const items = fs.readdirSync(HISTORY_DIR).filter(f => f.endsWith('.json')).map(f => {
    try { const r = JSON.parse(fs.readFileSync(path.join(HISTORY_DIR, f), 'utf8'));
      const p = r.practice || []; return { id: r.id, createdAt: r.createdAt, candidate: r.candidate, role: r.role, company: r.company, score: r.score, scoreAfter: r.scoreAfter, sessions: p.length, bestInterview: p.length ? Math.max(...p.map(x => x.report?.overall_score || 0)) : null };
    } catch { return null; }
  }).filter(Boolean).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json({ items });
}));
app.get('/api/history/:id', asyncRoute(async (req, res) => res.json(loadRecord(req.params.id))));
app.delete('/api/history/:id', asyncRoute(async (req, res) => {
  fs.unlinkSync(recordPath(req.params.id));
  fs.readdirSync(AUDIO_DIR).filter(f => f.startsWith(req.params.id + '_')).forEach(f => fs.unlinkSync(path.join(AUDIO_DIR, f)));
  res.json({ ok: true });
}));

// ---------- interview preparation ----------
const saveRecord = rec => fs.writeFileSync(recordPath(rec.id), JSON.stringify(rec, null, 2));
function aiReady() {
  const c = config();
  if (!c.ready) { const e = new Error('Finish the AI setup in Settings first.'); e.status = 412; throw e; }
  return c;
}
const sid = () => new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14) + crypto.randomBytes(2).toString('hex');

app.post('/api/history/:id/qa', asyncRoute(async (req, res) => {
  const rec = loadRecord(req.params.id), c = aiReady();
  const qa = await interview.generateQA({ provider: c.provider, cfg: c.cfg, rec });
  rec.qa = qa; saveRecord(rec);
  res.json(qa);
}));

app.put('/api/history/:id/qa/:index', asyncRoute(async (req, res) => {
  const rec = loadRecord(req.params.id), i = parseInt(req.params.index, 10);
  if (!rec.qa?.questions?.[i]) throw new Error('Question not found.');
  rec.qa.questions[i].prepared = !!req.body.prepared; saveRecord(rec);
  res.json({ ok: true });
}));

app.post('/api/history/:id/interview/turn', asyncRoute(async (req, res) => {
  const rec = loadRecord(req.params.id), c = aiReady();
  res.json(await interview.interviewerTurn({ provider: c.provider, cfg: c.cfg, rec, settings: req.body.settings, transcript: req.body.transcript }));
}));

app.post('/api/history/:id/interview/evaluate', asyncRoute(async (req, res) => {
  const rec = loadRecord(req.params.id), c = aiReady();
  const out = await interview.evaluate({ provider: c.provider, cfg: c.cfg, rec, settings: req.body.settings, transcript: req.body.transcript, durationSec: req.body.durationSec });
  const session = { id: sid(), createdAt: new Date().toISOString(), provider: c.provider, model: c.provider === 'demo' ? 'demo' : c.cfg.model, ...out, audio: null };
  rec.practice = [...(rec.practice || []), session]; saveRecord(rec);
  res.json(session);
}));

const findSession = (rec, id) => {
  const s = (rec.practice || []).find(p => p.id === id);
  if (!s) { const e = new Error('Practice session not found.'); e.status = 404; throw e; }
  return s;
};
app.post('/api/history/:id/practice/:sid/audio', express.raw({ type: () => true, limit: '300mb' }), asyncRoute(async (req, res) => {
  const rec = loadRecord(req.params.id), s = findSession(rec, req.params.sid);
  if (!req.body || !req.body.length) throw new Error('No audio received.');
  const ext = /mp4|m4a|aac/.test(req.headers['content-type'] || '') ? 'm4a' : /ogg/.test(req.headers['content-type'] || '') ? 'ogg' : 'webm';
  const file = `${rec.id}_${s.id}.${ext}`;
  fs.writeFileSync(path.join(AUDIO_DIR, file), req.body);
  s.audio = file; saveRecord(rec);
  res.json({ ok: true, file });
}));
app.get('/api/history/:id/practice/:sid/audio', asyncRoute(async (req, res) => {
  const rec = loadRecord(req.params.id), s = findSession(rec, req.params.sid);
  if (!s.audio || !fs.existsSync(path.join(AUDIO_DIR, s.audio))) { const e = new Error('No recording for this session.'); e.status = 404; throw e; }
  if (req.query.download) res.setHeader('Content-Disposition', `attachment; filename="Mock_Interview_${s.id}.${s.audio.split('.').pop()}"`);
  res.sendFile(path.join(AUDIO_DIR, s.audio));
}));
app.delete('/api/history/:id/practice/:sid', asyncRoute(async (req, res) => {
  const rec = loadRecord(req.params.id), s = findSession(rec, req.params.sid);
  if (s.audio && fs.existsSync(path.join(AUDIO_DIR, s.audio))) fs.unlinkSync(path.join(AUDIO_DIR, s.audio));
  rec.practice = rec.practice.filter(p => p.id !== s.id); saveRecord(rec);
  res.json({ ok: true });
}));

// ---------- downloads ----------
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
app.get('/api/download/:id/qa', asyncRoute(async (req, res) => {
  const rec = loadRecord(req.params.id);
  if (!rec.qa) throw new Error('Generate the interview questions first.');
  res.setHeader('Content-Type', DOCX);
  res.setHeader('Content-Disposition', `attachment; filename="${docs.fileName(rec.result, 'resume').replace('_Resume', '_Interview_QA')}"`);
  res.send(await docs.buildQaDocx(rec.result, rec.qa));
}));
app.get('/api/download/:id/practice/:sid', asyncRoute(async (req, res) => {
  const rec = loadRecord(req.params.id), s = findSession(rec, req.params.sid);
  res.setHeader('Content-Type', DOCX);
  res.setHeader('Content-Disposition', `attachment; filename="${docs.fileName(rec.result, 'resume').replace('_Resume', '_Mock_Interview_' + s.id.slice(0, 8))}"`);
  res.send(await docs.buildPracticeDocx(rec.result, s));
}));
app.get('/api/download/:id/:kind', asyncRoute(async (req, res) => {
  const rec = loadRecord(req.params.id), r = rec.result;
  const kind = req.params.kind;
  let buf, name, type;
  if (kind === 'all') {
    buf = await docs.buildZip(r, rec.qa);
    name = docs.fileName(r, 'resume').replace(/_Resume/, '_Application_Pack').replace(/\.docx$/, '.zip');
    type = 'application/zip';
  } else {
    if (!docs.KINDS.includes(kind)) throw new Error('Unknown document type.');
    buf = await docs.buildDocx(r, kind); name = docs.fileName(r, kind);
    type = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }
  res.setHeader('Content-Type', type);
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.send(buf);
}));

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

// ---------- start ----------
const server = app.listen(PORT, HOST, () => {
  const lan = Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
  console.log('\n  JD Resume Tailor is running');
  console.log(`  On this computer:   http://localhost:${PORT}`);
  lan.forEach(ip => console.log(`  On your Wi-Fi/LAN:  http://${ip}:${PORT}`));
  const c = config();
  console.log(c.provider === 'demo' ? '  AI: Demo mode (free sample answers). Choose a real AI in Settings.' : `  AI: ${c.provider} · ${c.cfg.model || 'not set — open Settings'}`);
  console.log('  Press Ctrl+C to stop.\n');
});
server.on('error', e => {
  if (e.code === 'EADDRINUSE') console.error(`\n  Port ${PORT} is already in use. Edit PORT in the .env file (for example PORT=3030) and start again.\n`);
  else console.error(e);
  process.exit(1);
});
server.requestTimeout = 0; // generation can take a couple of minutes
