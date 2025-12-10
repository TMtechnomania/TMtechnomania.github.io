import { loadCSS, unloadCSS } from './cssLoader.js';
import { renderInlineIcon } from './brandIconLoader.js';

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
    default: 'assets/svgs-fontawesome/solid/search.svg',
    google: 'assets/svgs-fontawesome/brands/google.svg',
    bing: 'assets/svgs-fontawesome/brands/bing.svg',
    duckduckgo: 'assets/svgs-fontawesome/brands/duckduckgo.svg',
    youtube: 'assets/svgs-fontawesome/brands/youtube.svg',
    reddit: 'assets/svgs-fontawesome/brands/reddit.svg',
    pinterest: 'assets/svgs-fontawesome/brands/pinterest.svg',
    stackoverflow: 'assets/svgs-fontawesome/brands/stack-overflow.svg',
    spotify: 'assets/svgs-fontawesome/brands/spotify.svg',
    github: 'assets/svgs-fontawesome/brands/github.svg',
    unsplash: 'assets/svgs-fontawesome/brands/unsplash.svg',
    vimeo: 'assets/svgs-fontawesome/brands/vimeo.svg',
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
        zIndex: 99,
    };
}

function resolveEngineIcon(engineKey, defaultName, duplicateKey) {
    const iconFile = (engineKey === 'default' && duplicateKey) ? ICON_MAP[duplicateKey] : (ICON_MAP[engineKey] || ICON_MAP.default);
    const label = (engineKey === 'default' && defaultName) ? `${defaultName} (Default)` : (ENGINE_MAP[engineKey]?.name || engineKey);
    return { iconFile, label };
}

function createIconTitle(engineKey, defaultName, duplicateKey) {
    const engineBtn = document.createElement('button');
    engineBtn.type = 'button';
    engineBtn.className = 'engine-current';
    engineBtn.setAttribute('data-engine', engineKey);
    applyEngineButtonIcon(engineBtn, engineKey, defaultName, duplicateKey);
    return engineBtn;
}

function applyEngineButtonIcon(engineBtn, engineKey, defaultName, duplicateKey) {
    if (!engineBtn) return;
    engineBtn.innerHTML = '';
    const { iconFile, label } = resolveEngineIcon(engineKey, defaultName, duplicateKey);
    if (iconFile) {
        const icon = document.createElement('span');
        icon.className = 'engine-current-icon ui-icon';
        icon.setAttribute('aria-hidden', 'true');
        renderInlineIcon(icon, iconFile, { fallbackSrc: ICON_MAP.default });
        engineBtn.appendChild(icon);
        engineBtn.setAttribute('aria-label', label);
    } else {
        engineBtn.textContent = label;
        engineBtn.setAttribute('aria-label', label);
    }
}

export async function renderSearchbar(searchCfg = {}) {
	try {

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

    // Inner Row for search inputs
    const innerRow = document.createElement('div');
    innerRow.className = 'search-row';

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
            const micIcon = document.createElement('span');
            micIcon.className = 'ui-icon search-voice-icon';
            micIcon.setAttribute('aria-hidden', 'true');
            renderInlineIcon(micIcon, 'assets/svgs-fontawesome/solid/microphone.svg');
            voiceBtn.appendChild(micIcon);
        }

    const searchBtn = document.createElement('button');
    searchBtn.type = 'button';
    searchBtn.id = 'search-btn';
    searchBtn.className = 'search-btn';
    searchBtn.title = 'Search';
    searchBtn.textContent = 'Search';

        innerRow.appendChild(left);
        innerRow.appendChild(input);
        innerRow.appendChild(voiceBtn);
        innerRow.appendChild(searchBtn);
        
        wrapper.appendChild(innerRow);

        const chips = document.createElement('div');
        chips.className = 'search-engine-chips';

        function populateChips(activeEngineKey) {
            chips.innerHTML = '';
            let chipIndex = 0;
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
                chip.style.animationDelay = `${chipIndex * 40}ms`;
                chipIndex++;
                const { iconFile, label } = resolveEngineIcon(k, defaultName, duplicateKey);
                if (iconFile) {
                    const icon = document.createElement('span');
                    icon.className = 'engine-chip-icon ui-icon';
                    icon.setAttribute('aria-hidden', 'true');
                    renderInlineIcon(icon, iconFile, { fallbackSrc: ICON_MAP.default });
                    chip.appendChild(icon);
                    chip.setAttribute('aria-label', label);
                } else {
                    chip.textContent = label;
                    chip.setAttribute('aria-label', label);
                }
                chip.addEventListener('click', (ev) => {
                    ev.stopPropagation();
                    const engineBtn = wrapper.querySelector('.engine-current');
                    if (engineBtn) {
                        engineBtn.setAttribute('data-engine', k);
                        applyEngineButtonIcon(engineBtn, k, defaultName, duplicateKey);
                        try {
                            input.placeholder = placeholderFor(k);
                        } catch (e) {
                        }
                    }
                    populateChips(k);
                    wrapper.classList.remove('chips-open');
                    wrapper.classList.remove('chips-closing');
                    input.focus();
                });
                chips.appendChild(chip);
            });
        }

        populateChips(cfg.engine);
        innerRow.appendChild(chips);

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

        function openChips() {
            if (wrapper.classList.contains('chips-open') || wrapper.classList.contains('chips-closing')) return;
            wrapper.classList.remove('chips-closing');
            wrapper.classList.add('chips-open');
            // Reset animation-delay for opening (sequential in)
            const allChips = chips.querySelectorAll('.search-engine-chip');
            allChips.forEach((c, i) => {
                c.style.animationDelay = `${i * 40}ms`;
                c.style.animation = 'none';
                void c.offsetWidth; // Force reflow
                c.style.animation = '';
            });
        }

        function closeChips() {
            if (!wrapper.classList.contains('chips-open') || wrapper.classList.contains('chips-closing')) return;
            const allChips = chips.querySelectorAll('.search-engine-chip');
            const total = allChips.length;
            // Reverse animation-delay for closing (sequential out)
            allChips.forEach((c, i) => {
                c.style.animationDelay = `${(total - 1 - i) * 30}ms`;
                c.style.animation = 'none';
                void c.offsetWidth;
                c.style.animation = 'chipOut 0.15s ease-in forwards';
            });
            wrapper.classList.add('chips-closing');
            wrapper.classList.remove('chips-open');
            // Wait for animation to complete before hiding
            setTimeout(() => {
                wrapper.classList.remove('chips-closing');
            }, total * 30 + 150);
        }

        const engineBtn = wrapper.querySelector('.engine-current');
        if (engineBtn) {
            engineBtn.addEventListener('click', (ev) => {
                ev.stopPropagation();
                if (wrapper.classList.contains('chips-open')) {
                    closeChips();
                } else {
                    openChips();
                }
            });
        }

        document.addEventListener('click', (ev) => {
            if (!wrapper.contains(ev.target) && wrapper.classList.contains('chips-open')) {
                closeChips();
            }
        });

        document.body.appendChild(wrapper);

    } catch (e) {
        // console.error('Failed to render searchbar', e);
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