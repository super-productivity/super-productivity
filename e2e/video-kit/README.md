# video-kit

Building blocks for scripted product videos: drive the real app with Playwright, layer
captions, cursor, camera moves and cards on top as DOM, record with `startRecording`, and
encode with ffmpeg. Videos become code: copy changes are diffs, and a UI change is a re-run.

**Rule:** nothing in this folder imports app code. Project specifics (seed data, selectors,
copy, brand logos, variants) live in the consumer; Super Productivity's is
[`e2e/store-video/`](../store-video/README.md). That keeps the kit liftable into another
project or a workspace package once a second consumer exists.

## Modules

| Module           | Exports                                                                                                           | Use for                                              |
| ---------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `scene.ts`       | `nextScene`                                                                                                       | The usual scene change in one call (start here)      |
| `cursor.ts`      | `installCursor`, `installTapRipple`, `createPointer`, `setCursorVisible`, `smoothMouseMove`                       | A visible pointer, arced glides, drags, tap marks    |
| `typing.ts`      | `typeText`                                                                                                        | Typing with a human rhythm, cursor out of the way    |
| `clock.ts`       | `timeLapse`                                                                                                       | Timers and tracked time climbing, not jumping        |
| `camera.ts`      | `createCamera` → `zoomTo(locator \| locator[])`, `reset()`                                                        | Eased zoom-and-pan, framed clear of the caption      |
| `captions.ts`    | `showOverlay`, `showCaption` (text swaps in place)                                                                | Lower-third / centered captions                      |
| `keychip.ts`     | `showKeyChip` (`position: 'above-caption'` default \| `'top-right'`)                                              | The shortcut being pressed, as a keycap              |
| `cards.ts`       | `showEndCard` (logo, subtitle, count-up stats), `showLogoGridCard`                                                | Title, end and integration cards                     |
| `transitions.ts` | `cutToScene`, `fadeTransition`, `loopBoundary`, `settleScene`, `showStill`, `onSceneStart`, `markScene`           | Cuts through black, dims, loop seams, stills         |
| `recorder.ts`    | `startRecording`, `recorderLaunchArgs`                                                                            | Sharp capture at device pixels (ffmpeg on PATH)      |
| `render.ts`      | `findLatestRecording`, `readRecordingTrim`, `trimFilter`, `encodeMp4/Webm/Gif`, `writeContactSheet`, `probeMedia` | Node-side ffmpeg encoding (ffmpeg + ffprobe on PATH) |

## Minimal scene

```ts
import {
  createCamera,
  createPointer,
  installCursor,
  nextScene,
  typeText,
} from '../video-kit';

// Before the first navigation: init scripts survive reloads.
await installCursor(page); // arrow + click ripple; { style: 'ring' } for a soft halo
await page.goto('/');

const pointer = createPointer(page);
const camera = createCamera(page, 'app-root'); // stage = the element covering the viewport

// Cut through black, set up behind it, reveal under a caption.
let caption = await nextScene(page, { caption: 'Plan your day.', pointer, camera });
await pointer.glideTo(page.getByRole('button', { name: 'Add' }));
await page.getByRole('button', { name: 'Add' }).click();
await typeText(page, 'Write the launch post'); // the next glide shows the cursor again
await camera.zoomTo(page.locator('.task-list')); // framed above the caption bar
await camera.reset();

caption = await nextScene(page, {
  caption: 'Make it yours.',
  pointer,
  camera,
  setup: () => page.goto('/settings'), // full navigations stay hidden behind black
});
```

For custom cuts, use `cutToScene` directly and pass `{ noWait: true }` to any caption or
card shown inside its callback, so the fade-in plays during the reveal instead of behind
black. Give it a `label` to log setup time and report the scene to `onSceneStart`.
For an end card or theme crossfade without a black cut, call `markScene(page, label)`
when it begins, so contact sheets include that scene too.

## Gotchas

- **The camera is a CSS transform on the stage.** It is paint-only (no reflow) and leaves
  kit layers unzoomed, but popups rendered outside the stage (Angular CDK overlays, portals)
  stay at 1× size and don't follow camera moves. Open menus and dialogs at rest, never move
  the camera mid-drag (drag libraries cache drop-zone rects), and `reset()` before scenes
  that rely on `position: fixed` inside the stage.
- **Framing reads the caption at zoom time.** `zoomTo` frames the target in the area above
  a visible lower caption, so show the caption first. Other overlays: pass `insets`.
  The stage may slide up under the caption, so `reset()` before hiding it.
- **The camera fails loudly.** Without `scale`, `zoomTo` throws when the target is too
  large to magnify visibly (frame a smaller part of it). With `scale` it crops as told,
  and a later `glideTo` throws if its target ended up off-screen: `reset()` or reframe
  before interacting there.
- **A static layout zoom and the camera are different tools.** `app-root { zoom: 1.4 }`
  re-lays-out the app for a small canvas and must stay fixed; animating it would reflow
  every frame. Use the camera for motion.
- **Page clock.** A paused Playwright clock (`page.clock.install`) freezes page timers and
  `requestAnimationFrame`, but CSS transitions keep running. So the kit waits in Node and
  removes layers on `transitionend`; it works with the clock paused. One exception:
  end-card count-ups use `requestAnimationFrame` and need the clock running.
  `timeLapse(page, 30 * 60_000)` steps an installed clock forward so interval-driven UI
  (timers, tracked time) visibly climbs.
- **Handles own their layer.** Every `hide()` / `update()` reaches only the layer it
  created; a handle to a replaced caption or card is a harmless no-op.
- **Cuts and navigation.** `cutToScene` keeps the frame black across a full `page.goto()`
  (same origin: the flag lives in sessionStorage). A bare `loopBoundary('out')` does not.
  If setup fails, the cover is cleared and the original error is rethrown.
- **No OS cursor in recordings.** Without `installCursor`, clicks have no visible cause.
  `typeText` hides it while typing; `setCursorVisible` does it by hand.
- **Timing.** Captions and cards wait for their own fade unless `noWait` is set. Hold
  durations are editorial pacing; readiness belongs in `expect()` assertions.
- **Recording.** `startRecording` captures at `OUTPUT_FPS` (30) and every output keeps
  that rate, so fades don't judder. Use it instead of Playwright's `recordVideo`, which
  records at CSS-pixel size and ~1 Mbps. Launch the browser with
  `recorderLaunchArgs(dpr)` matching the context's `deviceScaleFactor`; without it, frames
  stay at CSS size. Prefer in-page zoom (re-rendered) over zooming the recording in post.

## Testing the kit

`npm run video:kit-test` runs behavior tests against routed static pages in a few seconds,
no app server: layer ownership, paused clock, navigation cover and failed setup cleanup,
camera framing, pointer timing, tap ripples, and recording/trim pairing. CI runs the
same suite. Add a test there when a primitive changes.

## Theming

Set CSS custom properties on `:root` in a project stylesheet (e.g. via `page.addStyleTag`):
`--vk-font`, `--vk-mono-font`, `--vk-headline-color`, `--vk-caption-bg`, `--vk-card-bg`.
Everything else can be restyled through the `vk-*` classes.

## Not built yet

Follow-cursor camera, window chrome / padded background ("stage framing") for social
formats, audio beds outside the Microsoft Store preset, and a generic recording fixture.
Add them when a video needs them.
