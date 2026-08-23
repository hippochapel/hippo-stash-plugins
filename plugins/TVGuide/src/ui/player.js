/**
 * The player panel: the video plus everything wrapped around it.
 *
 * Controls sit *on* the video rather than beside it, so the picture gets the
 * width. They reveal on hover/focus on a pointer device and stay visible on
 * touch, where there is no hover to reveal them with.
 *
 * Three sizes: corner, theater (full width with the guide scrolling below), and
 * fullscreen. iOS Safari cannot fullscreen an arbitrary element, so there the
 * video's own native fullscreen is used instead -- which shows the video alone,
 * without the guide. Theater is the iPad answer.
 */

import { el, replaceChildren } from './dom.js';
import { Events } from '../state/actions.js';
import { formatClock, formatDuration, formatRemaining } from '../domain/format.js';
import { sceneTitle } from '../api/scenes.js';
import * as sel from '../state/selectors.js';
import { setIcon } from './icons.js';

export function createPlayer({ store, viewer }) {
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

    /** Toggle a mode: pressing the button you are already in returns to corner. */
    function cycleMode(mode) {
        const current = store.getState().playerMode;
        store.dispatch({ type: Events.SET_PLAYER_MODE, mode: current === mode ? 'corner' : mode });
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

    /**
     * Element fullscreen, prefixed or not, in preference to the video's own.
     *
     * Safari only exposes `webkitRequestFullscreen` here, and taking the
     * `webkitEnterFullscreen` branch instead was what made this unusable on
     * iPad: native *video* fullscreen ends the moment the element's `src`
     * changes, and the viewer reloads the stream whenever a seek fails to take
     * -- so fullscreen dropped out a beat after it opened. Fullscreening the
     * stage survives a stream reload, because the stage is not the thing being
     * reloaded. The video's own fullscreen is the last resort, for iPhone,
     * where nothing else can go fullscreen at all.
     */
    function applyFullscreen(on) {
        if (on) {
            if (isFullscreen()) return;
            const request = stage.requestFullscreen || stage.webkitRequestFullscreen;
            if (request) {
                const result = request.call(stage);
                if (result && typeof result.catch === 'function') result.catch(() => {});
            } else if (viewer.element.webkitEnterFullscreen) {
                viewer.element.webkitEnterFullscreen();
            }
            return;
        }
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
        if (!isFullscreen() && store.getState().playerMode === 'fullscreen') {
            store.dispatch({ type: Events.SET_PLAYER_MODE, mode: 'corner' });
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

        destroy() {
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
            setIcon(playPause, state.viewerPaused ? 'play' : 'pause');
            playPause.setAttribute('aria-label', state.viewerPaused ? 'Play' : 'Pause');
            playPause.setAttribute('aria-pressed', state.viewerPaused ? 'true' : 'false');

            setIcon(mute, state.muted ? 'muted' : 'unmuted');
            mute.setAttribute('aria-label', state.muted ? 'Unmute' : 'Mute');
            mute.setAttribute('aria-pressed', state.muted ? 'true' : 'false');

            setIcon(theater, 'theater');
            theater.setAttribute('aria-label', 'Theater mode');
            theater.setAttribute('aria-pressed', state.playerMode === 'theater' ? 'true' : 'false');

            setIcon(fullscreen, state.playerMode === 'fullscreen' ? 'exitFullscreen' : 'fullscreen');
            fullscreen.setAttribute('aria-label', 'Fullscreen');
            fullscreen.setAttribute('aria-pressed', state.playerMode === 'fullscreen' ? 'true' : 'false');


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
