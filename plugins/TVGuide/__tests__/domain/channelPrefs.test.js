import {
    SORT_MODES,
    DEFAULT_SORT,
    validatePrefs,
    parsePrefs,
    serializePrefs,
    setPref,
    isPinned,
    isHidden,
    poolCapFor,
    applyPrefs,
    sortChannels,
    visibleChannels
} from '../../src/domain/channelPrefs.js';

const chan = (id, name, sceneCount = 10, source = 'studio') => ({
    id,
    source,
    name,
    logo: { type: 'monogram', initials: 'XX', hue: 1 },
    sceneCount,
    sceneFilter: {}
});

describe('validatePrefs', () => {
    it('keeps every supported override', () => {
        const prefs = validatePrefs({
            'studio:1': { name: 'Short', logoUrl: '/x.png', hidden: true, poolCap: 300, pinnedAt: 1000 }
        });
        expect(prefs['studio:1']).toEqual({
            name: 'Short',
            logoUrl: '/x.png',
            hidden: true,
            poolCap: 300,
            pinnedAt: 1000
        });
    });

    it('trims names and logo urls', () => {
        expect(validatePrefs({ 'studio:1': { name: '  Trimmed  ' } })['studio:1'].name).toBe('Trimmed');
        expect(validatePrefs({ 'studio:1': { logoUrl: ' /x.png ' } })['studio:1'].logoUrl).toBe('/x.png');
    });

    it('drops entries that override nothing', () => {
        expect(validatePrefs({ 'studio:1': {} })).toEqual({});
        expect(validatePrefs({ 'studio:1': { name: '   ' } })).toEqual({});
        expect(validatePrefs({ 'studio:1': { hidden: false } })).toEqual({});
    });

    it('only accepts hidden as a real true', () => {
        expect(validatePrefs({ 'studio:1': { hidden: 'yes' } })).toEqual({});
    });

    it('rejects a nonsensical pool cap', () => {
        expect(validatePrefs({ 'studio:1': { poolCap: 0 } })).toEqual({});
        expect(validatePrefs({ 'studio:1': { poolCap: -5 } })).toEqual({});
        expect(validatePrefs({ 'studio:1': { poolCap: 'lots' } })).toEqual({});
    });

    it('coerces a numeric-string pool cap', () => {
        expect(validatePrefs({ 'studio:1': { poolCap: '250' } })['studio:1'].poolCap).toBe(250);
    });

    it('rejects a nonsensical pin timestamp', () => {
        expect(validatePrefs({ 'studio:1': { pinnedAt: 0 } })).toEqual({});
        expect(validatePrefs({ 'studio:1': { pinnedAt: 'now' } })).toEqual({});
    });

    it('tolerates junk input', () => {
        expect(validatePrefs(null)).toEqual({});
        expect(validatePrefs('nope')).toEqual({});
        expect(validatePrefs([])).toEqual({});
        expect(validatePrefs({ 'studio:1': null })).toEqual({});
        expect(validatePrefs({ 'studio:1': 'nope' })).toEqual({});
        expect(validatePrefs({ 'studio:1': [] })).toEqual({});
    });
});

describe('parsePrefs', () => {
    it('round-trips', () => {
        const prefs = { 'studio:1': { name: 'A', pinnedAt: 5 } };
        expect(parsePrefs(serializePrefs(prefs))).toEqual(prefs);
    });

    it('returns empty prefs rather than failing on corrupt data', () => {
        expect(parsePrefs('{oh no')).toEqual({});
        expect(parsePrefs('')).toEqual({});
        expect(parsePrefs(null)).toEqual({});
        expect(parsePrefs('[1,2,3]')).toEqual({});
    });
});

