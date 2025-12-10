
// Map of font names to their Google Fonts import URLs
const FONT_MAP = {
    'default': null, // Uses system/UI font
    'Bitcount Grid Single': 'https://fonts.googleapis.com/css2?family=Bitcount+Grid+Single&display=swap',
    'PT Serif': 'https://fonts.googleapis.com/css2?family=PT+Serif:wght@400;700&display=swap',
    'Anton': 'https://fonts.googleapis.com/css2?family=Anton&display=swap',
    'Pacifico': 'https://fonts.googleapis.com/css2?family=Pacifico&display=swap',
    'Lobster': 'https://fonts.googleapis.com/css2?family=Lobster&display=swap',
    'Abril Fatface': 'https://fonts.googleapis.com/css2?family=Abril+Fatface&display=swap',
    'Titan One': 'https://fonts.googleapis.com/css2?family=Titan+One&display=swap',
    'Monoton': 'https://fonts.googleapis.com/css2?family=Monoton&display=swap',
    'Kenia': 'https://fonts.googleapis.com/css2?family=Kenia&display=swap',
    'Fredericka the Great': 'https://fonts.googleapis.com/css2?family=Fredericka+the+Great&display=swap',
    'Libertinus Keyboard': 'https://fonts.googleapis.com/css2?family=Libertinus+Keyboard&display=swap',
    'Stardos Stencil': 'https://fonts.googleapis.com/css2?family=Stardos+Stencil:wght@400;700&display=swap',
    
    // New additions
    'Bebas Neue': 'https://fonts.googleapis.com/css2?family=Bebas+Neue&display=swap',
    'Rubik Dirt': 'https://fonts.googleapis.com/css2?family=Rubik+Dirt&display=swap',
    'Moirai One': 'https://fonts.googleapis.com/css2?family=Moirai+One&display=swap',
    'Rubik Glitch': 'https://fonts.googleapis.com/css2?family=Rubik+Glitch&display=swap',
    'Rampart One': 'https://fonts.googleapis.com/css2?family=Rampart+One&display=swap',
    'Rubik Wet Paint': 'https://fonts.googleapis.com/css2?family=Rubik+Wet+Paint&display=swap',
    'Rubik Vinyl': 'https://fonts.googleapis.com/css2?family=Rubik+Vinyl&display=swap',
    'Notable': 'https://fonts.googleapis.com/css2?family=Notable&display=swap',
    'Plaster': 'https://fonts.googleapis.com/css2?family=Plaster&display=swap',
    'Tourney': 'https://fonts.googleapis.com/css2?family=Tourney:wght@100..900&display=swap',
    'Kumar One Outline': 'https://fonts.googleapis.com/css2?family=Kumar+One+Outline&display=swap',
    'Foldit': 'https://fonts.googleapis.com/css2?family=Foldit:wght@100..900&display=swap',
    'Rubik 80s Fade': 'https://fonts.googleapis.com/css2?family=Rubik+80s+Fade&display=swap'
};

// Handle special case for Science Gothic if it requires specific query parameters or is hosted differently?
// For now we use standard.

let clockInterval = null;
let currentSettings = null;

export function initClock(settings) {
    currentSettings = settings;
    renderClock();
    startClock();
}

export function updateClockSettings(newSettings) {
    currentSettings = newSettings;
    applyClockStyles();
    // Force immediate update of time string/date visibility
    updateTime(); 
}

function startClock() {
    if (clockInterval) clearInterval(clockInterval);
    updateTime(); // Run immediately
    clockInterval = setInterval(updateTime, 1000);
}

