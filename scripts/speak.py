"""Render script segments to wav files with Kokoro or Chatterbox."""

import argparse
import json
import os
import sys
from pathlib import Path

import numpy as np
import soundfile as sf


def find_espeak() -> None:
    candidates = [
        Path(r"C:\Program Files\eSpeak NG"),
        Path(r"C:\Program Files (x86)\eSpeak NG"),
    ]
    for folder in candidates:
        exe = folder / "espeak-ng.exe"
        library = folder / "libespeak-ng.dll"
        if exe.exists():
            os.environ["PATH"] = str(folder) + os.pathsep + os.environ.get("PATH", "")
        if library.exists():
            os.environ["PHONEMIZER_ESPEAK_LIBRARY"] = str(library)
            return


def load_segments(path: Path) -> list[dict]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, list) or not data:
        raise SystemExit("segments.json was empty")
    return data


def write_wav(path: Path, audio: np.ndarray, sample_rate: int) -> None:
    samples = np.asarray(audio, dtype=np.float32).reshape(-1)
    if samples.size == 0:
        raise SystemExit(f"No audio produced for {path.name}")
    sf.write(path, samples, sample_rate)


def speakable(text: str) -> bool:
    return any(character.isalpha() or character.isdigit() for character in text)


def speak_kokoro(segments: list[dict], out: Path, lang_code: str, voice: str) -> None:
    find_espeak()
    try:
        from kokoro import KPipeline
    except ImportError as error:
        raise SystemExit(
            "Kokoro is not installed. From the project folder run: .venv\\Scripts\\python -m pip install -r requirements.txt"
        ) from error
    pipeline = KPipeline(lang_code=lang_code)
    for index, segment in enumerate(segments):
        dest = out / f"part-{index:04d}.wav"
        if dest.exists() and dest.stat().st_size > 0:
            print(f"spoke {index + 1}/{len(segments)}", file=sys.stderr, flush=True)
            continue
        text = str(segment.get("text") or "").strip()
        if not speakable(text):
            print(f"skipped {index + 1}/{len(segments)}", file=sys.stderr, flush=True)
            continue
        chunks = []
        for _graphemes, _phonemes, audio in pipeline(text, voice=voice):
            chunks.append(np.asarray(audio, dtype=np.float32))
        if not chunks:
            print(f"skipped {index + 1}/{len(segments)}", file=sys.stderr, flush=True)
            continue
        write_wav(dest, np.concatenate(chunks), 24000)
        print(f"spoke {index + 1}/{len(segments)}", file=sys.stderr, flush=True)


def speak_chatterbox(segments: list[dict], out: Path, language_id: str) -> None:
    try:
        import torch
        from chatterbox.mtl_tts import ChatterboxMultilingualTTS
    except ImportError as error:
        raise SystemExit(
            "Chatterbox is not installed. From the project folder run: .venv\\Scripts\\python -m pip install chatterbox-tts"
        ) from error
    device = "cuda" if torch.cuda.is_available() else "cpu"
    try:
        model = ChatterboxMultilingualTTS.from_pretrained(device=device, t3_model="v3")
    except TypeError:
        model = ChatterboxMultilingualTTS.from_pretrained(device=device)
    for index, segment in enumerate(segments):
        dest = out / f"part-{index:04d}.wav"
        if dest.exists() and dest.stat().st_size > 0:
            print(f"spoke {index + 1}/{len(segments)}", file=sys.stderr, flush=True)
            continue
        text = str(segment.get("text") or "").strip()
        if not speakable(text):
            print(f"skipped {index + 1}/{len(segments)}", file=sys.stderr, flush=True)
            continue
        wav = model.generate(text, language_id=language_id)
        samples = wav.squeeze().detach().cpu().numpy() if hasattr(wav, "detach") else np.asarray(wav)
        if getattr(samples, "size", 0) == 0:
            print(f"skipped {index + 1}/{len(segments)}", file=sys.stderr, flush=True)
            continue
        write_wav(dest, samples, int(model.sr))
        print(f"spoke {index + 1}/{len(segments)}", file=sys.stderr, flush=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--engine", required=True, choices=["kokoro", "chatterbox"])
    parser.add_argument("--segments", required=True)
    parser.add_argument("--outdir", required=True)
    parser.add_argument("--lang-code", default="a")
    parser.add_argument("--voice", default="af_heart")
    parser.add_argument("--language-id", default="en")
    args = parser.parse_args()
    out = Path(args.outdir)
    out.mkdir(parents=True, exist_ok=True)
    segments = load_segments(Path(args.segments))
    if args.engine == "kokoro":
        speak_kokoro(segments, out, args.lang_code, args.voice)
    else:
        speak_chatterbox(segments, out, args.language_id)


if __name__ == "__main__":
    main()
