# GearOps — Equipment Dashboard

A local network dashboard for managing production gear — cameras, encoders, ATEMs, HyperDecks, computers, and more. Runs entirely on your local machine; no cloud account required.

> **LAN-only tool.** Do not expose port 8080 to the internet.

---

## Requirements

| Software | Notes |
|----------|-------|
| [Node.js](https://nodejs.org) | Required |
| [Git](https://git-scm.com) | Required |
| [FFmpeg](https://www.gyan.dev/ffmpeg/builds/) | Capture preview only — extract and place `ffmpeg.exe` at `C:\ffmpeg\bin\ffmpeg.exe` |
| [Brave Browser](https://brave.com) | Popout feature only |

---

## Installation

```bash
git clone https://github.com/markbritton-hue/gearops.git
cd gearops
npm install
```

---

## Configuration

```bash
copy local.config.example.js local.config.js
```

Edit `local.config.js` and fill in:
- Paths to local apps you want to launch (OBS, ATEM Software Control, HyperDeck Utility, etc.)
- Brave browser path (for the popout feature)
- Companion host/port (optional — for live variable badges)

---

## Running

Double-click **`start.bat`** or from a terminal:

```bash
node server.js
```

Then open: **http://localhost:8080**

---

## First-time setup

On first run `devices.json` is empty. Open **http://localhost:8080/setup.html** and choose:

**Import from Google Sheets** — prepare a sheet with your equipment list, share it publicly (view only), paste the URL, map your columns, and import.

**Add manually** — go to the main dashboard, click **Edit**, then **Add Device**.

---

## Pages

### Dashboard — `/`
- Equipment cards with IP, status badges, credentials, and action buttons
- Filter by category, search by name or IP, sort by name / category / status / IP
- Online/offline monitoring — devices are pinged on a configurable interval
- **Browse** opens a device's web UI in a new tab
- **Popout** opens it in a Brave app window (bypasses iframe restrictions)
- **Launch** starts a local application directly
- **Edit mode** — add, edit, or delete device cards

### Control Room — `/capture.html`
- Live capture preview via FFmpeg (select your capture card)
- Embedded browser panel for streams or device UIs
- Equipment status sidebar with expandable device details
- Production clock / timecode display

### Setup — `/setup.html`
- Landing page for manual setup or Google Sheets import
- Re-run any time to bulk-add or re-import devices

---

## Accessing from other devices

Find your machine's IP with `ipconfig` (look for IPv4 Address, e.g. `192.168.0.121`).

Any device on the same network can open: **http://192.168.0.121:8080**

**Add to iPad home screen:** open in Safari → Share → Add to Home Screen.

---

## Moving to a new machine

1. Install requirements above
2. Clone the repo and run `npm install`
3. Copy `local.config.js` and `devices.json` from the old machine
4. Run `start.bat`

`devices.json` is gitignored — back it up separately.
