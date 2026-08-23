/**
 * Integration: the real manager panel over the real store and reducer.
 */

import { createStore } from '../../src/state/store.js';
import { createManager } from '../../src/ui/manager.js';
import { createInitialState, PoolStatus } from '../../src/state/initialState.js';
import { Events } from '../../src/state/actions.js';

const NOON = new Date(2026, 7, 22, 12, 0, 0).getTime();

const chan = (id, name, sceneCount = 10, source = 'studio') => ({
    id,
    source,
    name,
    logo: { type: 'monogram', initials: 'XX', hue: 1 },
    sceneCount,
    sceneFilter: {}
});

const CATALOG = {
    studio: [chan('studio:1', 'Alpha', 50), chan('studio:2', 'Bravo', 20), chan('studio:3', 'Tiny', 2)],
    tag: [chan('tag:9', 'Beach', 30, 'tag')],
    group: [],
    savedFilter: [{ ...chan('savedFilter:1', 'Favourites', null, 'savedFilter') }]
};

function mount(overrides = {}) {
    const initialState = {
        ...createInitialState(),
        open: true,
        nowMs: NOON,
        managerOpen: true,
        catalog: CATALOG,
        catalogStatus: PoolStatus.READY,
        lineup: [{ source: 'studio', minScenes: 5 }],
        allChannels: [chan('studio:1', 'Alpha', 50), chan('studio:2', 'Bravo', 20)],
        channels: [chan('studio:1', 'Alpha', 50), chan('studio:2', 'Bravo', 20)],
        ...overrides
    };
    const store = createStore({ initialState });
    const manager = createManager({ store });
    document.body.appendChild(manager.element);
    store.subscribe((s) => manager.render(s));
    manager.render(store.getState());
    return { store, manager };
}

const rowFor = (manager, channelId) =>
    manager.element.querySelector(`[data-channel-id="${channelId}"]`);

const buttonLabelled = (root, pattern) =>
    Array.from(root.querySelectorAll('button')).find((b) =>
        pattern.test(b.getAttribute('aria-label') || '')
    );

beforeEach(() => {
    document.body.innerHTML = '';
});

describe('presentation', () => {
    it('is a labelled dialog, hidden until opened', () => {
        const { manager } = mount({ managerOpen: false });
        expect(manager.element.getAttribute('role')).toBe('dialog');
        expect(manager.element.getAttribute('aria-label')).toBe('Manage channels');
        expect(manager.element.hidden).toBe(true);
    });

    it('lists every source section', () => {
        const { manager } = mount();
        const headings = Array.from(manager.element.querySelectorAll('h3')).map((h) => h.textContent);
        expect(headings).toEqual(['Studios', 'Tags', 'Groups', 'Saved filters']);
    });

    it('lists the catalogue, not just channels already in the guide', () => {
        const { manager } = mount();
        // studio:3 is below the threshold and absent from the guide.
        expect(rowFor(manager, 'studio:3')).not.toBeNull();
        expect(rowFor(manager, 'studio:3').classList.contains('is-included')).toBe(false);
        expect(rowFor(manager, 'studio:1').classList.contains('is-included')).toBe(true);
    });

    it('shows scene counts, and marks saved filters as countless', () => {
        const { manager } = mount();
        expect(rowFor(manager, 'studio:1').textContent).toContain('50 scenes');
        expect(rowFor(manager, 'savedFilter:1').textContent).toContain('saved filter');
    });

    it('reports how many channels are in the guide', () => {
        const { manager } = mount();
        expect(manager.element.querySelector('.tvguide-manager-status').textContent)
            .toContain('2 channels in the guide');
    });

    it('reports catalogue loading and failure', () => {
        const loading = mount({ catalogStatus: PoolStatus.LOADING, catalog: null });
        expect(loading.manager.element.querySelector('.tvguide-manager-status').textContent)
            .toContain('Loading');

        const failed = mount({ catalogStatus: PoolStatus.ERROR, catalogError: 'offline', catalog: null });
        expect(failed.manager.element.querySelector('.tvguide-manager-status').textContent)
            .toContain('offline');
    });
});

describe('search', () => {
    it('filters the catalogue as you type', () => {
        const { store, manager } = mount();
        store.dispatch({ type: Events.MANAGER_SEARCH, query: 'brav' });

        expect(rowFor(manager, 'studio:2')).not.toBeNull();
        expect(rowFor(manager, 'studio:1')).toBeNull();
    });

    it('is case-insensitive', () => {
        const { store, manager } = mount();
        store.dispatch({ type: Events.MANAGER_SEARCH, query: 'ALPHA' });
        expect(rowFor(manager, 'studio:1')).not.toBeNull();
    });

    it('says so when nothing matches', () => {
        const { store, manager } = mount();
        store.dispatch({ type: Events.MANAGER_SEARCH, query: 'zzzz' });
        expect(manager.element.textContent).toContain('Nothing matches');
    });
});

