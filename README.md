# Xdigitex Video Studio

Xdigitex Video Studio is a private, full-stack video workspace for creating and editing clips. It runs as a Cloudflare Worker app with private ChatGPT sign-in, D1 project metadata and R2 media storage.

## Product workflow

- Create and reopen projects, with creative briefs, canvas settings, trim points, title overlays, caption tracks, and selected media saved between sessions.
- Upload videos to private object storage and stream them back with byte-range playback for scrubbing.
- Generate a new 5- or 10-second clip from a text brief with Runway Gen-4.5.
- Ask Runway Aleph 2 to restyle or transform an uploaded 2–30-second source video.
- Generate timed captions from the selected clip's audio, edit each line, import or export SRT.
- Render a browser preview to WebM with the trim, title, and enabled captions baked into the video. Download the result and store a copy in the project.

## Provider setup

Set these values as **Sites server secrets**. Do not put them in browser code, `.openai/hosting.json`, or a committed `.env` file.

| Secret | Enables | Provider |
| --- | --- | --- |
| `RUNWAY_API_KEY` | Text-to-video and video-to-video AI jobs | Runway Dev |
| `OPENAI_API_KEY` | Automatic audio transcription and timed captions | OpenAI API |

The Studio displays a one-render cost estimate and requires a separate checkbox confirmation before it submits a paid Runway job. The current estimate uses the published rates: Gen-4.5 at 12 credits/second; Aleph 2 at 28 credits/second with a 56-credit minimum. Rates can change, so the confirmation UI calls out that the provider's final amount may differ.

Until a provider key is configured, its route returns a clear setup message. Upload, saved projects, manual captions, SRT import/export, trimming, titles and browser export do not use paid provider calls.

## Build and check

This app uses the bundled Vinext Worker starter and its managed-Linux scripts.

```sh
node /path/to/sites/scripts/install-dependencies.mjs
node_modules/.bin/drizzle-kit check
node_modules/.bin/tsc --noEmit
npm run lint
npm run build
```

Production schema changes are stored as append-only SQL under `drizzle/`. The Sites publishing workflow applies D1 migrations before uploading the Worker. `.openai/hosting.json` declares `DB` and `BUCKET`; the Sites runtime provisions those bindings.

## Operational limits

- AI video generation requires an active Runway Dev project with sufficient credits. No provider calls are made by the test/build workflow.
- Studio uploads are limited to 95 MB. Runway Aleph 2 edits additionally require a 2–30-second source clip.
- Automatic transcription sends captured audio to OpenAI and is limited to 25 MB per audio request. A browser that cannot capture a video's audio can still use manual captions or import SRT.
- Browser export records in real time. Keep the Studio tab open until export finishes. Browser codec support varies; current output is WebM with VP9/Opus where supported.
- The site is private and expects authenticated user identity headers from Sites dispatch. Every API read and write checks project ownership on the server.
