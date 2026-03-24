# Japanese Subtitle Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Windows Electron desktop app that plays Japanese video without subtitles and shows English translations for the last 5 seconds on demand.

**Architecture:** Electron shell with a Python subprocess (openai-whisper + yt-dlp via uv) for transcription. Main process handles file I/O, caching, and IPC. Renderer handles all UI. Cache lives in `%APPDATA%/translate/cache/` with a JSON index.

**Tech Stack:** Electron 28+, Node.js, Python 3.10+ via uv, openai-whisper, yt-dlp

---

## File Map

| File | Responsibility |
|---|---|
| `main.js` | Electron app bootstrap, window creation, IPC handler registration, protocol handler, startup check, before-quit cleanup |
| `cache.js` | SRT parsing, cache key derivation, index.json read/write, settings read/write |
| `worker.js` | Subprocess spawning, stdout streaming, cancel, partial file cleanup |
| `preload.js` | contextBridge IPC surface (renderer ↔ main) |
| `renderer/index.html` | App shell HTML |
| `renderer/styles.css` | All UI styles |
| `renderer/app.js` | Home screen, processing UI, video player — single state machine |
| `whisper_worker.py` | CLI: yt-dlp download + Whisper transcription, JSON line progress output |
| `pyproject.toml` | uv project: openai-whisper, yt-dlp |
| `package.json` | Electron dependency + start script |

---

## Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `pyproject.toml`
- Create: `main.js`
- Create: `preload.js`
- Create: `renderer/index.html`
- Create: `renderer/styles.css`
- Create: `renderer/app.js`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "translate",
  "version": "1.0.0",
  "main": "main.js",
  "scripts": {
    "start": "electron ."
  },
  "dependencies": {
    "electron": "^28.0.0"
  }
}
```

- [ ] **Step 2: Install Electron**

```bash
npm install
```

Expected: `node_modules/` created, no errors.

- [ ] **Step 3: Create pyproject.toml**

```toml
[project]
name = "translate"
version = "1.0.0"
requires-python = ">=3.10"
dependencies = [
    "openai-whisper",
    "yt-dlp",
]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"
```

- [ ] **Step 4: Install Python dependencies**

```bash
uv sync
```

Expected: `.venv/` created, openai-whisper and yt-dlp installed.

- [ ] **Step 5: Create main.js (minimal)**

```js
const { app, BrowserWindow } = require('electron')
const path = require('path')

