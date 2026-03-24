# Japanese Subtitle Viewer — Design Spec

**Date:** 2026-03-24
**Status:** Approved

---

## Overview

A Windows desktop app (Electron) that plays Japanese video content — local files or YouTube — without subtitles. When the user presses a TRANSLATE button, the video pauses and English subtitles for the previous five seconds are displayed as an overlay. Subtitles are generated once via Whisper's built-in Japanese→English translation and cached for instant reuse.

---

## Architecture

Three layers:

| Layer | Technology | Responsibility |
|---|---|---|
| Shell | Electron (main process) | File dialog, YouTube download, spawns Whisper, IPC, settings |
| UI | Electron (renderer) | Home screen, video player, subtitle overlay |
| Transcription | Python + `openai-whisper` + `yt-dlp` via `uv` | Translate audio, download YouTube video |

### File Structure

```
translate/
├── main.js                  # Electron main process
├── preload.js               # contextBridge IPC exposure
├── renderer/
│   ├── index.html
│   └── app.js               # Home screen + video player + overlay logic
├── whisper_worker.py        # Runs Whisper, outputs progress JSON + SRT
├── pyproject.toml           # uv project: openai-whisper, yt-dlp
└── package.json             # Electron dependency
```

### Electron Security Model

- `contextIsolation: true`, `nodeIntegration: false`
- `preload.js` exposes a safe IPC bridge via `contextBridge`
- Local video files are served via a registered `translate://` custom protocol handler in the main process — avoids disabling `webSecurity`

### translate:// Protocol — Windows Path Encoding

On Windows, absolute paths contain a drive letter (e.g. `C:\Users\foo\video.mp4`). The custom protocol URL is constructed as:

```
translate:///C:/Users/foo/video.mp4
```

(triple slash: empty host, path begins with `/C:/...`). The protocol handler in main.js reconstructs the filesystem path by stripping the leading slash:

```js
// handler receives: translate:///C:/Users/foo/video.mp4
const filePath = request.url.replace('translate:///', '');
// → "C:/Users/foo/video.mp4"
```

Forward slashes are used throughout; Node.js `fs` accepts them on Windows.

### IPC Channels

All channels are registered in `preload.js` via `contextBridge` and used between main and renderer.

| Direction | Channel | Payload |
|---|---|---|
| renderer → main | `open-local-file` | — (triggers file dialog, returns path) |
| renderer → main | `load-youtube` | `{ url: string }` |
| renderer → main | `cancel-processing` | — |
| renderer → main | `delete-cache-entries` | `{ keys: string[] }` |
| renderer → main | `get-cache-index` | — (returns index.json entries) |
| renderer → main | `get-settings` | — (returns `{ cacheDir: string, model: string }`) |
| renderer → main | `change-cache-dir` | — (triggers folder picker) |
| renderer → main | `change-model` | `{ model: string }` |
| main → renderer | `processing-progress` | `{ phase: string, pct?: number }` |
| main → renderer | `processing-done` | `{ subtitles: SubtitleArray, videoPath?: string }` |
| main → renderer | `processing-error` | `{ message: string }` |
| main → renderer | `cache-index` | `{ entries: IndexEntries }` |

`get-settings` is called by the renderer on home screen load to populate the settings panel with current values. All renderer→main channels that return data use `ipcRenderer.invoke` / `ipcMain.handle` (request/response). Channels that push data from main→renderer use `webContents.send` / `ipcRenderer.on`.

---

## Home Screen

Two tabs: **Local File** and **YouTube URL**.

**Local File tab:**
- Drag-and-drop zone for video files (accepts `.mp4`, `.mkv`, `.avi`, `.mov`, `.webm`)
- "Browse files" button opens native file dialog filtered to the same formats

**YouTube URL tab:**
- URL input field + Load button
- Progress bar shown during download and transcription phases (see Progress Protocol)

**Recently Translated list** (sorted by date descending, max 50 entries):
- Shows all cached entries with title and date
- Title for local files: stored basename at time of first processing (stale if file is renamed/moved — acceptable, display uses cached title)
- Each entry has a CACHED badge and a checkbox (hidden until hovered or another item is checked)
- Clicking an entry's title/row loads it immediately without re-processing
- Checking one or more entries reveals a "Delete selected" button above the list
- Clicking "Delete selected" removes checked entries from `index.json` and deletes their associated files from disk
- A "Select all" checkbox appears in the list header when any item is checked

**Settings** (gear icon, home screen top-right only; disabled/hidden during active processing):
- **Cache location**: shows current path, Change button opens folder picker
  - New path does not exist: create automatically
  - New path not writable: show error, revert to previous path
  - Changing location does not migrate existing files
- **Whisper model**: dropdown — `tiny`, `base` (default), `small`, `medium`, `large`
  - Takes effect on next job only; dropdown is disabled during active processing
