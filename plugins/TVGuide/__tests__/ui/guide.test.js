/**
 * The Phase 3 grid: grouping, the corrected now-line, condensed rows, pinning
 * from the guide, the type bar and the A-Z rail.
 */

import { createStore } from '../../src/state/store.js';
import { createGrid } from '../../src/ui/grid.js';
import { createChannelRail } from '../../src/ui/channelRail.js';
import { createTouchGuard } from '../../src/ui/gestures.js';
import { createInitialState, PoolStatus } from '../../src/state/initialState.js';
import { Events } from '../../src/state/actions.js';
import { buildDaySchedule, dayBucket } from '../../src/domain/schedule.js';
import { groupChannels, flattenGroups } from '../../src/domain/channelPrefs.js';
import { KNOWN_SOURCES } from '../../src/domain/lineup.js';

const MIN = 60000;
const NOON = new Date(2026, 7, 22, 12, 0, 0).getTime();
const { key: DAY_KEY, startMs: DAY_START } = dayBucket(NOON);

const scenes = (n, minutes) =>
    Array.from({ length: n }, (_, i) => ({
        id: `s${i + 1}`,
        title: `Scene ${i + 1}`,
        details: 'Details',
        paths: { stream: `/s/${i}`, screenshot: `/p/${i}` },
        files: [{ duration: minutes * 60 }]
    }));

const chan = (id, name, source = 'studio') => ({
    id, source, name, logo: { type: 'monogram', initials: 'XX', hue: 1 },
    sceneCount: 10, sceneFilter: {}
});

function mount(overrides = {}) {
    const state = {
        ...createInitialState(),
        open: true,
        nowMs: NOON,
        dayKey: DAY_KEY,
        dayStartMs: DAY_START,
        windowStartMs: NOON,
        channelsStatus: PoolStatus.READY,
        tunedChannelId: 'studio:1',
        focus: { channelId: 'studio:1', timeMs: NOON, source: 'keyboard' },
        allChannels: [chan('studio:1', 'Alpha'), chan('studio:2', 'Bravo'), chan('tag:1', 'Beach', 'tag')],
        pools: {
            'studio:1': { status: PoolStatus.READY, scenes: scenes(4, 30), error: null },
            'studio:2': { status: PoolStatus.READY, scenes: scenes(4, 30), error: null },
            'tag:1': { status: PoolStatus.READY, scenes: scenes(4, 30), error: null }
        },
        schedules: {
            'studio:1': buildDaySchedule('studio:1', scenes(4, 30), DAY_KEY),
            'studio:2': buildDaySchedule('studio:2', scenes(4, 30), DAY_KEY),
            'tag:1': buildDaySchedule('tag:1', scenes(4, 30), DAY_KEY)
        },
        ...overrides
    };

    state.channelGroups = groupChannels(state.allChannels, {
        prefs: state.prefs,
        pinOrder: state.pinOrder,
        sort: state.sort,
        sourceOrder: KNOWN_SOURCES,
        collapsed: state.collapsedGroups
    });
    state.channels = flattenGroups(state.channelGroups);

    const store = createStore({ initialState: state });
    const grid = createGrid({ store, onRowVisible: jest.fn(), touchGuard: createTouchGuard() });
    document.body.appendChild(grid.element);
    store.subscribe((s) => grid.render(s));
    grid.render(store.getState());
    return { store, grid };
}

const rows = (grid) => [...grid.element.querySelectorAll('.tvguide-row')].map((r) => r.dataset.channelId);

beforeEach(() => {
    document.body.innerHTML = '';
});

