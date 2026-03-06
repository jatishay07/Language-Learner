const DAEMON_BASE = 'http://127.0.0.1:4317';

const toggle = document.getElementById('immersionToggle');
const status = document.getElementById('status');
const refreshStatusButton = document.getElementById('refreshStatus');

async function refreshStatus() {
  try {
    const response = await fetch(`${DAEMON_BASE}/v1/status/today`);
    if (!response.ok) {
      throw new Error('Daemon unavailable');
    }

    const payload = await response.json();
    status.textContent = `Date ${payload.date}\nCompleted ${payload.completedSeconds}/${payload.requiredSeconds}s\nDebt ${payload.debtSeconds}s | Streak ${payload.streak} (${payload.rank})`;
  } catch {
    status.textContent = 'Daemon not reachable at 127.0.0.1:4317. Start it with pnpm learner:daemon.';
  }
}

chrome.storage.local.get(['immersionEnabled'], (result) => {
  toggle.checked = result.immersionEnabled !== false;
});

toggle.addEventListener('change', () => {
  chrome.runtime.sendMessage({
    type: 'SET_IMMERSION',
    enabled: toggle.checked
  });
});

refreshStatusButton.addEventListener('click', refreshStatus);
refreshStatus();
