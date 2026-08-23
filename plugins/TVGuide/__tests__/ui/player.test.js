import { createPlayer } from '../../src/ui/player.js';
import { createStore } from '../../src/state/store.js';
import { createInitialState, PoolStatus } from '../../src/state/initialState.js';
import { Events } from '../../src/state/actions.js';
import { buildDaySchedule, dayBucket } from '../../src/domain/schedule.js';

const NOON = new Date(2026, 7, 22, 12, 0, 0).getTime();
const { key: DAY_KEY, startMs: DAY_START } = dayBucket(NOON);

const scenes = () =>
    Array.from({ length: 4 }, (_, i) => ({
        id: `s${i + 1}`,
        title: `Scene ${i + 1}`,
        paths: { stream: `/scene/${i + 1}/stream`, screenshot: `/scene/${i + 1}/shot` },
        files: [{ duration: 1800 }]
    }));

const channel = (id, name) => ({
    id, source: 'studio', name, logo: {}, sceneCount: 4, sceneFilter: {}
});

function mount(overrides = {}) {
    const initialState = {
        ...createInitialState(),
        open: true,
        nowMs: NOON,
        dayKey: DAY_KEY,
        dayStartMs: DAY_START,
        windowStartMs: NOON,
        allChannels: [channel('studio:1', 'One')],
        channels: [channel('studio:1', 'One')],
        channelsStatus: PoolStatus.READY,
        tunedChannelId: 'studio:1',
        pools: { 'studio:1': { status: PoolStatus.READY, scenes: scenes(), error: null } },
        schedules: { 'studio:1': buildDaySchedule('studio:1', scenes(), DAY_KEY) },
        ...overrides
    };

    const subscribers = [];
    const viewer = {
        element: document.createElement('video'),
        tune: jest.fn(),
        stop: jest.fn(),
        setMuted: jest.fn(),
        setPaused: jest.fn(),
        showPoster: jest.fn(),
        subscribe: (fn) => {
            subscribers.push(fn);
            return () => {};
        }
    };

    const store = createStore({ initialState });
    const player = createPlayer({ store, viewer });
    document.body.appendChild(player.element);
    store.subscribe((s) => player.render(s));
    player.render(store.getState());

    return { store, player, viewer, emit: (event) => subscribers.forEach((fn) => fn(event)) };
}

const q = (player, sel) => player.element.querySelector(sel);

beforeEach(() => {
    document.body.innerHTML = '';
});

describe('controls', () => {
    it('puts the controls over the video rather than beside it', () => {
        const { player } = mount();
        const stage = q(player, '.tvguide-player-stage');
        expect(stage.querySelector('.tvguide-player-controls')).not.toBeNull();
        expect(stage.querySelector('video')).not.toBeNull();
    });

    it('pauses and plays', () => {
        const { store, player } = mount();
        const button = q(player, '.tvguide-play');

        expect(button.getAttribute('aria-label')).toBe('Pause');
        button.click();
        expect(store.getState().viewerPaused).toBe(true);
        expect(q(player, '.tvguide-play').getAttribute('aria-label')).toBe('Play');

        q(player, '.tvguide-play').click();
        expect(store.getState().viewerPaused).toBe(false);
    });

    it('mutes and unmutes', () => {
        const { store, player } = mount({ muted: true });
        q(player, '.tvguide-mute').click();
        expect(store.getState().muted).toBe(false);
        expect(q(player, '.tvguide-mute').getAttribute('aria-pressed')).toBe('false');
    });

    it('goes to theater and back', () => {
        const { store, player } = mount();
        q(player, '.tvguide-theater').click();
        expect(store.getState().playerMode).toBe('theater');
        expect(player.element.dataset.mode).toBe('theater');

        // Pressing the mode you are in returns to the corner.
        q(player, '.tvguide-theater').click();
        expect(store.getState().playerMode).toBe('corner');
    });

    it('goes fullscreen and back', () => {
        const { store, player } = mount();
        q(player, '.tvguide-fullscreen').click();
        expect(store.getState().playerMode).toBe('fullscreen');
        q(player, '.tvguide-fullscreen').click();
        expect(store.getState().playerMode).toBe('corner');
    });

    it('keeps Watch as a separate action that leaves for the scene page', () => {
        const effects = [];
        const { store, player } = mount();
        store.subscribe(() => {});
        q(player, '.tvguide-watch').click();
        // EXPAND is the navigate-away event; it is not a player mode.
        expect(store.getState().playerMode).toBe('corner');
        expect(effects).toEqual([]);
    });

    it('labels every control for assistive tech', () => {
        const { player } = mount();
        for (const cls of ['.tvguide-play', '.tvguide-mute', '.tvguide-theater', '.tvguide-fullscreen']) {
            expect(q(player, cls).getAttribute('aria-label')).toBeTruthy();
        }
    });
});