describe('grouping', () => {
    it('puts a header before each source group', () => {
        const { grid } = mount();
        const labels = [...grid.element.querySelectorAll('.tvguide-group-label')].map((n) => n.textContent);
        expect(labels).toEqual(['Studios', 'Tags']);
    });

    it('shows a count per group', () => {
        const { grid } = mount();
        expect(grid.element.querySelector('.tvguide-group-count').textContent).toBe('(2)');
    });

    it('collapses a group, removing its rows', () => {
        const { store, grid } = mount();
        grid.element.querySelector('.tvguide-group-toggle').click();

        expect(store.getState().collapsedGroups).toContain('studio');
        expect(rows(grid)).toEqual(['tag:1']);
    });

    it('marks the collapsed state for assistive tech', () => {
        const { grid } = mount();
        const toggle = grid.element.querySelector('.tvguide-group-toggle');
        expect(toggle.getAttribute('aria-expanded')).toBe('true');
        toggle.click();
        expect(grid.element.querySelector('.tvguide-group-toggle').getAttribute('aria-expanded')).toBe('false');
    });

    it('lifts a pinned channel into a pinned group at the top', () => {
        const { store, grid } = mount();
        const pin = grid.element.querySelector('[data-channel-id="tag:1"] .tvguide-pin');

        pin.click();

        expect(store.getState().pinOrder).toEqual(['tag:1']);
        expect(rows(grid)[0]).toBe('tag:1');
        expect(grid.element.querySelector('.tvguide-group-label').textContent).toBe('Pinned');
    });

    it('makes pinned rows draggable so they can be reordered', () => {
        const { grid } = mount({ pinOrder: ['studio:1', 'studio:2'] });
        const pinnedRow = grid.element.querySelector('.tvguide-row-pinned');
        expect(pinnedRow.getAttribute('draggable')).toBe('true');
    });

    it('reorders pins by drag and drop', () => {
        const { store, grid } = mount({ pinOrder: ['studio:1', 'studio:2'] });
        const [first, second] = grid.element.querySelectorAll('.tvguide-row-pinned');

        first.dispatchEvent(new Event('dragstart'));
        const drop = new Event('drop');
        second.dispatchEvent(drop);

        expect(store.getState().pinOrder).toEqual(['studio:2', 'studio:1']);
    });
});

describe('the now-line', () => {
    it('is positioned as a percentage of the track, not of the whole grid', () => {
        // Regression: it used to be positioned against the full scroll
        // container and then offset by the channel column, which put it
        // progressively too far right and eventually off-screen.
        const { grid } = mount({ nowMs: NOON + 90 * MIN });
        const line = grid.element.querySelector('.tvguide-nowline');
        const overlay = grid.element.querySelector('.tvguide-track-overlay');

        expect(overlay.contains(line)).toBe(true);
        // 90 minutes into a 3-hour window is exactly halfway.
        expect(line.style.left).toBe('50%');
        // The offset now comes from the overlay, not a margin on the line.
        expect(line.style.marginLeft).toBe('');
    });

    it('tracks the clock across the window', () => {
        for (const [minutes, expected] of [[0, '0%'], [45, '25%'], [135, '75%']]) {
            document.body.innerHTML = '';
            const { grid } = mount({ nowMs: NOON + minutes * MIN });
            expect(grid.element.querySelector('.tvguide-nowline').style.left).toBe(expected);
        }
    });

    it('hides when the window is panned away from now', () => {
        const { grid } = mount({ windowStartMs: NOON + 5 * 3600000 });
        expect(grid.element.querySelector('.tvguide-nowline').style.display).toBe('none');
    });

    it('draws a boundary line at every tick', () => {
        const { grid } = mount();
        const lines = grid.element.querySelectorAll('.tvguide-gridline');
        const ticks = grid.element.querySelectorAll('.tvguide-tick');
        expect(lines).toHaveLength(ticks.length);
        expect([...lines].map((l) => l.style.left)).toEqual([...ticks].map((t) => t.style.left));
    });
});

