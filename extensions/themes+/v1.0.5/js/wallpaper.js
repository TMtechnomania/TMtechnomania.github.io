import {
	getMediaEntry,
	getUserWallpaperList,
	getUserWallpaperById,
	getAvailableMediaKeys,
} from "./db.js";
import { DUOTONE_THEMES, DEFAULT_CONFIG } from "./config.js";
import { resolveAssetUrl } from "./api.js";
import { toggleRain } from "./rainEffect.js";
import { startMatrix, stopMatrix } from "./matrixEffect.js";

let lastObjectUrl = null;
let lastThumbUrl = null;
// Identity of the wallpaper currently mounted, used to skip duplicate renders.
// A second render of the same config used to revoke the blob URL of a video
// that was still loading (FFmpegDemuxer "data source error").
let _lastRenderKey = null;

function clearPreviousWallpaper() {
	stopMatrix(); // Stop Matrix if running

	if (lastObjectUrl) {
		try {
			URL.revokeObjectURL(lastObjectUrl);
		} catch (e) {}
		lastObjectUrl = null;
	}
	if (lastThumbUrl) {
		try {
			URL.revokeObjectURL(lastThumbUrl);
		} catch (e) {}
		lastThumbUrl = null;
	}
	// Always clear media session when removing wallpaper to free keys
	if ("mediaSession" in navigator) {
		[
			"play",
			"pause",
			"stop",
			"seekbackward",
			"seekforward",
			"previoustrack",
			"nexttrack",
		].forEach((action) => {
			try {
				navigator.mediaSession.setActionHandler(action, null);
			} catch (e) {}
		});
	}
	const prev = document.getElementById("wallpaper");
	if (prev) {
		prev.remove();
	}
}
function setWallpaperElement(type, url, styleCfg = {}, thumbUrl = null) {
	clearPreviousWallpaper();
	const el = document.createElement(type === "img" ? "img" : "video");
	el.id = "wallpaper";
	el.src = url;
	if (type === "video") {
		el.autoplay = true;
		el.loop = true;
		el.controls = false; // Explicitly disable controls
		el.preload = "auto"; // Optimize loading

		// Default to true if undefined to be safe, or respect config
		el.muted = _autoMuted || (styleCfg.muted !== false);
		el.playsInline = true;
		el.disablePictureInPicture = true; // Prevent PiP button

		if (thumbUrl) {
			el.poster = thumbUrl;
		}
		// Handle autoplay failures (browser policy)
		el.addEventListener(
			"canplay",
			() => {
				el.play().catch((err) => {
					console.warn(
						"[Wallpaper] Video autoplay blocked:",
						err.message,
					);
				});
			},
			{ once: true },
		);
		// Handle video stall/error: never leave a blank background behind
		el.addEventListener(
			"error",
			() => {
				const error = el.error;
				console.warn(
					"[Wallpaper] Video unavailable, falling back to poster:",
					error ? `${error.code}` : "unknown",
				);
				_lastRenderKey = null;
				if (el.poster) {
					const img = document.createElement("img");
					img.id = "wallpaper";
					img.alt = "";
					img.style.cssText = el.style.cssText;
					img.style.objectFit = "cover";
					img.src = el.poster;
					el.replaceWith(img);
				} else {
					el.remove();
				}
			},
			{ once: true },
		);

		// FIX: Disable remote playback and user control
		el.disableRemotePlayback = true;
		el.style.pointerEvents = "none";
		el.tabIndex = -1;

		// Attempt to block media keys for this video ONLY if NOT muted
		// If muted, we should let keys pass through to other apps
		if (!el.muted && "mediaSession" in navigator) {
			const noop = () => {};
			[
				"play",
				"pause",
				"stop",
				"seekbackward",
				"seekforward",
				"previoustrack",
				"nexttrack",
			].forEach((action) => {
				try {
					navigator.mediaSession.setActionHandler(action, noop);
				} catch (e) {}
			});
		}
	} else {
		el.onerror = () => {
			console.warn("[Wallpaper] Image load error for:", url);
			_lastRenderKey = null;
			el.remove();
		};
	}
	document.body.appendChild(el);
	try {
		const normalizedStyle = normalizeWallpaperConfig(styleCfg || {});
		applyStyleConfigToElement(el, normalizedStyle);
	} catch (e) {}
}

// === AUTO-MUTE STATE (managed by service worker) ===
let _autoMuted = false;

