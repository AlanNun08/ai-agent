const test = require('node:test');
const assert = require('node:assert/strict');
const { server, users, validatePassword } = require('../server');

function startServer() {
  return new Promise((resolve) => {
    const instance = server.listen(0, () => {
      const { port } = instance.address();
      resolve({ instance, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

function parseSetCookie(headers) {
  const setCookie = headers.get('set-cookie');
  return setCookie ? setCookie.split(';')[0] : '';
}

async function getCsrf(baseUrl, cookie) {
  const res = await fetch(`${baseUrl}/api/csrf`, { headers: cookie ? { Cookie: cookie } : {} });
  const body = await res.json();
  return { csrf: body.csrfToken, cookie: cookie || parseSetCookie(res.headers) };
}

test('password policy enforcement', () => {
  assert.equal(validatePassword('weak'), false);
  assert.equal(validatePassword('StrongEnough123!'), true);
});

test('signup/login flow and csrf enforcement', async () => {
  users.clear();
  const { instance, baseUrl } = await startServer();
  try {
    let { csrf, cookie } = await getCsrf(baseUrl);

    const signup = await fetch(`${baseUrl}/api/signup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-csrf-token': csrf, Cookie: cookie },
      body: JSON.stringify({ email: 'test@example.com', password: 'StrongEnough123!' })
    });
    assert.equal(signup.status, 201);

    const me = await fetch(`${baseUrl}/api/me`, { headers: { Cookie: cookie } });
    assert.equal(me.status, 200);

    const bad = await fetch(`${baseUrl}/api/logout`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Cookie: cookie },
      body: '{}'
    });
    assert.equal(bad.status, 403);

    ({ csrf, cookie } = await getCsrf(baseUrl, cookie));
    const logout = await fetch(`${baseUrl}/api/logout`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-csrf-token': csrf, Cookie: cookie },
      body: '{}'
    });
    assert.equal(logout.status, 200);

    ({ csrf, cookie } = await getCsrf(baseUrl, cookie));
    const login = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-csrf-token': csrf, Cookie: cookie },
      body: JSON.stringify({ email: 'test@example.com', password: 'StrongEnough123!' })
    });
    assert.equal(login.status, 200);
  } finally {
    await new Promise((resolve) => instance.close(resolve));
  }
});
