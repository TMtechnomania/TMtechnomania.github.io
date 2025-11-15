import { getMediaEntry } from "./db.js";
import { resolveAssetUrl } from "./api.js";

// Global tracker for the blob URL to prevent memory leaks
let lastObjectUrl = null;

/**
 * [BUG FIX] Clears the previous wallpaper and revokes the *last*
 * object URL. The bug was that the old code revoked the *new* URL
 * before it could be used.
 */
function clearPreviousWallpaper() {
	// 1. Revoke the LAST object URL, if it exists
	if (lastObjectUrl) {
		try {
			URL.revokeObjectURL(lastObjectUrl);
		} catch (e) {
			/* ignore */
		}
		lastObjectUrl = null;
	}
	// 2. Remove the old DOM element
	const prev = document.getElementById("wallpaper");
	if (prev) {
		prev.remove();
	}
}

/**
 * Creates the DOM element for the wallpaper and sets its source.
 * @param {string} type - 'img' or 'video'
 * @param {string} url - The URL (blob, remote, or local)
 */
function setWallpaperElement(type, url, styleCfg = {}) {
	clearPreviousWallpaper();
	const el = document.createElement(type === "img" ? "img" : "video");
	el.id = "wallpaper";
	el.src = url;

	if (type === "video") {
		el.autoplay = true;
		el.loop = true;
		el.muted = true;
		el.playsInline = true;
	}

	// Add an error handler in case the browser fails to load the src
	el.onerror = () => {
		console.warn(`Failed to load wallpaper src: ${url}`);
		el.remove();
		// As a final, final fallback, we could use the sample asset.
		// For now, we rely on the main function's remote fallback.
	};

	document.body.appendChild(el);

	// Apply custom styles (filters / positioning) from styleCfg
	try {
		// Ensure incoming style config is normalized (caller may pass partial or top-level settings)
		const normalizedStyle = normalizeWallpaperConfig(styleCfg || {});
		console.debug('wallpaper: applying style config', normalizedStyle);
		applyStyleConfigToElement(el, normalizedStyle);
	} catch (e) {
		// ignore styling errors
		console.warn('Failed to apply wallpaper styles', e);
	}
}

/**
 * A special setter that creates a blob URL and tracks it
 * so it can be revoked later.
 * @param {string} type - 'img' or 'video'
 * @param {Blob} blob - The blob from IndexedDB
 */
function setWallpaperFromBlob(type, blob, styleCfg = {}) {
	const url = URL.createObjectURL(blob);
	// Append element first (so clearPreviousWallpaper inside setWallpaperElement
	// revokes the *previous* object URL). Only then track the new URL.
	setWallpaperElement(type, url, styleCfg);
	lastObjectUrl = url; // Track this new URL for the next clear
}

/**
 * Selects a wallpaper entry based on user config.
 * @param {object} manifest - The full wallpaper manifest
 * @param {object} config - The user's wallpaper config
 * @param {string|null} excludeId - An ID to exclude (used for retries)
 * @returns {object|null} A manifest entry
 */
// Filter manifest entries and return only those that have a stored full-media blob
async function filterEntriesWithMedia(list) {
	if (!Array.isArray(list) || list.length === 0) return [];
	const checks = await Promise.all(
		list.map(async (entry) => {
			try {
				const me = await getMediaEntry(`${entry.id}::media`).catch(() => null);
				if (me && me.status === "ok" && me.blob) return entry;
			} catch (e) {
				// ignore
			}
			return null;
		}),
	);
	return checks.filter(Boolean);
}

// Choose an entry from the manifest, preferring only those that have media stored.
// If none are available, returns null so the caller can fall back to other strategies.
async function chooseEntry(manifest, config, excludeId = null) {
	const type = config.type === "img" ? "images" : "videos";
	const list = manifest[type] || [];
	if (!list.length) return null;

	// Build the list of entries that actually have full media stored
	const mediaReady = await filterEntriesWithMedia(list);
	let available = mediaReady.slice();

	// If none of the manifest entries have media stored, return null and let
	// the caller use fallback behavior (thumbnails or remote).
	if (available.length === 0) return null;

	// If we are retrying, exclude the failed id
	if (excludeId) {
		available = available.filter((e) => e.id !== excludeId);
		if (available.length === 0) available = mediaReady.slice();
	}

	if (config.mode === "specific" && config.specific) {
		const found = available.find((e) => e.id === config.specific);
		if (found) return found;
		// If the specific asked-for wallpaper isn't in available (not downloaded), return null
		return null;
	}

	if (config.mode === "sequence" && config.last_id) {
		const lastIdx = available.findIndex((e) => e.id === config.last_id);
		const nextIdx = lastIdx < 0 ? 0 : (lastIdx + 1) % available.length;
		return available[nextIdx];
	}

	// Default: random from available media-ready entries
	return available[Math.floor(Math.random() * available.length)];
}

