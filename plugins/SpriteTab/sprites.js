(function () {
    'use strict';
    
    // --- CONFIGURATION ---
    const STORAGE_KEY = 'stash_plugin_sprite_settings';
    const SPRITE_WIDTH_GUESS = 160;
    const DEFAULTS = { cols: 4, showTime: true, compact: false, autoScroll: true };

    // --- HELPERS ---
    function getSettings() {
        try {
            return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORAGE_KEY)) };
        } catch (e) { return DEFAULTS; }
    }

    function saveSettings(newSettings) {
        const merged = { ...getSettings(), ...newSettings };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
        return merged;
    }

    function formatTime(seconds) {
        if (!seconds) return "0:00";
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        return h > 0 
            ? `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
            : `${m}:${s.toString().padStart(2, '0')}`;
    }

    function getPlayer() {
        return document.querySelector('video.vjs-tech') || document.querySelector('video');
    }

    // --- INJECT CUSTOM STYLES ---
    function injectStyles() {
        if (document.getElementById('stash-sprites-css')) return;
        const style = document.createElement('style');
        style.id = 'stash-sprites-css';
        style.textContent = `
            .tab-content.stash-plugin-sprites-active > .tab-pane {
                display: none !important;
            }
            .tab-content.stash-plugin-sprites-active > #sprites-panel {
                display: block !important;
            }
        `;
        document.head.appendChild(style);
    }

    async function stashGQL(query, variables) {
        const response = await fetch('/graphql', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query, variables })
        });
        const json = await response.json();
        return json.data;
    }

    async function getSceneData(sceneId) {
        const query = `query FindScene($id: ID!) { findScene(id: $id) { id files { duration } paths { sprite } } }`;
        try {
            const data = await stashGQL(query, { id: sceneId });
            const scene = data.findScene;
            if (!scene) return null;
            scene.duration = (scene.files?.[0]?.duration) || 0;
            return scene;
        } catch (e) { return null; }
    }

    // --- UI RENDERER ---
    function renderControls(container, updateCallback) {
        const settings = getSettings();
        const bar = document.createElement('div');
        
        // Sticky positioning to keep controls visible
        bar.style.cssText = `
            padding: 10px; 
            display: flex; 
            flex-wrap: wrap; 
            align-items: center; 
            gap: 15px; 
            background: rgba(30, 30, 30, 0.95); 
            border-bottom: 1px solid #444;
            margin-bottom: 15px; 
            border-radius: 0 0 5px 5px; 
            font-size: 14px;
            position: sticky;
            top: 0;
            z-index: 100;
            backdrop-filter: blur(5px);
        `;

        const colWrapper = document.createElement('div');
        colWrapper.style.cssText = 'display: flex; align-items: center; gap: 5px; flex-grow: 1;';
        colWrapper.innerHTML = `<span>Size:</span>`;
        const slider = document.createElement('input');
        slider.type = 'range'; slider.min = '1'; slider.max = '12'; slider.value = settings.cols;
        slider.style.cssText = 'cursor: pointer; flex-grow: 1; max-width: 200px;';
        slider.oninput = (e) => {
            saveSettings({ cols: parseInt(e.target.value) });
            updateCallback('cols');
        };
        colWrapper.appendChild(slider);
        bar.appendChild(colWrapper);

        const createToggle = (label, key) => {
            const labelEl = document.createElement('label');
            labelEl.style.cssText = 'display: flex; align-items: center; gap: 5px; cursor: pointer; margin: 0;';
            const check = document.createElement('input');
            check.type = 'checkbox'; check.checked = settings[key];
            check.onchange = (e) => {
                saveSettings({ [key]: e.target.checked });
                updateCallback(key);
            };
            labelEl.appendChild(check);
            labelEl.appendChild(document.createTextNode(label));
            return labelEl;
        };

        bar.appendChild(createToggle('Timestamps', 'showTime'));
        bar.appendChild(createToggle('Compact', 'compact'));
        bar.appendChild(createToggle('Auto-Scroll', 'autoScroll'));
        return bar;
    }

    function renderSpriteGrid(sceneData) {
        if (!sceneData?.paths?.sprite) return null;

        const mainContainer = document.createElement('div');
        // Removed fixed height constraints
        mainContainer.style.cssText = "width: 100%; display: flex; flex-direction: column;";

        const scrollArea = document.createElement('div');
        scrollArea.className = 'sprite-scroll-area';
        // Removed max-height and overflow-y: auto.
        // Added padding-bottom to ensure the last row isn't cut off by page footers.
        scrollArea.style.cssText = 'position: relative; width: 100%; padding-bottom: 50px;';

        const grid = document.createElement('div');
        const s = getSettings();
        grid.style.cssText = `display: grid; grid-template-columns: repeat(${s.cols}, 1fr); gap: ${s.compact ? '0' : '5px'}; padding-right: 5px;`;

        const cells = [];
        let totalSpritesCount = 0;

        const updateUI = (key) => {
            const ns = getSettings();
            if (key === 'cols') grid.style.gridTemplateColumns = `repeat(${ns.cols}, 1fr)`;
            if (key === 'compact') {
                grid.style.gap = ns.compact ? '0px' : '5px';
                cells.forEach(c => {
                    c.element.style.border = ns.compact ? 'none' : '1px solid #333';
                    c.element.style.borderRadius = ns.compact ? '0' : '4px';
                });
            }
            if (key === 'showTime') {
                grid.querySelectorAll('.sprite-timestamp').forEach(el => el.style.display = ns.showTime ? 'block' : 'none');
            }
        };

        mainContainer.appendChild(renderControls(mainContainer, updateUI));
        mainContainer.appendChild(scrollArea);

        const img = new Image();
        img.src = sceneData.paths.sprite;
        img.onload = () => {
            const sourceW = img.naturalWidth;
            const sourceH = img.naturalHeight;
            const sourceCols = Math.round(sourceW / SPRITE_WIDTH_GUESS);
            const singleH = (sourceW / sourceCols) * (9/16);
            const sourceRows = Math.round(sourceH / singleH);
            totalSpritesCount = sourceCols * sourceRows;

            for (let i = 0; i < totalSpritesCount; i++) {
                const cell = document.createElement('div');
                cell.className = 'sprite-cell';
                cell.style.cssText = `width: 100%; aspect-ratio: 16/9; background-image: url('${sceneData.paths.sprite}'); background-repeat: no-repeat; cursor: pointer; position: relative;`;
                cell.style.border = getSettings().compact ? 'none' : '1px solid #333';
                cell.style.borderRadius = getSettings().compact ? '0' : '4px';
                
                cell.style.backgroundSize = `${sourceCols * 100}%`;
                const colIdx = i % sourceCols;
                const rowIdx = Math.floor(i / sourceCols);
                cell.style.backgroundPosition = `${(colIdx / (sourceCols - 1)) * 100}% ${(rowIdx / (sourceRows - 1)) * 100}%`;

                const time = (i / totalSpritesCount) * sceneData.duration;
                
                if (getSettings().showTime) {
                    const ts = document.createElement('span');
                    ts.className = 'sprite-timestamp';
                    ts.innerText = formatTime(time);
                    ts.style.cssText = 'position: absolute; bottom: 0; right: 0; background: rgba(0,0,0,0.7); color: #fff; font-size: 11px; padding: 1px 4px; pointer-events: none;';
                    cell.appendChild(ts);
                }

                cell.onclick = () => {
                    const p = getPlayer();
                    if (p) { p.currentTime = time; p.play(); }
                };

                cell.onmouseenter = () => { if(!getSettings().compact) cell.style.borderColor = '#fff'; };
                cell.onmouseleave = () => { if(!getSettings().compact) cell.style.border = '1px solid #333'; };

                cells.push({ element: cell, time: time });
                grid.appendChild(cell);
            }
            scrollArea.appendChild(grid);
            attachVideoListeners(cells, sceneData.duration);
        };

        return mainContainer;
    }

    function attachVideoListeners(cells, duration) {
        let currentActiveIndex = -1;
        const total = cells.length;

        const update = () => {
            const player = getPlayer();
            if (!player) return;

            const idx = Math.floor((player.currentTime / duration) * total);
            const safeIdx = Math.max(0, Math.min(idx, total - 1));

            if (safeIdx !== currentActiveIndex) {
                if (currentActiveIndex >= 0 && cells[currentActiveIndex]) {
                    cells[currentActiveIndex].element.style.boxShadow = 'none';
                    cells[currentActiveIndex].element.style.zIndex = '0';
                }
                if (cells[safeIdx]) {
                    cells[safeIdx].element.style.boxShadow = 'inset 0 0 0 2px #00BFFF';
                    cells[safeIdx].element.style.zIndex = '1';
                    currentActiveIndex = safeIdx;
                }
            }
        };

        const poller = setInterval(() => {
            const player = getPlayer();
            if (player) {
                player.addEventListener('timeupdate', update);
                if (getSettings().autoScroll) {
                    update();
                    if (currentActiveIndex >= 0 && cells[currentActiveIndex]) {
                        // For page scrolling, we use 'center' to avoid jumping the whole page too aggressively
                        cells[currentActiveIndex].element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                }
                clearInterval(poller);
            }
        }, 1000);
    }

    // --- MAIN LOGIC ---
    async function init(sceneId) {
        if (document.getElementById('tab-sprites-nav')) return;

        const navTabs = document.querySelector('.nav-tabs');
        if (!navTabs) return;

        injectStyles();

        const tabItem = document.createElement('div');
        tabItem.className = 'nav-item';
        tabItem.innerHTML = `<a id="tab-sprites-nav" href="#" role="tab" class="nav-link">Sprites</a>`;
        navTabs.appendChild(tabItem);

        const firstPane = document.querySelector('.tab-content .tab-pane');
        const tabContent = firstPane ? firstPane.parentElement : navTabs.nextElementSibling;
        if (!tabContent) return;

        const tabPane = document.createElement('div');
        tabPane.id = 'sprites-panel';
        tabPane.className = 'tab-pane'; 
        tabContent.appendChild(tabPane);

        const data = await getSceneData(sceneId);
        const grid = renderSpriteGrid(data);
        if (grid) tabPane.appendChild(grid);
        else tabPane.innerHTML = '<div style="padding:20px;">No sprites available.</div>';

        // Event Handling
        navTabs.addEventListener('click', (e) => {
            const link = e.target.closest('.nav-link');
            if (!link) return;

            if (link.id === 'tab-sprites-nav') {
                e.preventDefault();
                e.stopPropagation(); 
                
                navTabs.querySelectorAll('.nav-link').forEach(n => n.classList.remove('active'));
                link.classList.add('active');

                tabContent.classList.add('stash-plugin-sprites-active');

                if (getSettings().autoScroll) {
                    const activeCell = tabPane.querySelector('.sprite-cell[style*="box-shadow"]');
                    if (activeCell) activeCell.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }

            } else {
                const myTab = document.getElementById('tab-sprites-nav');
                if (myTab) myTab.classList.remove('active');
                
                tabContent.classList.remove('stash-plugin-sprites-active');
            }
        }, { capture: true });
    }

    // --- OBSERVER ---
    const observer = new MutationObserver((mutations) => {
        const match = window.location.pathname.match(/\/scenes\/(\d+)/);
        if (match) {
            const navTabs = document.querySelector('.nav-tabs');
            if (navTabs && !document.getElementById('tab-sprites-nav')) {
                init(match[1]);
            }
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });

})();
