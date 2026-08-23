import { reduce } from '../../src/state/reducer.js';
import { createInitialState, PoolStatus } from '../../src/state/initialState.js';
import { Events, STORAGE_KEYS } from '../../src/state/actions.js';
import { buildDaySchedule, dayBucket } from '../../src/domain/schedule.js';

const MIN = 60000;
const HOUR = 3600000;

const NOON = new Date(2026, 7, 22, 12, 0, 0).getTime();
const { key: DAY_KEY, startMs: DAY_START } = dayBucket(NOON);

const scenes = (n, minutes = 30) =>
    Array.from({ length: n }, (_, i) => ({
        id: `s${i + 1}`,
        title: `Scene ${i + 1}`,
        files: [{ duration: minutes * 60 }]
    }));

const channel = (id, name = id) => ({
    id,
    source: 'studio',
    name,
    logo: { type: 'monogram', initials: 'XX', hue: 1 },
    sceneCount: 10,
    sceneFilter: { studios: { value: [id], modifier: 'INCLUDES' } }
});

/** A state with two channels loaded and a schedule for the first. */
function readyState(overrides = {}) {
    const base = {
        ...createInitialState(),
        open: true,
        nowMs: NOON,
        dayKey: DAY_KEY,
        dayStartMs: DAY_START,
        windowStartMs: NOON,
        channels: [channel('studio:1', 'One'), channel('studio:2', 'Two')],
        channelsStatus: PoolStatus.READY,
        tunedChannelId: 'studio:1',
        focus: { channelId: 'studio:1', timeMs: NOON }
    };
    base.pools = {
        'studio:1': { status: PoolStatus.READY, scenes: scenes(4), error: null }
    };
    base.schedules = {
        'studio:1': buildDaySchedule('studio:1', scenes(4), DAY_KEY)
    };
    return { ...base, ...overrides };
}

const run = (state, event) => reduce(state, event);
const effectTypes = (effects) => effects.map((e) => e.type);

describe('OPEN', () => {
    it('opens on the current broadcast day with the window snapped to the half hour', () => {
        const t = new Date(2026, 7, 22, 15, 47).getTime();
        const { state } = run(createInitialState(), { type: Events.OPEN, nowMs: t });

        expect(state.open).toBe(true);
        expect(state.dayKey).toBe('2026-08-22');
        expect(new Date(state.windowStartMs).getMinutes()).toBe(30);
    });

    it('loads channels the first time it opens', () => {
        const { state, effects } = run(createInitialState(), { type: Events.OPEN, nowMs: NOON });
        expect(effectTypes(effects)).toContain('loadChannels');
        expect(state.channelsStatus).toBe(PoolStatus.LOADING);
    });

    it('reuses channels it already has and resumes the tuned channel instead', () => {
        const { effects } = run({ ...readyState(), open: false }, { type: Events.OPEN, nowMs: NOON });
        expect(effectTypes(effects)).not.toContain('loadChannels');
        expect(effectTypes(effects)).toContain('tuneViewer');
    });
});

describe('CLOSE', () => {
    it('stops the viewer so no video keeps streaming behind the page', () => {
        const { state, effects } = run(readyState(), { type: Events.CLOSE });
        expect(state.open).toBe(false);
        expect(effectTypes(effects)).toEqual(['stopViewer']);
    });
});

describe('RESTORE', () => {
    it('restores a remembered channel that is still in the lineup', () => {
        const { state } = run(readyState({ tunedChannelId: null }), {
            type: Events.RESTORE,
            tunedChannelId: 'studio:2',
            muted: false
        });
        expect(state.tunedChannelId).toBe('studio:2');
        expect(state.muted).toBe(false);
    });

    it('ignores a remembered channel that has since disappeared', () => {
        const { state } = run(readyState(), {
            type: Events.RESTORE,
            tunedChannelId: 'studio:999'
        });
        expect(state.tunedChannelId).toBe('studio:1');
    });

    it('keeps the current mute state when none was remembered', () => {
        const { state } = run(readyState(), { type: Events.RESTORE, tunedChannelId: null });
        expect(state.muted).toBe(true);
    });
});

