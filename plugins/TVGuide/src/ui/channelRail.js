/**
 * The A-Z rail beside the channel column.
 *
 * A letter only means something in name order, so tapping one also switches the
 * sort to Name -- otherwise it would scroll to an arbitrary position in a
 * scene-count ordering.
 */

import { el, replaceChildren } from './dom.js';
import { Events } from '../state/actions.js';
import { DEFAULT_SORT } from '../domain/channelPrefs.js';
import * as sel from '../state/selectors.js';

export function createChannelRail({ store, onJump }) {
    const root = el('div', {
        class: 'tvguide-rail',
        role: 'toolbar',
        'aria-label': 'Jump to channels by letter',
        'aria-orientation': 'vertical'
    });

    let rendered = '';

    return {
        element: root,

        render(state) {
            const letters = sel.availableLetters(state);
            const signature = letters.join('');
            if (signature === rendered) return;
            rendered = signature;

            replaceChildren(
                root,
                letters.map((letter) =>
                    el(
                        'button',
                        {
                            class: 'tvguide-rail-letter',
                            type: 'button',
                            'aria-label': `Jump to ${letter === '#' ? 'other' : letter}`,
                            onclick: () => jump(letter)
                        },
                        letter
                    )
                )
            );
        }
    };

    function jump(letter) {
        const state = store.getState();
        if (state.sort !== DEFAULT_SORT) {
            store.dispatch({ type: Events.SET_SORT, sort: DEFAULT_SORT });
        }
        const channelId = sel.firstChannelForLetter(store.getState(), letter);
        if (channelId && onJump) onJump(channelId);
    }
}
