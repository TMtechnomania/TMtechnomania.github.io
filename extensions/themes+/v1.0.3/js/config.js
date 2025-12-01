// Shared constants for the extension
export const WALLPAPER_JSON_URL =
	"https://buildwithkt.dev/extensions/themes+/assets/wallpaper.json";

// IndexedDB Config
export const IDB_NAME = "themes-assets";
// Bump DB version to create separate stores for thumbnails and media
export const IDB_VERSION = 1;
export const IDB_STORE_THUMBS = "thumbs"; // Store for thumbnails
export const IDB_STORE_MEDIA = "media"; // Store for full media assets

// Chrome Storage Keys
export const STORAGE_KEY_DB = "wallpaperDB"; // Key for the manifest JSON
export const STORAGE_KEY_SETTINGS = "userSettings"; // For user settings

// Default settings
export const DEFAULT_CONFIG = {
	wallpaper: {
		type: "img", //mono, img, vdo
		mode: "random",
		specific: null,
		last_id: "img-001", // ID of last rendered wallpaper for 'sequence' mode
		blur: 8, // in pixels
		brightness: 100, // in percentage
		contrast: 110, // in percentage
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
	},
	// Font settings: default to Google Outfit
	font: {
		family: 'Outfit',
		// Default import URL for Outfit with common weights
		importUrl: 'https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;700;800&display=swap'
	},
	theme: 'system'
};

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