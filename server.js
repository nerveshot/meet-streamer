const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

const app = express();
const PORT = process.env.PORT || 8080;

// Configurable Environment Variables
const MEET_URL = process.env.MEET_URL || 'https://meet.google.com/YOUR-MEET-CODE';
const DASHBOARD_URL = process.env.DASHBOARD_URL || 'https://kabilalibrary.web.app/#dashboard';
const BOT_NAME = process.env.BOT_NAME || '🏛️ Kabila 24/7 Live Routine';

let botStatus = {
  isStreaming: false,
  joinedAt: null,
  room: MEET_URL,
  lastError: null
};

// Health Check / Ping Endpoint for Koyeb (Keeps Service 100% Awake)
app.get('/', (req, res) => {
  res.json({
    service: 'Kabila 24/7 Google Meet Dashboard Streamer',
    status: 'ONLINE',
    bot: botStatus,
    timestamp: new Date().toISOString()
  });
});

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function startMeetBot() {
  console.log('🚀 [Kabila Bot] Initializing Headless Chromium Streamer...');
  botStatus.isStreaming = false;
  botStatus.lastError = null;

  try {
    const browser = await puppeteer.launch({
      headless: 'new',
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-zygote',
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        '--enable-usermedia-screen-capturing',
        '--auto-select-desktop-capture-source=Kabila',
        '--window-size=1280,720'
      ]
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });

    // Grant WebRTC camera, mic and notifications permissions
    const context = browser.defaultBrowserContext();
    await context.overridePermissions('https://meet.google.com', ['camera', 'microphone', 'notifications']);

    console.log(`🌐 [Kabila Bot] Connecting to Google Meet: ${MEET_URL}`);
    await page.goto(MEET_URL, { waitUntil: 'networkidle2', timeout: 60000 });

    await sleep(5000);

    // 1. Enter Bot Display Name if guest input exists
    try {
      const nameInput = await page.$('input[type="text"]');
      if (nameInput) {
        console.log(`✍️ [Kabila Bot] Entering Display Name: "${BOT_NAME}"`);
        await nameInput.click({ clickCount: 3 });
        await nameInput.type(BOT_NAME, { delay: 40 });
        await sleep(1000);
      }
    } catch (e) {
      console.log('ℹ️ Name input not required or already set');
    }

    // 2. Mute Microphone and Turn Off Camera before entering
    console.log('🔇 [Kabila Bot] Muting Camera & Mic...');
    try {
      await page.keyboard.down('Control');
      await page.keyboard.press('e'); // Toggle Camera Off
      await page.keyboard.press('d'); // Toggle Microphone Off
      await page.keyboard.up('Control');
    } catch (e) {}

    await sleep(2000);

    // 3. Click "Ask to join" or "Join now" button
    console.log('🚪 [Kabila Bot] Attempting to Join Conference...');
    const joined = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const joinBtn = buttons.find(b => {
        const text = (b.textContent || '').trim().toLowerCase();
        return text.includes('ask to join') || text.includes('join now') || text === 'join';
      });
      if (joinBtn) {
        joinBtn.click();
        return true;
      }
      return false;
    });

    if (joined) {
      console.log('✅ [Kabila Bot] Clicked Join successfully!');
    } else {
      console.log('ℹ️ Join button auto-processed or already admitted.');
    }

    botStatus.isStreaming = true;
    botStatus.joinedAt = new Date().toISOString();

    // 4. Open the Kabila Dashboard in a second tab to keep it active
    const dashboardPage = await browser.newPage();
    console.log(`📊 [Kabila Bot] Loading Kabila Dashboard: ${DASHBOARD_URL}`);
    await dashboardPage.goto(DASHBOARD_URL, { waitUntil: 'networkidle2', timeout: 60000 });

    console.log('🎉 [Kabila Bot] All systems operational. 24/7 Broadcast is Live!');

  } catch (err) {
    console.error('❌ [Kabila Bot Error]:', err.message);
    botStatus.lastError = err.message;
    botStatus.isStreaming = false;

    console.log('🔄 [Kabila Bot] Retrying in 20 seconds...');
    await sleep(20000);
    startMeetBot();
  }
}

app.listen(PORT, () => {
  console.log(`🌍 [Kabila Server] Listening on Port ${PORT}`);
  startMeetBot();
});
