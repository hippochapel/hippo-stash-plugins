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

    it('leaves Watch to the scene details', () => {
        // It used to sit here and always meant "the channel that is tuned", so
        // previewing something and pressing it opened a different scene from
        // the one on screen.
        const { player } = mount();
        expect(q(player, '.tvguide-watch')).toBeNull();
    });

    it('uses SVG icons rather than emoji', () => {
        const { player } = mount();
        for (const cls of ['.tvguide-play', '.tvguide-mute', '.tvguide-theater', '.tvguide-fullscreen']) {
            expect(q(player, `${cls} svg`)).not.toBeNull();
            // No emoji or glyph text left behind beside the icon.
            expect(q(player, cls).textContent).toBe('');
        }
    });

    it('leaves an unchanged icon alone', () => {
        // `render` runs every second, and these buttons are inside the element
        // that goes fullscreen. Tearing an SVG out of the fullscreen subtree
        // once a tick is the kind of churn that drops fullscreen.
        const { store, player } = mount();
        const before = q(player, '.tvguide-play svg');

        store.dispatch({ type: Events.TICK, nowMs: NOON + 1000 });
        store.dispatch({ type: Events.TICK, nowMs: NOON + 2000 });

        expect(q(player, '.tvguide-play svg')).toBe(before);
    });

    it('swaps the icon when state changes', () => {
        const { player } = mount();
        const before = q(player, '.tvguide-play svg').innerHTML;
        q(player, '.tvguide-play').click();
        expect(q(player, '.tvguide-play svg').innerHTML).not.toBe(before);
        // Exactly one icon -- the old one is removed, not stacked.
        expect(q(player, '.tvguide-play').querySelectorAll('svg')).toHaveLength(1);
    });

    it('keeps words on the wider controls', () => {
        const { player } = mount();
        expect(q(player, '.tvguide-back-to-live').textContent).toBe('Back to live');
    });

    it('freezes the readout while paused', () => {
        // The readout is schedule time, not video time, so it used to run on
        // while the picture stood still.
        const { store, player } = mount();
        const times = () => q(player, '.tvguide-player-times').textContent;

        store.dispatch({ type: Events.TICK, nowMs: NOON + 5 * 60000 });
        const running = times();

        store.dispatch({ type: Events.SET_VIEWER_PAUSED, paused: true });
        const atPause = times();
        expect(atPause).toBe(running);

        store.dispatch({ type: Events.TICK, nowMs: NOON + 9 * 60000 });
        expect(times()).toBe(atPause);
    });

    it('catches back up to live when unpaused', () => {
        // Resuming re-syncs the stream to live, so the readout must jump with
        // it rather than carrying on from the pause point.
        const { store, player } = mount();
        const times = () => q(player, '.tvguide-player-times').textContent;

        store.dispatch({ type: Events.SET_VIEWER_PAUSED, paused: true });
        const atPause = times();

        store.dispatch({ type: Events.TICK, nowMs: NOON + 9 * 60000 });
        store.dispatch({ type: Events.SET_VIEWER_PAUSED, paused: false });

        expect(times()).not.toBe(atPause);
    });

    it('labels every control for assistive tech', () => {
        const { player } = mount();
        for (const cls of ['.tvguide-play', '.tvguide-mute', '.tvguide-theater', '.tvguide-fullscreen']) {
            expect(q(player, cls).getAttribute('aria-label')).toBeTruthy();
        }
    });
});

