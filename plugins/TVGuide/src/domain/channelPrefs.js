/**
 * Per-channel presentation preferences.
 *
 * Deliberately stored separately from the lineup. The lineup says *which*
 * sources become channels; prefs say how a channel is presented. Keying prefs
 * by channel id rather than by position means a rename survives toggling a
 * lineup rule off and back on -- which is exactly what a user expects, and what
 * an inline model would get wrong.
 *
 * Pure: no DOM, no storage, no I/O.
 */

export const SORT_MODES = ['name', 'sceneCount', 'source'];
export const DEFAULT_SORT = 'name';

const isPlainObject = (value) =>
    value !== null && typeof value === 'object' && !Array.isArray(value);

function validatePref(pref) {
    if (!isPlainObject(pref)) return null;

    const out = {};

    if (typeof pref.name === 'string' && pref.name.trim()) out.name = pref.name.trim();
    if (typeof pref.logoUrl === 'string' && pref.logoUrl.trim()) out.logoUrl = pref.logoUrl.trim();
    if (pref.hidden === true) out.hidden = true;

    const cap = Number.parseInt(pref.poolCap, 10);
    if (Number.isFinite(cap) && cap > 0) out.poolCap = cap;

    const pinnedAt = Number(pref.pinnedAt);
    if (Number.isFinite(pinnedAt) && pinnedAt > 0) out.pinnedAt = pinnedAt;

    // An entry that overrides nothing is noise; drop it so stored prefs stay
    // small and comparisons stay meaningful.
    return Object.keys(out).length > 0 ? out : null;
}

/** Drop anything malformed. This is user-editable data behind a UI. */
export function validatePrefs(prefs) {
    if (!isPlainObject(prefs)) return {};

    const out = {};
    for (const [channelId, pref] of Object.entries(prefs)) {
        const valid = validatePref(pref);
        if (valid) out[channelId] = valid;
    }
    return out;
}

export function parsePrefs(json) {
    if (typeof json !== 'string' || json === '') return {};
    try {
        return validatePrefs(JSON.parse(json));
    } catch (e) {
        // Corrupt prefs must not cost you the guide; you lose customisation,
        // not the channels.
        return {};
    }
}

export function serializePrefs(prefs) {
    return JSON.stringify(prefs);
}

/** Merge a change into one channel's prefs, dropping the entry if it empties. */
export function setPref(prefs, channelId, patch) {
    const merged = { ...(prefs[channelId] || {}), ...patch };

    // An explicit null/undefined/false clears a field rather than storing it.
    for (const [key, value] of Object.entries(patch)) {
        if (value == null || value === false || value === '') delete merged[key];
    }

    const next = { ...prefs };
    const valid = validatePref(merged);
    if (valid) next[channelId] = valid;
    else delete next[channelId];

    return next;
}

export const isPinned = (prefs, channelId) => Boolean(prefs[channelId]?.pinnedAt);
export const isHidden = (prefs, channelId) => Boolean(prefs[channelId]?.hidden);

/** The scene cap for a channel: its own override, else the global setting. */
export function poolCapFor(prefs, channelId, defaultCap) {
    return prefs[channelId]?.poolCap || defaultCap;
}

/**
 * Apply renames, logo overrides and hiding.
 *
 * Returns new channel objects rather than mutating, so the raw resolved list
 * stays intact and prefs can be re-applied when they change.
 */
export function applyPrefs(channels, prefs) {
    const out = [];

    for (const channel of channels) {
        const pref = prefs[channel.id];
        if (pref?.hidden) continue;

        if (!pref || (!pref.name && !pref.logoUrl)) {
            out.push(channel);
            continue;
        }

        out.push({
            ...channel,
            name: pref.name || channel.name,
            logo: pref.logoUrl ? { type: 'image', url: pref.logoUrl } : channel.logo
        });
    }

    return out;
}

const byName = (a, b) => a.name.localeCompare(b.name);

const COMPARATORS = {
    name: byName,
    // Most-stocked first; a saved filter has no count and sorts last.
    sceneCount: (a, b) => (b.sceneCount ?? -1) - (a.sceneCount ?? -1) || byName(a, b),
    source: (a, b) => a.source.localeCompare(b.source) || byName(a, b)
};

/**
 * Pinned channels first in the order they were pinned, then everything else by
 * the chosen sort. Hand-ordering hundreds of channels is not workable, so pin
 * plus sort is what replaces it.
 */
export function sortChannels(channels, prefs, mode = DEFAULT_SORT) {
    const compare = COMPARATORS[mode] || COMPARATORS[DEFAULT_SORT];

    const pinned = [];
    const rest = [];
    for (const channel of channels) {
        if (prefs[channel.id]?.pinnedAt) pinned.push(channel);
        else rest.push(channel);
    }

    pinned.sort((a, b) => prefs[a.id].pinnedAt - prefs[b.id].pinnedAt);
    rest.sort(compare);

    return [...pinned, ...rest];
}

/** Everything the guide shows, in the order it shows it. */
export function visibleChannels(channels, prefs, mode) {
    return sortChannels(applyPrefs(channels, prefs), prefs, mode);
}