describe('sorting', () => {
    it('offers the sort modes and reflects the current one', () => {
        const { manager } = mount({ sort: 'sceneCount' });
        const select = manager.element.querySelector('.tvguide-manager-sort');
        expect(select.value).toBe('sceneCount');
        expect(Array.from(select.options).map((o) => o.value)).toEqual(['name', 'sceneCount', 'source']);
    });

    it('changes the guide order', () => {
        const { store, manager } = mount();
        const select = manager.element.querySelector('.tvguide-manager-sort');
        select.value = 'sceneCount';
        select.dispatchEvent(new Event('change'));

        expect(store.getState().sort).toBe('sceneCount');
        expect(store.getState().channels.map((c) => c.id)).toEqual(['studio:1', 'studio:2']);
    });
});

describe('lineup rules', () => {
    it('shows the rule as enabled with its threshold', () => {
        const { manager } = mount();
        const section = manager.element.querySelectorAll('.tvguide-manager-section')[0];
        expect(section.querySelector('input[type="checkbox"]').checked).toBe(true);
        expect(section.querySelector('.tvguide-manager-threshold').value).toBe('5');
    });

    it('disables the threshold when the rule is off', () => {
        const { manager } = mount({ lineup: [] });
        const section = manager.element.querySelectorAll('.tvguide-manager-section')[0];
        expect(section.querySelector('input[type="checkbox"]').checked).toBe(false);
        expect(section.querySelector('.tvguide-manager-threshold').disabled).toBe(true);
    });

    it('turning a rule off removes it from the lineup', () => {
        const { store, manager } = mount();
        const checkbox = manager.element
            .querySelectorAll('.tvguide-manager-section')[0]
            .querySelector('input[type="checkbox"]');
        checkbox.checked = false;
        checkbox.dispatchEvent(new Event('change'));

        expect(store.getState().lineup).toEqual([]);
    });

    it('turning a rule on adds it for that source only', () => {
        const { store, manager } = mount({ lineup: [] });
        const checkbox = manager.element
            .querySelectorAll('.tvguide-manager-section')[1] // Tags
            .querySelector('input[type="checkbox"]');
        checkbox.checked = true;
        checkbox.dispatchEvent(new Event('change'));

        expect(store.getState().lineup).toEqual([{ source: 'tag', minScenes: 5 }]);
    });

    it('changing the threshold updates the rule', () => {
        const { store, manager } = mount();
        const threshold = manager.element
            .querySelectorAll('.tvguide-manager-section')[0]
            .querySelector('.tvguide-manager-threshold');
        threshold.value = '20';
        threshold.dispatchEvent(new Event('change'));

        expect(store.getState().lineup).toEqual([{ source: 'studio', minScenes: 20 }]);
    });

    it('re-resolves channels from the server after a lineup change', () => {
        const runEffect = jest.fn();
        const store = createStore({
            runEffect,
            initialState: { ...createInitialState(), managerOpen: true, catalog: CATALOG, lineup: [] }
        });
        const manager = createManager({ store });
        manager.render(store.getState());

        const checkbox = manager.element
            .querySelectorAll('.tvguide-manager-section')[0]
            .querySelector('input[type="checkbox"]');
        checkbox.checked = true;
        checkbox.dispatchEvent(new Event('change'));

        expect(runEffect.mock.calls.map((c) => c[0].type)).toContain('loadChannels');
    });
});

describe('adding and removing channels', () => {
    it('adds a channel the rule left out', () => {
        const { store, manager } = mount();
        buttonLabelled(rowFor(manager, 'studio:3'), /Add to guide/).click();

        const entry = store.getState().lineup.find((e) => Array.isArray(e.ids));
        expect(entry.ids).toContain('3');
    });

    it('adds a channel from another source entirely', () => {
        const { store, manager } = mount();
        buttonLabelled(rowFor(manager, 'tag:9'), /Add to guide/).click();

        expect(store.getState().lineup).toContainEqual({ source: 'tag', ids: ['9'] });
    });

    it('removing a rule-swept channel freezes the rest as explicit picks', () => {
        // Otherwise the next resolve sweeps it straight back in, and the
        // button looks broken.
        const { store, manager } = mount();
        buttonLabelled(rowFor(manager, 'studio:1'), /Remove from guide/).click();

        const lineup = store.getState().lineup;
        expect(lineup.some((e) => e.source === 'studio' && !e.ids)).toBe(false);

        const picks = lineup.find((e) => e.source === 'studio' && e.ids);
        expect(picks.ids).toContain('2');
        expect(picks.ids).not.toContain('1');
    });
});