describe('TICK', () => {
    it('advances the clock', () => {
        const { state } = run(readyState(), { type: Events.TICK, nowMs: NOON + MIN });
        expect(state.nowMs).toBe(NOON + MIN);
    });

    it('ignores a tick for the same instant', () => {
        const before = readyState();
        const { state } = run(before, { type: Events.TICK, nowMs: NOON });
        expect(state).toBe(before);
    });

    it('does not retune while the same programme is still playing', () => {
        const { effects } = run(readyState(), { type: Events.TICK, nowMs: NOON + MIN });
        expect(effectTypes(effects)).not.toContain('tuneViewer');
    });

    it('retunes when the programme changes underneath it', () => {
        // Scenes are 30 minutes, so an hour on is definitely a different one.
        const state = readyState();
        const { effects } = run(state, { type: Events.TICK, nowMs: NOON + HOUR });
        expect(effectTypes(effects)).toContain('tuneViewer');
    });

    it('rebuilds every schedule when the broadcast day rolls over', () => {
        const beforeMidnight = new Date(2026, 7, 22, 23, 59, 30).getTime();
        const afterMidnight = new Date(2026, 7, 23, 0, 0, 30).getTime();

        const state = readyState({ nowMs: beforeMidnight });
        const { state: next } = run(state, { type: Events.TICK, nowMs: afterMidnight });

        expect(next.dayKey).toBe('2026-08-23');
        expect(next.dayStartMs).toBe(dayBucket(afterMidnight).startMs);
        expect(next.schedules['studio:1']).not.toBe(state.schedules['studio:1']);
        // A new day means a new shuffle.
        const order = (s) => s.entries.map((e) => e.scene.id);
        expect(order(next.schedules['studio:1'])).not.toEqual(order(state.schedules['studio:1']));
    });

    it('resets the window to the new day rather than leaving it in yesterday', () => {
        const afterMidnight = new Date(2026, 7, 23, 0, 0, 30).getTime();
        const { state } = run(readyState({ nowMs: new Date(2026, 7, 22, 23, 59).getTime() }), {
            type: Events.TICK,
            nowMs: afterMidnight
        });
        expect(state.windowStartMs).toBe(dayBucket(afterMidnight).startMs);
    });

    it('only rebuilds schedules for pools that actually loaded', () => {
        const state = readyState();
        state.pools['studio:2'] = { status: PoolStatus.LOADING, scenes: [], error: null };
        const { state: next } = run(state, {
            type: Events.TICK,
            nowMs: new Date(2026, 7, 23, 0, 1).getTime()
        });
        expect(Object.keys(next.schedules)).toEqual(['studio:1']);
    });

    it('stays quiet when nothing is tuned', () => {
        const { effects } = run(readyState({ tunedChannelId: null }), {
            type: Events.TICK,
            nowMs: NOON + HOUR
        });
        expect(effects).toEqual([]);
    });
});

describe('CHANNELS_LOADED', () => {
    it('stores the channels and auto-tunes the first', () => {
        const { state } = run(createInitialState(), {
            type: Events.CHANNELS_LOADED,
            channels: [channel('studio:1'), channel('studio:2')],
            errors: []
        });
        expect(state.channelsStatus).toBe(PoolStatus.READY);
        expect(state.tunedChannelId).toBe('studio:1');
        expect(state.focus).toEqual({ channelId: 'studio:1', timeMs: 0 });
    });

    it('keeps an already-tuned channel rather than jumping to the first', () => {
        const base = { ...createInitialState(), tunedChannelId: 'studio:2' };
        const { state } = run(base, {
            type: Events.CHANNELS_LOADED,
            channels: [channel('studio:1'), channel('studio:2')],
            errors: []
        });
        expect(state.tunedChannelId).toBe('studio:2');
    });

    it('records per-source errors without failing the whole load', () => {
        const { state } = run(createInitialState(), {
            type: Events.CHANNELS_LOADED,
            channels: [channel('studio:1')],
            errors: [{ source: 'tag', message: 'boom' }]
        });
        expect(state.channelsStatus).toBe(PoolStatus.READY);
        expect(state.sourceErrors).toEqual([{ source: 'tag', message: 'boom' }]);
    });

    it('clears a previous failure so a stale error cannot linger', () => {
        const failed = { ...createInitialState(), channelsError: 'offline', channelsStatus: PoolStatus.ERROR };
        const { state } = run(failed, {
            type: Events.CHANNELS_LOADED,
            channels: [channel('studio:1')],
            errors: []
        });
        expect(state.channelsError).toBeNull();
        expect(state.channelsStatus).toBe(PoolStatus.READY);
    });

    it('defaults the error list when the event omits it', () => {
        const { state } = run(createInitialState(), {
            type: Events.CHANNELS_LOADED,
            channels: [channel('studio:1')]
        });
        expect(state.sourceErrors).toEqual([]);
    });

    it('copes with an empty lineup', () => {
        const { state } = run(createInitialState(), {
            type: Events.CHANNELS_LOADED,
            channels: [],
            errors: []
        });
        expect(state.tunedChannelId).toBeNull();
        expect(state.focus).toBeNull();
    });
});

