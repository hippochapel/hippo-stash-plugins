import { DEFAULT_SETTINGS } from '../api/settings.js';
import { DEFAULT_SORT } from '../domain/channelPrefs.js';
import { DEFAULT_LINEUP } from '../domain/lineup.js';

export const PoolStatus = {
    IDLE: 'idle',
    LOADING: 'loading',
    READY: 'ready',
    ERROR: 'error'
};

export function createInitialState() {
    return {
        open: false,
        layout: 'grid',

        // Clock. `nowMs` is pushed in by TICK rather than read from Date, so
        // every time-dependent branch is reproducible in a test.
        nowMs: 0,
        dayKey: '',
        dayStartMs: 0,

        settings: { ...DEFAULT_SETTINGS },

        windowStartMs: 0,

        // The raw resolved lineup, before prefs. `channels` is the derived,
        // prefs-applied and sorted list -- and it has to be real state rather
        // than a selector, because MOVE_FOCUS walks it in the reducer.
        allChannels: [],
        channels: [],
        channelsStatus: PoolStatus.IDLE,
        channelsError: null,
        sourceErrors: [],

        // channelId -> { status, scenes, error }
        pools: {},
        // channelId -> daySchedule, rebuilt when the broadcast day rolls over
        schedules: {},

        tunedChannelId: null,
        focus: null,
        muted: true,

        // Channel manager
        lineup: DEFAULT_LINEUP,
        prefs: {},
        sort: DEFAULT_SORT,
        managerOpen: false,
        managerSearch: '',
        catalog: null,
        catalogStatus: PoolStatus.IDLE,
        catalogError: null,

        announcement: ''
    };
}
