import { DEFAULT_SETTINGS } from '../api/settings.js';

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

        announcement: ''
    };
}