function createWindow() {
  const win = new BrowserWindow({
    width: 1024,
    height: 768,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  win.loadFile('renderer/index.html')
}

app.whenReady().then(createWindow)
app.on('window-all-closed', () => app.quit())
```

- [ ] **Step 6: Create preload.js (minimal)**

```js
const { contextBridge } = require('electron')
contextBridge.exposeInMainWorld('api', {})
```

- [ ] **Step 7: Create renderer/index.html**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; media-src translate:; script-src 'self'; style-src 'self' 'unsafe-inline'">
  <title>Translate</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <div id="app"></div>
  <script src="app.js"></script>
</body>
</html>
```

- [ ] **Step 8: Create renderer/styles.css (base)**

```css
* { box-sizing: border-box; margin: 0; padding: 0; }
body { background: #0d0d0d; color: #ccc; font-family: sans-serif; height: 100vh; overflow: hidden; }
#app { height: 100vh; display: flex; flex-direction: column; }
```

- [ ] **Step 9: Create renderer/app.js (stub)**

```js
document.getElementById('app').textContent = 'Translate — loading...'
```

- [ ] **Step 10: Verify app opens**

```bash
npm start
```

Expected: Electron window opens showing "Translate — loading...". No console errors.

- [ ] **Step 11: Commit**

```bash
git add package.json package-lock.json pyproject.toml uv.lock main.js preload.js renderer/
git commit -m "feat: scaffold Electron app and Python project"
```

---

## Task 2: cache.js — Settings, Key Derivation, Index, SRT Parser

**Files:**
- Create: `cache.js`

- [ ] **Step 1: Create cache.js**

```js
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { app } = require('electron')

const SETTINGS_PATH = path.join(app.getPath('userData'), 'settings.json')
const DEFAULT_CACHE_DIR = path.join(app.getPath('userData'), 'cache')

function loadSettings() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'))
  } catch {
    return { cacheDir: DEFAULT_CACHE_DIR, model: 'base' }
  }
}

function saveSettings(settings) {
  fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true })
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2))
}

function getCacheDir() {
  return loadSettings().cacheDir
}

function ensureCacheDir(cacheDir) {
  fs.mkdirSync(cacheDir, { recursive: true })
}

function isCacheDirWritable(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true })
    const test = path.join(dir, '.write-test')
    fs.writeFileSync(test, '')
    fs.unlinkSync(test)
    return true
  } catch {
    return false
  }
}

function localKey(absPath) {
  const hash = crypto.createHash('sha256').update(absPath).digest('hex').slice(0, 16)
  return `local:${hash}`
}

function youtubeKey(videoId) {
  return `yt:${videoId}`
}

function extractVideoId(url) {
  const match = url.match(/(?:v=|youtu\.be\/|shorts\/)([a-zA-Z0-9_-]{11})/)
  return match ? match[1] : null
}

function keyToFilename(key) {
  // strips "local:" or "yt:" prefix
  return key.replace(/^(local:|yt:)/, '')
}

function indexPath(cacheDir) {
  return path.join(cacheDir, 'index.json')
}

function readIndex(cacheDir) {
  try {
    return JSON.parse(fs.readFileSync(indexPath(cacheDir), 'utf8'))
  } catch {
    return {}
  }
}

function writeIndex(cacheDir, entries) {
  ensureCacheDir(cacheDir)
  fs.writeFileSync(indexPath(cacheDir), JSON.stringify(entries, null, 2))
}

function setEntry(cacheDir, key, data) {
  const entries = readIndex(cacheDir)
  entries[key] = data
  writeIndex(cacheDir, entries)
}

function deleteEntries(cacheDir, keys) {
  const entries = readIndex(cacheDir)
  for (const key of keys) {
    const entry = entries[key]
    if (!entry) continue
    for (const field of ['srt_path', 'video_path']) {
      if (entry[field] && entry.source !== 'local') {
        // only delete video_path for youtube (local video_path is the user's original file)
        if (field === 'video_path' && entry.source === 'local') continue
        try { fs.unlinkSync(entry[field]) } catch {}
      }
      if (field === 'srt_path' && entry[field]) {
        try { fs.unlinkSync(entry[field]) } catch {}
      }
    }
    delete entries[key]
  }
  writeIndex(cacheDir, entries)
}

function parseSrt(content) {
  const subtitles = []
  const blocks = content.trim().split(/\n\s*\n/)
  for (const block of blocks) {
    const lines = block.trim().split('\n')
    if (lines.length < 3) continue
    const tsLine = lines[1]
    const match = tsLine.match(
      /(\d{2}):(\d{2}):(\d{2}),(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2}),(\d{3})/
    )
    if (!match) continue
    const toSec = (h, m, s, ms) => +h * 3600 + +m * 60 + +s + +ms / 1000
    const start = toSec(match[1], match[2], match[3], match[4])
    const end = toSec(match[5], match[6], match[7], match[8])
    const text = lines.slice(2).join(' ').replace(/<[^>]+>/g, '').trim()
    if (text) subtitles.push({ start, end, text })
  }
  return subtitles
}

function srtPath(cacheDir, key) {
  return path.join(cacheDir, keyToFilename(key) + '.srt')
}

function mp4Path(cacheDir, videoId) {
  return path.join(cacheDir, `${videoId}.mp4`)
}

module.exports = {
  loadSettings, saveSettings, getCacheDir, ensureCacheDir, isCacheDirWritable,
  localKey, youtubeKey, extractVideoId, keyToFilename,
  readIndex, writeIndex, setEntry, deleteEntries,
  parseSrt, srtPath, mp4Path,
}
```

- [ ] **Step 2: Verify module loads without error**

Add to `main.js` temporarily:
```js
const cache = require('./cache')
console.log(cache.parseSrt('1\n00:00:01,000 --> 00:00:02,500\nHello world\n'))
```

Run `npm start`, check DevTools console shows: `[{ start: 1, end: 2.5, text: 'Hello world' }]`

Remove the temporary lines after verifying.

- [ ] **Step 3: Commit**

```bash
git add cache.js main.js
git commit -m "feat: add cache module (settings, key derivation, index, SRT parser)"
```

---

## Task 3: translate:// Protocol Handler

**Files:**
- Modify: `main.js`

- [ ] **Step 1: Register protocol and serve files**

Add to `main.js` before `app.whenReady()`:

```js
const { protocol } = require('electron')

protocol.registerSchemesAsPrivileged([
  { scheme: 'translate', privileges: { secure: true, supportFetchAPI: true, stream: true } }
])
```

Add inside `app.whenReady()` before `createWindow()`:

```js
protocol.registerFileProtocol('translate', (request, callback) => {
  const filePath = request.url.replace('translate:///', '')
  callback({ path: decodeURIComponent(filePath) })
})
```

- [ ] **Step 2: Verify protocol serves a video**

Temporarily set video src in `renderer/app.js`:
```js
const v = document.createElement('video')
v.src = 'translate:///C:/Windows/Media/chimes.wav'  // any local file
v.controls = true
document.getElementById('app').appendChild(v)
```

Run `npm start`. Open DevTools Network tab and confirm the `translate://` request returns 200. Remove temp code after.

- [ ] **Step 3: Commit**

```bash
git add main.js
git commit -m "feat: register translate:// custom protocol for local file serving"
```

---

## Task 4: whisper_worker.py

**Files:**
- Create: `whisper_worker.py`

- [ ] **Step 1: Create whisper_worker.py**

```python
"""Transcribe/translate video audio to English SRT using Whisper.

Usage:
  Local:   uv run python whisper_worker.py --model base <video_path> <srt_path>
  YouTube: uv run python whisper_worker.py --youtube <url> --model base <mp4_path> <srt_path>
"""
import argparse
import json
import re
import subprocess
import sys
from pathlib import Path


def emit(obj):
    print(json.dumps(obj), flush=True)


def download_youtube(url: str, mp4_path: Path) -> None:
    cmd = [
        "yt-dlp",
        "--format", "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
        "--merge-output-format", "mp4",
        "--output", str(mp4_path),
        url,
    ]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    for line in proc.stdout:
        m = re.search(r'\[download\]\s+([\d.]+)%', line)
        if m:
            emit({"type": "progress", "phase": "download", "pct": int(float(m.group(1)))})
    proc.wait()
    if proc.returncode != 0:
        raise RuntimeError(f"yt-dlp exited with code {proc.returncode}")


def transcribe(audio_path: Path, srt_path: Path, model_name: str) -> None:
    import whisper
    import whisper.utils

    emit({"type": "progress", "phase": "transcribe"})
    model = whisper.load_model(model_name)
    result = model.transcribe(str(audio_path), task="translate", language="ja", fp16=False)
    writer = whisper.utils.get_writer("srt", str(srt_path.parent))
    writer(result, str(audio_path))
    if not srt_path.exists():
        raise RuntimeError(f"SRT not written to expected path: {srt_path}")
    emit({"type": "done", "srt_path": str(srt_path)})


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--youtube", metavar="URL", help="YouTube URL to download")
    parser.add_argument("--model", default="base")
    parser.add_argument("video_path")
    parser.add_argument("srt_path")
    args = parser.parse_args()

    video_path = Path(args.video_path)
    srt_path = Path(args.srt_path)

    try:
        if args.youtube:
            download_youtube(args.youtube, video_path)
        transcribe(video_path, srt_path, args.model)
    except Exception as e:
        emit({"type": "error", "message": str(e)})
        sys.exit(1)


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Verify worker runs on a local video**

```bash
uv run python whisper_worker.py --model tiny "C:/path/to/any/japanese/video.mp4" "C:/temp/test.srt"
```

Expected: JSON progress lines printed, then `{"type": "done", "srt_path": "C:/temp/test.srt"}`. `test.srt` exists and contains English text.

- [ ] **Step 3: Commit**

```bash
git add whisper_worker.py
git commit -m "feat: add whisper_worker.py for transcription and YouTube download"
```

---

## Task 5: worker.js — Subprocess Management

**Files:**
- Create: `worker.js`

- [ ] **Step 1: Create worker.js**

```js
const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')

let activeProcess = null
let partialFiles = []

function spawnWorker(args, onProgress, onDone, onError) {
  const proc = spawn('uv', ['run', 'python', path.join(__dirname, 'whisper_worker.py'), ...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  activeProcess = proc

  let buffer = ''
  proc.stdout.on('data', (chunk) => {
    buffer += chunk.toString()
    const lines = buffer.split('\n')
    buffer = lines.pop()
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const msg = JSON.parse(line)
        if (msg.type === 'progress') onProgress(msg)
        else if (msg.type === 'done') { activeProcess = null; onDone(msg) }
        else if (msg.type === 'error') { activeProcess = null; onError(msg.message) }
      } catch {}
    }
  })

  proc.stderr.on('data', (chunk) => {
    // stderr is noise from whisper/yt-dlp — ignore unless process fails
  })

  proc.on('close', (code) => {
    activeProcess = null
    if (code !== 0 && code !== null) onError(`Process exited with code ${code}`)
  })
}

function runLocal({ absPath, srtPath, model }, onProgress, onDone, onError) {
  partialFiles = [srtPath]
  spawnWorker(['--model', model, absPath, srtPath], onProgress, onDone, onError)
}

function runYoutube({ url, mp4Path, srtPath, model }, onProgress, onDone, onError) {
  partialFiles = [mp4Path, srtPath]
  spawnWorker(['--youtube', url, '--model', model, mp4Path, srtPath], onProgress, onDone, onError)
}

function cancel() {
  if (activeProcess) {
    activeProcess.kill()
    activeProcess = null
  }
  cleanupPartialFiles()
}

function cleanupPartialFiles() {
  for (const f of partialFiles) {
    try { fs.unlinkSync(f) } catch {}
  }
  partialFiles = []
}

function getActiveProcess() { return activeProcess }

module.exports = { runLocal, runYoutube, cancel, cleanupPartialFiles, getActiveProcess }
```

- [ ] **Step 2: Commit**

```bash
git add worker.js
git commit -m "feat: add worker.js subprocess manager"
```

---

## Task 6: preload.js — Full IPC Bridge

**Files:**
- Modify: `preload.js`

- [ ] **Step 1: Replace preload.js with full bridge**

```js
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  // invoke (request/response)
  openLocalFile: () => ipcRenderer.invoke('open-local-file'),
  loadYoutube: (url) => ipcRenderer.invoke('load-youtube', { url }),
  cancelProcessing: () => ipcRenderer.invoke('cancel-processing'),
  deleteCacheEntries: (keys) => ipcRenderer.invoke('delete-cache-entries', { keys }),
  getCacheIndex: () => ipcRenderer.invoke('get-cache-index'),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  changeCacheDir: () => ipcRenderer.invoke('change-cache-dir'),
  changeModel: (model) => ipcRenderer.invoke('change-model', { model }),

  // push events (main → renderer)
  onProgress: (cb) => ipcRenderer.on('processing-progress', (_, data) => cb(data)),
  onDone: (cb) => ipcRenderer.on('processing-done', (_, data) => cb(data)),
  onError: (cb) => ipcRenderer.on('processing-error', (_, data) => cb(data)),
  onCacheIndex: (cb) => ipcRenderer.on('cache-index', (_, data) => cb(data)),

  // cleanup
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel),
})
```

- [ ] **Step 2: Commit**

```bash
git add preload.js
git commit -m "feat: expose full IPC bridge via contextBridge"
```

---

## Task 7: main.js — IPC Handlers + Startup Check + Before-Quit

**Files:**
- Modify: `main.js`

- [ ] **Step 1: Replace main.js with full implementation**

```js
const { app, BrowserWindow, ipcMain, dialog, protocol } = require('electron')
const path = require('path')
const { execSync } = require('child_process')
const cache = require('./cache')
const worker = require('./worker')

