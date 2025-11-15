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
		type: "img",
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
		autohide: true, // If true, hides below screen; shows on hover
	},
};