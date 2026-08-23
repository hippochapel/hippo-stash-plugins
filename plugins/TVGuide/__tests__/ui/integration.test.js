/**
 * Integration: real store, real reducer, real views, real DOM.
 *
 * These drive the guide the way a user does -- dispatching events and asserting
 * what appears -- rather than testing view internals.
 */

import { createStore } from '../../src/state/store.js';
import { createOverlay, HASH, BODY_CLASS } from '../../src/ui/overlay.js';
import { createGrid } from '../../src/ui/grid.js';
import { createList } from '../../src/ui/list.js';
import { createBanner } from '../../src/ui/banner.js';
import { createAnnouncer } from '../../src/ui/a11y.js';
import { createTouchGuard } from '../../src/ui/gestures.js';
import { Events } from '../../src/state/actions.js';
import { buildDaySchedule, dayBucket } from '../../src/domain/schedule.js';
import { PoolStatus } from '../../src/state/initialState.js';
import { createInitialState } from '../../src/state/initialState.js';

const MIN = 60000;
const NOON = new Date(2026, 7, 22, 12, 0, 0).getTime();
const { key: DAY_KEY, startMs: DAY_START } = dayBucket(NOON);

const scenes = (n, minutes = 30) =>
    Array.from({ length: n }, (_, i) => ({
        id: `s${i + 1}`,
        title: `Scene ${i + 1}`,
        details: `Description ${i + 1}`,
        paths: { stream: `/scene/${i + 1}/stream`, screenshot: `/scene/${i + 1}/shot` },
        files: [{ duration: minutes * 60 }]
    }));

const channel = (id, name) => ({
    id,
    source: 'studio',
    name,
    logo: { type: 'monogram', initials: 'XX', hue: 200 },
    sceneCount: 10,
    sceneFilter: { studios: { value: [id], modifier: 'INCLUDES' } }
});

function baseState(overrides = {}) {
    return {
        ...createInitialState(),
        open: true,
        nowMs: NOON,
        dayKey: DAY_KEY,
        dayStartMs: DAY_START,
        windowStartMs: NOON,
        channels: [channel('studio:1', 'Channel One'), channel('studio:2', 'Channel Two')],
        channelsStatus: PoolStatus.READY,
        tunedChannelId: 'studio:1',
        focus: { channelId: 'studio:1', timeMs: NOON },
        pools: { 'studio:1': { status: PoolStatus.READY, scenes: scenes(4), error: null } },
        schedules: { 'studio:1': buildDaySchedule('studio:1', scenes(4), DAY_KEY) },
        ...overrides
    };
}

beforeEach(() => {
    document.body.innerHTML = '';
});

