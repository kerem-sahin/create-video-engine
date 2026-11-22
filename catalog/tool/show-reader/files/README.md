# show-reader

Learns what a show has already published. Everything a person already has (episode titles, descriptions, past recordings) teaches the studio more than any question.

```
node parts/show-reader/show-reader.mjs read <source> --out brands/<slug>/sources/show.json
node parts/show-reader/show-reader.mjs download --show brands/<slug>/sources/show.json --dir brands/<slug>/sources/episodes [--latest 3] [--episodes 1,4]
```

`<source>` is one of:

| Source | How it is read |
|---|---|
| RSS feed URL | read directly (`match: "direct"`) |
| Spotify show or episode link | show name and newest episode from Spotify's public embed page, then the feed from the Apple Podcasts directory by name, **accepted only if its newest episode title matches Spotify** (`match: "confirmed"`). A name match that could not be compared is `name-only` (exit 1: ask the person). No feed at all: `none`, only the newest episode is known (exit 1: ask for the RSS link, which every hosting dashboard shows, or the recordings). |
| Apple Podcasts link | feed from Apple's lookup by id |
| folder of recordings | files ordered by date, durations from ffprobe; **titles stay empty**: file names can hold private things, so the person gives the titles |
| saved feed file (.xml/.rss) | read offline |

`show.json`: `{ schema, read_at, match, source{kind,url,how,from}, show{title, description, author, language, link, image, categories, feed}, episodes[{ n, guid, title, date, duration_s, season, number, description, link, image, audio{url,type,bytes}, local }], notes }`. Episodes are numbered 1..n from the oldest. A second `read` keeps `local` paths and titles the person gave.

`download` runs only after the person said yes (it can be hundreds of MB). Files are named `<nn>-<title-slug>.<ext>`; each one's duration is checked against the feed (±3 %, at least 5 s) and a mismatch exits 1. Already downloaded files are skipped.

Network: only the requests the source needs (the feed, Spotify's embed page, Apple's search/lookup API). No account, no key, no tracking. The user agent is a generic `create-video-engine-show-reader/0.1`.
