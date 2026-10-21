// Accounts: validation, password hashing, signed session cookies and encryption of saved API keys.
const crypto = require('crypto');

const COOKIE = 'rt_session';
const MAX_AGE = 30 * 24 * 3600; // 30 days

function secret() {
  const s = process.env.APP_SECRET;
  if (!s || s.length < 32) { const e = new Error('Server setup incomplete: APP_SECRET is missing (at least 32 characters).'); e.status = 500; throw e; }
  return s;
}

// ---------- validation ----------
function bad(msg, field) { const e = new Error(msg); e.status = 400; e.field = field; return e; }
function cleanName(v) {
  const n = String(v || '').replace(/\s+/g, ' ').trim();
  if (n.length < 2) throw bad('Enter your full name.', 'name');
  if (n.length > 80) throw bad('Name is too long.', 'name');
  return n;
}
function cleanEmail(v) {
  const e = String(v || '').trim().toLowerCase();
  if (!e) throw bad('Email address is required.', 'email');
  if (e.length > 160 || !/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)*\.[a-z]{2,}$/i.test(e)) throw bad('Enter a valid email address, for example name@gmail.com.', 'email');
  return e;
}
// Stored as +<country code><number>. A 10-digit Indian number gets +91.
function cleanMobile(v) {
  const raw = String(v || '').trim();
  if (!raw) throw bad('Mobile number is required.', 'mobile');
  let d = raw.replace(/[\s\-().]/g, '');
  if (d.startsWith('00')) d = '+' + d.slice(2);
  const plus = d.startsWith('+');
  d = d.replace(/^\+/, '');
  if (!/^\d+$/.test(d)) throw bad('Mobile number can contain only digits and an optional + country code.', 'mobile');
  if (!plus) {
    if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
    if (d.length === 10 && /^[6-9]/.test(d)) d = '91' + d;
    else if (d.length === 10) throw bad('Add your country code, for example +971 50 123 4567.', 'mobile');
  }
  if (d.length < 10 || d.length > 15) throw bad('Enter a valid mobile number with country code, for example +91 98765 43210.', 'mobile');
  return '+' + d;
}
function cleanPassword(v) {
  const p = String(v || '');
  if (p.length < 8) throw bad('Password must be at least 8 characters.', 'password');
  if (!/[A-Za-z]/.test(p) || !/\d/.test(p)) throw bad('Password must contain at least one letter and one number.', 'password');
  if (p.length > 200) throw bad('Password is too long.', 'password');
  return p;
}
const isEmail = v => String(v || '').includes('@');

// ---------- passwords ----------
function hashPassword(p) {
  return new Promise((res, rej) => {
    const salt = crypto.randomBytes(16);
    crypto.scrypt(p, salt, 64, { N: 16384, r: 8, p: 1 }, (err, key) => err ? rej(err) : res(`scrypt$${salt.toString('base64')}$${key.toString('base64')}`));
  });
}
function verifyPassword(p, stored) {
  return new Promise(res => {
    const [alg, s, h] = String(stored || '').split('$');
    if (alg !== 'scrypt' || !s || !h) return res(false);
    crypto.scrypt(String(p || ''), Buffer.from(s, 'base64'), 64, { N: 16384, r: 8, p: 1 }, (err, key) => {
      if (err) return res(false);
      const expected = Buffer.from(h, 'base64');
      res(expected.length === key.length && crypto.timingSafeEqual(expected, key));
    });
  });
}

// ---------- sessions ----------
const b64u = b => Buffer.from(b).toString('base64url');
function sign(payload) {
  const body = b64u(JSON.stringify(payload));
  const mac = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  return `${body}.${mac}`;
}
function unsign(token) {
  const [body, mac] = String(token || '').split('.');
  if (!body || !mac) return null;
  const expected = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  if (mac.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  try { const p = JSON.parse(Buffer.from(body, 'base64url').toString()); return p.exp > Date.now() / 1000 ? p : null; } catch { return null; }
}
function readCookie(req, name) {
  const m = String(req.headers.cookie || '').split(/;\s*/).find(c => c.startsWith(name + '='));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : '';
}
const isHttps = req => req.secure || String(req.headers['x-forwarded-proto'] || '').startsWith('https');
function setSession(req, res, user) {
  const token = sign({ uid: user.id, v: user.sessionVersion || 0, exp: Math.floor(Date.now() / 1000) + MAX_AGE });
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE}${isHttps(req) ? '; Secure' : ''}`);
}
function clearSession(req, res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${isHttps(req) ? '; Secure' : ''}`);
}
const readSession = req => unsign(readCookie(req, COOKIE));

// ---------- encryption for saved API keys ----------
const encKey = () => crypto.createHash('sha256').update('rt-keys:' + secret()).digest();
function encrypt(text) {
  if (!text) return '';
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', encKey(), iv);
  const data = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return `v1:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${data.toString('base64')}`;
}
function decrypt(blob) {
  if (!blob) return '';
  try {
    const [v, iv, tag, data] = String(blob).split(':');
    if (v !== 'v1') return '';
    const d = crypto.createDecipheriv('aes-256-gcm', encKey(), Buffer.from(iv, 'base64'));
    d.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8');
  } catch { return ''; }
}

// ---------- simple sign-in rate limit (per server instance) ----------
const attempts = new Map();
function checkRate(key) {
  const now = Date.now(), win = 15 * 60 * 1000;
  const a = (attempts.get(key) || []).filter(t => now - t < win);
  if (a.length >= 10) { const e = new Error('Too many sign-in attempts. Wait 15 minutes and try again.'); e.status = 429; throw e; }
  a.push(now); attempts.set(key, a);
  if (attempts.size > 5000) attempts.clear();
}
const clearRate = key => attempts.delete(key);

module.exports = { cleanName, cleanEmail, cleanMobile, cleanPassword, isEmail, hashPassword, verifyPassword,
  setSession, clearSession, readSession, encrypt, decrypt, checkRate, clearRate, secret };
