// Storage: Supabase (Postgres + Storage) when SUPABASE_URL is set, otherwise local files in ./data.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const err = (msg, status = 400) => { const e = new Error(msg); e.status = status; return e; };
const notFound = () => err('This application was not found. It may have been deleted.', 404);

function summary(rec) {
  const p = rec.practice || [];
  return {
    candidate: rec.candidate || '', role: rec.role || '', company: rec.company || '', score: rec.score ?? null, scoreAfter: rec.scoreAfter ?? null,
    sessions: p.length, bestInterview: p.length ? Math.max(...p.map(x => x.report?.overall_score || 0)) : null,
    lastInterview: p.length ? p[p.length - 1].report?.overall_score ?? null : null, qa: !!rec.qa,
  };
}
const publicUser = u => u && ({ id: u.id, name: u.name, email: u.email, mobile: u.mobile, createdAt: u.createdAt });

// =====================================================================
// Local files (Mac)
// =====================================================================
function localStore(root) {
  const DATA = path.join(root, 'data');
  const HIST = path.join(DATA, 'history');
  const AUDIO = path.join(DATA, 'audio');
  const USERS = path.join(DATA, 'users.json');
  [HIST, AUDIO].forEach(d => fs.mkdirSync(d, { recursive: true }));
  const readUsers = () => { try { return JSON.parse(fs.readFileSync(USERS, 'utf8')); } catch { return []; } };
  const writeUsers = u => fs.writeFileSync(USERS, JSON.stringify(u, null, 2), { mode: 0o600 });
  const recPath = id => { if (!/^[\w-]+$/.test(id)) throw notFound(); return path.join(HIST, id + '.json'); };
  const readRec = id => { try { return JSON.parse(fs.readFileSync(recPath(id), 'utf8')); } catch { return null; } };

  return {
    kind: 'local',
    async createUser(u) {
      const users = readUsers();
      if (users.some(x => x.email === u.email)) throw err('An account with this email already exists. Sign in instead.', 409);
      if (users.some(x => x.mobile === u.mobile)) throw err('An account with this mobile number already exists. Sign in instead.', 409);
      const user = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), ai: {}, sessionVersion: 0, ...u };
      users.push(user); writeUsers(users);
      // The first account on this computer takes over applications created before sign-in existed.
      if (users.length === 1) {
        fs.readdirSync(HIST).filter(f => f.endsWith('.json')).forEach(f => {
          const p = path.join(HIST, f);
          try { const r = JSON.parse(fs.readFileSync(p, 'utf8')); if (!r.userId) { r.userId = user.id; fs.writeFileSync(p, JSON.stringify(r, null, 2)); } } catch { /* skip */ }
        });
        user.firstOnDevice = true;
      }
      return user;
    },
    async findUserByEmail(email) { return readUsers().find(x => x.email === email) || null; },
    async findUserByMobile(mobile) { return readUsers().find(x => x.mobile === mobile) || null; },
    async getUser(id) { return readUsers().find(x => x.id === id) || null; },
    async updateUser(id, patch) {
      const users = readUsers(); const i = users.findIndex(x => x.id === id);
      if (i < 0) throw err('Account not found.', 404);
      if (patch.email && users.some(x => x.id !== id && x.email === patch.email)) throw err('Another account already uses this email.', 409);
      if (patch.mobile && users.some(x => x.id !== id && x.mobile === patch.mobile)) throw err('Another account already uses this mobile number.', 409);
      users[i] = { ...users[i], ...patch }; writeUsers(users); return users[i];
    },
    async deleteUser(id) {
      for (const f of fs.readdirSync(HIST)) { const r = readRec(f.replace(/\.json$/, '')); if (r && r.userId === id) await this.deleteApp(id, r.id); }
      writeUsers(readUsers().filter(x => x.id !== id));
    },
    async listApps(userId) {
      return fs.readdirSync(HIST).filter(f => f.endsWith('.json')).map(f => readRec(f.replace(/\.json$/, '')))
        .filter(r => r && r.userId === userId)
        .map(r => ({ id: r.id, createdAt: r.createdAt, ...summary(r) }))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    async getApp(userId, id) { const r = readRec(id); if (!r || r.userId !== userId) throw notFound(); return r; },
    async saveApp(userId, rec) { rec.userId = userId; fs.writeFileSync(recPath(rec.id), JSON.stringify(rec, null, 2)); return rec; },
    async deleteApp(userId, id) {
      const r = await this.getApp(userId, id);
      for (const s of r.practice || []) if (s.audio) await this.deleteAudio(s.audio);
      fs.unlinkSync(recPath(id));
    },
    // Audio is uploaded through the app server on this computer.
    async audioUploadTarget(userId, appId, sid) { return { mode: 'server', url: `/api/history/${appId}/practice/${sid}/audio` }; },
    async putAudio(key, buf) { fs.writeFileSync(path.join(AUDIO, path.basename(key)), buf); return path.basename(key); },
    async audioRead(key) { const p = path.join(AUDIO, path.basename(key)); if (!fs.existsSync(p)) throw err('No recording for this session.', 404); return { file: p }; },
    async deleteAudio(key) { const p = path.join(AUDIO, path.basename(key)); if (fs.existsSync(p)) fs.unlinkSync(p); },
  };
}

