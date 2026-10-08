"""Download YouTube metadata, captions, or audio for one video."""

import json
import subprocess
import sys
import time
from pathlib import Path


def run(args: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(args, check=True, capture_output=True, text=True, encoding="utf-8")


def track_langs(data: dict, key: str) -> list[str]:
    return [lang for lang in (data.get(key) or {}) if lang != "live_chat"]


def pick_track(preferred: str | None, langs: list[str]) -> str | None:
    if not langs:
        return None
    norm = (preferred or "").replace("_", "-")
    base = norm.split("-")[0] if norm else ""
    # "<lang>-orig" is the speaker's own auto-caption track. Plain "<lang>" can be a
    # machine translation of it, and YouTube answers that with HTTP 429.
    for candidate in (f"{base}-orig" if base else "", norm, base, "en"):
        if candidate and candidate in langs:
            return candidate
    for candidate in (base, "en"):
        for lang in langs:
            if candidate and (lang == candidate or lang.startswith(f"{candidate}-")):
                return lang
    return langs[0]


def download_subs(url: str, subs: Path, lang: str, auto: bool) -> None:
    kind = "auto" if auto else "manual"
    command = [
        "yt-dlp",
        "--no-playlist",
        "--skip-download",
        "--write-auto-subs" if auto else "--write-subs",
        "--sub-langs",
        lang,
        "--convert-subs",
        "vtt",
        "-o",
        str(subs / f"{kind}.%(id)s.%(ext)s"),
        url,
    ]
    for attempt in range(2):
        result = subprocess.run(command, capture_output=True, text=True, encoding="utf-8")
        if any(subs.glob("*.vtt")):
            return
        detail = f"{result.stderr or ''}\n{result.stdout or ''}"
        if "429" in detail and attempt == 0:
            time.sleep(20)
            continue
        return


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("usage: fetch_source.py URL OUTDIR")
    url = sys.argv[1]
    out = Path(sys.argv[2])
    out.mkdir(parents=True, exist_ok=True)
    raw = run(["yt-dlp", "--no-playlist", "--skip-download", "-J", url]).stdout
    data = json.loads(raw)
    if data.get("is_live"):
        raise SystemExit("This URL is a live stream. Use a finished video.")
    meta = {
        "id": data.get("id") or "",
        "title": data.get("title") or "",
        "channel": data.get("channel") or data.get("uploader") or "",
        "language": data.get("language"),
        "duration": data.get("duration"),
    }
    (out / "meta.json").write_text(json.dumps(meta), encoding="utf-8")

    subs = out / "subs"
    subs.mkdir(exist_ok=True)
    if any(subs.glob("*.vtt")):
        return
    manual = pick_track(meta["language"], track_langs(data, "subtitles"))
    auto = pick_track(meta["language"], track_langs(data, "automatic_captions"))
    if manual:
        download_subs(url, subs, manual, auto=False)
    if not any(subs.glob("*.vtt")) and auto:
        download_subs(url, subs, auto, auto=True)
    if any(subs.glob("*.vtt")):
        return
    if (out / "audio.wav").exists():
        return
    audio = subprocess.run(
        [
            "yt-dlp",
            "--no-playlist",
            "-x",
            "--audio-format",
            "wav",
            "-o",
            str(out / "audio.%(ext)s"),
            url,
        ],
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    if audio.returncode != 0 or not (out / "audio.wav").exists():
        detail = (audio.stderr or audio.stdout or "").strip()
        raise SystemExit(detail or "No captions were available and the audio download failed.")


if __name__ == "__main__":
    main()