describe('CHANNELS_FAILED', () => {
    it('records the error', () => {
        const { state } = run(createInitialState(), {
            type: Events.CHANNELS_FAILED,
            message: 'offline'
        });
        expect(state.channelsStatus).toBe(PoolStatus.ERROR);
        expect(state.channelsError).toBe('offline');
    });
});

describe('POOL_REQUESTED', () => {
    it('starts a fetch carrying the channel\'s own scene filter', () => {
        const state = readyState({ pools: {}, schedules: {} });
        const { state: next, effects } = run(state, {
            type: Events.POOL_REQUESTED,
            channelId: 'studio:2'
        });

        expect(next.pools['studio:2'].status).toBe(PoolStatus.LOADING);
        expect(effects).toEqual([
            { type: 'fetchPool', channelId: 'studio:2', sceneFilter: state.channels[1].sceneFilter }
        ]);
    });

    it('ignores repeat requests, which scrolling produces constantly', () => {
        const state = readyState();
        const { state: next, effects } = run(state, {
            type: Events.POOL_REQUESTED,
            channelId: 'studio:1'
        });
        expect(next).toBe(state);
        expect(effects).toEqual([]);
    });

    it('retries a channel that previously failed', () => {
        const state = readyState();
        state.pools['studio:2'] = { status: PoolStatus.ERROR, scenes: [], error: 'boom' };
        const { effects } = run(state, { type: Events.POOL_REQUESTED, channelId: 'studio:2' });
        expect(effectTypes(effects)).toEqual(['fetchPool']);
    });

    it('ignores a channel that is not in the lineup', () => {
        const state = readyState();
        const { state: next, effects } = run(state, {
            type: Events.POOL_REQUESTED,
            channelId: 'studio:999'
        });
        expect(next).toBe(state);
        expect(effects).toEqual([]);
    });
});

describe('POOL_LOADED', () => {
    it('builds the channel\'s schedule', () => {
        const state = readyState({ pools: {}, schedules: {} });
        const { state: next } = run(state, {
            type: Events.POOL_LOADED,
            channelId: 'studio:2',
            scenes: scenes(3)
        });
        expect(next.pools['studio:2'].status).toBe(PoolStatus.READY);
        expect(next.schedules['studio:2'].entries).toHaveLength(3);
    });

    it('starts playback when the tuned channel\'s pool arrives', () => {
        const state = readyState({ pools: {}, schedules: {} });
        const { effects } = run(state, {
            type: Events.POOL_LOADED,
            channelId: 'studio:1',
            scenes: scenes(3)
        });
        expect(effectTypes(effects)).toEqual(['tuneViewer']);
    });

    it('stays silent for a channel nobody is watching', () => {
        const state = readyState({ pools: {}, schedules: {} });
        const { effects } = run(state, {
            type: Events.POOL_LOADED,
            channelId: 'studio:2',
            scenes: scenes(3)
        });
        expect(effects).toEqual([]);
    });

    it('produces an empty schedule for a channel with no usable scenes', () => {
        const state = readyState({ pools: {}, schedules: {} });
        const { state: next, effects } = run(state, {
            type: Events.POOL_LOADED,
            channelId: 'studio:1',
            scenes: []
        });
        expect(next.schedules['studio:1'].totalMs).toBe(0);
        expect(effects).toEqual([]);
    });
});

describe('POOL_FAILED', () => {
    it('marks the channel as failed without touching the others', () => {
        const { state } = run(readyState(), {
            type: Events.POOL_FAILED,
            channelId: 'studio:2',
            message: 'boom'
        });
        expect(state.pools['studio:2']).toEqual({ status: PoolStatus.ERROR, scenes: [], error: 'boom' });
        expect(state.pools['studio:1'].status).toBe(PoolStatus.READY);
    });
});

