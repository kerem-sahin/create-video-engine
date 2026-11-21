# shorts-from-long

```
node parts/shorts-from-long/shorts.mjs pick --words cut.words.json --out shorts.json [--min 15 --max 45 --count 5 --keywords a,b]
# read shorts.md: the text of each candidate, its hook and flags; choose with the person
node parts/shorts-from-long/shorts.mjs cut --video cut.mp4 --words cut.words.json --from shorts.json --id 1 --out short-1.mp4 [--face-x 0.5] [--mode crop|fit] [--start s] [--end s]
```

- `pick` proposes segments of whole sentences, 15-45 s, with a hook in the first 2 s: the first sentence is a question, holds a number, is short (9 words or fewer), or the first 2 s contain a hook word (Turkish and English lists in the file). A segment that opens with "ve / ama / çünkü / and / but / because" is flagged as starting mid-thought and ranked down. Pace (2-3.6 words/s), filler words and `--keywords` also count. Hook is a clear yes/no per candidate in `shorts.md` (a question, a hook word, or two weaker signals = yes; one weak signal such as a short opening sentence alone = no, and says so). The picker offers up to `--count` candidates that do not overlap, across the whole `--min`..`--max` range, choosing the set with the best total score (several shorter ones beat one long one; at equal score the shorter wins). If no candidate has a hook, it says so; then the long video may simply not contain a short.
- The picker ranks by rules, not by meaning. The agent reads `shorts.md` and may move a start or end to another sentence boundary (`cut --from shorts.json --id N --start <s> --end <s>` overrides that candidate's times; no JSON editing), or drop a candidate. The person decides.
- `cut` makes `short-N.mp4` at 1080x1920 and `short-N.words.json` (the segment's words from 0, for captions). `--mode crop` (default) crops a 9:16 window from the picture, centred on `--face-x` (0 left edge, 1 right edge; no face detection); a 1080p source is enlarged about 1.8x, so it is a little soft: film in 4K when shorts matter. `--mode fit` keeps the whole picture over a blurred copy of itself.
- Build the short's composition with the captions part (`--aspect 9:16`) and cards (`--aspect 9:16`), then check and render as for the long video.
