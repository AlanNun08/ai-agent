const form = document.getElementById('auth-form');
const message = document.getElementById('message');
const policy = document.getElementById('policy');
const logoutBtn = document.getElementById('logout');
const loginTab = document.getElementById('show-login');
const signupTab = document.getElementById('show-signup');
const submitBtn = document.getElementById('submit-btn');

let mode = 'login';
let csrfToken = '';

async function getCsrf() {
  const res = await fetch('/api/csrf', { credentials: 'same-origin' });
  const data = await res.json();
  csrfToken = data.csrfToken;
}

function setMode(nextMode) {
  mode = nextMode;
  const signup = mode === 'signup';
  submitBtn.textContent = signup ? 'Create Account' : 'Login';
  loginTab.classList.toggle('active', !signup);
  signupTab.classList.toggle('active', signup);
  policy.classList.toggle('hidden', !signup);
  document.getElementById('password').setAttribute('autocomplete', signup ? 'new-password' : 'current-password');
  message.textContent = '';
}

async function api(path, payload) {
  const res = await fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrfToken
    },
    credentials: 'same-origin',
    body: JSON.stringify(payload)
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

async function checkAuth() {
  const res = await fetch('/api/me', { credentials: 'same-origin' });
  if (res.ok) {
    const me = await res.json();
    message.textContent = `Signed in as ${me.email}`;
    logoutBtn.classList.remove('hidden');
  } else {
    logoutBtn.classList.add('hidden');
  }
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  message.textContent = '';

  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;
  const endpoint = mode === 'signup' ? '/api/signup' : '/api/login';

  try {
    const data = await api(endpoint, { email, password });
    message.textContent = data.message;
    document.getElementById('password').value = '';
    await getCsrf();
    await checkAuth();
  } catch (err) {
    message.textContent = err.message;
  }
});

logoutBtn.addEventListener('click', async () => {
  try {
    await api('/api/logout', {});
    message.textContent = 'Logged out.';
    logoutBtn.classList.add('hidden');
    await getCsrf();
  } catch (err) {
    message.textContent = err.message;
  }
});

loginTab.addEventListener('click', () => setMode('login'));
signupTab.addEventListener('click', () => setMode('signup'));

(async function init() {
  await getCsrf();
  await checkAuth();
})();
