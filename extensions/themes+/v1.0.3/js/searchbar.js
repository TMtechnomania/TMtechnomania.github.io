import { loadCSS, unloadCSS } from './cssLoader.js';

const ENGINE_MAP = {
    default: { name: 'Search', url: 'https://www.google.com/search?q=' },
    google: { name: 'Google', url: 'https://www.google.com/search?q=' },
    bing: { name: 'Bing', url: 'https://www.bing.com/search?q=' },
    duckduckgo: { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=' },
    github: { name: 'GitHub', url: 'https://github.com/search?q=' },
    stackoverflow: { name: 'StackOverflow', url: 'https://stackoverflow.com/search?q=' },
    youtube: { name: 'YouTube', url: 'https://www.youtube.com/results?search_query=' },
    vimeo: { name: 'Vimeo', url: 'https://vimeo.com/search?q=' },
    spotify: { name: 'Spotify', url: 'https://open.spotify.com/search/' },
    unsplash: { name: 'Unsplash', url: 'https://unsplash.com/s/photos/' },
    pinterest: { name: 'Pinterest', url: 'https://www.pinterest.com/search/pins/?q=' },
    reddit: { name: 'Reddit', url: 'https://www.reddit.com/search/?q=' },
};

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
    github: 'Github-Icon--Streamline-Svg-Logos.svg',
    unsplash: 'unsplash-svgrepo-com.svg',
    vimeo: 'Vimeo-Icon--Streamline-Svg-Logos.svg',
};

function computePositionStyles(vertical = 'center', horizontal = 'center') {
    const vMap = { top: '33%', center: '50%', bottom: '67%' };
    const hMap = { left: '33%', center: '50%', right: '67%' };
    const top = vMap[vertical] || vMap.center;
    const left = hMap[horizontal] || hMap.center;
    return {
        position: 'absolute',
        top,
        left,
        transform: 'translate(-50%, -50%)',
        zIndex: 9999,
    };
}

