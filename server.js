const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');

puppeteer.use(StealthPlugin());

const app = express();
const PORT = process.env.PORT || 8080;

// Configurable Environment Variables
const MEET_URL = process.env.MEET_URL || 'https://meet.google.com/ccs-rykd-ddu';
const DASHBOARD_URL = process.env.DASHBOARD_URL || 'https://kabilalibrary.web.app/#dashboard';
const BOT_NAME = process.env.BOT_NAME || '🏛️ Kabila 24/7 Live Routine';

let activeBrowser = null;
let activePage = null;
let isBotRunning = false;
const logsBuffer = [];

function log(level, message) {
  const time = new Date().toISOString();
  const entry = { time, level, message };
  logsBuffer.push(entry);
  if (logsBuffer.length > 60) logsBuffer.shift();

  const icon = level === 'ERROR' ? '❌' : level === 'WARN' ? '⚠️' : level === 'SUCCESS' ? '✅' : 'ℹ️';
  console.log(`[${time}] ${icon} ${message}`);
}

function getChromeExecutablePath() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH && fs.existsSync(process.env.PUPPETEER_EXECUTABLE_PATH)) {
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }
  const possiblePaths = [
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser'
  ];
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}

let botStatus = {
  service: 'Kabila 24/7 Google Meet Dashboard Streamer',
  state: 'STARTING', // STARTING, LAUNCHING, NAVIGATING, WAITING_FOR_UI, ENTERING_NAME, MUTING_AV, ASKING_TO_JOIN, WAITING_FOR_ADMIT, STREAMING, RETRYING, ERROR
  isStreaming: false,
  joinedAt: null,
  room: MEET_URL,
  dashboard: DASHBOARD_URL,
  botName: BOT_NAME,
  pageTitle: null,
  currentUrl: null,
  lastError: null,
  lastErrorTime: null,
  reconnectAttempts: 0,
  startedAt: new Date().toISOString()
};

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Screenshot endpoint for live visual debugging
app.get('/api/screenshot', async (req, res) => {
  if (!activePage || activePage.isClosed()) {
    return res.status(404).send('No active page session available');
  }
  try {
    const screenshot = await activePage.screenshot({ type: 'png' });
    res.set({
      'Content-Type': 'image/png',
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    });
    res.send(screenshot);
  } catch (err) {
    res.status(500).send(`Screenshot capture error: ${err.message}`);
  }
});

// JSON Status API
app.get('/api/status', (req, res) => {
  res.json({
    ...botStatus,
    timestamp: new Date().toISOString(),
    logs: logsBuffer.slice(-20)
  });
});

// Manual Bot Restart Endpoint
app.post('/api/restart', async (req, res) => {
  log('WARN', 'Manual restart requested via dashboard API.');
  triggerRestart('Manual restart triggered');
  res.json({ success: true, message: 'Bot restart triggered.' });
});

