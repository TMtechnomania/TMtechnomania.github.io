import { loadCSS, unloadCSS } from './cssLoader.js';
import { STORAGE_KEY_SETTINGS, DEFAULT_CONFIG, applyTheme } from './config.js';
import { renderInlineIcon } from './brandIconLoader.js';
import { renderWallpaper } from './wallpaper.js';
import { renderSearchbar, removeSearchbar } from './searchbar.js';
import { initActionBar } from './actionbar.js';

let _settingsModalOpen = false;

export function isSettingsModalOpen() {
    return _settingsModalOpen;
}

export async function toggleSettingsModal() {
    if (_settingsModalOpen) {
        closeSettingsModalIfOpen();
    } else {
        await openSettingsModal();
    }
}

export function closeSettingsModalIfOpen() {
    const el = document.getElementById('settings-modal');
    if (el) {
        try { document.body.removeChild(el); } catch (e) {}
        unloadCSS('settings-css');
        _settingsModalOpen = false;
        
        // Dispatch event so other components know settings closed
        document.dispatchEvent(new CustomEvent('settings:closed'));
    }
}

async function openSettingsModal() {
    await loadCSS('css/settingsModal.css', 'settings-css');

    const modal = document.createElement('div');
    modal.id = 'settings-modal';
    modal.className = 'settings-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');

    // Load current settings
    const currentSettings = await getSettings();

    // Header
    const header = document.createElement('div');
    header.className = 'settings-header';
    
    const title = document.createElement('div');
    title.className = 'settings-title';
    const titleIcon = document.createElement('span');
    titleIcon.className = 'ui-icon settings-title-icon';
    titleIcon.setAttribute('aria-hidden', 'true');
    renderInlineIcon(titleIcon, 'assets/svgs-fontawesome/solid/gear.svg');
    title.appendChild(titleIcon);
    title.appendChild(document.createTextNode(' Settings'));
    
    const closeBtn = document.createElement('button');
    closeBtn.className = 'settings-close';
    const closeIcon = document.createElement('span');
    closeIcon.className = 'ui-icon settings-close-icon';
    closeIcon.setAttribute('aria-hidden', 'true');
    renderInlineIcon(closeIcon, 'assets/svgs-fontawesome/regular/circle-xmark.svg');
    closeBtn.appendChild(closeIcon);
    closeBtn.addEventListener('click', closeSettingsModalIfOpen);

    header.appendChild(title);
    header.appendChild(closeBtn);
    modal.appendChild(header);

    // Body
    const body = document.createElement('div');
    body.className = 'settings-body';

    // Sidebar
    const sidebar = document.createElement('div');
    sidebar.className = 'settings-sidebar';
    
    const content = document.createElement('div');
    content.className = 'settings-content';

    const tabs = [
        { id: 'general', label: 'General', icon: 'assets/svgs-fontawesome/solid/sliders.svg' },
        { id: 'wallpaper', label: 'Wallpaper', icon: 'assets/svgs-fontawesome/regular/image.svg' },
        { id: 'search', label: 'Search', icon: 'assets/svgs-fontawesome/solid/search.svg' },
        { id: 'about', label: 'About', icon: 'assets/svgs-fontawesome/regular/circle-question.svg' }
    ];

    let activeTabId = 'general';

    tabs.forEach(tab => {
        const btn = document.createElement('button');
        btn.className = `settings-tab-btn ${tab.id === activeTabId ? 'active' : ''}`;
        const icon = document.createElement('span');
        icon.className = 'ui-icon settings-tab-icon';
        icon.setAttribute('aria-hidden', 'true');
        renderInlineIcon(icon, tab.icon);
        btn.appendChild(icon);
        const label = document.createElement('span');
        label.textContent = tab.label;
        btn.appendChild(label);
        btn.addEventListener('click', () => {
            // Switch tabs
            sidebar.querySelectorAll('.settings-tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            content.querySelectorAll('.settings-section').forEach(s => s.classList.remove('active'));
            const target = content.querySelector(`#settings-section-${tab.id}`);
            if (target) target.classList.add('active');
        });
        sidebar.appendChild(btn);
    });

    // Sections
    tabs.forEach(tab => {
        const section = document.createElement('div');
        section.id = `settings-section-${tab.id}`;
        section.className = `settings-section ${tab.id === activeTabId ? 'active' : ''}`;
        
        renderSectionContent(section, tab.id, currentSettings);
        content.appendChild(section);
    });

    body.appendChild(sidebar);
    body.appendChild(content);
    modal.appendChild(body);

    document.body.appendChild(modal);
    _settingsModalOpen = true;

    // Close on click outside
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeSettingsModalIfOpen();
    });
}