- Saved to `%APPDATA%/translate/settings.json`

---

## Video Player

The `<video>` element fills the window with native controls **hidden** (`controls` attribute absent). A custom control bar is rendered below the video containing:
- Play/pause button
- Seek bar (progress bar, clickable/draggable)
- Current time / duration display
- Volume control
- **TRANSLATE button** (rightmost position)

Local files: video source set to `translate://<abs_path>` via the custom protocol handler.
YouTube files: video source set to `translate://<cache_dir>/<video_id>.mp4`.

**On TRANSLATE press:**
1. `video.pause()`
2. Find all subtitle entries where `end > currentTime - 5` AND `start < currentTime`
   - `start` and `end` are floats in **seconds**, matching `video.currentTime` units
3. Display overlay on top of the paused video showing matched lines with timestamp range
4. If no matches: show "No dialogue in this segment"

**Overlay dismissal:** overlay is hidden and video resumes on any of:
- Play button click
- Space key press
- Seek bar interaction (scrubbing)

---

## Subtitle Array Format

Parsed from SRT by the main process before sending to the renderer:

```json
[
  { "start": 12.5, "end": 15.2, "text": "Wait, that's not right!" },
  { "start": 15.3, "end": 18.0, "text": "You have to eat it all!" }
]
```

- `start` and `end`: float, seconds
- `text`: string, English

### SRT Parsing Rules

SRT blocks are separated by blank lines. Each block has: a sequence number (ignored), a timestamp line, and one or more text lines.

Timestamp format: `HH:MM:SS,mmm --> HH:MM:SS,mmm`
Conversion: `HH*3600 + MM*60 + SS + mmm/1000.0` → float seconds

Multi-line text blocks: join lines with a single space.
Strip HTML tags before storing (Whisper may emit `<i>`, `<u>`, etc.): remove all `<...>` patterns.

Example block:
```
1
00:00:12,500 --> 00:00:15,200
Wait, that's not right!
```

---

## Transcription Pipeline

### Whisper Invocation

`whisper_worker.py` uses the Python API directly:

```python
import whisper, whisper.utils

model = whisper.load_model(model_name)           # model_name from --model arg
result = model.transcribe(audio_path, task="translate", language="ja", fp16=False)
writer = whisper.utils.get_writer("srt", str(srt_path.parent))
writer(result, audio_path)                       # writer derives output filename from audio_path
```

`fp16=False` is required on CPU (Windows default). `srt_path` is the absolute output path passed as a CLI argument; the writer places `<audio_filename>.srt` in `srt_path.parent`. The worker should verify the output file exists at `srt_path` before emitting `done`. After writing, emit `{"type": "done", "srt_path": "<srt_path>"}` to stdout.

### Progress Protocol

`whisper_worker.py` writes JSON lines to stdout. Main process reads line-by-line and forwards to the renderer via IPC.

```jsonl
{"type": "progress", "phase": "download", "pct": 45}
{"type": "progress", "phase": "transcribe"}
{"type": "done", "srt_path": "/path/to/file.srt"}
{"type": "error", "message": "..."}
```

- **Download phase:** `pct` (0–100) derived by parsing yt-dlp's stdout (`[download]  45.3%` pattern). UI shows a real percentage.
- **Transcription phase:** `pct` is absent. `openai-whisper` provides no progress callback. UI switches to an indeterminate spinner labelled "Transcribing…" for the duration.
- `done` is emitted after the SRT file is fully written to disk.

### Cache Key and Filename Derivation

| Source | index.json key | Cache filename |
|---|---|---|
| Local | `local:` + `sha256(abs_path.encode()).hexdigest()[:16]` | `<16-char-hex>.srt` |
| YouTube | `yt:` + `<video_id>` | `<video_id>.srt` / `<video_id>.mp4` |

Keys are prefixed in `index.json` to eliminate namespace collision. Cache filenames are unprefixed (strip the `local:` or `yt:` prefix to derive the filename).

### Cache Key in index.json

```json
{
  "local:abc123def456789a": { ... },
  "yt:dQw4w9WgXcQ": { ... }
}
```

### Local Video Flow

```
User opens file
  → title = basename(abs_path, ext=False)
  → key = "local:" + sha256(abs_path).hexdigest()[:16]
  → check <cache_dir>/<key[6:]>.srt   (strip "local:" prefix for filename)
  → HIT:  parse SRT → send subtitle array to renderer
  → MISS: show processing UI
          → spawn `uv run python whisper_worker.py --model <model> <abs_path> <srt_path>`
          → stream progress → update progress bar
          → on done: parse SRT → write index.json entry (title from main) → send subtitle array
          → on cancel: kill subprocess → delete partial SRT if exists → return to home
```

### YouTube Video Flow