function _applyAutoMute() {
	const el = document.getElementById("wallpaper");
	if (el && el.tagName === "VIDEO") {
		el.muted = _autoMuted;
	}
}

// === WALLPAPER SYNC STATE ===
let _syncDebounceTimer = null;

function _getWallpaperVideo() {
	const el = document.getElementById("wallpaper");
	return el && el.tagName === "VIDEO" ? el : null;
}

function _reportSyncTime() {
	const video = _getWallpaperVideo();
	if (!video) return;
	// Throttle reports to ~4/sec
	if (_syncDebounceTimer) return;
	_syncDebounceTimer = setTimeout(() => { _syncDebounceTimer = null; }, 250);
	try {
		chrome.runtime.sendMessage({
			type: "WALLPAPER_SYNC_TIME",
			tabId: null,
			time: video.currentTime,
			duration: video.duration,
			paused: video.paused,
		}).catch(() => {});
	} catch (e) {}
}

function _checkSyncStatus() {
	const video = _getWallpaperVideo();
	if (!video || video.paused) return;
	const diff = Math.abs(video.currentTime);
	if (diff > 0.3) {
		// Out of sync — show button
		try {
			chrome.runtime.sendMessage({
				type: "WALLPAPER_SYNC_STATUS",
				needSync: true,
			}).catch(() => {});
		} catch (e) {}
	}
}

// Report time periodically when video is playing
setInterval(() => {
	const video = _getWallpaperVideo();
	if (video && !video.paused) {
		_reportSyncTime();
		_checkSyncStatus();
	}
}, 1000);

chrome.runtime.onMessage.addListener((message) => {
	if (message.type === "WALLPAPER_MUTE") {
		_autoMuted = true;
		_applyAutoMute();
	} else if (message.type === "WALLPAPER_UNMUTE") {
		if (_autoMuted) {
			_autoMuted = false;
			_applyAutoMute();
		}
	} else if (message.type === "WALLPAPER_SYNC") {
		const video = _getWallpaperVideo();
		if (video) {
			video.pause();
			video.currentTime = 0;
			const p = video.play();
			if (p && typeof p.catch === "function") {
				p.catch(() => {
					video.addEventListener(
						"canplay",
						() => {
							video.play().catch(() => {});
						},
						{ once: true },
					);
				});
			}
		}
	}
	return false;
});

// Global Visibility Listener for Video Wallpaper
document.addEventListener("visibilitychange", () => {
	const el = document.getElementById("wallpaper");
	if (el && el.tagName === "VIDEO") {
		if (document.hidden) {
			el.pause();
		} else {
			// Only play if it was supposed to be playing?
			// For wallpaper, we always assume it should be playing if visible.
			el.play().catch(() => {});
		}
	}
});

function setWallpaperFromBlob(type, blob, styleCfg = {}, thumbBlob = null) {
	const url = URL.createObjectURL(blob);
	let thumbUrl = null;
	if (thumbBlob) {
		thumbUrl = URL.createObjectURL(thumbBlob);
	}
	setWallpaperElement(type, url, styleCfg, thumbUrl);
	lastObjectUrl = url;
	if (thumbUrl) {
		lastThumbUrl = thumbUrl;
	}
}
// Cache of downloaded media keys
let _downloadedMediaKeys = null;

export function clearMediaKeysCache() {
	_downloadedMediaKeys = null;
}

async function getDownloadedMediaKeysSet() {
	if (_downloadedMediaKeys && _downloadedMediaKeys.size > 0)
		return _downloadedMediaKeys;

	try {
		// First attempt
		let keys = await getAvailableMediaKeys();

		// If keys is null, it means IDB is completely unavailable (per our db.js logic)
		// Return null to signal "don't filter"
		if (keys === null) {
			return null;
		}

		// If empty array, wait and retry once (handling fresh install race condition)
		if (keys.length === 0) {
			await new Promise((r) => setTimeout(r, 1000));
			keys = await getAvailableMediaKeys();
			if (keys === null) return null; // IDB died during retry
		}

		_downloadedMediaKeys = new Set(keys || []);
	} catch (e) {
		// If error, return null so we don't filter out everything
		console.warn("Error fetching media keys, disabling filter:", e);
		return null;
	}
	return _downloadedMediaKeys;
}

