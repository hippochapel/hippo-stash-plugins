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
    mountedPlayers.push(player);
    document.body.appendChild(player.element);
    store.subscribe((s) => player.render(s));
    player.render(store.getState());

    return { store, player, viewer, emit: (event) => subscribers.forEach((fn) => fn(event)) };
}

const q = (player, sel) => player.element.querySelector(sel);
const mountedPlayers = [];

beforeEach(() => {
    document.body.innerHTML = '';
});

afterEach(() => {
    mountedPlayers.splice(0).forEach((player) => player.destroy());
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

    it('returns to theater when the fullscreen control closes theater fullscreen', () => {
        const { store, player } = mount({ playerMode: 'theater' });

        q(player, '.tvguide-fullscreen').click();
        expect(store.getState().playerMode).toBe('fullscreen');

        q(player, '.tvguide-fullscreen').click();
        expect(store.getState().playerMode).toBe('theater');
    });

    it('hides the theater control before requesting native fullscreen', () => {
        const { player } = mount();
        const stage = q(player, '.tvguide-player-stage');
        let theaterHiddenAtRequest = false;
        stage.requestFullscreen = jest.fn(() => {
            theaterHiddenAtRequest = q(player, '.tvguide-theater').hidden;
            return Promise.resolve();
        });

        player.setMode('fullscreen');

        expect(theaterHiddenAtRequest).toBe(true);
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

    it('changes the visible icon without replacing control descendants', () => {
        const { player } = mount();
        const button = q(player, '.tvguide-play');
        const icons = [...button.querySelectorAll('svg')];
        const observer = new MutationObserver(() => {});
        observer.observe(button, { childList: true, subtree: true });
        button.click();
        expect([...button.querySelectorAll('svg')]).toEqual(icons);
        expect(icons.filter((svg) => svg.style.display !== 'none').map((svg) => svg.dataset.icon)).toEqual(['play']);
        expect(observer.takeRecords()).toHaveLength(0);
        observer.disconnect();
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
    it('does not duplicate a pending native request or treat unrelated events as an exit', () => {
        const { store, player } = mount();
        const stage = q(player, '.tvguide-player-stage');
        stage.requestFullscreen = jest.fn(() => new Promise(() => {}));
        q(player, '.tvguide-fullscreen').click();
        player.setMode('fullscreen');
        player.setMode('fullscreen');
        document.dispatchEvent(new Event('fullscreenchange'));
        document.dispatchEvent(new Event('webkitfullscreenchange'));
        expect(stage.requestFullscreen).toHaveBeenCalledTimes(1);
        expect(store.getState().playerMode).toBe('fullscreen');
    });

    it.each(['exit', 'destroy'])('cleans up a native request that succeeds after %s', async (action) => {
        const { player } = mount();
        const stage = q(player, '.tvguide-player-stage');
        let resolveRequest;
        stage.requestFullscreen = jest.fn(() => new Promise((resolve) => { resolveRequest = resolve; }));
        const exit = jest.fn(() => Promise.resolve());
        document.exitFullscreen = exit;
        player.setMode('fullscreen');
        if (action === 'destroy') player.destroy();
        else player.setMode('corner');
        Object.defineProperty(document, 'fullscreenElement', { value: stage, configurable: true });
        resolveRequest();
        await Promise.resolve();
        expect(exit).toHaveBeenCalledTimes(1);
        Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true });
        delete document.exitFullscreen;
    });

    it('falls back when prefixed fullscreen reports an asynchronous error', () => {
        const { player } = mount();
        const stage = q(player, '.tvguide-player-stage');
        stage.webkitRequestFullscreen = jest.fn();
        player.setMode('fullscreen');
        stage.dispatchEvent(new Event('webkitfullscreenerror', { bubbles: true }));
        expect(stage.classList.contains('tvguide-pseudo-fullscreen')).toBe(true);
        expect(player.isNativeFullscreenActive()).toBe(false);
    });

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

    it('prefers Safari\'s prefixed element fullscreen over the video\'s own', () => {
        // Taking the video branch on iPad was the bug: native video fullscreen
        // ends as soon as the element's src changes, and the viewer reloads the
        // stream whenever a seek fails to take.
        const { player, viewer } = mount();
        const stage = q(player, '.tvguide-player-stage');
        stage.webkitRequestFullscreen = jest.fn();
        viewer.element.webkitEnterFullscreen = jest.fn();

        player.setMode('fullscreen');

        expect(stage.webkitRequestFullscreen).toHaveBeenCalled();
        expect(viewer.element.webkitEnterFullscreen).not.toHaveBeenCalled();
    });

    it('uses pseudo fullscreen when the stage cannot use element fullscreen', () => {
        const { player, viewer } = mount();
        const stage = q(player, '.tvguide-player-stage');
        stage.requestFullscreen = undefined;
        stage.webkitRequestFullscreen = undefined;
        viewer.element.webkitEnterFullscreen = jest.fn();

        player.setMode('fullscreen');

        expect(stage.classList.contains('tvguide-pseudo-fullscreen')).toBe(true);
        expect(viewer.element.webkitEnterFullscreen).not.toHaveBeenCalled();
    });

    it('follows Safari out of fullscreen, which fires only the prefixed event', () => {
        const { store, player } = mount();
        const stage = q(player, '.tvguide-player-stage');
        stage.requestFullscreen = jest.fn(() => Promise.resolve());

        q(player, '.tvguide-fullscreen').click();
        expect(store.getState().playerMode).toBe('fullscreen');

        document.dispatchEvent(new Event('webkitfullscreenchange'));

        expect(store.getState().playerMode).toBe('corner');
    });

    it('restores theater when Safari exits fullscreen', () => {
        const { store } = mount({ playerMode: 'theater' });
        store.dispatch({ type: Events.SET_PLAYER_MODE, mode: 'fullscreen' });

        document.dispatchEvent(new Event('webkitfullscreenchange'));

        expect(store.getState().playerMode).toBe('theater');
    });

    it('does not alter page scrolling while native fullscreen is active', () => {
        const { player } = mount();
        const stage = q(player, '.tvguide-player-stage');
        document.body.classList.remove('stash-tvguide-scroll-lock', 'stash-tvguide-scroll-soft-lock');
        Object.defineProperty(document, 'fullscreenElement', { value: stage, configurable: true });

        document.dispatchEvent(new Event('fullscreenchange'));

        expect(document.body.classList.contains('stash-tvguide-scroll-lock')).toBe(false);
        expect(document.body.classList.contains('stash-tvguide-scroll-soft-lock')).toBe(false);
        Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true });
    });

    it('releases the guide body lock for native fullscreen and restores it on exit', () => {
        const { player } = mount();
        const stage = q(player, '.tvguide-player-stage');
        document.body.classList.add('stash-tvguide-active');
        document.body.style.top = '-240px';
        let activeDuringRequest;
        let topDuringRequest;
        stage.requestFullscreen = jest.fn(() => {
            activeDuringRequest = document.body.classList.contains('stash-tvguide-active');
            topDuringRequest = document.body.style.top;
            return Promise.resolve();
        });

        player.setMode('fullscreen');
        expect(activeDuringRequest).toBe(false);
        expect(topDuringRequest).toBe('');
        player.setMode('corner');

        expect(document.body.classList.contains('stash-tvguide-active')).toBe(true);
        expect(document.body.style.top).toBe('-240px');
        document.body.classList.remove('stash-tvguide-active');
        document.body.style.top = '';
    });

    it('follows the video out of its own fullscreen', () => {
        const { store, player, viewer } = mount();
        const stage = q(player, '.tvguide-player-stage');
        stage.requestFullscreen = jest.fn(() => Promise.resolve());

        q(player, '.tvguide-fullscreen').click();
        viewer.element.dispatchEvent(new Event('webkitendfullscreen'));

        expect(store.getState().playerMode).toBe('corner');
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

    it('uses pseudo fullscreen when the element API throws synchronously', () => {
        const { player } = mount();
        const stage = q(player, '.tvguide-player-stage');
        stage.requestFullscreen = jest.fn(() => { throw new Error('denied'); });

        expect(() => player.setMode('fullscreen')).not.toThrow();
        expect(stage.classList.contains('tvguide-pseudo-fullscreen')).toBe(true);
    });

    it('does not restore pseudo fullscreen if its request rejects after exit', async () => {
        const { player } = mount();
        const stage = q(player, '.tvguide-player-stage');
        let rejectFullscreen;
        stage.requestFullscreen = jest.fn(() => new Promise((_, reject) => {
            rejectFullscreen = reject;
        }));

        player.setMode('fullscreen');
        player.setMode('corner');
        rejectFullscreen(new Error('denied'));
        await Promise.resolve();

        expect(stage.classList.contains('tvguide-pseudo-fullscreen')).toBe(false);
    });

    it('does not restore pseudo fullscreen if its request rejects after destroy', async () => {
        const { player } = mount();
        const stage = q(player, '.tvguide-player-stage');
        let rejectFullscreen;
        stage.requestFullscreen = jest.fn(() => new Promise((_, reject) => {
            rejectFullscreen = reject;
        }));

        player.setMode('fullscreen');
        player.destroy();
        rejectFullscreen(new Error('denied'));
        await Promise.resolve();

        expect(stage.classList.contains('tvguide-pseudo-fullscreen')).toBe(false);
        expect(document.body.classList.contains('stash-tvguide-scroll-lock')).toBe(false);
        expect(document.body.classList.contains('stash-tvguide-scroll-soft-lock')).toBe(false);
    });

    it('uses pseudo fullscreen instead of the video\'s own iOS fullscreen', () => {
        const { player, viewer } = mount();
        q(player, '.tvguide-player-stage').requestFullscreen = undefined;
        viewer.element.webkitEnterFullscreen = jest.fn();

        player.setMode('fullscreen');

        expect(q(player, '.tvguide-player-stage').classList.contains('tvguide-pseudo-fullscreen')).toBe(true);
        expect(viewer.element.webkitEnterFullscreen).not.toHaveBeenCalled();
    });

    it('survives a rejected fullscreen request', () => {
        const { player } = mount();
        q(player, '.tvguide-player-stage').requestFullscreen = jest.fn(() => Promise.reject(new Error('denied')));
        expect(() => player.setMode('fullscreen')).not.toThrow();
    });

    it('uses pseudo fullscreen when iPad Safari rejects element fullscreen', async () => {
        const { player } = mount();
        const stage = q(player, '.tvguide-player-stage');
        stage.requestFullscreen = jest.fn(() => Promise.reject(new Error('denied')));

        player.setMode('fullscreen');
        await Promise.resolve();

        expect(stage.classList.contains('tvguide-pseudo-fullscreen')).toBe(true);
    });

    it('updates the fullscreen icon before requesting native fullscreen', () => {
        const { player } = mount();
        const stage = q(player, '.tvguide-player-stage');
        let iconAtRequest;
        stage.requestFullscreen = jest.fn(() => {
            iconAtRequest = q(player, '.tvguide-fullscreen').dataset.icon;
            return Promise.resolve();
        });

        player.setMode('fullscreen');

        expect(stage.requestFullscreen).toHaveBeenCalled();
        expect(iconAtRequest).toBe('exitFullscreen');
    });

    it('uses element fullscreen on iPadOS', () => {
        const userAgent = navigator.userAgent;
        Object.defineProperty(navigator, 'userAgent', {
            value: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)',
            configurable: true
        });
        const { player } = mount();
        const stage = q(player, '.tvguide-player-stage');
        stage.requestFullscreen = jest.fn(() => Promise.resolve());

        player.setMode('fullscreen');

        expect(stage.requestFullscreen).toHaveBeenCalled();
        expect(stage.classList.contains('tvguide-pseudo-fullscreen')).toBe(false);
        player.setMode('corner');
        Object.defineProperty(navigator, 'userAgent', { value: userAgent, configurable: true });
    });

    it('removes pseudo fullscreen when leaving fullscreen mode', async () => {
        const { player } = mount();
        const stage = q(player, '.tvguide-player-stage');
        stage.requestFullscreen = jest.fn(() => Promise.reject(new Error('denied')));

        player.setMode('fullscreen');
        await Promise.resolve();
        player.setMode('corner');

        expect(stage.classList.contains('tvguide-pseudo-fullscreen')).toBe(false);
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

describe('pinning another programme', () => {
    it('carries on playing, untouched', () => {
        // Reading about a scene that is not on is not a reason to stop the one
        // that is. There is no still, no pause, and nothing to come back from.
        const { store, player, viewer } = mount();
        const entries = store.getState().schedules['studio:1'].entries;
        const before = q(player, '.tvguide-player-caption').textContent;

        store.dispatch({
            type: Events.PIN_DETAILS,
            channelId: 'studio:1',
            timeMs: DAY_START + entries[1].offsetMs + 1000
        });

        expect(q(player, '.tvguide-player-caption').textContent).toBe(before);
        expect(store.getState().viewerPaused).toBe(false);
        expect(viewer.setPaused).not.toHaveBeenCalled();
        expect(q(player, '.tvguide-back-to-live')).toBeNull();
    });
});

describe('resizing', () => {
    const grip = (player) => q(player, '.tvguide-player-resizer');

    const drag = (player, from, to) => {
        grip(player).dispatchEvent(
            new MouseEvent('pointerdown', { clientX: from[0], clientY: from[1], bubbles: true, cancelable: true })
        );
        window.dispatchEvent(new MouseEvent('pointermove', { clientX: to[0], clientY: to[1] }));
        window.dispatchEvent(new MouseEvent('pointerup', {}));
    };

    it('grows when the corner is dragged out to the left', () => {
        const { store, player } = mount();
        drag(player, [400, 200], [300, 200]);
        expect(store.getState().playerWidthPx).toBe(368);
    });

    it('grows when it is dragged down, keeping the picture\'s shape', () => {
        // One number drives the box, so a downward drag has to be expressed as
        // the width that gives it -- otherwise a corner grip would ignore an
        // axis it visibly offers.
        const { store, player } = mount();
        drag(player, [400, 200], [400, 245]);
        expect(store.getState().playerWidthPx).toBe(348);
    });

    it('follows whichever axis moved further on a diagonal drag', () => {
        const { store, player } = mount();
        drag(player, [400, 200], [380, 290]);
        // 90px down is 160px of width; 20px left is only 20.
        expect(store.getState().playerWidthPx).toBe(428);
    });

    it('shrinks when dragged back in, and stops at a usable size', () => {
        const { store, player } = mount();
        drag(player, [400, 200], [900, 200]);
        expect(store.getState().playerWidthPx).toBe(200);
    });

    it('will not grow past the point where it would crowd out the guide', () => {
        const { store, player } = mount();
        drag(player, [400, 200], [-600, 200]);
        expect(store.getState().playerWidthPx).toBe(640);
    });

    it('stops resizing once the pointer is released', () => {
        const { store, player } = mount();
        drag(player, [400, 200], [300, 200]);
        const settled = store.getState().playerWidthPx;

        window.dispatchEvent(new MouseEvent('pointermove', { clientX: 100, clientY: 200 }));

        expect(store.getState().playerWidthPx).toBe(settled);
    });

    it('resizes from the keyboard', () => {
        const { store, player } = mount();
        const press = (key, shiftKey = false) =>
            grip(player).dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true }));

        press('ArrowLeft');
        expect(store.getState().playerWidthPx).toBe(278);
        press('ArrowRight');
        expect(store.getState().playerWidthPx).toBe(268);
        press('ArrowDown', true);
        expect(store.getState().playerWidthPx).toBe(308);
    });

    it('shrinks when dragged up, too', () => {
        const { store, player } = mount();
        drag(player, [400, 300], [400, 280]);
        // 20px up is 35.6px of width off 268.
        expect(store.getState().playerWidthPx).toBe(232);
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
