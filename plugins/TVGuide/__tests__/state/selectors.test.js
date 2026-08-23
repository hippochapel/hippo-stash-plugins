import * as sel from '../../src/state/selectors.js';
import { createInitialState, PoolStatus } from '../../src/state/initialState.js';
import { buildDaySchedule, dayBucket } from '../../src/domain/schedule.js';

const MIN = 60000;
const HOUR = 3600000;
const NOON = new Date(2026, 7, 22, 12, 0, 0).getTime();
const { key: DAY_KEY, startMs: DAY_START } = dayBucket(NOON);

const scenes = (n, minutes = 30) =>
    Array.from({ length: n }, (_, i) => ({
        id: `s${i + 1}`,
        title: `Scene ${i + 1}`,
        details: `Details ${i + 1}`,
        files: [{ duration: minutes * 60 }]
    }));

const chan = (id, name) => ({ id, source: 'studio', name, logo: {}, sceneFilter: {} });

function state(overrides = {}) {
    const base = {
        ...createInitialState(),
        open: true,
        nowMs: NOON,
        dayKey: DAY_KEY,
        dayStartMs: DAY_START,
        windowStartMs: NOON,
        channels: [chan('studio:1', 'One'), chan('studio:2', 'Two')],
        tunedChannelId: 'studio:1',
        focus: { channelId: 'studio:1', timeMs: NOON },
        pools: { 'studio:1': { status: PoolStatus.READY, scenes: scenes(4), error: null } },
        schedules: { 'studio:1': buildDaySchedule('studio:1', scenes(4), DAY_KEY) }
    };
    return { ...base, ...overrides };
}

describe('window', () => {
    it('derives its width from the setting', () => {
        expect(sel.windowMs(state())).toBe(3 * HOUR);
        expect(sel.windowEndMs(state())).toBe(NOON + 3 * HOUR);
    });
});

describe('channel selectors', () => {
    it('finds the tuned channel', () => {
        expect(sel.tunedChannel(state()).name).toBe('One');
    });

    it('returns null when nothing is tuned', () => {
        expect(sel.tunedChannel(state({ tunedChannelId: null }))).toBeNull();
    });

    it('reports pool status, defaulting to idle', () => {
        expect(sel.poolStatus(state(), 'studio:1')).toBe(PoolStatus.READY);
        expect(sel.poolStatus(state(), 'studio:2')).toBe(PoolStatus.IDLE);
    });

    it('reports whether there is anything to draw', () => {
        expect(sel.hasChannels(state())).toBe(true);
        expect(sel.hasChannels(state({ channels: [] }))).toBe(false);
    });

    it('exposes load status and errors', () => {
        expect(sel.isLoading(state({ channelsStatus: PoolStatus.LOADING }))).toBe(true);
        expect(sel.loadError(state({ channelsError: 'x' }))).toBe('x');
        expect(sel.sourceErrors(state({ sourceErrors: [{ source: 'tag' }] }))).toHaveLength(1);
        expect(sel.isOpen(state())).toBe(true);
        expect(sel.isGridLayout(state())).toBe(true);
        expect(sel.isGridLayout(state({ layout: 'list' }))).toBe(false);
        expect(sel.channels(state())).toHaveLength(2);
    });
});

describe('programme selectors', () => {
    it('reports what is live now', () => {
        const live = sel.liveProgram(state(), 'studio:1');
        expect(live.startMs).toBeLessThanOrEqual(NOON);
        expect(live.endMs).toBeGreaterThan(NOON);
    });

    it('reports what follows it, contiguously', () => {
        const s = state();
        const live = sel.liveProgram(s, 'studio:1');
        const next = sel.nextProgram(s, 'studio:1');
        expect(next.startMs).toBe(live.endMs);
    });

    it('returns null for a channel with no schedule', () => {
        expect(sel.liveProgram(state(), 'studio:2')).toBeNull();
        expect(sel.nextProgram(state(), 'studio:2')).toBeNull();
    });

    it('returns null for an empty schedule', () => {
        const s = state({ schedules: { 'studio:1': { entries: [], totalMs: 0 } } });
        expect(sel.liveProgram(s, 'studio:1')).toBeNull();
        expect(sel.nextProgram(s, 'studio:1')).toBeNull();
    });

    it('reports progress through the live programme as a fraction', () => {
        // Scenes are 30 min and the day divides evenly, so noon starts one.
        expect(sel.liveProgress(state(), 'studio:1')).toBe(0);
        expect(sel.liveProgress(state({ nowMs: NOON + 15 * MIN }), 'studio:1')).toBeCloseTo(0.5, 5);
    });

    it('reports zero progress when there is nothing playing', () => {
        expect(sel.liveProgress(state(), 'studio:2')).toBe(0);
    });
});

