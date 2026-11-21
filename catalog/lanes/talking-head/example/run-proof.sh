#!/bin/sh
# End-to-end proof of the talking-head lane on a synthetic Turkish clip. Writes only under <work-dir>; no media is kept in the repo.
# usage: run-proof.sh <work-dir> <path to the pinned hyperframes binary>
# In a studio the parts live in parts/<id>/; here they are read from the catalog folders next to this script.
set -e
WORK=${1:?work dir}; HF=${2:?hyperframes binary}
HERE=$(cd "$(dirname "$0")" && pwd); CAT=$(cd "$HERE/../../.." && pwd)
TR=$CAT/tool/transcribe-local/files/transcribe.mjs; SC=$CAT/tool/silence-cut/files/silence-cut.mjs
SH=$CAT/recipe/shorts-from-long/files/shorts.mjs; CAPS=$CAT/scene/captions/files; CARDS=$CAT/scene/overlay-cards/files
export HYPERFRAMES_TELEMETRY=0 DO_NOT_TRACK=1
mkdir -p "$WORK"; cd "$WORK"
dur() { ffprobe -v error -show_entries format=duration -of csv=p=0 "$1"; }

"$HERE/make-synthetic-clip.sh" .
echo "== 1 transcribe";   node "$TR" talk.mp4 --language tr --out talk.words.json --hf "$HF"
echo "== 2 EDL (to approve)"; node "$SC" plan --video talk.mp4 --words talk.words.json --out edl.json --sey
echo "== 3 cut (EDL approved as written)"; node "$SC" apply --edl edl.json --out cut.mp4
echo "   before $(dur talk.mp4) s, after $(dur cut.mp4) s"

echo "== 4 landscape composition"
rm -rf proj && "$HF" init proj --example blank --resolution landscape --skip-skills --non-interactive >/dev/null 2>&1
node "$HERE/assemble.mjs" proj cut.mp4 cut.words.json "$HERE/frame.md" "$CAPS" "$CARDS" 16:9
(cd proj && "$HF" check --json 2>/dev/null | python3 -c "import sys,json;t=sys.stdin.read();j=json.loads(t[t.index('{'):]);print('   check ok =',j['ok'],{k:[v['errorCount'],v['warningCount']] for k,v in j.items() if isinstance(v,dict) and 'errorCount' in v})")
(cd proj && mkdir -p renders && "$HF" render --quality draft -o renders/draft.mp4 >/dev/null 2>&1 && echo "   draft render $(dur renders/draft.mp4) s")

echo "== 5 one 9:16 short"
node "$SH" pick --words cut.words.json --out shorts.json --min 15 --max 25 --count 3
node "$SH" cut --video cut.mp4 --words cut.words.json --from shorts.json --id 1 --out short-1.mp4 --face-x 0.5
rm -rf proj9 && "$HF" init proj9 --example blank --resolution portrait --skip-skills --non-interactive >/dev/null 2>&1
node "$HERE/assemble.mjs" proj9 short-1.mp4 short-1.words.json "$HERE/frame.md" "$CAPS" "$CARDS" 9:16
(cd proj9 && "$HF" check --json 2>/dev/null | python3 -c "import sys,json;t=sys.stdin.read();j=json.loads(t[t.index('{'):]);print('   check ok =',j['ok'],{k:[v['errorCount'],v['warningCount']] for k,v in j.items() if isinstance(v,dict) and 'errorCount' in v})")
(cd proj9 && mkdir -p renders && "$HF" render --quality draft -o renders/short.mp4 >/dev/null 2>&1 && echo "   short render $(dur renders/short.mp4) s")