describe('grid rendering', () => {
    function mountGrid(state) {
        const store = createStore({ initialState: state });
        const grid = createGrid({
            store,
            onRowVisible: jest.fn(),
            touchGuard: createTouchGuard()
        });
        document.body.appendChild(grid.element);
        grid.render(store.getState());
        return { store, grid };
    }

    it('uses ARIA grid roles', () => {
        const { grid } = mountGrid(baseState());
        expect(grid.element.querySelector('[role="grid"]')).not.toBeNull();
        expect(grid.element.querySelectorAll('[role="row"]')).toHaveLength(2);
        expect(grid.element.querySelectorAll('[role="rowheader"]')).toHaveLength(2);
    });

    it('renders a row per channel with its name', () => {
        const { grid } = mountGrid(baseState());
        const names = Array.from(grid.element.querySelectorAll('.tvguide-row-name')).map(
            (n) => n.textContent
        );
        expect(names).toEqual(['Channel One', 'Channel Two']);
    });

    it('renders programme blocks positioned by percentage', () => {
        const { grid } = mountGrid(baseState());
        const blocks = grid.element.querySelectorAll('.tvguide-block');
        expect(blocks.length).toBeGreaterThan(0);
        for (const block of blocks) {
            expect(block.style.left).toMatch(/%$/);
            expect(block.style.width).toMatch(/%$/);
        }
    });

    it('marks exactly one block live and one focused', () => {
        const { grid } = mountGrid(baseState());
        expect(grid.element.querySelectorAll('.tvguide-block-live')).toHaveLength(1);
        expect(grid.element.querySelectorAll('.tvguide-block-focused')).toHaveLength(1);
    });

    it('keeps exactly one cell tabbable (roving tabindex)', () => {
        const { grid } = mountGrid(baseState());
        const tabbable = Array.from(grid.element.querySelectorAll('.tvguide-block')).filter(
            (b) => b.getAttribute('tabindex') === '0'
        );
        expect(tabbable).toHaveLength(1);
    });

    it('shows a skeleton for a channel whose pool has not arrived', () => {
        const { grid } = mountGrid(baseState());
        const row = grid.element.querySelector('[data-channel-id="studio:2"]');
        expect(row.querySelector('.tvguide-row-skeleton')).not.toBeNull();
    });

    it('reports a channel that failed to load', () => {
        const state = baseState();
        state.pools['studio:2'] = { status: PoolStatus.ERROR, scenes: [], error: 'boom' };
        const { grid } = mountGrid(state);
        const row = grid.element.querySelector('[data-channel-id="studio:2"]');
        expect(row.textContent).toContain('Could not load');
    });

    it('says so when a channel has no programming', () => {
        const state = baseState();
        state.pools['studio:2'] = { status: PoolStatus.READY, scenes: [], error: null };
        state.schedules['studio:2'] = buildDaySchedule('studio:2', [], DAY_KEY);
        const { grid } = mountGrid(state);
        expect(grid.element.querySelector('[data-channel-id="studio:2"]').textContent).toContain(
            'No programming'
        );
    });

    it('renders clock labels across the head', () => {
        const { grid } = mountGrid(baseState());
        const labels = Array.from(grid.element.querySelectorAll('.tvguide-tick')).map(
            (t) => t.textContent
        );
        expect(labels).toEqual(['12:00', '12:30', '13:00', '13:30', '14:00', '14:30']);
    });

    it('positions the now-line and hides it when panned away', () => {
        const { grid } = mountGrid(baseState({ nowMs: NOON + 90 * MIN }));
        const line = grid.element.querySelector('.tvguide-nowline');
        expect(line.style.left).toBe('50%');

        grid.render(baseState({ windowStartMs: NOON + 10 * 3600000 }));
        expect(line.style.display).toBe('none');
    });

    it('tunes the channel when a block is clicked', () => {
        const { store, grid } = mountGrid(baseState());
        const row = grid.element.querySelector('[data-channel-id="studio:1"]');
        row.querySelector('.tvguide-block').click();
        expect(store.getState().tunedChannelId).toBe('studio:1');
    });

    it('previews a programme on hover', () => {
        const { store, grid } = mountGrid(baseState());
        const blocks = grid.element.querySelectorAll('[data-channel-id="studio:1"] .tvguide-block');
        const target = blocks[blocks.length - 1];

        target.dispatchEvent(new MouseEvent('mouseenter'));

        expect(store.getState().focus.timeMs).toBe(Number(target.dataset.startMs));
    });

    it('ignores the synthetic mouseenter that follows a tap', () => {
        const store = createStore({ initialState: baseState() });
        const touchGuard = createTouchGuard();
        const grid = createGrid({ store, onRowVisible: jest.fn(), touchGuard });
        document.body.appendChild(grid.element);
        grid.render(store.getState());

        const before = store.getState().focus.timeMs;
        touchGuard.noteTouch(); // a finger just lifted
        const blocks = grid.element.querySelectorAll('[data-channel-id="studio:1"] .tvguide-block');
        blocks[blocks.length - 1].dispatchEvent(new MouseEvent('mouseenter'));

        expect(store.getState().focus.timeMs).toBe(before);
    });

    it('does not rebuild blocks on a plain clock tick', () => {
        const { store, grid } = mountGrid(baseState());
        const block = grid.element.querySelector('.tvguide-block');

        store.dispatch({ type: Events.TICK, nowMs: NOON + 1000 });
        grid.render(store.getState());

        // Same node: a tick restyles, it does not replace the DOM.
        expect(grid.element.querySelector('.tvguide-block')).toBe(block);
    });

    it('rebuilds blocks when the window pans', () => {
        const { store, grid } = mountGrid(baseState());
        const block = grid.element.querySelector('.tvguide-block');

        store.dispatch({ type: Events.PAN, deltaMs: 60 * MIN });
        grid.render(store.getState());

        expect(grid.element.querySelector('.tvguide-block')).not.toBe(block);
    });
});