async function getSettings() {
    return new Promise((resolve) => {
        chrome.storage.local.get(STORAGE_KEY_SETTINGS, (res) => {
            const stored = res?.[STORAGE_KEY_SETTINGS] || {};
            // Deep merge with default config to ensure all keys exist
            const merged = {
                ...DEFAULT_CONFIG,
                ...stored,
                wallpaper: { ...DEFAULT_CONFIG.wallpaper, ...(stored.wallpaper || {}) },
                searchbar: { ...DEFAULT_CONFIG.searchbar, ...(stored.searchbar || {}) },
                actionbar: { ...DEFAULT_CONFIG.actionbar, ...(stored.actionbar || {}) },
                font: { ...DEFAULT_CONFIG.font, ...(stored.font || {}) }
            };
            resolve(merged);
        });
    });
}

async function saveSettings(newSettings) {
    return new Promise((resolve) => {
        chrome.storage.local.set({ [STORAGE_KEY_SETTINGS]: newSettings }, () => {
            resolve();
        });
    });
}

function renderSectionContent(container, tabId, settings) {
    if (tabId === 'general') {
        // Theme
        const themes = [
            { value: 'system', label: 'System' },
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' }
        ];
        addSelect(container, 'Theme', 'Choose your preferred theme.', themes, settings.theme || 'system', (val) => {
            settings.theme = val;
            saveSettings(settings);
            applyTheme(val);
        });

        // Action Bar Autohide
        addToggle(container, 'Auto-hide Action Bar', 'Hide the bottom toolbar when not in use.', settings.actionbar.autohide, (val) => {
            settings.actionbar.autohide = val;
            saveSettings(settings);
            initActionBar(settings.actionbar); // Re-init to apply
        });

        // Font Family
        const fonts = [
            { value: 'Outfit', label: 'Outfit (Default)' },
            { value: 'Inter', label: 'Inter' },
            { value: 'Roboto', label: 'Roboto' },
            { value: 'Open Sans', label: 'Open Sans' },
            { value: 'Lato', label: 'Lato' }
        ];
        addSelect(container, 'Font Family', 'Choose the primary font for the interface.', fonts, settings.font.family, (val) => {
            settings.font.family = val;
            // Update import URL based on selection (simplified for now)
            if (val === 'Outfit') settings.font.importUrl = 'https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;700;800&display=swap';
            if (val === 'Inter') settings.font.importUrl = 'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;700;800&display=swap';
            if (val === 'Roboto') settings.font.importUrl = 'https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500;700&display=swap';
            if (val === 'Open Sans') settings.font.importUrl = 'https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400;600;700&display=swap';
            if (val === 'Lato') settings.font.importUrl = 'https://fonts.googleapis.com/css2?family=Lato:wght@300;400;700&display=swap';
            
            saveSettings(settings);
            // Apply font immediately
            applyFont(settings.font);
        });
    }

    if (tabId === 'wallpaper') {
        // Type
        const types = [
            { value: 'img', label: 'Image' },
            { value: 'video', label: 'Video' }
        ];
        addSelect(container, 'Type', 'Choose between static images or video wallpapers.', types, settings.wallpaper.type, (val) => {
            settings.wallpaper.type = val;
            saveSettings(settings);
            refreshWallpaper(settings);
        });

        // Mode
        const modes = [
            { value: 'random', label: 'Random' },
            { value: 'sequence', label: 'Sequence' },
            { value: 'specific', label: 'Specific (Fixed)' }
        ];
        addSelect(container, 'Mode', 'How wallpapers are cycled.', modes, settings.wallpaper.mode, (val) => {
            settings.wallpaper.mode = val;
            saveSettings(settings);
            // Don't refresh immediately for mode change unless it's specific, to avoid jarring changes
        });

        // Filters Group
        const filterGroup = document.createElement('div');
        filterGroup.className = 'settings-group';
        filterGroup.innerHTML = `<div class="settings-group-title">Visual Filters</div>`;
        container.appendChild(filterGroup);

        addRange(filterGroup, 'Blur', 'px', 0, 20, settings.wallpaper.blur, (val) => {
            settings.wallpaper.blur = val;
            saveSettings(settings);
            updateWallpaperFilters(settings.wallpaper);
        });

        addRange(filterGroup, 'Brightness', '%', 50, 150, settings.wallpaper.brightness, (val) => {
            settings.wallpaper.brightness = val;
            saveSettings(settings);
            updateWallpaperFilters(settings.wallpaper);
        });

        addRange(filterGroup, 'Contrast', '%', 50, 150, settings.wallpaper.contrast, (val) => {
            settings.wallpaper.contrast = val;
            saveSettings(settings);
            updateWallpaperFilters(settings.wallpaper);
        });

        addRange(filterGroup, 'Grayscale', '%', 0, 100, settings.wallpaper.grayscale, (val) => {
            settings.wallpaper.grayscale = val;
            saveSettings(settings);
            updateWallpaperFilters(settings.wallpaper);
        });
    }

    if (tabId === 'search') {
        addToggle(container, 'Enable Search', 'Show the search bar on the new tab.', settings.searchbar.enabled, (val) => {
            settings.searchbar.enabled = val;
            saveSettings(settings);
            if (val) renderSearchbar(settings.searchbar);
            else removeSearchbar();
        });

        const engines = [
            { value: 'default', label: 'Browser Default' },
            { value: 'google', label: 'Google' },
            { value: 'bing', label: 'Bing' },
            { value: 'duckduckgo', label: 'DuckDuckGo' },
            { value: 'youtube', label: 'YouTube' },
            { value: 'reddit', label: 'Reddit' },
            { value: 'github', label: 'GitHub' }
        ];
        addSelect(container, 'Default Engine', 'Primary search engine.', engines, settings.searchbar.engine, (val) => {
            settings.searchbar.engine = val;
            saveSettings(settings);
            if (settings.searchbar.enabled) renderSearchbar(settings.searchbar);
        });

        addToggle(container, 'Voice Search', 'Show microphone icon.', settings.searchbar.voice_search, (val) => {
            settings.searchbar.voice_search = val;
            saveSettings(settings);
            if (settings.searchbar.enabled) renderSearchbar(settings.searchbar);
        });

        const targets = [
            { value: 'self', label: 'Same Tab' },
            { value: 'blank', label: 'New Tab' }
        ];
        addSelect(container, 'Open Results In', 'Where search results open.', targets, settings.searchbar.target, (val) => {
            settings.searchbar.target = val;
            saveSettings(settings);
            // No re-render needed, logic uses latest config
        });
    }

    if (tabId === 'about') {
        const about = document.createElement('div');
        about.style.textAlign = 'center';
        about.style.padding = '40px 20px';
        about.innerHTML = `
            <img src="icons/icon128.png" style="width: 64px; height: 64px; margin-bottom: 16px;">
            <h2 style="margin: 0 0 8px 0;">Themes+ New Tab</h2>
            <p style="color: rgba(255,255,255,0.6); margin-bottom: 24px;">Version 1.0.3</p>
            <p style="max-width: 400px; margin: 0 auto; line-height: 1.6; color: rgba(255,255,255,0.8);">
                A beautiful, customizable dashboard for your new tab. 
                Built with performance and privacy in mind.
            </p>
            <div style="margin-top: 32px;">
                <a href="https://buildwithkt.dev" target="_blank" style="color: #fff; text-decoration: underline; opacity: 0.8;">Website</a>
                &bull;
                <a href="https://github.com/TMtechnomania" target="_blank" style="color: #fff; text-decoration: underline; opacity: 0.8;">GitHub</a>
            </div>
        `;
        container.appendChild(about);
    }
}

