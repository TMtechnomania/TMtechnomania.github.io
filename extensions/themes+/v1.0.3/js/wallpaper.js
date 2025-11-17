import { getMediaEntry } from "./db.js";
import { resolveAssetUrl } from "./api.js";

let lastObjectUrl = null;
function clearPreviousWallpaper() {
	if (lastObjectUrl) {
		try {
			URL.revokeObjectURL(lastObjectUrl);
		} catch (e) {
		}
		lastObjectUrl = null;
	}
	const prev = document.getElementById("wallpaper");
	if (prev) {
		prev.remove();
	}
}
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
	el.onerror = () => {
		el.remove();
	};
	document.body.appendChild(el);
	try {
		const normalizedStyle = normalizeWallpaperConfig(styleCfg || {});
		applyStyleConfigToElement(el, normalizedStyle);
	} catch (e) {
	}
}
function setWallpaperFromBlob(type, blob, styleCfg = {}) {
	const url = URL.createObjectURL(blob);
	setWallpaperElement(type, url, styleCfg);
	lastObjectUrl = url;
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
	const type = config.type === "img" ? "images" : "videos";
	const list = manifest[type] || [];
	if (!list.length) return null;
	const mediaReady = await filterEntriesWithMedia(list);
	let available = mediaReady.slice();
	if (available.length === 0) return null;
	if (excludeId) {
		available = available.filter((e) => e.id !== excludeId);
		if (available.length === 0) available = mediaReady.slice();
	}
	if (config.mode === "specific" && config.specific) {
		const found = available.find((e) => e.id === config.specific);
		if (found) return found;
		return null;
	}
	if (config.mode === "sequence" && config.last_id) {
		const lastIdx = available.findIndex((e) => e.id === config.last_id);
		const nextIdx = lastIdx < 0 ? 0 : (lastIdx + 1) % available.length;
		return available[nextIdx];
	}
	return available[Math.floor(Math.random() * available.length)];
}
async function tryLoadFromBlob(id, type, styleCfg = {}) {
	const mediaKey = `${id}::media`;
	const mediaEntry = await getMediaEntry(mediaKey).catch(() => null);
	if (mediaEntry && mediaEntry.status === "ok" && mediaEntry.blob) {
		setWallpaperFromBlob(type, mediaEntry.blob, styleCfg);
		return true;
	}
	const thumbKey = `${id}::thumb`;
	const thumbEntry = await getMediaEntry(thumbKey).catch(() => null);
	if (thumbEntry && thumbEntry.status === "ok" && thumbEntry.blob) {
		setWallpaperFromBlob(type, thumbEntry.blob, styleCfg);
		return true;
	}
	return false;
}
export async function renderWallpaper(config, manifest) {
	const cfg = normalizeWallpaperConfig(config || {});
	let entry = await chooseEntry(manifest, cfg, null);
	if (!entry) {
		const type = cfg.type === "img" ? "images" : "videos";
		const list = manifest[type] || [];
		if (!list.length) {
			const sampleDataUrl = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/2wBDAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwA/AB//2Q==";
			setWallpaperElement(
				cfg.type,
				sampleDataUrl,
			);
			return null;
		}
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
	const successStep1 = await tryLoadFromBlob(entry.id, cfg.type, cfg);
	if (successStep1) {
		return entry.id;
	}
	let retryEntry = await chooseEntry(manifest, cfg, entry.id);
	if (!retryEntry) retryEntry = entry;
	const successStep2 = await tryLoadFromBlob(retryEntry.id, cfg.type, cfg);
	if (successStep2) {
		return retryEntry.id;
	}
	const fallbackEntry = retryEntry;
	const remoteUrl = resolveAssetUrl(fallbackEntry.asset);
	if (remoteUrl) {
		setWallpaperElement(cfg.type, remoteUrl, cfg);
		return retryEntry.id;
	} else {
		const sampleDataUrl = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wBDAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEEAPwA/AB//2Q==";
		setWallpaperElement(
			cfg.type,
			sampleDataUrl,
		);
		return null;
	}
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