/**
 * Tries to load a wallpaper from local IndexedDB (media or thumb).
 * @param {string} id - The entry ID (e.g., 'img-001')
 * @param {string} type - 'img' or 'video'
 * @returns {boolean} - true if successful, false if not
 */
async function tryLoadFromBlob(id, type, styleCfg = {}) {
	// 1. Try to get full media
	const mediaKey = `${id}::media`;
	const mediaEntry = await getMediaEntry(mediaKey).catch(() => null);
	if (mediaEntry && mediaEntry.status === "ok" && mediaEntry.blob) {
		console.log(`Rendering from local media: ${mediaKey}`);
		setWallpaperFromBlob(type, mediaEntry.blob, styleCfg);
		return true; // SUCCESS
	}

	// 2. Fallback to thumbnail
	const thumbKey = `${id}::thumb`;
	const thumbEntry = await getMediaEntry(thumbKey).catch(() => null);
	if (thumbEntry && thumbEntry.status === "ok" && thumbEntry.blob) {
		console.log(`Rendering from local thumb: ${thumbKey}`);
		setWallpaperFromBlob(type, thumbEntry.blob, styleCfg);
		return true; // SUCCESS
	}

	// 3. Both failed
	return false;
}

/**
 * Main function to render the wallpaper with 3-step fallback.
 * @param {object} config - The user's wallpaper config
 * @param {object} manifest - The full wallpaper manifest
 */
