// Shared constants for the extension
export const WALLPAPER_JSON_URL =
	"https://buildwithkt.dev/extensions/themes+/assets/wallpaper.json";

// Built-in wallpaper filter presets. These are global (they are not tied to a
// particular wallpaper) and map 1:1 onto the Visual Filters sliders.
// "none" restores the neutral default. The user can also save one custom
// preset (see `wallpaper.customPreset`).
export const FILTER_PRESETS = {
	none: {
		label: "None",
		blur: 0,
		brightness: 100,
		contrast: 100,
		sharpness: 0,
		saturate: 100,
		grayscale: 0,
	},
	vivid: {
		label: "Vivid",
		blur: 0,
		brightness: 120,
		contrast: 150,
		sharpness: 10,
		saturate: 200,
		grayscale: 0,
	},
	cinematic: {
		label: "Cinematic",
		blur: 0,
		brightness: 95,
		contrast: 120,
		sharpness: 25,
		saturate: 85,
		grayscale: 0,
	},
	dreamy: {
		label: "Dreamy",
		blur: 2,
		brightness: 110,
		contrast: 90,
		sharpness: 0,
		saturate: 130,
		grayscale: 0,
	},
};

// The filter keys a preset controls (shared by the built-ins and the custom
// slot). Keep in sync with the Visual Filters sliders.
export const FILTER_PRESET_KEYS = [
	"blur",
	"brightness",
	"contrast",
	"sharpness",
	"saturate",
	"grayscale",
];

// IndexedDB Config
// The schema version is an explicit constant in db.js (not derived from the
// extension version) so downgrades cannot trigger VersionError/data loss.
export const IDB_NAME = "themes-assets";
export const IDB_STORE_THUMBS = "thumbs"; // Store for thumbnails
export const IDB_STORE_MEDIA = "media"; // Store for full media assets
export const IDB_STORE_WALLPAPERS = "wallpapers"; // Store for user uploaded wallpapers
export const IDB_STORE_ZEN_TRACKS = "zenTracks"; // Store for user uploaded Zen music

// Chrome Storage Keys
export const STORAGE_KEY_DB = "wallpaperDB"; // Key for the manifest JSON
export const STORAGE_KEY_SETTINGS = "userSettings"; // For user settings
// Slideshow cursor, deliberately kept outside userSettings: every new tab
// advances it, and it must never race with (or broadcast) real setting edits.
export const STORAGE_KEY_WALLPAPER_ROTATION = "wallpaperRotation";
// First catalog image/video ids. They are downloaded automatically on install
// and are the two wallpapers the app refuses to delete (see wallpaperDefaults.js).
export const STORAGE_KEY_DEFAULT_MEDIA = "defaultWallpaperMedia";

// Default settings
export const DEFAULT_CONFIG = {
	uiScale: 1, // Multiplier: 0.8, 1, 1.2
	zen: {
		// How uploaded Zen music advances: iterate the playlist (loop),
		// repeat the current track, or pick random tracks (shuffle).
		musicMode: "loop", // "loop" | "repeat-one" | "shuffle"
		// "uploaded" plays the personal playlist, "builtin" plays the bundled
		// piano ambience. With no uploads the built-in is used automatically.
		musicSource: "uploaded", // "uploaded" | "builtin"
	},
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
			specific: null,
		},
		videoSettings: {
			collection: "predefined",
			mode: "random",
			specific: null,
			muted: true, // Default muted
		},
		matrixSettings: {
			color: "#00ff00",
			speed: 50,
			fontSize: 16,
		},
		filters: {
			blur: 0,
			brightness: 100,
			contrast: 100,
			saturate: 100,
			grayscale: 0,
			sepia: 0,
			invert: 0,
			sharpness: 0,
		},
		duotoneSettings: {
			theme: "sunset",
			customColors: ["#ff7e5f", "#feb47b"],
			direction: "135deg",
			matchTheme: false,
		},

		blur: 0, // in pixels
		brightness: 100, // in percentage
		contrast: 100, // in percentage
		grayscale: 0, // in percentage
		saturate: 100, // in percentage
		sharpness: 0, // 0-100, SVG unsharp mask
		// The user's single saved filter preset (filter values only — never the
		// wallpaper it was captured from). null until they save one.
		customPreset: null,
		muted: true, // Default to muted for video wallpapers
		rain: false, // Rain customization
		rainSettings: {
			count: 150,
			speed: 15,
			length: 20,
			color: "#ffffff",
			opacity: 20,
		},
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
			format: "12", // '12' or '24'
		},
		date: {
			enabled: false,
		},
		alarm: {
			enabled: false, // Show upcoming alarm
		},
		weather: {
			enabled: true, // Zero-config: Open-Meteo needs no API key
			city: "", // Optional override; empty = auto-detect from timezone
			units: "metric", // metric (Celsius) or imperial (Fahrenheit)
			showHumidity: false,
			showWind: false,
			showFeelsLike: false,
		},
		display_style: "centralised", // 'centralised' or 'spread'
		shortcuts: {
			enabled: true,
		},
		famcam: {
			enabled: true,
			snapAction: "camera", // 'camera' | 'screenshot'
			flash: {
				tone: "warm", // 'cool', 'warm', 'neutral', 'custom'
				customColor: "#ffffff",
				type: "ring-circle", // 'fullscreen', 'ring-wide', 'ring-circle'
				borderWidth: 2, // 1-8
				brightness: 100, // 5-100
			},
		},
	},
	onScreenClock: {
		enabled: false,
		font: "default",
		color: "default",
		customColor: null,
		showSeconds: false,
		outline: false,
		outlineColor: null,
	},
	greeting: {
		enabled: false,
		outline: false,
		type: "default", // 'default' | 'custom'
		customName: "",
		customText: "",
	},
	quotes: {
		enabled: true, // Local daily quote under the clock / search bar
	},
	// Font settings: default to Google Outfit
	font: {
		family: "Outfit",
		// Default import URL for Outfit with common weights
		importUrl:
			"https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;700;800&display=swap",
	},
	theme: "glass",
};

