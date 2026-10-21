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
// True while only the thumbnail placeholder is mounted (cold start), so a
// later render can still upgrade it to the full asset.
let _lastRenderWasPreview = false;
// Cold-start preview: only the first render after a new tab / hard reload
// paints the thumbnail first. In-page changes (settings, type switch,
// rotation) always load the full media directly.
let _coldStart = true;
// Increments on every render attempt so a slow background swap cannot
// overwrite a newer wallpaper choice.
let _renderToken = 0;
// Latest style/filter config. A filter edit can land while the cold-start
// full asset is still loading, so the swap must not mount stale filters.
let _currentStyleCfg = null;

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
		_wallpaperMutedSetting = styleCfg.muted !== false;
		el.muted = _autoMuted || _zenMuted || _wallpaperMutedSetting;
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
	// Re-apply the auto-mute state in case it changed while the element was
	// being created (or the page reloaded after the SW assigned ownership).
	_applyAutoMute();
	try {
		const normalizedStyle = normalizeWallpaperConfig(styleCfg || {});
		// Geometry (object-position/scale) is cheap, so it lands before the
		// first paint. The filter stack is deferred: a full-screen blur or
		// SVG convolve has to run on every decoded frame, and starting it
		// while the video is still buffering is what made a freshly opened
		// new tab (or a browser restart) stutter.
		applyStyleGeometry(el, normalizedStyle);
		applyInitialFiltersWhenReady(el, normalizedStyle);
	} catch (e) {}
}

// === AUTO-MUTE STATE (managed by service worker) ===
let _autoMuted = false;
// Zen (Pomodoro) focus mode silences the wallpaper for the whole session, no
// matter what the audio-ownership or user mute preference says.
let _zenMuted = false;
// User preference from "Mute Audio"; kept separately so post-render mute sync
// cannot accidentally unmute a wallpaper when the user asked for silence.
let _wallpaperMutedSetting = true;

function _applyAutoMute() {
	const el = document.getElementById("wallpaper");
	if (el && el.tagName === "VIDEO") {
		el.muted = _autoMuted || _zenMuted || _wallpaperMutedSetting;
	}
}

/**
 * Mute/unmute the video wallpaper because Zen (Pomodoro) mode started/ended.
 * The flag survives wallpaper re-renders and audio-ownership changes, and the
 * previous user/auto mute state is restored simply by clearing it.
 */
export function setZenWallpaperMuted(enable) {
	_zenMuted = !!enable;
	_applyAutoMute();
}

// === WALLPAPER SYNC STATE ===
let _syncTimer = null;
let _syncTabCount = 0;
const SYNC_REPORT_INTERVAL_MS = 3000;

function _getWallpaperVideo() {
	const el = document.getElementById("wallpaper");
	return el && el.tagName === "VIDEO" ? el : null;
}

function _reportSyncTime() {
	const video = _getWallpaperVideo();
	if (!video) return;
	try {
		chrome.runtime
			.sendMessage({
				type: "WALLPAPER_SYNC_TIME",
				time: video.currentTime,
				duration: video.duration,
				paused: video.paused,
			})
			.catch(() => {});
	} catch (e) {}
}

function _startStopSyncTimer() {
	// Only talk to the service worker when another new-tab instance exists.
	// Otherwise this one-second loop would keep the MV3 worker awake forever.
	const needed = _syncTabCount >= 2 && !document.hidden;
	if (needed && !_syncTimer) {
		_syncTimer = setInterval(() => {
			if (document.hidden) return;
			const video = _getWallpaperVideo();
			if (video && !video.paused) _reportSyncTime();
		}, SYNC_REPORT_INTERVAL_MS);
	} else if (!needed && _syncTimer) {
		clearInterval(_syncTimer);
		_syncTimer = null;
	}
}

function _updateSyncTabCount(count) {
	if (typeof count !== "number") return;
	_syncTabCount = count;
	_startStopSyncTimer();
}

// Ask the SW how many new-tab pages currently exist.
try {
	chrome.runtime.sendMessage({ type: "WALLPAPER_SYNC_QUERY" }, (res) => {
		if (res && typeof res.tabCount === "number") {
			_updateSyncTabCount(res.tabCount);
		}
	});
} catch (e) {}

document.addEventListener("visibilitychange", _startStopSyncTimer);

function _handleWallpaperMessage(message) {
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
	} else if (message.type === "WALLPAPER_SYNC_STATUS") {
		_updateSyncTabCount(message.tabCount);
	}
}