describe('the type bar', () => {
    it('offers All plus a button per type that has channels', () => {
        const { grid } = mount();
        const labels = [...grid.element.querySelectorAll('.tvguide-typebutton')].map((b) => b.textContent);
        expect(labels).toEqual(['All', 'Studios', 'Tags']);
    });

    it('leaves out a type with no channels, since it is not a mode you can be in', () => {
        const { grid } = mount();
        const labels = [...grid.element.querySelectorAll('.tvguide-typebutton')].map((b) => b.textContent);
        expect(labels).not.toContain('Models');
        expect(labels).not.toContain('Groups');
    });

    it('hides the bar entirely when there is only one type', () => {
        const { grid } = mount({ allChannels: [chan('studio:1', 'Alpha')] });
        expect(grid.element.querySelector('.tvguide-typebar').hidden).toBe(true);
    });

    it('jumps to a group as well as filtering to it', () => {
        const { grid } = mount();
        const header = grid.element.querySelector('.tvguide-group[data-group="tag"]');
        header.scrollIntoView = jest.fn();

        [...grid.element.querySelectorAll('.tvguide-typebutton')]
            .find((b) => b.textContent === 'Tags')
            .click();

        // Filtering leaves a single group, so re-find it after the rebuild.
        const after = grid.element.querySelector('.tvguide-group[data-group="tag"]');
        expect(after).not.toBeNull();
    });

    it('narrows the guide to one type', () => {
        const { store, grid } = mount();
        [...grid.element.querySelectorAll('.tvguide-typebutton')]
            .find((b) => b.textContent === 'Tags')
            .click();

        expect(store.getState().typeFilter).toBe('tag');
        expect(rows(grid)).toEqual(['tag:1']);
    });
});

describe('the A-Z rail', () => {
    it('offers a letter per initial present', () => {
        const { grid } = mount();
        const letters = [...grid.element.querySelectorAll('.tvguide-rail-letter')].map((b) => b.textContent);
        expect(letters).toEqual(['A', 'B']);
    });

    it('switches to name sort when a letter is used', () => {
        // A letter has no meaning in any other order.
        const store = createStore({
            initialState: {
                ...createInitialState(),
                sort: 'sceneCount',
                allChannels: [chan('studio:1', 'Alpha')],
                channels: [chan('studio:1', 'Alpha')]
            }
        });
        const onJump = jest.fn();
        const rail = createChannelRail({ store, onJump });
        rail.render(store.getState());

        rail.element.querySelector('.tvguide-rail-letter').click();

        expect(store.getState().sort).toBe('name');
        expect(onJump).toHaveBeenCalledWith('studio:1');
    });

    it('scrolls the guide to the first channel for that letter', () => {
        // The rail-to-grid path was never exercised: the unit test only checked
        // that onJump fired.
        const { grid } = mount();
        const scrolled = [];
        for (const row of grid.element.querySelectorAll('.tvguide-row')) {
            row.scrollIntoView = () => scrolled.push(row.dataset.channelId);
        }

        const letters = [...grid.element.querySelectorAll('.tvguide-rail-letter')];
        letters.find((b) => b.textContent === 'B').click();

        // First channel whose name starts with B, in the order shown.
        expect(scrolled).toEqual(['studio:2']);
    });

    it('spreads the letters down the rail rather than bunching them', () => {
        const { grid } = mount();
        const rail = grid.element.querySelector('.tvguide-rail');
        expect(rail.querySelectorAll('.tvguide-rail-letter').length).toBeGreaterThan(1);
        // Letters are buttons that grow to fill, not fixed-height text.
        expect(rail.parentElement.className).toContain('tvguide-grid-main');
    });

    it('does not jump when no channel starts with that letter', () => {
        const store = createStore({
            initialState: { ...createInitialState(), allChannels: [], channels: [] }
        });
        const onJump = jest.fn();
        const rail = createChannelRail({ store, onJump });
        rail.render(store.getState());
        expect(rail.element.querySelectorAll('.tvguide-rail-letter')).toHaveLength(0);
        expect(onJump).not.toHaveBeenCalled();
    });
});

