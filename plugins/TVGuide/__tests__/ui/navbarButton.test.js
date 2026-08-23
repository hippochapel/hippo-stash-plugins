import { createNavbarButton, BUTTON_ID, MOUNT_SELECTORS } from '../../src/ui/navbarButton.js';

describe('createNavbarButton', () => {
    let button;

    beforeEach(() => {
        document.body.innerHTML = '';
    });

    afterEach(() => {
        if (button) button.stop();
        button = null;
    });

    it('is a labelled button', () => {
        button = createNavbarButton({ onActivate: jest.fn() });
        expect(button.element.getAttribute('aria-label')).toBe('Open TV Guide');
        expect(button.element.type).toBe('button');
    });

    it('opens the guide when clicked', () => {
        const onActivate = jest.fn();
        button = createNavbarButton({ onActivate });
        button.element.click();
        expect(onActivate).toHaveBeenCalled();
    });

    it.each(MOUNT_SELECTORS)('mounts into %s', (selector) => {
        const host = document.createElement('div');
        // Build an element matching the selector, however it is written.
        if (selector.startsWith('.')) host.className = selector.slice(1);
        else if (selector.startsWith('#')) host.id = selector.slice(1);
        document.body.appendChild(host);
        // Compound selectors need a real ancestor chain.
        document.body.innerHTML = `<nav class="navbar" id="stash-navbar">
            <div class="navbar-buttons"></div>
            <div class="nav-utility"></div>
            <div class="navbar-nav"></div>
        </nav>`;

        button = createNavbarButton({ onActivate: jest.fn() });
        button.place();

        expect(document.getElementById(BUTTON_ID)).not.toBeNull();
    });

    it('prefers the earliest selector in the fallback chain', () => {
        document.body.innerHTML = `<nav class="navbar">
            <div class="nav-utility"></div>
            <div class="navbar-buttons"></div>
        </nav>`;

        button = createNavbarButton({ onActivate: jest.fn() });
        button.place();

        expect(document.querySelector('.navbar-buttons').contains(button.element)).toBe(true);
    });

    it('does nothing when no mount point exists', () => {
        button = createNavbarButton({ onActivate: jest.fn() });
        button.place();
        expect(document.getElementById(BUTTON_ID)).toBeNull();
    });

    it('does not mount twice', () => {
        document.body.innerHTML = '<div class="navbar-buttons"></div>';
        button = createNavbarButton({ onActivate: jest.fn() });
        button.place();
        button.place();
        expect(document.querySelectorAll(`#${BUTTON_ID}`)).toHaveLength(1);
    });

    it('replaces itself after the SPA re-renders the navbar away', async () => {
        document.body.innerHTML = '<div class="navbar-buttons"></div>';
        button = createNavbarButton({ onActivate: jest.fn() });
        button.start();
        expect(document.getElementById(BUTTON_ID)).not.toBeNull();

        // Stash re-renders its navbar, discarding our button.
        document.body.innerHTML = '<div class="navbar-buttons"></div>';
        expect(document.getElementById(BUTTON_ID)).toBeNull();

        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(document.getElementById(BUTTON_ID)).not.toBeNull();
    });

    it('removes itself and stops observing on stop', async () => {
        document.body.innerHTML = '<div class="navbar-buttons"></div>';
        const b = createNavbarButton({ onActivate: jest.fn() });
        b.start();
        b.stop();

        expect(document.getElementById(BUTTON_ID)).toBeNull();

        document.body.innerHTML = '<div class="navbar-buttons"></div>';
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(document.getElementById(BUTTON_ID)).toBeNull();
    });
});
