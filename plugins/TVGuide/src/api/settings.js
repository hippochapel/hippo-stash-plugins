/**
 * Plugin settings, read from the Stash server config.
 *
 * Stash returns whatever the user typed (or nothing at all), so every value is
 * coerced against a default here. Downstream code can then treat settings as
 * trustworthy numbers and booleans.
 */

export const PLUGIN_ID = 'TVGuide';

export const DEFAULT_SETTINGS = {
    guide_min_scenes: 5,
    guide_window_hours: 3,
    guide_pool_cap: 100,
    guide_autoplay: true,
    guide_start_muted: true,
    guide_navbar_button: true
};

/** Bounds keep a mistyped setting from producing an unusable guide. */
const NUMBER_BOUNDS = {
    guide_min_scenes: { min: 0, max: 100000 },
    guide_window_hours: { min: 1, max: 12 },
    guide_pool_cap: { min: 1, max: 1000 }
};

const SETTINGS_QUERY = `query TVGuideConfiguration { configuration { plugins } }`;

function coerce(key, raw) {
    const fallback = DEFAULT_SETTINGS[key];

    if (typeof fallback === 'boolean') {
        return typeof raw === 'boolean' ? raw : fallback;
    }

    const n = Number(raw);
    if (!Number.isFinite(n)) return fallback;

    const { min, max } = NUMBER_BOUNDS[key];
    return Math.min(max, Math.max(min, Math.round(n)));
}

/** Merge stored values over the defaults, one key at a time. */
export function normalizeSettings(stored) {
    const source = stored && typeof stored === 'object' ? stored : {};
    const out = {};
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
        out[key] = key in source ? coerce(key, source[key]) : DEFAULT_SETTINGS[key];
    }
    return out;
}

/**
 * Load settings, falling back to defaults if the server cannot be reached --
 * a config hiccup should not stop the guide from opening.
 */
export async function loadSettings(gql) {
    try {
        const data = await gql(SETTINGS_QUERY);
        return normalizeSettings(data?.configuration?.plugins?.[PLUGIN_ID]);
    } catch (e) {
        return { ...DEFAULT_SETTINGS };
    }
}