// =====================================================================
// Supabase (Vercel)
// =====================================================================
function supabaseStore(url, key) {
  const base = url.replace(/\/+$/, '');
  const H = extra => ({ apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...extra });
  async function rest(method, pathq, body, prefer) {
    let r;
    try { r = await fetch(`${base}/rest/v1/${pathq}`, { method, headers: H(prefer ? { Prefer: prefer } : {}), body: body ? JSON.stringify(body) : undefined }); }
    catch (e) { throw err('Cannot reach the database. Please try again in a moment.', 503); }
    const text = await r.text();
    const data = text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : null;
    if (!r.ok) {
      const m = (data && (data.message || data.details)) || text || '';
      if (r.status === 409 || /duplicate key/i.test(m)) {
        if (/email/i.test(m)) throw err('An account with this email already exists. Sign in instead.', 409);
        if (/mobile/i.test(m)) throw err('An account with this mobile number already exists. Sign in instead.', 409);
        throw err('This record already exists.', 409);
      }
      if (r.status === 404 && /relation|does not exist|schema cache/i.test(m)) throw err('Database tables are missing. Run supabase/schema.sql in the Supabase SQL editor.', 500);
      if (r.status === 401 || r.status === 403) throw err('Database key rejected. Check SUPABASE_SERVICE_ROLE_KEY in Vercel.', 500);
      throw err(`Database error (${r.status}): ${String(m).slice(0, 200)}`, 500);
    }
    return data;
  }
  const q = encodeURIComponent;
  const fromRow = u => u && ({ id: u.id, name: u.name, email: u.email, mobile: u.mobile, passwordHash: u.password_hash, ai: u.ai || {}, sessionVersion: u.session_version || 0, createdAt: u.created_at });
  const toRow = p => {
    const m = { name: 'name', email: 'email', mobile: 'mobile', passwordHash: 'password_hash', ai: 'ai', sessionVersion: 'session_version' };
    const o = {}; Object.entries(p).forEach(([k, v]) => { if (m[k]) o[m[k]] = v; }); return o;
  };
  async function storage(method, p, body, extraHeaders) {
    let r;
    try { r = await fetch(`${base}/storage/v1/${p}`, { method, headers: H(extraHeaders), body: body ? JSON.stringify(body) : undefined }); }
    catch { throw err('Cannot reach file storage.', 503); }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw err(`Storage error: ${data.message || data.error || r.status}. Check the "audio" bucket exists (supabase/schema.sql).`, 500);
    return data;
  }

  return {
    kind: 'supabase',
    async createUser(u) {
      const rows = await rest('POST', 'users', toRow(u), 'return=representation');
      return fromRow(rows[0]);
    },
    async findUserByEmail(email) { const r = await rest('GET', `users?email=eq.${q(email)}&limit=1`); return fromRow(r[0]) || null; },
    async findUserByMobile(mobile) { const r = await rest('GET', `users?mobile=eq.${q(mobile)}&limit=1`); return fromRow(r[0]) || null; },
    async getUser(id) { const r = await rest('GET', `users?id=eq.${q(id)}&limit=1`); return fromRow(r[0]) || null; },
    async updateUser(id, patch) { const r = await rest('PATCH', `users?id=eq.${q(id)}`, toRow(patch), 'return=representation'); if (!r.length) throw err('Account not found.', 404); return fromRow(r[0]); },
    async deleteUser(id) {
      const apps = await rest('GET', `applications?user_id=eq.${q(id)}&select=id,data`);
      const keys = apps.flatMap(a => (a.data?.practice || []).map(s => s.audio).filter(Boolean));
      if (keys.length) await storage('DELETE', 'object/audio', { prefixes: keys }).catch(() => {});
      await rest('DELETE', `users?id=eq.${q(id)}`); // applications cascade
    },
    async listApps(userId) {
      const r = await rest('GET', `applications?user_id=eq.${q(userId)}&select=id,created_at,summary&order=created_at.desc&limit=500`);
      return r.map(x => ({ id: x.id, createdAt: x.created_at, ...(x.summary || {}) }));
    },
    async getApp(userId, id) {
      const r = await rest('GET', `applications?id=eq.${q(id)}&user_id=eq.${q(userId)}&select=data&limit=1`);
      if (!r.length) throw notFound();
      return r[0].data;
    },
    async saveApp(userId, rec) {
      rec.userId = userId;
      await rest('POST', 'applications?on_conflict=id', { id: rec.id, user_id: userId, created_at: rec.createdAt, data: rec, summary: summary(rec) }, 'resolution=merge-duplicates,return=minimal');
      return rec;
    },
    async deleteApp(userId, id) {
      const r = await this.getApp(userId, id);
      const keys = (r.practice || []).map(s => s.audio).filter(Boolean);
      if (keys.length) await storage('DELETE', 'object/audio', { prefixes: keys }).catch(() => {});
      await rest('DELETE', `applications?id=eq.${q(id)}&user_id=eq.${q(userId)}`);
    },
    // The browser uploads audio straight to Supabase Storage with a one-time signed URL
    // (Vercel limits request bodies to 4.5 MB).
    async audioUploadTarget(userId, appId, sid, ext) {
      const key = `${userId}/${appId}_${sid}.${ext}`;
      const d = await storage('POST', `object/upload/sign/audio/${key}`, {});
      return { mode: 'signed', url: `${base}/storage/v1${d.url}`, key };
    },
    async audioRead(key) {
      const d = await storage('POST', `object/sign/audio/${key}`, { expiresIn: 3600 });
      return { url: `${base}/storage/v1${d.signedURL || d.signedUrl}` };
    },
    async deleteAudio(key) { await storage('DELETE', 'object/audio', { prefixes: [key] }).catch(() => {}); },
  };
}

function createStore(root) {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (url && key) return supabaseStore(url, key);
  if (process.env.VERCEL) {
    // Vercel cannot keep files: refuse clearly instead of losing data.
    const fail = async () => { throw err('Database not configured. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel > Settings > Environment Variables, then redeploy.', 500); };
    return new Proxy({ kind: 'unconfigured' }, { get: (t, p) => (p === 'kind' ? 'unconfigured' : fail) });
  }
  return localStore(root);
}

module.exports = { createStore, publicUser, summary };
