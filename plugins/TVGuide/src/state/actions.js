/**
 * Event and effect vocabularies.
 *
 * Events are things that happened; effects are things that must happen. The
 * reducer only ever produces effects -- it never performs them -- which is what
 * keeps the ticking clock, the lazy loads and the video element testable
 * without a browser.
 */

export const Events = {
    OPEN: 'OPEN',
    CLOSE: 'CLOSE',
    SETTINGS_LOADED: 'SETTINGS_LOADED',
    RESTORE: 'RESTORE',
    TICK: 'TICK',
    CHANNELS_LOADED: 'CHANNELS_LOADED',
    CHANNELS_FAILED: 'CHANNELS_FAILED',
    POOL_REQUESTED: 'POOL_REQUESTED',
    POOL_LOADED: 'POOL_LOADED',
    POOL_FAILED: 'POOL_FAILED',
    TUNE: 'TUNE',
    EXPAND: 'EXPAND',
    PAN: 'PAN',
    GO_TO_NOW: 'GO_TO_NOW',
    FOCUS_CELL: 'FOCUS_CELL',
    MOVE_FOCUS: 'MOVE_FOCUS',
    LAYOUT_CHANGED: 'LAYOUT_CHANGED',
    SET_MUTED: 'SET_MUTED'
};

export const Effects = {
    loadChannels: () => ({ type: 'loadChannels' }),
    fetchPool: (channelId, sceneFilter) => ({ type: 'fetchPool', channelId, sceneFilter }),
    /** Point the viewer at whatever is live on this channel right now. */
    tuneViewer: (channelId, scene, offsetMs) => ({ type: 'tuneViewer', channelId, scene, offsetMs }),
    stopViewer: () => ({ type: 'stopViewer' }),
    setMuted: (muted) => ({ type: 'setMuted', muted }),
    navigateToScene: (sceneId, offsetSeconds) => ({ type: 'navigateToScene', sceneId, offsetSeconds }),
    persist: (key, value) => ({ type: 'persist', key, value }),
    announce: (message) => ({ type: 'announce', message })
};

export const STORAGE_KEYS = {
    tunedChannel: 'tvguide_last_channel',
    muted: 'tvguide_muted',
    lineup: 'tvguide_lineup'
};
