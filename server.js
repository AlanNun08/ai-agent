const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const SESSION_TTL_MS = 30 * 60 * 1000;

const users = new Map();
const sessions = new Map();
const authRate = new Map();

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validatePassword(password) {
  return (
    typeof password === 'string' &&
    password.length >= 12 &&
    /[A-Z]/.test(password) &&
    /[a-z]/.test(password) &&
    /\d/.test(password) &&
    /[^A-Za-z0-9]/.test(password)
  );
}

function parseCookies(req) {
  const raw = req.headers.cookie || '';
  return raw.split(';').reduce((acc, pair) => {
    const [k, ...rest] = pair.trim().split('=');
    if (!k) return acc;
    acc[k] = decodeURIComponent(rest.join('='));
    return acc;
  }, {});
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'"
  });
  res.end(JSON.stringify(body));
}

function getBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 10_000) {
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
  });
}

function newId() {
  return crypto.randomBytes(32).toString('hex');
}

function issueSession(res) {
  const sid = newId();
  sessions.set(sid, { createdAt: Date.now(), expiresAt: Date.now() + SESSION_TTL_MS, csrf: newId(), userEmail: null });
  res.setHeader('Set-Cookie', `sid=${sid}; HttpOnly; SameSite=Strict; Max-Age=1800; Path=/`);
  return sid;
}

function getSession(req, res) {
  const sid = parseCookies(req).sid;
  if (!sid || !sessions.has(sid)) {
    const newSid = issueSession(res);
    return sessions.get(newSid);
  }
  const session = sessions.get(sid);
  if (session.expiresAt < Date.now()) {
    sessions.delete(sid);
    const newSid = issueSession(res);
    return sessions.get(newSid);
  }
  session.expiresAt = Date.now() + SESSION_TTL_MS;
  return session;
}

function tooManyAttempts(ip) {
  const now = Date.now();
  const windowMs = 15 * 60 * 1000;
  const max = 10;
  const attempts = (authRate.get(ip) || []).filter((ts) => now - ts <= windowMs);
  attempts.push(now);
  authRate.set(ip, attempts);
  return attempts.length > max;
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.pbkdf2Sync(password, salt, 120000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const testHash = crypto.pbkdf2Sync(password, salt, 120000, 64, 'sha512').toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(testHash));
}

function serveStatic(req, res) {
  const pathname = req.url === '/' ? '/index.html' : req.url;
  const safePath = path.normalize(pathname).replace(/^\.+/, '');
  const filePath = path.join(__dirname, 'public', safePath);
  if (!filePath.startsWith(path.join(__dirname, 'public'))) {
    res.writeHead(404);
    return res.end('Not found');
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end('Not found');
    }
    const ext = path.extname(filePath);
    const type = ext === '.css' ? 'text/css' : ext === '.js' ? 'application/javascript' : 'text/html';
    res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const session = getSession(req, res);

  if (req.method === 'GET' && req.url === '/api/csrf') {
    session.csrf = newId();
    return sendJson(res, 200, { csrfToken: session.csrf });
  }

  if (req.method === 'GET' && req.url === '/api/me') {
    if (!session.userEmail) return sendJson(res, 401, { error: 'Not authenticated.' });
    return sendJson(res, 200, { email: session.userEmail });
  }

  if (req.method === 'POST' && ['/api/signup', '/api/login', '/api/logout'].includes(req.url)) {
    const csrf = req.headers['x-csrf-token'];
    if (!csrf || csrf !== session.csrf) return sendJson(res, 403, { error: 'Invalid CSRF token.' });
  }

  if (req.method === 'POST' && (req.url === '/api/signup' || req.url === '/api/login')) {
    if (tooManyAttempts(req.socket.remoteAddress || 'unknown')) {
      return sendJson(res, 429, { error: 'Too many attempts. Try again later.' });
    }

    let body;
    try {
      body = await getBody(req);
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }

    const email = (body.email || '').trim().toLowerCase();
    const password = body.password || '';

    if (req.url === '/api/signup') {
      if (!emailRegex.test(email) || !validatePassword(password)) {
        return sendJson(res, 400, { error: 'Invalid email or password policy not met.' });
      }
      if (users.has(email)) return sendJson(res, 409, { error: 'Account already exists.' });
      users.set(email, { passwordHash: hashPassword(password) });
      session.userEmail = email;
      session.csrf = newId();
      return sendJson(res, 201, { message: 'Signup successful.' });
    }

    const user = users.get(email);
    if (!user || !verifyPassword(password, user.passwordHash)) {
      return sendJson(res, 401, { error: 'Invalid credentials.' });
    }
    session.userEmail = email;
    session.csrf = newId();
    return sendJson(res, 200, { message: 'Login successful.' });
  }

  if (req.method === 'POST' && req.url === '/api/logout') {
    session.userEmail = null;
    session.csrf = newId();
    return sendJson(res, 200, { message: 'Logged out.' });
  }

  if (req.url.startsWith('/api/')) return sendJson(res, 404, { error: 'Not found' });

  return serveStatic(req, res);
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

module.exports = { server, users, validatePassword };
