# Translate

A desktop app that transcribes and translates Japanese video audio into English subtitles using [OpenAI Whisper](https://github.com/openai/whisper). Works with local video files and YouTube URLs.

Built with Electron (UI) and Python (Whisper transcription).

## Features

- Transcribe local video files (MP4, MKV, AVI, MOV, WebM)
- Download and transcribe YouTube videos via `yt-dlp`
- Translates Japanese audio to English SRT subtitles
- Video player with synchronized subtitle overlay
- Cache: previously processed videos reload instantly
- Configurable Whisper model size (tiny → large)
- Configurable cache directory

## Requirements

- [Node.js](https://nodejs.org/) (v18+)
- [uv](https://docs.astral.sh/uv/) — Python package manager
- [ffmpeg](https://ffmpeg.org/) — required by Whisper for audio extraction (must be on PATH)

## Installation

```bash
npm install
uv sync
```

## Usage

```bash
npm start
```

### Local file

Drag and drop a video onto the drop zone, or click **Browse files**.

### YouTube

Paste a YouTube URL into the YouTube tab and click **Load**. The video is downloaded at best quality via `yt-dlp`.

Processing shows a progress indicator. Once done, the video opens in the built-in player with English subtitles overlaid.

## Settings

Click the gear icon to configure:

| Setting | Description |
|---|---|
| Cache location | Directory where SRT files and downloaded YouTube videos are stored |
| Whisper model | `tiny` (fastest) → `large` (most accurate). First use downloads the model. |

## Architecture

```
main.js              Electron main process — window, IPC, local HTTP video server
worker.js            Spawns whisper_worker.py as a child process
whisper_worker.py    Downloads YouTube video (yt-dlp) and runs Whisper transcription
cache.js             Cache index, SRT storage, settings persistence
renderer/
  app.js             UI state and rendering (vanilla JS)
  styles.css         Dark theme styles
  index.html         Shell HTML
preload.js           Electron context bridge (IPC surface for renderer)
```

### How it works

1. A video is loaded (local path or YouTube URL)
2. `worker.js` spawns `whisper_worker.py` via `uv run python`
3. The Python worker runs Whisper with `task="translate"` to produce English text
4. Progress events stream back over stdout as JSON lines
5. The resulting `.srt` file is stored in the cache directory
6. The renderer parses the SRT and overlays subtitles on the HTML5 video element
7. Video is served locally over HTTP (port assigned at startup) to satisfy browser security policy

## Cache

Processed videos are indexed in `index.json` in the cache directory. Cached entries are listed on the home screen and reload without reprocessing. Entries can be deleted from the UI.

- Local files are keyed by a SHA-256 hash of the file path
- YouTube videos are keyed by video ID

## License

MIT