describe('fullscreen fallbacks', () => {
    it('uses the element fullscreen API when it exists', () => {
        const { player } = mount();
        player.element.requestFullscreen = jest.fn(() => Promise.resolve());
        player.setMode('fullscreen');
        expect(player.element.requestFullscreen).toHaveBeenCalled();
    });

    it('falls back to the video\'s own fullscreen on iOS', () => {
        // iOS Safari cannot fullscreen a div -- only a video element.
        const { player, viewer } = mount();
        player.element.requestFullscreen = undefined;
        viewer.element.webkitEnterFullscreen = jest.fn();

        player.setMode('fullscreen');

        expect(viewer.element.webkitEnterFullscreen).toHaveBeenCalled();
    });

    it('survives a rejected fullscreen request', () => {
        const { player } = mount();
        player.element.requestFullscreen = jest.fn(() => Promise.reject(new Error('denied')));
        expect(() => player.setMode('fullscreen')).not.toThrow();
    });

    it('exits fullscreen when leaving the mode', () => {
        const { player } = mount();
        const exit = jest.fn(() => Promise.resolve());
        Object.defineProperty(document, 'fullscreenElement', { value: player.element, configurable: true });
        document.exitFullscreen = exit;

        player.setMode('corner');

        expect(exit).toHaveBeenCalled();
        Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true });
    });
});

describe('loading state', () => {
    it('shows the spinner while the stream loads and hides it once playing', () => {
        const { player, emit } = mount();

        emit({ type: 'loading' });
        expect(player.element.classList.contains('is-loading')).toBe(true);

        emit({ type: 'playing' });
        expect(player.element.classList.contains('is-loading')).toBe(false);
    });

    it('does not treat being paused as loading', () => {
        const { player, emit } = mount();
        emit({ type: 'paused' });
        expect(player.element.classList.contains('is-loading')).toBe(false);
    });
});

describe('progress', () => {
    it('sits below the player, not under the scene details', () => {
        const { player } = mount({ nowMs: NOON + 60000 });
        const progress = q(player, '.tvguide-player-progress [role="progressbar"]');
        expect(progress).not.toBeNull();
        expect(q(player, '.tvguide-player-times').textContent).toMatch(/\d+:\d\d/);
    });

    it('reports how much is left', () => {
        const { player } = mount({ nowMs: NOON + 60000 });
        expect(q(player, '.tvguide-player-times').textContent).toContain('min left');
    });

    it('shows nothing when there is no programme', () => {
        const { player } = mount({ tunedChannelId: null });
        expect(q(player, '.tvguide-player-progress').textContent).toBe('');
    });
});

describe('preview', () => {
    it('offers Back to live only while previewing', () => {
        const { store, player } = mount();
        expect(q(player, '.tvguide-back-to-live').hidden).toBe(true);

        const entries = store.getState().schedules['studio:1'].entries;
        store.dispatch({
            type: Events.PREVIEW,
            channelId: 'studio:1',
            timeMs: DAY_START + entries[1].offsetMs + 1000
        });

        expect(q(player, '.tvguide-back-to-live').hidden).toBe(false);
        expect(q(player, '.tvguide-player-caption').textContent).toContain('(preview)');
    });

    it('returns to live', () => {
        const { store, player } = mount();
        const entries = store.getState().schedules['studio:1'].entries;
        store.dispatch({
            type: Events.PREVIEW,
            channelId: 'studio:1',
            timeMs: DAY_START + entries[1].offsetMs + 1000
        });

        q(player, '.tvguide-back-to-live').click();

        expect(store.getState().preview).toBeNull();
    });
});

describe('caption', () => {
    it('names the tuned channel and what is on', () => {
        const { player } = mount();
        expect(q(player, '.tvguide-player-caption').textContent).toMatch(/One · Scene \d/);
    });

    it('is empty with nothing tuned', () => {
        const { player } = mount({ tunedChannelId: null });
        expect(q(player, '.tvguide-player-caption').textContent).toBe('');
    });
});
