"""Transcribe a wav file in segments with faster-whisper."""

import sys
from pathlib import Path


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("usage: transcribe.py AUDIO TRANSCRIPT")
    audio = Path(sys.argv[1])
    dest = Path(sys.argv[2])
    try:
        from faster_whisper import WhisperModel
    except ImportError as error:
        raise SystemExit(
            "faster-whisper is not installed. From the project folder run: .venv\\Scripts\\python -m pip install -r requirements.txt"
        ) from error

    model_name = __import__("os").environ.get("PODCAST_WHISPER_MODEL", "small")
    model = WhisperModel(model_name, device="cpu", compute_type="int8")
    segments, _info = model.transcribe(str(audio), vad_filter=True)
    lines: list[str] = []
    for segment in segments:
        text = segment.text.strip()
        if text:
            lines.append(text)
            print(f"transcribed {segment.end:.0f}s", file=sys.stderr, flush=True)
    if not lines:
        raise SystemExit("Transcription produced no text.")
    dest.write_text("\n".join(lines) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
