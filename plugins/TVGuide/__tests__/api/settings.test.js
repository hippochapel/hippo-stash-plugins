import {
    DEFAULT_SETTINGS,
    PLUGIN_ID,
    normalizeSettings,
    loadSettings,
    loadPluginConfiguration
} from '../../src/api/settings.js';

describe('normalizeSettings', () => {
    it('returns the defaults for empty input', () => {
        expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
        expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
        expect(normalizeSettings({})).toEqual(DEFAULT_SETTINGS);
        expect(normalizeSettings('nope')).toEqual(DEFAULT_SETTINGS);
    });

    it('takes stored values over the defaults', () => {
        const s = normalizeSettings({ guide_window_hours: 6, guide_autoplay: false });
        expect(s.guide_window_hours).toBe(6);
        expect(s.guide_autoplay).toBe(false);
        expect(s.guide_pool_cap).toBe(DEFAULT_SETTINGS.guide_pool_cap);
    });

    it('coerces numeric strings, which is what Stash often stores', () => {
        expect(normalizeSettings({ guide_pool_cap: '250' }).guide_pool_cap).toBe(250);
    });

    it('clamps numbers into a usable range', () => {
        expect(normalizeSettings({ guide_window_hours: 99 }).guide_window_hours).toBe(12);
        expect(normalizeSettings({ guide_window_hours: 0 }).guide_window_hours).toBe(1);
        expect(normalizeSettings({ guide_pool_cap: -10 }).guide_pool_cap).toBe(1);
    });

    it('rounds fractional numbers', () => {
        expect(normalizeSettings({ guide_window_hours: 3.7 }).guide_window_hours).toBe(4);
    });

    it('falls back when a number cannot be parsed', () => {
        expect(normalizeSettings({ guide_pool_cap: 'lots' }).guide_pool_cap)
            .toBe(DEFAULT_SETTINGS.guide_pool_cap);
    });

    it('only accepts real booleans for boolean settings', () => {
        expect(normalizeSettings({ guide_autoplay: 'false' }).guide_autoplay).toBe(true);
        expect(normalizeSettings({ guide_autoplay: false }).guide_autoplay).toBe(false);
    });

    it('ignores keys it does not know', () => {
        expect(normalizeSettings({ nonsense: 1 })).toEqual(DEFAULT_SETTINGS);
    });
});

describe('loadSettings', () => {
    it('reads this plugin\'s section of the server config', async () => {
        const gql = jest.fn(async () => ({
            configuration: { plugins: { [PLUGIN_ID]: { guide_window_hours: 2 } } }
        }));
        expect((await loadSettings(gql)).guide_window_hours).toBe(2);
    });

    it('falls back to defaults when the plugin has no stored settings', async () => {
        const gql = jest.fn(async () => ({ configuration: { plugins: {} } }));
        expect(await loadSettings(gql)).toEqual(DEFAULT_SETTINGS);
    });

    it('falls back to defaults when the query fails, so the guide still opens', async () => {
        const gql = jest.fn(async () => {
            throw new Error('offline');
        });
        expect(await loadSettings(gql)).toEqual(DEFAULT_SETTINGS);
    });

    it('falls back to defaults when the response shape is unexpected', async () => {
        expect(await loadSettings(async () => ({}))).toEqual(DEFAULT_SETTINGS);
    });
});

describe('loadPluginConfiguration', () => {
    it('returns the complete persisted plugin configuration', async () => {
        const config = { guide_window_hours: 2, tvguide_state: { tvguide_muted: 'false' } };
        const gql = jest.fn(async () => ({ configuration: { plugins: { [PLUGIN_ID]: config } } }));

        expect(await loadPluginConfiguration(gql)).toEqual(config);
    });
});