// --- Helper Functions for UI Controls ---

function addToggle(container, label, desc, checked, onChange) {
    const row = document.createElement('div');
    row.className = 'setting-row';
    
    const info = document.createElement('div');
    info.className = 'setting-info';
    info.innerHTML = `<div class="setting-label">${label}</div><div class="setting-desc">${desc}</div>`;
    
    const control = document.createElement('div');
    control.className = 'setting-control';
    
    const labelEl = document.createElement('label');
    labelEl.className = 'toggle-switch';
    
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = !!checked;
    input.addEventListener('change', (e) => onChange(e.target.checked));
    
    const slider = document.createElement('span');
    slider.className = 'toggle-slider';
    
    labelEl.appendChild(input);
    labelEl.appendChild(slider);
    control.appendChild(labelEl);
    
    row.appendChild(info);
    row.appendChild(control);
    container.appendChild(row);
}

function addSelect(container, label, desc, options, value, onChange) {
    const row = document.createElement('div');
    row.className = 'setting-row';
    
    const info = document.createElement('div');
    info.className = 'setting-info';
    info.innerHTML = `<div class="setting-label">${label}</div><div class="setting-desc">${desc}</div>`;
    
    const control = document.createElement('div');
    control.className = 'setting-control';
    
    const select = document.createElement('select');
    select.className = 'setting-select';
    options.forEach(opt => {
        const o = document.createElement('option');
        o.value = opt.value;
        o.textContent = opt.label;
        if (opt.value === value) o.selected = true;
        select.appendChild(o);
    });
    
    select.addEventListener('change', (e) => onChange(e.target.value));
    
    control.appendChild(select);
    row.appendChild(info);
    row.appendChild(control);
    container.appendChild(row);
}

