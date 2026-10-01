'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { promisify } = require('util');
const { check } = require('./checker');

const scrypt = promisify(crypto.scrypt);
const PORT = 2020;
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC_DIR = path.join(__dirname, 'public');
const USERS_FILE = path.join(__dirname, 'users.json');
const QUESTIONS_FILE = path.join(__dirname, 'questions.json');
const MAX_ATTEMPTS = 3;
const SESSION_MS = 24 * 60 * 60 * 1000;
const CHALLENGE_MS = 5 * 60 * 1000;
const DUMMY_SALT = crypto.randomBytes(16);

// ---- data ----
function saveUsers() {
  const tmp = USERS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(users), null, 2));
  fs.renameSync(tmp, USERS_FILE);
}

const users = new Map(); // lowercase username -> { username, salt, hash }
try {
  const raw = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('not an object');
  for (const [k, v] of Object.entries(raw)) users.set(k, v);
} catch (e) {
  if (e.code !== 'ENOENT') {
    try { fs.renameSync(USERS_FILE, USERS_FILE + '.bak'); } catch (_) {}
    console.warn('users.json was invalid; moved to users.json.bak and starting fresh.');
  }
  saveUsers();
}

let questions;
try {
  questions = JSON.parse(fs.readFileSync(QUESTIONS_FILE, 'utf8'));
  if (!Array.isArray(questions) || !questions.length) throw new Error('must be a non-empty array');
} catch (e) {
  console.error('questions.json is missing or invalid: ' + e.message);
  process.exit(1);
}

const sessions = new Map(); // sid -> { username, expires }
const pending = new Map();  // challenge id -> { username, attempts, qi, expires }

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of sessions) if (v.expires < now) sessions.delete(k);
  for (const [k, v] of pending) if (v.expires < now) pending.delete(k);
}, 60000).unref();

// ---- helpers ----
function send(res, status, data, headers) {
  res.writeHead(status, Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  }, headers));
  res.end(JSON.stringify(data));
}

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0, done = false;
    const chunks = [];
    req.on('data', c => {
      if (done) return;
      size += c.length;
      if (size > 10000) { done = true; reject(httpError(413, 'Request too large.')); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (done) return;
      done = true;
      try {
        const o = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Error();
        resolve(o);
      } catch (_) { reject(httpError(400, 'Invalid request.')); }
    });
    req.on('error', () => { if (!done) { done = true; reject(httpError(400, 'Invalid request.')); } });
  });
}

const COOKIE_BASE = 'HttpOnly; SameSite=Strict; Path=/';
function getSid(req) {
  const m = /(?:^|;\s*)sid=([a-f0-9]{64})/.exec(req.headers.cookie || '');
  return m ? m[1] : null;
}
function currentUser(req) {
  const sid = getSid(req);
  const s = sid && sessions.get(sid);
  if (!s) return null;
  if (s.expires < Date.now()) { sessions.delete(sid); return null; }
  return s.username;
}

// Only these fields ever leave the server (never the answer).
function qView(q) {
  return { question: q.question, image: q.image, w: q.w, h: q.h };
}

function randomQuestion(exclude) {
  if (questions.length === 1) return 0;
  let i;
  do { i = crypto.randomInt(questions.length); } while (i === exclude);
  return i;
}

function validCreds(body) {
  const { username, password } = body;
  if (typeof username !== 'string' || !/^[A-Za-z0-9_]{3,20}$/.test(username))
    return 'Username must be 3-20 letters, numbers or underscores.';
  if (typeof password !== 'string' || password.length < 6 || password.length > 128)
    return 'Password must be 6-128 characters.';
  return null;
}