async function filterEntriesWithMedia(list) {
	if (!Array.isArray(list) || list.length === 0) return [];
	const downloadedSet = await getDownloadedMediaKeysSet();

	// If set is null, IDB is down -> return everything (allow network load)
	if (!downloadedSet) return list;

	return list.filter((entry) => downloadedSet.has(`${entry.id}::media`));
}
async function chooseEntry(manifest, config, excludeId = null) {
	let list = [];
	let effectiveMode = config.mode;

	// Get the wallpaper list based on collection
	if (config.collection === "user") {
		const userWalls = await getUserWallpaperList();
		// Filter by type - explicit check for both types
		const targetType =
			config.type === "img" ? "img"
			: config.type === "video" ? "video"
			: null;
		if (targetType) {
			list = userWalls.filter((w) => w.type === targetType);
		} else {
			list = []; // Invalid type, no user wallpapers
		}

		// If no user wallpapers of this type, fall back to predefined
		if (list.length === 0) {
			const type = config.type === "img" ? "images" : "videos";
			list = manifest[type] || [];
			// Filter for downloaded predefined
			list = await filterEntriesWithMedia(list);
			// If was specific mode, switch to random
			if (effectiveMode === "specific") {
				effectiveMode = "random";
			}
		}
	} else {
		// Predefined collection - filter for downloaded
		const type = config.type === "img" ? "images" : "videos";
		const all = manifest[type] || [];
		list = await filterEntriesWithMedia(all);
	}

	if (!list.length) return null;

	let available = list.slice();

	if (excludeId) {
		available = available.filter((e) => e.id !== excludeId);
		if (available.length === 0) {
			available = list.slice();
		}
	}

	if (effectiveMode === "specific" && config.specific) {
		const found = available.find((e) => e.id === config.specific);
		if (found) return found;
		// Specific not found, fall back to random
	}

	if (effectiveMode === "sequence" && config.last_id) {
		const lastIdx = available.findIndex((e) => e.id === config.last_id);
		const nextIdx = lastIdx < 0 ? 0 : (lastIdx + 1) % available.length;
		return available[nextIdx];
	}

	// Random mode or fallback
	return available[Math.floor(Math.random() * available.length)];
}

async function tryLoadFromBlob(entry, type, styleCfg = {}) {
	const id = typeof entry === "string" ? entry : entry?.id;

	// User Wallpaper - fetch single entry by ID instead of loading all
	if (String(id).startsWith("user-wall-")) {
		const found = await getUserWallpaperById(id);
		if (found && found.blob) {
			setWallpaperFromBlob(type, found.blob, styleCfg, found.thumbBlob);
			return true;
		}
		return false;
	}

	// Predefined wallpaper — try IDB first
	const mediaKey = `${id}::media`;
	const mediaEntry = await getMediaEntry(mediaKey).catch(() => null);
	if (mediaEntry && mediaEntry.status === "ok" && mediaEntry.blob) {
		let thumbBlob = null;
		if (type === "video") {
			const thumbKey = `${id}::thumb`;
			const thumbEntry = await getMediaEntry(thumbKey).catch(() => null);
			if (thumbEntry && thumbEntry.status === "ok" && thumbEntry.blob) {
				thumbBlob = thumbEntry.blob;
			}
		}
		setWallpaperFromBlob(type, mediaEntry.blob, styleCfg, thumbBlob);
		return true;
	}

	// Fallback: load directly from network URL
	if (typeof entry === "object" && entry?.asset) {
		const assetUrl = resolveAssetUrl(entry.asset);
		if (assetUrl) {
			const thumbUrl = entry.thumb ? resolveAssetUrl(entry.thumb) : null;
			setWallpaperElement(type, assetUrl, styleCfg, thumbUrl);
			return true;
		}
	}

	return false;
}

function buildRenderKey(cfg, entryId) {
	try {
		const { last_id, ...rest } = cfg || {};
		return `${cfg?.type || "img"}|${entryId}|${JSON.stringify(rest)}`;
	} catch (e) {
		return null;
	}
}