export const DUOTONE_THEMES = {
	sunset: {
		name: "Sunset",
		colors: ["#ff7e5f", "#feb47b"],
		direction: "135deg",
		ui: {
			base: "#2d1b1e",
			off: "#4a2c31",
			accent: "#ff7e5f",
		},
	},
	ocean: {
		name: "Ocean",
		colors: ["#2193b0", "#6dd5ed"],
		direction: "135deg",
		ui: {
			base: "#0d1b2a",
			off: "#1b263b",
			accent: "#6dd5ed",
		},
	},
	forest: {
		name: "Forest",
		colors: ["#11998e", "#38ef7d"],
		direction: "135deg",
		ui: {
			base: "#0e1c15",
			off: "#1b3a2a",
			accent: "#38ef7d",
		},
	},
	berry: {
		name: "Berry",
		colors: ["#c31432", "#240b36"],
		direction: "135deg",
		ui: {
			base: "#1a0b14",
			off: "#2d1222",
			accent: "#c31432",
		},
	},
	night: {
		name: "Night",
		colors: ["#000428", "#004e92"],
		direction: "135deg",
		ui: {
			base: "#000428",
			off: "#001242",
			accent: "#00d2ff",
		},
	},
};

export const DEFAULT_SHORTCUTS = [
	{
		id: "s_chrome",
		title: "Chrome Web Store",
		url: "https://chrome.google.com/webstore",
		icon: "assets/svgs-fontawesome/brands/chrome.svg",
		builtin: true,
	},
	{
		id: "s_youtube",
		title: "YouTube",
		url: "https://www.youtube.com",
		icon: "assets/svgs-fontawesome/brands/youtube.svg",
		builtin: true,
	},
	{
		id: "s_dribbble",
		title: "Dribbble",
		url: "https://dribbble.com",
		icon: "assets/svgs-fontawesome/brands/dribbble.svg",
		builtin: true,
	},
	{
		id: "s_mdn",
		title: "MDN Web Docs",
		url: "https://developer.mozilla.org",
		icon: "assets/svgs-fontawesome/brands/firefox-browser.svg",
		builtin: true,
	},
];

export const DEFAULT_SHORTCUT_ICON_FALLBACK =
	"assets/svgs-fontawesome/solid/globe.svg";

const IMAGE_COLOR_STYLE_ID = "theme-image-color-style";

function updateImageColorStyle() {
	let styleTag = document.getElementById(IMAGE_COLOR_STYLE_ID);
	if (!styleTag) {
		styleTag = document.createElement("style");
		styleTag.id = IMAGE_COLOR_STYLE_ID;
		document.head.appendChild(styleTag);
	}
	styleTag.textContent = "img { color: var(--text-base); }";
}

export function applyTheme(theme) {
	const root = document.documentElement;

	// The retired "glass-dark" / "glass-light" / "glass-system" values all map
	// to the single Glass theme (dark glass).
	if (typeof theme === "string" && theme.startsWith("glass")) {
		root.setAttribute("data-theme", "glass");
	} else if (theme === "system" || !theme) {
		root.removeAttribute("data-theme");
	} else {
		root.setAttribute("data-theme", theme);
	}

	updateImageColorStyle();
}

/**
 * Apply the user's UI size preference.
 *
 * `--ui-scale` is a pure multiplier on the fluid root font-size (see
 * css/base.css): the automatic per-screen scaling is handled by the vmin
 * clamp, so this only expresses Small / Normal / Large. Setting it to 1
 * leaves the responsive sizing untouched.
 */
export function applyUiScale(scale) {
	const value = Number(scale);
	const safe =
		Number.isFinite(value) && value > 0 ? Math.min(Math.max(value, 0.5), 2) : 1;
	document.documentElement.style.setProperty("--ui-scale", String(safe));
}
