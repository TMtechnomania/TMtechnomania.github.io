import { BRAND_ICONS } from "./brandIcons.js";

const DEFAULT_ICON = "assets/svgs-fontawesome/solid/globe.svg";
const OWN_ICON = "icons/icon128.png";
const svgMarkupCache = new Map();
const REMOTE_PROTOCOL = /^https?:\/\//i;

export function resolveExtensionUrl(relativePath) {
	if (!relativePath || typeof relativePath !== "string") return relativePath;
	// Do NOT alter if already an absolute remote URL, data URI, blob URI, or chrome internal URL
	if (
		relativePath.startsWith("http://") ||
		relativePath.startsWith("https://") ||
		relativePath.startsWith("data:") ||
		relativePath.startsWith("blob:") ||
		relativePath.startsWith("chrome-extension://") ||
		relativePath.startsWith("chrome://")
	) {
		return relativePath;
	}
	try {
		if (
			typeof chrome !== "undefined" &&
			chrome.runtime &&
			chrome.runtime.getURL
		) {
			return chrome.runtime.getURL(relativePath);
		}
	} catch (e) {
		console.warn('[brandIconLoader] operation failed', e);
	}
	return relativePath;
}

export function normalizeIconPath(path) {
	if (!path || typeof path !== "string") return path;
	const trimmed = path.trim();
	if (BRAND_ICONS.includes(trimmed)) {
		return `assets/svgs-fontawesome/brands/${trimmed}.svg`;
	}
	return trimmed;
}

function isSvgPath(path) {
	return typeof path === "string" && /\.svg(\?|#|$)/i.test(path);
}

function shouldInlineSvg(path) {
	if (!path) return false;
	return isSvgPath(path) && !REMOTE_PROTOCOL.test(path) && !path.startsWith("data:");
}

function pickBrandIconPath(url) {
	if (!url) return DEFAULT_ICON;
	try {
		const isOwn =
			url.startsWith("chrome://newtab") ||
			(typeof chrome !== "undefined" &&
				chrome.runtime &&
				chrome.runtime.id &&
				url.startsWith(`chrome-extension://${chrome.runtime.id}`));
		if (isOwn) return OWN_ICON;
		const u = new URL(url);
		const hostname = u.hostname.toLowerCase();
		const parts = hostname.replace(/^www\./, "").split(".");
		let brandMatch = null;
		if (parts.length > 0) {
			const mainPart = parts[0];
			if (BRAND_ICONS.includes(mainPart)) {
				brandMatch = mainPart;
			} else {
				for (const part of parts) {
					if (BRAND_ICONS.includes(part)) {
						brandMatch = part;
						break;
					}
				}
			}
		}
		if (brandMatch)
			return `assets/svgs-fontawesome/brands/${brandMatch}.svg`;
	} catch (e) {
		console.warn('[brandIconLoader] operation failed', e);
	}
	return DEFAULT_ICON;
}

async function fetchSvgMarkup(path) {
	const absolute = resolveExtensionUrl(path);
	if (svgMarkupCache.has(absolute)) return svgMarkupCache.get(absolute);
	const promise = fetch(absolute)
		.then((resp) => (resp.ok ? resp.text() : null))
		.catch(() => null);
	svgMarkupCache.set(absolute, promise);
	return promise;
}

function createImgElement(path, imgClass, fallbackSrc) {
	const img = document.createElement("img");
	if (imgClass) img.classList.add(imgClass);
	img.alt = "";
	img.decoding = "async";
	img.loading = "lazy";
	img.referrerPolicy = "no-referrer";
	const resolved = resolveExtensionUrl(path);
	img.src = resolved;
	if (fallbackSrc && fallbackSrc !== path) {
		let applied = false;
		img.addEventListener(
			"error",
			() => {
				if (applied) return;
				applied = true;
				img.src = resolveExtensionUrl(fallbackSrc);
			},
			{ once: true },
		);
	}
	return img;
}

export async function renderInlineIcon(targetEl, iconPath, options = {}) {
	if (!targetEl) return null;
	const {
		fallbackSrc = null,
		svgClass = "inline-icon__svg",
		imgClass = "inline-icon__img",
		fallbackClass = "",
	} = options;
	targetEl.innerHTML = "";
	if (fallbackClass) targetEl.classList.remove(fallbackClass);

	const normalizedPath = normalizeIconPath(iconPath);
	if (!normalizedPath) {
		if (fallbackSrc)
			return renderInlineIcon(targetEl, fallbackSrc, {
				...options,
				fallbackSrc: null,
			});
		if (fallbackClass) targetEl.classList.add(fallbackClass);
		return null;
	}
	if (!shouldInlineSvg(normalizedPath)) {
		const img = createImgElement(normalizedPath, imgClass, fallbackSrc);
		targetEl.appendChild(img);
		return img;
	}
	const svgMarkup = await fetchSvgMarkup(normalizedPath);
	if (!svgMarkup) {
		if (fallbackSrc)
			return renderInlineIcon(targetEl, fallbackSrc, {
				...options,
				fallbackSrc: null,
			});
		if (fallbackClass) targetEl.classList.add(fallbackClass);
		return null;
	}
	targetEl.innerHTML = svgMarkup;
	const svg = targetEl.querySelector("svg");
	if (svg) {
		svg.removeAttribute("width");
		svg.removeAttribute("height");
		svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
		svg.setAttribute("focusable", "false");
		if (svgClass) svg.classList.add(svgClass);
		svg.setAttribute("role", "img");
	}
	return svg;
}

export function getIconForUrl(url) {
	return pickBrandIconPath(url);
}

export async function renderBrandIcon(targetEl, url) {
	return renderInlineIcon(targetEl, pickBrandIconPath(url), {
		fallbackSrc: DEFAULT_ICON,
		svgClass: "",
		imgClass: "",
		fallbackClass: "",
	});
}