export async function renderWallpaper(config, manifest) {
	console.log("Rendering wallpaper with config:", config);

	// First attempt: choose only among media-downloaded entries
	// Normalize config so callers may pass either the full settings object
	// or legacy/alternate key forms. This ensures style keys from
	// DEFAULT_CONFIG are respected (blur, brightness, contrast, grayscale, etc.).
	const cfg = normalizeWallpaperConfig(config || {});
	console.log("Rendering wallpaper with config:", config, "-> normalized:", cfg);
	let entry = await chooseEntry(manifest, cfg, null);

	// If no media-downloaded entries are available, fall back to any manifest entry
	if (!entry) {
		console.warn("No media-downloaded entries available; falling back to any manifest entry.");
		const type = cfg.type === "img" ? "images" : "videos";
		const list = manifest[type] || [];
		if (!list.length) {
			console.warn("No manifest entry found. Using sample.");
			// Use a data URL for a small placeholder image to avoid file not found errors
			const sampleDataUrl = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/2wBDAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwA/AB//2Q==";
			setWallpaperElement(
				cfg.type,
				sampleDataUrl,
			);
			return null;
		}
		// simple synchronous chooser: specific -> sequence -> random
		if (cfg.mode === "specific" && cfg.specific) {
			entry = list.find((e) => e.id === cfg.specific) || list[0];
		} else if (cfg.mode === "sequence" && cfg.last_id) {
			const lastIdx = list.findIndex((e) => e.id === cfg.last_id);
			const nextIdx = lastIdx < 0 ? 0 : (lastIdx + 1) % list.length;
			entry = list[nextIdx];
		} else {
			entry = list[Math.floor(Math.random() * list.length)];
		}
	}

	// --- 3-Step Fallback Logic ---

	// 1. Try to load from Blob (Full Media, then Thumb)
	const successStep1 = await tryLoadFromBlob(entry.id, cfg.type, cfg);
	if (successStep1) {
		return entry.id; // Done! return rendered id
	}

	// 2. Retry ONCE with a new entry
	console.warn(
		`Attempt 1 (Blob) failed for ${entry.id}. Retrying with a new entry...`,
	);
	let retryEntry = await chooseEntry(manifest, cfg, entry.id); // Exclude the failed entry
	if (!retryEntry) retryEntry = entry; // Failsafe
	const successStep2 = await tryLoadFromBlob(retryEntry.id, cfg.type, cfg);
	if (successStep2) {
		return retryEntry.id; // Done!
	}

	// 3. Use Remote URL Fallback
	console.warn(
		`Attempt 2 (Retry Blob) failed for ${retryEntry.id}. Using remote fallback.`,
	);
	// We have a selected retryEntry (falls back to `entry` above),
	// so use it directly and resolve its `asset` (keys are present).
	const fallbackEntry = retryEntry;
	const remoteUrl = resolveAssetUrl(fallbackEntry.asset);

	if (remoteUrl) {
		console.log(`Rendering from remote URL: ${remoteUrl}`);
		setWallpaperElement(cfg.type, remoteUrl, cfg);
		return retryEntry.id;
	} else {
		// Final, last-resort fallback
		console.error("All fallbacks failed. Using sample.");
		const sampleDataUrl = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/2wBDAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwA/AB//2Q==";
		setWallpaperElement(
			cfg.type,
			sampleDataUrl,
		);
		return null;
	}
	// end
}

	/**
	 * Normalize a style input into a CSS value for specific properties.
	 * - If the value is a string and ends with valid unit (%) or px/em/etc, return as-is.
	 * - If a number: for blur -> treat as px (e.g., 2 -> '2px', 0.5 -> '0.5px')
	 *   for brightness/contrast/grayscale -> return number (1, 0.8) unless > 10 then treat as percent ('200%').
	 */
	function normalizeStyleValue(prop, v) {
	    if (v == null) return null;
	    if (typeof v === 'string') {
	        const trimmed = v.trim();
	        if (/^[0-9.]+%$/.test(trimmed) || /^[0-9.]+(px|em|rem|vh|vw)$/.test(trimmed)) return trimmed;
	        const num = Number(trimmed);
	        if (!Number.isNaN(num)) v = num;
	        else return trimmed;
	    }
	    if (typeof v === 'number') {
	        if (prop === 'blur') return `${v}px`;
	        if (prop === 'brightness' || prop === 'contrast' || prop === 'grayscale') {
	            if (v > 10) return `${v}%`;
	            return String(v);
	        }
	        return String(v);
	    }
	    return null;
	}

	function buildFilterString(styleCfg = {}) {
		const parts = [];
		// Helper to detect normalized 'zero' values like '0', '0px', '0%'
		const isZero = (val) => typeof val === 'string' && /^0(?:\.0+)?(?:px|%|em|rem|vh|vw)?$/.test(val);
		// Helper to detect normalized '100' for brightness/contrast (could be '100' or '100%')
		const isHundred = (val) => typeof val === 'string' && /^100(?:\.0+)?(?:%|)?$/.test(val);

		// Blur: only include if non-zero
		const rawBlur = styleCfg.blur;
		const b = normalizeStyleValue('blur', rawBlur);
		if (b && !isZero(b)) parts.push(`blur(${b})`);

		// Brightness: only include if not the neutral 100
		const brightness = normalizeStyleValue('brightness', styleCfg.brightness);
		if (brightness && !isHundred(brightness)) parts.push(`brightness(${brightness})`);

		// Contrast: only include if not the neutral 100
		const contrast = normalizeStyleValue('contrast', styleCfg.contrast);
		if (contrast && !isHundred(contrast)) parts.push(`contrast(${contrast})`);

		// Grayscale: only include if non-zero
		const grayscale = normalizeStyleValue('grayscale', styleCfg.grayscale);
		if (grayscale && !isZero(grayscale)) parts.push(`grayscale(${grayscale})`);

		const filterStr = parts.join(' ');
		try {
			if (filterStr) {
				console.debug('wallpaper: computed filter ->', filterStr, 'from', styleCfg);
			} else if (styleCfg.blur !== 0 || styleCfg.brightness !== 100 || styleCfg.contrast !== 100 || styleCfg.grayscale !== 0) {
				console.warn('wallpaper: filter is empty but styleCfg has non-default values:', styleCfg);
			}
		} catch (e) {
			// ignore
		}
		return filterStr;
	}

	function applyStyleConfigToElement(el, styleCfg = {}) {
		if (!el || !styleCfg) return;
		// Log the incoming normalized styleCfg for debugging
		try {
			console.debug('wallpaper: applyStyleConfigToElement styleCfg ->', styleCfg);
		} catch (e) {
			// ignore logging errors
		}
		const filter = buildFilterString(styleCfg);
		if (filter) el.style.filter = filter;
		if (styleCfg.position) el.style.objectPosition = String(styleCfg.position);
		if (styleCfg.scale != null) {
			let s = styleCfg.scale;
			if (typeof s === 'number') s = String(s);
			if (typeof s === 'string' && s.endsWith('%')) {
				const n = Number(s.replace('%', '')) / 100;
				el.style.transform = `scale(${n})`;
			} else {
				el.style.transform = `scale(${s})`;
			}
		}
	}

	function normalizeWallpaperConfig(cfg = {}) {
		if (!cfg || typeof cfg !== 'object') return {};
		// If caller passed the whole settings object, prefer the nested `wallpaper` key.
		const src = cfg.wallpaper && typeof cfg.wallpaper === 'object' ? cfg.wallpaper : cfg;
		const out = {
			type: src.type ?? 'img',
			mode: src.mode ?? 'random',
			specific: src.specific ?? null,
			last_id: src.last_id ?? null,
			// Use the explicit 'blur' key; don't accept typo fallbacks.
				blur: src.blur ?? 0,
			brightness: src.brightness ?? 100,
			contrast: src.contrast ?? 100,
			grayscale: src.grayscale ?? 0,
			position: src.position ?? src.objectPosition ?? undefined,
			scale: src.scale ?? undefined,
		};
		return out;
	}