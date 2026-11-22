#!/bin/sh
# End-to-end proof of the podcast lane's picture: a 3-minute excerpt of an audio-only two-host Turkish podcast becomes a 16:9 video.
# Writes only under <work-dir>; no media is kept in the repo. scenes.json and turns.json were written by hand for this excerpt
# (minutes 5:00-8:00 of the episode); a real run gets turns from the `speakers` part and the scenes from the transcript.
# usage: run-proof.sh <work-dir> <hyperframes binary> <episode audio> <cover image> [start-seconds, default 300]
set -e
WORK=${1:?work dir}; HF=${2:?hyperframes binary}; AUDIO=${3:?episode audio}; COVER=${4:?cover image}; START=${5:-300}
HERE=$(cd "$(dirname "$0")" && pwd); CAT=$(cd "$HERE/../../.." && pwd)
TR=$CAT/tool/transcribe-local/files/transcribe.mjs; ASM=$CAT/tool/assemble-long/files/assemble-long.mjs
export HYPERFRAMES_TELEMETRY=0 DO_NOT_TRACK=1
mkdir -p "$WORK"; cd "$WORK"
cp "$HERE/scenes.json" "$HERE/turns.json" .; cp "$COVER" cover.png
sed 's#background: "assets/cover.png"#background: "cover.png"#' "$HERE/frame.md" > frame.md
ffmpeg -v error -y -ss "$START" -t 180 -i "$AUDIO" -c:a aac -b:a 128k excerpt.m4a
node "$TR" excerpt.m4a --language tr --out excerpt.words.json --hf "$HF"
node "$ASM" assemble --audio excerpt.m4a --scenes scenes.json --turns turns.json --words excerpt.words.json \
     --frame frame.md --out out/excerpt.mp4 --hf "$HF" --keep-work
echo "report: $WORK/out/excerpt.mp4.assemble.json (every measurement and the time of each stage)"
