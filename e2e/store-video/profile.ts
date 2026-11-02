/**
 * Viewport per `REEL_VARIANT`. Shared by the capture config, which launches
 * the browser at the same device scale so recordings keep device pixels, and
 * the fixture, which sizes the context.
 */
export type VideoProfile = {
  /** CSS viewport; the recording is `size × deviceScaleFactor` pixels. */
  size: { width: number; height: number };
  deviceScaleFactor: number;
};

const getVideoProfile = (variant: string): VideoProfile => {
  if (variant === 'ms-store' || variant === 'updates') {
    return {
      // Microsoft Store trailers must be exactly 1920x1080.
      size: { width: 1920, height: 1080 },
      deviceScaleFactor: 1,
    };
  }

  if (variant === 'shorts') {
    return {
      // 9:16 portrait at 1080x1920 — the canonical short-form video size for
      // TikTok / YouTube Shorts / Instagram Reels / Mastodon. DPR 2 would
      // render 2160x3840 per frame, more than the recorder keeps pace with.
      size: { width: 1080, height: 1920 },
      deviceScaleFactor: 1,
    };
  }

  if (variant === 'mobile') {
    return {
      // A 360x780 CSS viewport activates SP's phone layout; DPR 3 records
      // it at 1080x2340.
      size: { width: 360, height: 780 },
      deviceScaleFactor: 3,
    };
  }

  if (variant === 'hero' || variant === 'hero-light') {
    return {
      // 4:3 landing-page hero, shown at 768x576 and recorded at 2x for
      // retina screens. Below 960px SP uses its compact layout.
      size: { width: 768, height: 576 },
      deviceScaleFactor: 2,
    };
  }

  return {
    // Square 1024x1024 plays well on social embeds and matches the rhythm of
    // the GitHub README. DPR 2 records 2048x2048 for sharp text.
    size: { width: 1024, height: 1024 },
    deviceScaleFactor: 2,
  };
};

export const VIDEO_PROFILE = getVideoProfile(process.env.REEL_VARIANT ?? '');

/** Recording size in device pixels. */
export const RECORDING_SIZE = {
  width: VIDEO_PROFILE.size.width * VIDEO_PROFILE.deviceScaleFactor,
  height: VIDEO_PROFILE.size.height * VIDEO_PROFILE.deviceScaleFactor,
};