export async function renderWallpaper(config, manifest) {
	const cfg = normalizeWallpaperConfig(config || {});
	console.log("[Wallpaper] Rendering with config:", cfg);

	// Apply Rain Effect
	toggleRain(cfg.rain);

	// Clean up previous Duotone styles
	document.documentElement.style.removeProperty("--color-base");
	document.documentElement.style.removeProperty("--color-off");
	document.documentElement.style.removeProperty("--color-accent");
	document.documentElement.style.removeProperty("--text-accent");

	// Handle Matrix Mode
	if (cfg.type === "matrix") {
		clearPreviousWallpaper();
		_lastRenderKey = null;
		document.body.style.backgroundImage = "";
		document.body.style.backgroundColor = "black";

		// Use config settings or defaults
		const mSettings =
			cfg.matrixSettings || DEFAULT_CONFIG.wallpaper.matrixSettings;
		startMatrix(mSettings);
		return null;
	}

	// Handle Mono Mode
	if (cfg.type === "mono") {
		clearPreviousWallpaper();
		_lastRenderKey = null;
		document.body.style.backgroundImage = "";
		document.body.style.backgroundColor = "var(--color-off)";
		return null;
	}

	// Handle Duotone Mode
	if (cfg.type === "duotone") {
		clearPreviousWallpaper();
		_lastRenderKey = null;
		// Use defaults if missing
		const dSettings =
			cfg.duotoneSettings || DEFAULT_CONFIG.wallpaper.duotoneSettings;
		const themeName = dSettings.theme || "sunset";
		let colors = [];
		let direction = "135deg";

		if (themeName === "custom") {
			colors =
				dSettings.customColors ||
				DEFAULT_CONFIG.wallpaper.duotoneSettings.customColors;
			direction = dSettings.direction || "135deg";
		} else {
			const theme = DUOTONE_THEMES[themeName] || DUOTONE_THEMES.sunset;
			colors = theme.colors;
			direction = theme.direction;
		}

		const gradient = `linear-gradient(${direction}, ${colors[0]}, ${colors[1]})`;
		document.body.style.backgroundColor = "";
		document.body.style.backgroundImage = gradient;
		document.body.style.backgroundAttachment = "fixed";
		document.body.style.backgroundSize = "cover";

		// Apply UI Theme
		let uiColors = null;
		if (themeName === "custom") {
			// Convert array to object
			if (
				dSettings.customUiColors &&
				dSettings.customUiColors.length === 3
			) {
				uiColors = {
					base: dSettings.customUiColors[0],
					off: dSettings.customUiColors[1],
					accent: dSettings.customUiColors[2],
				};
			}
		} else {
			const theme = DUOTONE_THEMES[themeName] || DUOTONE_THEMES.sunset;
			uiColors = theme.ui;
		}

		if (dSettings.matchTheme && uiColors) {
			document.documentElement.style.setProperty(
				"--color-base",
				uiColors.base,
			);
			document.documentElement.style.setProperty(
				"--color-off",
				uiColors.off,
			);
			document.documentElement.style.setProperty(
				"--color-accent",
				uiColors.accent,
			);
			// Also sync text-accent
			document.documentElement.style.setProperty(
				"--text-accent",
				uiColors.accent,
			);
			document.documentElement.style.setProperty(
				"--text-accent",
				uiColors.accent,
			);
		} else {
			// Ensure cleanup if toggled off
			// Already cleaned at top, no op needed unless we want to be paranoid?
			// Actually, if we just set them above, we don't need to unset them here because we unset them at the very start.
			// But wait, if matchTheme is FALSE, we just want standard variables.
			// The top-level cleanup ensures we start clean.
			// So "else" block is empty or unnecessary.
		}

		return null;
	}

	// Reset specific styles for other modes
	document.body.style.backgroundColor = "";
	document.body.style.backgroundImage = "";
	// Reset specific styles for other modes
	document.body.style.backgroundColor = "";
	document.body.style.backgroundImage = "";

	// Vars already reset at top

	// Get entry (chooseEntry handles all fallback logic)
	const excludeId = cfg.mode === "random" && cfg.last_id ? cfg.last_id : null;
	let entry = await chooseEntry(manifest, cfg, excludeId);

	if (!entry) {
		// Should not happen if predefined wallpapers exist
		// console.warn('No wallpaper entry found');
		return null;
	}

	// Load the wallpaper
	const renderKey = buildRenderKey(cfg, entry.id);
	// Same wallpaper, same settings, already mounted: skip. Rebuilding would
	// revoke the blob URL of a video that may still be buffering.
	if (renderKey && renderKey === _lastRenderKey && document.getElementById("wallpaper")) {
		return entry.id;
	}

	const success = await tryLoadFromBlob(entry, cfg.type, cfg);
	if (success) {
		_lastRenderKey = renderKey;
		return entry.id;
	}

	// First entry failed - try another
	let retryEntry = await chooseEntry(manifest, cfg, entry.id);
	if (retryEntry) {
		const retrySuccess = await tryLoadFromBlob(retryEntry, cfg.type, cfg);
		if (retrySuccess) {
			_lastRenderKey = buildRenderKey(cfg, retryEntry.id);
			return retryEntry.id;
		}
	}

	// Should not reach here if predefined wallpapers exist and are downloaded
	// console.warn('Failed to load any wallpaper');
	return null;
}
function normalizeStyleValue(prop, v) {
	if (v == null) return null;
	if (typeof v === "string") {
		const trimmed = v.trim();
		if (
			/^[0-9.]+%$/.test(trimmed) ||
			/^[0-9.]+(px|em|rem|vh|vw)$/.test(trimmed)
		)
			return trimmed;
		const num = Number(trimmed);
		if (!Number.isNaN(num)) v = num;
		else return trimmed;
	}
	if (typeof v === "number") {
		if (prop === "blur") return `${v}px`;
		if (
			prop === "brightness" ||
			prop === "contrast" ||
			prop === "grayscale" ||
			prop === "saturate"
		) {
			if (v > 10) return `${v}%`;
			return String(v);
		}
		return String(v);
	}
	return null;
}
function buildFilterString(styleCfg = {}) {
	const parts = [];
	const isZero = (val) =>
		typeof val === "string" &&
		/^0(?:\.0+)?(?:px|%|em|rem|vh|vw)?$/.test(val);
	const isHundred = (val) =>
		typeof val === "string" && /^100(?:\.0+)?(?:%|)?$/.test(val);
	const rawBlur = styleCfg.blur;
	const b = normalizeStyleValue("blur", rawBlur);
	if (b && !isZero(b)) parts.push(`blur(${b})`);
	const brightness = normalizeStyleValue("brightness", styleCfg.brightness);
	if (brightness && !isHundred(brightness))
		parts.push(`brightness(${brightness})`);
	const contrast = normalizeStyleValue("contrast", styleCfg.contrast);
	if (contrast && !isHundred(contrast)) parts.push(`contrast(${contrast})`);
	const saturate = normalizeStyleValue("saturate", styleCfg.saturate);
	if (saturate && !isHundred(saturate))
		parts.push(`saturate(${saturate})`);
	const grayscale = normalizeStyleValue("grayscale", styleCfg.grayscale);
	if (grayscale && !isZero(grayscale)) parts.push(`grayscale(${grayscale})`);
	const filterStr = parts.join(" ");
	try {
		if (filterStr) {
		} else if (
			styleCfg.blur !== 0 ||
			styleCfg.brightness !== 100 ||
			styleCfg.contrast !== 100 ||
			styleCfg.saturate !== 100 ||
			styleCfg.grayscale !== 0
		) {
		}
	} catch (e) {}
	return filterStr;
}
function applyStyleConfigToElement(el, styleCfg = {}) {
	if (!el || !styleCfg) return;
	try {
	} catch (e) {}
	const filter = buildFilterString(styleCfg);
	if (filter) el.style.filter = filter;
	if (styleCfg.position) el.style.objectPosition = String(styleCfg.position);
	if (styleCfg.scale != null) {
		let s = styleCfg.scale;
		if (typeof s === "number") s = String(s);
		if (typeof s === "string" && s.endsWith("%")) {
			const n = Number(s.replace("%", "")) / 100;
			el.style.transform = `scale(${n})`;
		} else {
			el.style.transform = `scale(${s})`;
		}
	}
}
function normalizeWallpaperConfig(cfg = {}) {
	if (!cfg || typeof cfg !== "object") return {};
	const src =
		cfg.wallpaper && typeof cfg.wallpaper === "object" ?
			cfg.wallpaper
		:	cfg;
	const out = {
		type: src.type ?? "img",
		mode: src.mode ?? "random",
		collection: src.collection ?? "predefined",
		specific: src.specific ?? null,
		last_id: src.last_id ?? null,
		blur: src.blur ?? 0,
		brightness: src.brightness ?? 100,
		contrast: src.contrast ?? 100,
		grayscale: src.grayscale ?? 0,
		saturate: src.saturate ?? 100,
		position: src.position ?? src.objectPosition ?? undefined,
		scale: src.scale ?? undefined,
		muted: src.muted !== false, // Default true
		rain: src.rain ?? false,
		duotoneSettings: src.duotoneSettings ?? undefined,
		matrixSettings: src.matrixSettings ?? undefined,
	};
	return out;
}
