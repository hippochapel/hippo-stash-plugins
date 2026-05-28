/**
 * Integration tests for GalleryMode plugin
 * Uses real functions exported from gallery.js
 */

describe('ImageGalleryMode', () => {
    const gallery = require('../gallery.js');

    const STORAGE_KEY = 'stash_plugin_gallery_settings';
    const GALLERY_LAYOUT_REFRESH_LATE_MS = 500;
    const EXTERNAL_SCRUBBER_SYNC_DELAY_MS = 60;

    function getSettings() {
        try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; }
        catch (e) { return {}; }
    }

    function saveSettings(newSettings) {
        const merged = { ...getSettings(), ...newSettings };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    }

    function parseScrubberPixelTransform(transform) {
        const match = (transform || '').match(/translateX\(([-\d.]+)px\)/);
        return match ? parseFloat(match[1]) : null;
    }

    // gallery.js stores controls inset as CSS custom property, not a dataset attribute.
    function getOverlayControlsInset(overlay) {
        const raw = overlay.style.getPropertyValue('--gallery-controls-offset');
        return raw ? parseFloat(raw) : undefined;
    }

    let lastWebSocket = null;
    let createdWebSockets = [];
    let fullscreenSpy = null;
    let fullscreenExitSpy = null;
    let orientationLockSpy = null;
    let orientationUnlockSpy = null;

    class MockWebSocket {
        constructor(url) {
            this.url = url;
            this.sentMessages = [];
            this.onopen = null;
            this.onmessage = null;
            this.onerror = null;
            this.onclose = null;
            this._closed = false;
            this.readyState = MockWebSocket.CONNECTING;
            lastWebSocket = this;
            createdWebSockets.push(this);
        }
        send(msg) { this.sentMessages.push(msg); }
        close() {
            if (!this._closed) {
                this._closed = true;
                this.readyState = MockWebSocket.CLOSED;
                if (this.onclose) this.onclose();
            }
        }
        _fireOpen() {
            if (this.readyState === MockWebSocket.OPEN) return;
            this.readyState = MockWebSocket.OPEN;
            if (this.onopen) this.onopen();
        }
        _fireMessage(data) { if (this.onmessage) this.onmessage({ data }); }
        _fireError() {
            if (this.onerror) this.onerror(new Event('error'));
            this.close();
        }
    }
    MockWebSocket.CONNECTING = 0;
    MockWebSocket.OPEN = 1;
    MockWebSocket.CLOSED = 3;

    function getLastSentMessage(socket = lastWebSocket) {
        return JSON.parse(socket.sentMessages.at(-1));
    }

    function setGalleryViewportSize(width, height) {
        Object.defineProperty(window, 'innerWidth', { value: width, configurable: true, writable: true });
        Object.defineProperty(window, 'innerHeight', { value: height, configurable: true, writable: true });
        Object.defineProperty(document.documentElement, 'clientWidth', { value: width, configurable: true });
        Object.defineProperty(document.documentElement, 'clientHeight', { value: height, configurable: true });
    }

    function setMobileGalleryLayout(matches, { coarse = matches } = {}) {
        window.matchMedia = jest.fn((query) => ({
            matches: query === '(max-width: 767px)'
                ? matches
                : query === '(hover: none) and (pointer: coarse)'
                    ? coarse
                    : false
        }));
    }

    // Creates a .video-js container with optional layout dimensions,
    // plus a video.vjs-tech element inside it (needed for getVideoContainer()).
    function makeContainer({
        containerTop = 0,
        containerHeight = 200,
        controlBarTop = null,
        controlBarHeight = 0,
        progressControlTop = null,
        progressControlHeight = 0
    } = {}) {
        const vc = document.createElement('div');
        vc.className = 'video-js';
        vc.style.position = 'relative';
        document.body.appendChild(vc);

        vc.getBoundingClientRect = () => ({
            width: 390,
            height: containerHeight,
            top: containerTop,
            right: 390,
            bottom: containerTop + containerHeight,
            left: 0,
            x: 0,
            y: containerTop,
            toJSON() { return this; }
        });

        // Add video.vjs-tech so getVideoContainer() can find it
        const video = document.createElement('video');
        video.className = 'vjs-tech';
        Object.defineProperty(video, 'paused', { value: true, writable: true, configurable: true });
        Object.defineProperty(video, 'seeking', { value: false, writable: true, configurable: true });
        video.currentTime = 0;
        video.pause = jest.fn(() => { video.paused = true; });
        video.play = jest.fn(() => { video.paused = false; });
        vc.appendChild(video);

        if (controlBarHeight > 0) {
            const controlBar = document.createElement('div');
            controlBar.className = 'vjs-control-bar';
            controlBar.style.height = `${controlBarHeight}px`;
            controlBar.getBoundingClientRect = () => ({
                width: 390,
                height: controlBarHeight,
                top: controlBarTop ?? (containerTop + containerHeight - controlBarHeight),
                right: 390,
                bottom: (controlBarTop ?? (containerTop + containerHeight - controlBarHeight)) + controlBarHeight,
                left: 0,
                x: 0,
                y: controlBarTop ?? (containerTop + containerHeight - controlBarHeight),
                toJSON() { return this; }
            });
            vc.appendChild(controlBar);
        }

        if (progressControlHeight > 0) {
            const progressControl = document.createElement('div');
            progressControl.className = 'vjs-progress-control';
            progressControl.getBoundingClientRect = () => ({
                width: 390,
                height: progressControlHeight,
                top: progressControlTop ?? (containerTop + containerHeight - progressControlHeight),
                right: 390,
                bottom: (progressControlTop ?? (containerTop + containerHeight - progressControlHeight)) + progressControlHeight,
                left: 0,
                x: 0,
                y: progressControlTop ?? (containerTop + containerHeight - progressControlHeight),
                toJSON() { return this; }
            });
            vc.appendChild(progressControl);
        }

        return vc;
    }

    // Creates a plain .video-js player for tests that just need showGalleryAtTime/showGalleryFrame.
    function makePlayer() {
        const videoContainer = makeContainer();
        const player = videoContainer.querySelector('video.vjs-tech');
        Object.defineProperty(player, 'duration', { value: 180, writable: true, configurable: true });
        return { player, videoContainer };
    }

    function makeVideoJsPlayer() {
        const videoContainer = document.createElement('div');
        videoContainer.className = 'video-js';
        videoContainer.style.position = 'relative';
        document.body.appendChild(videoContainer);

        const player = document.createElement('video');
        player.className = 'vjs-tech';
        Object.defineProperty(player, 'paused', { value: true, writable: true, configurable: true });
        Object.defineProperty(player, 'seeking', { value: false, writable: true, configurable: true });
        Object.defineProperty(player, 'duration', { value: 180, writable: true, configurable: true });
        player.currentTime = 0;
        videoContainer.appendChild(player);

        const listeners = new Map();
        const api = {
            _time: 0,
            currentTime: jest.fn((value) => {
                if (value === undefined) return api._time;
                api._time = value;
                player.currentTime = value;
                return api._time;
            }),
            pause: jest.fn(() => { player.paused = true; }),
            play: jest.fn(() => { player.paused = false; }),
            paused: jest.fn(() => player.paused),
            on: jest.fn((eventName, handler) => {
                if (!listeners.has(eventName)) listeners.set(eventName, new Set());
                listeners.get(eventName).add(handler);
            }),
            off: jest.fn((eventName, handler) => {
                listeners.get(eventName)?.delete(handler);
            }),
            trigger: jest.fn((eventName) => {
                listeners.get(eventName)?.forEach((handler) => handler());
            }),
            emit(eventName) {
                listeners.get(eventName)?.forEach((handler) => handler());
            }
        };

        videoContainer.player = api;
        return { player, videoContainer, api };
    }

    function makeGalleryTouch(identifier, clientX, clientY) {
        return { identifier, clientX, clientY };
    }

    function createGalleryTouchEvent(type, touches = [], changedTouches = touches) {
        const event = new Event(type, { bubbles: true, cancelable: true });
        Object.defineProperty(event, 'touches', { value: touches, configurable: true });
        Object.defineProperty(event, 'changedTouches', { value: changedTouches, configurable: true });
        event.preventDefault = jest.fn();
        event.stopPropagation = jest.fn();
        return event;
    }

    function mockGalleryImageLayout({ frameWidth = 320, frameHeight = 180, imageWidth = 240, imageHeight = 135 } = {}) {
        const frame = document.getElementById('sprite-gallery-frame');
        const media = gallery.getActiveGalleryMediaElement() || document.getElementById('sprite-gallery-img');
        if (!frame || !media) throw new Error('Gallery frame not ready');

        frame.getBoundingClientRect = () => ({
            width: frameWidth,
            height: frameHeight,
            top: 0,
            left: 0,
            right: frameWidth,
            bottom: frameHeight,
            x: 0,
            y: 0,
            toJSON() { return this; }
        });
        media.getBoundingClientRect = () => ({
            width: imageWidth,
            height: imageHeight,
            top: (frameHeight - imageHeight) / 2,
            left: (frameWidth - imageWidth) / 2,
            right: (frameWidth + imageWidth) / 2,
            bottom: (frameHeight + imageHeight) / 2,
            x: (frameWidth - imageWidth) / 2,
            y: (frameHeight - imageHeight) / 2,
            toJSON() { return this; }
        });
        Object.defineProperty(media, 'clientWidth', { value: imageWidth, configurable: true });
        Object.defineProperty(media, 'clientHeight', { value: imageHeight, configurable: true });
    }

    function setPlayerReadyState(player, readyState) {
        Object.defineProperty(player, 'readyState', { value: readyState, writable: true, configurable: true });
    }

    async function resolveGalleryVideoFrame(player) {
        player.readyState = HTMLMediaElement.HAVE_METADATA;
        player.dispatchEvent(new Event('loadedmetadata'));
        player.readyState = HTMLMediaElement.HAVE_CURRENT_DATA;
        player.dispatchEvent(new Event('loadeddata'));
        await Promise.resolve();
    }

    // After showGalleryFrame creates the overlay, set requestFullscreen on the frame element.
    // The spy also sets document.fullscreenElement so syncGalleryFullscreenState detects fullscreen.
    function setupFullscreenSpy() {
        const frame = document.getElementById('sprite-gallery-frame');
        if (!frame) return;
        frame.requestFullscreen = jest.fn(() => {
            document.fullscreenElement = frame;
            return fullscreenSpy();
        });
    }

    beforeEach(() => {
        // Stop any running sync loop before resetting state (prevents stale intervals firing).
        gallery.stopGallerySyncLoop();
        gallery._resetState();
        gallery.clearGalleryOverlayLayoutRefresh();
        document.body.innerHTML = '';
        localStorage.clear();
        lastWebSocket = null;
        createdWebSockets = [];
        setGalleryViewportSize(1280, 720);
        setMobileGalleryLayout(false);
        Object.defineProperty(navigator, 'maxTouchPoints', { value: 0, configurable: true });
        fullscreenSpy = jest.fn(() => Promise.resolve());
        fullscreenExitSpy = jest.fn(() => {
            document.fullscreenElement = null;
            return Promise.resolve();
        });
        orientationLockSpy = jest.fn(() => Promise.resolve());
        orientationUnlockSpy = jest.fn();
        Object.defineProperty(document, 'fullscreenElement', { value: null, writable: true, configurable: true });
        document.exitFullscreen = fullscreenExitSpy;
        Object.defineProperty(window, 'screen', {
            value: { orientation: { lock: orientationLockSpy, unlock: orientationUnlockSpy } },
            configurable: true
        });
        global.WebSocket = MockWebSocket;
        gallery._applyState({
            currentSceneId: '123',
            currentSceneData: { id: '123', duration: 180, paths: { sprite: '/sprite.jpg' } },
            pluginSettings: {
                lb_frame_server_port: 9876,
                lb_frame_server_host: '',
                lb_prefetch_enabled: false,
                lb_prefetch_offsets_seconds: '5',
                lb_prefetch_window_seconds: 30,
                lb_enabled: true,
            }
        });
    });

    it('gallery mode off (default): clicking calls seekToTime, no overlay created', () => {
        const mockSeek = jest.fn();
        const mockShowGallery = jest.fn();

        const handleClick = () => {
            if (gallery.isGalleryModeOn()) {
                mockShowGallery();
            } else {
                mockSeek();
            }
        };

        handleClick();

        expect(mockSeek).toHaveBeenCalled();
        expect(mockShowGallery).not.toHaveBeenCalled();
        expect(document.getElementById('sprite-gallery-overlay')).toBeNull();
    });

    it('seeks sprite clicks to the selected sprite timestamp', () => {
        const duration = 596.46;
        const totalSprites = 81;
        const index = 3;

        const seekTime = gallery.getSpriteSelectionTime(index, totalSprites, duration);

        expect(seekTime).toBeCloseTo((index / totalSprites) * duration, 6);
        expect(gallery.getSpriteIndexAtTime(seekTime, duration, totalSprites)).toBe(index);
    });

    it('maps the last sprite timestamp back to the last sprite index', () => {
        const duration = 596.46;
        const totalSprites = 81;
        const lastIndex = totalSprites - 1;

        const seekTime = gallery.getSpriteSelectionTime(lastIndex, totalSprites, duration);

        expect(gallery.getSpriteIndexAtTime(seekTime, duration, totalSprites)).toBe(lastIndex);
    });

    it('fetches frame via WebSocket and displays it in the overlay', async () => {
        makeVideoJsPlayer();
        const p = gallery.showGalleryFrame(30, '0:30');
        lastWebSocket._fireOpen();
        lastWebSocket._fireMessage(new Blob(['jpeg'], { type: 'image/jpeg' }));
        await p;

        const overlay = document.getElementById('sprite-gallery-overlay');
        expect(overlay).not.toBeNull();
        expect(overlay.style.display).toBe('flex');
        expect(document.getElementById('sprite-gallery-time').textContent).toBe('0:30');
        expect(document.getElementById('sprite-gallery-img').src).toMatch(/^data:/);
        expect(document.getElementById('sprite-gallery-img').style.display).toBe('block');
        expect(document.getElementById('sprite-gallery-scrubber')).not.toBeNull();
        expect(document.getElementById('sprite-gallery-scrubber').style.display).toBe('none');
        expect(document.getElementById('sprite-gallery-open')).toBeNull();
        expect(document.getElementById('sprite-gallery-fullscreen').disabled).toBe(false);
    });

    it('shows controls on desktop hover and hides them on mouseleave', async () => {
        makeVideoJsPlayer();
        const p = gallery.showGalleryFrame(30, '0:30');
        lastWebSocket._fireOpen();
        lastWebSocket._fireMessage(new Blob(['jpeg'], { type: 'image/jpeg' }));
        await p;

        const frame = document.getElementById('sprite-gallery-frame');
        const controls = document.getElementById('sprite-gallery-controls');

        expect(controls.dataset.visible).toBe('false');

        frame.dispatchEvent(new MouseEvent('mouseenter'));
        expect(controls.dataset.visible).toBe('true');

        frame.dispatchEvent(new MouseEvent('mouseleave'));
        expect(controls.dataset.visible).toBe('false');
    });

    it('toggles controls on mobile image tap', async () => {
        setMobileGalleryLayout(true);

        makeVideoJsPlayer();
        const p = gallery.showGalleryFrame(30, '0:30');
        lastWebSocket._fireOpen();
        lastWebSocket._fireMessage(new Blob(['jpeg'], { type: 'image/jpeg' }));
        await p;

        const controls = document.getElementById('sprite-gallery-controls');
        const img = document.getElementById('sprite-gallery-img');
        const scrubber = document.getElementById('sprite-gallery-scrubber');

        expect(controls.dataset.visible).toBe('true');
        expect(scrubber.style.display).toBe('block');

        img.click();
        expect(controls.dataset.visible).toBe('false');

        img.click();
        expect(controls.dataset.visible).toBe('true');
    });

    it('pinches the mobile gallery image without toggling controls', async () => {
        setMobileGalleryLayout(true);

        makeVideoJsPlayer();
        const p = gallery.showGalleryFrame(30, '0:30');
        lastWebSocket._fireOpen();
        lastWebSocket._fireMessage(new Blob(['jpeg'], { type: 'image/jpeg' }));
        await p;

        mockGalleryImageLayout();

        const frame = document.getElementById('sprite-gallery-frame');
        const viewport = document.getElementById('sprite-gallery-viewport');
        const controls = document.getElementById('sprite-gallery-controls');
        const img = document.getElementById('sprite-gallery-img');

        const pinchStart = createGalleryTouchEvent('touchstart', [
            makeGalleryTouch(1, 100, 90),
            makeGalleryTouch(2, 220, 90)
        ]);
        viewport.ontouchstart(pinchStart);

        const pinchMove = createGalleryTouchEvent('touchmove', [
            makeGalleryTouch(1, 70, 90),
            makeGalleryTouch(2, 250, 90)
        ]);
        viewport.ontouchmove(pinchMove);

        expect(pinchStart.preventDefault).toHaveBeenCalled();
        expect(pinchMove.preventDefault).toHaveBeenCalled();
        expect(parseFloat(img.dataset.zoomScale)).toBeGreaterThan(1.4);

        frame.click();
        expect(controls.dataset.visible).toBe('true');
    });

    it('pans a zoomed mobile gallery image with one finger', async () => {
        setMobileGalleryLayout(true);

        makeVideoJsPlayer();
        const p = gallery.showGalleryFrame(30, '0:30');
        lastWebSocket._fireOpen();
        lastWebSocket._fireMessage(new Blob(['jpeg'], { type: 'image/jpeg' }));
        await p;

        mockGalleryImageLayout();

        const viewport = document.getElementById('sprite-gallery-viewport');
        const img = document.getElementById('sprite-gallery-img');

        viewport.ontouchstart(createGalleryTouchEvent('touchstart', [
            makeGalleryTouch(1, 100, 90),
            makeGalleryTouch(2, 220, 90)
        ]));
        viewport.ontouchmove(createGalleryTouchEvent('touchmove', [
            makeGalleryTouch(1, 70, 90),
            makeGalleryTouch(2, 250, 90)
        ]));
        viewport.ontouchend(createGalleryTouchEvent('touchend', []));

        const zoomScale = parseFloat(img.dataset.zoomScale);
        expect(zoomScale).toBeGreaterThan(1.4);

        const panStart = createGalleryTouchEvent('touchstart', [
            makeGalleryTouch(3, 150, 90)
        ]);
        viewport.ontouchstart(panStart);

        const panMove = createGalleryTouchEvent('touchmove', [
            makeGalleryTouch(3, 190, 90)
        ]);
        viewport.ontouchmove(panMove);

        expect(panStart.preventDefault).not.toHaveBeenCalled();
        expect(panMove.preventDefault).toHaveBeenCalled();
        expect(parseFloat(img.dataset.zoomScale)).toBeCloseTo(zoomScale, 3);
        expect(parseFloat(img.dataset.panX)).toBeGreaterThan(0);
    });

    it('allows a tap to show controls after the image is zoomed', async () => {
        setMobileGalleryLayout(true);

        makeVideoJsPlayer();
        const p = gallery.showGalleryFrame(30, '0:30');
        lastWebSocket._fireOpen();
        lastWebSocket._fireMessage(new Blob(['jpeg'], { type: 'image/jpeg' }));
        await p;

        mockGalleryImageLayout();

        const frame = document.getElementById('sprite-gallery-frame');
        const viewport = document.getElementById('sprite-gallery-viewport');
        const controls = document.getElementById('sprite-gallery-controls');

        viewport.ontouchstart(createGalleryTouchEvent('touchstart', [
            makeGalleryTouch(1, 100, 90),
            makeGalleryTouch(2, 220, 90)
        ]));
        viewport.ontouchmove(createGalleryTouchEvent('touchmove', [
            makeGalleryTouch(1, 70, 90),
            makeGalleryTouch(2, 250, 90)
        ]));
        viewport.ontouchend(createGalleryTouchEvent('touchend', []));

        gallery.setGalleryControlsVisible(false);

        const tapStart = createGalleryTouchEvent('touchstart', [
            makeGalleryTouch(3, 150, 90)
        ]);
        viewport.ontouchstart(tapStart);
        viewport.ontouchend(createGalleryTouchEvent('touchend', []));
        frame.click();

        expect(tapStart.preventDefault).not.toHaveBeenCalled();
        expect(controls.dataset.visible).toBe('true');
    });

    it('resets zoom and pan when loading the next gallery frame', async () => {
        setMobileGalleryLayout(true);

        makeVideoJsPlayer();
        const firstFrame = gallery.showGalleryFrame(30, '0:30');
        lastWebSocket._fireOpen();
        lastWebSocket._fireMessage(new Blob(['jpeg'], { type: 'image/jpeg' }));
        await firstFrame;

        mockGalleryImageLayout();

        const viewport = document.getElementById('sprite-gallery-viewport');
        const img = document.getElementById('sprite-gallery-img');

        viewport.ontouchstart(createGalleryTouchEvent('touchstart', [
            makeGalleryTouch(1, 100, 90),
            makeGalleryTouch(2, 220, 90)
        ]));
        viewport.ontouchmove(createGalleryTouchEvent('touchmove', [
            makeGalleryTouch(1, 70, 90),
            makeGalleryTouch(2, 250, 90)
        ]));
        viewport.ontouchend(createGalleryTouchEvent('touchend', []));
        viewport.ontouchstart(createGalleryTouchEvent('touchstart', [
            makeGalleryTouch(3, 150, 90)
        ]));
        viewport.ontouchmove(createGalleryTouchEvent('touchmove', [
            makeGalleryTouch(3, 190, 90)
        ]));

        expect(parseFloat(img.dataset.zoomScale)).toBeGreaterThan(1.4);
        expect(parseFloat(img.dataset.panX)).toBeGreaterThan(0);

        const nextFrame = gallery.showGalleryFrame(60, '1:00');
        lastWebSocket._fireMessage(new Blob(['jpeg'], { type: 'image/jpeg' }));
        await nextFrame;

        expect(img.dataset.zoomScale).toBe('1.000');
        expect(img.dataset.panX).toBe('0.0');
        expect(img.dataset.panY).toBe('0.0');
        expect(document.getElementById('sprite-gallery-viewport').dataset.zoomed).toBe('false');
    });

    it('toggles controls on mobile while a new frame is still loading', async () => {
        setMobileGalleryLayout(true);
        makePlayer();

        const p = gallery.showGalleryAtTime(30);
        lastWebSocket._fireOpen();
        lastWebSocket._fireMessage(new Blob(['jpeg'], { type: 'image/jpeg' }));
        await p;

        const frame = document.getElementById('sprite-gallery-frame');
        const controls = document.getElementById('sprite-gallery-controls');
        frame.click();
        expect(controls.dataset.visible).toBe('false');

        document.getElementById('sprite-gallery-forward-1').click();
        expect(document.getElementById('sprite-gallery-loading').style.display).toBe('block');

        frame.click();
        expect(controls.dataset.visible).toBe('true');
    });

    it('does not toggle mobile controls when tapping an actual control button', async () => {
        setMobileGalleryLayout(true);

        makeVideoJsPlayer();
        const p = gallery.showGalleryFrame(30, '0:30');
        lastWebSocket._fireOpen();
        lastWebSocket._fireMessage(new Blob(['jpeg'], { type: 'image/jpeg' }));
        await p;

        setupFullscreenSpy();

        const controls = document.getElementById('sprite-gallery-controls');
        const fullscreenButton = document.getElementById('sprite-gallery-fullscreen');

        fullscreenButton.click();
        expect(controls.dataset.visible).toBe('true');
    });

    it('allows tapping empty control-row space to toggle mobile controls', async () => {
        setMobileGalleryLayout(true);

        makeVideoJsPlayer();
        const p = gallery.showGalleryFrame(30, '0:30');
        lastWebSocket._fireOpen();
        lastWebSocket._fireMessage(new Blob(['jpeg'], { type: 'image/jpeg' }));
        await p;

        const controls = document.getElementById('sprite-gallery-controls');
        const topRow = controls.querySelector('.sprite-gallery-controls-row.top');

        topRow.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(controls.dataset.visible).toBe('false');
    });

    it('opening gallery from a sprite pauses the player and seeks to the selected time', async () => {
        const { player } = makePlayer();
        player.currentTime = 5;
        player.paused = false;

        gallery._applyState({ currentSceneId: '99' });
        const p = gallery.showGalleryAtTime(42.5);
        lastWebSocket._fireOpen();
        lastWebSocket._fireMessage(new Blob(['jpeg'], { type: 'image/jpeg' }));
        await p;

        expect(player.pause).toHaveBeenCalled();
        expect(player.currentTime).toBe(42.5);
        expect(document.getElementById('sprite-gallery-time').textContent).toBe('0:42');
        expect(JSON.parse(lastWebSocket.sentMessages[0])).toMatchObject({ scene_id: '99', t: 42.5 });
    });

    it('uses the enclosing player API when seeking so the visible scrubber stays in sync', async () => {
        const { player, api } = makeVideoJsPlayer();
        player.paused = false;
        const timeUpdateSpy = jest.fn();
        player.addEventListener('timeupdate', timeUpdateSpy);

        const p = gallery.showGalleryAtTime(84);
        lastWebSocket._fireOpen();
        lastWebSocket._fireMessage(new Blob(['jpeg'], { type: 'image/jpeg' }));
        await p;

        expect(api.pause).toHaveBeenCalled();
        expect(api.currentTime).toHaveBeenCalledWith(84);
        expect(api.trigger).toHaveBeenCalledWith('timeupdate');
        expect(player.currentTime).toBe(84);
        expect(timeUpdateSpy).toHaveBeenCalled();
        expect(document.getElementById('sprite-gallery-time').textContent).toBe('1:24');
    });

    it('sent message contains correct scene_id and timestamp', async () => {
        gallery._applyState({ currentSceneId: '99' });
        makeVideoJsPlayer();
        const p = gallery.showGalleryFrame(42.5, '0:42');
        lastWebSocket._fireOpen();
        lastWebSocket._fireMessage(new Blob(['jpeg'], { type: 'image/jpeg' }));
        await p;

        const msg = JSON.parse(lastWebSocket.sentMessages[0]);
        expect(msg.scene_id).toBe('99');
        expect(msg.t).toBe(42.5);
    });

    it('does not clamp frame request timestamps to the gallery duration metadata', async () => {
        gallery._applyState({
            currentSceneId: '99',
            currentSceneData: { id: '99', duration: 10, paths: { sprite: '/sprite.jpg' } }
        });
        makeVideoJsPlayer();
        const p = gallery.showGalleryFrame(42.5, '0:42');
        lastWebSocket._fireOpen();
        lastWebSocket._fireMessage(new Blob(['jpeg'], { type: 'image/jpeg' }));
        await p;

        const msg = JSON.parse(lastWebSocket.sentMessages[0]);
        expect(msg.t).toBe(42.5);
    });

    it('overlay has a close button that removes the overlay', async () => {
        const { player } = makePlayer();
        const p = gallery.showGalleryAtTime(10);
        lastWebSocket._fireOpen();
        lastWebSocket._fireMessage(new Blob(['jpeg'], { type: 'image/jpeg' }));
        await p;

        expect(document.getElementById('sprite-gallery-overlay')).not.toBeNull();
        document.getElementById('sprite-gallery-close').click();

        expect(document.getElementById('sprite-gallery-overlay')).toBeNull();
    });

    it('clicking another sprite while gallery is active reuses existing overlay', async () => {
        const { player } = makePlayer();
        const p1 = gallery.showGalleryAtTime(10);
        lastWebSocket._fireOpen();
        lastWebSocket._fireMessage(new Blob(['jpeg'], { type: 'image/jpeg' }));
        await p1;
        const firstOverlay = document.getElementById('sprite-gallery-overlay');

        const p2 = gallery.showGalleryAtTime(60);
        lastWebSocket._fireOpen();
        lastWebSocket._fireMessage(new Blob(['jpeg'], { type: 'image/jpeg' }));
        await p2;

        expect(document.getElementById('sprite-gallery-overlay')).toBe(firstOverlay);
        expect(document.querySelectorAll('#sprite-gallery-overlay').length).toBe(1);
        expect(document.getElementById('sprite-gallery-time').textContent).toBe('1:00');
    });

    it('scrubbing the native player timeline updates the gallery frame after seek completes', async () => {
        const { player } = makePlayer();
        const p1 = gallery.showGalleryAtTime(10);
        lastWebSocket._fireOpen();
        lastWebSocket._fireMessage(new Blob(['jpeg'], { type: 'image/jpeg' }));
        await p1;

        player.currentTime = 75;
        player.paused = false;
        player.dispatchEvent(new Event('seeked'));

        const followupSocket = lastWebSocket;
        followupSocket._fireMessage(new Blob(['jpeg'], { type: 'image/jpeg' }));
        await Promise.resolve();

        expect(player.pause).toHaveBeenCalledTimes(2);
        expect(getLastSentMessage(followupSocket).t).toBe(75);
        expect(document.getElementById('sprite-gallery-time').textContent).toBe('1:15');
    });

    it('shows loading immediately when scrubbing starts before the next frame request finishes', async () => {
        const { player } = makePlayer();
        const p1 = gallery.showGalleryAtTime(10);
        lastWebSocket._fireOpen();
        lastWebSocket._fireMessage(new Blob(['jpeg'], { type: 'image/jpeg' }));
        await p1;

        const currentImgSrc = document.getElementById('sprite-gallery-img').src;

        player.currentTime = 33;
        player.seeking = true;
        player.dispatchEvent(new Event('seeking'));

        expect(document.getElementById('sprite-gallery-loading').style.display).toBe('block');
        expect(document.getElementById('sprite-gallery-loading').textContent).toBe('Loading\u2026');
        expect(document.getElementById('sprite-gallery-time').textContent).toBe('0:33');
        expect(document.getElementById('sprite-gallery-img').src).toBe(currentImgSrc);

        player.seeking = false;
        player.dispatchEvent(new Event('seeked'));
        lastWebSocket._fireMessage(new Blob(['jpeg'], { type: 'image/jpeg' }));
        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(getLastSentMessage().t).toBe(33);
    });

    it('scrubber seeks to the requested timestamp', async () => {
        const { player } = makePlayer();
        const p1 = gallery.showGalleryAtTime(10);
        lastWebSocket._fireOpen();
        lastWebSocket._fireMessage(new Blob(['jpeg'], { type: 'image/jpeg' }));
        await p1;

        const scrubber = document.getElementById('sprite-gallery-scrubber');
        scrubber.value = '44.5';
        scrubber.dispatchEvent(new Event('input', { bubbles: true }));

        expect(player.currentTime).toBe(44.5);

        lastWebSocket._fireMessage(new Blob(['jpeg'], { type: 'image/jpeg' }));
        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(getLastSentMessage().t).toBe(44.5);
        expect(document.getElementById('sprite-gallery-time').textContent).toBe('0:44');
    });

    it('jump buttons seek backward and forward and clamp to valid bounds', async () => {
        const { player } = makePlayer();
        gallery._applyState({ currentSceneData: { id: '123', duration: 62, paths: { sprite: '/sprite.jpg' } } });

        const p1 = gallery.showGalleryAtTime(60);
        lastWebSocket._fireOpen();
        lastWebSocket._fireMessage(new Blob(['jpeg'], { type: 'image/jpeg' }));
        await p1;

        document.getElementById('sprite-gallery-forward-5').click();
        lastWebSocket._fireMessage(new Blob(['jpeg'], { type: 'image/jpeg' }));
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(getLastSentMessage().t).toBe(62);

        const p2 = gallery.showGalleryAtTime(1);
        lastWebSocket._fireOpen();
        lastWebSocket._fireMessage(new Blob(['jpeg'], { type: 'image/jpeg' }));
        await p2;

        document.getElementById('sprite-gallery-back-5').click();
        lastWebSocket._fireMessage(new Blob(['jpeg'], { type: 'image/jpeg' }));
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(getLastSentMessage().t).toBe(0);
    });

    it('jump buttons use exact offsets even when a sprite grid is present', async () => {
        const { player } = makePlayer();
        gallery._applyState({ currentSceneData: { id: '123', duration: 180, paths: { sprite: '/sprite.jpg' } } });

        // Create a sprite grid with 10s intervals (18 sprites over 180s).
        // Jump controls should not snap to the sprite grid the way scrubber selection does.
        const grid = document.createElement('div');
        grid.id = 'stash-sprite-grid';
        for (let i = 0; i < 18; i++) {
            const cell = document.createElement('div');
            cell.className = 'sprite-cell';
            grid.appendChild(cell);
        }
        document.body.appendChild(grid);

        const p = gallery.showGalleryAtTime(29.5);
        lastWebSocket._fireOpen();
        lastWebSocket._fireMessage(new Blob(['jpeg'], { type: 'image/jpeg' }));
        await p;

        document.getElementById('sprite-gallery-forward-0_5').click();
        lastWebSocket._fireMessage(new Blob(['jpeg'], { type: 'image/jpeg' }));
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(getLastSentMessage().t).toBe(30);

        document.getElementById('sprite-gallery-forward-1').click();
        lastWebSocket._fireMessage(new Blob(['jpeg'], { type: 'image/jpeg' }));
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(getLastSentMessage().t).toBe(31);

        document.getElementById('sprite-gallery-forward-5').click();
        lastWebSocket._fireMessage(new Blob(['jpeg'], { type: 'image/jpeg' }));
        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(getLastSentMessage().t).toBe(36);

        grid.remove();
    });

    it('keeps low-bandwidth forward jumps anchored to the requested gallery target when player sync reports a stale time', async () => {
        const { player } = makePlayer();

        const p = gallery.showGalleryAtTime(102);
        lastWebSocket._fireOpen();
        lastWebSocket._fireMessage(new Blob(['jpeg-initial'], { type: 'image/jpeg' }));
        await p;

        const socket = lastWebSocket;

        document.getElementById('sprite-gallery-forward-0_5').click();
        await Promise.resolve();
        const halfSecondRequest = getLastSentMessage(socket);
        expect(halfSecondRequest.t).toBe(102.5);

        const sentCountAfterHalfSecondJump = socket.sentMessages.length;
        player.currentTime = 102;
        player.seeking = true;
        player.dispatchEvent(new Event('seeking'));
        player.seeking = false;
        player.dispatchEvent(new Event('seeked'));
        await Promise.resolve();

        expect(socket.sentMessages).toHaveLength(sentCountAfterHalfSecondJump);
        expect(getLastSentMessage(socket).t).toBe(102.5);

        document.getElementById('sprite-gallery-forward-1').click();
        await Promise.resolve();
        const oneSecondRequest = getLastSentMessage(socket);
        expect(oneSecondRequest.request_id).not.toBe(halfSecondRequest.request_id);
        expect(oneSecondRequest.t).toBe(103.5);

        socket._fireMessage(JSON.stringify({
            type: 'frame_result',
            request_id: halfSecondRequest.request_id,
            t: 102.5,
            ok: true,
            image: 'stale-half-second'
        }));
        socket._fireMessage(JSON.stringify({
            type: 'frame_result',
            request_id: oneSecondRequest.request_id,
            t: 103.5,
            ok: true,
            image: 'fresh-one-second'
        }));
        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(document.getElementById('sprite-gallery-time').textContent).toBe('1:43');
        expect(document.getElementById('sprite-gallery-img').src.startsWith('data:')).toBe(true);
    });

    it('jump buttons use exact offsets when no sprite grid is present', async () => {
        const { player } = makePlayer();

        // No sprite grid in DOM: getGallerySpriteAlignedTime falls back to clampGalleryTime,
        // so jump buttons use exact deltas without sprite snapping.
        const p = gallery.showGalleryAtTime(0);
        lastWebSocket._fireOpen();
        lastWebSocket._fireMessage(new Blob(['jpeg'], { type: 'image/jpeg' }));
        await p;

        document.getElementById('sprite-gallery-forward-5').click();
        lastWebSocket._fireMessage(new Blob(['jpeg'], { type: 'image/jpeg' }));
        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(getLastSentMessage().t).toBe(5);
    });

    it('includes a 30 second forward jump button', async () => {
        const { player } = makePlayer();
        gallery._applyState({ currentSceneData: { id: '123', duration: 90, paths: { sprite: '/sprite.jpg' } } });

        const p = gallery.showGalleryAtTime(20);
        lastWebSocket._fireOpen();
        lastWebSocket._fireMessage(new Blob(['jpeg'], { type: 'image/jpeg' }));
        await p;

        const forwardThirty = document.getElementById('sprite-gallery-forward-30');
        expect(forwardThirty).not.toBeNull();
        expect(forwardThirty.textContent).toBe('30s');

        forwardThirty.click();
        lastWebSocket._fireMessage(new Blob(['jpeg'], { type: 'image/jpeg' }));
        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(getLastSentMessage().t).toBe(50);
    });

    it('includes a 30 second backward jump button', async () => {
        const { player } = makePlayer();
        gallery._applyState({ currentSceneData: { id: '123', duration: 90, paths: { sprite: '/sprite.jpg' } } });

        const p = gallery.showGalleryAtTime(50);
        lastWebSocket._fireOpen();
        lastWebSocket._fireMessage(new Blob(['jpeg'], { type: 'image/jpeg' }));
        await p;

        const backThirty = document.getElementById('sprite-gallery-back-30');
        expect(backThirty).not.toBeNull();
        expect(backThirty.textContent).toBe('<30s');

        backThirty.click();
        lastWebSocket._fireMessage(new Blob(['jpeg'], { type: 'image/jpeg' }));
        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(getLastSentMessage().t).toBe(20);
    });

    it('marks jump buttons as cached when background prefetch fills their target frame', async () => {
        gallery._applyState({
            pluginSettings: {
                lb_prefetch_enabled: true,
                lb_prefetch_offsets_seconds: '0.5,1,5',
                lb_prefetch_window_seconds: 10,
            }
        });
        const { player } = makePlayer();

        const p = gallery.showGalleryAtTime(0);
        lastWebSocket._fireOpen();
        lastWebSocket._fireMessage(new Blob(['current'], { type: 'image/jpeg' }));
        await p;

        const forwardHalf = document.getElementById('sprite-gallery-forward-0_5');
        const forwardOne = document.getElementById('sprite-gallery-forward-1');
        const forwardFive = document.getElementById('sprite-gallery-forward-5');
        expect(forwardHalf.dataset.cached).toBe('false');
        expect(forwardOne.dataset.cached).toBe('false');
        expect(forwardFive.dataset.cached).toBe('false');

        await new Promise((resolve) => setTimeout(resolve, 0));
        const batchRequest = getLastSentMessage();
        expect(batchRequest.type).toBe('prefetch_batch');
        lastWebSocket._fireMessage(JSON.stringify({
            type: 'frame_result',
            request_id: batchRequest.request_id,
            t: 0.5,
            ok: true,
            image: 'prefetch-0.5'
        }));
        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(forwardHalf.dataset.cached).toBe('true');
        expect(forwardOne.dataset.cached).toBe('false');
        expect(forwardFive.dataset.cached).toBe('false');

        [1, 5].forEach((time) => {
            lastWebSocket._fireMessage(JSON.stringify({
                type: 'frame_result',
                request_id: batchRequest.request_id,
                t: time,
                ok: true,
                image: `prefetch-${time}`
            }));
        });
        lastWebSocket._fireMessage(JSON.stringify({
            type: 'batch_done',
            request_id: batchRequest.request_id
        }));
        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(forwardHalf.dataset.cached).toBe('true');
        expect(forwardOne.dataset.cached).toBe('true');
        expect(forwardFive.dataset.cached).toBe('true');
        expect(forwardFive.classList.contains('sprite-gallery-jump-btn-cached')).toBe(true);
    });

    it('prefetches visible forward controls before backward controls and later multiples', async () => {
        gallery._applyState({
            pluginSettings: {
                lb_prefetch_enabled: true,
                lb_prefetch_offsets_seconds: '0.5,1,5',
                lb_prefetch_window_seconds: 30,
            }
        });
        const { player } = makePlayer();

        const p = gallery.showGalleryAtTime(30);
        lastWebSocket._fireOpen();
        lastWebSocket._fireMessage(new Blob(['current'], { type: 'image/jpeg' }));
        await p;

        await new Promise((resolve) => setTimeout(resolve, 0));
        const batchRequest = getLastSentMessage();
        expect(batchRequest.type).toBe('prefetch_batch');
        expect(batchRequest.times).toEqual([30.5, 31, 35, 60, 29.5, 29, 25, 0]);
    });

    it('shows queue and pending request details in the gallery debug panel', async () => {
        gallery._applyState({
            pluginSettings: {
                lb_prefetch_enabled: true,
                lb_prefetch_offsets_seconds: '1,5',
                lb_prefetch_window_seconds: 10,
                general_show_debug_panel: true,
            }
        });
        const { player } = makePlayer();

        const p = gallery.showGalleryAtTime(30);
        lastWebSocket._fireOpen();
        lastWebSocket._fireMessage(new Blob(['current'], { type: 'image/jpeg' }));
        await p;

        await new Promise((resolve) => setTimeout(resolve, 0));
        const debugOutput = document.getElementById('sprite-gallery-debug-output');
        expect(debugOutput).not.toBeNull();
        expect(debugOutput.textContent).toContain('center: 0:30');
        expect(debugOutput.textContent).toContain('pending prefetch batches: prefetch-2');
        expect(debugOutput.textContent).toContain('queue(');

        document.getElementById('sprite-gallery-forward-1').click();
        const forwardRequest = lastWebSocket.sentMessages
            .map((message) => JSON.parse(message))
            .reverse()
            .find((message) => message.type === 'frame');
        lastWebSocket._fireMessage(JSON.stringify({
            type: 'frame_result',
            request_id: forwardRequest.request_id,
            t: 31,
            ok: true,
            image: 'forward-31'
        }));
        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(debugOutput.textContent).toContain('center: 0:31');
        expect(debugOutput.textContent).toContain('pending frame requests:');
    });

    it('keeps the gallery debug panel hidden by default', async () => {
        const { player } = makePlayer();

        const p = gallery.showGalleryAtTime(30);
        lastWebSocket._fireOpen();
        lastWebSocket._fireMessage(new Blob(['current'], { type: 'image/jpeg' }));
        await p;

        expect(document.getElementById('sprite-gallery-debug').hidden).toBe(true);
    });

    it('uses a cached jump target immediately without opening another foreground socket', async () => {
        gallery._applyState({
            pluginSettings: {
                lb_prefetch_enabled: true,
                lb_prefetch_offsets_seconds: '5',
                lb_prefetch_window_seconds: 10,
            }
        });
        const { player } = makePlayer();

        const p = gallery.showGalleryAtTime(0);
        lastWebSocket._fireOpen();
        lastWebSocket._fireMessage(new Blob(['current'], { type: 'image/jpeg' }));
        await p;

        await new Promise((resolve) => setTimeout(resolve, 0));
        const batchRequest = getLastSentMessage();
        lastWebSocket._fireMessage(JSON.stringify({
            type: 'frame_result',
            request_id: batchRequest.request_id,
            t: 5,
            ok: true,
            image: 'prefetch-5'
        }));
        lastWebSocket._fireMessage(JSON.stringify({
            type: 'batch_done',
            request_id: batchRequest.request_id
        }));
        await new Promise((resolve) => setTimeout(resolve, 10));

        gallery._applyState({ pluginSettings: { lb_prefetch_enabled: false } });
        const socketCountBeforeJump = createdWebSockets.length;
        document.getElementById('sprite-gallery-forward-5').click();

        expect(createdWebSockets).toHaveLength(socketCountBeforeJump);
        expect(document.getElementById('sprite-gallery-time').textContent).toBe('0:05');
        expect(document.getElementById('sprite-gallery-img').src).toMatch(/^data:/);
    });

    it('reprioritizes prefetching around the new image when cached jumps move to a new center', async () => {
        gallery._applyState({
            pluginSettings: {
                lb_prefetch_enabled: true,
                lb_prefetch_offsets_seconds: '1',
                lb_prefetch_window_seconds: 10,
                general_show_debug_panel: true,
            }
        });
        const { player } = makePlayer();

        const p = gallery.showGalleryAtTime(0);
        lastWebSocket._fireOpen();
        lastWebSocket._fireMessage(new Blob(['current'], { type: 'image/jpeg' }));
        await p;

        await new Promise((resolve) => setTimeout(resolve, 0));
        const batchRequest = getLastSentMessage();
        expect(batchRequest.type).toBe('prefetch_batch');

        lastWebSocket._fireMessage(JSON.stringify({
            type: 'frame_result',
            request_id: batchRequest.request_id,
            t: 1,
            ok: true,
            image: 'prefetch-1'
        }));
        await new Promise((resolve) => setTimeout(resolve, 10));

        document.getElementById('sprite-gallery-forward-1').click();
        await new Promise((resolve) => setTimeout(resolve, 10));

        const sentMessages = lastWebSocket.sentMessages.map((message) => JSON.parse(message));
        expect(sentMessages.some((message) => (
            message.type === 'cancel' && message.request_id === batchRequest.request_id
        ))).toBe(true);
        const nextBatchRequest = sentMessages.filter((message) => message.type === 'prefetch_batch').at(-1);
        expect(nextBatchRequest).toBeDefined();
        expect(nextBatchRequest.request_id).not.toBe(batchRequest.request_id);
        expect(nextBatchRequest.times.slice(0, 3)).toEqual([1.5, 2, 6]);
        expect(sentMessages.filter((message) => message.type === 'frame')).toHaveLength(1);
        expect(document.getElementById('sprite-gallery-time').textContent).toBe('0:01');
        expect(document.getElementById('sprite-gallery-debug-output').textContent).toContain('center: 0:01');
    });

    it('listens for scrub events from both the player API and the media element', async () => {
        const { player, api } = makeVideoJsPlayer();
        const p1 = gallery.showGalleryAtTime(12);
        lastWebSocket._fireOpen();
        lastWebSocket._fireMessage(new Blob(['jpeg'], { type: 'image/jpeg' }));
        await p1;

        api.currentTime(48);
        api.emit('seeking');
        expect(document.getElementById('sprite-gallery-time').textContent).toBe('0:48');
        api.emit('seeked');

        const followupSocket = lastWebSocket;
        followupSocket._fireMessage(new Blob(['jpeg'], { type: 'image/jpeg' }));
        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(getLastSentMessage(followupSocket).t).toBe(48);
    });

    it('syncs gallery frames when player time changes without seek events', async () => {
        const { player, api } = makeVideoJsPlayer();
        const p1 = gallery.showGalleryAtTime(12);
        lastWebSocket._fireOpen();
        lastWebSocket._fireMessage(new Blob(['jpeg'], { type: 'image/jpeg' }));
        await p1;

        api.currentTime(48);
        gallery.syncGalleryFromControllerState(gallery.getPlaybackController
            ? gallery.getPlaybackController()
            : { mediaEl: player, api, eventTarget: api });

        const followupSocket = lastWebSocket;
        followupSocket._fireMessage(new Blob(['jpeg'], { type: 'image/jpeg' }));
        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(document.getElementById('sprite-gallery-time').textContent).toBe('0:48');
        expect(getLastSentMessage(followupSocket).t).toBe(48);
    });

    it('syncs gallery frames from the external scrubber indicator on click', async () => {
        gallery.bindExternalScrubberCompatibility();
        const { player } = makePlayer();
        const p1 = gallery.showGalleryAtTime(12);
        lastWebSocket._fireOpen();
        lastWebSocket._fireMessage(new Blob(['jpeg'], { type: 'image/jpeg' }));
        await p1;

        const wrapper = document.createElement('div');
        wrapper.className = 'scrubber-wrapper';
        const item = document.createElement('div');
        item.className = 'scrubber-item';
        const indicator = document.createElement('div');
        indicator.id = 'scrubber-position-indicator';
        indicator.style.transform = 'translateX(50%)';
        wrapper.appendChild(item);
        wrapper.appendChild(indicator);
        document.body.appendChild(wrapper);

        item.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, EXTERNAL_SCRUBBER_SYNC_DELAY_MS + 20));

        const followupSocket = lastWebSocket;
        followupSocket._fireMessage(new Blob(['jpeg'], { type: 'image/jpeg' }));
        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(document.getElementById('sprite-gallery-time').textContent).toBe('1:30');
        expect(getLastSentMessage(followupSocket).t).toBe(90);
    });

    it('updates the native sprite scrubber position when seeking on desktop', () => {
        makeVideoJsPlayer();
        gallery._applyState({ currentSceneData: { id: '123', duration: 596.46, paths: { sprite: '/sprite.jpg' } } });

        const slider = document.createElement('div');
        slider.className = 'scrubber-slider';
        slider.style.transform = 'translateX(-3046.05px)';
        Object.defineProperty(slider, 'scrollWidth', { value: 12960, configurable: true });

        const indicator = document.createElement('div');
        indicator.id = 'scrubber-position-indicator';
        indicator.style.transform = 'translateX(26.9603%)';

        document.body.appendChild(indicator);
        document.body.appendChild(slider);

        // syncNativeSpriteScrubber is called internally whenever setControllerTime is called.
        gallery.syncNativeSpriteScrubber(150.9559);

        expect(indicator.style.transform).toBe('translateX(25.308637628675857%)');
        expect(parseScrubberPixelTransform(slider.style.transform)).toBeCloseTo(-2831.9948799999994, 3);
    });

    it('shows "Frame unavailable" when server sends an error text frame', async () => {
        makeVideoJsPlayer();
        const p = gallery.showGalleryFrame(30, '0:30');
        lastWebSocket._fireOpen();
        lastWebSocket._fireMessage(JSON.stringify({ error: 'Scene not found' }));
        await p;

        expect(document.getElementById('sprite-gallery-loading').textContent).toBe('Scene not found');
        expect(document.getElementById('sprite-gallery-img').style.display).toBe('none');
        expect(document.getElementById('sprite-gallery-fullscreen').disabled).toBe(true);
    });

    it('shows "Frame unavailable" when WebSocket connection fails', async () => {
        makeVideoJsPlayer();
        const p = gallery.showGalleryFrame(30, '0:30');
        lastWebSocket._fireError();
        await p;

        expect(document.getElementById('sprite-gallery-loading').textContent).toBe('Frame unavailable');
    });

    it('shows "Loading timed out" when timeout expires before server responds', async () => {
        makeVideoJsPlayer();
        await gallery.showGalleryFrame(30, '0:30');

        expect(document.getElementById('sprite-gallery-loading').textContent).toBe('Loading timed out');
    }, 30000);

    it('does not render an explicit open button', async () => {
        makeVideoJsPlayer();
        const p = gallery.showGalleryFrame(30, '0:30');
        lastWebSocket._fireOpen();
        lastWebSocket._fireMessage(new Blob(['jpeg'], { type: 'image/jpeg' }));
        await p;

        expect(document.getElementById('sprite-gallery-open')).toBeNull();
    });

    it('requests fullscreen for the current gallery frame', async () => {
        makeVideoJsPlayer();
        const p = gallery.showGalleryFrame(30, '0:30');
        lastWebSocket._fireOpen();
        lastWebSocket._fireMessage(new Blob(['jpeg'], { type: 'image/jpeg' }));
        await p;

        setupFullscreenSpy();

        document.getElementById('sprite-gallery-fullscreen').click();
        await Promise.resolve();

        expect(fullscreenSpy).toHaveBeenCalled();
    });

    it('keeps the fullscreen button enabled for exiting while a fullscreen gallery frame is loading', async () => {
        const { player } = makePlayer();
        const p = gallery.showGalleryAtTime(30);
        lastWebSocket._fireOpen();
        lastWebSocket._fireMessage(new Blob(['jpeg'], { type: 'image/jpeg' }));
        await p;

        setupFullscreenSpy();
        document.getElementById('sprite-gallery-fullscreen').click();
        await Promise.resolve();

        player.currentTime = 31;
        player.dispatchEvent(new Event('seeking'));

        const fullscreenBtn = document.getElementById('sprite-gallery-fullscreen');
        expect(fullscreenBtn.disabled).toBe(false);
        expect(fullscreenBtn.textContent).toBe('Exit fullscreen');
    });

    it('toggles fullscreen off when pressed again', async () => {
        makeVideoJsPlayer();
        const p = gallery.showGalleryFrame(30, '0:30');
        lastWebSocket._fireOpen();
        lastWebSocket._fireMessage(new Blob(['jpeg'], { type: 'image/jpeg' }));
        await p;

        setupFullscreenSpy();

        document.getElementById('sprite-gallery-fullscreen').click();
        await Promise.resolve();
        document.getElementById('sprite-gallery-fullscreen').click();
        await Promise.resolve();

        expect(fullscreenSpy).toHaveBeenCalled();
        expect(fullscreenExitSpy).toHaveBeenCalled();
    });

    it('locks page scrolling while the gallery is fullscreen and restores it on exit', async () => {
        makeVideoJsPlayer();
        const p = gallery.showGalleryFrame(30, '0:30');
        lastWebSocket._fireOpen();
        lastWebSocket._fireMessage(new Blob(['jpeg'], { type: 'image/jpeg' }));
        await p;

        setupFullscreenSpy();

        document.getElementById('sprite-gallery-fullscreen').click();
        await Promise.resolve();
        expect(document.documentElement.classList.contains('stash-gallery-scroll-lock')).toBe(true);
        expect(document.body.classList.contains('stash-gallery-scroll-lock')).toBe(true);

        document.getElementById('sprite-gallery-fullscreen').click();
        await Promise.resolve();
        expect(document.documentElement.classList.contains('stash-gallery-scroll-lock')).toBe(false);
        expect(document.body.classList.contains('stash-gallery-scroll-lock')).toBe(false);
    });

    it('removes fullscreen CSS classes when exiting the gallery', async () => {
        setMobileGalleryLayout(true);
        fullscreenSpy = jest.fn(() => Promise.reject(new Error('unsupported')));

        makeVideoJsPlayer();
        const p = gallery.showGalleryFrame(30, '0:30');
        lastWebSocket._fireOpen();
        lastWebSocket._fireMessage(new Blob(['jpeg'], { type: 'image/jpeg' }));
        await p;

        setupFullscreenSpy();
        document.getElementById('sprite-gallery-fullscreen').click();
        await Promise.resolve();

        expect(document.getElementById('sprite-gallery-overlay').classList.contains('gallery-overlay-fullscreen')).toBe(true);
        expect(document.getElementById('sprite-gallery-frame').classList.contains('gallery-pseudo-fullscreen')).toBe(true);
        expect(document.getElementById('sprite-gallery-frame').classList.contains('gallery-mobile-fullscreen')).toBe(true);

        gallery.exitGallery();

        expect(document.getElementById('sprite-gallery-overlay')).toBeNull();
    });

    it('uses soft scroll lock on iPhone mobile fullscreen', async () => {
        setMobileGalleryLayout(true);
        const originalUserAgent = navigator.userAgent;
        const originalPlatform = navigator.platform;
        const originalMaxTouchPoints = navigator.maxTouchPoints;

        Object.defineProperty(navigator, 'userAgent', {
            value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
            configurable: true
        });
        Object.defineProperty(navigator, 'platform', { value: 'iPhone', configurable: true });
        Object.defineProperty(navigator, 'maxTouchPoints', { value: 5, configurable: true });

        try {
            makeVideoJsPlayer();
            const p = gallery.showGalleryFrame(30, '0:30');
            lastWebSocket._fireOpen();
            lastWebSocket._fireMessage(new Blob(['jpeg'], { type: 'image/jpeg' }));
            await p;

            setupFullscreenSpy();
            document.getElementById('sprite-gallery-fullscreen').click();
            await Promise.resolve();

            expect(document.documentElement.classList.contains('stash-gallery-scroll-soft-lock')).toBe(true);
            expect(document.body.classList.contains('stash-gallery-scroll-soft-lock')).toBe(true);
            expect(document.documentElement.classList.contains('stash-gallery-scroll-lock')).toBe(false);
            expect(document.body.classList.contains('stash-gallery-scroll-lock')).toBe(false);
        } finally {
            Object.defineProperty(navigator, 'userAgent', { value: originalUserAgent, configurable: true });
            Object.defineProperty(navigator, 'platform', { value: originalPlatform, configurable: true });
            Object.defineProperty(navigator, 'maxTouchPoints', { value: originalMaxTouchPoints, configurable: true });
        }
    });

    it('uses soft scroll lock on iPhone landscape fullscreen outside the portrait breakpoint', async () => {
        setGalleryViewportSize(956, 440);
        setMobileGalleryLayout(false, { coarse: true });
        const originalUserAgent = navigator.userAgent;
        const originalPlatform = navigator.platform;
        const originalMaxTouchPoints = navigator.maxTouchPoints;

        Object.defineProperty(navigator, 'userAgent', {
            value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
            configurable: true
        });
        Object.defineProperty(navigator, 'platform', { value: 'iPhone', configurable: true });
        Object.defineProperty(navigator, 'maxTouchPoints', { value: 5, configurable: true });

        try {
            makeVideoJsPlayer();
            const p = gallery.showGalleryFrame(30, '0:30');
            lastWebSocket._fireOpen();
            lastWebSocket._fireMessage(new Blob(['jpeg'], { type: 'image/jpeg' }));
            await p;

            setupFullscreenSpy();
            document.getElementById('sprite-gallery-fullscreen').click();
            await Promise.resolve();

            expect(document.documentElement.classList.contains('stash-gallery-scroll-soft-lock')).toBe(true);
            expect(document.body.classList.contains('stash-gallery-scroll-soft-lock')).toBe(true);
            expect(document.getElementById('sprite-gallery-frame').dataset.mobileFullscreen).toBe('true');
            expect(document.getElementById('sprite-gallery-frame').classList.contains('gallery-mobile-fullscreen')).toBe(true);
        } finally {
            Object.defineProperty(navigator, 'userAgent', { value: originalUserAgent, configurable: true });
            Object.defineProperty(navigator, 'platform', { value: originalPlatform, configurable: true });
            Object.defineProperty(navigator, 'maxTouchPoints', { value: originalMaxTouchPoints, configurable: true });
        }
    });

    it('locks orientation when entering fullscreen on mobile', async () => {
        setMobileGalleryLayout(true);

        makeVideoJsPlayer();
        const p = gallery.showGalleryFrame(30, '0:30');
        lastWebSocket._fireOpen();
        lastWebSocket._fireMessage(new Blob(['jpeg'], { type: 'image/jpeg' }));
        await p;

        setupFullscreenSpy();
        document.getElementById('sprite-gallery-fullscreen').click();
        await Promise.resolve();

        expect(orientationLockSpy).toHaveBeenCalledWith('landscape');
        expect(document.getElementById('sprite-gallery-frame').dataset.mobileFullscreen).toBe('true');
        expect(document.getElementById('sprite-gallery-frame').classList.contains('gallery-mobile-fullscreen')).toBe(true);
        expect(document.getElementById('sprite-gallery-frame').dataset.mobileRotated).toBe('false');
    });

    it('hides controls on mobile fullscreen frame tap', async () => {
        setMobileGalleryLayout(true);

        makeVideoJsPlayer();
        const p = gallery.showGalleryFrame(30, '0:30');
        lastWebSocket._fireOpen();
        lastWebSocket._fireMessage(new Blob(['jpeg'], { type: 'image/jpeg' }));
        await p;

        setupFullscreenSpy();
        document.getElementById('sprite-gallery-fullscreen').click();
        await Promise.resolve();

        const frame = document.getElementById('sprite-gallery-frame');
        const controls = document.getElementById('sprite-gallery-controls');
        frame.click();
        expect(controls.dataset.visible).toBe('false');

        frame.click();
        expect(controls.dataset.visible).toBe('true');
    });

    it('hides controls on iPhone landscape fullscreen taps outside the portrait breakpoint', async () => {
        setGalleryViewportSize(956, 440);
        setMobileGalleryLayout(false, { coarse: true });
        const originalUserAgent = navigator.userAgent;
        const originalPlatform = navigator.platform;
        const originalMaxTouchPoints = navigator.maxTouchPoints;

        Object.defineProperty(navigator, 'userAgent', {
            value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
            configurable: true
        });
        Object.defineProperty(navigator, 'platform', { value: 'iPhone', configurable: true });
        Object.defineProperty(navigator, 'maxTouchPoints', { value: 5, configurable: true });

        try {
            makeVideoJsPlayer();
            const p = gallery.showGalleryFrame(30, '0:30');
            lastWebSocket._fireOpen();
            lastWebSocket._fireMessage(new Blob(['jpeg'], { type: 'image/jpeg' }));
            await p;

            setupFullscreenSpy();
            document.getElementById('sprite-gallery-fullscreen').click();
            await Promise.resolve();

            const frame = document.getElementById('sprite-gallery-frame');
            const controls = document.getElementById('sprite-gallery-controls');
            frame.click();
            expect(controls.dataset.visible).toBe('false');

            frame.click();
            expect(controls.dataset.visible).toBe('true');
        } finally {
            Object.defineProperty(navigator, 'userAgent', { value: originalUserAgent, configurable: true });
            Object.defineProperty(navigator, 'platform', { value: originalPlatform, configurable: true });
            Object.defineProperty(navigator, 'maxTouchPoints', { value: originalMaxTouchPoints, configurable: true });
        }
    });

    it('falls back to pseudo fullscreen on mobile when requestFullscreen is unavailable', async () => {
        setMobileGalleryLayout(true);
        fullscreenSpy = jest.fn(() => Promise.reject(new Error('unsupported')));

        makeVideoJsPlayer();
        const p = gallery.showGalleryFrame(30, '0:30');
        lastWebSocket._fireOpen();
        lastWebSocket._fireMessage(new Blob(['jpeg'], { type: 'image/jpeg' }));
        await p;

        setupFullscreenSpy();
        document.getElementById('sprite-gallery-fullscreen').click();
        await Promise.resolve();

        expect(document.getElementById('sprite-gallery-overlay').dataset.overlayFullscreen).toBe('true');
        expect(document.getElementById('sprite-gallery-frame').dataset.pseudoFullscreen).toBe('true');
        expect(document.getElementById('sprite-gallery-overlay').classList.contains('gallery-overlay-fullscreen')).toBe(true);
        expect(document.getElementById('sprite-gallery-frame').classList.contains('gallery-pseudo-fullscreen')).toBe(true);
        expect(document.getElementById('sprite-gallery-frame').classList.contains('gallery-mobile-fullscreen')).toBe(true);
        expect(orientationLockSpy).toHaveBeenCalledWith('landscape');
    });

    it('uses a reduced mobile clearance above the player control strip', async () => {
        const videoContainer = makeContainer({
            containerHeight: 219,
            controlBarTop: 181,
            controlBarHeight: 45,
            progressControlTop: 159,
            progressControlHeight: 30
        });
        const p = gallery.showGalleryFrame(30, '0:30');
        lastWebSocket._fireOpen();
        lastWebSocket._fireMessage(new Blob(['jpeg'], { type: 'image/jpeg' }));
        await p;

        expect(document.getElementById('sprite-gallery-overlay').style.bottom).toBe('0px');
        expect(getOverlayControlsInset(document.getElementById('sprite-gallery-overlay'))).toBe(24);
    });

    it('recomputes gallery control placement after closing, resuming playback, and reopening', async () => {
        jest.useFakeTimers();
        try {
            const containerHeight = 219;
            const state = {
                controlBarTop: 200,
                progressControlTop: 210
            };
            const videoContainer = makeContainer({
                containerHeight,
                controlBarHeight: 45,
                progressControlHeight: 30
            });
            const controlBar = videoContainer.querySelector('.vjs-control-bar');
            const progressControl = videoContainer.querySelector('.vjs-progress-control');

            controlBar.getBoundingClientRect = () => ({
                width: 390,
                height: 45,
                top: state.controlBarTop,
                right: 390,
                bottom: state.controlBarTop + 45,
                left: 0,
                x: 0,
                y: state.controlBarTop,
                toJSON() { return this; }
            });
            progressControl.getBoundingClientRect = () => ({
                width: 390,
                height: 30,
                top: state.progressControlTop,
                right: 390,
                bottom: state.progressControlTop + 30,
                left: 0,
                x: 0,
                y: state.progressControlTop,
                toJSON() { return this; }
            });

            const firstOpen = gallery.showGalleryFrame(30, '0:30');
            lastWebSocket._fireOpen();
            lastWebSocket._fireMessage(new Blob(['jpeg'], { type: 'image/jpeg' }));
            await firstOpen;

            state.controlBarTop = 181;
            state.progressControlTop = 159;
            jest.runOnlyPendingTimers();
            expect(getOverlayControlsInset(document.getElementById('sprite-gallery-overlay'))).toBe(24);

            gallery.exitGallery();

            state.controlBarTop = 200;
            state.progressControlTop = 210;
            const reopen = gallery.showGalleryFrame(30, '0:30');
            lastWebSocket._fireOpen();
            lastWebSocket._fireMessage(new Blob(['jpeg'], { type: 'image/jpeg' }));
            await reopen;

            expect(getOverlayControlsInset(document.getElementById('sprite-gallery-overlay'))).toBe(0);

            state.controlBarTop = 181;
            state.progressControlTop = 159;
            jest.runOnlyPendingTimers();

            expect(getOverlayControlsInset(document.getElementById('sprite-gallery-overlay'))).toBe(24);
        } finally {
            jest.useRealTimers();
        }
    });

    it('keeps refreshing gallery control placement long enough for delayed control-bar repositioning after reopening', async () => {
        jest.useFakeTimers();
        try {
            const containerHeight = 219;
            const state = {
                controlBarTop: 200,
                progressControlTop: 210
            };
            const videoContainer = makeContainer({
                containerHeight,
                controlBarHeight: 45,
                progressControlHeight: 30
            });
            const controlBar = videoContainer.querySelector('.vjs-control-bar');
            const progressControl = videoContainer.querySelector('.vjs-progress-control');

            controlBar.getBoundingClientRect = () => ({
                width: 390,
                height: 45,
                top: state.controlBarTop,
                right: 390,
                bottom: state.controlBarTop + 45,
                left: 0,
                x: 0,
                y: state.controlBarTop,
                toJSON() { return this; }
            });
            progressControl.getBoundingClientRect = () => ({
                width: 390,
                height: 30,
                top: state.progressControlTop,
                right: 390,
                bottom: state.progressControlTop + 30,
                left: 0,
                x: 0,
                y: state.progressControlTop,
                toJSON() { return this; }
            });

            const firstOpen = gallery.showGalleryFrame(30, '0:30');
            lastWebSocket._fireOpen();
            lastWebSocket._fireMessage(new Blob(['jpeg'], { type: 'image/jpeg' }));
            await firstOpen;
            expect(getOverlayControlsInset(document.getElementById('sprite-gallery-overlay'))).toBe(0);

            gallery.exitGallery();

            const reopen = gallery.showGalleryFrame(30, '0:30');
            lastWebSocket._fireOpen();
            lastWebSocket._fireMessage(new Blob(['jpeg'], { type: 'image/jpeg' }));
            await reopen;
            expect(getOverlayControlsInset(document.getElementById('sprite-gallery-overlay'))).toBe(0);

            jest.advanceTimersByTime(200);
            state.controlBarTop = 181;
            state.progressControlTop = 159;
            expect(getOverlayControlsInset(document.getElementById('sprite-gallery-overlay'))).toBe(0);

            jest.advanceTimersByTime(GALLERY_LAYOUT_REFRESH_LATE_MS - 200);
            expect(getOverlayControlsInset(document.getElementById('sprite-gallery-overlay'))).toBe(24);
        } finally {
            jest.useRealTimers();
        }
    });

    it('ignores centered big play overlays when recomputing gallery control placement on mobile reopen', async () => {
        const containerHeight = 247.5;
        const videoContainer = makeContainer({
            containerTop: 7,
            containerHeight,
            controlBarTop: 209.5,
            controlBarHeight: 45,
            progressControlTop: 187,
            progressControlHeight: 30
        });
        const bigButtonGroup = document.createElement('div');
        bigButtonGroup.className = 'vjs-big-button-group';
        bigButtonGroup.getBoundingClientRect = () => ({
            width: 440,
            height: 80,
            top: 90.75,
            right: 440,
            bottom: 170.75,
            left: 0,
            x: 0,
            y: 90.75,
            toJSON() { return this; }
        });
        videoContainer.appendChild(bigButtonGroup);

        const p = gallery.showGalleryFrame(30, '0:30');
        lastWebSocket._fireOpen();
        lastWebSocket._fireMessage(new Blob(['jpeg'], { type: 'image/jpeg' }));
        await p;

        expect(getOverlayControlsInset(document.getElementById('sprite-gallery-overlay'))).toBe(32);
    });

    it('mobile tap in gallery mode calls showGalleryFrame instead of seekToTime', () => {
        gallery._applyState({ galleryActive: true });
        const mockSeek = jest.fn();
        const mockShowGallery = jest.fn();

        const isLongPress = false;
        const isScrolling = false;
        if (!isLongPress && !isScrolling) {
            if (gallery.isGalleryModeOn()) {
                mockShowGallery();
            } else {
                mockSeek();
            }
        }

        expect(mockShowGallery).toHaveBeenCalled();
        expect(mockSeek).not.toHaveBeenCalled();
    });

    it('shows a sprite-sheet preview above the gallery scrubber while scrubbing in mobile gallery mode', async () => {
        setMobileGalleryLayout(true);
        gallery._applyState({ galleryActive: true });
        gallery._applyState({
            currentSceneData: { id: '123', duration: 180, paths: { sprite: '/sprite.jpg' } }
        });

        const grid = document.createElement('div');
        grid.id = 'stash-sprite-grid';
        ['0% 0%', '20% 0%', '40% 0%', '60% 0%', '80% 0%', '100% 0%'].forEach((backgroundPosition) => {
            const cell = document.createElement('div');
            cell.className = 'sprite-cell';
            cell.style.backgroundImage = "url('/sprite.jpg')";
            cell.style.backgroundSize = '600%';
            cell.style.backgroundPosition = backgroundPosition;
            grid.appendChild(cell);
        });
        document.body.appendChild(grid);

        const { player, videoContainer } = makePlayer();

        const p = gallery.showGalleryFrame(30, '0:30');
        lastWebSocket._fireOpen();
        lastWebSocket._fireMessage(new Blob(['jpeg'], { type: 'image/jpeg' }));
        await p;

        const scrubber = document.getElementById('sprite-gallery-scrubber');
        scrubber.value = '101';
        scrubber.getBoundingClientRect = () => ({
            width: 300,
            height: 20,
            top: 220,
            right: 350,
            bottom: 240,
            left: 50,
            x: 50,
            y: 220,
            toJSON() { return this; }
        });

        player.currentTime = 30;
        scrubber.dispatchEvent(new Event('input', { bubbles: true }));

        const previewBox = document.getElementById('stash-sprite-preview');
        expect(previewBox).not.toBeNull();
        expect(previewBox.style.display).toBe('block');
        expect(scrubber.value).toBe('90');
        expect(player.currentTime).toBe(90);
        expect(previewBox.style.backgroundPosition).toBe('60% 0%');
        expect(previewBox.querySelector('.preview-time').innerText).toBe('1:30');
        expect(parseFloat(previewBox.style.top)).toBeLessThan(220);

        scrubber.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 150));
        expect(previewBox.style.display).toBe('none');
    });

    it('shows the native gallery scrubber preview while the gallery is in fullscreen', async () => {
        setMobileGalleryLayout(true);
        gallery._applyState({ galleryActive: true });
        gallery._applyState({
            currentSceneData: { id: '123', duration: 180, paths: { sprite: '/sprite.jpg' } }
        });

        const grid = document.createElement('div');
        grid.id = 'stash-sprite-grid';
        ['0% 0%', '20% 0%', '40% 0%', '60% 0%', '80% 0%', '100% 0%'].forEach((backgroundPosition) => {
            const cell = document.createElement('div');
            cell.className = 'sprite-cell';
            cell.style.backgroundImage = "url('/sprite.jpg')";
            cell.style.backgroundSize = '600%';
            cell.style.backgroundPosition = backgroundPosition;
            grid.appendChild(cell);
        });
        document.body.appendChild(grid);

        const { player, videoContainer } = makePlayer();
        const p = gallery.showGalleryFrame(30, '0:30');
        lastWebSocket._fireOpen();
        lastWebSocket._fireMessage(new Blob(['jpeg'], { type: 'image/jpeg' }));
        await p;

        setupFullscreenSpy();
        document.getElementById('sprite-gallery-fullscreen').click();
        await Promise.resolve();

        const scrubber = document.getElementById('sprite-gallery-scrubber');
        scrubber.value = '101';
        scrubber.getBoundingClientRect = () => ({
            width: 300,
            height: 20,
            top: 220,
            right: 350,
            bottom: 240,
            left: 50,
            x: 50,
            y: 220,
            toJSON() { return this; }
        });

        player.currentTime = 30;
        scrubber.dispatchEvent(new Event('input', { bubbles: true }));

        const previewBox = document.getElementById('stash-sprite-preview');
        expect(previewBox).not.toBeNull();
        expect(previewBox.style.display).toBe('block');
        expect(previewBox.parentElement).toBe(document.fullscreenElement);
        expect(previewBox.style.backgroundPosition).toBe('60% 0%');

        scrubber.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 150));
        expect(previewBox.style.display).toBe('none');
    });

    it('shows the gallery scrubber preview while fullscreen falls back to pseudo fullscreen', async () => {
        setMobileGalleryLayout(true);
        gallery._applyState({ galleryActive: true });
        fullscreenSpy = jest.fn(() => Promise.reject(new Error('unsupported')));
        gallery._applyState({
            currentSceneData: { id: '123', duration: 180, paths: { sprite: '/sprite.jpg' } }
        });

        const grid = document.createElement('div');
        grid.id = 'stash-sprite-grid';
        ['0% 0%', '20% 0%', '40% 0%', '60% 0%', '80% 0%', '100% 0%'].forEach((backgroundPosition) => {
            const cell = document.createElement('div');
            cell.className = 'sprite-cell';
            cell.style.backgroundImage = "url('/sprite.jpg')";
            cell.style.backgroundSize = '600%';
            cell.style.backgroundPosition = backgroundPosition;
            grid.appendChild(cell);
        });
        document.body.appendChild(grid);

        const { player, videoContainer } = makePlayer();
        const p = gallery.showGalleryFrame(30, '0:30');
        lastWebSocket._fireOpen();
        lastWebSocket._fireMessage(new Blob(['jpeg'], { type: 'image/jpeg' }));
        await p;

        setupFullscreenSpy();
        document.getElementById('sprite-gallery-fullscreen').click();
        await Promise.resolve();

        const scrubber = document.getElementById('sprite-gallery-scrubber');
        scrubber.value = '101';
        scrubber.getBoundingClientRect = () => ({
            width: 300,
            height: 20,
            top: 220,
            right: 350,
            bottom: 240,
            left: 50,
            x: 50,
            y: 220,
            toJSON() { return this; }
        });

        player.currentTime = 30;
        scrubber.dispatchEvent(new Event('input', { bubbles: true }));

        const previewBox = document.getElementById('stash-sprite-preview');
        expect(previewBox).not.toBeNull();
        expect(document.getElementById('sprite-gallery-frame').dataset.pseudoFullscreen).toBe('true');
        expect(previewBox.style.display).toBe('block');
        expect(previewBox.parentElement).toBe(document.getElementById('sprite-gallery-frame'));
        expect(previewBox.style.backgroundPosition).toBe('60% 0%');

        scrubber.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 150));
        expect(previewBox.style.display).toBe('none');
    });

    it('shows the gallery scrubber and preview in fullscreen on desktop layouts', async () => {
        gallery._applyState({ galleryActive: true });
        gallery._applyState({
            currentSceneData: { id: '123', duration: 180, paths: { sprite: '/sprite.jpg' } }
        });

        const grid = document.createElement('div');
        grid.id = 'stash-sprite-grid';
        ['0% 0%', '20% 0%', '40% 0%', '60% 0%', '80% 0%', '100% 0%'].forEach((backgroundPosition) => {
            const cell = document.createElement('div');
            cell.className = 'sprite-cell';
            cell.style.backgroundImage = "url('/sprite.jpg')";
            cell.style.backgroundSize = '600%';
            cell.style.backgroundPosition = backgroundPosition;
            grid.appendChild(cell);
        });
        document.body.appendChild(grid);

        const { player } = makePlayer();
        const p = gallery.showGalleryFrame(30, '0:30');
        lastWebSocket._fireOpen();
        lastWebSocket._fireMessage(new Blob(['jpeg'], { type: 'image/jpeg' }));
        await p;

        setupFullscreenSpy();
        document.getElementById('sprite-gallery-fullscreen').click();
        await Promise.resolve();

        const scrubber = document.getElementById('sprite-gallery-scrubber');
        expect(scrubber.style.display).toBe('block');
        scrubber.value = '101';
        scrubber.getBoundingClientRect = () => ({
            width: 300,
            height: 20,
            top: 220,
            right: 350,
            bottom: 240,
            left: 50,
            x: 50,
            y: 220,
            toJSON() { return this; }
        });

        player.currentTime = 30;
        scrubber.dispatchEvent(new Event('input', { bubbles: true }));

        const previewBox = document.getElementById('stash-sprite-preview');
        expect(previewBox).not.toBeNull();
        expect(previewBox.style.display).toBe('block');
        expect(previewBox.parentElement).toBe(document.fullscreenElement);
        expect(previewBox.style.backgroundPosition).toBe('60% 0%');
    });

    it('exitGallery flips isGalleryModeOn back to false and removes the overlay', async () => {
        const { player } = makePlayer();
        const p = gallery.showGalleryAtTime(20);
        lastWebSocket._fireOpen();
        lastWebSocket._fireMessage(new Blob(['jpeg'], { type: 'image/jpeg' }));
        await p;
        expect(document.getElementById('sprite-gallery-overlay')).not.toBeNull();
        expect(gallery.isGalleryModeOn()).toBe(true);

        gallery.exitGallery();

        expect(gallery.isGalleryModeOn()).toBe(false);
        expect(document.getElementById('sprite-gallery-overlay')).toBeNull();
    });

    it('closing the gallery removes player listeners so later scrubs do not request frames', async () => {
        const { player } = makePlayer();
        const p = gallery.showGalleryAtTime(20);
        lastWebSocket._fireOpen();
        lastWebSocket._fireMessage(new Blob(['jpeg'], { type: 'image/jpeg' }));
        await p;

        const initialSocketCount = createdWebSockets.length;
        gallery.exitGallery();

        player.currentTime = 45;
        player.dispatchEvent(new Event('seeked'));

        expect(createdWebSockets).toHaveLength(initialSocketCount);
        expect(document.getElementById('sprite-gallery-overlay')).toBeNull();
    });

    it('ignores stale frame responses when a newer scrub request is already active', async () => {
        const { player } = makePlayer();
        const firstPromise = gallery.showGalleryAtTime(10);
        const firstSocket = lastWebSocket;
        firstSocket._fireOpen();
        await Promise.resolve();
        const firstRequest = getLastSentMessage(firstSocket);

        player.currentTime = 60;
        player.dispatchEvent(new Event('seeked'));
        const secondSocket = lastWebSocket;
        await Promise.resolve();
        const secondRequest = getLastSentMessage(secondSocket);

        expect(firstSocket).toBe(secondSocket);
        expect(firstRequest.request_id).not.toBe(secondRequest.request_id);

        firstSocket._fireMessage(JSON.stringify({
            type: 'frame_result',
            request_id: firstRequest.request_id,
            t: 10,
            ok: true,
            image: 'old'
        }));
        secondSocket._fireMessage(JSON.stringify({
            type: 'frame_result',
            request_id: secondRequest.request_id,
            t: 60,
            ok: true,
            image: 'new'
        }));

        await firstPromise;
        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(getLastSentMessage(secondSocket).t).toBe(60);
        expect(document.getElementById('sprite-gallery-time').textContent).toBe('1:00');
        expect(document.getElementById('sprite-gallery-img').src).toMatch(/^data:/);
    });

    it('sent message includes scale when gallery_resolution is 0.5', async () => {
        saveSettings({ gallery_resolution: 0.5 });
        makeVideoJsPlayer();
        const p = gallery.showGalleryFrame(30, '0:30');
        lastWebSocket._fireOpen();
        lastWebSocket._fireMessage(new Blob(['jpeg'], { type: 'image/jpeg' }));
        await p;

        const msg = JSON.parse(lastWebSocket.sentMessages[0]);
        expect(msg.scale).toBe(0.5);
    });

    it('sent message includes scale 1 when gallery_resolution is 1', async () => {
        saveSettings({ gallery_resolution: 1 });
        makeVideoJsPlayer();
        const p = gallery.showGalleryFrame(30, '0:30');
        lastWebSocket._fireOpen();
        lastWebSocket._fireMessage(new Blob(['jpeg'], { type: 'image/jpeg' }));
        await p;

        const msg = JSON.parse(lastWebSocket.sentMessages[0]);
        expect(msg.scale).toBe(1);
    });

    it('request full resolution fetches the current frame at scale 1 without changing the saved gallery resolution', async () => {
        saveSettings({ gallery_resolution: 0.5 });
        makeVideoJsPlayer();
        const p = gallery.showGalleryFrame(30, '0:30');
        lastWebSocket._fireOpen();
        lastWebSocket._fireMessage(new Blob(['jpeg-low'], { type: 'image/jpeg' }));
        await p;

        const fullResolutionBtn = document.getElementById('sprite-gallery-full-resolution');
        expect(fullResolutionBtn.disabled).toBe(false);

        fullResolutionBtn.click();
        const loading = document.getElementById('sprite-gallery-loading');
        expect(loading.textContent).toBe('');
        expect(loading.classList.contains('sprite-gallery-loading-corner')).toBe(true);
        expect(loading.getAttribute('aria-label')).toBe('Loading full resolution...');
        expect(document.getElementById('sprite-gallery-img').style.display).toBe('block');
        await Promise.resolve();

        const msg = getLastSentMessage();
        expect(msg.t).toBe(30);
        expect(msg.scale).toBe(1);
        expect(getSettings().gallery_resolution).toBe(0.5);

        lastWebSocket._fireMessage(new Blob(['jpeg-full'], { type: 'image/jpeg' }));
        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(fullResolutionBtn.disabled).toBe(true);
        expect(fullResolutionBtn.textContent).toBe('Request full resolution');
        expect(loading.classList.contains('sprite-gallery-loading-corner')).toBe(false);
    });

    it('connects to the configured port when no host override is set', async () => {
        gallery._applyState({ pluginSettings: { lb_frame_server_port: 12345, lb_frame_server_host: '' } });
        makeVideoJsPlayer();
        const p = gallery.showGalleryFrame(30, '0:30');
        lastWebSocket._fireOpen();
        lastWebSocket._fireMessage(new Blob(['jpeg'], { type: 'image/jpeg' }));
        await p;

        expect(lastWebSocket.url).toContain(':12345');
    });

    it('connects to lb_frame_server_host directly when set, ignoring port', async () => {
        gallery._applyState({ pluginSettings: { lb_frame_server_host: 'frame.example.com', lb_frame_server_port: 12345 } });
        makeVideoJsPlayer();
        const p = gallery.showGalleryFrame(30, '0:30');
        lastWebSocket._fireOpen();
        lastWebSocket._fireMessage(new Blob(['jpeg'], { type: 'image/jpeg' }));
        await p;

        expect(lastWebSocket.url).toContain('frame.example.com');
        expect(lastWebSocket.url).not.toContain(':12345');
    });

    it('resolution selector saves gallery_resolution to localStorage on change', () => {
        const resSelect = document.createElement('select');
        [['Full', '1'], ['\u00BD', '0.5'], ['\u00BC', '0.25']].forEach(([lbl, val]) => {
            const opt = document.createElement('option');
            opt.value = val;
            opt.textContent = lbl;
            resSelect.appendChild(opt);
        });
        resSelect.onchange = (e) => saveSettings({ gallery_resolution: parseFloat(e.target.value) });
        document.body.appendChild(resSelect);

        resSelect.value = '0.5';
        resSelect.dispatchEvent(new Event('change'));

        expect(getSettings().gallery_resolution).toBe(0.5);
    });

    it('resolution selector is hidden when gallery mode is off and shown when on', () => {
        const resWrapper = document.createElement('span');

        resWrapper.style.display = gallery.isGalleryModeOn() ? 'flex' : 'none';
        expect(resWrapper.style.display).toBe('none');

        gallery._applyState({ galleryActive: true });
        resWrapper.style.display = gallery.isGalleryModeOn() ? 'flex' : 'none';
        expect(resWrapper.style.display).toBe('flex');
    });

    it('isGalleryModeOn reflects the in-memory galleryActive flag', () => {
        // Fresh state: gallery is not active
        expect(gallery.isGalleryModeOn()).toBe(false);

        // Flipping galleryActive is the only way to turn isGalleryModeOn on
        gallery._applyState({ galleryActive: true });
        expect(gallery.isGalleryModeOn()).toBe(true);

        gallery._applyState({ galleryActive: false });
        expect(gallery.isGalleryModeOn()).toBe(false);
    });

    // --- HIGH-BANDWIDTH MODE TESTS ---

    it('isLowBandwidthMode returns true when lb_enabled is true', () => {
        gallery._applyState({ pluginSettings: { lb_enabled: true } });
        expect(gallery.isLowBandwidthMode()).toBe(true);
    });

    it('isLowBandwidthMode returns false when lb_enabled is false', () => {
        gallery._applyState({ pluginSettings: { lb_enabled: false } });
        expect(gallery.isLowBandwidthMode()).toBe(false);
    });

    it('getEffectiveGalleryScale returns numeric scale in low-bandwidth mode', () => {
        gallery._applyState({ pluginSettings: { lb_enabled: true } });
        saveSettings({ gallery_resolution: 0.5 });
        expect(gallery.getEffectiveGalleryScale()).toBe(0.5);
    });

    it('getEffectiveGalleryScale returns native in high-bandwidth mode', () => {
        gallery._applyState({ pluginSettings: { lb_enabled: false } });
        expect(gallery.getEffectiveGalleryScale()).toBe('native');
    });

    it('fetchGalleryFrameFromStream resolves ok on seeked', async () => {
        const { player } = makePlayer();
        Object.defineProperty(player, 'videoWidth', { value: 640, configurable: true });
        Object.defineProperty(player, 'videoHeight', { value: 480, configurable: true });

        const mockCtx = { drawImage: jest.fn() };
        jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(mockCtx);
        jest.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/jpeg;base64,mockframe');

        const p = gallery.fetchGalleryFrameFromStream(30);
        player.dispatchEvent(new Event('seeked'));
        const result = await p;

        expect(result.status).toBe('ok');
        expect(result.src).toBe('data:image/jpeg;base64,mockframe');
        expect(player.currentTime).toBe(30);
        expect(mockCtx.drawImage).toHaveBeenCalledWith(player, 0, 0, 640, 480);

        HTMLCanvasElement.prototype.getContext.mockRestore();
        HTMLCanvasElement.prototype.toDataURL.mockRestore();
    });

    it('fetchGalleryFrameFromStream resolves error on video error', async () => {
        makePlayer();
        const player = document.querySelector('video.vjs-tech');

        const p = gallery.fetchGalleryFrameFromStream(30);
        player.dispatchEvent(new Event('error'));
        const result = await p;

        expect(result.status).toBe('error');
        expect(result.message).toBe('Frame unavailable');
    });

    it('fetchGalleryFrameFromStream resolves timeout when seek takes too long', async () => {
        jest.useFakeTimers();
        makePlayer();

        const p = gallery.fetchGalleryFrameFromStream(30);
        jest.advanceTimersByTime(8000);
        const result = await p;

        expect(result.status).toBe('timeout');
        expect(result.message).toBe('Loading timed out');
        jest.useRealTimers();
    });

    it('fetchGalleryFrameFromStream resolves error when no video player exists', async () => {
        // No player created
        const result = await gallery.fetchGalleryFrameFromStream(30);
        expect(result.status).toBe('error');
        expect(result.message).toBe('Frame unavailable');
    });

    it('fetchGalleryFrameFromStream seeks via the videojs Player api, not the DOM video, when api is available', async () => {
        // Under transcoding, <video>.currentTime tracks the transcoded stream
        // and diverges from the user-facing timeline. Setting it directly would
        // capture a frame from the wrong moment. The fix routes the seek
        // through the videojs Player's currentTime() function.
        const { player, api } = makeVideoJsPlayer();
        Object.defineProperty(player, 'videoWidth', { value: 640, configurable: true });
        Object.defineProperty(player, 'videoHeight', { value: 480, configurable: true });

        // Decouple api time from DOM time to simulate transcoding: the api
        // (user-facing timeline) advances, but the DOM <video>.currentTime
        // stays at 0 (the transcoded-stream position).
        api.currentTime = jest.fn((value) => {
            if (value === undefined) return api._time;
            api._time = value;
            return api._time;
        });

        const mockCtx = { drawImage: jest.fn() };
        jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(mockCtx);
        jest.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/jpeg;base64,mockframe');

        const p = gallery.fetchGalleryFrameFromStream(30);
        api.emit('seeked');
        const result = await p;

        expect(result.status).toBe('ok');
        expect(api.currentTime).toHaveBeenCalledWith(30);
        // The DOM <video>.currentTime should NOT have been written directly —
        // the api owns the timeline under transcoding.
        expect(player.currentTime).toBe(0);

        HTMLCanvasElement.prototype.getContext.mockRestore();
        HTMLCanvasElement.prototype.toDataURL.mockRestore();
    });

    it('high-bandwidth mode reuses the player video surface without opening a WebSocket', async () => {
        gallery._applyState({ pluginSettings: { lb_enabled: false } });
        const { player, videoContainer } = makePlayer();
        setPlayerReadyState(player, 0);

        const p = gallery.showGalleryFrame(30, '0:30');
        await resolveGalleryVideoFrame(player);
        await p;

        const media = gallery.getActiveGalleryMediaElement();
        expect(media).toBe(player);
        expect(gallery.isGalleryUsingVideoSurface()).toBe(true);
        expect(gallery.hasGalleryRenderableFrame()).toBe(true);
        expect(document.getElementById('sprite-gallery-img').style.display).toBe('none');
        expect(player.currentTime).toBe(30);
        expect(videoContainer.classList.contains('stash-gallery-player-gallery-active')).toBe(true);
        expect(player.classList.contains('stash-gallery-video-active')).toBe(true);
        expect(createdWebSockets).toHaveLength(0);
    });

    it('keeps the high-bandwidth mobile video surface frame-bound until fullscreen is entered', async () => {
        setMobileGalleryLayout(true);
        gallery._applyState({ pluginSettings: { lb_enabled: false } });
        const { player } = makePlayer();
        setPlayerReadyState(player, 0);

        const p = gallery.showGalleryFrame(30, '0:30');
        await resolveGalleryVideoFrame(player);
        await p;

        expect(gallery.isGalleryUsingVideoSurface()).toBe(true);
        expect(document.getElementById('sprite-gallery-frame').classList.contains('gallery-mobile-fullscreen')).toBe(false);
        expect(player.style.width).toBe('100%');
        expect(player.style.height).toBe('100%');
        expect(player.style.maxWidth).toBe('100%');
        expect(player.style.maxHeight).toBe('100%');

        setupFullscreenSpy();
        document.getElementById('sprite-gallery-fullscreen').click();
        await Promise.resolve();
        await Promise.resolve();

        expect(document.getElementById('sprite-gallery-frame').classList.contains('gallery-mobile-fullscreen')).toBe(true);
        expect(player.style.width).toBe('100vw');
        expect(player.style.height).toBe('100vh');
        expect(player.style.maxWidth).toBe('100vw');
        expect(player.style.maxHeight).toBe('100vh');
    });

    it('high-bandwidth mode hides full-resolution button and restores player classes on exit', async () => {
        gallery._applyState({ pluginSettings: { lb_enabled: false } });
        const { player, videoContainer } = makePlayer();
        setPlayerReadyState(player, 0);

        const p = gallery.showGalleryFrame(30, '0:30');
        await resolveGalleryVideoFrame(player);
        await p;

        const fullResBtn = document.getElementById('sprite-gallery-full-resolution');
        expect(fullResBtn.style.display).toBe('none');
        expect(document.getElementById('sprite-gallery-fullscreen').disabled).toBe(false);

        gallery.exitGallery();
        expect(videoContainer.classList.contains('stash-gallery-player-gallery-active')).toBe(false);
        expect(player.classList.contains('stash-gallery-video-active')).toBe(false);
    });

    it('low-bandwidth mode shows full-resolution button', async () => {
        makeVideoJsPlayer();
        const p = gallery.showGalleryFrame(30, '0:30');
        lastWebSocket._fireOpen();
        lastWebSocket._fireMessage(new Blob(['jpeg'], { type: 'image/jpeg' }));
        await p;

        const fullResBtn = document.getElementById('sprite-gallery-full-resolution');
        expect(fullResBtn.style.display).not.toBe('none');
    });

    it('resolution selector is hidden in high-bandwidth mode even when gallery is on', () => {
        gallery._applyState({ pluginSettings: { lb_enabled: false } });
        const resWrapper = document.createElement('span');

        gallery._applyState({ galleryActive: true });
        resWrapper.style.display = (gallery.isGalleryModeOn() && gallery.isLowBandwidthMode()) ? 'flex' : 'none';
        expect(resWrapper.style.display).toBe('none');
    });

    it('resolution selector shows in low-bandwidth mode when gallery is on', () => {
        gallery._applyState({ pluginSettings: { lb_enabled: true } });
        const resWrapper = document.createElement('span');

        gallery._applyState({ galleryActive: true });
        resWrapper.style.display = (gallery.isGalleryModeOn() && gallery.isLowBandwidthMode()) ? 'flex' : 'none';
        expect(resWrapper.style.display).toBe('flex');
    });

    it('scheduleGalleryPrefetch skips prefetch in high-bandwidth mode', async () => {
        gallery._applyState({ pluginSettings: { lb_enabled: false, lb_prefetch_enabled: true } });
        const { player } = makePlayer();
        setPlayerReadyState(player, 0);

        const p = gallery.showGalleryFrame(30, '0:30');
        await resolveGalleryVideoFrame(player);
        await p;

        // Even though prefetch is enabled, no WebSocket should be created in HB mode
        expect(createdWebSockets).toHaveLength(0);
    });

    it('gallery navigation works in high-bandwidth mode via shiftGalleryTime', async () => {
        gallery._applyState({ pluginSettings: { lb_enabled: false } });
        const { player } = makePlayer();
        setPlayerReadyState(player, 0);

        // Show initial frame
        const p1 = gallery.showGalleryFrame(30, '0:30');
        await resolveGalleryVideoFrame(player);
        await p1;
        expect(gallery.getActiveGalleryMediaElement()).toBe(player);
        expect(player.currentTime).toBe(30);

        // Navigate forward by 5 seconds
        setPlayerReadyState(player, HTMLMediaElement.HAVE_METADATA);
        const p2 = gallery.shiftGalleryTime(5);
        player.readyState = HTMLMediaElement.HAVE_CURRENT_DATA;
        player.dispatchEvent(new Event('loadeddata'));
        await p2;

        expect(player.currentTime).toBe(35);
        expect(document.getElementById('sprite-gallery-time').textContent).toBe('0:35');
        // No WebSocket should ever have been created
        expect(createdWebSockets).toHaveLength(0);
    });

    it('high-bandwidth +1s navigation can advance through an entire 1 minute video without hitting a wall', async () => {
        gallery._applyState({
            currentSceneData: { id: '123', duration: 60, paths: { sprite: '/sprite.jpg' } },
            pluginSettings: { lb_enabled: false }
        });
        const { player } = makePlayer();
        Object.defineProperty(player, 'duration', { value: 60, writable: true, configurable: true });
        setPlayerReadyState(player, 0);

        const first = gallery.showGalleryFrame(0, '0:00');
        await resolveGalleryVideoFrame(player);
        await first;

        for (let second = 1; second <= 60; second += 1) {
            setPlayerReadyState(player, HTMLMediaElement.HAVE_METADATA);
            document.getElementById('sprite-gallery-forward-1').click();
            player.currentTime = second;
            player.readyState = HTMLMediaElement.HAVE_CURRENT_DATA;
            player.dispatchEvent(new Event('loadeddata'));
            await new Promise((resolve) => setTimeout(resolve, 0));
        }

        expect(player.currentTime).toBe(60);
        expect(document.getElementById('sprite-gallery-time').textContent).toBe('1:00');
        expect(document.getElementById('sprite-gallery-forward-1').disabled).toBe(true);
    });

    it('high-bandwidth +1s navigation can cross repeated sprite boundaries in a 1 minute video', async () => {
        gallery._applyState({
            currentSceneData: { id: '123', duration: 60, paths: { sprite: '/sprite.jpg' } },
            pluginSettings: { lb_enabled: false }
        });
        const { player } = makePlayer();
        Object.defineProperty(player, 'duration', { value: 60, writable: true, configurable: true });
        setPlayerReadyState(player, 0);

        const grid = document.createElement('div');
        grid.id = 'stash-sprite-grid';
        for (let i = 0; i < 12; i += 1) {
            const cell = document.createElement('div');
            cell.className = 'sprite-cell';
            grid.appendChild(cell);
        }
        document.body.appendChild(grid);

        const first = gallery.showGalleryFrame(0, '0:00');
        await resolveGalleryVideoFrame(player);
        await first;

        for (let second = 1; second <= 60; second += 1) {
            setPlayerReadyState(player, HTMLMediaElement.HAVE_METADATA);
            document.getElementById('sprite-gallery-forward-1').click();
            player.currentTime = second;
            player.readyState = HTMLMediaElement.HAVE_CURRENT_DATA;
            player.dispatchEvent(new Event('loadeddata'));
            await new Promise((resolve) => setTimeout(resolve, 0));

            expect(player.currentTime).toBe(second);
            if (second % 5 === 0) {
                const expectedTimeText = second >= 60
                    ? `1:${String(second - 60).padStart(2, '0')}`
                    : `0:${String(second).padStart(2, '0')}`;
                expect(document.getElementById('sprite-gallery-time').textContent).toBe(expectedTimeText);
            }
        }

        expect(player.currentTime).toBe(60);
        expect(document.getElementById('sprite-gallery-time').textContent).toBe('1:00');
    });

    it('high-bandwidth forward jump buttons keep fullscreen enabled and show a corner spinner while seeking', async () => {
        gallery._applyState({ pluginSettings: { lb_enabled: false } });
        const { player } = makePlayer();
        setPlayerReadyState(player, 0);

        const p = gallery.showGalleryFrame(30, '0:30');
        await resolveGalleryVideoFrame(player);
        await p;

        const loading = document.getElementById('sprite-gallery-loading');
        const fullscreenBtn = document.getElementById('sprite-gallery-fullscreen');

        setPlayerReadyState(player, HTMLMediaElement.HAVE_METADATA);
        document.getElementById('sprite-gallery-forward-1').click();
        expect(loading.classList.contains('sprite-gallery-loading-corner')).toBe(true);
        expect(fullscreenBtn.disabled).toBe(false);

        player.readyState = HTMLMediaElement.HAVE_CURRENT_DATA;
        player.dispatchEvent(new Event('loadeddata'));
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(player.currentTime).toBe(31);
        expect(loading.style.display).toBe('none');

        setPlayerReadyState(player, HTMLMediaElement.HAVE_METADATA);
        document.getElementById('sprite-gallery-forward-5').click();
        expect(loading.classList.contains('sprite-gallery-loading-corner')).toBe(true);
        expect(fullscreenBtn.disabled).toBe(false);

        player.readyState = HTMLMediaElement.HAVE_CURRENT_DATA;
        player.dispatchEvent(new Event('loadeddata'));
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(player.currentTime).toBe(36);
        expect(loading.style.display).toBe('none');
    });

    it('high-bandwidth mode does not cancel its own seek when the player fires seeking events', async () => {
        gallery._applyState({ pluginSettings: { lb_enabled: false } });
        const { player } = makePlayer();
        setPlayerReadyState(player, HTMLMediaElement.HAVE_METADATA);
        player.currentTime = 7;

        const p = gallery.showGalleryAtTime(30);
        await Promise.resolve();

        player.seeking = true;
        player.dispatchEvent(new Event('seeking'));
        await Promise.resolve();

        player.seeking = false;
        player.currentTime = 30;
        player.readyState = HTMLMediaElement.HAVE_CURRENT_DATA;
        player.dispatchEvent(new Event('seeked'));
        player.dispatchEvent(new Event('loadeddata'));
        await p;

        expect(document.getElementById('sprite-gallery-loading').style.display).toBe('none');
        expect(document.getElementById('sprite-gallery-fullscreen').disabled).toBe(false);
        expect(gallery.hasGalleryRenderableFrame()).toBe(true);
    });

    it('high-bandwidth mode works on first open without prior playback', async () => {
        gallery._applyState({ pluginSettings: { lb_enabled: false } });
        const { player } = makePlayer();
        player.paused = true;
        setPlayerReadyState(player, 0);

        const p = gallery.showGalleryAtTime(42.5);
        await resolveGalleryVideoFrame(player);
        await p;

        expect(player.pause).toHaveBeenCalled();
        expect(player.currentTime).toBe(42.5);
        expect(document.getElementById('sprite-gallery-time').textContent).toBe('0:42');
        expect(gallery.hasGalleryRenderableFrame()).toBe(true);
        expect(createdWebSockets).toHaveLength(0);
    });

    it('high-bandwidth mode dispatches timeupdate after a gallery seek completes', async () => {
        gallery._applyState({ pluginSettings: { lb_enabled: false } });
        const { player } = makePlayer();
        setPlayerReadyState(player, 0);
        const timeupdateSpy = jest.fn();
        player.addEventListener('timeupdate', timeupdateSpy);

        const p = gallery.showGalleryAtTime(42.5);
        await resolveGalleryVideoFrame(player);
        await p;

        expect(timeupdateSpy).toHaveBeenCalled();
        expect(player.currentTime).toBe(42.5);
    });

    it('high-bandwidth mode resolves when the target time already matches the current player time', async () => {
        gallery._applyState({ pluginSettings: { lb_enabled: false } });
        const { player } = makePlayer();
        player.currentTime = 18;
        setPlayerReadyState(player, 0);

        const p = gallery.showGalleryFrame(18, '0:18');
        await resolveGalleryVideoFrame(player);
        await p;

        expect(player.currentTime).toBe(18);
        expect(gallery.hasGalleryRenderableFrame()).toBe(true);
        expect(createdWebSockets).toHaveLength(0);
    });

    it('high-bandwidth mode waits for metadata before resolving the first frame', async () => {
        gallery._applyState({ pluginSettings: { lb_enabled: false } });
        const { player } = makePlayer();
        setPlayerReadyState(player, 0);
        player.load = jest.fn();

        const p = gallery.showGalleryFrame(12, '0:12');
        await Promise.resolve();
        expect(gallery.hasGalleryRenderableFrame()).toBe(false);
        expect(player.load).toHaveBeenCalled();

        player.readyState = HTMLMediaElement.HAVE_METADATA;
        player.dispatchEvent(new Event('loadedmetadata'));
        player.readyState = HTMLMediaElement.HAVE_CURRENT_DATA;
        player.dispatchEvent(new Event('loadeddata'));
        await p;

        expect(player.currentTime).toBe(12);
        expect(gallery.hasGalleryRenderableFrame()).toBe(true);
    });

    it('high-bandwidth mode falls back when requestVideoFrameCallback never fires', async () => {
        jest.useFakeTimers();
        gallery._applyState({ pluginSettings: { lb_enabled: false } });
        const { player } = makePlayer();
        setPlayerReadyState(player, HTMLMediaElement.HAVE_CURRENT_DATA);
        player.requestVideoFrameCallback = jest.fn(() => 42);
        player.cancelVideoFrameCallback = jest.fn();

        const p = gallery.showGalleryFrame(15, '0:15');
        await Promise.resolve();
        jest.advanceTimersByTime(150);
        await p;

        expect(player.requestVideoFrameCallback).toHaveBeenCalled();
        expect(player.cancelVideoFrameCallback).toHaveBeenCalledWith(42);
        expect(gallery.hasGalleryRenderableFrame()).toBe(true);
        jest.useRealTimers();
    });

    it('high-bandwidth mode supports pinch zoom and pan on the video surface', async () => {
        setMobileGalleryLayout(true);
        gallery._applyState({ pluginSettings: { lb_enabled: false } });
        const { player } = makePlayer();
        setPlayerReadyState(player, 0);

        const p = gallery.showGalleryFrame(30, '0:30');
        await resolveGalleryVideoFrame(player);
        await p;
        mockGalleryImageLayout();

        const viewport = document.getElementById('sprite-gallery-viewport');
        const media = gallery.getActiveGalleryMediaElement();

        viewport.ontouchstart(createGalleryTouchEvent('touchstart', [
            makeGalleryTouch(1, 100, 90),
            makeGalleryTouch(2, 220, 90)
        ]));
        viewport.ontouchmove(createGalleryTouchEvent('touchmove', [
            makeGalleryTouch(1, 70, 90),
            makeGalleryTouch(2, 250, 90)
        ]));
        viewport.ontouchend(createGalleryTouchEvent('touchend', []));

        expect(parseFloat(media.dataset.zoomScale)).toBeGreaterThan(1.4);

        viewport.ontouchstart(createGalleryTouchEvent('touchstart', [
            makeGalleryTouch(3, 150, 90)
        ]));
        viewport.ontouchmove(createGalleryTouchEvent('touchmove', [
            makeGalleryTouch(3, 190, 90)
        ]));

        expect(parseFloat(media.dataset.panX)).toBeGreaterThan(0);
    });

    // --- Regression tests ---

    it('high-bandwidth forward jump uses frame-accurate seeking, not keyframe-only fastSeek', async () => {
        gallery._applyState({ pluginSettings: { lb_enabled: false } });
        const { player } = makePlayer();
        setPlayerReadyState(player, 0);

        const p1 = gallery.showGalleryFrame(10, '0:10');
        await resolveGalleryVideoFrame(player);
        await p1;

        // Provide fastSeek that lands on a different time (simulating keyframe snap)
        player.fastSeek = jest.fn((time) => {
            // fastSeek snaps to nearest keyframe — simulate landing on 10 (same keyframe)
            player.currentTime = 10;
        });

        setPlayerReadyState(player, HTMLMediaElement.HAVE_METADATA);
        const p2 = gallery.shiftGalleryTime(1);
        // Frame-accurate seek should set currentTime directly to 11, not use fastSeek
        player.readyState = HTMLMediaElement.HAVE_CURRENT_DATA;
        player.dispatchEvent(new Event('loadeddata'));
        await p2;

        expect(player.fastSeek).not.toHaveBeenCalled();
        expect(player.currentTime).toBe(11);
    });

    it('pinch-to-zoom activates on touch-capable tablets regardless of viewport size', async () => {
        // Simulate a tablet: touch capable, viewport > 500px on shortest edge
        setGalleryViewportSize(1024, 768);
        setMobileGalleryLayout(false);
        Object.defineProperty(navigator, 'maxTouchPoints', { value: 5, configurable: true });

        gallery._applyState({ pluginSettings: { lb_enabled: false } });
        const { player } = makePlayer();
        setPlayerReadyState(player, 0);

        const p = gallery.showGalleryFrame(30, '0:30');
        await resolveGalleryVideoFrame(player);
        await p;
        mockGalleryImageLayout();

        const viewport = document.getElementById('sprite-gallery-viewport');
        const media = gallery.getActiveGalleryMediaElement();

        // Pinch gesture should activate even on tablet-sized viewport
        const startEvent = createGalleryTouchEvent('touchstart', [
            makeGalleryTouch(1, 100, 90),
            makeGalleryTouch(2, 220, 90)
        ]);
        viewport.ontouchstart(startEvent);
        expect(startEvent.preventDefault).toHaveBeenCalled();

        const moveEvent = createGalleryTouchEvent('touchmove', [
            makeGalleryTouch(1, 70, 90),
            makeGalleryTouch(2, 250, 90)
        ]);
        viewport.ontouchmove(moveEvent);
        expect(moveEvent.preventDefault).toHaveBeenCalled();

        viewport.ontouchend(createGalleryTouchEvent('touchend', []));
        expect(parseFloat(media.dataset.zoomScale)).toBeGreaterThan(1);
    });

    it('sprite preview mounts inside the fullscreen element when video container is fullscreen', async () => {
        gallery._applyState({ pluginSettings: { lb_enabled: false } });
        const { player, videoContainer } = makePlayer();
        gallery._applyState({ currentSceneData: { id: '123', duration: 180, paths: { sprite: '/sprite.jpg' } } });
        setPlayerReadyState(player, 0);

        const p = gallery.showGalleryFrame(30, '0:30');
        await resolveGalleryVideoFrame(player);
        await p;

        // Simulate native fullscreen on the video container (as iPad Safari does)
        videoContainer.requestFullscreen = jest.fn(() => {
            document.fullscreenElement = videoContainer;
            return Promise.resolve();
        });
        await gallery.openGalleryFullscreen();

        // Create a sprite grid so getSpritePreviewDataForTime can return data
        const grid = document.createElement('div');
        grid.id = 'stash-sprite-grid';
        const cell = document.createElement('div');
        cell.className = 'sprite-cell';
        cell.style.backgroundImage = "url('/sprite.jpg')";
        cell.style.backgroundSize = '100% 100%';
        cell.style.backgroundPosition = '0% 0%';
        grid.appendChild(cell);
        document.body.appendChild(grid);

        // Trigger scrubber preview — the preview box should be mounted within
        // the fullscreen element's tree, not on document.body
        const scrubber = document.getElementById('sprite-gallery-scrubber');
        if (scrubber) {
            scrubber.getBoundingClientRect = () => ({
                width: 300, height: 20, top: 700, left: 50,
                right: 350, bottom: 720, x: 50, y: 700,
                toJSON() { return this; }
            });
            gallery.updateNativeScrubberPreview(200);
        }

        const previewBox = document.getElementById('stash-sprite-preview');
        if (previewBox) {
            // Preview must be inside the fullscreen element (videoContainer), not on document.body
            expect(videoContainer.contains(previewBox)).toBe(true);
        }

        grid.remove();
    });

    it('pseudo-fullscreen in HB video mode promotes the video container instead of the overlay', async () => {
        // Simulate iPhone: mobile layout, touch capable, fullscreen API unavailable
        setMobileGalleryLayout(true);
        Object.defineProperty(navigator, 'maxTouchPoints', { value: 5, configurable: true });
        fullscreenSpy = jest.fn(() => Promise.reject(new Error('unsupported')));
        gallery._applyState({ pluginSettings: { lb_enabled: false } });
        const { player, videoContainer } = makePlayer();
        setPlayerReadyState(player, 0);

        const p = gallery.showGalleryFrame(30, '0:30');
        await resolveGalleryVideoFrame(player);
        await p;

        // Enter pseudo-fullscreen (all requestFullscreen calls fail on iPhone)
        await gallery.openGalleryFullscreen();

        const overlay = document.getElementById('sprite-gallery-overlay');
        // Video container should be promoted to fixed fullscreen
        expect(videoContainer.classList.contains('stash-gallery-container-fullscreen')).toBe(true);
        // Overlay should NOT have the fixed fullscreen class (stays absolute inside container)
        expect(overlay.classList.contains('gallery-overlay-fullscreen')).toBe(false);
        // Video should still be inside the container and visible
        expect(videoContainer.contains(player)).toBe(true);

        // Exit pseudo-fullscreen
        await gallery.exitGalleryFullscreen();
        expect(videoContainer.classList.contains('stash-gallery-container-fullscreen')).toBe(false);
    });

    it('exitGalleryFullscreen works even when document.exitFullscreen throws', async () => {
        setMobileGalleryLayout(true);
        fullscreenSpy = jest.fn(() => Promise.reject(new Error('unsupported')));
        gallery._applyState({ pluginSettings: { lb_enabled: false } });
        const { player } = makePlayer();
        setPlayerReadyState(player, 0);

        const p = gallery.showGalleryFrame(30, '0:30');
        await resolveGalleryVideoFrame(player);
        await p;

        await gallery.openGalleryFullscreen();
        const overlay = document.getElementById('sprite-gallery-overlay');
        expect(overlay.dataset.overlayFullscreen).toBe('true');

        // Make exitFullscreen throw synchronously
        document.exitFullscreen = () => { throw new Error('No fullscreen'); };

        await gallery.exitGalleryFullscreen();
        expect(overlay.dataset.overlayFullscreen).toBe('false');
    });

    // --- Toolbar button tests ---

    it('injects gallery toolbar button into the video.js control bar', () => {
        const { videoContainer } = makePlayer();
        const controlBar = document.createElement('div');
        controlBar.className = 'vjs-control-bar';
        const fsControl = document.createElement('div');
        fsControl.className = 'vjs-fullscreen-control';
        controlBar.appendChild(fsControl);
        videoContainer.appendChild(controlBar);

        expect(gallery.injectGalleryToolbarButton()).toBe(true);

        const btn = document.getElementById('gallery-mode-btn');
        expect(btn).toBeTruthy();
        expect(btn.classList.contains('vjs-control')).toBe(true);
        expect(btn.classList.contains('vjs-button')).toBe(true);
        expect(btn.querySelector('svg')).toBeTruthy();
        // Inserted before the fullscreen control
        expect(btn.nextSibling).toBe(fsControl);
    });

    it('does not duplicate the toolbar button on repeated calls', () => {
        makePlayer();
        const controlBar = document.createElement('div');
        controlBar.className = 'vjs-control-bar';
        document.body.appendChild(controlBar);

        gallery.injectGalleryToolbarButton();
        gallery.injectGalleryToolbarButton();
        expect(document.querySelectorAll('#gallery-mode-btn').length).toBe(1);
    });

    it('clicking toolbar button toggles gallery mode on and off', async () => {
        gallery._applyState({ pluginSettings: { lb_enabled: false } });
        const { player } = makePlayer();
        setPlayerReadyState(player, HTMLMediaElement.HAVE_CURRENT_DATA);
        player.currentTime = 20;

        const controlBar = document.createElement('div');
        controlBar.className = 'vjs-control-bar';
        document.body.appendChild(controlBar);
        gallery.injectGalleryToolbarButton();

        const btn = document.getElementById('gallery-mode-btn');

        // Toggle ON
        btn.click();
        await resolveGalleryVideoFrame(player);
        await new Promise(r => setTimeout(r, 0));
        expect(gallery.isGalleryModeOn()).toBe(true);
        expect(btn.classList.contains('active')).toBe(true);
        expect(document.getElementById('sprite-gallery-overlay')).toBeTruthy();

        // Toggle OFF
        btn.click();
        expect(gallery.isGalleryModeOn()).toBe(false);
        expect(btn.classList.contains('active')).toBe(false);
        expect(document.getElementById('sprite-gallery-overlay')).toBeNull();
    });

    it('closing gallery via X button also deactivates toolbar button', async () => {
        const { player } = makePlayer();
        const controlBar = document.createElement('div');
        controlBar.className = 'vjs-control-bar';
        document.body.appendChild(controlBar);
        gallery.injectGalleryToolbarButton();

        const p = gallery.showGalleryAtTime(10);
        lastWebSocket._fireOpen();
        lastWebSocket._fireMessage(new Blob(['jpeg'], { type: 'image/jpeg' }));
        await p;

        const btn = document.getElementById('gallery-mode-btn');
        gallery._applyState({ galleryActive: true });
        gallery.syncGalleryToolbarButtonState();
        expect(btn.classList.contains('active')).toBe(true);

        gallery.exitGallery();
        expect(btn.classList.contains('active')).toBe(false);
    });

    it('spritetab:cellactivate opens gallery when gallery mode is on', async () => {
        const { player } = makePlayer();
        gallery._applyState({ galleryActive: true });

        // Bind the listener (normally done in init)
        const handler = (e) => {
            if (!gallery.isGalleryModeOn()) return;
            e.preventDefault();
            gallery.showGalleryAtTime(e.detail.time);
        };
        document.addEventListener('spritetab:cellactivate', handler);

        const event = new CustomEvent('spritetab:cellactivate', {
            detail: { time: 15 },
            cancelable: true
        });
        document.dispatchEvent(event);

        expect(document.getElementById('sprite-gallery-overlay')).toBeTruthy();
        document.removeEventListener('spritetab:cellactivate', handler);
    });

    it('spritetab:cellactivate is ignored when gallery mode is off', () => {
        makePlayer();
        gallery._applyState({ galleryActive: false });

        const handler = (e) => {
            if (!gallery.isGalleryModeOn()) return;
            e.preventDefault();
            gallery.showGalleryAtTime(e.detail.time);
        };
        document.addEventListener('spritetab:cellactivate', handler);

        const event = new CustomEvent('spritetab:cellactivate', {
            detail: { time: 15 },
            cancelable: true
        });
        document.dispatchEvent(event);

        expect(document.getElementById('sprite-gallery-overlay')).toBeNull();
        document.removeEventListener('spritetab:cellactivate', handler);
    });

    it('toolbar button reflects active state on injection when gallery mode is on', () => {
        makePlayer();
        const controlBar = document.createElement('div');
        controlBar.className = 'vjs-control-bar';
        document.body.appendChild(controlBar);

        gallery._applyState({ galleryActive: true });
        gallery.injectGalleryToolbarButton();

        const btn = document.getElementById('gallery-mode-btn');
        expect(btn.classList.contains('active')).toBe(true);
    });

    describe('Default Mode persistence', () => {
        const GALLERY_STATE_STORAGE_KEY = 'gallery_mode_state';

        beforeEach(() => {
            window.history.pushState({}, '', '/scenes/123');
        });

        it('getDefaultMode returns remember for missing or invalid values', () => {
            expect(gallery.getDefaultMode(undefined)).toBe('remember');
            expect(gallery.getDefaultMode({})).toBe('remember');
            expect(gallery.getDefaultMode({ general_default_mode: 'bogus' })).toBe('remember');
            expect(gallery.getDefaultMode({ general_default_mode: 'remember' })).toBe('remember');
            expect(gallery.getDefaultMode({ general_default_mode: 'always_on' })).toBe('always_on');
            expect(gallery.getDefaultMode({ general_default_mode: 'always_off' })).toBe('always_off');
        });

        it('applyInitialState with always_on opens the gallery', () => {
            makePlayer();
            gallery._applyState({ defaultMode: 'always_on' });

            gallery.applyInitialState();

            expect(gallery.isGalleryModeOn()).toBe(true);
        });

        it('applyInitialState with always_off keeps the gallery closed and clears saved state', () => {
            makePlayer();
            localStorage.setItem(GALLERY_STATE_STORAGE_KEY, 'true');
            gallery._applyState({ defaultMode: 'always_off' });

            gallery.applyInitialState();

            expect(gallery.isGalleryModeOn()).toBe(false);
            expect(localStorage.getItem(GALLERY_STATE_STORAGE_KEY)).toBe('false');
        });

        it('applyInitialState with remember opens the gallery when saved state is true', () => {
            makePlayer();
            localStorage.setItem(GALLERY_STATE_STORAGE_KEY, 'true');
            gallery._applyState({ defaultMode: 'remember' });

            gallery.applyInitialState();

            expect(gallery.isGalleryModeOn()).toBe(true);
        });

        it('applyInitialState with remember keeps the gallery closed when saved state is false', () => {
            makePlayer();
            localStorage.setItem(GALLERY_STATE_STORAGE_KEY, 'false');
            gallery._applyState({ defaultMode: 'remember' });

            gallery.applyInitialState();

            expect(gallery.isGalleryModeOn()).toBe(false);
        });

        it('applyInitialState is a no-op on non-scene pages', () => {
            window.history.pushState({}, '', '/');
            makePlayer();
            localStorage.setItem(GALLERY_STATE_STORAGE_KEY, 'true');
            gallery._applyState({ defaultMode: 'always_on' });

            gallery.applyInitialState();

            expect(gallery.isGalleryModeOn()).toBe(false);
        });

        it('toggleGalleryMode persists state in remember mode', () => {
            const { player } = makePlayer();
            setPlayerReadyState(player, HTMLMediaElement.HAVE_CURRENT_DATA);
            const controlBar = document.createElement('div');
            controlBar.className = 'vjs-control-bar';
            document.body.appendChild(controlBar);
            gallery.injectGalleryToolbarButton();
            gallery._applyState({ defaultMode: 'remember' });

            gallery.toggleGalleryMode();
            expect(localStorage.getItem(GALLERY_STATE_STORAGE_KEY)).toBe('true');

            gallery.toggleGalleryMode();
            expect(localStorage.getItem(GALLERY_STATE_STORAGE_KEY)).toBe('false');
        });

        it('toggleGalleryMode does not persist state in always_on mode', () => {
            const { player } = makePlayer();
            setPlayerReadyState(player, HTMLMediaElement.HAVE_CURRENT_DATA);
            const controlBar = document.createElement('div');
            controlBar.className = 'vjs-control-bar';
            document.body.appendChild(controlBar);
            gallery.injectGalleryToolbarButton();
            gallery._applyState({ defaultMode: 'always_on' });

            gallery.toggleGalleryMode();

            expect(localStorage.getItem(GALLERY_STATE_STORAGE_KEY)).toBeNull();
        });

        it('exitGallery alone (cleanup path) does not persist state in remember mode', async () => {
            makePlayer();
            const p = gallery.showGalleryAtTime(10);
            lastWebSocket._fireOpen();
            lastWebSocket._fireMessage(new Blob(['jpeg'], { type: 'image/jpeg' }));
            await p;
            gallery._applyState({ defaultMode: 'remember' });

            // localStorage is empty going in; cleanup-style exitGallery should
            // not write anything to it.
            gallery.exitGallery();

            expect(localStorage.getItem(GALLERY_STATE_STORAGE_KEY)).toBeNull();
        });
    });
});