describe('the channel column', () => {
    it('is driven by a width variable the resizer changes', () => {
        const { store, grid } = mount();
        expect(grid.element.style.getPropertyValue('--tvguide-head-width')).toBe('200px');

        store.dispatch({ type: Events.SET_HEAD_WIDTH, px: 300 });

        expect(grid.element.style.getPropertyValue('--tvguide-head-width')).toBe('300px');
    });

    it('resizes from the keyboard', () => {
        const { store, grid } = mount();
        const resizer = grid.element.querySelector('.tvguide-resizer');

        resizer.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
        expect(store.getState().headWidthPx).toBe(210);

        resizer.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
        expect(store.getState().headWidthPx).toBe(200);
    });

    it('ignores other keys on the resizer', () => {
        const { store, grid } = mount();
        grid.element
            .querySelector('.tvguide-resizer')
            .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
        expect(store.getState().headWidthPx).toBe(200);
    });
});

describe('row controls', () => {
    it('opens the channel source from its name', () => {
        const { grid } = mount();
        const open = jest.spyOn(window, 'open').mockImplementation(() => null);

        grid.element.querySelector('[data-channel-id="studio:1"] .tvguide-row-name').click();

        expect(open).toHaveBeenCalledWith('/studios/1', '_blank', 'noopener');
        open.mockRestore();
    });

    it('shows the name as the badge when a channel has no artwork', () => {
        const { grid } = mount();
        const row = grid.element.querySelector('[data-channel-id="studio:1"]');
        expect(row.querySelector('.tvguide-logo-button')).toBeNull();
        expect(row.querySelector('.tvguide-row-name').textContent).toBe('Alpha');
    });

    it('shows artwork instead of the name, not as well as it', () => {
        // Studio artwork is a wordmark, so a name beside it repeats itself.
        const withArt = {
            ...chan('studio:1', 'Alpha'),
            logo: { type: 'image', url: '/img.png' }
        };
        const { grid } = mount({ allChannels: [withArt] });
        const row = grid.element.querySelector('[data-channel-id="studio:1"]');

        expect(row.querySelector('.tvguide-logo-button img')).not.toBeNull();
        expect(row.querySelector('.tvguide-row-name')).toBeNull();
        // The name is still available to assistive tech and on hover.
        expect(row.querySelector('.tvguide-logo-button').getAttribute('aria-label')).toBe('Open Alpha');
        expect(row.querySelector('.tvguide-logo-button').title).toBe('Alpha');
    });

    it('labels the pin button by what it will do', () => {
        const { grid } = mount();
        const pin = grid.element.querySelector('[data-channel-id="studio:1"] .tvguide-pin');
        expect(pin.getAttribute('aria-label')).toBe('Pin Alpha');
        pin.click();
        expect(
            grid.element.querySelector('[data-channel-id="studio:1"] .tvguide-pin').getAttribute('aria-label')
        ).toBe('Unpin Alpha');
    });
});

describe('leaving the grid', () => {
    it('puts the details back on what is playing after a hover', () => {
        const { store, grid } = mount();
        const blocks = grid.element.querySelectorAll('[data-channel-id="studio:1"] .tvguide-block');
        const future = blocks[blocks.length - 1];

        future.dispatchEvent(new MouseEvent('mouseenter'));
        expect(store.getState().focus.source).toBe('hover');

        grid.element.querySelector('.tvguide-grid-body').dispatchEvent(new MouseEvent('mouseleave'));

        expect(store.getState().focus.source).toBe('live');
        expect(store.getState().focus.channelId).toBe('studio:1');
    });

    it('leaves a clicked preview alone', () => {
        // A click is a deliberate choice; only a hover is transient.
        const { store, grid } = mount();
        const blocks = grid.element.querySelectorAll('[data-channel-id="studio:1"] .tvguide-block');
        const future = [...blocks].find((b) => !b.classList.contains('tvguide-block-live'));

        future.click();
        const previewed = store.getState().focus.timeMs;

        grid.element.querySelector('.tvguide-grid-body').dispatchEvent(new MouseEvent('mouseleave'));

        expect(store.getState().focus.timeMs).toBe(previewed);
    });

    it('leaves keyboard focus alone', () => {
        const { store, grid } = mount();
        store.dispatch({ type: Events.MOVE_FOCUS, axis: 'time', delta: 1 });
        const moved = store.getState().focus.timeMs;

        grid.element.querySelector('.tvguide-grid-body').dispatchEvent(new MouseEvent('mouseleave'));

        expect(store.getState().focus.timeMs).toBe(moved);
    });
});