describe('rowBlocks', () => {
    it('fills the window with contiguous blocks', () => {
        const blocks = sel.rowBlocks(state(), 'studio:1');
        expect(blocks.length).toBeGreaterThan(0);
        for (const b of blocks) {
            expect(b.rect.leftPct).toBeGreaterThanOrEqual(0);
            expect(b.rect.leftPct + b.rect.widthPct).toBeLessThanOrEqual(100.000001);
        }
    });

    it('marks exactly one block as live', () => {
        expect(sel.rowBlocks(state(), 'studio:1').filter((b) => b.isLive)).toHaveLength(1);
    });

    it('marks the focused block', () => {
        const focused = sel.rowBlocks(state(), 'studio:1').filter((b) => b.isFocused);
        expect(focused).toHaveLength(1);
    });

    it('marks nothing focused on an unfocused channel', () => {
        const s = state({
            schedules: {
                'studio:1': buildDaySchedule('studio:1', scenes(4), DAY_KEY),
                'studio:2': buildDaySchedule('studio:2', scenes(4), DAY_KEY)
            }
        });
        expect(sel.rowBlocks(s, 'studio:2').some((b) => b.isFocused)).toBe(false);
    });

    it('returns nothing for a channel with no schedule', () => {
        expect(sel.rowBlocks(state(), 'studio:2')).toEqual([]);
    });
});

describe('focus selectors', () => {
    it('describes the focused programme for the banner', () => {
        const p = sel.focusedProgram(state());
        expect(p.scene.title).toMatch(/^Scene /);
    });

    it('names the focused channel', () => {
        expect(sel.focusedChannel(state()).name).toBe('One');
    });

    it('returns null without focus', () => {
        expect(sel.focusedProgram(state({ focus: null }))).toBeNull();
        expect(sel.focusedChannel(state({ focus: null }))).toBeNull();
    });

    it('returns null when the focused channel has no schedule yet', () => {
        expect(sel.focusedProgram(state({ focus: { channelId: 'studio:2', timeMs: NOON } }))).toBeNull();
    });

    it('returns null when the focused channel vanished from the lineup', () => {
        expect(sel.focusedChannel(state({ focus: { channelId: 'gone', timeMs: NOON } }))).toBeNull();
    });
});

describe('grid furniture', () => {
    it('emits half-hourly ticks across the window', () => {
        expect(sel.ticks(state())).toHaveLength(6);
    });

    it('positions the now-line inside the window', () => {
        expect(sel.nowMarkerPct(state())).toBe(0);
        expect(sel.nowMarkerPct(state({ nowMs: NOON + 90 * MIN }))).toBeCloseTo(50, 5);
    });

    it('hides the now-line when the window is panned away from now', () => {
        expect(sel.nowMarkerPct(state({ windowStartMs: NOON + 5 * HOUR }))).toBeNull();
    });
});

describe('channel manager selectors', () => {
    const cat = (id, name, source = 'studio') => ({
        id, source, name, logo: {}, sceneCount: 5, sceneFilter: {}
    });

    const managerState = (overrides = {}) =>
        state({
            managerOpen: true,
            managerSearch: '',
            sort: 'name',
            lineup: [{ source: 'studio', minScenes: 5 }],
            catalog: { studio: [cat('studio:1', 'Alpha'), cat('studio:9', 'Omega')] },
            allChannels: [cat('studio:1', 'Alpha')],
            prefs: {},
            ...overrides
        });

    it('exposes manager state', () => {
        const s = managerState({
            managerSource: 'studio',
            catalogStatus: { studio: PoolStatus.READY }
        });
        expect(sel.isManagerOpen(s)).toBe(true);
        expect(sel.sortMode(s)).toBe('name');
        expect(sel.managerSource(s)).toBe('studio');
        expect(sel.catalogStatus(s)).toBe(PoolStatus.READY);
        expect(sel.catalogError(s)).toBeNull();
    });

    it('reports status and errors per source', () => {
        const s = managerState({
            managerSource: 'studio',
            catalogStatus: { tag: PoolStatus.ERROR },
            catalogError: { tag: 'offline' }
        });
        expect(sel.catalogStatus(s, 'tag')).toBe(PoolStatus.ERROR);
        expect(sel.catalogError(s, 'tag')).toBe('offline');
        // A source never fetched is idle, not errored.
        expect(sel.catalogStatus(s, 'studio')).toBe(PoolStatus.IDLE);
    });

    it('finds the rule entry for a source', () => {
        expect(sel.lineupRule(managerState(), 'studio')).toEqual({ source: 'studio', minScenes: 5 });
        expect(sel.lineupRule(managerState(), 'tag')).toBeNull();
    });

    it('does not mistake an explicit-picks entry for a rule', () => {
        const s = managerState({ lineup: [{ source: 'studio', ids: ['1'] }] });
        expect(sel.lineupRule(s, 'studio')).toBeNull();
        expect(sel.explicitIds(s, 'studio')).toEqual(['1']);
    });

    it('reports no explicit picks when there are none', () => {
        expect(sel.explicitIds(managerState(), 'studio')).toEqual([]);
    });

    it('marks which catalogue rows are already in the guide', () => {
        const rows = sel.catalogRows(managerState(), 'studio');
        expect(rows.map((r) => [r.channel.id, r.included])).toEqual([
            ['studio:1', true],
            ['studio:9', false]
        ]);
    });

    it('filters catalogue rows by the search query', () => {
        const rows = sel.catalogRows(managerState({ managerSearch: ' OME ' }), 'studio');
        expect(rows.map((r) => r.channel.id)).toEqual(['studio:9']);
    });

    it('reports pinned, hidden and the raw pref for each row', () => {
        const s = managerState({
            prefs: { 'studio:1': { hidden: true, name: 'A' } },
            pinOrder: ['studio:1']
        });
        const [row] = sel.catalogRows(s, 'studio');
        expect(row.pinned).toBe(true);
        expect(row.hidden).toBe(true);
        expect(row.pref.name).toBe('A');
    });

    it('returns nothing for a source with no catalogue yet', () => {
        expect(sel.catalogRows(managerState({ catalog: {} }), 'studio')).toEqual([]);
        expect(sel.catalogRows(managerState(), 'tag')).toEqual([]);
    });
});