// Health check & Visual Dashboard at '/'
app.get('/', (req, res) => {
  if (req.headers.accept && req.headers.accept.includes('application/json') && !req.query.view) {
    return res.json({
      service: botStatus.service,
      status: botStatus.isStreaming ? 'STREAMING' : botStatus.state,
      bot: botStatus,
      timestamp: new Date().toISOString()
    });
  }

  const stateColor = botStatus.isStreaming ? '#10b981' :
                     botStatus.state === 'WAITING_FOR_ADMIT' ? '#f59e0b' :
                     botStatus.state === 'ERROR' ? '#ef4444' : '#6366f1';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Kabila Meet Streamer | Live Status</title>
  <meta http-equiv="refresh" content="6">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #090d16;
      --card-bg: rgba(18, 24, 38, 0.75);
      --card-border: rgba(255, 255, 255, 0.08);
      --text: #f3f4f6;
      --text-muted: #9ca3af;
      --accent: #6366f1;
      --accent-glow: rgba(99, 102, 241, 0.3);
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
      max-width: 920px;
    }
    .header {
      text-align: center;
      margin-bottom: 1.75rem;
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
      margin-bottom: 0.75rem;
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
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 1rem;
      margin-bottom: 1.5rem;
    }
    .card {
      background: var(--card-bg);
      backdrop-filter: blur(16px);
      border: 1px solid var(--card-border);
      border-radius: 14px;
      padding: 1.1rem;
      box-shadow: 0 8px 32px rgba(0,0,0,0.2);
    }
    .card-title {
      font-size: 0.72rem;
      color: var(--text-muted);
      text-transform: uppercase;
      font-weight: 600;
      letter-spacing: 0.05em;
      margin-bottom: 0.4rem;
    }
    .card-value {
      font-size: 1.05rem;
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
    .screenshot-card {
      background: #060911;
      border: 1px solid var(--card-border);
      border-radius: 14px;
      padding: 1rem;
      margin-bottom: 1.5rem;
      text-align: center;
    }
    .screenshot-card img {
      width: 100%;
      max-height: 380px;
      object-fit: contain;
      border-radius: 8px;
      border: 1px solid rgba(255,255,255,0.08);
      background: #000;
    }
    .error-card {
      background: rgba(239, 68, 68, 0.1);
      border-color: rgba(239, 68, 68, 0.3);
      margin-bottom: 1.5rem;
    }
    .error-card .card-title { color: #f87171; }
    .error-card .card-value { color: #fca5a5; font-family: 'JetBrains Mono', monospace; font-size: 0.85rem; }
    .logs-card {
      background: #060911;
      border: 1px solid var(--card-border);
      border-radius: 14px;
      padding: 1.1rem;
    }
    .logs-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0.6rem;
      border-bottom: 1px solid rgba(255,255,255,0.06);
      padding-bottom: 0.4rem;
    }
    .logs-title {
      font-size: 0.8rem;
      font-weight: 600;
      color: var(--text-muted);
    }
    .logs-terminal {
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.76rem;
      max-height: 220px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 0.3rem;
    }
    .log-row {
      display: flex;
      gap: 0.5rem;
      line-height: 1.35;
    }
    .log-time { color: #6b7280; flex-shrink: 0; }
    .log-msg { color: #d1d5db; }
    .btn-row {
      display: flex;
      gap: 0.75rem;
      justify-content: center;
      margin-top: 1.25rem;
    }
    .btn {
      padding: 0.55rem 1.2rem;
      border-radius: 10px;
      font-weight: 600;
      font-size: 0.85rem;
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
      <p style="color: var(--text-muted); font-size: 0.85rem; margin-top: 0.2rem;">Live Visual Streamer • Auto-refreshes every 6s</p>
    </div>

    <div class="grid">
      <div class="card">
        <div class="card-title">Live State</div>
        <div class="card-value" style="color: ${botStatus.isStreaming ? '#34d399' : '#fbbf24'}">
          ${botStatus.isStreaming ? '🟢 IN CALL (STREAMING)' : '⏳ ' + botStatus.state}
        </div>
      </div>
      <div class="card">
        <div class="card-title">Room Code</div>
        <div class="card-value">
          <a href="${botStatus.room}" target="_blank" rel="noopener">${botStatus.room.replace('https://meet.google.com/', '')}</a>
        </div>
      </div>
      <div class="card">
        <div class="card-title">Bot Name</div>
        <div class="card-value">${botStatus.botName}</div>
      </div>
      <div class="card">
        <div class="card-title">Page Title</div>
        <div class="card-value" style="font-size: 0.9rem;">${botStatus.pageTitle || 'Loading...'}</div>
      </div>
    </div>

    <div class="screenshot-card">
      <div class="logs-header">
        <span class="logs-title">📸 Live Headless Browser View</span>
        <a href="/api/screenshot" target="_blank" style="font-size: 0.75rem; color: #818cf8; text-decoration: none;">Open Full Screen</a>
      </div>
      <img src="/api/screenshot?t=${Date.now()}" alt="Live Browser View (Loading...)" onerror="this.alt='Screenshot preview initializing...';" />
    </div>

    ${botStatus.lastError ? `
    <div class="card error-card">
      <div class="card-title">Last Encountered Issue (${botStatus.lastErrorTime ? botStatus.lastErrorTime.split('T')[1].slice(0, 8) : 'Recently'})</div>
      <div class="card-value">${botStatus.lastError}</div>
    </div>` : ''}

    <div class="logs-card">
      <div class="logs-header">
        <span class="logs-title">📋 Live Activity Log</span>
        <span style="font-size: 0.72rem; color: #6b7280;">Last ${logsBuffer.length} events</span>
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
  activePage = null;
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
  await sleep(6000);
  startMeetBot();
}

async function startMeetBot() {
  if (isBotRunning) {
    log('WARN', 'Bot launch sequence already in progress. Skipping duplicate start.');
    return;
  }

  isBotRunning = true;
  botStatus.state = 'LAUNCHING';
  botStatus.isStreaming = false;
  botStatus.joinedAt = null;

  log('INFO', '🚀 [Kabila Bot] Initializing Headless Google Chrome Streamer...');

  try {
    await safeCloseBrowser();

    const executablePath = getChromeExecutablePath();
    log('INFO', `🔧 [Chrome Binary] Using executable path: ${executablePath || 'Puppeteer bundled'}`);

    const chromeArgs = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-first-run',
      '--disable-accelerated-2d-canvas',
      '--disable-extensions',
      '--ignore-certificate-errors',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--enable-usermedia-screen-capturing',
      '--auto-select-desktop-capture-source=Kabila',
      '--window-size=1280,720',
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins,site-per-process'
    ];

    activeBrowser = await puppeteer.launch({
      headless: 'new',
      executablePath: executablePath,
      args: chromeArgs
    });

    const page = await activeBrowser.newPage();
    activePage = page;
    await page.setViewport({ width: 1280, height: 720 });

    // Set real, modern Chrome User-Agent
    const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
    await page.setUserAgent(userAgent);

    // Provide complete navigator spoofing so Google Meet detects a fully supported modern browser
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });

      if (navigator.userAgentData) {
        Object.defineProperty(navigator, 'userAgentData', {
          get: () => ({
            brands: [
              { brand: 'Google Chrome', version: '131' },
              { brand: 'Chromium', version: '131' },
              { brand: 'Not_A Brand', version: '24' }
            ],
            mobile: false,
            platform: 'Windows'
          })
        });
      }

      window.chrome = {
        runtime: {},
        loadTimes: function() {},
        csi: function() {},
        app: {}
      };
    });

    // Grant camera, mic, and notification permissions
    const context = activeBrowser.defaultBrowserContext();
    await context.overridePermissions('https://meet.google.com', ['camera', 'microphone', 'notifications']);

    botStatus.state = 'NAVIGATING';
    log('INFO', `🌐 [Kabila Bot] Connecting to Google Meet: ${MEET_URL}`);
    await page.goto(MEET_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // Wait for Google Meet scripts to finish initializing
    await sleep(6000);

    botStatus.currentUrl = page.url();
    botStatus.pageTitle = await page.title();
    log('INFO', `📄 [Page Info] Title: "${botStatus.pageTitle}" | URL: ${botStatus.currentUrl}`);

    // Check if Google forced a sign-in redirect
    if (botStatus.currentUrl.includes('accounts.google.com')) {
      throw new Error('Google Meet requires Google Sign-In for this call or from this IP. Guest access was blocked.');
    }

    // Dismiss any "Got it" / "Allow microphone and camera" modal prompts
    try {
      await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button, div[role="button"], span'));
        const dismiss = buttons.find(b => {
          const t = (b.textContent || '').trim().toLowerCase();
          return t === 'got it' || t === 'dismiss' || t.includes('continue without');
        });
        if (dismiss) {
          const clickable = dismiss.closest('button') || dismiss.closest('div[role="button"]') || dismiss;
          clickable.click();
        }
      });
    } catch (e) {}

    await sleep(2000);

    // 1. Enter Name if guest input exists
    botStatus.state = 'ENTERING_NAME';
    let nameEntered = false;

    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const inputFound = await page.evaluate((botName) => {
          const inputs = Array.from(document.querySelectorAll('input[type="text"], input[aria-label*="name" i], input[placeholder*="name" i]'));
          if (inputs.length > 0) {
            const input = inputs[0];
            input.focus();
            input.value = '';
            input.value = botName;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
          }
          return false;
        }, BOT_NAME);

        if (inputFound) {
          log('SUCCESS', `✍️ [Kabila Bot] Entered Guest Display Name: "${BOT_NAME}"`);
          nameEntered = true;
          break;
        }
      } catch (e) {}
      await sleep(1500);
    }

    if (!nameEntered) {
      log('INFO', 'ℹ️ [Kabila Bot] Name input not required or not found (already authenticated or direct join).');
    }

    // 2. Mute Microphone and Turn Off Camera
    botStatus.state = 'MUTING_AV';
    log('INFO', '🔇 [Kabila Bot] Muting Camera & Mic...');
    try {
      await page.keyboard.down('Control');
      await page.keyboard.press('e'); // Toggle Camera Off
      await page.keyboard.press('d'); // Toggle Microphone Off
      await page.keyboard.up('Control');
    } catch (e) {}

    // Also attempt clicking any explicit mute buttons if present
    try {
      await page.evaluate(() => {
        const micBtns = Array.from(document.querySelectorAll('button[aria-label*="microphone" i], div[role="button"][aria-label*="microphone" i]'));
        const mic = micBtns.find(b => {
          const label = (b.getAttribute('aria-label') || '').toLowerCase();
          return label.includes('turn off') || label.includes('mute');
        });
        if (mic) mic.click();

        const camBtns = Array.from(document.querySelectorAll('button[aria-label*="camera" i], div[role="button"][aria-label*="camera" i]'));
        const cam = camBtns.find(b => {
          const label = (b.getAttribute('aria-label') || '').toLowerCase();
          return label.includes('turn off');
        });
        if (cam) cam.click();
      });
    } catch (e) {}

    await sleep(2500);

    // 3. Find and click "Ask to join" or "Join now"
    botStatus.state = 'ASKING_TO_JOIN';
    log('INFO', '🚪 [Kabila Bot] Locating Join / Ask to join button...');

    let joinClicked = false;
    let clickedText = '';

    for (let attempt = 0; attempt < 8; attempt++) {
      const clickAttempt = await page.evaluate(() => {
        const candidates = Array.from(document.querySelectorAll('button, div[role="button"], span'));
        for (const el of candidates) {
          const text = (el.innerText || el.textContent || '').trim().toLowerCase();
          const aria = (el.getAttribute('aria-label') || '').trim().toLowerCase();
          if (
            text === 'ask to join' ||
            text === 'join now' ||
            text === 'join' ||
            text.includes('ask to join') ||
            text.includes('join now') ||
            aria.includes('ask to join') ||
            aria.includes('join now')
          ) {
            const btn = el.closest('button') || el.closest('div[role="button"]') || el;
            // Ensure button is not disabled
            const isDisabled = btn.disabled || btn.getAttribute('aria-disabled') === 'true';
            if (!isDisabled) {
              btn.click();
              return { clicked: true, text: text || aria };
            }
          }
        }
        return { clicked: false };
      });

      if (clickAttempt.clicked) {
        joinClicked = true;
        clickedText = clickAttempt.text;
        log('SUCCESS', `✅ [Kabila Bot] Clicked "${clickedText}" button successfully!`);
        break;
      }
      await sleep(2000);
    }

    if (!joinClicked) {
      log('WARN', '⚠️ [Kabila Bot] Join button was not clickable or not enabled. Check the screenshot on dashboard.');
      const pageSnippets = await page.evaluate(() => {
        return document.body.innerText.replace(/\\s+/g, ' ').slice(0, 300);
      });
      log('INFO', `📝 [Page Content Snippet]: "${pageSnippets}"`);
    } else {
      botStatus.state = 'WAITING_FOR_ADMIT';
      log('INFO', '⏳ [Kabila Bot] Request sent! Waiting for host to click Admit...');
    }

    // 4. Open Kabila Dashboard in Tab 2
    const dashboardPage = await activeBrowser.newPage();
    log('INFO', `📊 [Kabila Bot] Loading Kabila Dashboard: ${DASHBOARD_URL}`);
    await dashboardPage.goto(DASHBOARD_URL, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(e => {
      log('WARN', `Dashboard load warning: ${e.message}`);
    });

    // 5. In-Call Monitor Loop
    isBotRunning = false;
    let monitorCount = 0;

    const monitorInterval = setInterval(async () => {
      if (!activeBrowser || !page || page.isClosed()) {
        clearInterval(monitorInterval);
        return;
      }

      monitorCount++;
      try {
        const callState = await page.evaluate(() => {
          const bodyText = document.body.innerText || '';
          const leaveCall = document.querySelector('button[aria-label*="Leave" i], button[aria-label*="leave call" i], [jsname="CQylAd"]');
          const peopleTab = document.querySelector('button[aria-label*="People" i], button[aria-label*="people" i]');
          const waitingMsg = bodyText.includes("You'll join the call when someone lets you in") || bodyText.includes("Waiting to be admitted");
          const deniedMsg = bodyText.includes("Someone denied your request to join") || bodyText.includes("You can't join this call");

          return {
            inMeeting: !!(leaveCall || peopleTab),
            isWaiting: waitingMsg,
            isDenied: deniedMsg
          };
        });

        if (callState.inMeeting && !botStatus.isStreaming) {
          botStatus.isStreaming = true;
          botStatus.state = 'STREAMING';
          botStatus.joinedAt = new Date().toISOString();
          log('SUCCESS', '🎉 [Kabila Bot] Host admitted the bot! 24/7 Routine is LIVE.');
        } else if (callState.isWaiting) {
          botStatus.state = 'WAITING_FOR_ADMIT';
        } else if (callState.isDenied) {
          log('ERROR', '❌ [Kabila Bot] Host denied request to join or room was closed.');
          botStatus.state = 'ERROR';
          botStatus.lastError = 'Request to join was denied by host.';
        }
      } catch (err) {}

      if (monitorCount % 60 === 0) {
        log('INFO', `💓 [Kabila Bot Heartbeat] State: ${botStatus.state} | Streaming: ${botStatus.isStreaming}`);
      }
    }, 4000);

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