describe('pinning and hiding', () => {
    it('pins a channel to the top of the guide', () => {
        const { store, manager } = mount();
        buttonLabelled(rowFor(manager, 'studio:2'), /Pin Bravo/).click();

        expect(store.getState().channels.map((c) => c.id)).toEqual(['studio:2', 'studio:1']);
        expect(rowFor(manager, 'studio:2').classList.contains('is-pinned')).toBe(true);
    });

    it('unpins again', () => {
        const { store, manager } = mount();
        buttonLabelled(rowFor(manager, 'studio:2'), /Pin Bravo/).click();
        buttonLabelled(rowFor(manager, 'studio:2'), /Unpin Bravo/).click();

        expect(store.getState().channels.map((c) => c.id)).toEqual(['studio:1', 'studio:2']);
    });

    it('hides a channel from the guide but keeps it listed here', () => {
        const { store, manager } = mount();
        buttonLabelled(rowFor(manager, 'studio:2'), /Hide Bravo/).click();

        expect(store.getState().channels.map((c) => c.id)).toEqual(['studio:1']);
        expect(rowFor(manager, 'studio:2')).not.toBeNull();
        expect(rowFor(manager, 'studio:2').classList.contains('is-hidden')).toBe(true);
    });

    it('cannot pin or hide a channel that is not in the guide', () => {
        const { manager } = mount();
        const row = rowFor(manager, 'studio:3');
        expect(buttonLabelled(row, /Pin Tiny/).disabled).toBe(true);
        expect(buttonLabelled(row, /Hide Tiny/).disabled).toBe(true);
    });

    it('marks toggle state for assistive tech', () => {
        const { manager } = mount();
        const pin = buttonLabelled(rowFor(manager, 'studio:2'), /Pin Bravo/);
        expect(pin.getAttribute('aria-pressed')).toBe('false');
        pin.click();
        expect(buttonLabelled(rowFor(manager, 'studio:2'), /Unpin Bravo/).getAttribute('aria-pressed'))
            .toBe('true');
    });
});

describe('per-channel customisation', () => {
    const openEditor = (manager, channelId) => {
        buttonLabelled(rowFor(manager, channelId), /Customise/).click();
        return rowFor(manager, channelId).querySelector('.tvguide-manager-editor');
    };

    it('opens and closes an editor', () => {
        const { manager } = mount();
        expect(openEditor(manager, 'studio:1')).not.toBeNull();
        expect(buttonLabelled(rowFor(manager, 'studio:1'), /Customise/).getAttribute('aria-expanded'))
            .toBe('true');

        buttonLabelled(rowFor(manager, 'studio:1'), /Customise/).click();
        expect(rowFor(manager, 'studio:1').querySelector('.tvguide-manager-editor')).toBeNull();
    });

    it('renames a channel', () => {
        const { store, manager } = mount();
        const editor = openEditor(manager, 'studio:1');
        const input = editor.querySelector('input[type="text"]');
        input.value = 'Short Name';
        input.dispatchEvent(new Event('change'));

        expect(store.getState().channels.find((c) => c.id === 'studio:1').name).toBe('Short Name');
        expect(store.getState().allChannels.find((c) => c.id === 'studio:1').name).toBe('Alpha');
    });

    it('shows the original name alongside a rename', () => {
        const { manager } = mount({ prefs: { 'studio:1': { name: 'Short' } } });
        const row = rowFor(manager, 'studio:1');
        expect(row.querySelector('.tvguide-manager-row-name').textContent).toBe('Short');
        expect(row.querySelector('.tvguide-manager-row-meta').textContent).toContain('Alpha');
    });

    it('clearing a rename restores the original', () => {
        const { store, manager } = mount({ prefs: { 'studio:1': { name: 'Short' } } });
        const editor = openEditor(manager, 'studio:1');
        const input = editor.querySelector('input[type="text"]');
        input.value = '';
        input.dispatchEvent(new Event('change'));

        expect(store.getState().channels.find((c) => c.id === 'studio:1').name).toBe('Alpha');
    });

    it('sets a custom logo', () => {
        const { store, manager } = mount();
        const editor = openEditor(manager, 'studio:1');
        const input = editor.querySelector('input[type="url"]');
        input.value = '/my-logo.png';
        input.dispatchEvent(new Event('change'));

        expect(store.getState().channels.find((c) => c.id === 'studio:1').logo)
            .toEqual({ type: 'image', url: '/my-logo.png' });
    });

    it('sets a per-channel scene cap', () => {
        const { store, manager } = mount();
        const editor = openEditor(manager, 'studio:1');
        const input = editor.querySelector('input[type="number"]');
        input.value = '400';
        input.dispatchEvent(new Event('change'));

        expect(store.getState().prefs['studio:1'].poolCap).toBe(400);
    });

    it('shows existing overrides in the editor', () => {
        const { manager } = mount({
            prefs: { 'studio:1': { name: 'Short', logoUrl: '/x.png', poolCap: 250 } }
        });
        const editor = openEditor(manager, 'studio:1');
        expect(editor.querySelector('input[type="text"]').value).toBe('Short');
        expect(editor.querySelector('input[type="url"]').value).toBe('/x.png');
        expect(editor.querySelector('input[type="number"]').value).toBe('250');
    });
});

describe('closing', () => {
    it('closes from the close button', () => {
        const { store, manager } = mount();
        manager.element.querySelector('.tvguide-manager-close').click();
        expect(store.getState().managerOpen).toBe(false);
        expect(manager.element.hidden).toBe(true);
    });
});