describe('setPref', () => {
    it('adds an override for a channel with none', () => {
        expect(setPref({}, 'studio:1', { name: 'New' })).toEqual({ 'studio:1': { name: 'New' } });
    });

    it('merges into existing overrides', () => {
        const prefs = { 'studio:1': { name: 'A' } };
        expect(setPref(prefs, 'studio:1', { hidden: true })['studio:1']).toEqual({
            name: 'A',
            hidden: true
        });
    });

    it('does not mutate the input', () => {
        const prefs = { 'studio:1': { name: 'A' } };
        setPref(prefs, 'studio:1', { hidden: true });
        expect(prefs).toEqual({ 'studio:1': { name: 'A' } });
    });

    it('clears a field when set to null, false or empty', () => {
        const prefs = { 'studio:1': { name: 'A', hidden: true, pinnedAt: 5 } };
        expect(setPref(prefs, 'studio:1', { hidden: false })['studio:1']).toEqual({
            name: 'A',
            pinnedAt: 5
        });
        expect(setPref(prefs, 'studio:1', { name: '' })['studio:1']).toEqual({
            hidden: true,
            pinnedAt: 5
        });
        expect(setPref(prefs, 'studio:1', { pinnedAt: null })['studio:1']).toEqual({
            name: 'A',
            hidden: true
        });
    });

    it('removes the channel entirely once nothing is overridden', () => {
        const prefs = { 'studio:1': { hidden: true } };
        expect(setPref(prefs, 'studio:1', { hidden: false })).toEqual({});
    });

    it('leaves other channels alone', () => {
        const prefs = { 'studio:1': { name: 'A' }, 'studio:2': { name: 'B' } };
        expect(setPref(prefs, 'studio:1', { name: 'C' })['studio:2']).toEqual({ name: 'B' });
    });
});

describe('predicates', () => {
    const prefs = { 'studio:1': { pinnedAt: 10 }, 'studio:2': { hidden: true } };

    it('reports pinned and hidden', () => {
        expect(isPinned(prefs, 'studio:1')).toBe(true);
        expect(isPinned(prefs, 'studio:2')).toBe(false);
        expect(isPinned(prefs, 'studio:9')).toBe(false);
        expect(isHidden(prefs, 'studio:2')).toBe(true);
        expect(isHidden(prefs, 'studio:1')).toBe(false);
    });

    it('falls back to the global cap when a channel has no override', () => {
        expect(poolCapFor({ 'studio:1': { poolCap: 300 } }, 'studio:1', 100)).toBe(300);
        expect(poolCapFor({}, 'studio:1', 100)).toBe(100);
    });
});

describe('applyPrefs', () => {
    const channels = [chan('studio:1', 'Long Studio Name'), chan('studio:2', 'Other')];

    it('renames a channel', () => {
        expect(applyPrefs(channels, { 'studio:1': { name: 'Short' } })[0].name).toBe('Short');
    });

    it('replaces the logo with a custom url', () => {
        const out = applyPrefs(channels, { 'studio:1': { logoUrl: '/mine.png' } });
        expect(out[0].logo).toEqual({ type: 'image', url: '/mine.png' });
    });

    it('removes hidden channels', () => {
        const out = applyPrefs(channels, { 'studio:1': { hidden: true } });
        expect(out.map((c) => c.id)).toEqual(['studio:2']);
    });

    it('leaves untouched channels as the very same object', () => {
        const out = applyPrefs(channels, {});
        expect(out[0]).toBe(channels[0]);
    });

    it('does not mutate the originals', () => {
        applyPrefs(channels, { 'studio:1': { name: 'Short' } });
        expect(channels[0].name).toBe('Long Studio Name');
    });

    it('ignores prefs that do not change presentation', () => {
        const out = applyPrefs(channels, { 'studio:1': { pinnedAt: 5, poolCap: 300 } });
        expect(out[0]).toBe(channels[0]);
    });

    it('keeps the original name when only a logo is overridden', () => {
        const out = applyPrefs(channels, { 'studio:1': { logoUrl: '/mine.png' } });
        expect(out[0].name).toBe('Long Studio Name');
    });
});

