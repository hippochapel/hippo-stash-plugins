/**
 * Tests for core utility functions
 */

const {
    STORAGE_KEY,
    DEFAULTS,
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
} = require('../core');

describe('formatTime', () => {
    it('returns "0:00" for zero seconds', () => {
        expect(formatTime(0)).toBe('0:00');
    });

    it('returns "0:00" for null/undefined', () => {
        expect(formatTime(null)).toBe('0:00');
        expect(formatTime(undefined)).toBe('0:00');
    });

    it('formats seconds under a minute correctly', () => {
        expect(formatTime(5)).toBe('0:05');
        expect(formatTime(45)).toBe('0:45');
        expect(formatTime(59)).toBe('0:59');
    });

    it('formats minutes correctly', () => {
        expect(formatTime(60)).toBe('1:00');
        expect(formatTime(90)).toBe('1:30');
        expect(formatTime(125)).toBe('2:05');
        expect(formatTime(599)).toBe('9:59');
    });

    it('formats hours correctly', () => {
        expect(formatTime(3600)).toBe('1:00:00');
        expect(formatTime(3661)).toBe('1:01:01');
        expect(formatTime(7325)).toBe('2:02:05');
    });

    it('pads minutes and seconds with leading zeros', () => {
        expect(formatTime(61)).toBe('1:01');
        expect(formatTime(3601)).toBe('1:00:01');
        expect(formatTime(3660)).toBe('1:01:00');
    });

    it('handles decimal seconds by flooring', () => {
        expect(formatTime(65.7)).toBe('1:05');
        expect(formatTime(59.9)).toBe('0:59');
    });
});

describe('getSettings', () => {
    it('returns defaults when storage is null', () => {
        const settings = getSettings(null);
        expect(settings).toEqual(DEFAULTS);
    });

    it('returns defaults when storage is empty', () => {
        const mockStorage = {
            getItem: jest.fn(() => null)
        };
        const settings = getSettings(mockStorage);
        expect(settings).toEqual(DEFAULTS);
    });

    it('returns defaults when storage contains invalid JSON', () => {
        const mockStorage = {
            getItem: jest.fn(() => 'invalid json')
        };
        const settings = getSettings(mockStorage);
        expect(settings).toEqual(DEFAULTS);
    });

    it('uses stored value over default', () => {
        const mockStorage = {
            getItem: jest.fn(() => JSON.stringify({ cols: 8 }))
        };
        expect(getSettings(mockStorage)).toEqual({ cols: 8 });
    });
});

describe('saveSettings', () => {
    it('writes the merged result to storage and returns it', () => {
        const mockStorage = {
            getItem: jest.fn(() => JSON.stringify({ cols: 4 })),
            setItem: jest.fn()
        };
        const result = saveSettings({ cols: 8 }, mockStorage);
        expect(result.cols).toBe(8);
        expect(mockStorage.setItem).toHaveBeenCalledWith(
            STORAGE_KEY,
            expect.stringContaining('"cols":8')
        );
    });

    it('handles null storage gracefully', () => {
        const result = saveSettings({ cols: 6 }, null);
        expect(result.cols).toBe(6);
    });
});