// ---- API ----
async function api(req, res, route) {
  if (route === 'me' && req.method === 'GET') {
    const u = currentUser(req);
    return u ? send(res, 200, { username: u }) : send(res, 401, { error: 'Not logged in.' });
  }
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed.' });

  if (route === 'logout') {
    const sid = getSid(req);
    if (sid) sessions.delete(sid);
    return send(res, 200, { ok: true }, { 'Set-Cookie': 'sid=; Max-Age=0; ' + COOKIE_BASE });
  }

  const body = await readBody(req);

  if (route === 'register') {
    const err = validCreds(body);
    if (err) return send(res, 400, { error: err });
    const key = body.username.toLowerCase();
    if (users.has(key)) return send(res, 409, { error: 'That username is taken.' });
    const salt = crypto.randomBytes(16);
    const hash = await scrypt(body.password, salt, 64);
    if (users.has(key)) return send(res, 409, { error: 'That username is taken.' });
    users.set(key, { username: body.username, salt: salt.toString('hex'), hash: hash.toString('hex') });
    saveUsers();
    return send(res, 200, { ok: true });
  }

  if (route === 'login') {
    const { username, password } = body;
    if (typeof username !== 'string' || typeof password !== 'string' || password.length > 128)
      return send(res, 400, { error: 'Invalid request.' });
    const rec = users.get(username.toLowerCase());
    const hash = await scrypt(password, rec ? Buffer.from(rec.salt, 'hex') : DUMMY_SALT, 64);
    const ok = rec && crypto.timingSafeEqual(hash, Buffer.from(rec.hash, 'hex'));
    if (!ok) return send(res, 401, { error: 'Invalid username or password.' });
    const id = crypto.randomBytes(16).toString('hex');
    const qi = randomQuestion(-1);
    pending.set(id, { username: rec.username, attempts: 0, qi, expires: Date.now() + CHALLENGE_MS });
    return send(res, 200, { challenge: Object.assign({ id }, qView(questions[qi])) });
  }

  if (route === 'verify') {
    const id = String(body.id);
    const ch = pending.get(id);
    if (!ch || ch.expires < Date.now()) {
      pending.delete(id);
      return send(res, 410, { ok: false, expired: true, error: 'Verification expired. Please log in again.' });
    }
    const q = questions[ch.qi];
    if (check(typeof body.answer === 'string' ? body.answer : '', q.answer)) {
      pending.delete(id);
      const sid = crypto.randomBytes(32).toString('hex');
      sessions.set(sid, { username: ch.username, expires: Date.now() + SESSION_MS });
      return send(res, 200, { ok: true, username: ch.username, explanation: q.explanation || '' },
        { 'Set-Cookie': `sid=${sid}; Max-Age=${SESSION_MS / 1000}; ${COOKIE_BASE}` });
    }
    ch.attempts++;
    if (ch.attempts >= MAX_ATTEMPTS) {
      pending.delete(id);
      return send(res, 403, { ok: false, expired: true, error: 'Too many wrong answers. Please log in again.' });
    }
    ch.qi = randomQuestion(ch.qi);
    return send(res, 200, Object.assign({ ok: false, attemptsLeft: MAX_ATTEMPTS - ch.attempts }, qView(questions[ch.qi])));
  }

  return send(res, 404, { error: 'Not found.' });
}

// ---- static files ----
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png'
};

function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  let p;
  try { p = decodeURIComponent(pathname); } catch (_) { res.writeHead(400); return res.end(); }
  if (p.includes('\0')) { res.writeHead(400); return res.end(); }
  if (p === '/') p = '/index.html';
  const file = path.join(PUBLIC_DIR, path.normalize(p));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(req.method === 'HEAD' ? undefined : data);
  });
}

// ---- server ----
http.createServer((req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'self'");
  let pathname;
  try { pathname = new URL(req.url, 'http://localhost').pathname; }
  catch (_) { res.writeHead(400); return res.end(); }

  if (pathname.startsWith('/api/')) {
    api(req, res, pathname.slice(5)).catch(err => {
      if (res.headersSent) return;
      send(res, err.status || 500, { error: err.status ? err.message : 'Server error.' });
    });
  } else {
    serveStatic(req, res, pathname);
  }
}).listen(PORT, HOST, () => console.log(`Running at http://localhost:${PORT}`));
