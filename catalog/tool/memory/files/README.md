# memory

The show's memory. Built once from everything already published, then grown with every episode.

```
node parts/memory/memory.mjs transcribe --show brands/<slug>/sources/show.json --memory brands/<slug>/memory [--model medium] [--language tr]
node parts/memory/memory.mjs index --memory brands/<slug>/memory --show brands/<slug>/sources/show.json
node parts/memory/memory.mjs status --show brands/<slug>/sources/show.json --memory brands/<slug>/memory
```

- `transcribe`: every episode with a local audio file (`show-reader download`, or a folder read by show-reader) and no transcript yet goes through the transcribe-local part. Output: `episodes/<nn>.words.json` and `episodes/<nn>.txt` (title, date, description, then `[mm:ss] line`, unsure words marked `(?)`). Resumable: done episodes are skipped. A 25-minute episode takes a few minutes with `medium` on an M1; the first run downloads the model.
- `index`: `index.json` and `index.md`: episodes (transcribed or not), **phrases that come back** across episodes (2-4 words, in at least two episodes, with episode and time of each use), **names** (capitalised words not starting a sentence, plus names in titles and descriptions). Then writes `CHANNEL.md` from the template if it does not exist.
- `CHANNEL.md` is written by the agent, not by this tool: read `index.md`, then the transcript lines around each candidate, and write only what the lines show, with a citation (`[b4 12:30]`). Counting finds candidates; it cannot tell a running joke from a habit of speech.

Without audio (a show only on a platform that gives no files), `index --show` still reads titles and descriptions; say plainly that the memory is thin until recordings come.

Privacy: everything stays on this machine. Names in the memory are not permission to show them: third persons never go on screen, and hosts appear only as the person decides.