describe('condensed rows', () => {
    /** jsdom reports zero widths, so the track width is stubbed. */
    const withTrackWidth = (grid, px) => {
        for (const track of grid.element.querySelectorAll('.tvguide-row-track')) {
            Object.defineProperty(track, 'clientWidth', { value: px, configurable: true });
        }
    };

    it('leaves a normal channel on the true time grid', () => {
        const { store, grid } = mount();
        withTrackWidth(grid, 1200);
        store.dispatch({ type: Events.TICK, nowMs: NOON + 1 });
        store.dispatch({ type: Events.PAN, deltaMs: 30 * MIN });

        const row = grid.element.querySelector('[data-channel-id="studio:1"] .tvguide-row-track');
        expect(row.classList.contains('is-condensed')).toBe(false);
        expect(row.querySelector('.tvguide-block').style.left).toMatch(/%$/);
    });

    it('condenses a channel of very short scenes', () => {
        const shorts = scenes(40, 2);
        const { store, grid } = mount({
            pools: { 'studio:1': { status: PoolStatus.READY, scenes: shorts, error: null } },
            schedules: { 'studio:1': buildDaySchedule('studio:1', shorts, DAY_KEY) },
            allChannels: [chan('studio:1', 'Alpha')]
        });
        withTrackWidth(grid, 600);
        store.dispatch({ type: Events.PAN, deltaMs: 30 * MIN });

        const track = grid.element.querySelector('[data-channel-id="studio:1"] .tvguide-row-track');
        expect(track.classList.contains('is-condensed')).toBe(true);
        expect(track.querySelectorAll('.tvguide-condensed-count').length).toBeGreaterThan(0);
        expect(track.querySelectorAll('.tvguide-condensed-block').length).toBeGreaterThan(0);
        expect(track.textContent).toMatch(/\d+ scenes/);
    });

    it('does not condense before layout, when no width is known', () => {
        const shorts = scenes(40, 2);
        const { grid } = mount({
            pools: { 'studio:1': { status: PoolStatus.READY, scenes: shorts, error: null } },
            schedules: { 'studio:1': buildDaySchedule('studio:1', shorts, DAY_KEY) },
            allChannels: [chan('studio:1', 'Alpha')]
        });
        const track = grid.element.querySelector('[data-channel-id="studio:1"] .tvguide-row-track');
        expect(track.classList.contains('is-condensed')).toBe(false);
    });
});

describe('the resizer actually binds', () => {
    it('responds to a pointer drag', () => {
        // Regression: this listener was registered after `return` inside
        // createGrid, so it never bound and dragging did nothing at all.
        const { store, grid } = mount();
        const resizer = grid.element.querySelector('.tvguide-resizer');

        resizer.dispatchEvent(new MouseEvent('pointerdown', { clientX: 100, bubbles: true }));
        window.dispatchEvent(new MouseEvent('pointermove', { clientX: 160, bubbles: true }));

        expect(store.getState().headWidthPx).toBe(260);

        window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
        window.dispatchEvent(new MouseEvent('pointermove', { clientX: 400, bubbles: true }));

        // Released: further movement must not keep resizing.
        expect(store.getState().headWidthPx).toBe(260);
    });
});
