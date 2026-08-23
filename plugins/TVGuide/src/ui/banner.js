/**
 * The detail banner.
 *
 * A time-grid cannot hold a description -- blocks are sized by runtime, not by
 * how much there is to say -- so the focused programme is described here
 * instead, the way a cable box does it.
 */

import { el, replaceChildren } from './dom.js';
import { formatClock, formatDuration, formatRemaining } from '../domain/format.js';
import { sceneTitle } from '../api/scenes.js';
import * as sel from '../state/selectors.js';
import { logoBadge } from './logoBadge.js';

export function createBanner() {
    const root = el('div', { class: 'tvguide-banner' });

    return {
        element: root,

        render(state) {
            const program = sel.focusedProgram(state);
            const channel = sel.focusedChannel(state);

            if (!program || !channel) {
                replaceChildren(
                    root,
                    el('p', { class: 'tvguide-banner-empty' },
                        channel ? `${channel.name} has nothing scheduled.` : 'Select a channel.')
                );
                return;
            }

            const { scene } = program;
            const isLive = program.startMs <= state.nowMs && program.endMs > state.nowMs;

            replaceChildren(
                root,
                scene.paths?.screenshot
                    ? el('img', {
                          class: 'tvguide-banner-poster',
                          src: scene.paths.screenshot,
                          alt: '',
                          loading: 'lazy'
                      })
                    : el('div', { class: 'tvguide-banner-logo' }, logoBadge(channel)),
                el(
                    'div',
                    { class: 'tvguide-banner-body' },
                    el(
                        'div',
                        { class: 'tvguide-banner-heading' },
                        el('h2', { class: 'tvguide-banner-title' }, sceneTitle(scene)),
                        isLive ? el('span', { class: 'tvguide-live-badge' }, 'LIVE') : null
                    ),
                    el(
                        'p',
                        { class: 'tvguide-banner-meta' },
                        `${channel.name} · ${formatClock(program.startMs)}–${formatClock(program.endMs)}`,
                        ` · ${formatDuration(program.durationMs / 1000)}`,
                        isLive ? ` · ${formatRemaining(program.endMs - state.nowMs)}` : ''
                    ),
                    scene.details
                        ? el('p', { class: 'tvguide-banner-details' }, scene.details)
                        : null,
                    null
                )
            );
        }
    };
}
