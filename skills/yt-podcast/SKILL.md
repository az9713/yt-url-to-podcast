---
name: yt-podcast
description: Turn one YouTube URL into an HTML summary and a separate single-host audio episode. Use when the user pastes a YouTube or youtu.be URL, or asks for a podcast, episode, or spoken retelling of a video.
---

# Generate a podcast

Produce two texts, then speak only the second one. The page is for a reader. The script is a monologue. The script must not recite the page.

Do this work yourself with the scripts in this repository. Do not require a particular agent runtime.

The repository root is the directory that contains `scripts/` and `episodes/`. This file lives at `skills/yt-podcast/SKILL.md`. Use the repository's `.venv` Python when it exists (`.venv/Scripts/python` on Windows, `.venv/bin/python` elsewhere). Otherwise use `python`.

## 1. Captions, one language

```bash
python scripts/fetch_source.py "YOUTUBE_URL" "episodes/<video-id>"
```

The script asks YouTube for one caption track, the video's language or its base language (`en-US` matches `en`). It must not request every language. A request for every language returns HTTP 429, and the run then transcribes the whole soundtrack.

If `episodes/<video-id>/subs/` has no `.vtt` file, stop and tell the user before transcribing. Local transcription can last about as long as the video. Continue only if they accept that wait, or if they already asked you to finish regardless:

```bash
python scripts/transcribe.py "episodes/<video-id>/audio.wav" "episodes/<video-id>/transcript.txt"
```

Do not start a second fetch of the same URL while one is running.

Write `episodes/<video-id>/capture.json`:

```json
{"transcriptSource":"captions","videoDurationSeconds":0}
```

Use `"local-transcription"` when the wav was transcribed. `videoDurationSeconds` comes from `meta.json`.

## 2. Two texts

Read the transcript. Write three files, in this order. Do the writing yourself.

1. `notes.txt`. Same language as the video. Names, numbers, claims, examples, in order. Not an article.
2. `summary.html`. A self-contained page for someone who did not watch. Include the source URL, channel, a short rights sentence in the video's language, and sections. This is the reader page.
3. `script.txt`. A single-host monologue from the notes. Do not read `summary.html` while writing it. The first spoken sentence names the video and says this is a retelling. Before each topic, put a line the voice must not speak: `--- chapter: short title ---`. Cover the material. Do not cut it to a fixed runtime.

Then compare the spoken lines with the page. A sentence is a recitation when the normalized text is at least 40 characters and it matches a page sentence exactly or shares about 80 percent of its words. Short lines such as "Hello." do not count. If any recitation remains, rewrite `script.txt` with those sentences banned. Stop after three passes. Do not render audio while a recitation remains.

## 3. Voice

Turn the spoken lines into `episodes/<video-id>/audio/segments.json`: a JSON list of `{"text","chapter"}`. Keep each `text` under 450 characters. Chapter marker lines are not text.

Kokoro for `en`, `es`, `fr`, `hi`, `it`, `ja`, `pt`, and `zh`. Chatterbox for `ar`, `da`, `de`, `el`, `fi`, `he`, `ko`, `ms`, `nl`, `no`, `pl`, `ru`, `sv`, `sw`, and `tr`. For any other language, write the HTML and stop. Say that no local publishable voice exists.

```bash
python scripts/speak.py --engine kokoro --lang-code a --voice af_heart --segments episodes/<video-id>/audio/segments.json --outdir episodes/<video-id>/audio
```

Kokoro language codes and default voices: `en` `a` `af_heart`, `en-gb` `b` `bf_emma`, `es` `e` `ef_dora`, `fr` `f` `ff_siwis`, `hi` `h` `hf_alpha`, `it` `i` `if_sara`, `ja` `j` `jf_alpha`, `pt` `p` `pf_dora`, `zh` `z` `zf_xiaobei`. Chatterbox uses `--engine chatterbox --language-id <iso>`.

The script skips a `part-NNNN.wav` that already exists. If one segment stops advancing while similar-length neighbors finished in seconds, stop. Run the same `speak.py` command again. Do not delete the finished wavs. Do not start a second speak process.

Join the wavs with ffmpeg into `episodes/<video-id>/episode.m4a`: mono AAC, loudness about −16 LUFS, chapter marks from the segment chapters. The metadata comment is `Synthetic-voice retelling of <url>`. Escape `=` in ffmpeg metadata as `\=`.

## 4. Ledger

Append one row to `ledger.json` and regenerate `ledger.html` at the repository root. Record video length, podcast length, podcast/video, wall-clock seconds, model id, token counts, and catalog cost. Wall clock is elapsed time from start to the finished m4a, including waits. It is not the episode length.

Token counts come from the model response. Catalog cost is recorded only when that response includes a price. If either is missing, write `unknown`. Do not convert character counts into tokens or dollars.

## 5. Report

Tell the user the paths of `summary.html`, `episode.m4a`, and `ledger.html`. Name the source channel. Publishing is their decision.

For a status question, read `ledger.html`. Do not generate another episode.

## Example from the test video

`https://www.youtube.com/watch?v=S7tFyREI19I` is 12m 36s. The episode was 5m 18s, 42 percent of the video. Writing the notes and the script took 21 seconds. Fetching every caption language caused HTTP 429 and a 15-minute CPU transcription. One 210-character voice segment then sat for 37 minutes, and the process produced nothing for 17 minutes after that. Sentences of the same length beside it took about 17 seconds. Those two waits are the failure mode this procedure is written to avoid.