describe('guide navigation selectors', () => {
    const chan = (id, name, source = 'studio') => ({
        id, source, name, logo: {}, sceneCount: 5, sceneFilter: {}
    });

    const navState = (overrides = {}) =>
        state({
            sourceOrder: ['studio', 'performer', 'tag', 'group', 'savedFilter'],
            allChannels: [
                chan('studio:1', 'Alpha'),
                chan('studio:2', 'Bravo'),
                chan('tag:1', 'Beach', 'tag')
            ],
            channels: [chan('studio:1', 'Alpha'), chan('studio:2', 'Bravo'), chan('tag:1', 'Beach', 'tag')],
            ...overrides
        });

    it('offers a button per source type actually present', () => {
        expect(sel.availableTypes(navState())).toEqual(['studio', 'tag']);
    });

    it('offers no buttons when there is only one type to choose', () => {
        const single = navState({ allChannels: [chan('studio:1', 'Alpha')] });
        expect(sel.availableTypes(single)).toEqual([]);
    });

    it('lists the first letters present, sorted', () => {
        expect(sel.availableLetters(navState())).toEqual(['A', 'B']);
    });

    it('tolerates a channel with no name', () => {
        const s2 = navState({ allChannels: [{ id: 'studio:9', source: 'studio', logo: {} }] });
        expect(sel.availableLetters(s2)).toEqual(['#']);
    });

    it('matches a nameless channel under # when jumping', () => {
        const s2 = navState({ channels: [{ id: 'studio:9', source: 'studio', logo: {} }] });
        expect(sel.firstChannelForLetter(s2, '#')).toBe('studio:9');
    });

    it('defaults the catalogue source to the one being browsed', () => {
        const s2 = state({
            managerSource: 'studio',
            managerSearch: '',
            catalog: { studio: [{ id: 'studio:1', source: 'studio', name: 'A', logo: {}, sceneCount: 1 }] },
            allChannels: []
        });
        expect(sel.catalogRows(s2)).toHaveLength(1);
    });

    it('files a non-alphabetic name under #', () => {
        const s = navState({ allChannels: [chan('studio:9', '3D Available')] });
        expect(sel.availableLetters(s)).toEqual(['#']);
    });

    it('finds the first visible channel for a letter', () => {
        expect(sel.firstChannelForLetter(navState(), 'B')).toBe('studio:2');
        expect(sel.firstChannelForLetter(navState(), 'A')).toBe('studio:1');
    });

    it('returns null when no channel starts with that letter', () => {
        expect(sel.firstChannelForLetter(navState(), 'Z')).toBeNull();
    });

    it('finds a non-alphabetic channel under #', () => {
        const s = navState({ channels: [chan('tag:9', '3D Available', 'tag')] });
        expect(sel.firstChannelForLetter(s, '#')).toBe('tag:9');
    });

    it('exposes player and layout state', () => {
        const s = navState({ playerMode: 'theater', viewerPaused: true, headWidthPx: 260 });
        expect(sel.playerMode(s)).toBe('theater');
        expect(sel.isViewerPaused(s)).toBe(true);
        expect(sel.headWidthPx(s)).toBe(260);
        expect(sel.isPreviewing(s)).toBe(false);
        expect(sel.isPreviewing(navState({ preview: { scene: {} } }))).toBe(true);
        expect(sel.preview(navState({ preview: { scene: {} } }))).not.toBeNull();
        expect(sel.guideSearch(navState({ guideSearch: 'x' }))).toBe('x');
        expect(sel.typeFilter(navState({ typeFilter: 'tag' }))).toBe('tag');
        expect(sel.channelGroups(navState({ channelGroups: [{ key: 'studio' }] }))).toHaveLength(1);
    });
});
