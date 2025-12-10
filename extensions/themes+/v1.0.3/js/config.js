// Shared constants for the extension
export const WALLPAPER_JSON_URL =
	"https://buildwithkt.dev/extensions/themes+/assets/wallpaper.json";

// IndexedDB Config
export const IDB_NAME = "themes-assets";
// Bump DB version to create separate stores for thumbnails and media
export const IDB_VERSION = 1;
export const IDB_STORE_THUMBS = "thumbs"; // Store for thumbnails
export const IDB_STORE_MEDIA = "media"; // Store for full media assets
export const IDB_STORE_WALLPAPERS = "wallpapers"; // Store for user uploaded wallpapers

// Chrome Storage Keys
export const STORAGE_KEY_DB = "wallpaperDB"; // Key for the manifest JSON
export const STORAGE_KEY_SETTINGS = "userSettings"; // For user settings

// Default settings
export const DEFAULT_CONFIG = {
	uiScale: 1, // Multiplier: 0.8, 1, 1.2
	wallpaper: {
		type: "img", //mono, img, vdo
		collection: "predefined",
		mode: "random",
		specific: null,
		last_id: "img-001",
		
		// Independent settings per type
		imgSettings: {
			collection: "predefined",
			mode: "random",
			specific: null
		},
		videoSettings: {
			collection: "predefined",
			mode: "random",
			specific: null
		},

		blur: 0, // in pixels
		brightness: 100, // in percentage
		contrast: 100, // in percentage
		grayscale: 0, // in percentage
	},
	searchbar: {
		enabled: true,
		engine: "default", // 'default' means browser default search engine using browser.search API, google, bing, duckduckgo, youtube, reddit, quora, stackoverflow, spotify are other options
		voice_search: true,
		vertical_align: "center", // 'top', 'center', 'bottom'
		horizontal_align: "center", // 'left', 'center', 'right'
		target: "self", // 'self' for same tab, 'blank' for new tab
	},
	actionbar: {
		autohide: false, // Auto-hide the action bar by setting the initial bottom position to -50%.
		clock: {
			enabled: true,
			format: '12', // '12' or '24'
		},
		date: {
			enabled: false,
		},
		alarm: {
			enabled: false, // Show upcoming alarm
		},
		weather: {
			enabled: false,
			apiKey: "",
			city: "", // Optional override
			units: "metric", // metric (Celsius) or imperial (Fahrenheit)
			showHumidity: false,
			showWind: false,
			showFeelsLike: false
		},
        display_style: 'centralised', // 'centralised' or 'spread'
		shortcuts: {
			enabled: true,
		}
	},
    onScreenClock: {
        enabled: false,
        font: "default",
        color: "default"
    },
	// Font settings: default to Google Outfit
	font: {
		family: 'Outfit',
		// Default import URL for Outfit with common weights
		importUrl: 'https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;700;800&display=swap'
	},
	theme: 'system'
};

export const DEFAULT_SHORTCUTS = [
    { id: 's_chrome', title: 'Chrome Web Store', url: 'https://chrome.google.com/webstore', icon: 'assets/svgs-fontawesome/brands/chrome.svg', builtin: true },
    { id: 's_youtube', title: 'YouTube', url: 'https://www.youtube.com', icon: 'assets/svgs-fontawesome/brands/youtube.svg', builtin: true },
    { id: 's_dribbble', title: 'Dribbble', url: 'https://dribbble.com', icon: 'assets/svgs-fontawesome/brands/dribbble.svg', builtin: true },
    { id: 's_mdn', title: 'MDN Web Docs', url: 'https://developer.mozilla.org', icon: 'assets/svgs-fontawesome/brands/firefox-browser.svg', builtin: true }
];

export const DEFAULT_SHORTCUT_ICON_FALLBACK = 'assets/svgs-fontawesome/solid/globe.svg';


const IMAGE_COLOR_STYLE_ID = 'theme-image-color-style';

function updateImageColorStyle() {
	let styleTag = document.getElementById(IMAGE_COLOR_STYLE_ID);
	if (!styleTag) {
		styleTag = document.createElement('style');
		styleTag.id = IMAGE_COLOR_STYLE_ID;
		document.head.appendChild(styleTag);
	}
	styleTag.textContent = 'img { color: var(--text-base); }';
}

export function applyTheme(theme) {
	if (theme === 'system') {
		document.documentElement.removeAttribute('data-theme');
	} else {
		document.documentElement.setAttribute('data-theme', theme);
	}
	updateImageColorStyle();
}