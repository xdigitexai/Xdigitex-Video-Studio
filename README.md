# Xdigitex Studio

A private browser-based video workspace for Xdigitex.

## Working in the editor

- Import MP4/WebM video and keep it in this browser's Project files.
- Play, scrub, set start/end trim points, and choose landscape, portrait, or square output.
- Add a title overlay and timed captions, or import/export captions as SRT.
- Export a WebM with the selected trim, title, and caption overlays. Exports are saved to Project files and downloaded.
- Reopen the project later in the same browser; the project, source video, captions, and exports are stored with IndexedDB.
- Save an AI edit brief with a project and apply supported local changes from the brief (aspect ratio, mute, trim-first-N-seconds, and a `title:` instruction).

## Provider-dependent features

AI scene generation, automatic speech transcription, and general-purpose AI video editing require a secure server-side model integration. This static Site intentionally does not collect or expose model API keys in the browser, and it clearly marks those features as unavailable until the backend is configured.

## Storage scope

Project files persist in the current browser on the current device. They are not uploaded to a remote account or server. Browser storage quota depends on the device/browser.
