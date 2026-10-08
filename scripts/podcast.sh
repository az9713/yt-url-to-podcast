#!/bin/sh
# Git Bash does not have npm's global bin on PATH, so this finds Pi and runs one episode.
set -e
cd "$(dirname "$0")/.."

if command -v pi >/dev/null 2>&1; then
  PI=pi
elif [ -x "$APPDATA/npm/pi" ]; then
  PI="$APPDATA/npm/pi"
elif [ -x "/c/Users/$USERNAME/AppData/Roaming/npm/pi" ]; then
  PI="/c/Users/$USERNAME/AppData/Roaming/npm/pi"
else
  echo "Pi is installed, but Git Bash cannot see it. Add %AppData%\\npm to PATH, or reinstall with: npm install -g @earendil-works/pi-coding-agent" >&2
  exit 1
fi

URL="${1:-}"
if [ -z "$URL" ]; then
  echo "Usage: ./scripts/podcast.sh <youtube-url>" >&2
  exit 1
fi

MODEL_ARGS=""
if [ -n "$PI_MODEL" ]; then
  MODEL_ARGS="--model $PI_MODEL"
elif [ -n "$OPENAI_API_KEY" ]; then
  MODEL_ARGS="--model openai/gpt-4.1-mini"
  echo "Using openai/gpt-4.1-mini because OPENAI_API_KEY is set. Override with PI_MODEL=provider/model." >&2
fi

# shellcheck disable=SC2086
exec "$PI" -e ./extensions/index.ts --no-session -p $MODEL_ARGS --podcast "$URL"
