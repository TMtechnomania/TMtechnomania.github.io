import {
	STORAGE_KEY_SETTINGS,
	DEFAULT_CONFIG,
	WALLPAPER_JSON_URL,
	IDB_STORE_MEDIA,
} from "./config.js";
import { getAllUserWallpapers } from "./db.js";

// Simple lightweight theme applicator
function applyUserGuideTheme(settings) {
	const root = document.documentElement;

	// 1. Theme (Light/Dark/System)
	let theme = settings.theme || "system";
	if (theme === "system") {
		root.removeAttribute("data-theme");
	} else {
		root.setAttribute("data-theme", theme);
	}

	// 2. UI Scale
	const scale = settings.uiScale || 1;
	root.style.setProperty("--ui-scale", scale);

	// 3. Font
	const font = settings.font || DEFAULT_CONFIG.font;
	if (font.family) {
		root.style.setProperty("--font-family", `"${font.family}", sans-serif`);
	}

	// Load font if needed (simplified loader)
	if (font.importUrl) {
		const id = "theme-font-link";
		let link = document.getElementById(id);
		if (!link) {
			link = document.createElement("link");
			link.id = id;
			link.rel = "stylesheet";
			document.head.appendChild(link);
		}
		link.href = font.importUrl;
	}
}

async function loadSettings() {
	return new Promise((resolve) => {
		chrome.storage.local.get(STORAGE_KEY_SETTINGS, (res) => {
			const stored = res?.[STORAGE_KEY_SETTINGS] || {};
			// Merge just enough for theming
			const merged = {
				...DEFAULT_CONFIG,
				...stored,
				font: { ...DEFAULT_CONFIG.font, ...(stored.font || {}) },
			};
			resolve(merged);
		});
	});
}

function initNavigation() {
	const navItems = document.querySelectorAll(".ug-nav-item");
	navItems.forEach((item) => {
		item.addEventListener("click", () => {
			navItems.forEach((n) => n.classList.remove("active"));
			item.classList.add("active");
		});
	});
}

function capitalize(s) {
	return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
}

async function injectWallpaperStats(settings) {
	// Target the wallpaper card's list by ID
	const card = document.getElementById("wallpaper-stats-card");
	if (!card) return;

	const list = card.querySelector(".feature-list");
	if (!list) return;

	// Clear existing list items (static info)
	list.innerHTML = "";

	// 1. Current Settings
	const wpSettings = settings.wallpaper || {};
	const type = wpSettings.type || "img";
	const collection =
		wpSettings[
			type === "img"
				? "imgSettings"
				: type === "video"
				? "videoSettings"
				: "imgSettings"
		]?.collection || wpSettings.collection;

	const liSettings = document.createElement("li");
	liSettings.innerHTML = `<strong>Current:</strong> ${capitalize(
		type,
	)} / ${capitalize(collection)}`;
	list.appendChild(liSettings);

	// 2. Downloaded Count (from IDB)
	try {
		// DB init is handled internally by getAllUserWallpapers
		const userWalls = await getAllUserWallpapers(); // User uploaded
		// Predefined downloaded count: we'd need to check media store.
		// For now, let's just show User Uploaded stats for correct context.
		// Or "Downloaded" might imply "Predefined that are cached".

		// Let's count user wallpapers by type
		const userImg = userWalls.filter((w) => w.type === "img").length;
		const userVid = userWalls.filter((w) => w.type === "video").length;

		const liUser = document.createElement("li");
		liUser.innerHTML = `<strong>User Uploads:</strong> ${userImg} Images, ${userVid} Videos`;
		list.appendChild(liUser);
	} catch (e) {
		console.error("Failed to load DB stats", e);
	}

	// 3. Available Online (Fetch Manifest)
	try {
		const resp = await fetch(WALLPAPER_JSON_URL);
		const manifest = await resp.json();
		const availableImg = (manifest.images || []).length;
		const availableVid = (manifest.videos || []).length;

		const liOnline = document.createElement("li");
		liOnline.innerHTML = `<strong>Available Online:</strong> ${availableImg} Images, ${availableVid} Videos`;
		list.appendChild(liOnline);
	} catch (e) {
		console.warn("Failed to fetch wallpaper manifest", e);
		const liErr = document.createElement("li");
		liErr.innerHTML = `<strong>Online:</strong> Offline / Error`;
		list.appendChild(liErr);
	}
}

// Initialize
(async () => {
	const settings = await loadSettings();
	applyUserGuideTheme(settings);
	initNavigation();
	injectWallpaperStats(settings); // Add this
})();