describe('sortChannels', () => {
    const channels = [
        chan('studio:3', 'Charlie', 5),
        chan('studio:1', 'Alpha', 50),
        chan('studio:2', 'Bravo', 20)
    ];

    it('sorts by name by default', () => {
        expect(sortChannels(channels, {}).map((c) => c.name)).toEqual(['Alpha', 'Bravo', 'Charlie']);
    });

    it('sorts by scene count, most first', () => {
        expect(sortChannels(channels, {}, 'sceneCount').map((c) => c.name)).toEqual([
            'Alpha',
            'Bravo',
            'Charlie'
        ]);
    });

    it('puts saved filters, which have no count, last', () => {
        const withFilter = [...channels, { ...chan('savedFilter:1', 'Zeta'), sceneCount: null }];
        expect(sortChannels(withFilter, {}, 'sceneCount').map((c) => c.name).pop()).toBe('Zeta');
    });

    it('sorts two countless channels against each other by name', () => {
        const countless = [
            { ...chan('savedFilter:2', 'Zeta'), sceneCount: null },
            { ...chan('savedFilter:1', 'Alpha'), sceneCount: null }
        ];
        expect(sortChannels(countless, {}, 'sceneCount').map((c) => c.name)).toEqual(['Alpha', 'Zeta']);
    });

    it('breaks scene-count ties by name', () => {
        const tied = [chan('studio:9', 'Zeta', 10), chan('studio:8', 'Alpha', 10)];
        expect(sortChannels(tied, {}, 'sceneCount').map((c) => c.name)).toEqual(['Alpha', 'Zeta']);
    });

    it('groups by source, then name', () => {
        const mixed = [chan('tag:1', 'Beta', 10, 'tag'), chan('studio:1', 'Zeta', 10, 'studio')];
        expect(sortChannels(mixed, {}, 'source').map((c) => c.name)).toEqual(['Zeta', 'Beta']);
    });

    it('lifts pinned channels to the top', () => {
        const prefs = { 'studio:3': { pinnedAt: 100 } };
        expect(sortChannels(channels, prefs).map((c) => c.name)).toEqual(['Charlie', 'Alpha', 'Bravo']);
    });

    it('orders pinned channels by when they were pinned', () => {
        const prefs = { 'studio:3': { pinnedAt: 200 }, 'studio:2': { pinnedAt: 100 } };
        expect(sortChannels(channels, prefs).map((c) => c.name)).toEqual([
            'Bravo',
            'Charlie',
            'Alpha'
        ]);
    });

    it('falls back to the default sort for an unknown mode', () => {
        expect(sortChannels(channels, {}, 'nonsense').map((c) => c.name)).toEqual([
            'Alpha',
            'Bravo',
            'Charlie'
        ]);
    });

    it('does not mutate the input array', () => {
        sortChannels(channels, {});
        expect(channels[0].name).toBe('Charlie');
    });

    it('handles an empty lineup', () => {
        expect(sortChannels([], {})).toEqual([]);
    });

    it('exposes the modes it supports, including the default', () => {
        expect(SORT_MODES).toContain(DEFAULT_SORT);
        for (const mode of SORT_MODES) {
            expect(sortChannels(channels, {}, mode)).toHaveLength(3);
        }
    });
});

describe('visibleChannels', () => {
    it('hides, renames and sorts in one pass', () => {
        const channels = [
            chan('studio:1', 'Alpha'),
            chan('studio:2', 'Bravo'),
            chan('studio:3', 'Charlie')
        ];
        const prefs = {
            'studio:2': { hidden: true },
            'studio:3': { name: 'Aardvark' },
            'studio:1': { pinnedAt: 5 }
        };

        expect(visibleChannels(channels, prefs).map((c) => c.name)).toEqual(['Alpha', 'Aardvark']);
    });

    it('sorts by the renamed name, not the original', () => {
        const channels = [chan('studio:1', 'Zebra'), chan('studio:2', 'Moose')];
        const out = visibleChannels(channels, { 'studio:1': { name: 'Aardvark' } });
        expect(out.map((c) => c.name)).toEqual(['Aardvark', 'Moose']);
    });
});