protocol.registerSchemesAsPrivileged([
  { scheme: 'translate', privileges: { secure: true, supportFetchAPI: true, stream: true } }
])

let mainWindow = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    backgroundColor: '#0d0d0d',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  mainWindow.loadFile('renderer/index.html')
}

function checkUv() {
  try {
    execSync('uv --version', { stdio: 'ignore' })
  } catch {
    dialog.showErrorBoxSync(
      'Missing dependency: uv',
      'uv is not installed or not on PATH.\n\nInstall it from: https://docs.astral.sh/uv/\n\nThe app will now exit.'
    )
    app.exit(1)
  }
}

app.whenReady().then(() => {
  checkUv()

  protocol.registerFileProtocol('translate', (request, callback) => {
    const filePath = decodeURIComponent(request.url.replace('translate:///', ''))
    callback({ path: filePath })
  })

  createWindow()
  registerIpcHandlers()
})

app.on('window-all-closed', () => app.quit())

app.on('before-quit', () => {
  worker.cancel()
})

function send(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data)
  }
}

function registerIpcHandlers() {
  ipcMain.handle('get-settings', () => cache.loadSettings())

  ipcMain.handle('change-model', (_, { model }) => {
    const s = cache.loadSettings()
    cache.saveSettings({ ...s, model })
  })

  ipcMain.handle('change-cache-dir', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] })
    if (result.canceled) return { canceled: true }
    const dir = result.filePaths[0]
    if (!cache.isCacheDirWritable(dir)) {
      return { error: 'Directory is not writable.' }
    }
    const s = cache.loadSettings()
    cache.saveSettings({ ...s, cacheDir: dir })
    return { cacheDir: dir }
  })

  ipcMain.handle('get-cache-index', () => {
    const cacheDir = cache.getCacheDir()
    return cache.readIndex(cacheDir)
  })

  ipcMain.handle('delete-cache-entries', (_, { keys }) => {
    const cacheDir = cache.getCacheDir()
    cache.deleteEntries(cacheDir, keys)
    return cache.readIndex(cacheDir)
  })

  ipcMain.handle('open-local-file', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [{ name: 'Video', extensions: ['mp4', 'mkv', 'avi', 'mov', 'webm'] }],
    })
    if (result.canceled) return null
    return handleLocalFile(result.filePaths[0])
  })

  ipcMain.handle('load-youtube', (_, { url }) => {
    const videoId = cache.extractVideoId(url)
    if (!videoId) return { error: 'Could not extract video ID from URL.' }
    return handleYoutube(url, videoId)
  })

  ipcMain.handle('cancel-processing', () => {
    worker.cancel()
  })
}

