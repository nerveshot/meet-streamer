const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

const app = express();
const PORT = process.env.PORT || 8080;

// Configurable Environment Variables
const MEET_URL = process.env.MEET_URL || 'https://meet.google.com/ccs-rykd-ddu';
const DASHBOARD_URL = process.env.DASHBOARD_URL || 'https://kabilalibrary.web.app/#dashboard';
const BOT_NAME = process.env.BOT_NAME || '🏛️ Kabila 24/7 Live Routine';

let activeBrowser = null;
let isBotRunning = false;
const logsBuffer = [];

function log(level, message) {
  const time = new Date().toISOString();
  const entry = { time, level, message };
  logsBuffer.push(entry);
  if (logsBuffer.length > 50) logsBuffer.shift();

  const icon = level === 'ERROR' ? '❌' : level === 'WARN' ? '⚠️' : level === 'SUCCESS' ? '✅' : 'ℹ️';
  console.log(`[${time}] ${icon} ${message}`);
}

let botStatus = {
  service: 'Kabila 24/7 Google Meet Dashboard Streamer',
  state: 'STARTING', // STARTING, LAUNCHING, NAVIGATING, ENTERING_NAME, ASKING_TO_JOIN, WAITING_FOR_ADMIT, STREAMING, RETRYING, ERROR
  isStreaming: false,
  joinedAt: null,
  room: MEET_URL,
  dashboard: DASHBOARD_URL,
  botName: BOT_NAME,
  lastError: null,
  lastErrorTime: null,
  reconnectAttempts: 0,
  startedAt: new Date().toISOString()
};

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// JSON Status API for Koyeb / UptimeRobot / Monitoring
app.get('/api/status', (req, res) => {
  res.json({
    ...botStatus,
    timestamp: new Date().toISOString(),
    logs: logsBuffer.slice(-15)
  });
});

// Manual Bot Restart Endpoint
app.post('/api/restart', async (req, res) => {
  log('WARN', 'Manual restart requested via dashboard API.');
  triggerRestart('Manual restart triggered');
  res.json({ success: true, message: 'Bot restart triggered.' });
});