describe('TUNE', () => {
    it('switches channel, remembers it, and announces the change', () => {
        const { state, effects } = run(readyState(), { type: Events.TUNE, channelId: 'studio:2' });
        expect(state.tunedChannelId).toBe('studio:2');
        expect(effects).toContainEqual({
            type: 'persist',
            key: STORAGE_KEYS.tunedChannel,
            value: 'studio:2'
        });
        expect(effectTypes(effects)).toContain('announce');
    });

    it('names the programme in the announcement when there is one', () => {
        const { effects } = run(readyState(), { type: Events.TUNE, channelId: 'studio:1' });
        const announce = effects.find((e) => e.type === 'announce');
        expect(announce.message).toMatch(/^One\. Scene \d/);
    });

    it('says so when a channel has nothing scheduled', () => {
        const { effects } = run(readyState(), { type: Events.TUNE, channelId: 'studio:2' });
        expect(effects.find((e) => e.type === 'announce').message).toBe('Two. No programming');
    });

    it('falls back to "Untitled" when announcing a scene with no title', () => {
        const untitled = [{ id: 'u1', title: '', files: [{ duration: 1800 }] }];
        const state = readyState();
        state.schedules['studio:2'] = buildDaySchedule('studio:2', untitled, DAY_KEY);

        const { effects } = run(state, { type: Events.TUNE, channelId: 'studio:2' });

        expect(effects.find((e) => e.type === 'announce').message).toBe('Two. Untitled');
    });

    it('ignores a channel that does not exist', () => {
        const state = readyState();
        const { state: next, effects } = run(state, { type: Events.TUNE, channelId: 'nope' });
        expect(next).toBe(state);
        expect(effects).toEqual([]);
    });

    it('does not start video when autoplay is switched off', () => {
        const state = readyState();
        state.settings = { ...state.settings, guide_autoplay: false };
        const { effects } = run(state, { type: Events.TUNE, channelId: 'studio:1' });
        expect(effectTypes(effects)).not.toContain('tuneViewer');
    });
});

describe('EXPAND', () => {
    it('navigates to the live scene at the offset it had reached', () => {
        const state = readyState({ nowMs: NOON + 7 * MIN, windowStartMs: NOON });
        const { effects } = run(state, { type: Events.EXPAND, channelId: 'studio:1' });

        const nav = effects.find((e) => e.type === 'navigateToScene');
        expect(nav.sceneId).toMatch(/^s\d$/);
        expect(nav.offsetSeconds).toBeGreaterThan(0);
        expect(Number.isInteger(nav.offsetSeconds)).toBe(true);
    });

    it('does nothing for a channel with no programming', () => {
        const { effects } = run(readyState(), { type: Events.EXPAND, channelId: 'studio:2' });
        expect(effects).toEqual([]);
    });
});

describe('PAN and GO_TO_NOW', () => {
    it('pans forward', () => {
        const { state } = run(readyState(), { type: Events.PAN, deltaMs: 30 * MIN });
        expect(state.windowStartMs).toBe(NOON + 30 * MIN);
    });

    it('will not pan back past the start of the broadcast day', () => {
        const { state } = run(readyState({ windowStartMs: DAY_START }), {
            type: Events.PAN,
            deltaMs: -HOUR
        });
        expect(state.windowStartMs).toBe(DAY_START);
    });

    it('will not pan more than a day ahead', () => {
        const { state } = run(readyState(), { type: Events.PAN, deltaMs: 5 * 24 * HOUR });
        expect(state.windowStartMs).toBe(DAY_START + 24 * HOUR);
    });

    it('returns an unchanged state when panning hits a limit', () => {
        const state = readyState({ windowStartMs: DAY_START });
        const { state: next } = run(state, { type: Events.PAN, deltaMs: -HOUR });
        expect(next).toBe(state);
    });

    it('jumps back to now, snapped to the half hour', () => {
        const state = readyState({
            nowMs: new Date(2026, 7, 22, 15, 47).getTime(),
            windowStartMs: DAY_START
        });
        const { state: next } = run(state, { type: Events.GO_TO_NOW });
        expect(new Date(next.windowStartMs).getHours()).toBe(15);
        expect(new Date(next.windowStartMs).getMinutes()).toBe(30);
    });
});

