const logBody = document.getElementById('logBody');
const searchInput = document.getElementById('searchInput');
const severitySelect = document.getElementById('severitySelect');
const followUpOnly = document.getElementById('followUpOnly');
const stats = document.getElementById('stats');

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
    `
    )
    .join('');
}

async function loadLogs() {
  const params = new URLSearchParams({
    search: searchInput.value,
    severity: severitySelect.value,
    follow_up_only: String(followUpOnly.checked),
  });
  const response = await fetch(`/api/logs?${params}`);
  const data = await response.json();
  renderLogs(data.logs);
  renderStats(data.logs);
}

let timeout;
function debounceLoad() {
  clearTimeout(timeout);
  timeout = setTimeout(loadLogs, 250);
}

searchInput.addEventListener('input', debounceLoad);
severitySelect.addEventListener('change', loadLogs);
followUpOnly.addEventListener('change', loadLogs);
document.getElementById('refreshBtn').addEventListener('click', loadLogs);

loadLogs();