function handleLocalFile(absPath) {
  const cacheDir = cache.getCacheDir()
  cache.ensureCacheDir(cacheDir)
  const key = cache.localKey(absPath)
  const srtFile = cache.srtPath(cacheDir, key)
  const entry = cache.readIndex(cacheDir)[key]

  if (entry && require('fs').existsSync(srtFile)) {
    const subtitles = cache.parseSrt(require('fs').readFileSync(srtFile, 'utf8'))
    return { hit: true, subtitles, videoPath: absPath, key }
  }

  const { model } = cache.loadSettings()
  const title = require('path').basename(absPath, require('path').extname(absPath))

  return new Promise((resolve) => {
    worker.runLocal(
      { absPath, srtPath: srtFile, model },
      (progress) => send('processing-progress', progress),
      (msg) => {
        const subtitles = cache.parseSrt(require('fs').readFileSync(srtFile, 'utf8'))
        cache.setEntry(cacheDir, key, {
          title,
          date: new Date().toISOString(),
          srt_path: srtFile,
          video_path: absPath,
          source: 'local',
        })
        send('processing-done', { subtitles, videoPath: absPath })
        resolve({ hit: false })
      },
      (message) => {
        send('processing-error', { message })
        resolve({ hit: false })
      }
    )
  })
}

function handleYoutube(url, videoId) {
  const cacheDir = cache.getCacheDir()
  cache.ensureCacheDir(cacheDir)
  const key = cache.youtubeKey(videoId)
  const srtFile = cache.srtPath(cacheDir, key)
  const mp4File = cache.mp4Path(cacheDir, videoId)
  const entries = cache.readIndex(cacheDir)

  if (entries[key] && require('fs').existsSync(srtFile) && require('fs').existsSync(mp4File)) {
    const subtitles = cache.parseSrt(require('fs').readFileSync(srtFile, 'utf8'))
    return { hit: true, subtitles, videoPath: mp4File, key }
  }

  const { model } = cache.loadSettings()

  return new Promise((resolve) => {
    worker.runYoutube(
      { url, mp4Path: mp4File, srtPath: srtFile, model },
      (progress) => send('processing-progress', progress),
      (msg) => {
        const subtitles = cache.parseSrt(require('fs').readFileSync(srtFile, 'utf8'))
        cache.setEntry(cacheDir, key, {
          title: videoId,
          url,
          date: new Date().toISOString(),
          srt_path: srtFile,
          video_path: mp4File,
          source: 'youtube',
        })
        send('processing-done', { subtitles, videoPath: mp4File })
        resolve({ hit: false })
      },
      (message) => {
        send('processing-error', { message })
        resolve({ hit: false })
      }
    )
  })
}
```

- [ ] **Step 2: Verify app still starts**

```bash
npm start
```

Expected: window opens, no errors in terminal or DevTools console.

- [ ] **Step 3: Commit**

```bash
git add main.js
git commit -m "feat: add IPC handlers, startup uv check, before-quit cleanup"
```

---

## Task 8: Renderer — Home Screen

**Files:**
- Modify: `renderer/app.js`
- Modify: `renderer/styles.css`

- [ ] **Step 1: Add home screen CSS to styles.css**

```css
/* ── Layout ── */
.screen { display: none; flex-direction: column; height: 100vh; }
.screen.active { display: flex; }

