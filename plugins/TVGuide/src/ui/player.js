/**
 * The player panel: the video plus everything wrapped around it.
 *
 * Controls sit *on* the video rather than beside it, so the picture gets the
 * width. They reveal on hover/focus on a pointer device and stay visible on
 * touch, where there is no hover to reveal them with.
 *
 * Three sizes: corner, theater (full width with the guide scrolling below), and
 * fullscreen. When iPad Safari rejects element fullscreen, the stage fills the
 * viewport with the same pseudo-fullscreen fallback Gallery Mode uses, keeping
 * the player controls available.
 */

import { el, replaceChildren } from './dom.js';
import { Events } from '../state/actions.js';
import { formatClock, formatDuration, formatRemaining } from '../domain/format.js';
import { sceneTitle } from '../api/scenes.js';
import * as sel from '../state/selectors.js';
import { setIcon } from './icons.js';

export function createPlayer({ store, viewer }) {
    const bodyLockClass = 'stash-tvguide-active';
    let pseudoFullscreen = false;
    let fullscreenRequestGeneration = 0;
    let destroyed = false;
    let nativeFullscreenBodyLock = null;
    let nativeFullscreenRenderFreeze = false;
    const spinner = el('div', { class: 'tvguide-spinner', 'aria-hidden': 'true' });

    const playPause = controlButton('tvguide-play', () =>
        store.dispatch({
            type: Events.SET_VIEWER_PAUSED,
            paused: !store.getState().viewerPaused
        })
    );

    const mute = controlButton('tvguide-mute', () =>
        store.dispatch({ type: Events.SET_MUTED, muted: !store.getState().muted })
    );

    const theater = controlButton('tvguide-theater', () => cycleMode('theater'));
    const fullscreen = controlButton('tvguide-fullscreen', () => cycleMode('fullscreen'));

    const controls = el(
        'div',
        { class: 'tvguide-player-controls' },
        playPause,
        mute,
        el('span', { class: 'tvguide-player-spacer' }),
        theater,
        fullscreen
    );

    const stage = el('div', { class: 'tvguide-player-stage' }, viewer.element, spinner, controls);
    const progress = el('div', { class: 'tvguide-player-progress' });
    const caption = el('p', { class: 'tvguide-player-caption' });

    /**
     * Resize grip, at the bottom-left corner -- the only free corner, since the
     * player is anchored to the top right of the header.
     *
     * One number drives the whole box: the height follows from the width in CSS
     * so the picture keeps its shape. Dragging out along either axis grows it,
     * whichever moved further, so a diagonal drag does the obvious thing.
     */
    const resizer = el('div', {
        class: 'tvguide-player-resizer',
        role: 'separator',
        tabindex: '0',
        'aria-label': 'Resize the player',
        'aria-orientation': 'horizontal',
        onkeydown: onResizerKey
    });

    const root = el('div', { class: 'tvguide-player' }, stage, progress, caption, resizer);

    resizer.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        const startX = event.clientX;
        const startY = event.clientY;
        const startWidth = store.getState().playerWidthPx;

        const onMove = (move) => {
            // Out is bigger on both axes, and the picture is 16:9, so a vertical
            // drag converts to the width that produces it. Whichever axis moved
            // *further* wins -- comparing the signed values instead would mean
            // a horizontal drag inwards could never shrink anything, since the
            // untouched axis always reads as zero.
            const byX = startX - move.clientX;
            const byY = (move.clientY - startY) * (16 / 9);
            const grown = Math.abs(byX) >= Math.abs(byY) ? byX : byY;
            store.dispatch({ type: Events.SET_PLAYER_WIDTH, px: startWidth + grown });
        };
        const onUp = () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
        };

        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
    });

    function onResizerKey(event) {
        const step = event.shiftKey ? 40 : 10;
        const current = store.getState().playerWidthPx;
        if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
            event.preventDefault();
            store.dispatch({ type: Events.SET_PLAYER_WIDTH, px: current + step });
        } else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
            event.preventDefault();
            store.dispatch({ type: Events.SET_PLAYER_WIDTH, px: current - step });
        }
    }

    viewer.subscribe((event) => {
        // The spinner is about the stream, not about being paused -- a paused
        // player is not loading.
        root.classList.toggle('is-loading', event.type === 'loading');
    });

    function controlButton(className, onclick) {
        return el('button', { class: `tvguide-player-button ${className}`, type: 'button', onclick });
    }

    /** Toggle a mode; exiting fullscreen restores the normal mode it replaced. */
    function cycleMode(mode) {
        const state = store.getState();
        const current = state.playerMode;
        const exitMode = mode === 'fullscreen' ? state.fullscreenReturnMode || 'corner' : 'corner';
        store.dispatch({ type: Events.SET_PLAYER_MODE, mode: current === mode ? exitMode : mode });
    }

    /**
     * Fullscreen targets the *stage*, not the whole panel.
     *
     * The panel's progress readout is rewritten every second; keeping the
     * fullscreen element off that churning subtree is what stops fullscreen
     * dropping out again a tick after it opens.
     */
    function fullscreenElement() {
        return document.fullscreenElement || document.webkitFullscreenElement || null;
    }

    function isFullscreen() {
        return fullscreenElement() === stage;
    }

    function isFullscreenActive() {
        return isFullscreen() || pseudoFullscreen;
    }

    function isAppleTouchDevice() {
        const userAgent = navigator.userAgent || '';
        const platform = navigator.platform || '';
        return /iP(hone|od|ad)/.test(userAgent)
            || (platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    }

    function syncScrollLock() {
        // Native fullscreen owns the viewport. Changing document scrolling at
        // that transition is unnecessary and can make Safari leave fullscreen.
        if (isFullscreen() && !pseudoFullscreen) {
            [document.documentElement, document.body].filter(Boolean).forEach((element) => {
                element.classList.remove('stash-tvguide-scroll-lock', 'stash-tvguide-scroll-soft-lock');
            });
            return;
        }
        const locked = isFullscreenActive();
        const soft = locked && isAppleTouchDevice();
        [document.documentElement, document.body].filter(Boolean).forEach((element) => {
            element.classList.toggle('stash-tvguide-scroll-lock', locked && !soft);
            element.classList.toggle('stash-tvguide-scroll-soft-lock', soft);
        });
    }

    function setPseudoFullscreen(on) {
        pseudoFullscreen = on;
        stage.classList.toggle('tvguide-pseudo-fullscreen', on);
        syncScrollLock();
    }

    function releaseNativeFullscreenBodyLock() {
        if (nativeFullscreenBodyLock || !document.body) return;
        nativeFullscreenBodyLock = {
            active: document.body.classList.contains(bodyLockClass),
            top: document.body.style.top
        };
        document.body.classList.remove(bodyLockClass);
        document.body.style.top = '';
    }

    function restoreNativeFullscreenBodyLock() {
        if (!nativeFullscreenBodyLock || !document.body) return;
        document.body.classList.toggle(bodyLockClass, nativeFullscreenBodyLock.active);
        document.body.style.top = nativeFullscreenBodyLock.top;
        nativeFullscreenBodyLock = null;
    }

    /**
     * Element fullscreen, prefixed or not, with a pseudo-fullscreen fallback.
     *
     * Safari can reject fullscreening a div even though it exposes the API.
     * The video's own fullscreen would hide TV Guide's controls and can end
     * when the stream reloads, so use the fixed-viewport fallback instead.
     */
    function applyFullscreen(on) {
        if (on) {
            // Overlay rendering is frozen during native fullscreen entry to
            // avoid Safari collapsing it, so this control must change before
            // the request rather than waiting for the next render.
            theater.hidden = true;
            if (isFullscreen()) return;
            const requestGeneration = ++fullscreenRequestGeneration;
            // Rendering the fullscreen state swaps this icon. Do it before
            // requesting fullscreen so Safari sees no DOM churn in its newly
            // fullscreen subtree.
            setIcon(fullscreen, 'exitFullscreen');
            const request = stage.requestFullscreen || stage.webkitRequestFullscreen;
            if (request) {
                nativeFullscreenRenderFreeze = true;
                releaseNativeFullscreenBodyLock();
                try {
                    const result = request.call(stage);
                    if (result && typeof result.then === 'function') {
                        Promise.resolve(result).then(
                            () => {
                                if (!destroyed && requestGeneration === fullscreenRequestGeneration) {
                                    syncScrollLock();
                                }
                            },
                            () => {
                                if (!destroyed && requestGeneration === fullscreenRequestGeneration) {
                                    nativeFullscreenRenderFreeze = false;
                                    restoreNativeFullscreenBodyLock();
                                    setPseudoFullscreen(true);
                                }
                            }
                        );
                    }
                } catch (_) {
                    nativeFullscreenRenderFreeze = false;
                    restoreNativeFullscreenBodyLock();
                    if (!destroyed && requestGeneration === fullscreenRequestGeneration) setPseudoFullscreen(true);
                }
            } else {
                nativeFullscreenRenderFreeze = false;
                setPseudoFullscreen(true);
            }
            return;
        }
        fullscreenRequestGeneration += 1;
        nativeFullscreenRenderFreeze = false;
        theater.hidden = false;
        restoreNativeFullscreenBodyLock();
        setIcon(fullscreen, 'fullscreen');
        setPseudoFullscreen(false);
        // Only exit what we opened -- exiting unconditionally would fight
        // anything else on the page that is fullscreen.
        if (!isFullscreen()) return;
        const exit = document.exitFullscreen || document.webkitExitFullscreen;
        if (exit) {
            const result = exit.call(document);
            if (result && typeof result.catch === 'function') result.catch(() => {});
        }
    }

    // Let state follow the browser: pressing Esc, or the OS dropping out of
    // fullscreen, must not leave the button claiming we are still in it.
    // Safari fires only the prefixed event, and the video's own fullscreen
    // fires neither -- it reports itself through `webkitendfullscreen`.
    const onFullscreenChange = () => {
        syncScrollLock();
        if (!isFullscreenActive() && store.getState().playerMode === 'fullscreen') {
            nativeFullscreenRenderFreeze = false;
            restoreNativeFullscreenBodyLock();
            store.dispatch({
                type: Events.SET_PLAYER_MODE,
                mode: store.getState().fullscreenReturnMode || 'corner'
            });
        }
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('webkitfullscreenchange', onFullscreenChange);
    viewer.element.addEventListener('webkitendfullscreen', onFullscreenChange);

    /**
     * Control visibility is driven from JS rather than `@media (hover: hover)`.
     * The media query reported the wrong thing on at least one real machine and
     * left the controls permanently on screen; pointer events tell the truth.
     */
    let hideTimer = null;
    const showControls = () => {
        clearTimeout(hideTimer);
        root.classList.add('is-showing-controls');
    };
    const hideControls = () => {
        clearTimeout(hideTimer);
        hideTimer = setTimeout(() => root.classList.remove('is-showing-controls'), 120);
    };

    function renderControls(state) {
        setIcon(playPause, state.viewerPaused ? 'play' : 'pause');
        playPause.setAttribute('aria-label', state.viewerPaused ? 'Play' : 'Pause');
        playPause.setAttribute('aria-pressed', state.viewerPaused ? 'true' : 'false');

        setIcon(mute, state.muted ? 'muted' : 'unmuted');
        mute.setAttribute('aria-label', state.muted ? 'Unmute' : 'Mute');
        mute.setAttribute('aria-pressed', state.muted ? 'true' : 'false');

        setIcon(theater, 'theater');
        theater.hidden = state.playerMode === 'fullscreen';
        theater.setAttribute('aria-label', 'Theater mode');
        theater.setAttribute('aria-pressed', state.playerMode === 'theater' ? 'true' : 'false');

        setIcon(fullscreen, state.playerMode === 'fullscreen' ? 'exitFullscreen' : 'fullscreen');
        fullscreen.setAttribute('aria-label', 'Fullscreen');
        fullscreen.setAttribute('aria-pressed', state.playerMode === 'fullscreen' ? 'true' : 'false');
    }

    stage.addEventListener('mouseenter', showControls);
    stage.addEventListener('mousemove', showControls);
    stage.addEventListener('mouseleave', hideControls);
    // Keyboard users need them too, and touch has no hover to reveal with.
    stage.addEventListener('focusin', showControls);
    stage.addEventListener('focusout', hideControls);
    stage.addEventListener('touchstart', showControls, { passive: true });

    return {
        element: root,

        setMode(mode) {
            applyFullscreen(mode === 'fullscreen');
        },

        isNativeFullscreenTransitionActive() {
            return nativeFullscreenRenderFreeze && !pseudoFullscreen;
        },

        destroy() {
            destroyed = true;
            fullscreenRequestGeneration += 1;
            nativeFullscreenRenderFreeze = false;
            restoreNativeFullscreenBodyLock();
            setPseudoFullscreen(false);
            document.removeEventListener('fullscreenchange', onFullscreenChange);
            document.removeEventListener('webkitfullscreenchange', onFullscreenChange);
            viewer.element.removeEventListener('webkitendfullscreen', onFullscreenChange);
            clearTimeout(hideTimer);
        },

        render(state) {
            const channel = sel.tunedChannel(state);
            // The playback clock, not the wall clock: paused, it stops where it
            // was stopped rather than running on with the schedule.
            const program = channel && sel.tunedProgram(state);
            const scene = program?.scene;

            root.dataset.mode = state.playerMode;
            root.hidden = !state.settings.guide_autoplay;

            // SVG icons, not emoji: these inherit currentColor and size with
            // the button instead of rendering as platform artwork.
            renderControls(state);


            caption.textContent = channel
                ? `${channel.name}${scene ? ` · ${sceneTitle(scene)}` : ''}`
                : '';

            renderProgress(state, program);
        }
    };

    function renderProgress(state, program) {
        if (!program) {
            replaceChildren(progress);
            return;
        }

        const pct = Math.min(100, Math.max(0, (program.elapsedMs / program.durationMs) * 100));
        const nowMs = sel.playbackNowMs(state);

        replaceChildren(
            progress,
            el(
                'div',
                {
                    class: 'tvguide-progress',
                    role: 'progressbar',
                    'aria-valuemin': '0',
                    'aria-valuemax': '100',
                    'aria-valuenow': String(Math.round(pct)),
                    'aria-label': 'Programme progress'
                },
                el('div', { class: 'tvguide-progress-fill', style: { width: `${pct}%` } })
            ),
            el(
                'p',
                { class: 'tvguide-player-times' },
                `${formatDuration(program.elapsedMs / 1000)} / ${formatDuration(program.durationMs / 1000)}`,
                ` · ends ${formatClock(program.endMs)}`,
                ` · ${formatRemaining(program.endMs - nowMs)}`
            )
        );
    }
}
