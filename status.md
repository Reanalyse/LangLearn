# Japanese Subtitle Viewer — Development Status

**Date completed:** 2026-03-24
**Last updated:** 2026-03-24 (moved app to D:\translate, cache to D:\translate\cache)
**Branch:** `feature/app-implementation`

---

## What it does

Electron desktop app (Windows) that plays Japanese video without subtitles. Press TRANSLATE to pause and see English subtitles for the previous 5 seconds as an overlay. Resume by pressing play, Space, or scrubbing the seek bar. A -5s button in the controls jumps back 5 seconds.

Supports local video files (.mp4, .mkv, .avi, .mov, .webm) and YouTube URLs. Subtitles are generated once via Whisper's built-in Japanese→English translation and cached for instant reuse.

---

## How to run

Requires Node.js, `uv` (Python package manager) on PATH.

```
npm install
npm start
```

First job will download the Whisper model (~74MB for `base`). Subsequent runs for cached videos are instant.

---

## Architecture

| Layer | File | Responsibility |
|---|---|---|
| Electron main | `main.js` | local HTTP video server, IPC handlers, uv startup check, before-quit cleanup |
| IPC bridge | `preload.js` | contextBridge exposure of all IPC channels |
| Cache | `cache.js` | Settings, cache key derivation, SRT parsing, index read/write, entry deletion |
| Subprocess | `worker.js` | Spawn/stream/cancel whisper_worker.py |
| Python worker | `whisper_worker.py` | Whisper transcription + yt-dlp download, JSON progress to stdout |
| UI | `renderer/index.html` | HTML shell with CSP |
| UI | `renderer/styles.css` | Dark theme for home, processing, and player screens |
| UI | `renderer/app.js` | State machine: home screen, processing screen, video player |

**Security:** `contextIsolation: true`, `nodeIntegration: false`. Local video served via local HTTP server on a random port (127.0.0.1). Windows paths encoded in URL.

---

## Key implementation details

**Cache:**
- Default location: `D:\translate\cache`
- Local key: `local:` + sha256(absPath).hex()[:16]
- YouTube key: `yt:` + videoId
- Index: `D:\translate\cache\index.json`
- Settings: `%APPDATA%\translate\settings.json` (Electron userData path)

**Subtitle lookup:**
- Filter: `end > currentTime - 5 AND start < currentTime`
- SRT parsed to `[{ start, end, text }]` float seconds

**Progress protocol:**
- Whisper worker writes JSON lines to stdout
- Download phase: `{ type: "progress", phase: "download", pct: 45 }`
- Transcribe phase: `{ type: "progress", phase: "transcribe" }` (no pct — indeterminate spinner)
- Done: `{ type: "done", srt_path: "..." }`

**Cache hits:**
- Main process sends `processing-done` push event via `setImmediate()` so IPC invoke returns before the push fires
- Renderer handles cache hits and new processing uniformly via the `onDone` event

**Video server:**
- Local HTTP server on random port (127.0.0.1) created at startup via `http.createServer`
- Handles range requests (`206 Partial Content`) for seeking via `fs.createReadStream`
- MIME type detected from file extension
- NOTE: `translate://` custom protocol, `Readable.toWeb()`, and `net.fetch(file://)` were all tried and failed — local HTTP server is the reliable approach

**Player controls (left to right):**
- Play/pause — seek bar — time display — volume — **-5s** — TRANSLATE

---

## Bugs fixed post-launch

| Bug | Fix |
|---|---|
| SRT written as `<video_stem>.srt`, not `<hash>.srt` | Rename actual output to expected srt_path after Whisper writes |
| Silent hang after Whisper completes | Wrapped onDone callback in try/catch; errors now surface as alert |
| Overlay blocks play/seek buttons | Raised controls bar z-index to 20 above overlay |
| Seek bar crash on click | Guard against `NaN` duration; removed duplicate mousedown handler |
| Video seek fails with MEDIA_ERR_NETWORK | Replaced `net.fetch(file://)` with manual range handler using Node.js streams |
| Video fails to load from cache (MEDIA_ERR_NETWORK / FFMpegDemuxer error) | Replaced `Readable.toWeb()` with native WHATWG `ReadableStream` enqueuing `Uint8Array` chunks |
| Double error alert on Python failure | Added `settled` flag in worker.js to prevent close handler firing after JSON error |
| Chromium GPU cache errors on startup | `app.commandLine.appendSwitch('disable-gpu-shader-disk-cache')` |

---

## Commits (this feature)

```
79a9f67 fix: replace Readable.toWeb with native ReadableStream for reliable video streaming
4422ce0 feat: add -5s button to player controls
ca53a3f fix: implement manual range request handling in protocol handler for reliable video seeking
4ce27b6 fix: guard seek bar against NaN duration, remove double-fire mousedown handler
f6c6ac5 fix: raise controls bar z-index above overlay so play/seek remain clickable
b1590ce fix: use protocol.handle with net.fetch for video streaming range request support
e8eaa27 fix: forward Range header in protocol handler to enable video seeking
c8340dc fix: catch onDone errors and surface as processing-error instead of silent hang
83e054a fix: default cache dir to D:\translate
6fa624e fix: rename Whisper output from audio stem to expected srt_path
b174293 fix: suppress Chromium GPU shader disk cache errors on Windows
7d10d0b fix: prevent double onError when Python exits non-zero after emitting error JSON
fa607bc fix: seek scrubbing dismisses overlay, remove keydown listener on back navigation
20c4274 feat: add video player with custom controls, TRANSLATE button, subtitle overlay
530b058 feat: add processing screen with progress bar and cancel
1dc30ce fix: restrict drag-drop to supported video extensions
be859a7 feat: render home screen with tabs, settings, and cache list
56adcc1 feat: add IPC handlers, startup uv check, before-quit cleanup
cf69d88 feat: expose full IPC bridge via contextBridge
7c9a00c feat: add worker.js subprocess manager
bb396cb feat: add whisper_worker.py for transcription and YouTube download
be2bf63 feat: register translate:// custom protocol for local file serving
64358e8 refactor: simplify deleteEntries logic in cache.js
6d89aad feat: add cache module (settings, key derivation, index, SRT parser)
572a54d fix: update Electron to v34, tighten CSP, note Windows-only
3776029 feat: scaffold Electron app and Python project
```

---

## Manual test checklist

- [ ] Local video new — transcription runs, player opens, TRANSLATE shows subtitles
- [ ] Local video cached — player opens instantly, no processing
- [ ] YouTube URL new — download % bar → transcribe spinner → player
- [ ] YouTube URL cached — player opens instantly
- [ ] Delete entries — select + "Delete selected", files removed from disk
- [ ] Model change — switch to `small`, confirm used on next job
- [ ] Cache location change — switch drive, confirm files appear there
- [ ] Cancel mid-processing — partial files cleaned up, home screen restored
- [ ] No dialogue — TRANSLATE during silent segment shows "No dialogue in this segment"
- [ ] Stale local entry — delete source file, click entry, error shown
- [ ] YouTube stale MP4 — delete .mp4 from cache, click entry, re-download triggered

---

## Out of scope (v1)

- Subtitle editing or correction
- Multiple language support (Japanese only)
- Cache migration when location changes
- Automated tests
- Fullscreen mode