// Health check / Visual Dashboard at '/'
app.get('/', (req, res) => {
  if (req.headers.accept && req.headers.accept.includes('application/json') && !req.query.view) {
    return res.json({
      service: botStatus.service,
      status: botStatus.isStreaming ? 'STREAMING' : botStatus.state,
      bot: botStatus,
      timestamp: new Date().toISOString()
    });
  }

  // Visual Web Dashboard
  const stateColor = botStatus.isStreaming ? '#10b981' :
                     botStatus.state === 'WAITING_FOR_ADMIT' ? '#f59e0b' :
                     botStatus.state === 'ERROR' ? '#ef4444' : '#3b82f6';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Kabila Meet Streamer | Live Status</title>
  <meta http-equiv="refresh" content="5">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #090d16;
      --card-bg: rgba(18, 24, 38, 0.7);
      --card-border: rgba(255, 255, 255, 0.08);
      --text: #f3f4f6;
      --text-muted: #9ca3af;
      --accent: #6366f1;
      --accent-glow: rgba(99, 102, 241, 0.25);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: radial-gradient(circle at 50% 0%, #171d33 0%, var(--bg) 100%);
      color: var(--text);
      font-family: 'Outfit', sans-serif;
      min-height: 100vh;
      padding: 2rem 1rem;
      display: flex;
      justify-content: center;
      align-items: center;
    }
    .container {
      width: 100%;
      max-width: 860px;
    }
    .header {
      text-align: center;
      margin-bottom: 2rem;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.4rem 1rem;
      border-radius: 9999px;
      font-size: 0.85rem;
      font-weight: 600;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid var(--card-border);
      margin-bottom: 1rem;
    }
    .pulse {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: ${stateColor};
      box-shadow: 0 0 12px ${stateColor};
      animation: pulse 2s infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.4; transform: scale(0.85); }
    }
    h1 {
      font-size: 2rem;
      font-weight: 700;
      letter-spacing: -0.02em;
      background: linear-gradient(135deg, #fff 30%, #9ca3af 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 1rem;
      margin-bottom: 1.5rem;
    }
    .card {
      background: var(--card-bg);
      backdrop-filter: blur(16px);
      border: 1px solid var(--card-border);
      border-radius: 16px;
      padding: 1.25rem;
      box-shadow: 0 8px 32px rgba(0,0,0,0.2);
    }
    .card-title {
      font-size: 0.75rem;
      color: var(--text-muted);
      text-transform: uppercase;
      font-weight: 600;
      letter-spacing: 0.05em;
      margin-bottom: 0.5rem;
    }
    .card-value {
      font-size: 1.1rem;
      font-weight: 600;
      word-break: break-all;
    }
    .card-value a {
      color: #818cf8;
      text-decoration: none;
    }
    .card-value a:hover {
      text-decoration: underline;
    }
    .error-card {
      background: rgba(239, 68, 68, 0.1);
      border-color: rgba(239, 68, 68, 0.3);
      margin-bottom: 1.5rem;
    }
    .error-card .card-title { color: #f87171; }
    .error-card .card-value { color: #fca5a5; font-family: 'JetBrains Mono', monospace; font-size: 0.9rem; }
    .logs-card {
      background: #060911;
      border: 1px solid var(--card-border);
      border-radius: 16px;
      padding: 1.25rem;
    }
    .logs-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0.75rem;
      border-bottom: 1px solid rgba(255,255,255,0.06);
      padding-bottom: 0.5rem;
    }
    .logs-title {
      font-size: 0.85rem;
      font-weight: 600;
      color: var(--text-muted);
    }
    .logs-terminal {
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.8rem;
      max-height: 250px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
    }
    .log-row {
      display: flex;
      gap: 0.5rem;
      line-height: 1.4;
    }
    .log-time { color: #6b7280; flex-shrink: 0; }
    .log-msg { color: #d1d5db; }
    .btn-row {
      display: flex;
      gap: 0.75rem;
      justify-content: center;
      margin-top: 1.5rem;
    }
    .btn {
      padding: 0.6rem 1.25rem;
      border-radius: 10px;
      font-weight: 600;
      font-size: 0.9rem;
      cursor: pointer;
      border: 1px solid var(--card-border);
      background: rgba(255, 255, 255, 0.06);
      color: var(--text);
      transition: all 0.2s ease;
      text-decoration: none;
    }
    .btn:hover {
      background: rgba(255, 255, 255, 0.12);
      transform: translateY(-1px);
    }
    .btn-primary {
      background: var(--accent);
      border-color: var(--accent);
      box-shadow: 0 4px 20px var(--accent-glow);
    }
    .btn-primary:hover {
      background: #4f46e5;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="badge">
        <span class="pulse"></span>
        <span>STATUS: ${botStatus.state}</span>
      </div>
      <h1>🏛️ Kabila 24/7 Meet Streamer</h1>
      <p style="color: var(--text-muted); font-size: 0.9rem; margin-top: 0.25rem;">Auto-refreshes every 5s • Keeping the virtual study hall active</p>
    </div>

    <div class="grid">
      <div class="card">
        <div class="card-title">Streaming Status</div>
        <div class="card-value" style="color: ${botStatus.isStreaming ? '#34d399' : '#f87171'}">
          ${botStatus.isStreaming ? '🟢 LIVE IN CALL' : '⏳ ' + botStatus.state}
        </div>
      </div>
      <div class="card">
        <div class="card-title">Google Meet Target</div>
        <div class="card-value">
          <a href="${botStatus.room}" target="_blank" rel="noopener">${botStatus.room.replace('https://meet.google.com/', '')}</a>
        </div>
      </div>
      <div class="card">
        <div class="card-title">Bot Name</div>
        <div class="card-value">${botStatus.botName}</div>
      </div>
      <div class="card">
        <div class="card-title">Reconnect Attempts</div>
        <div class="card-value">${botStatus.reconnectAttempts}</div>
      </div>
    </div>

    ${botStatus.lastError ? `
    <div class="card error-card">
      <div class="card-title">Last Encountered Issue (${botStatus.lastErrorTime || 'Recently'})</div>
      <div class="card-value">${botStatus.lastError}</div>
    </div>` : ''}

    <div class="logs-card">
      <div class="logs-header">
        <span class="logs-title">📋 Live Activity Log</span>
        <span style="font-size: 0.75rem; color: #6b7280;">Auto-scrolling</span>
      </div>
      <div class="logs-terminal">
        ${logsBuffer.length === 0 ? '<div class="log-row"><span class="log-msg">Waiting for initial bot start...</span></div>' :
          logsBuffer.map(l => `
            <div class="log-row">
              <span class="log-time">${l.time.split('T')[1].slice(0, 8)}</span>
              <span class="log-msg">${l.message}</span>
            </div>
          `).join('')}
      </div>
    </div>

    <div class="btn-row">
      <button class="btn btn-primary" onclick="restartBot()">🔄 Reconnect Bot</button>
      <a class="btn" href="/api/status" target="_blank">🔍 View Raw JSON</a>
    </div>
  </div>

  <script>
    async function restartBot() {
      if (confirm('Force restart the Google Meet Bot process?')) {
        await fetch('/api/restart', { method: 'POST' });
        location.reload();
      }
    }
  </script>
</body>
</html>`;

  res.send(html);
});

async function safeCloseBrowser() {
  if (activeBrowser) {
    log('INFO', 'Cleaning up active Chromium instance...');
    try {
      await activeBrowser.close();
    } catch (e) {
      log('WARN', `Error closing browser: ${e.message}`);
    }
    activeBrowser = null;
  }
}

async function triggerRestart(reason) {
  log('WARN', `Triggering restart: ${reason}`);
  botStatus.state = 'RETRYING';
  botStatus.isStreaming = false;
  botStatus.reconnectAttempts += 1;
  await safeCloseBrowser();
  await sleep(10000);
  startMeetBot();
}

async function startMeetBot() {
  if (isBotRunning) {
    log('WARN', 'Bot is already in the middle of a launch sequence. Skipping.');
    return;
  }

  isBotRunning = true;
  botStatus.state = 'LAUNCHING';
  botStatus.isStreaming = false;

  log('INFO', '🚀 [Kabila Bot] Initializing Headless Chromium Streamer...');

  try {
    await safeCloseBrowser();

    activeBrowser = await puppeteer.launch({
      headless: 'new',
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
      ignoreHTTPSErrors: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-accelerated-2d-canvas',
        '--disable-extensions',
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        '--enable-usermedia-screen-capturing',
        '--auto-select-desktop-capture-source=Kabila',
        '--window-size=1280,720',
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins,site-per-process'
      ]
    });

    const page = await activeBrowser.newPage();
    await page.setViewport({ width: 1280, height: 720 });
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
    );

    // Grant camera, mic and notifications permissions
    const context = activeBrowser.defaultBrowserContext();
    await context.overridePermissions('https://meet.google.com', ['camera', 'microphone', 'notifications']);

    botStatus.state = 'NAVIGATING';
    log('INFO', `🌐 [Kabila Bot] Connecting to Google Meet: ${MEET_URL}`);
    await page.goto(MEET_URL, { waitUntil: 'networkidle2', timeout: 60000 });

    await sleep(4000);

    // Check if dismissed modal or audio alerts exist
    try {
      await page.evaluate(() => {
        const dismissBtns = Array.from(document.querySelectorAll('button, div[role="button"]'));
        const gotIt = dismissBtns.find(b => (b.textContent || '').trim().toLowerCase().includes('got it'));
        if (gotIt) gotIt.click();
      });
    } catch (e) {}

    // 1. Enter Bot Display Name if guest input exists
    botStatus.state = 'ENTERING_NAME';
    try {
      const nameInputSelector = 'input[type="text"], input[aria-label="Your name"], input[placeholder*="name" i]';
      const nameInput = await page.$(nameInputSelector);
      if (nameInput) {
        log('INFO', `✍️ [Kabila Bot] Entering Display Name: "${BOT_NAME}"`);
        await nameInput.click({ clickCount: 3 });
        await nameInput.type(BOT_NAME, { delay: 35 });
        await sleep(1000);
      } else {
        log('INFO', 'ℹ️ [Kabila Bot] Guest name input not found or already authenticated.');
      }
    } catch (e) {
      log('WARN', `ℹ️ Name input step skipped: ${e.message}`);
    }

    // 2. Mute Microphone and Turn Off Camera before entering
    log('INFO', '🔇 [Kabila Bot] Muting Camera & Mic...');
    try {
      // Toggle using shortcuts
      await page.keyboard.down('Control');
      await page.keyboard.press('e'); // Camera
      await page.keyboard.press('d'); // Mic
      await page.keyboard.up('Control');
    } catch (e) {}

    await sleep(2000);

    // 3. Click "Ask to join" or "Join now"
    botStatus.state = 'ASKING_TO_JOIN';
    log('INFO', '🚪 [Kabila Bot] Clicking Ask to join / Join now...');
    const joinResult = await page.evaluate(() => {
      const candidates = Array.from(document.querySelectorAll('button, div[role="button"], span'));
      for (const el of candidates) {
        const text = (el.innerText || el.textContent || '').trim().toLowerCase();
        if (
          text === 'ask to join' ||
          text === 'join now' ||
          text === 'join' ||
          text.includes('ask to join') ||
          text.includes('join now')
        ) {
          const btn = el.closest('button') || el.closest('div[role="button"]') || el;
          btn.click();
          return { clicked: true, buttonText: text };
        }
      }
      return { clicked: false };
    });

    if (joinResult.clicked) {
      log('SUCCESS', `✅ [Kabila Bot] Clicked "${joinResult.buttonText}" button successfully!`);
    } else {
      log('WARN', '⚠️ [Kabila Bot] Specific Join button not detected in DOM.');
    }

    botStatus.state = 'WAITING_FOR_ADMIT';
    log('INFO', '⏳ [Kabila Bot] Bot is in room queue. Waiting for host admission or in-call signal...');

    // 4. Open Kabila Dashboard in a second tab
    const dashboardPage = await activeBrowser.newPage();
    log('INFO', `📊 [Kabila Bot] Loading Dashboard in Tab 2: ${DASHBOARD_URL}`);
    await dashboardPage.goto(DASHBOARD_URL, { waitUntil: 'networkidle2', timeout: 60000 }).catch(e => {
      log('WARN', `Dashboard load warning: ${e.message}`);
    });

    // 5. Monitor In-Call status
    isBotRunning = false;
    let checkCount = 0;

    const monitorInterval = setInterval(async () => {
      if (!activeBrowser || !page || page.isClosed()) {
        clearInterval(monitorInterval);
        return;
      }

      checkCount++;
      try {
        const inCall = await page.evaluate(() => {
          // Check for in-call elements: Leave call button, people list, or meeting controls
          const leaveCallBtn = document.querySelector('button[aria-label*="Leave" i], button[aria-label*="leave call" i]');
          const micControl = document.querySelector('button[aria-label*="microphone" i]');
          const waitingText = document.body.innerText.includes("You'll join the call when someone lets you in");

          return {
            hasCallControls: !!(leaveCallBtn || micControl),
            isWaiting: waitingText
          };
        });

        if (inCall.hasCallControls && !botStatus.isStreaming) {
          botStatus.isStreaming = true;
          botStatus.state = 'STREAMING';
          botStatus.joinedAt = new Date().toISOString();
          log('SUCCESS', '🎉 [Kabila Bot] Admitted to Google Meet! 24/7 Routine is LIVE.');
        } else if (inCall.isWaiting) {
          botStatus.state = 'WAITING_FOR_ADMIT';
        }
      } catch (err) {
        // Page might be closed or navigating
      }

      // Keep alive heartbeat log every 5 minutes
      if (checkCount % 60 === 0) {
        log('INFO', `💓 [Kabila Bot Heartbeat] Status: ${botStatus.state} | Streaming: ${botStatus.isStreaming}`);
      }
    }, 5000);

  } catch (err) {
    isBotRunning = false;
    botStatus.state = 'ERROR';
    botStatus.isStreaming = false;
    botStatus.lastError = err.message;
    botStatus.lastErrorTime = new Date().toISOString();

    log('ERROR', `❌ [Kabila Bot Error]: ${err.message}`);
    log('INFO', '🔄 [Kabila Bot] Scheduling recovery in 20 seconds...');

    await sleep(20000);
    triggerRestart(err.message);
  }
}

// Graceful shutdown handling
process.on('SIGINT', async () => {
  log('WARN', 'SIGINT received. Shutting down gracefully...');
  await safeCloseBrowser();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  log('WARN', 'SIGTERM received. Shutting down gracefully...');
  await safeCloseBrowser();
  process.exit(0);
});

app.listen(PORT, () => {
  log('INFO', `🌍 [Kabila Server] Listening on Port ${PORT}`);
  startMeetBot();
});