function addRange(container, label, unit, min, max, value, onChange) {
    const row = document.createElement('div');
    row.className = 'setting-row';
    
    const info = document.createElement('div');
    info.className = 'setting-info';
    info.innerHTML = `<div class="setting-label">${label}</div>`;
    
    const control = document.createElement('div');
    control.className = 'setting-control';
    
    const wrapper = document.createElement('div');
    wrapper.className = 'range-wrapper';
    
    const input = document.createElement('input');
    input.type = 'range';
    input.className = 'setting-range';
    input.min = min;
    input.max = max;
    input.value = value;
    
    const valDisplay = document.createElement('div');
    valDisplay.className = 'range-value';
    valDisplay.textContent = value + unit;
    
    input.addEventListener('input', (e) => {
        valDisplay.textContent = e.target.value + unit;
        onChange(Number(e.target.value));
    });
    
    wrapper.appendChild(input);
    wrapper.appendChild(valDisplay);
    control.appendChild(wrapper);
    
    row.appendChild(info);
    row.appendChild(control);
    container.appendChild(row);
}

// --- Logic Helpers ---

function updateWallpaperFilters(cfg) {
    const el = document.getElementById('wallpaper');
    if (!el) return;
    
    const parts = [];
    if (cfg.blur > 0) parts.push(`blur(${cfg.blur}px)`);
    if (cfg.brightness !== 100) parts.push(`brightness(${cfg.brightness}%)`);
    if (cfg.contrast !== 100) parts.push(`contrast(${cfg.contrast}%)`);
    if (cfg.grayscale > 0) parts.push(`grayscale(${cfg.grayscale}%)`);
    
    el.style.filter = parts.join(' ');
}

async function refreshWallpaper(settings) {
    // Re-fetch manifest and render
    const manifest = await new Promise(resolve => {
        chrome.storage.local.get('wallpaperDB', res => resolve(res?.wallpaperDB || null));
    });
    if (manifest) {
        renderWallpaper(settings.wallpaper, manifest);
    }
}

function applyFont(fontCfg) {
    if (!fontCfg) return;
    try {
        const existing = document.getElementById('user-font-link');
        if (existing) existing.remove();

        if (fontCfg.importUrl) {
            const link = document.createElement('link');
            link.id = 'user-font-link';
            link.rel = 'stylesheet';
            link.href = fontCfg.importUrl;
            document.head.appendChild(link);
        }

        const family = fontCfg.family || 'Outfit';
        const fallback = "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
        document.documentElement.style.setProperty('--font-family', `${family}, ${fallback}`);
    } catch (e) {
        console.error('applyFont error', e);
    }
}