describe('calculateTooltipPosition', () => {
    const viewportWidth = 1000;
    const viewportHeight = 800;
    const tooltipWidth = 200;
    const tooltipHeight = 150;

    it('positions tooltip to the right and below cursor by default', () => {
        const pos = calculateTooltipPosition(
            100, 100,
            tooltipWidth, tooltipHeight,
            viewportWidth, viewportHeight
        );
        expect(pos.left).toBe(120); // 100 + 20 offset
        expect(pos.top).toBe(120);
    });

    it('flips tooltip to left when near right edge', () => {
        const pos = calculateTooltipPosition(
            900, 100,
            tooltipWidth, tooltipHeight,
            viewportWidth, viewportHeight
        );
        // Should flip to left: 900 - 200 - 20 = 680
        expect(pos.left).toBe(680);
    });

    it('flips tooltip above when near bottom edge', () => {
        const pos = calculateTooltipPosition(
            100, 700,
            tooltipWidth, tooltipHeight,
            viewportWidth, viewportHeight
        );
        // Should flip up: 700 - 150 - 20 = 530
        expect(pos.top).toBe(530);
    });

    it('constrains to left edge when cursor is at far left', () => {
        const pos = calculateTooltipPosition(
            5, 100,
            tooltipWidth, tooltipHeight,
            viewportWidth, viewportHeight
        );
        // Cursor at 5, offset 20: 5 + 20 = 25, fits on screen so no flip needed
        // Position is simply cursor + offset
        expect(pos.left).toBe(25);
    });

    it('constrains to top edge when cursor is at top', () => {
        const pos = calculateTooltipPosition(
            100, 5,
            tooltipWidth, tooltipHeight,
            viewportWidth, viewportHeight
        );
        // Cursor at 5, offset 20: 5 + 20 = 25, fits on screen so no flip needed
        expect(pos.top).toBe(25);
    });

    it('constrains when flipping still goes off-screen', () => {
        // Very small viewport where tooltip can't fit either side
        const pos = calculateTooltipPosition(
            50, 50,
            tooltipWidth, tooltipHeight,
            100, 100 // tiny viewport
        );
        // Should constrain to edge padding
        expect(pos.left).toBe(10);
        expect(pos.top).toBe(10);
    });

    it('handles corner positions correctly', () => {
        // Bottom-right corner
        const pos = calculateTooltipPosition(
            950, 750,
            tooltipWidth, tooltipHeight,
            viewportWidth, viewportHeight
        );
        // Should flip both left and up
        expect(pos.left).toBe(730); // 950 - 200 - 20
        expect(pos.top).toBe(580); // 750 - 150 - 20
    });

    it('respects custom offset and padding', () => {
        const pos = calculateTooltipPosition(
            100, 100,
            tooltipWidth, tooltipHeight,
            viewportWidth, viewportHeight,
            30, // offset
            20  // edgePadding
        );
        expect(pos.left).toBe(130); // 100 + 30
        expect(pos.top).toBe(130);
    });
});

describe('isScrollGesture', () => {
    it('returns false for null positions', () => {
        expect(isScrollGesture(null, { x: 10, y: 10 })).toBe(false);
        expect(isScrollGesture({ x: 0, y: 0 }, null)).toBe(false);
        expect(isScrollGesture(null, null)).toBe(false);
    });

    it('returns false for movement below threshold', () => {
        expect(isScrollGesture({ x: 0, y: 0 }, { x: 5, y: 5 })).toBe(false);
        expect(isScrollGesture({ x: 100, y: 100 }, { x: 105, y: 105 })).toBe(false);
    });

    it('returns true for horizontal movement above threshold', () => {
        expect(isScrollGesture({ x: 0, y: 0 }, { x: 15, y: 0 })).toBe(true);
        expect(isScrollGesture({ x: 100, y: 100 }, { x: 85, y: 100 })).toBe(true);
    });

    it('returns true for vertical movement above threshold', () => {
        expect(isScrollGesture({ x: 0, y: 0 }, { x: 0, y: 15 })).toBe(true);
        expect(isScrollGesture({ x: 100, y: 100 }, { x: 100, y: 85 })).toBe(true);
    });

    it('respects custom threshold', () => {
        expect(isScrollGesture({ x: 0, y: 0 }, { x: 15, y: 0 }, 20)).toBe(false);
        expect(isScrollGesture({ x: 0, y: 0 }, { x: 25, y: 0 }, 20)).toBe(true);
    });
});

describe('isSyntheticMouseEvent', () => {
    it('returns true for events within threshold', () => {
        const now = Date.now();
        expect(isSyntheticMouseEvent(now - 100, now)).toBe(true);
        expect(isSyntheticMouseEvent(now - 499, now)).toBe(true);
    });

    it('returns false for events outside threshold', () => {
        const now = Date.now();
        expect(isSyntheticMouseEvent(now - 500, now)).toBe(false);
        expect(isSyntheticMouseEvent(now - 1000, now)).toBe(false);
    });

    it('returns false for zero/old timestamps', () => {
        expect(isSyntheticMouseEvent(0, Date.now())).toBe(false);
    });

    it('respects custom threshold', () => {
        const now = Date.now();
        expect(isSyntheticMouseEvent(now - 200, now, 100)).toBe(false);
        expect(isSyntheticMouseEvent(now - 50, now, 100)).toBe(true);
    });
});

