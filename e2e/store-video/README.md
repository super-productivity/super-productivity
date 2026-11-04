# Product video tools

Run `npm run video` for the default reel, or `npm run video:<variant>` for
`full`, `shorts`, `keyboard`, `mobile`, `updates`, `time`, `hero`, or `hero-light`. These commands
capture, build and open a local preview. Microsoft Store builds use
`MS_STORE_AUDIO_SOURCE=path/to/audio.ext npm run video:ms-store`.

The app-specific fixture and scenarios live here. Captions, cards, cursor motion,
camera moves and transitions live in [`../video-kit/`](../video-kit/README.md);
brand SVGs are in `logos.ts`. There is no separate `overlays.ts` module.

Each successful capture writes a `.trim.json` beside its exact `.mkv` in
`.tmp/video/recordings/<variant>/`. Builds select the latest successful recording
with matching metadata, so a failed capture cannot reuse another recording's trim.
Older `.webm` captures must be captured again.

Recordings keep device pixels: `profile.ts` sets each variant's CSS viewport and
scale, and the capture config launches Chromium at that same scale.

The video fixture enables animations after seed import for every variant. Visible
interactions use real controls and assert the result; direct state preparation
belongs behind a covered scene transition.

The mobile reel uses a 360×780 CSS viewport and mobile user agent, which activate
the phone layout, and records it at 3× (1080×2340).

## Landing-page hero

```sh
npm run video:hero        # dark theme
npm run video:hero-light  # light theme
```

A silent 4:3 loop in `scenarios/hero.spec.ts`: three typed lines show short syntax
setting estimate, tag, due time, project and repeat, then the play button starts
tracking and a short time lapse counts the task up by minutes. It is 768×576 CSS
recorded at 2× (1536×1152) and ends on its own first frame, so the loop has no seam.
Outputs `dist/video/reel-hero.*` and `dist/video/reel-hero-light.*`.

## Release update reel

```sh
npm run video:updates
```

Captures an approximately 45-second, caption-led landscape video of changes since early v18 through
v19.1. The existing Playwright fixture seeds an isolated browser profile, and the
existing ffmpeg builder exports `dist/video/reel-updates.mp4`, `.webm`, and `.gif`.
The MP4 and WebM are 1920×1080 at 25 fps. This cut has no audio.

Edit the sequence and caption copy in `scenarios/updates.spec.ts`. The reel shows:

1. Multi-select and completing tasks together.
2. Moving a task into a project section.
3. Live Markdown editing and a working checklist.
4. Keyboard navigation across Boards, with arrow-key cues.
5. The reworked Focus Mode screen.
6. A fast theme montage: Rainbow, Liquid Glass, Plainspace, and Velvet.

The theme montage uses screenshots captured from the actual app during pre-roll,
with each theme selected through the appearance controls. Focus Mode is prepared behind a scene transition using the same test
helper as the default reel. Task, section, and note actions use the real
UI and assert their results. Timed holds are editorial pacing, not readiness checks.

For capture/build without opening a preview:

```sh
npx cross-env REEL_VARIANT=updates SP_SCREENSHOT_BG_DISABLE=1 npm run video:capture
npx cross-env REEL_VARIANT=updates npm run video:build
```

Set `E2E_BASE_URL` when using an already running app. Otherwise capture starts the
development server. Footage reflects the served build; use the intended release
build when publishing a version-specific video.

Feature sources: [project sections](https://github.com/super-productivity/super-productivity/pull/6066),
[Focus Mode rework](https://github.com/super-productivity/super-productivity/releases/tag/v18.5.0),
[notes and task multi-select](https://github.com/super-productivity/super-productivity/releases/tag/v19.0.1),
[Boards keyboard navigation](https://github.com/super-productivity/super-productivity/releases/tag/v19.1.0).

## Time-tracking reel

```sh
npm run video:time
```

A square reel in `scenarios/time-tracking.spec.ts`: one click starts the
timer, a time-lapse (`timeLapse` on the page clock) fills the estimate, a second task
takes over, and the Daily Summary wraps up. Outputs `dist/video/reel-time.*`.

## Adding a reel

1. Write `scenarios/<name>.spec.ts` gated on `REEL_VARIANT=<name>` (copy
   `time-tracking.spec.ts`). `reel.spec.ts` only runs for the variants in its
   `REEL_VARIANTS`, so a new variant records just its own spec.
2. Use `helpers.ts` for pacing (`hold`) and covered setup dispatches;
   see [`../video-kit/README.md`](../video-kit/README.md) for the building blocks.
3. Unknown variants record 1024×1024 at DPR 2 with the ring cursor; add a branch in
   `fixture.ts` for another size or look.

While iterating, skip the slow webm and gif encodes:

```sh
npx cross-env REEL_VARIANT=<name> npm run video:capture
npx cross-env REEL_VARIANT=<name> VIDEO_QUICK=1 npm run video:build
```

`VIDEO_QUICK=1` writes only the mp4 and `.tmp/video/review/reel-<name>-contact.png`,
which shows each scene's opening and middle frame side by side. Existing WebM/GIF
exports remain unchanged and are reported as stale; run a full build before
publishing those formats.

Label cuts with `nextScene` / `cutToScene`, and call `markScene(page, label)` when
an end card or theme crossfade begins. Those marks give each theme and end card
its own contact-sheet row. Inspect the sheet for clipped labels and covered controls,
then watch the MP4 to check timing and motion.

Run `npm run video:kit-test -- --workers=1` for the lightweight helper and build
metadata tests. CI runs these without starting the app. Capture validation still
needs the app and FFmpeg/ffprobe installed locally.
