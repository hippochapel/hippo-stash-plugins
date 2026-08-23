/**
 * Geometry for the guide grid.
 *
 * Everything here converts times into percentages of the visible window, so the
 * grid can be laid out with plain CSS percentages and stays correct at any
 * width -- no pixel measurement, nothing to recompute on resize.
 *
 * No DOM, no I/O.
 */

export const HALF_HOUR_MS = 1800000;

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/** Floor a timestamp to the previous `stepMs` boundary of the local day. */
export function snapToStep(ms, stepMs) {
    const d = new Date(ms);
    const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0).getTime();
    return dayStart + Math.floor((ms - dayStart) / stepMs) * stepMs;
}

/**
 * Where a programme sits in the window, as percentages.
 *
 * Blocks routinely overhang both edges, so the rect is clipped to the window
 * and reports which sides were cut -- the grid draws a continuation arrow on
 * a clipped edge rather than implying the programme starts or ends there.
 */
export function programRect(program, windowStartMs, windowMs) {
    const rawLeft = ((program.startMs - windowStartMs) / windowMs) * 100;
    const rawRight = ((program.endMs - windowStartMs) / windowMs) * 100;

    const leftPct = clamp(rawLeft, 0, 100);
    const rightPct = clamp(rawRight, 0, 100);

    return {
        leftPct,
        widthPct: Math.max(0, rightPct - leftPct),
        clippedStart: rawLeft < 0,
        clippedEnd: rawRight > 100
    };
}

/** Position of the now-line, or null when now is not on screen. */
export function nowLinePct(nowMs, windowStartMs, windowMs) {
    const pct = ((nowMs - windowStartMs) / windowMs) * 100;
    if (pct < 0 || pct >= 100) return null;
    return pct;
}

/** Clock labels along the top of the grid, aligned to `stepMs` boundaries. */
export function timeTicks(windowStartMs, windowMs, stepMs) {
    const ticks = [];
    const first = Math.ceil(windowStartMs / stepMs) * stepMs;
    for (let t = first; t < windowStartMs + windowMs; t += stepMs) {
        ticks.push({
            ms: t,
            leftPct: ((t - windowStartMs) / windowMs) * 100,
            label: formatTick(t)
        });
    }
    return ticks;
}

function formatTick(ms) {
    const d = new Date(ms);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * Keep panning inside a sane range.
 *
 * Scrolling far into the past is pointless (it is all reruns of the same day)
 * and far into the future stops being a forecast anyone acts on.
 */
export function clampWindowStart(targetMs, dayStartMs, maxAheadMs) {
    return clamp(targetMs, dayStartMs, dayStartMs + maxAheadMs);
}