describe('parseVttDimensions', () => {
    it('returns null for null or empty input', () => {
        expect(parseVttDimensions(null)).toBeNull();
        expect(parseVttDimensions(undefined)).toBeNull();
        expect(parseVttDimensions([])).toBeNull();
    });

    it('returns null when the first cue has no style', () => {
        expect(parseVttDimensions([{}])).toBeNull();
    });

    it('parses pixel dimensions from VTT style strings', () => {
        const vttData = [{ style: { width: '160px', height: '90px' } }];
        expect(parseVttDimensions(vttData)).toEqual({ thumbWidth: 160, thumbHeight: 90 });
    });

    it('parses portrait thumbnails (height > width)', () => {
        const vttData = [{ style: { width: '90px', height: '160px' } }];
        expect(parseVttDimensions(vttData)).toEqual({ thumbWidth: 90, thumbHeight: 160 });
    });

    it('returns null when dimensions are missing or unparseable', () => {
        expect(parseVttDimensions([{ style: { width: 'auto', height: '90px' } }])).toBeNull();
        expect(parseVttDimensions([{ style: { width: '160px', height: '' } }])).toBeNull();
        expect(parseVttDimensions([{ style: { width: '0px', height: '90px' } }])).toBeNull();
        expect(parseVttDimensions([{ style: { width: '-50px', height: '90px' } }])).toBeNull();
    });
});

describe('calculateSpriteGrid', () => {
    it('calculates grid dimensions from sheet and thumb sizes', () => {
        // 1600x900 sheet with 160x90 thumbs → 10 cols × 10 rows
        expect(calculateSpriteGrid(1600, 900, 160, 90)).toEqual({ cols: 10, rows: 10 });
    });

    it('rounds to the nearest column/row count when sizes do not divide evenly', () => {
        // 1610x905 sheet with 160x90 thumbs still resolves to a 10×10 grid
        expect(calculateSpriteGrid(1610, 905, 160, 90)).toEqual({ cols: 10, rows: 10 });
    });

    it('handles portrait sprite sheets', () => {
        // 360x640 sheet with 90x160 portrait thumbs → 4 cols × 4 rows
        expect(calculateSpriteGrid(360, 640, 90, 160)).toEqual({ cols: 4, rows: 4 });
    });

    it('handles custom thumbnail sizes (Stash 0.31+ custom sprite generation)', () => {
        // 1280x720 sheet with 320x180 thumbs → 4 cols × 4 rows
        expect(calculateSpriteGrid(1280, 720, 320, 180)).toEqual({ cols: 4, rows: 4 });
    });
});

describe('inferGridFromSheet', () => {
    it('matches the legacy 16:9 math for a landscape sheet', () => {
        // 1440x810 sheet = 9x9 grid of 160x90 thumbs. The old fallback derived
        // rows via a hardcoded 9/16; this must produce the identical result.
        expect(inferGridFromSheet(1440, 810, 160)).toEqual({
            cols: 9, rows: 9, thumbWidth: 160, thumbHeight: 90
        });
    });

    it('derives portrait thumb dimensions instead of assuming 16:9', () => {
        // 1440x2556 sheet = 9x9 grid of 160x284 portrait thumbs. The old
        // fallback computed 28 rows (252 cells) for this sheet.
        expect(inferGridFromSheet(1440, 2556, 160)).toEqual({
            cols: 9, rows: 9, thumbWidth: 160, thumbHeight: 284
        });
    });

    it('clamps to a single column when the sheet is narrower than one thumb', () => {
        expect(inferGridFromSheet(80, 140, 160)).toEqual({
            cols: 1, rows: 1, thumbWidth: 80, thumbHeight: 140
        });
    });
});

describe('calculateSpritePosition', () => {
    it('returns 0% 0% for first sprite', () => {
        expect(calculateSpritePosition(0, 10, 10)).toBe('0% 0%');
    });

    it('returns 100% 0% for last sprite in first row', () => {
        expect(calculateSpritePosition(9, 10, 10)).toBe('100% 0%');
    });

    it('returns 0% 100% for first sprite in last row', () => {
        expect(calculateSpritePosition(90, 10, 10)).toBe('0% 100%');
    });

    it('returns 100% 100% for last sprite', () => {
        expect(calculateSpritePosition(99, 10, 10)).toBe('100% 100%');
    });

    it('calculates middle positions correctly', () => {
        // Middle of 10x10 grid (index 44 = row 4, col 4)
        const pos = calculateSpritePosition(44, 10, 10);
        // col 4 of 10: 4/9 * 100 ≈ 44.44%
        // row 4 of 10: 4/9 * 100 ≈ 44.44%
        expect(pos).toMatch(/44\.4+% 44\.4+%/);
    });

    it('handles single column grid', () => {
        expect(calculateSpritePosition(0, 1, 10)).toBe('0% 0%');
        expect(calculateSpritePosition(5, 1, 10)).toMatch(/0% \d+/);
    });

    it('handles single row grid', () => {
        expect(calculateSpritePosition(0, 10, 1)).toBe('0% 0%');
        expect(calculateSpritePosition(5, 10, 1)).toMatch(/\d+% 0%/);
    });
});

