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

export const channelGroups = (state) => state.channelGroups;
export const playerMode = (state) => state.playerMode;
export const isViewerPaused = (state) => state.viewerPaused;
export const preview = (state) => state.preview;
export const isPreviewing = (state) => state.preview !== null;
export const headWidthPx = (state) => state.headWidthPx;
export const guideSearch = (state) => state.guideSearch;
export const typeFilter = (state) => state.typeFilter;

/**
 * Which type buttons the guide should offer.
 *
 * Built from the sources that actually produced channels, so a library with no
 * groups never shows a dead Groups button. Below two types there is nothing to
 * choose between, so the bar is not worth its space.
 */
export function availableTypes(state) {
    const present = new Set(state.allChannels.map((c) => c.source));
    if (present.size < 2) return [];
    return state.sourceOrder.filter((source) => present.has(source));
}

/** First letters present, for the A-Z rail. */
export function availableLetters(state) {
    const letters = new Set();
    for (const channel of state.allChannels) {
        const first = (channel.name || '').trim().charAt(0).toUpperCase();
        letters.add(/[A-Z]/.test(first) ? first : '#');
    }
    return [...letters].sort();
}

/** The first visible channel whose name starts with `letter`. */
export function firstChannelForLetter(state, letter) {
    const match = state.channels.find((channel) => {
        const first = (channel.name || '').trim().charAt(0).toUpperCase();
        return letter === '#' ? !/[A-Z]/.test(first) : first === letter;
    });
    return match ? match.id : null;
}

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

// --- channel manager ---

export const isManagerOpen = (state) => state.managerOpen;
export const sortMode = (state) => state.sort;
export const managerSource = (state) => state.managerSource;
export const catalogStatus = (state, source = state.managerSource) =>
    state.catalogStatus[source] || PoolStatus.IDLE;
export const catalogError = (state, source = state.managerSource) =>
    state.catalogError[source] || null;

/** The rule entry for a source, if the lineup has one. */
export function lineupRule(state, source) {
    return state.lineup.find((entry) => entry.source === source && !entry.ids && !entry.names) || null;
}

/**
 * Catalogue rows for one source, filtered by the search box.
 *
 * Search is client-side because the catalogue is already in memory and a
 * library can hold hundreds of tags -- a round trip per keystroke would be
 * slower and no more accurate.
 */
export function catalogRows(state, source = state.managerSource) {
    const rows = state.catalog?.[source] || [];
    const query = state.managerSearch.trim().toLowerCase();
    const filtered = query ? rows.filter((c) => c.name.toLowerCase().includes(query)) : rows;

    const live = new Set(state.allChannels.map((c) => c.id));

    return filtered.map((channel) => ({
        channel,
        // "In the guide" means resolved from the lineup, whether by a rule or
        // by an explicit pick -- hiding is a separate axis.
        included: live.has(channel.id),
        pinned: state.pinOrder.includes(channel.id),
        hidden: Boolean(state.prefs[channel.id]?.hidden),
        pref: state.prefs[channel.id] || null
    }));
}

/** Explicitly-picked ids for a source, so the manager can toggle one off. */
export function explicitIds(state, source) {
    const entry = state.lineup.find((e) => e.source === source && Array.isArray(e.ids));
    return entry ? entry.ids : [];
}