function updateTime() {
    if (!currentSettings || !currentSettings.onScreenClock || !currentSettings.onScreenClock.enabled) {
        const container = document.getElementById('on-screen-clock');
        if (container) container.style.display = 'none';
        return;
    }

    // Ensure anchoring and existence
    ensureAnchoring();
    
    const container = document.getElementById('on-screen-clock');
    if (!container) return; // Should exist now

    container.style.display = 'flex'; // Ensure visible



    const now = new Date();
    // Re-check anchoring every second to handle searchbar toggles
    ensureAnchoring();
    
    const timeEl = container.querySelector('.os-clock-time');
    const dateEl = container.querySelector('.os-clock-date');
    if (!timeEl) return; // specific safety

    // Time Format
    const use24 = currentSettings.actionbar && currentSettings.actionbar.clock && currentSettings.actionbar.clock.format === '24';
    let hours = now.getHours();
    const minutes = now.getMinutes().toString().padStart(2, '0');
    
    if (!use24) {
        const ampm = hours >= 12 ? 'PM' : 'AM';
        hours = hours % 12;
        hours = hours ? hours : 12; 
        timeEl.textContent = `${hours.toString().padStart(2, '0')}:${minutes} ${ampm}`;
    } else {
        timeEl.textContent = `${hours.toString().padStart(2, '0')}:${minutes}`;
    }

    // Date
    if (currentSettings.actionbar && currentSettings.actionbar.date && currentSettings.actionbar.date.enabled) {
        if (dateEl) {
            dateEl.style.display = 'block';
            const options = { weekday: 'long', month: 'long', day: 'numeric' };
            dateEl.textContent = now.toLocaleDateString(undefined, options);
        }
    } else {
        if (dateEl) dateEl.style.display = 'none';
    }
}

function ensureAnchoring() {
    const container = document.getElementById('on-screen-clock');
    if (!container) {
        // If missing, render expects to create it
        renderClock(); 
        return;
    }

    const searchBar = document.getElementById('searchbar');
    
    if (searchBar) {
        // Should be inside searchbar
        if (container.parentNode !== searchBar) {
            // Move to searchbar
            searchBar.prepend(container);
            // Reset styles for flex item
            container.style.position = 'relative';
            container.style.top = 'auto';
            container.style.left = 'auto';
            container.style.transform = 'none';
            // Margin handled by gap in searchbar css? Yes, gap: var(--dis-4)
            container.style.marginBottom = '0'; 
        }
    } else {
        // Should be standalone
        if (container.parentNode !== document.body) {
            document.body.insertBefore(container, document.getElementById('action-bar'));
            // Apply standalone styles
            container.style.position = 'fixed';
            container.style.top = '50%';
            container.style.left = '50%';
            container.style.transform = 'translate(-50%, -50%)';
            container.style.marginBottom = '0';
        }
    }
}

function renderClock() {
    // Check if exists or create
    let container = document.getElementById('on-screen-clock');
    if (!container) {
        container = document.createElement('div');
        container.id = 'on-screen-clock';
        
        const timeEl = document.createElement('div');
        timeEl.className = 'os-clock-time';
        
        const dateEl = document.createElement('div');
        dateEl.className = 'os-clock-date';
        
        container.appendChild(timeEl);
        container.appendChild(dateEl);
        
        // Initial placement - append to body, ensureAnchoring will Fix it immediately
        document.body.appendChild(container);
    }
    
    ensureAnchoring();
    
    applyClockStyles();
}

function applyClockStyles() {
    const container = document.getElementById('on-screen-clock');
    if (!container) return;

    if (!currentSettings || !currentSettings.onScreenClock || !currentSettings.onScreenClock.enabled) {
        container.style.display = 'none';
        return;
    }
    container.style.display = 'flex';

    // Font
    const fontName = currentSettings.onScreenClock.font || 'default';
    if (fontName !== 'default') {
        loadFont(fontName);
        container.style.setProperty('--clock-font', `"${fontName}", sans-serif`);
    } else {
        container.style.removeProperty('--clock-font');
    }

    // Color
    const colorMode = currentSettings.onScreenClock.color || 'default';
    if (colorMode === 'inverse') {
        container.classList.add('color-inverse');
    } else {
        container.classList.remove('color-inverse');
    }
}

function loadFont(fontName) {
    const url = FONT_MAP[fontName];
    if (!url) return;

    const id = `font-${fontName.replace(/\s+/g, '-').toLowerCase()}`;
    if (!document.getElementById(id)) {
        const link = document.createElement('link');
        link.id = id;
        link.rel = 'stylesheet';
        link.href = url;
        document.head.appendChild(link);
    }
}
