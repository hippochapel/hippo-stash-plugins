/**
 * Derived, UI-facing values. No DOM, no side effects.
 *
 * The views render from these alone, which is what lets the desktop grid and
 * the mobile list be two renderers over one state tree.
 */

import { programAt, scheduleBetween } from '../domain/schedule.js';
import { programRect, nowLinePct, timeTicks, HALF_HOUR_MS } from '../domain/layout.js';
import { PoolStatus } from './initialState.js';

export const windowMs = (state) => state.settings.guide_window_hours * 3600000;
export const windowEndMs = (state) => state.windowStartMs + windowMs(state);

export const isOpen = (state) => state.open;
export const isGridLayout = (state) => state.layout === 'grid';
export const channels = (state) => state.channels;
export const tunedChannel = (state) =>
    state.channels.find((c) => c.id === state.tunedChannelId) || null;

export const poolStatus = (state, channelId) =>
    state.pools[channelId]?.status || PoolStatus.IDLE;

/** Clock labels across the head of the grid. */
export const ticks = (state) => timeTicks(state.windowStartMs, windowMs(state), HALF_HOUR_MS);

/** Where the now-line sits, or null when now is off-screen. */
export const nowMarkerPct = (state) => nowLinePct(state.nowMs, state.windowStartMs, windowMs(state));

/** Whatever is live on a channel right now. */
export function liveProgram(state, channelId) {
    const schedule = state.schedules[channelId];
    if (!schedule) return null;
    return programAt(schedule, state.nowMs, state.dayStartMs);
}

/** What follows the live programme -- the "next" half of the guide. */
export function nextProgram(state, channelId) {
    const schedule = state.schedules[channelId];
    if (!schedule) return null;
    const live = programAt(schedule, state.nowMs, state.dayStartMs);
    if (!live) return null;
    return programAt(schedule, live.endMs, state.dayStartMs);
}

/** How far through the live programme we are, 0..1. */
export function liveProgress(state, channelId) {
    const live = liveProgram(state, channelId);
    if (!live || live.durationMs <= 0) return 0;
    return Math.min(1, live.elapsedMs / live.durationMs);
}

/** Positioned blocks for one channel row of the grid. */
export function rowBlocks(state, channelId) {
    const schedule = state.schedules[channelId];
    if (!schedule) return [];

    const from = state.windowStartMs;
    const to = windowEndMs(state);

    return scheduleBetween(schedule, state.dayStartMs, from, to).map((program) => ({
        program,
        rect: programRect(program, from, windowMs(state)),
        isLive: program.startMs <= state.nowMs && program.endMs > state.nowMs,
        isFocused:
            state.focus?.channelId === channelId &&
            program.startMs <= state.focus.timeMs &&
            program.endMs > state.focus.timeMs
    }));
}

/** The programme the detail banner describes: whatever has keyboard focus. */
export function focusedProgram(state) {
    if (!state.focus) return null;
    const schedule = state.schedules[state.focus.channelId];
    if (!schedule) return null;
    return programAt(schedule, state.focus.timeMs, state.dayStartMs);
}

export function focusedChannel(state) {
    if (!state.focus) return null;
    return state.channels.find((c) => c.id === state.focus.channelId) || null;
}

/** True once there is something worth drawing. */
export const hasChannels = (state) => state.channels.length > 0;

export const isLoading = (state) => state.channelsStatus === PoolStatus.LOADING;
export const loadError = (state) => state.channelsError;
export const sourceErrors = (state) => state.sourceErrors;
