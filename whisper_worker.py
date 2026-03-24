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
    actual = srt_path.parent / (audio_path.stem + ".srt")
    if actual.exists() and actual != srt_path:
        actual.rename(srt_path)
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