chrome.runtime.onMessage.addListener((message) => {
	if (
		!message ||
		(message.type !== "WALLPAPER_MUTE" &&
			message.type !== "WALLPAPER_UNMUTE" &&
			message.type !== "WALLPAPER_SYNC" &&
			message.type !== "WALLPAPER_SYNC_STATUS")
	) {
		return false;
	}

	// Mute/unmute messages are broadcast to every extension page but target
	// exactly one tab (runtime messaging cannot address a single page).
	if (message.tabId != null) {
		try {
			chrome.tabs.getCurrent((tab) => {
				if (tab && tab.id === message.tabId) {
					_handleWallpaperMessage(message);
				}
			});
		} catch (e) {}
		return false;
	}

	_handleWallpaperMessage(message);
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

// ─── Thumbnail-first initial paint ─────────────────────────────────────────

/**
 * Paint the catalog thumbnail immediately. Used only for the first wallpaper
 * render after a new tab (or hard reload) so the page paints a small JPEG
 * instead of waiting for a 4K image or a video blob from IndexedDB.
 *
 * Returns false when no thumbnail is available, in which case the caller
 * falls back to the normal full-media render.
 */
async function paintWallpaperPreview(entry, styleCfg) {
	const id = typeof entry === "string" ? entry : entry?.id;
	if (!id) return false;

	if (String(id).startsWith("user-wall-")) {
		const found = await getUserWallpaperById(id);
		if (found?.thumbBlob) {
			setWallpaperFromBlob("img", found.thumbBlob, styleCfg);
			return true;
		}
		return false;
	}

	const thumbEntry = await getMediaEntry(`${id}::thumb`).catch(() => null);
	if (thumbEntry?.status === "ok" && thumbEntry.blob) {
		setWallpaperFromBlob("img", thumbEntry.blob, styleCfg);
		return true;
	}

	const remoteThumb = entry?.thumbnail ?
		resolveAssetUrl(entry.thumbnail)
	:	null;
	if (!remoteThumb) return false;
	setWallpaperElement("img", remoteThumb, styleCfg);
	return true;
}

/**
 * Mount an image only once it is decoded, replacing the thumbnail atomically.
 * The thumbnail stays on screen while the full image loads; a broken image
 * keeps the thumbnail instead of replacing it with a blank frame. The same
 * <img> that was decoded is mounted, so there is no second decode.
 */
function mountImageWhenReady(url, cfg, token) {
	return new Promise((resolve) => {
		const img = new Image();
		img.id = "wallpaper";
		img.alt = "";
		img.src = url;

		let settled = false;
		const fail = () => {
			if (settled) return;
			settled = true;
			resolve(false);
		};
		const mount = () => {
			if (settled) return;
			settled = true;
			if (token !== _renderToken) return resolve(false);

			// Same task as the append: the browser never paints the gap.
			clearPreviousWallpaper();
			document.body.appendChild(img);
			try {
				const normalizedStyle = normalizeWallpaperConfig(
					_currentStyleCfg || cfg || {},
				);
				applyStyleGeometry(img, normalizedStyle);
				applyInitialFiltersWhenReady(img, normalizedStyle);
			} catch (e) {}
			resolve(true);
		};

		img.onerror = fail;
		if (img.decode) {
			img.decode().then(mount, fail);
		} else {
			img.onload = mount;
		}
	});
}

/** Ask the service worker to cache a streamed asset for the next load. */
function requestFullAssetCache(entry) {
	try {
		chrome.runtime
			.sendMessage({ action: "downloadFullAsset", manifestEntry: entry })
			.catch(() => {});
	} catch (e) {}
}

/**
 * Upgrade a mounted thumbnail to the real wallpaper. Keeps the preview on
 * screen until the full image is decoded (or the video has its poster), then
 * swaps it in. Aborts when another render took over (`token` mismatch).
 */
async function swapInFullWallpaper(entry, cfg, token) {
	const id = typeof entry === "string" ? entry : entry?.id;
	if (!id) return false;
	const type = cfg.type === "video" ? "video" : "img";
	// A filter edit may have landed while the preview was up.
	const styleCfg = _currentStyleCfg || cfg;

	let blob = null;
	let thumbBlob = null;

	if (String(id).startsWith("user-wall-")) {
		const found = await getUserWallpaperById(id);
		if (!found?.blob) return false;
		blob = found.blob;
		thumbBlob = found.thumbBlob || null;
	} else {
		const mediaEntry = await getMediaEntry(`${id}::media`).catch(() => null);
		if (mediaEntry?.status === "ok" && mediaEntry.blob) {
			blob = mediaEntry.blob;
			if (type === "video") {
				const thumbEntry = await getMediaEntry(`${id}::thumb`).catch(
					() => null,
				);
				if (thumbEntry?.status === "ok") thumbBlob = thumbEntry.blob;
			}
		}
	}

	if (token !== _renderToken) return false;

	// Nothing cached (yet): stream from the catalog and cache in the SW.
	if (!blob) {
		if (typeof entry !== "object" || !entry?.asset) return false;
		const assetUrl = resolveAssetUrl(entry.asset);
		if (!assetUrl) return false;

		if (type === "video") {
			setWallpaperElement(
				"video",
				assetUrl,
				styleCfg,
				entry.thumbnail ? resolveAssetUrl(entry.thumbnail) : null,
			);
			requestFullAssetCache(entry);
		} else {
			const ok = await mountImageWhenReady(assetUrl, styleCfg, token);
			if (!ok) return false;
			requestFullAssetCache(entry);
		}
		return true;
	}

	if (type === "video") {
		if (thumbBlob) {
			setWallpaperFromBlob("video", blob, styleCfg, thumbBlob);
		} else {
			const url = URL.createObjectURL(blob);
			setWallpaperElement(
				"video",
				url,
				styleCfg,
				entry?.thumbnail ? resolveAssetUrl(entry.thumbnail) : null,
			);
			lastObjectUrl = url;
		}
		return true;
	}

	// Images: wait until the full image is decoded so replacing the preview
	// cannot flash a blank frame.
	const url = URL.createObjectURL(blob);
	const ok = await mountImageWhenReady(url, styleCfg, token);
	if (!ok) {
		URL.revokeObjectURL(url);
		return false;
	}
	lastObjectUrl = url;
	return true;
}

/**
 * Load the full media after the preview has been painted. Runs off the
 * critical path: the new-tab UI initializes while this is in flight.
 */
function upgradePreviewInBackground(entry, cfg, renderKey, token) {
	setTimeout(() => {
		(async () => {
			try {
				if (token !== _renderToken) return;
				const swapped = await swapInFullWallpaper(entry, cfg, token);
				if (!swapped || token !== _renderToken) return;
				_lastRenderKey = renderKey;
				_lastRenderWasPreview = false;
				notifyWallpaperRendered(cfg, entry.id);
			} catch (e) {
				// The thumbnail stays; the next render retries the full asset.
			}
		})();
	}, 0);
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

	// If set is null/empty, IDB is down or nothing has downloaded yet ->
	// return everything so the first new tab can load from the network.
	if (!downloadedSet || downloadedSet.size === 0) return list;

	const downloaded = list.filter((entry) =>
		downloadedSet.has(`${entry.id}::media`),
	);

	// Downloads are per type: switching to a type whose default is still
	// downloading (or failed) must not leave the previous wallpaper on screen.
	// Fall back to the full catalog for that type and stream it; the asset is
	// cached on demand by tryLoadFromBlob().
	return downloaded.length ? downloaded : list;
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
			const thumbUrl = entry.thumbnail
				? resolveAssetUrl(entry.thumbnail)
				: null;
			setWallpaperElement(type, assetUrl, styleCfg, thumbUrl);
			// Cache the full asset lazily for future renders.
			try {
				chrome.runtime
					.sendMessage({
						action: "downloadFullAsset",
						manifestEntry: entry,
					})
					.catch(() => {});
			} catch (e) {}
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

function notifyWallpaperRendered(cfg, id = null) {
	try {
		document.dispatchEvent(
			new CustomEvent("wallpaper:rendered", {
				detail: {
					id,
					type: cfg?.type || null,
					mode: cfg?.mode || null,
					collection: cfg?.collection || null,
				},
			}),
		);
	} catch (e) {}
}

export async function renderWallpaper(config, manifest) {
	const cfg = normalizeWallpaperConfig(config || {});
	_currentStyleCfg = cfg;
	const token = ++_renderToken;
	const coldStart = _coldStart;
	console.log("[Wallpaper] Rendering with config:", cfg);

	// Apply Rain Effect
	toggleRain(cfg.rain, cfg.rainSettings);

	// Clean up previous Duotone styles
	document.documentElement.style.removeProperty("--color-base");
	document.documentElement.style.removeProperty("--color-off");
	document.documentElement.style.removeProperty("--color-accent");
	document.documentElement.style.removeProperty("--text-accent");

	// Handle Matrix Mode
	if (cfg.type === "matrix") {
		clearPreviousWallpaper();
		_lastRenderKey = null;
		_coldStart = false;
		_lastRenderWasPreview = false;
		document.body.style.backgroundImage = "";
		document.body.style.backgroundColor = "black";

		// Use config settings or defaults
		const mSettings =
			cfg.matrixSettings || DEFAULT_CONFIG.wallpaper.matrixSettings;
		startMatrix(mSettings);
		notifyWallpaperRendered(cfg);
		return null;
	}

	// Handle Mono Mode
	if (cfg.type === "mono") {
		clearPreviousWallpaper();
		_lastRenderKey = null;
		_coldStart = false;
		_lastRenderWasPreview = false;
		document.body.style.backgroundImage = "";
		document.body.style.backgroundColor = "var(--color-off)";
		notifyWallpaperRendered(cfg);
		return null;
	}

	// Handle Duotone Mode
	if (cfg.type === "duotone") {
		clearPreviousWallpaper();
		_lastRenderKey = null;
		_coldStart = false;
		_lastRenderWasPreview = false;
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

		notifyWallpaperRendered(cfg);
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
	// revoke the blob URL of a video that may still be buffering. A mounted
	// preview is not "done": let the full asset upgrade it.
	if (
		renderKey &&
		renderKey === _lastRenderKey &&
		document.getElementById("wallpaper") &&
		!_lastRenderWasPreview
	) {
		notifyWallpaperRendered(cfg, entry.id);
		return entry.id;
	}

	// Cold start (new tab / hard reload): paint the thumbnail now and swap in
	// the real media in the background. The rest of the page does not wait for
	// a multi-megabyte blob read from IndexedDB.
	if (coldStart) {
		const previewed = await paintWallpaperPreview(entry, cfg);
		if (previewed) {
			_coldStart = false;
			_lastRenderKey = renderKey;
			_lastRenderWasPreview = true;
			notifyWallpaperRendered(cfg, entry.id);
			upgradePreviewInBackground(entry, cfg, renderKey, token);
			return entry.id;
		}
	}

	const success = await tryLoadFromBlob(entry, cfg.type, cfg);
	if (success) {
		_coldStart = false;
		_lastRenderKey = renderKey;
		_lastRenderWasPreview = false;
		notifyWallpaperRendered(cfg, entry.id);
		return entry.id;
	}

	// First entry failed - try another
	let retryEntry = await chooseEntry(manifest, cfg, entry.id);
	if (retryEntry) {
		const retrySuccess = await tryLoadFromBlob(retryEntry, cfg.type, cfg);
		if (retrySuccess) {
			_coldStart = false;
			_lastRenderKey = buildRenderKey(cfg, retryEntry.id);
			_lastRenderWasPreview = false;
			notifyWallpaperRendered(cfg, retryEntry.id);
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
			// These sliders are percentages (0-100 / 0-200). The old
			// `v > 10 ? "%" : String(v)` heuristic turned 1-10% into a
			// unitless multiplier (saturate(5) = 500%), which made the
			// bottom of both sliders behave incorrectly.
			return `${v}%`;
		}
		return String(v);
	}
	return null;
}
const SHARPNESS_FILTER_ID = "tp-sharpness-filter";
let _sharpnessMatrix = null;

function ensureSharpnessFilter(amount) {
	let filter = document.getElementById(SHARPNESS_FILTER_ID);
	if (!filter) {
		const svg = document.createElementNS(
			"http://www.w3.org/2000/svg",
			"svg",
		);
		svg.setAttribute("width", "0");
		svg.setAttribute("height", "0");
		svg.setAttribute("aria-hidden", "true");
		svg.style.position = "absolute";
		svg.style.width = "0";
		svg.style.height = "0";
		svg.style.overflow = "hidden";

		const defs = document.createElementNS(
			"http://www.w3.org/2000/svg",
			"defs",
		);
		filter = document.createElementNS(
			"http://www.w3.org/2000/svg",
			"filter",
		);
		filter.id = SHARPNESS_FILTER_ID;
		filter.setAttribute("x", "0%");
		filter.setAttribute("y", "0%");
		filter.setAttribute("width", "100%");
		filter.setAttribute("height", "100%");
		filter.setAttribute("color-interpolation-filters", "sRGB");

		const convolve = document.createElementNS(
			"http://www.w3.org/2000/svg",
			"feConvolveMatrix",
		);
		convolve.setAttribute("order", "3");
		convolve.setAttribute("preserveAlpha", "true");
		convolve.setAttribute("edgeMode", "duplicate");
		convolve.setAttribute(
			"kernelMatrix",
			"0 0 0 0 1 0 0 0 0",
		);
		filter.appendChild(convolve);
		defs.appendChild(filter);
		svg.appendChild(defs);
		(document.body || document.documentElement).appendChild(svg);
		_sharpnessMatrix = convolve;
	} else if (!_sharpnessMatrix) {
		_sharpnessMatrix = filter.querySelector("feConvolveMatrix");
	}

	if (!_sharpnessMatrix) return;
	const k = Math.max(0, Math.min(2, Number(amount) / 100));
	_sharpnessMatrix.setAttribute(
		"kernelMatrix",
		`0 ${-k} 0 ${-k} ${1 + 4 * k} ${-k} 0 ${-k} 0`,
	);
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
	const sharpness = Number(styleCfg.sharpness);
	if (Number.isFinite(sharpness) && sharpness > 0) {
		ensureSharpnessFilter(sharpness);
		parts.push(`url(#${SHARPNESS_FILTER_ID})`);
	}
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
function applyStyleGeometry(el, styleCfg = {}) {
	if (!el || !styleCfg) return;
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

function applyStyleConfigToElement(el, styleCfg = {}) {
	if (!el || !styleCfg) return;
	const filter = buildFilterString(styleCfg);
	el.style.filter = filter || "";
	applyStyleGeometry(el, styleCfg);
}

// Bumped whenever a user explicitly edits the filters, so a delayed initial
// application cannot overwrite the newer look.
let _filterGeneration = 0;

/**
 * Attach the saved filter stack only once the wallpaper is already rendering.
 * Applying a heavy `filter` (blur, feConvolveMatrix sharpness) to a <video>
 * before its first frames are decoded forces the whole media pipeline through
 * the filter path while it is still buffering, which is what produces the
 * startup stutter. Two animation frames after playback begins keeps the
 * initial load smooth while still showing the saved look almost immediately.
 */
function applyInitialFiltersWhenReady(el, styleCfg) {
	if (!el) return;
	const generation = _filterGeneration;
	let applied = false;
	const apply = () => {
		if (applied) return;
		applied = true;
		requestAnimationFrame(() => {
			requestAnimationFrame(() => {
				if (!el.isConnected || generation !== _filterGeneration) return;
				try {
					applyStyleConfigToElement(el, styleCfg);
				} catch (e) {}
			});
		});
	};

	if (el.tagName === "VIDEO") {
		el.addEventListener("playing", apply, { once: true });
	} else if (el.complete) {
		apply();
	} else {
		el.addEventListener("load", apply, { once: true });
	}

	// Safety net: autoplay can be blocked, in which case the wallpaper is a
	// still frame and filtering it late costs nothing. A video that is merely
	// still buffering (paused === false) is left alone for a while longer so
	// the filter never lands in the middle of startup.
	let waited = 0;
	const check = () => {
		if (applied) return;
		if (
			el.tagName === "VIDEO" &&
			!el.paused &&
			el.readyState < 2 &&
			waited < 10000
		) {
			waited += 2500;
			setTimeout(check, 2500);
			return;
		}
		apply();
	};
	setTimeout(check, 2500);
}

/** Apply the wallpaper filter stack (including sharpness) to any element. */
export function applyWallpaperFilters(el, styleCfg = {}) {
	if (!el) return;
	_filterGeneration++;
	_currentStyleCfg = styleCfg || _currentStyleCfg;
	el.style.filter = buildFilterString(styleCfg) || "";
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
		sharpness: src.sharpness ?? 0,
		position: src.position ?? src.objectPosition ?? undefined,
		scale: src.scale ?? undefined,
		muted: src.muted !== false, // Default true
		rain: src.rain ?? false,
		rainSettings: {
			...DEFAULT_CONFIG.wallpaper.rainSettings,
			...(src.rainSettings || {}),
		},
		duotoneSettings: src.duotoneSettings ?? undefined,
		matrixSettings: src.matrixSettings ?? undefined,
	};
	return out;
}
