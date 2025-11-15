// Creates and removes a search bar UI on the new tab page.
// The searchbar container id is `searchbar`.

// Ordered by type: default, general, privacy, developer/tech, media, images, social
const ENGINE_MAP = {
    default: { name: 'Search', url: 'https://www.google.com/search?q=' },
    // General search
    google: { name: 'Google', url: 'https://www.google.com/search?q=' },
    bing: { name: 'Bing', url: 'https://www.bing.com/search?q=' },
    // Privacy-focused
    duckduckgo: { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=' },
    // Developer / Tech
    github: { name: 'GitHub', url: 'https://github.com/search?q=' },
    stackoverflow: { name: 'StackOverflow', url: 'https://stackoverflow.com/search?q=' },
    // Media
    youtube: { name: 'YouTube', url: 'https://www.youtube.com/results?search_query=' },
    vimeo: { name: 'Vimeo', url: 'https://vimeo.com/search?q=' },
    spotify: { name: 'Spotify', url: 'https://open.spotify.com/search/' },
    // Images / Graphics
    unsplash: { name: 'Unsplash', url: 'https://unsplash.com/s/photos/' },
    pinterest: { name: 'Pinterest', url: 'https://www.pinterest.com/search/pins/?q=' },
    // Social / Community
    reddit: { name: 'Reddit', url: 'https://www.reddit.com/search/?q=' },
};

// Map engine keys to icon filenames inside assets/icons
const ICON_MAP = {
    default: 'Search--Streamline-Outlined-Material-Symbols.svg',
    google: 'Google-Icon--Streamline-Svg-Logos.svg',
    bing: 'Bing--Streamline-Svg-Logos.svg',
    duckduckgo: 'Duckduckgo--Streamline-Svg-Logos.svg',
    youtube: 'Youtube-Icon--Streamline-Svg-Logos.svg',
    reddit: 'Reddit-Icon--Streamline-Svg-Logos.svg',
    pinterest: 'Pinterest--Streamline-Svg-Logos.svg',
    stackoverflow: 'Stackoverflow-Icon--Streamline-Svg-Logos.svg',
    spotify: 'Spotify-Icon--Streamline-Svg-Logos.svg',
    // Use specific icons when available in assets/icons
    github: 'Github-Icon--Streamline-Svg-Logos.svg',
    unsplash: 'unsplash-svgrepo-com.svg',
    vimeo: 'Vimeo-Icon--Streamline-Svg-Logos.svg',
};

function computePositionStyles(vertical = 'center', horizontal = 'center') {
    // Map align values to percentage offsets as requested: top -> 33%, center -> 50%, bottom -> 67%
    const vMap = { top: '33%', center: '50%', bottom: '67%' };
    const hMap = { left: '33%', center: '50%', right: '67%' };
    const top = vMap[vertical] || vMap.center;
    const left = hMap[horizontal] || hMap.center;
    // Use transform to center the element at the given point
    return {
        position: 'absolute',
        top,
        left,
        transform: 'translate(-50%, -50%)',
        zIndex: 9999,
    };
}

function createIconTitle(engineKey, defaultName, duplicateKey) {
    // Return the engine button directly (no extra wrapper).
    // Content (icon or text) will be added here based on available icons.
    const engineBtn = document.createElement('button');
    engineBtn.type = 'button';
    engineBtn.className = 'engine-current';
    engineBtn.setAttribute('data-engine', engineKey);

    // Determine icon file for the current engine (handle default mapping)
    const iconFile = (engineKey === 'default' && duplicateKey) ? ICON_MAP[duplicateKey] : (ICON_MAP[engineKey] || ICON_MAP.default);
    if (iconFile) {
        const img = document.createElement('img');
        img.className = 'engine-current-icon';
        img.src = `assets/icons/${iconFile}`;
        img.alt = ENGINE_MAP[engineKey]?.name || engineKey;
        img.title = (engineKey === 'default' && defaultName) ? `${defaultName} (Default)` : (ENGINE_MAP[engineKey]?.name || engineKey);
        engineBtn.appendChild(img);
        engineBtn.setAttribute('aria-label', img.title);
    } else {
        const label = (engineKey === 'default' && defaultName) ? `${defaultName} (Default)` : (ENGINE_MAP[engineKey]?.name || engineKey);
        engineBtn.textContent = label;
        engineBtn.setAttribute('aria-label', label);
    }
    return engineBtn;
}

export async function renderSearchbar(searchCfg = {}) {
    try {
        console.log('Rendering searchbar with config:', searchCfg);
        // remove existing if present
        removeSearchbar();

        if (!searchCfg || !searchCfg.enabled) return;

        const cfg = {
            engine: searchCfg.engine || 'default',
            voice_search: !!searchCfg.voice_search,
            vertical_align: searchCfg.vertical_align || 'center',
            horizontal_align: searchCfg.horizontal_align || 'center',
            // 'self' -> same tab, 'blank' -> new tab/window
            target: searchCfg.target || 'blank',
        };

        // Resolve real default engine name when possible (best-effort)
        let defaultName = null;
        try {
            if (typeof browser !== 'undefined' && browser.search && browser.search.get) {
                const info = await browser.search.get();
                if (info && info.name) defaultName = info.name;
            }
        } catch (e) {
            // ignore; best-effort only
        }

        // If defaultName matches one of our known engines, remember that mapping
        const duplicateKey = Object.keys(ENGINE_MAP).find((k) => k !== 'default' && defaultName && ENGINE_MAP[k].name && ENGINE_MAP[k].name.toLowerCase() === defaultName.toLowerCase());

    const wrapper = document.createElement('div');
    wrapper.id = 'searchbar';
    wrapper.setAttribute('role', 'search');

    // Alignment only: position/top/left/transform/zIndex
    Object.assign(wrapper.style, computePositionStyles(cfg.vertical_align, cfg.horizontal_align));
    // Other visual styles are provided via CSS classes in css/newtab.css
    wrapper.className = 'searchbar-wrapper';

        // Left: current engine button (chips toggle)
        const left = createIconTitle(cfg.engine, defaultName, duplicateKey);

        // Middle: input
    const input = document.createElement('input');
    input.type = 'search';
    input.id = 'search-input';
    input.className = 'search-input';
        // Placeholder reflects the selected engine
        function engineDisplayName(engineKey) {
            if (engineKey === 'default' && defaultName) return defaultName;
            return (ENGINE_MAP[engineKey] && ENGINE_MAP[engineKey].name) || null;
        }

        function placeholderFor(engineKey) {
            // For the 'default' engine we always show the generic placeholder
            if (engineKey === 'default') return 'Search...';
            const name = engineDisplayName(engineKey);
            if (!name) return 'Search...';
            return `Search with ${name}...`;
        }

        input.placeholder = placeholderFor(cfg.engine);

        // Right: voice icon and search button (append directly to wrapper)
        const voiceBtn = document.createElement('button');
        voiceBtn.type = 'button';
        voiceBtn.id = 'search-voice-btn';
        voiceBtn.className = 'search-voice-btn';
        voiceBtn.title = 'Voice search';
        if (!cfg.voice_search) {
            voiceBtn.classList.add('searchbar-hidden');
        } else {
            // Keep the button in the weak primary state when idle; only switch
            // to solid primary while actively listening (toggled by 'listening').
            const micImg = document.createElement('img');
            micImg.src = 'assets/icons/Mic--Streamline-Outlined-Material-Symbols.svg';
            micImg.alt = 'Mic';
            micImg.style.width = '20px';
            micImg.style.height = '20px';
            voiceBtn.appendChild(micImg);
        }

        // Search button
    const searchBtn = document.createElement('button');
    searchBtn.type = 'button';
    searchBtn.id = 'search-btn';
    searchBtn.className = 'search-btn';
    searchBtn.title = 'Search';
    searchBtn.textContent = 'Search';

    // Append voice and search buttons directly to the wrapper (no right container)
    // They are flex items on the wrapper.
    

        // Assemble: engine button, input, voice and search buttons
        wrapper.appendChild(left);
        wrapper.appendChild(input);
        wrapper.appendChild(voiceBtn);
        wrapper.appendChild(searchBtn);

        // Create chips container (hidden by default). We'll populate via helper
        const chips = document.createElement('div');
        chips.className = 'search-engine-chips';

        // Helper to (re)populate chips, skipping the currently active engine key
        function populateChips(activeEngineKey) {
            chips.innerHTML = '';
            Object.keys(ENGINE_MAP).forEach((k) => {
                // Never include the active/selected engine as a chip
                if (k === activeEngineKey) return;

                // Duplicate avoidance when browser default maps to a known engine
                if (defaultName && duplicateKey) {
                    // If the UI is currently showing the 'default' engine in the left pill,
                    // skip the explicit duplicate engine chip (e.g., skip 'google' when
                    // left pill shows 'Google (Default)').
                    if (activeEngineKey === 'default' && k === duplicateKey) return;
                    // Otherwise (we're using an explicit engine), skip the 'default' chip
                    // so we don't show both 'Google (Default)' and 'Google'.
                    if (activeEngineKey !== 'default' && k === 'default') return;
                }

                const chip = document.createElement('button');
                chip.type = 'button';
                chip.className = 'search-engine-chip';
                chip.setAttribute('data-engine', k);
                // Use SVG icon inside the chip when available; fall back to text
                const iconFile = (k === 'default' && duplicateKey) ? ICON_MAP[duplicateKey] : (ICON_MAP[k] || ICON_MAP.default);
                if (iconFile) {
                    const img = document.createElement('img');
                    img.className = 'engine-chip-icon';
                    img.src = `assets/icons/${iconFile}`;
                    img.alt = ENGINE_MAP[k].name || k;
                    img.title = (k === 'default' && defaultName) ? `${defaultName} (Default)` : (ENGINE_MAP[k].name || k);
                    chip.appendChild(img);
                    // keep accessible name
                    chip.setAttribute('aria-label', img.title);
                } else {
                    const label = (k === 'default' && defaultName) ? `${defaultName} (Default)` : (ENGINE_MAP[k].name || k);
                    chip.textContent = label;
                    chip.setAttribute('aria-label', label);
                }
                chip.addEventListener('click', (ev) => {
                    ev.stopPropagation();
                    // set current engine on the left pill
                    const engineBtn = wrapper.querySelector('.engine-current');
                    if (engineBtn) {
                        // Update the engine button content (icon or text)
                        engineBtn.setAttribute('data-engine', k);
                        // Remove existing children
                        engineBtn.innerHTML = '';
                        const iconFile = (k === 'default' && duplicateKey) ? ICON_MAP[duplicateKey] : (ICON_MAP[k] || ICON_MAP.default);
                        if (iconFile) {
                            const img = document.createElement('img');
                            img.className = 'engine-current-icon';
                            img.src = `assets/icons/${iconFile}`;
                            img.alt = ENGINE_MAP[k]?.name || k;
                            img.title = (k === 'default' && defaultName) ? `${defaultName} (Default)` : (ENGINE_MAP[k]?.name || k);
                            engineBtn.appendChild(img);
                            engineBtn.setAttribute('aria-label', img.title);
                        } else {
                            const label = (k === 'default' && defaultName) ? `${defaultName} (Default)` : (ENGINE_MAP[k]?.name || k);
                            engineBtn.textContent = label;
                            engineBtn.setAttribute('aria-label', label);
                        }
                        // Update placeholder to reflect newly selected engine
                        try {
                            input.placeholder = placeholderFor(k);
                        } catch (e) {
                            // ignore
                        }
                    }
                    // Rebuild chips so the newly-selected engine is no longer shown
                    populateChips(k);
                    // close chips
                    wrapper.classList.remove('chips-open');
                    input.focus();
                });
                chips.appendChild(chip);
            });
        }

        // Populate initially with configured engine as active
        populateChips(cfg.engine);
        wrapper.appendChild(chips);

        // Interactions
        function doSearch() {
            const q = (input.value || '').trim();
            if (!q) return;
            const engineBtn = wrapper.querySelector('.engine-current');
            const engineKey = (engineBtn && engineBtn.getAttribute('data-engine')) || cfg.engine || 'default';
            const engineInfo = ENGINE_MAP[engineKey] || ENGINE_MAP.default;
            const url = `${engineInfo.url}${encodeURIComponent(q)}`;
            // Determine target from config: 'self' => same tab, otherwise open new tab
            const target = (cfg.target === 'self' || cfg.target === '_self') ? '_self' : '_blank';
            window.open(url, target);
        }

        searchBtn.addEventListener('click', doSearch);
        input.addEventListener('keydown', (ev) => {
            if (ev.key === 'Enter') doSearch();
        });

        // Voice button: if supported, start SpeechRecognition and place result in input
        voiceBtn.addEventListener('click', async () => {
            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            if (!SpeechRecognition) {
                // Not available; we can flash a message or no-op
                voiceBtn.textContent = '🎤';
                return;
            }
            const recog = new SpeechRecognition();
            recog.lang = 'en-US';
            recog.interimResults = false;
            recog.maxAlternatives = 1;
            // indicate listening state in UI
            try {
                voiceBtn.classList.add('listening');
                recog.start();
            } catch (e) {
                // ignore start errors
            }
            recog.onresult = (e) => {
                const t = e.results && e.results[0] && e.results[0][0] && e.results[0][0].transcript;
                if (t) {
                    input.value = t;
                    doSearch();
                }
            };
            recog.onerror = () => {
                // ignore
            };
            recog.onend = () => {
                // remove listening indicator when recognition stops
                voiceBtn.classList.remove('listening');
            };
        });

        // Toggle chips when engine button clicked
        const engineBtn = wrapper.querySelector('.engine-current');
        if (engineBtn) {
            engineBtn.addEventListener('click', (ev) => {
                ev.stopPropagation();
                wrapper.classList.toggle('chips-open');
            });
        }

        // Close chips when clicking outside
        document.addEventListener('click', (ev) => {
            if (!wrapper.contains(ev.target)) wrapper.classList.remove('chips-open');
        });

        document.body.appendChild(wrapper);
        console.log('Searchbar element created and appended to body');
    } catch (e) {
        console.error('Failed to render searchbar', e);
    }
}

export function removeSearchbar() {
    try {
        const el = document.getElementById('searchbar');
        if (el) el.remove();
    } catch (e) {
        // ignore
    }
}