```
User pastes URL
  → extract video_id from URL
  → key = "yt:" + video_id
  → check <cache_dir>/<video_id>.srt
  → HIT:  check <cache_dir>/<video_id>.mp4 exists
          → EXISTS: load video + parse SRT → send to renderer
          → MISSING: treat as full cache miss (re-download + re-transcribe)
  → MISS: show processing UI
          → spawn `uv run python whisper_worker.py --youtube <url> --model <model> <mp4_path> <srt_path>`
          → worker runs yt-dlp (phase=download) then Whisper (phase=transcribe)
          → on done: load video + parse SRT → write index.json entry → send to renderer
          → on cancel: kill subprocess → delete partial files → return to home
```

**yt-dlp flags** (inside `whisper_worker.py`):
```
yt-dlp \
  --format "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best" \
  --merge-output-format mp4 \
  --output <mp4_path> \
  <url>
```

### index.json Schema

```json
{
  "local:abc123def456789a": {
    "title": "Terrace House EP 04",
    "date": "2026-03-22T14:30:00Z",
    "srt_path": "<cache_dir>/abc123def456789a.srt",
    "video_path": "C:/Users/foo/videos/terrace-house-ep04.mp4",
    "source": "local"
  },
  "yt:dQw4w9WgXcQ": {
    "title": "Gaki no Tsukai — Batsu Game 2023",
    "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "date": "2026-03-20T09:15:00Z",
    "srt_path": "<cache_dir>/dQw4w9WgXcQ.srt",
    "video_path": "<cache_dir>/dQw4w9WgXcQ.mp4",
    "source": "youtube"
  }
}
```

`video_path` is the original absolute path for local entries and the cached `.mp4` path for YouTube entries. For local entries, if `video_path` does not exist on disk at load time, show "File not found at original path" and skip loading. If the SRT is missing but the index entry exists (and `video_path` is present), re-run Whisper using `video_path` as input.

---

## Cache

**Default location:** `%APPDATA%/translate/cache/`
**Configured in:** `%APPDATA%/translate/settings.json`

**Structure:**
```
<cache_dir>/
├── index.json
├── <16-char-hex>.srt       # local video subtitles
├── <youtube_video_id>.srt  # YouTube subtitles
└── <youtube_video_id>.mp4  # downloaded YouTube video
```

---

## Processing UI State

During processing (download or transcription):
- Progress bar and phase label replace the home screen content
- Cancel button: kills the subprocess, best-effort cleanup of partial files, returns to home screen
- Window close during processing: `app.on('before-quit')` handler calls `subprocess.kill()` (synchronous on Windows) then attempts synchronous `fs.unlinkSync` on partial files. The close event is not blocked — cleanup is best-effort. Partial files are treated as cache misses on next load.

**Partial files per flow:**
- Local: only `<16-char-hex>.srt` (source video is never touched)
- YouTube: both `<video_id>.mp4` and `<video_id>.srt` (delete both regardless of which phase was active)

---

## Startup Check

On app launch, main process verifies `uv` is on PATH by running `uv --version`. If it fails (non-zero exit or not found), show an error dialog with install instructions and exit. This is the only startup dependency check; `openai-whisper` and `yt-dlp` errors surface naturally when a job is started.

---

## Error Handling

| Scenario | Behaviour |
|---|---|
| `uv` not on PATH at launch | Error dialog with install instructions, app exits |
| yt-dlp fails | Show `{"type":"error"}` message from worker |
| Whisper fails mid-processing | Show error message, return to home screen |
| SRT missing but index.json has entry | Cache miss: re-run Whisper |
| YouTube MP4 missing but SRT exists | Full cache miss: re-download + re-transcribe |
| No subtitles overlap last 5 seconds | "No dialogue in this segment" |
| Local file missing (stale entry) | "File not found at original path" on click |
| New cache path not writable | Show error in settings, revert to previous path |

---

## Testing (Manual, v1)

1. Local video: load, Whisper runs with progress bar, subtitles appear on TRANSLATE press
2. Local video second load: instant from cache, no Whisper run
3. YouTube URL: download progress then transcribe progress, cache, playback
4. YouTube URL second load: instant from cache
5. Cache delete: select one or more entries, click "Delete selected", confirm entries removed from list and files deleted from disk
6. Settings — model change: change to `small`, load video, confirm new model used
7. Settings — cache location: change to a different drive, load video, confirm files appear there
8. Cancel mid-processing: confirm partial files cleaned up and home screen restored
9. No dialogue: press TRANSLATE during silent segment, confirm message shown
10. Stale local entry: delete source file, click entry, confirm error message
11. YouTube stale MP4: delete `.mp4` from cache, click entry, confirm re-download triggered

---

## Out of Scope (v1)

- Subtitle editing or correction
- Multiple language support (Japanese only)
- Cache migration when location changes
- Automated tests
- Fullscreen mode
