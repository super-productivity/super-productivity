/**
 * Constants for the Schedule component.
 *
 * These values control the responsive behavior and layout of the schedule view.
 */

export const SCHEDULE_CONSTANTS = {
  /**
   * Viewport width threshold (in pixels) below which the schedule switches to horizontal scroll mode.
   * Above this width, all days are visible side-by-side.
   * Below this width, horizontal scrolling is enabled to navigate between days.
   */
  HORIZONTAL_SCROLL_THRESHOLD: 1900,

  /**
   * Responsive breakpoints for different device sizes.
   */
  BREAKPOINTS: {
    /** Width threshold for tablet devices (768px) */
    TABLET: 768,
    /** Width threshold for mobile devices (480px) */
    MOBILE: 480,
  },

  /**
   * Column widths for different screen sizes.
   * These values determine the width of day columns in the schedule view.
   */
  COLUMN_WIDTHS: {
    /** Desktop day column width in pixels */
    DESKTOP: 180,
    /** Tablet day column width in pixels */
    TABLET: 150,
    /** Mobile day column width in pixels */
    MOBILE: 120,
  },

  /**
   * Scrollbar dimensions for the horizontal scroll mode.
   */
  SCROLLBAR: {
    /** Height of the horizontal scrollbar in pixels */
    HEIGHT: 8,
    /** Default width/height of scrollbar elements in pixels */
    WIDTH: 4,
    /** Additional padding for the header to accommodate scrollbar */
    HEADER_PADDING: 11,
  },
} as const;
