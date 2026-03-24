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
  let settled = false
  proc.stdout.on('data', (chunk) => {
    buffer += chunk.toString()
    const lines = buffer.split('\n')
    buffer = lines.pop()
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const msg = JSON.parse(line)
        if (msg.type === 'progress') onProgress(msg)
        else if (msg.type === 'done') { settled = true; activeProcess = null; onDone(msg) }
        else if (msg.type === 'error') { settled = true; activeProcess = null; onError(msg.message) }
      } catch {}
    }
  })

  proc.on('close', (code) => {
    activeProcess = null
    if (!settled && code !== 0 && code !== null) onError(`Process exited with code ${code}`)
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
