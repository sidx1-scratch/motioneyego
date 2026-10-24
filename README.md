# MotionEyeGo 👁️🥽

> **MotionEye & Frigate NVR surveillance viewer designed specifically for the Oculus Go VR browser, featuring hands-free gaze control and zero dependencies.**

---

## 📖 Overview

**MotionEyeGo** is a lightweight web application hosted on a local or remote server that transforms your standalone **Oculus Go** (or any browser/VR headset) into an immersive surveillance monitoring station.

It connects to your **MotionEye** MJPEG video feeds and can link with **Frigate NVR** to display real-time AI object detection events (people, cars, animals, packages).

### 🌟 Key Highlights
- **Engineered for Oculus Go**: Designed for the Oculus Go Browser (3DoF head tracking pointer) with high contrast, large targets, and hands-free dwell gaze navigation.
- **Zero Dependencies**: Pure Node.js standard library backend and native vanilla HTML, CSS, and JS frontend. No `node_modules` required!
- **Built-in Custom `.env` Parser**: Handcrafted `.env` parser written from scratch with quote stripping, multiline support, and fallback mechanisms.
- **MJPEG Reverse Proxy**: Avoids CORS and mixed-content issues on modern browsers and VR web engines by proxying camera streams securely.
- **Frigate NVR Detection Feeds**: Slide-in telemetry panel with thumbnails, timestamps, and confidence scores from Frigate object detection.
- **Viewing Modes**: Supports **Grid View**, **Solo / Fullscreen**, and hands-free **Auto-Cycling**.

---

## 🚀 Quick Start

### 1. Requirements
- Node.js (version 14.x or newer recommended)
- Nothing else! (Zero npm dependencies)

### 2. Configuration
Copy `.env.example` to `.env` and fill in your camera stream URLs:
```bash
cp .env.example .env
```

Edit `.env`:
```ini
# Server Configuration
PORT=3000
HOST=0.0.0.0

# MotionEye MJPEG Streams (comma-separated Name|URL pairs)
STREAMS=Driveway|http://192.168.1.100:8081,FrontDoor|http://192.168.1.100:8082,Backyard|http://192.168.1.100:8083

# MotionEye Server (optional)
MOTIONEYE_URL=http://192.168.1.100:8765
MOTIONEYE_USERNAME=admin
MOTIONEYE_PASSWORD=

# Frigate NVR (optional detection alerts)
FRIGATE_URL=http://192.168.1.100:5000
FRIGATE_ENABLED=true
```

### 3. Run the Server
Launch the server using `npm start`:
```bash
npm start
```
The server will bind to `0.0.0.0:3000` (or your configured port).

---

## 🥽 Using with Oculus Go

1. **Host on your LAN**: Ensure the server hosting MotionEyeGo is on the same local network as your Oculus Go (or reachable via VPN/Tailscale).
2. **Put on your Oculus Go**: Open the built-in **Oculus Browser**.
3. **Navigate to the server**: Enter `http://<SERVER-IP>:3000` into the address bar.
4. **Hands-free Gaze Interaction**:
   - Aim the central reticle at any button, menu item, or camera tile.
   - Hold your gaze steady for the dwell duration (~1 second).
   - The circular reticle fills up and automatically activates the button!
   - You can toggle the reticle or adjust dwell timing in **Settings** (⚙).

---

## ⌨️ Desktop / Keyboard Controls (Testing)

| Key | Action |
| --- | --- |
| `G` | Switch to **Grid View** |
| `F` | Switch to **Fullscreen / Solo View** |
| `C` | Toggle **Auto-Cycling** between cameras |
| `D` | Toggle **Frigate Detection Alerts** panel |
| `S` | Toggle **Settings Modal** |
| `←` / `→` | Switch active camera stream |
| `Esc` | Close modal or alerts panel |

---

## 📁 Project Architecture

```
motioneyego/
├── .env                  # Camera streams & server configuration
├── .env.example          # Template configuration
├── LICENSE               # MIT License
├── package.json          # Project metadata & npm start script (no deps)
├── README.md             # Documentation
├── server.js             # Zero-dependency HTTP server & proxy
└── public/
    ├── index.html        # Single-page UI with VR layout
    ├── css/
    │   └── styles.css    # Oculus Go dark theme & gaze reticle styling
    └── js/
        ├── app.js        # Main UI state, stream loader & shortcuts
        ├── frigate.js    # Frigate NVR client & detection events
        └── gaze.js       # Gaze controller & dwell-timer engine
```

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
