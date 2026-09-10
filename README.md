# 🏛️ Kabila 24/7 Google Meet Dashboard Streamer Bot

A lightweight, 24/7 cloud streamer bot designed to join your Google Meet study room and broadcast the Kabila Virtual Library Dashboard & Focus Timetable continuously.

---

## 🚀 Quick Deploy to Koyeb (Free Tier - No Card Required)

### Step 1: Push this bot to a GitHub Repository
1. Create a new repository on GitHub named `kabila-meet-bot`.
2. Push the files inside this `kabila-meet-bot` folder to that repository.

### Step 2: Deploy on Koyeb
1. Go to [Koyeb.com](https://app.koyeb.com) and log in with GitHub.
2. Click **Create Service** > Select **GitHub**.
3. Choose your `kabila-meet-bot` repository.
4. Builder: Select **Dockerfile**.
5. Instance type: Select **Eco (Free / Nano)**.
6. Scroll down to **Environment Variables** and add:
   * `MEET_URL` = `https://meet.google.com/YOUR-MEET-CODE`
   * `DASHBOARD_URL` = `https://kabilalibrary.web.app/#dashboard`
   * `BOT_NAME` = `🏛️ Kabila 24/7 Live Routine`
7. Click **Deploy**.

---

## 🟢 Features
- **Zero Card Required**: Runs entirely on Koyeb's Free Eco tier.
- **24/7 Auto-Recovery**: Reconnects automatically if disconnected.
- **Health Check Endpoint**: Provides real-time status and uptime monitoring at `/`.
- **Muted by Default**: Enters with mic and camera disabled to keep the study room silent.