describe('list rendering', () => {
    function mountList(state) {
        const store = createStore({ initialState: state });
        const list = createList({ store, onRowVisible: jest.fn() });
        document.body.appendChild(list.element);
        list.render(store.getState());
        return { store, list };
    }

    it('renders one item per channel', () => {
        const { list } = mountList(baseState({ layout: 'list' }));
        expect(list.element.querySelectorAll('.tvguide-list-item')).toHaveLength(2);
    });

    it('shows now, next and a description', () => {
        const { list } = mountList(baseState({ layout: 'list' }));
        const item = list.element.querySelector('[data-channel-id="studio:1"]');
        expect(item.textContent).toMatch(/Scene \d/);
        expect(item.textContent).toContain('Description');
        expect(item.textContent).toContain('Next');
    });

    it('marks the tuned channel', () => {
        const { list } = mountList(baseState({ layout: 'list' }));
        const item = list.element.querySelector('[data-channel-id="studio:1"]');
        expect(item.classList.contains('tvguide-list-item-tuned')).toBe(true);
        expect(item.querySelector('.tvguide-list-button').getAttribute('aria-pressed')).toBe('true');
    });

    it('tunes on tap', () => {
        const { store, list } = mountList(baseState({ layout: 'list', tunedChannelId: 'studio:2' }));
        list.element
            .querySelector('[data-channel-id="studio:1"] .tvguide-list-button')
            .click();
        expect(store.getState().tunedChannelId).toBe('studio:1');
    });

    it('offers a labelled watch control only where something is playing', () => {
        const { list } = mountList(baseState({ layout: 'list' }));
        const one = list.element.querySelector('[data-channel-id="studio:1"] .tvguide-list-expand');
        const two = list.element.querySelector('[data-channel-id="studio:2"] .tvguide-list-expand');
        expect(one.getAttribute('aria-label')).toMatch(/Watch Scene \d on Channel One/);
        expect(two).toBeNull();
    });

    it('reports load failures', () => {
        const state = baseState({ layout: 'list' });
        state.pools['studio:2'] = { status: PoolStatus.ERROR, scenes: [], error: 'boom' };
        const { list } = mountList(state);
        expect(
            list.element.querySelector('[data-channel-id="studio:2"]').textContent
        ).toContain('Could not load');
    });
});

describe('banner', () => {
    it('describes the focused programme with a progress bar', () => {
        const banner = createBanner();
        banner.render(baseState());

        expect(banner.element.querySelector('.tvguide-banner-title').textContent).toMatch(/Scene \d/);
        expect(banner.element.textContent).toContain('Channel One');
        expect(banner.element.textContent).toContain('Description');
        expect(banner.element.querySelector('[role="progressbar"]')).not.toBeNull();
        expect(banner.element.querySelector('.tvguide-live-badge')).not.toBeNull();
    });

    it('prompts when nothing is focused', () => {
        const banner = createBanner();
        banner.render(baseState({ focus: null }));
        expect(banner.element.textContent).toContain('Select a channel');
    });

    it('says when a focused channel has nothing scheduled', () => {
        const banner = createBanner();
        banner.render(baseState({ focus: { channelId: 'studio:2', timeMs: NOON } }));
        expect(banner.element.textContent).toContain('nothing scheduled');
    });

    it('drops the live badge for a programme in the future', () => {
        const banner = createBanner();
        const state = baseState();
        const future = state.schedules['studio:1'].entries[2];
        banner.render({ ...state, focus: { channelId: 'studio:1', timeMs: DAY_START + future.offsetMs } });
        expect(banner.element.querySelector('.tvguide-live-badge')).toBeNull();
    });
});

