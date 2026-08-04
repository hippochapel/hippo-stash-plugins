/**
 * Core utilities for SpriteTab plugin.
 * Loaded as a separate script in the browser (exposed at window.SpriteTabCore)
 * and via CommonJS in the Jest test environment.
 */

(function (global) {
    'use strict';

    const STORAGE_KEY = 'stash_plugin_sprite_settings';
    const PLUGIN_ID = 'SpriteTab';
    const DEFAULT_PREVIEW_WIDTH = 300;
    const DEFAULTS = { cols: 4 };
    const VALID_DEFAULT_ACTIVE_MODES = ['remember', 'always_on', 'always_off'];

    /**
     * Format seconds into human-readable time string
     * @param {number} seconds - Time in seconds
     * @returns {string} Formatted time string (e.g., "1:23" or "1:02:03")
     */
    function formatTime(seconds) {
        if (!seconds) return "0:00";
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        return h > 0
            ? `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
            : `${m}:${s.toString().padStart(2, '0')}`;
    }

    /**
     * Get settings from localStorage
     * @param {Storage} storage - Storage interface (defaults to localStorage)
     * @returns {object} Settings object with defaults applied
     */
    function getSettings(storage = typeof localStorage !== 'undefined' ? localStorage : null) {
        try {
            if (!storage) return { ...DEFAULTS };
            const stored = storage.getItem(STORAGE_KEY);
            return { ...DEFAULTS, ...JSON.parse(stored) };
        } catch (e) {
            return { ...DEFAULTS };
        }
    }

    /**
     * Save settings to localStorage
     * @param {object} newSettings - New settings to merge
     * @param {Storage} storage - Storage interface (defaults to localStorage)
     * @returns {object} Merged settings object
     */
    function saveSettings(newSettings, storage = typeof localStorage !== 'undefined' ? localStorage : null) {
        const merged = { ...getSettings(storage), ...newSettings };
        if (storage) {
            storage.setItem(STORAGE_KEY, JSON.stringify(merged));
        }
        return merged;
    }

    /**
     * Calculate tooltip position with bounds checking
     * @param {number} clientX - Cursor/touch X position
     * @param {number} clientY - Cursor/touch Y position
     * @param {number} tooltipWidth - Width of tooltip
     * @param {number} tooltipHeight - Height of tooltip
     * @param {number} viewportWidth - Viewport width
     * @param {number} viewportHeight - Viewport height
     * @param {number} offset - Offset from cursor (default 20)
     * @param {number} edgePadding - Padding from viewport edges (default 10)
     * @returns {object} Position object with top and left properties
     */
    function calculateTooltipPosition(
        clientX,
        clientY,
        tooltipWidth,
        tooltipHeight,
        viewportWidth,
        viewportHeight,
        offset = 20,
        edgePadding = 10
    ) {
        let left = clientX + offset;
        let top = clientY + offset;

        // If clipping right edge, flip to left of cursor
        if (left + tooltipWidth + edgePadding > viewportWidth) {
            left = clientX - tooltipWidth - offset;
        }
        // If still clipping left edge, align to left edge with padding
        if (left < edgePadding) {
            left = edgePadding;
        }

        // If clipping bottom edge, flip to above cursor
        if (top + tooltipHeight + edgePadding > viewportHeight) {
            top = clientY - tooltipHeight - offset;
        }
        // If still clipping top edge, align to top edge with padding
        if (top < edgePadding) {
            top = edgePadding;
        }

        return { top, left };
    }

    /**
     * Detect if a touch movement constitutes scrolling
     * @param {object} startPos - Starting position { x, y }
     * @param {object} currentPos - Current position { x, y }
     * @param {number} threshold - Movement threshold in pixels (default 10)
     * @returns {boolean} True if movement exceeds threshold
     */
    function isScrollGesture(startPos, currentPos, threshold = 10) {
        if (!startPos || !currentPos) return false;
        const dx = Math.abs(currentPos.x - startPos.x);
        const dy = Math.abs(currentPos.y - startPos.y);
        return dx > threshold || dy > threshold;
    }

    /**
     * Check if an event is a synthetic mouse event following a touch
     * @param {number} lastTouchTime - Timestamp of last touch event
     * @param {number} currentTime - Current timestamp (default Date.now())
     * @param {number} threshold - Time threshold in ms (default 500)
     * @returns {boolean} True if this is likely a synthetic event
     */
    function isSyntheticMouseEvent(lastTouchTime, currentTime = Date.now(), threshold = 500) {
        return currentTime - lastTouchTime < threshold;
    }

    /**
     * Parse thumbnail dimensions from a Video.js vttThumbnails track.
     * @param {Array} vttData - vttData array from vjsPlayer.vttThumbnails()
     * @returns {{thumbWidth: number, thumbHeight: number}|null} Dimensions, or null if unparseable
     */
    function parseVttDimensions(vttData) {
        if (!vttData || !vttData[0] || !vttData[0].style) return null;
        const thumbWidth = parseInt(vttData[0].style.width, 10);
        const thumbHeight = parseInt(vttData[0].style.height, 10);
        if (!Number.isFinite(thumbWidth) || thumbWidth <= 0) return null;
        if (!Number.isFinite(thumbHeight) || thumbHeight <= 0) return null;
        return { thumbWidth, thumbHeight };
    }

    /**
     * Calculate sprite grid dimensions from sheet and thumbnail sizes.
     * @param {number} imageWidth - Natural width of sprite sheet
     * @param {number} imageHeight - Natural height of sprite sheet
     * @param {number} thumbWidth - Width of a single thumbnail (from VTT track)
     * @param {number} thumbHeight - Height of a single thumbnail (from VTT track)
     * @returns {{cols: number, rows: number}}
     */
    function calculateSpriteGrid(imageWidth, imageHeight, thumbWidth, thumbHeight) {
        return {
            cols: Math.round(imageWidth / thumbWidth),
            rows: Math.round(imageHeight / thumbHeight)
        };
    }

    /**
     * Infer grid and thumbnail dimensions from the sprite sheet alone.
     *
     * Used when no VTT track is available, so the real thumbnail size is unknown.
     * Stash emits sprite sheets as a square grid (9x9 = 81 frames) of thumbnails
     * scaled to a fixed width, so the column count derived from that width also
     * gives the row count. Deriving thumbHeight from the sheet rather than
     * assuming 16:9 keeps this correct for portrait sources.
     *
     * @param {number} imageWidth - Natural width of sprite sheet
     * @param {number} imageHeight - Natural height of sprite sheet
     * @param {number} spriteWidthGuess - Expected width of a single thumbnail
     * @returns {{cols: number, rows: number, thumbWidth: number, thumbHeight: number}}
     */
    function inferGridFromSheet(imageWidth, imageHeight, spriteWidthGuess) {
        const cols = Math.max(1, Math.round(imageWidth / spriteWidthGuess));
        const rows = cols; // square-grid invariant
        return {
            cols,
            rows,
            thumbWidth: imageWidth / cols,
            thumbHeight: imageHeight / rows
        };
    }

    /**
     * Calculate background position for a sprite in the grid
     * @param {number} index - Sprite index (0-based)
     * @param {number} cols - Number of columns in grid
     * @param {number} rows - Number of rows in grid
     * @returns {string} CSS background-position value
     */
    function calculateSpritePosition(index, cols, rows) {
        const colIdx = index % cols;
        const rowIdx = Math.floor(index / cols);
        const xPercent = cols > 1 ? (colIdx / (cols - 1)) * 100 : 0;
        const yPercent = rows > 1 ? (rowIdx / (rows - 1)) * 100 : 0;
        return `${xPercent}% ${yPercent}%`;
    }

    /**
     * Calculate time for a sprite based on its index
     * @param {number} index - Sprite index
     * @param {number} totalSprites - Total number of sprites
     * @param {number} duration - Video duration in seconds
     * @returns {number} Time in seconds
     */
    function calculateSpriteTime(index, totalSprites, duration) {
        return (index / totalSprites) * duration;
    }

    /**
     * Inverse of calculateSpriteTime: determine which sprite is active for a given
     * playback time. Rounds to the nearest sprite so a few-millisecond shortfall
     * after a seek doesn't push the highlight to the previous sprite.
     * @param {number} currentTime - Playback time in seconds
     * @param {number} totalSprites - Total number of sprites
     * @param {number} duration - Video duration in seconds
     * @returns {number} Active sprite index, clamped to [0, totalSprites - 1]
     */
    function getActiveSpriteIndex(currentTime, totalSprites, duration) {
        const idx = Math.round((currentTime / duration) * totalSprites);
        return Math.max(0, Math.min(idx, totalSprites - 1));
    }

    /**
     * Parse plugin settings from GraphQL response
     * @param {object} data - GraphQL response data
     * @param {string} pluginId - Plugin identifier
     * @returns {object} Plugin settings with defaults
     */
    function parsePluginSettings(data, pluginId = PLUGIN_ID) {
        const defaults = {
            tooltip_enabled: true,
            tooltip_width: DEFAULT_PREVIEW_WIDTH
        };

        const allPlugins = data?.configuration?.plugins;
        if (!allPlugins || !allPlugins[pluginId]) {
            return defaults;
        }

        const settings = allPlugins[pluginId];
        return {
            tooltip_enabled: settings.tooltip_enabled ?? defaults.tooltip_enabled,
            tooltip_width: settings.tooltip_width ?? defaults.tooltip_width
        };
    }

    /**
     * Parse scene data from GraphQL response
     * @param {object} data - GraphQL response data
     * @returns {object|null} Scene data or null if not found
     */
    function parseSceneData(data) {
        const scene = data?.findScene;
        if (!scene) return null;

        return {
            id: scene.id,
            duration: scene.files?.[0]?.duration || 0,
            spritePath: scene.paths?.sprite || null
        };
    }

    /**
     * Check if the current viewport is using a mobile (phone-sized) layout.
     * On mobile, the sprite panel flows with the page rather than having its own
     * scroll container, so auto-scroll during playback would hijack the page scroll.
     * @param {function} matchMediaFn - matchMedia function (injectable for testing)
     * @returns {boolean} True if viewport width is ≤767px
     */
    function isMobileLayout(matchMediaFn = typeof window !== 'undefined' ? window.matchMedia.bind(window) : null) {
        if (!matchMediaFn) return false;
        return matchMediaFn('(max-width: 767px)').matches;
    }

    /**
     * Extract scene ID from URL path
     * @param {string} pathname - URL pathname
     * @returns {string|null} Scene ID or null if not a scene page
     */
    function extractSceneId(pathname) {
        const match = pathname.match(/\/scenes\/(\d+)/);
        return match ? match[1] : null;
    }

    /**
     * Validate and coerce the default_active plugin setting to a known mode.
     * Falls back to 'remember' for missing or invalid values.
     * @param {object} pluginConfig - The SpriteTab plugin config object
     * @returns {'remember'|'always_on'|'always_off'}
     */
    function getDefaultActiveMode(pluginConfig) {
        const mode = pluginConfig && pluginConfig.default_active;
        return VALID_DEFAULT_ACTIVE_MODES.indexOf(mode) >= 0 ? mode : 'remember';
    }

    /**
     * Resolve whether the SpriteTab should auto-activate on scene load, given the
     * configured mode and the persisted user toggle. Returns true to activate.
     * @param {string} mode - One of 'remember' | 'always_on' | 'always_off'
     * @param {boolean} savedState - Persisted user toggle (from localStorage)
     * @returns {boolean}
     */
    function resolveInitialActiveState(mode, savedState) {
        if (mode === 'always_on') return true;
        if (mode === 'always_off') return false;
        return Boolean(savedState);
    }

    const api = {
        STORAGE_KEY,
        PLUGIN_ID,
        DEFAULT_PREVIEW_WIDTH,
        DEFAULTS,
        VALID_DEFAULT_ACTIVE_MODES,
        formatTime,
        getSettings,
        saveSettings,
        calculateTooltipPosition,
        isScrollGesture,
        isSyntheticMouseEvent,
        isMobileLayout,
        parseVttDimensions,
        calculateSpriteGrid,
        inferGridFromSheet,
        calculateSpritePosition,
        calculateSpriteTime,
        getActiveSpriteIndex,
        parsePluginSettings,
        parseSceneData,
        extractSceneId,
        getDefaultActiveMode,
        resolveInitialActiveState
    };

    if (typeof global !== 'undefined' && global) {
        global.SpriteTabCore = api;
    }
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null));
