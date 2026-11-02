/**
 * video-kit: building blocks for scripted product videos recorded with
 * Playwright. Project-agnostic by rule: nothing here may import app code.
 * See README.md.
 */
export {
  type Camera,
  createCamera,
  frameTarget,
  type Insets,
  type ZoomOptions,
} from './camera';
export {
  type CaptionHandle,
  type CaptionPosition,
  type OverlayChip,
  type OverlayOptions,
  showCaption,
  showOverlay,
} from './captions';
export {
  type EndCardContent,
  type EndCardStat,
  type LogoGridCardContent,
  type LogoGridItem,
  showEndCard,
  showLogoGridCard,
} from './cards';
export { timeLapse, type TimeLapseOptions } from './clock';
export {
  createPointer,
  type CursorOptions,
  type DragOptions,
  type GlideOptions,
  installCursor,
  installTapRipple,
  type Pointer,
  setCursorVisible,
  smoothMouseMove,
} from './cursor';
export { type LayerHandle } from './dom';
export { type KeyChipPosition, showKeyChip } from './keychip';
export { nextScene, type NextSceneOptions } from './scene';
export {
  cutToScene,
  fadeTransition,
  loopBoundary,
  markScene,
  onSceneStart,
  settleScene,
  showStill,
  type StillHandle,
} from './transitions';
export { typeText } from './typing';
