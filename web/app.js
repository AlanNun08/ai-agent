const authPanel = document.getElementById('authPanel');
const appPanel = document.getElementById('appPanel');
const statusEl = document.getElementById('status');
const whoamiEl = document.getElementById('whoami');

const logBody = document.getElementById('logBody');
const searchInput = document.getElementById('searchInput');
const severitySelect = document.getElementById('severitySelect');
const followUpOnly = document.getElementById('followUpOnly');
const stats = document.getElementById('stats');

function setStatus(msg, isError = false) {
  statusEl.textContent = msg;
  statusEl.className = isError ? 'status err' : 'status ok';
}

function toLocalTime(ts) {
  return new Date(ts).toLocaleString();
}

function renderStats(logs) {
  const followUps = logs.filter((l) => l.follow_up_required).length;
  const critical = logs.filter((l) => l.severity === 'critical').length;
  const high = logs.filter((l) => l.severity === 'high').length;
  stats.innerHTML = [
    ['Visible Logs', logs.length],
    ['Needs Follow-up', followUps],
    ['Critical Issues', critical],
    ['High Severity', high],
  ]
    .map(([label, value]) => `<article class="stat-card"><p>${label}</p><h3>${value}</h3></article>`)
    .join('');
}

function renderLogs(logs) {
  if (!logs.length) {
    logBody.innerHTML = `<tr><td colspan="6">No logs match your filters.</td></tr>`;
    return;
  }
  logBody.innerHTML = logs
    .map(
      (log) => `
      <tr>
        <td>
          <strong>${log.customer_name}</strong><br />
          <span class="muted">${log.customer_email}</span>
        </td>
        <td><strong>${log.event_type}</strong><br />${log.message}</td>
        <td><span class="badge ${log.severity}">${log.severity}</span></td>
        <td>${log.assigned_owner || '-'}</td>
        <td>${toLocalTime(log.created_at)}</td>
        <td>${log.follow_up_required ? '<span class="follow">Required</span>' : 'No'}</td>
      </tr>
    `,
    )
    .join('');
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Request failed');
  }
  return data;
}

async function loadLogs() {
  const params = new URLSearchParams({
    search: searchInput.value,
    severity: severitySelect.value,
    follow_up_only: String(followUpOnly.checked),
  });
  const data = await api(`/api/logs?${params}`);
  renderLogs(data.logs);
  renderStats(data.logs);
}

async function checkSession() {
  try {
    const data = await api('/api/me');
    authPanel.classList.add('hidden');
    appPanel.classList.remove('hidden');
    whoamiEl.textContent = `Signed in as ${data.user.full_name} (${data.user.email})`;
    await loadLogs();
  } catch {
    authPanel.classList.remove('hidden');
    appPanel.classList.add('hidden');
  }
}

let timeout;
function debounceLoad() {
  clearTimeout(timeout);
  timeout = setTimeout(() => {
    loadLogs().catch((err) => setStatus(err.message, true));
  }, 250);
}

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/api/login', {
      method: 'POST',
      body: JSON.stringify({
        email: document.getElementById('loginEmail').value,
        password: document.getElementById('loginPassword').value,
      }),
    });
    setStatus('Login successful.');
    await checkSession();
  } catch (err) {
    setStatus(err.message, true);
  }
});

document.getElementById('signupForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/api/signup', {
      method: 'POST',
      body: JSON.stringify({
        full_name: document.getElementById('signupName').value,
        email: document.getElementById('signupEmail').value,
        password: document.getElementById('signupPassword').value,
      }),
    });
    setStatus('Account created. You can now sign in.');
  } catch (err) {
    setStatus(err.message, true);
  }
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
  try {
    await api('/api/logout', { method: 'POST', body: '{}' });
    setStatus('Logged out.');
    await checkSession();
  } catch (err) {
    setStatus(err.message, true);
  }
});

document.getElementById('refreshBtn').addEventListener('click', () => {
  loadLogs().catch((err) => setStatus(err.message, true));
});

searchInput.addEventListener('input', debounceLoad);
severitySelect.addEventListener('change', () => loadLogs().catch((err) => setStatus(err.message, true)));
followUpOnly.addEventListener('change', () => loadLogs().catch((err) => setStatus(err.message, true)));

checkSession();