function createIconTitle(engineKey, defaultName, duplicateKey) {
    const engineBtn = document.createElement('button');
    engineBtn.type = 'button';
    engineBtn.className = 'engine-current';
    engineBtn.setAttribute('data-engine', engineKey);

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
        await loadCSS('css/searchbar.css', 'searchbar-css');
        removeSearchbar(true);
        if (!searchCfg || !searchCfg.enabled) return;

        const cfg = {
            engine: searchCfg.engine || 'default',
            voice_search: !!searchCfg.voice_search,
            vertical_align: searchCfg.vertical_align || 'center',
            horizontal_align: searchCfg.horizontal_align || 'center',
            target: searchCfg.target || 'blank',
        };

        let defaultName = null;
        try {
            if (typeof browser !== 'undefined' && browser.search && browser.search.get) {
                const info = await browser.search.get();
                if (info && info.name) defaultName = info.name;
            }
        } catch (e) {
        }

        const duplicateKey = Object.keys(ENGINE_MAP).find((k) => k !== 'default' && defaultName && ENGINE_MAP[k].name && ENGINE_MAP[k].name.toLowerCase() === defaultName.toLowerCase());

    const wrapper = document.createElement('div');
    wrapper.id = 'searchbar';
    wrapper.setAttribute('role', 'search');

    Object.assign(wrapper.style, computePositionStyles(cfg.vertical_align, cfg.horizontal_align));
    wrapper.className = 'searchbar-wrapper';

        const left = createIconTitle(cfg.engine, defaultName, duplicateKey);

    const input = document.createElement('input');
    input.type = 'search';
    input.id = 'search-input';
    input.className = 'search-input';
        function engineDisplayName(engineKey) {
            if (engineKey === 'default' && defaultName) return defaultName;
            return (ENGINE_MAP[engineKey] && ENGINE_MAP[engineKey].name) || null;
        }

        function placeholderFor(engineKey) {
            if (engineKey === 'default') return 'Search...';
            const name = engineDisplayName(engineKey);
            if (!name) return 'Search...';
            return `Search with ${name}...`;
        }

        input.placeholder = placeholderFor(cfg.engine);

        const voiceBtn = document.createElement('button');
        voiceBtn.type = 'button';
        voiceBtn.id = 'search-voice-btn';
        voiceBtn.className = 'search-voice-btn';
        voiceBtn.title = 'Voice search';
        if (!cfg.voice_search) {
            voiceBtn.classList.add('searchbar-hidden');
        } else {
            const micImg = document.createElement('img');
            micImg.src = 'assets/icons/Mic--Streamline-Outlined-Material-Symbols.svg';
            micImg.alt = 'Mic';
            micImg.style.width = '20px';
            micImg.style.height = '20px';
            voiceBtn.appendChild(micImg);
        }

    const searchBtn = document.createElement('button');
    searchBtn.type = 'button';
    searchBtn.id = 'search-btn';
    searchBtn.className = 'search-btn';
    searchBtn.title = 'Search';
    searchBtn.textContent = 'Search';

        wrapper.appendChild(left);
        wrapper.appendChild(input);
        wrapper.appendChild(voiceBtn);
        wrapper.appendChild(searchBtn);

        const chips = document.createElement('div');
        chips.className = 'search-engine-chips';

        function populateChips(activeEngineKey) {
            chips.innerHTML = '';
            Object.keys(ENGINE_MAP).forEach((k) => {
                if (k === activeEngineKey) return;

                if (defaultName && duplicateKey) {
                    if (activeEngineKey === 'default' && k === duplicateKey) return;
                    if (activeEngineKey !== 'default' && k === 'default') return;
                }

                const chip = document.createElement('button');
                chip.type = 'button';
                chip.className = 'search-engine-chip';
                chip.setAttribute('data-engine', k);
                const iconFile = (k === 'default' && duplicateKey) ? ICON_MAP[duplicateKey] : (ICON_MAP[k] || ICON_MAP.default);
                if (iconFile) {
                    const img = document.createElement('img');
                    img.className = 'engine-chip-icon';
                    img.src = `assets/icons/${iconFile}`;
                    img.alt = ENGINE_MAP[k].name || k;
                    img.title = (k === 'default' && defaultName) ? `${defaultName} (Default)` : (ENGINE_MAP[k].name || k);
                    chip.appendChild(img);
                    chip.setAttribute('aria-label', img.title);
                } else {
                    const label = (k === 'default' && defaultName) ? `${defaultName} (Default)` : (ENGINE_MAP[k].name || k);
                    chip.textContent = label;
                    chip.setAttribute('aria-label', label);
                }
                chip.addEventListener('click', (ev) => {
                    ev.stopPropagation();
                    const engineBtn = wrapper.querySelector('.engine-current');
                    if (engineBtn) {
                        engineBtn.setAttribute('data-engine', k);
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
                        try {
                            input.placeholder = placeholderFor(k);
                        } catch (e) {
                        }
                    }
                    populateChips(k);
                    wrapper.classList.remove('chips-open');
                    input.focus();
                });
                chips.appendChild(chip);
            });
        }

        populateChips(cfg.engine);
        wrapper.appendChild(chips);

        function doSearch() {
            const q = (input.value || '').trim();
            if (!q) return;
            const engineBtn = wrapper.querySelector('.engine-current');
            const engineKey = (engineBtn && engineBtn.getAttribute('data-engine')) || cfg.engine || 'default';
            const engineInfo = ENGINE_MAP[engineKey] || ENGINE_MAP.default;
            const url = `${engineInfo.url}${encodeURIComponent(q)}`;
            const target = (cfg.target === 'self' || cfg.target === '_self') ? '_self' : '_blank';
            window.open(url, target);
        }

        searchBtn.addEventListener('click', doSearch);
        input.addEventListener('keydown', (ev) => {
            if (ev.key === 'Enter') doSearch();
        });

        voiceBtn.addEventListener('click', async () => {
            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            if (!SpeechRecognition) {
                voiceBtn.textContent = '🎤';
                return;
            }
            const recog = new SpeechRecognition();
            recog.lang = 'en-US';
            recog.interimResults = false;
            recog.maxAlternatives = 1;
            try {
                voiceBtn.classList.add('listening');
                recog.start();
            } catch (e) {
            }
            recog.onresult = (e) => {
                const t = e.results && e.results[0] && e.results[0][0] && e.results[0][0].transcript;
                if (t) {
                    input.value = t;
                    doSearch();
                }
            };
            recog.onerror = () => {
            };
            recog.onend = () => {
                voiceBtn.classList.remove('listening');
            };
        });

        const engineBtn = wrapper.querySelector('.engine-current');
        if (engineBtn) {
            engineBtn.addEventListener('click', (ev) => {
                ev.stopPropagation();
                wrapper.classList.toggle('chips-open');
            });
        }

        document.addEventListener('click', (ev) => {
            if (!wrapper.contains(ev.target)) wrapper.classList.remove('chips-open');
        });

        document.body.appendChild(wrapper);
        console.log('Searchbar element created and appended to body');
    } catch (e) {
        console.error('Failed to render searchbar', e);
    }
}

export function removeSearchbar(keepCSS = false) {
    try {
        const el = document.getElementById('searchbar');
        if (el) el.remove();
        if (!keepCSS) unloadCSS('searchbar-css');
    } catch (e) {
    }
}