describe('fullscreen fallbacks', () => {
    it('fullscreens the stage, not the whole panel', () => {
        // The panel's progress readout is rewritten every second; keeping the
        // fullscreen element off that subtree is what stopped fullscreen
        // dropping out a tick after it opened.
        const { player } = mount();
        const stage = q(player, '.tvguide-player-stage');
        stage.requestFullscreen = jest.fn(() => Promise.resolve());

        player.setMode('fullscreen');

        expect(stage.requestFullscreen).toHaveBeenCalled();
    });

    it('does not re-request fullscreen it is already in', () => {
        const { player } = mount();
        const stage = q(player, '.tvguide-player-stage');
        stage.requestFullscreen = jest.fn(() => Promise.resolve());
        Object.defineProperty(document, 'fullscreenElement', { value: stage, configurable: true });

        player.setMode('fullscreen');

        expect(stage.requestFullscreen).not.toHaveBeenCalled();
        Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true });
    });

    it('returns to corner when the browser leaves fullscreen on its own', () => {
        // Esc, or the OS dropping out, must not leave the button claiming
        // we are still fullscreen.
        const { store, player } = mount();
        store.dispatch({ type: Events.SET_PLAYER_MODE, mode: 'fullscreen' });
        expect(store.getState().playerMode).toBe('fullscreen');

        Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true });
        document.dispatchEvent(new Event('fullscreenchange'));

        expect(store.getState().playerMode).toBe('corner');
    });

    it('falls back to the video\'s own fullscreen on iOS', () => {
        // iOS Safari cannot fullscreen a div -- only a video element.
        const { player, viewer } = mount();
        q(player, '.tvguide-player-stage').requestFullscreen = undefined;
        viewer.element.webkitEnterFullscreen = jest.fn();

        player.setMode('fullscreen');

        expect(viewer.element.webkitEnterFullscreen).toHaveBeenCalled();
    });

    it('survives a rejected fullscreen request', () => {
        const { player } = mount();
        q(player, '.tvguide-player-stage').requestFullscreen = jest.fn(() => Promise.reject(new Error('denied')));
        expect(() => player.setMode('fullscreen')).not.toThrow();
    });

    it('exits fullscreen when leaving the mode', () => {
        const { player } = mount();
        const stage = q(player, '.tvguide-player-stage');
        const exit = jest.fn(() => Promise.resolve());
        Object.defineProperty(document, 'fullscreenElement', { value: stage, configurable: true });
        document.exitFullscreen = exit;

        player.setMode('corner');

        expect(exit).toHaveBeenCalled();
        Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true });
    });

    it('does not exit fullscreen it did not open', () => {
        const { player } = mount();
        const exit = jest.fn(() => Promise.resolve());
        Object.defineProperty(document, 'fullscreenElement', {
            value: document.createElement('div'),
            configurable: true
        });
        document.exitFullscreen = exit;

        player.setMode('corner');

        expect(exit).not.toHaveBeenCalled();
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

describe('control visibility', () => {
    it('keeps the controls hidden until the pointer is over the player', () => {
        // Driven from pointer events, not @media (hover: hover), which reported
        // the wrong thing on a real machine and left them permanently on.
        const { player } = mount();
        const stage = q(player, '.tvguide-player-stage');

        expect(player.element.classList.contains('is-showing-controls')).toBe(false);

        stage.dispatchEvent(new MouseEvent('mouseenter'));
        expect(player.element.classList.contains('is-showing-controls')).toBe(true);
    });

    it('hides them again shortly after the pointer leaves', () => {
        jest.useFakeTimers();
        const { player } = mount();
        const stage = q(player, '.tvguide-player-stage');

        stage.dispatchEvent(new MouseEvent('mouseenter'));
        stage.dispatchEvent(new MouseEvent('mouseleave'));
        jest.advanceTimersByTime(200);

        expect(player.element.classList.contains('is-showing-controls')).toBe(false);
        jest.useRealTimers();
    });

    it('shows them for keyboard focus, which has no hover', () => {
        const { player } = mount();
        q(player, '.tvguide-player-stage').dispatchEvent(new Event('focusin', { bubbles: true }));
        expect(player.element.classList.contains('is-showing-controls')).toBe(true);
    });

    it('shows them on touch, where there is no hover at all', () => {
        const { player } = mount();
        q(player, '.tvguide-player-stage').dispatchEvent(new Event('touchstart'));
        expect(player.element.classList.contains('is-showing-controls')).toBe(true);
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
        // Nothing is streaming, so the video is hidden rather than sitting
        // there as a black rectangle pretending to be a player.
        expect(player.element.classList.contains('is-previewing')).toBe(true);
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