describe('overlay', () => {
    function mountOverlay(state) {
        const store = createStore({ initialState: state });
        const viewer = { element: document.createElement('video'), tune: jest.fn(), stop: jest.fn(), setMuted: jest.fn() };
        const overlay = createOverlay({
            store,
            viewer,
            announcer: createAnnouncer(),
            touchGuard: createTouchGuard(),
            onRowVisible: jest.fn()
        });
        store.subscribe((s) => overlay.render(s));
        overlay.render(store.getState());
        return { store, overlay, viewer };
    }

    it('presents itself as a modal dialog', () => {
        const { overlay } = mountOverlay(baseState());
        expect(overlay.element.getAttribute('role')).toBe('dialog');
        expect(overlay.element.getAttribute('aria-modal')).toBe('true');
        expect(overlay.element.getAttribute('aria-label')).toBe('TV Guide');
    });

    it('mounts into the body and flags it while open', () => {
        mountOverlay(baseState());
        expect(document.body.classList.contains(BODY_CLASS)).toBe(true);
        expect(document.querySelector('.tvguide-overlay')).not.toBeNull();
    });

    it('unmounts and unflags when closed', () => {
        const { store } = mountOverlay(baseState());
        store.dispatch({ type: Events.CLOSE });
        expect(document.body.classList.contains(BODY_CLASS)).toBe(false);
        expect(document.querySelector('.tvguide-overlay')).toBeNull();
    });

    it('shows the grid on desktop and the list on a phone', () => {
        const { store, overlay } = mountOverlay(baseState());
        expect(overlay.element.querySelector('.tvguide-grid')).not.toBeNull();

        store.dispatch({ type: Events.LAYOUT_CHANGED, layout: 'list' });

        expect(overlay.element.querySelector('.tvguide-list')).not.toBeNull();
        expect(overlay.element.querySelector('.tvguide-grid')).toBeNull();
    });

    it('pans with the toolbar controls', () => {
        const { store, overlay } = mountOverlay(baseState());
        const before = store.getState().windowStartMs;

        overlay.element.querySelectorAll('.tvguide-pan')[1].click();

        expect(store.getState().windowStartMs).toBeGreaterThan(before);
    });

    it('returns to now', () => {
        const { store, overlay } = mountOverlay(baseState({ windowStartMs: DAY_START }));
        overlay.element.querySelector('.tvguide-now').click();
        expect(store.getState().windowStartMs).toBeGreaterThan(DAY_START);
    });

    it('toggles mute from the viewer controls', () => {
        const { store, overlay } = mountOverlay(baseState({ muted: true }));
        overlay.element.querySelector('.tvguide-mute').click();
        expect(store.getState().muted).toBe(false);
        expect(overlay.element.querySelector('.tvguide-mute').textContent).toBe('Mute');
    });

    it('names the tuned channel and its programme under the viewer', () => {
        const { overlay } = mountOverlay(baseState());
        expect(overlay.element.querySelector('.tvguide-viewer-caption').textContent).toMatch(
            /Channel One · Scene \d/
        );
    });

    it('hides the viewer entirely when autoplay is off', () => {
        const state = baseState();
        state.settings = { ...state.settings, guide_autoplay: false };
        const { overlay } = mountOverlay(state);
        expect(overlay.element.querySelector('.tvguide-viewer').hidden).toBe(true);
    });

    it('toggles the shortcut help panel', () => {
        const { overlay } = mountOverlay(baseState());
        const help = overlay.element.querySelector('.tvguide-help');
        expect(help.hidden).toBe(true);

        overlay.toggleHelp();
        expect(help.hidden).toBe(false);
        expect(help.textContent).toContain('Back to now');
    });

    it('reports loading, failure and an empty lineup', () => {
        const { store, overlay } = mountOverlay(
            baseState({ channels: [], channelsStatus: PoolStatus.LOADING })
        );
        expect(overlay.element.querySelector('.tvguide-status').textContent).toContain('Loading');

        store.dispatch({ type: Events.CHANNELS_FAILED, message: 'offline' });
        expect(overlay.element.querySelector('.tvguide-status').textContent).toContain('offline');

        store.dispatch({ type: Events.CHANNELS_LOADED, channels: [], errors: [] });
        expect(overlay.element.querySelector('.tvguide-status').textContent).toContain('No channels');
    });

    it('mentions partly-failed sources without hiding the channels that worked', () => {
        const { store, overlay } = mountOverlay(baseState({ channels: [] }));
        store.dispatch({
            type: Events.CHANNELS_LOADED,
            channels: [channel('studio:1', 'One')],
            errors: [{ source: 'tag', message: 'boom' }]
        });
        expect(overlay.element.querySelector('.tvguide-status').textContent).toContain('1 source(s) failed');
    });

    it('closes from the close button', () => {
        const { store, overlay } = mountOverlay(baseState());
        overlay.element.querySelector('.tvguide-close').click();
        expect(store.getState().open).toBe(false);
    });

    it('pushes the hash when opened so Back can close it', () => {
        const { store, overlay } = mountOverlay(baseState({ open: false }));
        overlay.open();
        expect(window.location.hash).toBe(HASH);
        expect(store.getState().open).toBe(true);
    });
});
