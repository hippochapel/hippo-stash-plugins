/**
 * Derived, UI-facing values. No DOM, no side effects.
 *
 * The views render from these alone, which is what lets the desktop grid and
 * the mobile list be two renderers over one state tree.
 */

import { programAt, scheduleBetween } from '../domain/schedule.js';
import { COMPARATORS, DEFAULT_SORT, PINNED_GROUP } from '../domain/channelPrefs.js';
import { programRect, nowLinePct, timeTicks, HALF_HOUR_MS } from '../domain/layout.js';
import { PoolStatus } from './initialState.js';

export const windowMs = (state) => state.settings.guide_window_hours * 3600000;
export const windowEndMs = (state) => state.windowStartMs + windowMs(state);

export const isOpen = (state) => state.open;
export const isGridLayout = (state) => state.layout === 'grid';
export const channels = (state) => state.channels;
// Looked up in the full lineup, not the visible list: collapsing a group hides
// a row, it does not stop the channel playing.
export const tunedChannel = (state) =>
    state.allChannels.find((c) => c.id === state.tunedChannelId) || null;

export const poolStatus = (state, channelId) =>
    state.pools[channelId]?.status || PoolStatus.IDLE;

export const channelGroups = (state) => state.channelGroups;
export const playerMode = (state) => state.playerMode;
export const isViewerPaused = (state) => state.viewerPaused;
export const headWidthPx = (state) => state.headWidthPx;
export const playerWidthPx = (state) => state.playerWidthPx;
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
    const types = state.sourceOrder.filter((source) => present.has(source));
    // Pinned is a group in the guide like any other, so it belongs in the same
    // row of buttons -- first, since that is where the group sits.
    return state.pinOrder.length > 0 ? [PINNED_GROUP, ...types] : types;
}

/** A channel's rail letter: its initial, or `#` for anything not A-Z. */
export function channelLetter(channel) {
    const first = (channel.name || '').trim().charAt(0).toUpperCase();
    return /[A-Z]/.test(first) ? first : '#';
}

const groupByKey = (state, groupKey) =>
    state.channelGroups.find((group) => group.key === groupKey) || null;

/**
 * First letters present in one group, for that group's A-Z rail.
 *
 * Per group rather than global: the guide is always grouped, so a global rail
 * would offer letters that jump you out of the section you are reading.
 */
export function groupLetters(state, groupKey) {
    const group = groupByKey(state, groupKey);
    if (!group || group.collapsed) return [];
    return [...new Set(group.channels.map(channelLetter))].sort();
}

/** The first channel in `groupKey` whose name starts with `letter`. */
export function firstChannelForLetterInGroup(state, groupKey, letter) {
    const group = groupByKey(state, groupKey);
    if (!group) return null;
    const match = group.channels.find((channel) => channelLetter(channel) === letter);
    return match ? match.id : null;
}

/** Clock labels across the head of the grid. */
export const ticks = (state) => timeTicks(state.windowStartMs, windowMs(state), HALF_HOUR_MS);

/** Where the now-line sits, or null when now is off-screen. */
export const nowMarkerPct = (state) => nowLinePct(state.nowMs, state.windowStartMs, windowMs(state));

/**
 * The instant the player's readout should describe.
 *
 * Frozen at the pause point while paused: the schedule runs on regardless, but
 * a stopped picture reporting an advancing position is the part that felt wrong.
 */
export const playbackNowMs = (state) =>
    state.viewerPaused && state.pausedAtMs ? state.pausedAtMs : state.nowMs;

/** The programme the player is showing, against the (possibly frozen) clock. */
export function tunedProgram(state) {
    const schedule = state.schedules[state.tunedChannelId];
    if (!schedule) return null;
    return programAt(schedule, playbackNowMs(state), state.dayStartMs);
}

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
    return state.allChannels.find((c) => c.id === state.focus.channelId) || null;
}

export const isFocusedTemporaryChannel = (state) =>
    focusedChannel(state)?.id === state.temporaryChannel?.id;

export const temporaryChannelSaveState = (state) => {
    if (isFocusedTemporaryChannel(state)) return 'save';
    return focusedChannel(state)?.id === state.savedTemporaryChannelId ? 'saved' : null;
};

/**
 * True once the lineup resolved to something.
 *
 * Deliberately the raw lineup: collapsing every group, or a search that matches
 * nothing, empties `channels` without meaning the library has no channels.
 */
export const hasChannels = (state) => state.allChannels.length > 0;

/** A search or type filter that has narrowed everything away. */
export const isFilteredEmpty = (state) =>
    state.allChannels.length > 0 &&
    state.channels.length === 0 &&
    (state.guideSearch.trim() !== '' || state.typeFilter !== 'all');

/** How many channels the guide holds, ignoring which groups are collapsed. */
export const channelCount = (state) =>
    state.channelGroups.reduce((total, group) => total + group.count, 0);

export const isLoading = (state) => state.channelsStatus === PoolStatus.LOADING;
export const loadError = (state) => state.channelsError;
export const sourceErrors = (state) => state.sourceErrors;

// --- channel manager ---

export const isManagerOpen = (state) => state.managerOpen;
export const sortMode = (state) => state.managerSort;
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

    // The sort control belongs to this dialog: it orders these rows and nothing
    // in the guide behind it.
    const compare = COMPARATORS[state.managerSort] || COMPARATORS[DEFAULT_SORT];
    const sorted = filtered.slice().sort(compare);

    const live = new Set(state.allChannels.map((c) => c.id));

    return sorted.map((channel) => ({
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