describe('focus movement', () => {
    it('sets focus directly', () => {
        const { state } = run(readyState(), {
            type: Events.FOCUS_CELL,
            channelId: 'studio:2',
            timeMs: NOON + MIN
        });
        expect(state.focus).toEqual({ channelId: 'studio:2', timeMs: NOON + MIN });
    });

    it('moves down a channel keeping the time position', () => {
        const { state } = run(readyState(), { type: Events.MOVE_FOCUS, axis: 'channel', delta: 1 });
        expect(state.focus).toEqual({ channelId: 'studio:2', timeMs: NOON });
    });

    it('stops at the first and last channel', () => {
        const top = readyState();
        expect(run(top, { type: Events.MOVE_FOCUS, axis: 'channel', delta: -1 }).state).toBe(top);

        const bottom = readyState({ focus: { channelId: 'studio:2', timeMs: NOON } });
        expect(run(bottom, { type: Events.MOVE_FOCUS, axis: 'channel', delta: 1 }).state).toBe(bottom);
    });

    it('moves to the next programme in time, landing on its start', () => {
        const state = readyState();
        const { state: next } = run(state, { type: Events.MOVE_FOCUS, axis: 'time', delta: 1 });

        // The schedule loops, so compare against offsets within a loop rather
        // than against first-loop absolute times.
        const schedule = state.schedules['studio:1'];
        const offsets = schedule.entries.map((e) => e.offsetMs);
        expect(offsets).toContain((next.focus.timeMs - DAY_START) % schedule.totalMs);
        expect(next.focus.timeMs).toBeGreaterThan(NOON);
    });

    it('moves back to the previous programme', () => {
        const state = readyState();
        const forward = run(state, { type: Events.MOVE_FOCUS, axis: 'time', delta: 1 }).state;
        const back = run(forward, { type: Events.MOVE_FOCUS, axis: 'time', delta: -1 }).state;
        // Back one from the next programme's start lands on the current one.
        expect(back.focus.timeMs).toBeLessThan(forward.focus.timeMs);
    });

    it('pans the window when focus walks off the right edge', () => {
        // A 1-hour window with 30-minute scenes: three steps right must scroll.
        const state = readyState();
        state.settings = { ...state.settings, guide_window_hours: 1 };

        let s = state;
        for (let i = 0; i < 4; i++) {
            s = run(s, { type: Events.MOVE_FOCUS, axis: 'time', delta: 1 }).state;
        }
        expect(s.windowStartMs).toBeGreaterThan(state.windowStartMs);
        expect(s.focus.timeMs).toBeGreaterThanOrEqual(s.windowStartMs);
    });

    it('pans the window when focus walks off the left edge', () => {
        const state = readyState({ windowStartMs: NOON });
        let s = state;
        for (let i = 0; i < 3; i++) {
            s = run(s, { type: Events.MOVE_FOCUS, axis: 'time', delta: -1 }).state;
        }
        expect(s.windowStartMs).toBeLessThan(state.windowStartMs);
    });

    it('does nothing without focus or channels', () => {
        const noFocus = readyState({ focus: null });
        expect(run(noFocus, { type: Events.MOVE_FOCUS, axis: 'time', delta: 1 }).state).toBe(noFocus);

        const noChannels = readyState({ channels: [] });
        expect(run(noChannels, { type: Events.MOVE_FOCUS, axis: 'channel', delta: 1 }).state).toBe(noChannels);
    });

    it('does nothing on a channel whose schedule has not loaded', () => {
        const state = readyState({ focus: { channelId: 'studio:2', timeMs: NOON } });
        expect(run(state, { type: Events.MOVE_FOCUS, axis: 'time', delta: 1 }).state).toBe(state);
    });

    it('does nothing on a channel with an empty schedule', () => {
        const state = readyState();
        state.schedules['studio:1'] = { entries: [], totalMs: 0 };
        expect(run(state, { type: Events.MOVE_FOCUS, axis: 'time', delta: 1 }).state).toBe(state);
    });
});

describe('LAYOUT_CHANGED', () => {
    it('switches layout', () => {
        const { state } = run(readyState(), { type: Events.LAYOUT_CHANGED, layout: 'list' });
        expect(state.layout).toBe('list');
    });

    it('ignores a change to the layout already in use', () => {
        const state = readyState();
        expect(run(state, { type: Events.LAYOUT_CHANGED, layout: 'grid' }).state).toBe(state);
    });
});

describe('SET_MUTED', () => {
    it('applies and remembers the mute state', () => {
        const { state, effects } = run(readyState(), { type: Events.SET_MUTED, muted: false });
        expect(state.muted).toBe(false);
        expect(effects).toContainEqual({ type: 'setMuted', muted: false });
        expect(effects).toContainEqual({ type: 'persist', key: STORAGE_KEYS.muted, value: 'false' });
    });
});

describe('SETTINGS_LOADED', () => {
    it('adopts the loaded settings', () => {
        const settings = { ...createInitialState().settings, guide_window_hours: 6 };
        const { state } = run(createInitialState(), { type: Events.SETTINGS_LOADED, settings });
        expect(state.settings.guide_window_hours).toBe(6);
    });
});

describe('unknown events', () => {
    it('leave the state untouched', () => {
        const state = readyState();
        const { state: next, effects } = run(state, { type: 'NOT_A_REAL_EVENT' });
        expect(next).toBe(state);
        expect(effects).toEqual([]);
    });
});
