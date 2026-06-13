/**
 * Show-delay (ms) for the per-cell heatmap tooltips, shared by the year strip
 * (HeatmapComponent) and the single-month calendar (HeatmapMonthCalendarComponent).
 *
 * Material's default show-delay is 0 ms. On a grid of hundreds of gap-tight
 * 12px cells that paints a trail of overlays when the cursor sweeps across,
 * faster than they dismiss. A short rest-to-reveal delay (GitHub-style) means a
 * fast sweep shows nothing — a pending show is cancelled on mouseleave — and
 * only the cell the cursor rests on gets a tooltip.
 */
export const HEATMAP_TOOLTIP_SHOW_DELAY = 300;