/* ── Home ── */
.home { padding: 24px; gap: 16px; }
.home-header { display: flex; justify-content: space-between; align-items: center; }
.home-header h1 { font-size: 18px; font-weight: 600; color: #fff; }
.gear-btn { background: none; border: none; color: #666; font-size: 20px; cursor: pointer; padding: 4px 8px; }
.gear-btn:hover { color: #ccc; }

/* ── Tabs ── */
.tabs { display: flex; border-bottom: 1px solid #333; }
.tab { padding: 10px 20px; background: none; border: none; color: #666; font-size: 13px; cursor: pointer; }
.tab.active { color: #fff; background: #222; border-radius: 4px 4px 0 0; }
.tab-panel { display: none; padding: 16px 0; }
.tab-panel.active { display: block; }

/* ── Drop zone ── */
.drop-zone { border: 2px dashed #333; border-radius: 8px; padding: 40px; text-align: center; color: #555; font-size: 13px; cursor: pointer; transition: border-color 0.2s; }
.drop-zone:hover, .drop-zone.drag-over { border-color: #666; color: #aaa; }
.drop-zone .icon { font-size: 32px; margin-bottom: 8px; }
.browse-btn { display: inline-block; margin-top: 10px; background: #222; border: 1px solid #444; color: #ccc; padding: 6px 16px; border-radius: 4px; font-size: 12px; cursor: pointer; }

/* ── YouTube input ── */
.yt-row { display: flex; gap: 8px; }
.yt-input { flex: 1; background: #1a1a1a; border: 1px solid #333; color: #ccc; padding: 8px 12px; border-radius: 4px; font-size: 13px; }
.load-btn { background: #c0392b; color: #fff; border: none; padding: 8px 18px; border-radius: 4px; font-size: 13px; cursor: pointer; }
.load-btn:hover { background: #e74c3c; }

/* ── Recently translated ── */
.list-header { display: flex; align-items: center; justify-content: space-between; margin: 20px 0 8px; }
.list-header-left { display: flex; align-items: center; gap: 10px; }
.list-label { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: #555; }
.delete-selected-btn { display: none; background: #c0392b; color: #fff; border: none; padding: 4px 12px; border-radius: 4px; font-size: 11px; cursor: pointer; }
.delete-selected-btn.visible { display: inline-block; }
.select-all-cb { display: none; }
.select-all-cb.visible { display: inline-block; }

.cache-list { display: flex; flex-direction: column; gap: 4px; max-height: 260px; overflow-y: auto; }
.cache-item { display: flex; align-items: center; gap: 10px; background: #1a1a1a; border-radius: 4px; padding: 8px 12px; cursor: pointer; }
.cache-item:hover { background: #222; }
.cache-item-cb { opacity: 0; cursor: pointer; flex-shrink: 0; }
.cache-item:hover .cache-item-cb, .cache-item-cb:checked, .cache-item-cb.show { opacity: 1; }
.cache-item-info { flex: 1; }
.cache-item-title { font-size: 13px; color: #ccc; }
.cache-item-meta { font-size: 10px; color: #555; font-family: monospace; }
.cache-badge { background: #1a3a1a; color: #4f4; font-size: 9px; padding: 2px 6px; border-radius: 3px; font-family: monospace; flex-shrink: 0; }

/* ── Settings panel ── */
.settings-panel { display: none; background: #111; border: 1px solid #2a2a2a; border-radius: 8px; padding: 16px; margin-top: 12px; }
.settings-panel.visible { display: block; }
.settings-row { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
.settings-label { font-size: 12px; color: #888; width: 110px; flex-shrink: 0; }
.settings-value { font-size: 12px; color: #ccc; flex: 1; font-family: monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.settings-btn { background: #222; border: 1px solid #444; color: #ccc; padding: 4px 12px; border-radius: 4px; font-size: 11px; cursor: pointer; }
.model-select { background: #1a1a1a; border: 1px solid #333; color: #ccc; padding: 4px 8px; border-radius: 4px; font-size: 12px; }
.settings-error { color: #e74c3c; font-size: 11px; margin-top: 4px; }
```

- [ ] **Step 2: Replace renderer/app.js with home screen logic**

```js
// ── State ──────────────────────────────────────────────────────────────
let state = {
  screen: 'home',      // 'home' | 'processing' | 'player'
  subtitles: [],
  videoPath: null,
  settingsVisible: false,
  settings: { cacheDir: '', model: 'base' },
  cacheEntries: {},
  selectedKeys: new Set(),
}

// ── Init ───────────────────────────────────────────────────────────────
async function init() {
  state.settings = await window.api.getSettings()
  state.cacheEntries = await window.api.getCacheIndex()
  renderHome()

  window.api.onProgress((data) => handleProgress(data))
  window.api.onDone((data) => handleDone(data))
  window.api.onError((data) => handleError(data))
}

// ── Screens ────────────────────────────────────────────────────────────
function renderHome() {
  state.screen = 'home'
  state.selectedKeys.clear()
  document.getElementById('app').innerHTML = homeHTML()
  bindHomeEvents()
}

function homeHTML() {
  const entries = Object.entries(state.cacheEntries)
    .sort((a, b) => new Date(b[1].date) - new Date(a[1].date))
    .slice(0, 50)
  const hasSelected = state.selectedKeys.size > 0

  return `
<div class="screen home active">
  <div class="home-header">
    <h1>Translate</h1>
    <button class="gear-btn" id="gear-btn">⚙</button>
  </div>

  <div class="settings-panel ${state.settingsVisible ? 'visible' : ''}" id="settings-panel">
    <div class="settings-row">
      <span class="settings-label">Cache location</span>
      <span class="settings-value" id="cache-dir-val">${state.settings.cacheDir}</span>
      <button class="settings-btn" id="change-dir-btn">Change</button>
    </div>
    <div id="settings-error" class="settings-error"></div>
    <div class="settings-row">
      <span class="settings-label">Whisper model</span>
      <select class="model-select" id="model-select">
        ${['tiny','base','small','medium','large'].map(m =>
          `<option value="${m}" ${m === state.settings.model ? 'selected' : ''}>${m}</option>`
        ).join('')}
      </select>
    </div>
  </div>

  <div class="tabs">
    <button class="tab active" data-tab="local">Local File</button>
    <button class="tab" data-tab="youtube">YouTube URL</button>
  </div>
  <div class="tab-panel active" id="tab-local">
    <div class="drop-zone" id="drop-zone">
      <div class="icon">+</div>
      Drop a video file here<br>
      <button class="browse-btn" id="browse-btn">Browse files</button>
    </div>
  </div>
  <div class="tab-panel" id="tab-youtube">
    <div class="yt-row">
      <input class="yt-input" id="yt-input" placeholder="https://www.youtube.com/watch?v=..." />
      <button class="load-btn" id="yt-load-btn">Load</button>
    </div>
  </div>

  <div class="list-header">
    <div class="list-header-left">
      <input type="checkbox" class="select-all-cb ${hasSelected ? 'visible' : ''}" id="select-all-cb">
      <span class="list-label">Recently translated</span>
    </div>
    <button class="delete-selected-btn ${hasSelected ? 'visible' : ''}" id="delete-btn">
      Delete selected (${state.selectedKeys.size})
    </button>
  </div>
  <div class="cache-list" id="cache-list">
    ${entries.length === 0 ? '<span style="color:#444;font-size:12px;">No translations yet</span>' : ''}
    ${entries.map(([key, e]) => `
      <div class="cache-item" data-key="${key}">
        <input type="checkbox" class="cache-item-cb ${hasSelected ? 'show' : ''}"
               data-key="${key}" ${state.selectedKeys.has(key) ? 'checked' : ''}>
        <div class="cache-item-info">
          <div class="cache-item-title">${e.title}</div>
          <div class="cache-item-meta">${e.source} · ${new Date(e.date).toLocaleDateString()}</div>
        </div>
        <span class="cache-badge">CACHED</span>
      </div>
    `).join('')}
  </div>
</div>`
}

function bindHomeEvents() {
  // Tabs
  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'))
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'))
      btn.classList.add('active')
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active')
    })
  })

  // Gear / settings
  document.getElementById('gear-btn').addEventListener('click', () => {
    state.settingsVisible = !state.settingsVisible
    document.getElementById('settings-panel').classList.toggle('visible', state.settingsVisible)
  })

  // Change cache dir
  document.getElementById('change-dir-btn').addEventListener('click', async () => {
    const result = await window.api.changeCacheDir()
    if (result && result.error) {
      document.getElementById('settings-error').textContent = result.error
    } else if (result && result.cacheDir) {
      state.settings.cacheDir = result.cacheDir
      document.getElementById('cache-dir-val').textContent = result.cacheDir
      document.getElementById('settings-error').textContent = ''
    }
  })

  // Model select
  document.getElementById('model-select').addEventListener('change', async (e) => {
    state.settings.model = e.target.value
    await window.api.changeModel(e.target.value)
  })

  // Browse files
  document.getElementById('browse-btn').addEventListener('click', async () => {
    await window.api.openLocalFile()
    // processing handled via onProgress/onDone/onError events
    // if cache hit, main returns {hit:true} and sends processing-done synchronously
  })

  // Drop zone
  // In Electron, the File object in the renderer has a .path property with the full filesystem path
  const dz = document.getElementById('drop-zone')
  dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('drag-over') })
  dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'))
  dz.addEventListener('drop', (e) => {
    e.preventDefault()
    dz.classList.remove('drag-over')
    const file = e.dataTransfer.files[0]
    if (file && file.path) window.api.loadLocalPath(file.path)
  })

  // YouTube load
  document.getElementById('yt-load-btn').addEventListener('click', async () => {
    const url = document.getElementById('yt-input').value.trim()
    if (!url) return
    await window.api.loadYoutube(url)
  })

  // Cache item click (load)
  document.getElementById('cache-list').addEventListener('click', async (e) => {
    const cb = e.target.closest('input[type=checkbox]')
    if (cb) {
      e.stopPropagation()
      const key = cb.dataset.key
      if (cb.checked) state.selectedKeys.add(key)
      else state.selectedKeys.delete(key)
      renderHome()
      return
    }
    const item = e.target.closest('.cache-item')
    if (item && !e.target.matches('input')) {
      const key = item.dataset.key
      const entry = state.cacheEntries[key]
      if (!entry) return
      if (entry.source === 'local') await window.api.openLocalFile()
      else await window.api.loadYoutube(entry.url)
    }
  })

  // Select all
  const selectAll = document.getElementById('select-all-cb')
  if (selectAll) {
    selectAll.addEventListener('change', () => {
      const allKeys = Object.keys(state.cacheEntries)
      if (selectAll.checked) allKeys.forEach(k => state.selectedKeys.add(k))
      else state.selectedKeys.clear()
      renderHome()
    })
  }

  // Delete selected
  const deleteBtn = document.getElementById('delete-btn')
  if (deleteBtn) {
    deleteBtn.addEventListener('click', async () => {
      if (!state.selectedKeys.size) return
      const remaining = await window.api.deleteCacheEntries([...state.selectedKeys])
      state.cacheEntries = remaining
      state.selectedKeys.clear()
      renderHome()
    })
  }
}

// ── Event handlers ─────────────────────────────────────────────────────
function handleProgress(data) {
  if (state.screen !== 'processing') renderProcessing()
  updateProgress(data)
}

function handleDone(data) {
  state.subtitles = data.subtitles
  state.videoPath = data.videoPath
  window.api.getCacheIndex().then(idx => { state.cacheEntries = idx })
  renderPlayer()
}

function handleError(data) {
  if (state.screen !== 'home') renderHome()
  alert(`Error: ${data.message}`)
}

init()
```

- [ ] **Step 3: Verify home screen renders**

```bash
npm start
```

Expected: home screen with Local File/YouTube tabs, gear icon, empty "Recently translated" list. No console errors.

- [ ] **Step 4: Commit**

```bash
git add renderer/app.js renderer/styles.css
git commit -m "feat: render home screen with tabs, settings, and cache list"
```

---

## Task 9: Renderer — Processing Screen

**Files:**
- Modify: `renderer/app.js`
- Modify: `renderer/styles.css`

- [ ] **Step 1: Add processing CSS to styles.css**

```css
/* ── Processing ── */
.processing { align-items: center; justify-content: center; gap: 20px; }
.processing-title { font-size: 16px; color: #fff; }
.phase-label { font-size: 13px; color: #888; }
.progress-bar-wrap { width: 320px; height: 6px; background: #222; border-radius: 3px; }
.progress-bar-fill { height: 100%; background: #c0392b; border-radius: 3px; transition: width 0.3s; }
.spinner { width: 32px; height: 32px; border: 3px solid #333; border-top-color: #c0392b; border-radius: 50%; animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.cancel-btn { background: #222; border: 1px solid #444; color: #ccc; padding: 8px 20px; border-radius: 4px; font-size: 13px; cursor: pointer; }
.cancel-btn:hover { background: #2a2a2a; }
```

- [ ] **Step 2: Add processing screen functions to app.js**

Add these functions to `renderer/app.js` after `bindHomeEvents`:

```js
function renderProcessing() {
  state.screen = 'processing'
  document.getElementById('app').innerHTML = `
<div class="screen processing active">
  <div class="processing-title">Processing video…</div>
  <div class="phase-label" id="phase-label">Starting…</div>
  <div id="progress-area">
    <div class="spinner"></div>
  </div>
  <button class="cancel-btn" id="cancel-btn">Cancel</button>
</div>`
  document.getElementById('cancel-btn').addEventListener('click', async () => {
    await window.api.cancelProcessing()
    renderHome()
  })
}

function updateProgress(data) {
  const label = document.getElementById('phase-label')
  const area = document.getElementById('progress-area')
  if (!label || !area) return

  if (data.phase === 'download' && data.pct !== undefined) {
    label.textContent = `Downloading… ${data.pct}%`
    area.innerHTML = `
      <div class="progress-bar-wrap">
        <div class="progress-bar-fill" style="width:${data.pct}%"></div>
      </div>`
  } else if (data.phase === 'transcribe') {
    label.textContent = 'Transcribing…'
    area.innerHTML = '<div class="spinner"></div>'
  }
}
```

- [ ] **Step 3: Verify processing screen (simulate)**

Temporarily in `init()`, call `renderProcessing()` then `updateProgress({phase:'download',pct:45})`.
Run `npm start`. Confirm progress bar at 45% shows. Then simulate transcribe phase.
Remove temp code after.

- [ ] **Step 4: Commit**

```bash
git add renderer/app.js renderer/styles.css
git commit -m "feat: add processing screen with progress bar and cancel"
```

---

## Task 10: Renderer — Video Player

**Files:**
- Modify: `renderer/app.js`
- Modify: `renderer/styles.css`

- [ ] **Step 1: Add player CSS to styles.css**

```css
/* ── Player ── */
.player { background: #000; position: relative; }
.player video { flex: 1; width: 100%; display: block; background: #000; min-height: 0; }

.controls { display: flex; align-items: center; gap: 10px; padding: 10px 16px; background: #111; flex-shrink: 0; }
.ctrl-btn { background: none; border: none; color: #ccc; font-size: 18px; cursor: pointer; padding: 2px 6px; }
.ctrl-btn:hover { color: #fff; }
.seek-bar { flex: 1; height: 4px; background: #333; border-radius: 2px; cursor: pointer; position: relative; }
.seek-fill { height: 100%; background: #c0392b; border-radius: 2px; pointer-events: none; }
.time-display { font-size: 11px; color: #888; font-family: monospace; white-space: nowrap; }
.volume-slider { width: 70px; accent-color: #c0392b; }
.translate-btn { background: #c0392b; color: #fff; border: none; padding: 6px 14px; border-radius: 4px; font-size: 12px; cursor: pointer; font-weight: 600; }
.translate-btn:hover { background: #e74c3c; }

/* ── Subtitle overlay ── */
.subtitle-overlay { display: none; position: absolute; inset: 0; background: rgba(0,0,0,0.75); flex-direction: column; justify-content: center; align-items: center; padding: 32px; gap: 12px; z-index: 10; }
.subtitle-overlay.visible { display: flex; }
.subtitle-line { background: rgba(0,0,0,0.6); border-left: 3px solid #c0392b; border-radius: 4px; padding: 10px 16px; max-width: 700px; width: 100%; }
.subtitle-ts { font-size: 10px; color: #888; font-family: monospace; margin-bottom: 4px; }
.subtitle-text { font-size: 16px; color: #fff; line-height: 1.6; }
.subtitle-empty { color: #888; font-size: 14px; }
.overlay-hint { font-size: 11px; color: #555; margin-top: 8px; }
.back-btn { position: absolute; top: 12px; left: 12px; background: #222; border: 1px solid #333; color: #888; padding: 4px 10px; border-radius: 4px; font-size: 11px; cursor: pointer; }
```

- [ ] **Step 2: Add player functions to app.js**

```js
function renderPlayer() {
  state.screen = 'player'
  const videoUrl = `translate:///${state.videoPath.replace(/\\/g, '/')}`

  document.getElementById('app').innerHTML = `
<div class="screen player active">
  <button class="back-btn" id="back-btn">← Home</button>
  <video id="video" src="${videoUrl}"></video>
  <div class="subtitle-overlay" id="overlay">
    <div id="overlay-content"></div>
    <div class="overlay-hint">Press play or Space to continue</div>
  </div>
  <div class="controls">
    <button class="ctrl-btn" id="play-btn">▶</button>
    <div class="seek-bar" id="seek-bar">
      <div class="seek-fill" id="seek-fill" style="width:0%"></div>
    </div>
    <span class="time-display" id="time-display">0:00 / 0:00</span>
    <input type="range" class="volume-slider" id="vol" min="0" max="1" step="0.05" value="1">
    <button class="translate-btn" id="translate-btn">TRANSLATE</button>
  </div>
</div>`

  bindPlayerEvents()
}

function bindPlayerEvents() {
  const video = document.getElementById('video')
  const playBtn = document.getElementById('play-btn')
  const seekBar = document.getElementById('seek-bar')
  const seekFill = document.getElementById('seek-fill')
  const timeDisplay = document.getElementById('time-display')
  const vol = document.getElementById('vol')
  const translateBtn = document.getElementById('translate-btn')
  const overlay = document.getElementById('overlay')

  function fmt(s) {
    const m = Math.floor(s / 60)
    const sec = Math.floor(s % 60).toString().padStart(2, '0')
    return `${m}:${sec}`
  }

  function hideOverlay() {
    overlay.classList.remove('visible')
  }

  function resume() {
    hideOverlay()
    video.play()
  }

  playBtn.addEventListener('click', () => {
    if (video.paused) resume()
    else video.pause()
  })

  video.addEventListener('play', () => { playBtn.textContent = '⏸'; hideOverlay() })
  video.addEventListener('pause', () => { playBtn.textContent = '▶' })

  video.addEventListener('timeupdate', () => {
    if (!video.duration) return
    seekFill.style.width = `${(video.currentTime / video.duration) * 100}%`
    timeDisplay.textContent = `${fmt(video.currentTime)} / ${fmt(video.duration)}`
  })

  seekBar.addEventListener('click', (e) => {
    const rect = seekBar.getBoundingClientRect()
    video.currentTime = ((e.clientX - rect.left) / rect.width) * video.duration
    hideOverlay()
  })

  vol.addEventListener('input', () => { video.volume = vol.value })

  document.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && state.screen === 'player') {
      e.preventDefault()
      if (overlay.classList.contains('visible')) resume()
      else if (video.paused) resume()
      else video.pause()
    }
  })

  translateBtn.addEventListener('click', () => {
    video.pause()
    const t = video.currentTime
    const matches = state.subtitles.filter(s => s.end > t - 5 && s.start < t)
    const content = document.getElementById('overlay-content')
    if (matches.length === 0) {
      content.innerHTML = '<div class="subtitle-empty">No dialogue in this segment</div>'
    } else {
      content.innerHTML = matches.map(s => `
        <div class="subtitle-line">
          <div class="subtitle-ts">${fmt(s.start)} – ${fmt(s.end)}</div>
          <div class="subtitle-text">${s.text}</div>
        </div>`).join('')
    }
    overlay.classList.add('visible')
  })

  document.getElementById('back-btn').addEventListener('click', () => {
    video.pause()
    renderHome()
  })
}
```

- [ ] **Step 3: Verify player renders with a local video**

Temporarily in `init()`, after `state.settings = ...`:
```js
state.subtitles = [{start:1, end:3, text:'Test subtitle'}]
state.videoPath = 'C:/Windows/Media/chimes.wav'
renderPlayer()
```

Run `npm start`. Confirm custom controls appear, TRANSLATE button exists, overlay shows on click.
Remove temp code after.

- [ ] **Step 4: Commit**

```bash
git add renderer/app.js renderer/styles.css
git commit -m "feat: add video player with custom controls, TRANSLATE button, subtitle overlay"
```

---

## Task 11: Fix Cache-Hit Path for Recently Translated List

The main process `handleLocalFile` / `handleYoutube` return `{hit: true, ...}` synchronously for cache hits, but the renderer currently ignores the return value of `openLocalFile` / `loadYoutube` (relying on the `onDone` push event). We need to handle the cache-hit case where the invoke returns immediately with subtitles.

**Files:**
- Modify: `main.js`
- Modify: `renderer/app.js`

- [ ] **Step 1: Update main.js to send processing-done on cache hit**

In `handleLocalFile`, replace the HIT branch:

```js
if (entry && require('fs').existsSync(srtFile)) {
  const subtitles = cache.parseSrt(require('fs').readFileSync(srtFile, 'utf8'))
  // Send via push event so renderer handles uniformly
  setImmediate(() => send('processing-done', { subtitles, videoPath: absPath }))
  return { hit: true }
}
```

Do the same in `handleYoutube` HIT branch:

```js
if (entries[key] && require('fs').existsSync(srtFile) && require('fs').existsSync(mp4File)) {
  const subtitles = cache.parseSrt(require('fs').readFileSync(srtFile, 'utf8'))
  setImmediate(() => send('processing-done', { subtitles, videoPath: mp4File }))
  return { hit: true }
}
```

- [ ] **Step 2: Update cache-item click in app.js to load from entry directly**

Replace the cache item click handler in `bindHomeEvents`:

```js
const item = e.target.closest('.cache-item')
if (item && !e.target.matches('input')) {
  const key = item.dataset.key
  const entry = state.cacheEntries[key]
  if (!entry) return
  if (entry.source === 'local') {
    await window.api.openLocalFile()
    // Note: main process needs the path — for cached entries, trigger via a new IPC call
  } else {
    await window.api.loadYoutube(entry.url)
  }
}
```

Add a new IPC channel `load-cached` to `preload.js`:
```js
loadCached: (key) => ipcRenderer.invoke('load-cached', { key }),
```

Add handler in `main.js` `registerIpcHandlers()`:
```js
ipcMain.handle('load-cached', (_, { key }) => {
  const cacheDir = cache.getCacheDir()
  const entries = cache.readIndex(cacheDir)
  const entry = entries[key]
  if (!entry) return { error: 'Entry not found' }
  if (entry.source === 'local') return handleLocalFile(entry.video_path)
  if (entry.source === 'youtube') return handleYoutube(entry.url, cache.extractVideoId(entry.url))
})
```

Update cache item click to use `loadCached`. For local entries, the renderer cannot check `fs.existsSync` (no Node access), so the check is done in `handleLocalFile` in main.js. Add this guard at the top of `handleLocalFile` in `main.js`:

```js
// In handleLocalFile, before key derivation:
if (!require('fs').existsSync(absPath)) {
  setImmediate(() => send('processing-error', { message: `File not found at original path: ${absPath}` }))
  return { hit: false }
}
```

Then the cache item click handler:
```js
const item = e.target.closest('.cache-item')
if (item && !e.target.matches('input')) {
  const key = item.dataset.key
  const entry = state.cacheEntries[key]
  if (!entry) return
  await window.api.loadCached(key)
}
```

Add to `preload.js`:
```js
loadCached: (key) => ipcRenderer.invoke('load-cached', { key }),
loadLocalPath: (absPath) => ipcRenderer.invoke('load-local-path', { absPath }),
```

Add handler in `main.js` `registerIpcHandlers()`:
```js
ipcMain.handle('load-local-path', (_, { absPath }) => handleLocalFile(absPath))
```

- [ ] **Step 3: Commit**

```bash
git add main.js preload.js renderer/app.js
git commit -m "feat: handle cache hits uniformly via processing-done event; add load-cached IPC"
```

---

## Task 12: End-to-End Manual Testing

Work through the 11 test cases from the spec.

- [ ] **Test 1: Local video — new**
  - `npm start` → Local File tab → Browse → select a Japanese .mp4
  - Expected: transcription spinner, then video player opens, TRANSLATE shows subtitles

- [ ] **Test 2: Local video — cache hit**
  - Open the same file again
  - Expected: player opens immediately, no processing screen

- [ ] **Test 3: YouTube URL — new**
  - YouTube tab → paste a YouTube URL → Load
  - Expected: download % bar, then transcription spinner, then video player

- [ ] **Test 4: YouTube — cache hit**
  - Load the same URL again
  - Expected: player opens immediately

- [ ] **Test 5: Delete entries**
  - Home screen → hover a cache entry → check checkbox → "Delete selected" appears → click it
  - Expected: entry removed from list; files deleted from `%APPDATA%/translate/cache/`

- [ ] **Test 6: Model change**
  - Gear → change model to `small` → load a local video
  - Expected: transcription uses `small` (visible in terminal output)

- [ ] **Test 7: Cache location change**
  - Gear → Change cache dir → pick a folder on a different drive
  - Expected: next transcription writes files to new location

- [ ] **Test 8: Cancel mid-processing**
  - Start a local file load → click Cancel during transcription
  - Expected: home screen restored; no partial `.srt` in cache dir

- [ ] **Test 9: No dialogue**
  - During playback, seek to a silent section → TRANSLATE
  - Expected: "No dialogue in this segment" shown in overlay

- [ ] **Test 10: Stale local entry**
  - Delete the source video file from disk → click its cache entry
  - Expected: error message "File not found at original path" (or re-runs Whisper if SRT present)

- [ ] **Test 11: Stale YouTube MP4**
  - Delete `<video_id>.mp4` from cache dir manually → click the entry
  - Expected: re-download triggered (processes as cache miss)

- [ ] **Final commit after all tests pass**

```bash
git add -A
git commit -m "feat: complete Japanese subtitle viewer v1"
```

---

## Dependency Installation Reference

```bash
# Node
npm install

# Python
uv sync

# Verify
uv run python whisper_worker.py --help
```

Whisper downloads model weights on first use (~75MB for `base`). Ensure internet access on first transcription.