describe('calculateSpriteTime', () => {
    it('returns 0 for first sprite', () => {
        expect(calculateSpriteTime(0, 100, 600)).toBe(0);
    });

    it('calculates proportional time for middle sprites', () => {
        // Index 50 of 100 sprites in 600 second video = 300 seconds
        expect(calculateSpriteTime(50, 100, 600)).toBe(300);
    });

    it('returns time close to duration for last sprite', () => {
        // Index 99 of 100 sprites = 99/100 * 600 = 594
        expect(calculateSpriteTime(99, 100, 600)).toBe(594);
    });

    it('handles various durations', () => {
        expect(calculateSpriteTime(25, 100, 1000)).toBe(250);
        expect(calculateSpriteTime(10, 50, 300)).toBe(60);
    });
});

describe('getActiveSpriteIndex', () => {
    it('returns 0 at the start of playback', () => {
        expect(getActiveSpriteIndex(0, 100, 600)).toBe(0);
    });

    it('returns the matching index at an exact sprite boundary', () => {
        // Sprite 10 of 100 in a 600s video sits at 60s.
        expect(getActiveSpriteIndex(60, 100, 600)).toBe(10);
    });

    it('rounds up when currentTime lands a few ms short of the requested seek', () => {
        // Regression: clicking sprite 10 seeks to 258.1291; the browser may
        // report currentTime slightly less than that (FP, keyframe alignment).
        // Math.floor used to map this back to sprite 9; Math.round keeps it at 10.
        expect(getActiveSpriteIndex(258.12, 100, 2581.291)).toBe(10);
        expect(getActiveSpriteIndex(258.1, 100, 2581.291)).toBe(10);
    });

    it('does not jump to the next sprite until the playhead is past the midpoint', () => {
        // Sprite 10 lives at 60s, sprite 11 at 66s; midpoint is 63s.
        expect(getActiveSpriteIndex(62.9, 100, 600)).toBe(10);
        expect(getActiveSpriteIndex(63.1, 100, 600)).toBe(11);
    });

    it('clamps to the last sprite when currentTime is at or past duration', () => {
        expect(getActiveSpriteIndex(600, 100, 600)).toBe(99);
        expect(getActiveSpriteIndex(700, 100, 600)).toBe(99);
    });

    it('clamps to 0 when currentTime is negative', () => {
        expect(getActiveSpriteIndex(-1, 100, 600)).toBe(0);
    });
});

describe('parsePluginSettings', () => {
    it('returns defaults for null data', () => {
        const result = parsePluginSettings(null);
        expect(result.tooltip_enabled).toBe(true);
        expect(result.tooltip_width).toBe(300);
    });

    it('returns defaults for missing plugin', () => {
        const data = { configuration: { plugins: {} } };
        const result = parsePluginSettings(data);
        expect(result.tooltip_enabled).toBe(true);
    });

    it('parses plugin settings correctly', () => {
        const data = {
            configuration: {
                plugins: {
                    SpriteTab: {
                        tooltip_enabled: false,
                        tooltip_width: 600
                    }
                }
            }
        };
        const result = parsePluginSettings(data);
        expect(result.tooltip_enabled).toBe(false);
        expect(result.tooltip_width).toBe(600);
    });

    it('uses defaults for missing individual settings', () => {
        const data = {
            configuration: {
                plugins: {
                    SpriteTab: {
                        tooltip_enabled: false
                        // tooltip_width missing
                    }
                }
            }
        };
        const result = parsePluginSettings(data);
        expect(result.tooltip_enabled).toBe(false);
        expect(result.tooltip_width).toBe(300);
    });

    it('supports custom plugin ID', () => {
        const data = {
            configuration: {
                plugins: {
                    CustomPlugin: { tooltip_width: 400 }
                }
            }
        };
        const result = parsePluginSettings(data, 'CustomPlugin');
        expect(result.tooltip_width).toBe(400);
    });
});

