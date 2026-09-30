# README image provenance

Updated September 24, 2026 from the latest local brand-refresh build.

- `workspace-latest.png`: unchanged copy of `artifacts/browser.png`, captured by the native desktop smoke workflow at 13:55 local time. Disposable profile and deterministic provider fixtures; no live model-performance claim.
- `setup-latest.png`: unchanged copy of `artifacts/setup.png` from the same workflow. Shows the initial model-connection screen with no entered credentials.
- `jevry-lockup-ink.svg` and `jevry-lockup-porcelain.svg`: unchanged copies of the latest `public/brand` outlined assets, updated at 13:46 local time. Manrope license remains in `public/brand/Manrope-OFL.txt`.

The screenshots show the latest local desktop design, which advanced after the public source preview was frozen. This documentation update does not change application source or claim those later UI changes are included in the tagged preview.

The game GIF and MP4 remain historical evidence from the earlier interface. They are retained in a labeled expandable README section; they have not been reskinned or presented as a new run. See `docs/launch/DEMO.md` for source timestamps.

All selected images were visually checked for the expected design and visible private information before publication.

## Introduction video

`jevry-web-preview.gif` is an 8-second excerpt (seconds 1–9, at original speed) of the user-supplied `jevry-web.mp4`, resized to 960 pixels wide at 10 fps for the README. The preview links to the unchanged 72.2-second original video hosted as a GitHub release asset. This promotional overview is separate from the recorded game evidence and benchmark reports.

## Lightweight introduction excerpt

`jevry-web-preview.mp4` is a compressed H.264/yuv420p copy of the **existing public** `jevry-web-preview.gif`. It keeps the GIF’s full eight-second timeline (source introduction seconds 1–9), 80 frames at 10 fps, and 960 × 540 framing. There is no new trim, crop, speed change, rearrangement, or synthesized frame. Compression changes pixel values; this is not a lossless archival copy. The original GIF and linked 72.2-second introduction remain unchanged.

This is a promotional excerpt, separate from the real-time game recording and measured benchmark evidence. The source GIF has no audio; the export also has no audio. Created with the already-installed FFmpeg, without new software or model calls:

```sh
ffmpeg -hide_banner -loglevel error -i docs/media/jevry-web-preview.gif -an -c:v libx264 -crf 23 -pix_fmt yuv420p -movflags +faststart -fps_mode passthrough docs/media/jevry-web-preview.mp4
```
