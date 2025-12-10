
import { STORAGE_KEY_SETTINGS, DEFAULT_CONFIG } from './config.js';

// Simple lightweight theme applicator
function applyUserGuideTheme(settings) {
    const root = document.documentElement;
    
    // 1. Theme (Light/Dark/System)
    let theme = settings.theme || 'system';
    if (theme === 'system') {
        root.removeAttribute('data-theme');
    } else {
        root.setAttribute('data-theme', theme);
    }

    // 2. UI Scale
    const scale = settings.uiScale || 1;
    root.style.setProperty('--ui-scale', scale);

    // 3. Font
    const font = settings.font || DEFAULT_CONFIG.font;
    if (font.family) {
        root.style.setProperty('--font-family', `"${font.family}", sans-serif`);
    }
    
    // Load font if needed (simplified loader)
    if (font.importUrl) {
       const id = 'theme-font-link';
       let link = document.getElementById(id);
       if (!link) {
           link = document.createElement('link');
           link.id = id;
           link.rel = 'stylesheet';
           document.head.appendChild(link);
       }
       link.href = font.importUrl;
    }
}

async function loadSettings() {
    return new Promise((resolve) => {
        chrome.storage.local.get(STORAGE_KEY_SETTINGS, (res) => {
            const stored = res?.[STORAGE_KEY_SETTINGS] || {};
            // Merge just enough for theming
            const merged = {
                ...DEFAULT_CONFIG,
                ...stored,
                font: { ...DEFAULT_CONFIG.font, ...(stored.font || {}) }
            };
            resolve(merged);
        });
    });
}

function initNavigation() {
    const sections = document.querySelectorAll('section');
    const navItems = document.querySelectorAll('.ug-nav-item');
    const main = document.querySelector('.ug-main');

    if (!main) return;

    main.addEventListener('scroll', () => {
        let current = '';
        sections.forEach(section => {
            const sectionTop = section.offsetTop;
            // Adjustment for offset
            if (main.scrollTop >= (sectionTop - 150)) {
                current = section.getAttribute('id');
            }
        });

        navItems.forEach(li => {
            li.classList.remove('active');
            if (li.getAttribute('href').includes(current)) {
                li.classList.add('active');
            }
        });
    });
}

// Initialize
(async () => {
    const settings = await loadSettings();
    applyUserGuideTheme(settings);
    initNavigation();
})();