describe('parseSceneData', () => {
    it('returns null for null data', () => {
        expect(parseSceneData(null)).toBeNull();
    });

    it('returns null for missing findScene', () => {
        expect(parseSceneData({})).toBeNull();
        expect(parseSceneData({ findScene: null })).toBeNull();
    });

    it('parses scene data correctly', () => {
        const data = {
            findScene: {
                id: '123',
                files: [{ duration: 3600 }],
                paths: { sprite: '/sprites/123.jpg' }
            }
        };
        const result = parseSceneData(data);
        expect(result.id).toBe('123');
        expect(result.duration).toBe(3600);
        expect(result.spritePath).toBe('/sprites/123.jpg');
    });

    it('handles missing optional fields', () => {
        const data = {
            findScene: {
                id: '123',
                files: [],
                paths: {}
            }
        };
        const result = parseSceneData(data);
        expect(result.id).toBe('123');
        expect(result.duration).toBe(0);
        expect(result.spritePath).toBeNull();
    });
});

describe('isMobileLayout', () => {
    it('returns true when viewport matches phone-sized breakpoint', () => {
        const mockMatchMedia = jest.fn(() => ({ matches: true }));
        expect(isMobileLayout(mockMatchMedia)).toBe(true);
    });

    it('returns false when viewport does not match phone-sized breakpoint', () => {
        const mockMatchMedia = jest.fn(() => ({ matches: false }));
        expect(isMobileLayout(mockMatchMedia)).toBe(false);
    });

    it('queries the correct breakpoint', () => {
        const mockMatchMedia = jest.fn(() => ({ matches: false }));
        isMobileLayout(mockMatchMedia);
        expect(mockMatchMedia).toHaveBeenCalledWith('(max-width: 767px)');
    });

    it('returns false when matchMedia is unavailable', () => {
        expect(isMobileLayout(null)).toBe(false);
    });
});

describe('extractSceneId', () => {
    it('extracts scene ID from valid path', () => {
        expect(extractSceneId('/scenes/123')).toBe('123');
        expect(extractSceneId('/scenes/456789')).toBe('456789');
    });

    it('returns null for non-scene paths', () => {
        expect(extractSceneId('/')).toBeNull();
        expect(extractSceneId('/performers/123')).toBeNull();
        expect(extractSceneId('/studios')).toBeNull();
    });

    it('handles paths with additional segments', () => {
        expect(extractSceneId('/scenes/123/edit')).toBe('123');
        expect(extractSceneId('/scenes/123?tab=details')).toBe('123');
    });

    it('returns null for invalid scene paths', () => {
        expect(extractSceneId('/scenes/')).toBeNull();
        expect(extractSceneId('/scenes/abc')).toBeNull();
    });
});

describe('getDefaultActiveMode', () => {
    it('returns the configured mode when valid', () => {
        expect(getDefaultActiveMode({ default_active: 'remember' })).toBe('remember');
        expect(getDefaultActiveMode({ default_active: 'always_on' })).toBe('always_on');
        expect(getDefaultActiveMode({ default_active: 'always_off' })).toBe('always_off');
    });

    it('falls back to "remember" for unknown modes', () => {
        expect(getDefaultActiveMode({ default_active: 'banana' })).toBe('remember');
        expect(getDefaultActiveMode({ default_active: '' })).toBe('remember');
    });

    it('falls back to "remember" when the setting is absent', () => {
        expect(getDefaultActiveMode({})).toBe('remember');
        expect(getDefaultActiveMode(null)).toBe('remember');
        expect(getDefaultActiveMode(undefined)).toBe('remember');
    });
});

describe('resolveInitialActiveState', () => {
    it('always activates in always_on mode regardless of saved state', () => {
        expect(resolveInitialActiveState('always_on', false)).toBe(true);
        expect(resolveInitialActiveState('always_on', true)).toBe(true);
    });

    it('never activates in always_off mode regardless of saved state', () => {
        expect(resolveInitialActiveState('always_off', true)).toBe(false);
        expect(resolveInitialActiveState('always_off', false)).toBe(false);
    });

    it('defers to saved state in remember mode', () => {
        expect(resolveInitialActiveState('remember', true)).toBe(true);
        expect(resolveInitialActiveState('remember', false)).toBe(false);
    });

    it('coerces truthy/falsy saved states to booleans in remember mode', () => {
        expect(resolveInitialActiveState('remember', 'true')).toBe(true);
        expect(resolveInitialActiveState('remember', 0)).toBe(false);
        expect(resolveInitialActiveState('remember', null)).toBe(false);
        expect(resolveInitialActiveState('remember', undefined)).toBe(false);
    });
});
