import { getMediaEntry, getAllUserWallpapers } from "./db.js";

let lastObjectUrl = null;
let lastThumbUrl = null;

function clearPreviousWallpaper() {
	if (lastObjectUrl) {
		try {
			URL.revokeObjectURL(lastObjectUrl);
		} catch (e) {
		}
		lastObjectUrl = null;
	}
    if (lastThumbUrl) {
        try {
            URL.revokeObjectURL(lastThumbUrl);
        } catch (e) {}
        lastThumbUrl = null;
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
		el.muted = true;
		el.playsInline = true;
        if (thumbUrl) {
            el.poster = thumbUrl;
        }
		// Handle autoplay failures (browser policy)
		el.addEventListener('canplay', () => {
			el.play().catch(err => {
				console.warn('[Wallpaper] Video autoplay blocked:', err.message);
			});
		}, { once: true });
		// Handle video stall/error
		el.addEventListener('stalled', () => {
			console.warn('[Wallpaper] Video playback stalled');
		});
		el.addEventListener('error', (e) => {
			const error = el.error;
			console.error('[Wallpaper] Video load error:', error ? `${error.code}: ${error.message}` : 'Unknown error');
			el.remove();
		});
	} else {
		el.onerror = () => {
			console.error('[Wallpaper] Image load error for:', url);
			el.remove();
		};
	}
	document.body.appendChild(el);
	try {
		const normalizedStyle = normalizeWallpaperConfig(styleCfg || {});
		applyStyleConfigToElement(el, normalizedStyle);
	} catch (e) {
	}
}
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
async function filterEntriesWithMedia(list) {
	if (!Array.isArray(list) || list.length === 0) return [];
	const checks = await Promise.all(
		list.map(async (entry) => {
			try {
				const me = await getMediaEntry(`${entry.id}::media`).catch(() => null);
				if (me && me.status === "ok" && me.blob) return entry;
			} catch (e) {
			}
			return null;
		}),
	);
	return checks.filter(Boolean);
}
async function chooseEntry(manifest, config, excludeId = null) {
    let list = [];
    let effectiveMode = config.mode;
    
    // Get the wallpaper list based on collection
    if (config.collection === 'user') {
        const userWalls = await getAllUserWallpapers();
        // Filter by type - explicit check for both types
        const targetType = config.type === 'img' ? 'img' : (config.type === 'video' ? 'video' : null);
        if (targetType) {
            list = userWalls.filter(w => w.type === targetType);
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
            if (effectiveMode === 'specific') {
                effectiveMode = 'random';
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

async function tryLoadFromBlob(id, type, styleCfg = {}) {
    // User Wallpaper
    if (String(id).startsWith('user-wall-')) {
        const userWalls = await getAllUserWallpapers();
        const found = userWalls.find(w => w.id === id);
        if (found && found.blob) {
            setWallpaperFromBlob(type, found.blob, styleCfg, found.thumbBlob);
            return true;
        }
        return false;
    }

    // Predefined wallpaper
	const mediaKey = `${id}::media`;
	const mediaEntry = await getMediaEntry(mediaKey).catch(() => null);
	if (mediaEntry && mediaEntry.status === "ok" && mediaEntry.blob) {
        let thumbBlob = null;
        if (type === 'video') {
             const thumbKey = `${id}::thumb`;
             const thumbEntry = await getMediaEntry(thumbKey).catch(() => null);
             if (thumbEntry && thumbEntry.status === 'ok' && thumbEntry.blob) {
                 thumbBlob = thumbEntry.blob;
             }
        }
		setWallpaperFromBlob(type, mediaEntry.blob, styleCfg, thumbBlob);
		return true;
	}
	return false;
}

export async function renderWallpaper(config, manifest) {
	const cfg = normalizeWallpaperConfig(config || {});
	
	// Handle Mono Mode
	if (cfg.type === 'mono') {
		clearPreviousWallpaper();
		document.body.style.backgroundColor = 'var(--color-off)';
		return null;
	} else {
		document.body.style.backgroundColor = '';
	}

	// Get entry (chooseEntry handles all fallback logic)
	let entry = await chooseEntry(manifest, cfg, null);
	
	if (!entry) {
		// Should not happen if predefined wallpapers exist
		// console.warn('No wallpaper entry found');
		return null;
	}
	
	// Load the wallpaper
	const success = await tryLoadFromBlob(entry.id, cfg.type, cfg);
	if (success) {
		return entry.id;
	}
	
	// First entry failed - try another
	let retryEntry = await chooseEntry(manifest, cfg, entry.id);
	if (retryEntry) {
		const retrySuccess = await tryLoadFromBlob(retryEntry.id, cfg.type, cfg);
		if (retrySuccess) {
			return retryEntry.id;
		}
	}
	
	// Should not reach here if predefined wallpapers exist and are downloaded
	// console.warn('Failed to load any wallpaper');
	return null;
}
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
		const isZero = (val) => typeof val === 'string' && /^0(?:\.0+)?(?:px|%|em|rem|vh|vw)?$/.test(val);
		const isHundred = (val) => typeof val === 'string' && /^100(?:\.0+)?(?:%|)?$/.test(val);
		const rawBlur = styleCfg.blur;
		const b = normalizeStyleValue('blur', rawBlur);
		if (b && !isZero(b)) parts.push(`blur(${b})`);
		const brightness = normalizeStyleValue('brightness', styleCfg.brightness);
		if (brightness && !isHundred(brightness)) parts.push(`brightness(${brightness})`);
		const contrast = normalizeStyleValue('contrast', styleCfg.contrast);
		if (contrast && !isHundred(contrast)) parts.push(`contrast(${contrast})`);
		const grayscale = normalizeStyleValue('grayscale', styleCfg.grayscale);
		if (grayscale && !isZero(grayscale)) parts.push(`grayscale(${grayscale})`);
		const filterStr = parts.join(' ');
		try {
			if (filterStr) {
			} else if (styleCfg.blur !== 0 || styleCfg.brightness !== 100 || styleCfg.contrast !== 100 || styleCfg.grayscale !== 0) {
			}
		} catch (e) {
		}
		return filterStr;
	}
	function applyStyleConfigToElement(el, styleCfg = {}) {
		if (!el || !styleCfg) return;
		try {
		} catch (e) {
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
		const src = cfg.wallpaper && typeof cfg.wallpaper === 'object' ? cfg.wallpaper : cfg;
		const out = {
			type: src.type ?? 'img',
			mode: src.mode ?? 'random',
            collection: src.collection ?? 'predefined',
			specific: src.specific ?? null,
			last_id: src.last_id ?? null,
				blur: src.blur ?? 0,
			brightness: src.brightness ?? 100,
			contrast: src.contrast ?? 100,
			grayscale: src.grayscale ?? 0,
			position: src.position ?? src.objectPosition ?? undefined,
			scale: src.scale ?? undefined,
		};
		return out;
	}