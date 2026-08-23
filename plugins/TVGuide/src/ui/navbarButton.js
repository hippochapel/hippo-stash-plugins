/**
 * The navbar entry point.
 *
 * Stash is a single-page app that re-renders its navbar on navigation, so the
 * button is (re)placed by a MutationObserver rather than mounted once -- the
 * same approach TheaterMode uses for the player toolbar.
 */

import { el, firstMatch } from './dom.js';

export const BUTTON_ID = 'tvguide-navbar-button';

/** Stash's navbar markup shifts between releases; try the likely mounts in order. */
export const MOUNT_SELECTORS = [
    '.navbar-buttons',
    '.nav-utility',
    'nav .navbar-nav',
    '#stash-navbar .navbar-nav',
    'nav.navbar'
];

export function createNavbarButton({ onActivate }) {
    const button = el(
        'button',
        {
            id: BUTTON_ID,
            class: 'tvguide-navbar-button btn btn-link minimal',
            type: 'button',
            title: 'TV Guide',
            'aria-label': 'Open TV Guide',
            onclick: onActivate
        },
        '📺'
    );

    let observer = null;

    function place() {
        if (document.getElementById(BUTTON_ID)) return;
        const mount = firstMatch(MOUNT_SELECTORS);
        if (mount) mount.appendChild(button);
    }

    return {
        element: button,
        place,

        start() {
            place();
            observer = new MutationObserver(place);
            observer.observe(document.body, { childList: true, subtree: true });
        },

        stop() {
            if (observer) observer.disconnect();
            observer = null;
            button.remove();
        }
    };
}
