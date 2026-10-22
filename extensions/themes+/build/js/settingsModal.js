import { loadCSS, unloadCSS } from "./cssLoader.js";
import {
	STORAGE_KEY_SETTINGS,
	STORAGE_KEY_WALLPAPER_ROTATION,
	DEFAULT_CONFIG,
	applyTheme,
	DEFAULT_SHORTCUTS,
	DUOTONE_THEMES,
	FILTER_PRESETS,
	FILTER_PRESET_KEYS,
} from "./config.js";
import {
	normalizeSettings,
	onSettingsChanged,
	applyRemoteSettings,
	hasSettingsDelta,
	queueSettingsWrite,
	flushSettingsWrite,
	getSettingsRevision,
	getPendingSettingsPaths,
} from "./settingsSync.js";
import { toggleRain } from "./rainEffect.js";
import {
	renderSearchbar,
	removeSearchbar,
	computePositionStyles,
} from "./searchbar.js";
import { resolveAssetUrl, downloadAndStoreResource } from "./api.js";
import {
	getMediaEntry,
	getAllMediaKeys,
	deleteMediaEntry,
	saveUserWallpaper,
	deleteUserWallpaper,
	getAllUserWallpapers,
	getUserWallpaperList,
	getUserWallpaperById,
	saveZenTrack,
	getZenTrackList,
	deleteZenTrack,
} from "./db.js";
import { initActionBar } from "./actionbar.js";
import { refreshZenMusic, setZenMusicMode, setZenMusicSource } from "./ambientMode.js";
import { renderInlineIcon } from "./brandIconLoader.js";
import { showAlert, setupModalA11y } from "./uiUtil.js";
import { readDefaultMediaIds } from "./wallpaperDefaults.js";
import { openShortcutModal } from "./shortcutsModal.js";
import {
	renderWallpaper,
	clearMediaKeysCache,
	applyWallpaperFilters,
} from "./wallpaper.js";
import { loadFont } from "./clockWidget.js";
import { getDailyQuote, shuffleQuote } from "./quotes.js";
import {
	clearWeatherPlace,
	getSavedPlace,
	requestGeolocation,
} from "./weather.js";

// User wallpaper upload limits. Blobs live in IndexedDB and the extension has
// `unlimitedStorage`, so these are product limits rather than browser quotas.
const UPLOAD_LIMITS = {
	img: { maxBytes: 25 * 1024 * 1024, maxCount: 100 },
	video: { maxBytes: 200 * 1024 * 1024, maxCount: 40 },
};

let _settingsModalOpen = false;
let _settingControlSeq = 0;
let _settingsModalA11yCleanup = null;

// Cross-tab change notice shown inside an open settings panel. The revision
// is captured when the panel opens; any later remote edit makes the panel's
// values potentially stale, so the user gets a refresh affordance.
let syncWarningEl = null;
let settingsOpenedRevision = 0;
let _storageMeterTimer = null;

function showSettingsSyncWarning(message) {
	if (!syncWarningEl || !syncWarningEl.isConnected) return;
	if (message) {
		const text = syncWarningEl.querySelector(".text");
		if (text) text.textContent = message;
	}
	syncWarningEl.hidden = false;
}

function dismissSettingsSyncWarning() {
	if (syncWarningEl && syncWarningEl.isConnected) {
		syncWarningEl.hidden = true;
	}
}

export function isSettingsModalOpen() {
	return _settingsModalOpen;
}

export async function toggleSettingsModal() {
	if (_settingsModalOpen) {
		closeSettingsModalIfOpen();
	} else {
		await openSettingsModal();
	}
}

export function closeSettingsModalIfOpen() {
	const el = document.getElementById("settings-modal");
	if (el) {
		// Persist anything still queued (debounce) before the panel goes away.
		flushSettingsWrite();
		// Add slideDown animation before removal
		el.style.animation = "slideDown var(--transition-normal) forwards";
		el.addEventListener(
			"animationend",
			() => {
				if (_settingsModalA11yCleanup) {
					_settingsModalA11yCleanup();
					_settingsModalA11yCleanup = null;
				}
				try {
					document.body.removeChild(el);
				} catch (e) {}
				unloadCSS("settings-css");
				cleanupWallpaperGrid();
				_settingsModalOpen = false;
				document.dispatchEvent(new CustomEvent("settings:closed"));
			},
			{ once: true },
		);
	}
}

export async function openSettingsTab(tabId) {
	if (!_settingsModalOpen) {
		await openSettingsModal();
	}
	// Switch to the specified tab
	setTimeout(() => {
		// Find all tab buttons
		const buttons = document.querySelectorAll(".settings-tab-btn");
		let targetBtn = null;

		// Find the button for the specified tab
		buttons.forEach((btn, index) => {
			const tabs = [
				"general",
				"wallpaper",
				"search",
				"actionbar",
				"zen",
				"about",
			];
			if (tabs[index] === tabId) {
				targetBtn = btn;
			}
		});

		if (targetBtn) {
			targetBtn.click();

			// If it's the actionbar tab, scroll to shortcuts section
			if (tabId === "actionbar") {
				setTimeout(() => {
					const shortcutsSection = document.getElementById(
						"shortcuts-management-section",
					);
					if (shortcutsSection) {
						shortcutsSection.scrollIntoView({
							behavior: "smooth",
							block: "start",
						});
					}
				}, 200);
			}
		}
	}, 100);
}

async function openSettingsModal() {
	await loadCSS("css/settingsModal.css", "settings-css");

	const modal = document.createElement("div");
	modal.id = "settings-modal";
	modal.className = "settings-modal";
	modal.setAttribute("role", "dialog");
	modal.setAttribute("aria-modal", "true");

	// Load current settings
	const currentSettings = await getSettings();
	settingsOpenedRevision = getSettingsRevision();

	// Listen for external settings updates (like from ActionBar)
	const onSettingsUpdate = (e) => {
		if (e.detail) {
			// Deep sync specifically for actionbar.famcam.flash
			if (e.detail.actionbar?.famcam?.flash) {
				if (!currentSettings.actionbar) currentSettings.actionbar = {};
				if (!currentSettings.actionbar.famcam)
					currentSettings.actionbar.famcam = {};
				currentSettings.actionbar.famcam.flash = {
					...currentSettings.actionbar.famcam.flash,
					...e.detail.actionbar.famcam.flash,
				};
			}
		}
	};
	document.addEventListener("settings:updated", onSettingsUpdate);

	// Failed writes (quota, disk) are otherwise silent: surface them in the
	// same banner, with the reload/refresh affordance still available.
	const onWriteError = (e) => {
		showSettingsSyncWarning(
			`Settings could not be saved${
				e?.detail ? ` (${e.detail})` : ""
			}. Free up storage, then refresh.`,
		);
	};
	document.addEventListener("settings:write-error", onWriteError);

	// Cleanup on close
	document.addEventListener(
		"settings:closed",
		() => {
			document.removeEventListener("settings:updated", onSettingsUpdate);
			document.removeEventListener("settings:write-error", onWriteError);
		},
		{ once: true },
	);

	// Header
	const header = document.createElement("div");
	header.className = "modal-header";

	const title = document.createElement("div");
	title.className = "btn btn-icon-text btn-display modal-title";
	title.id = "settings-modal-title";
	title.innerHTML = `<span></span><span class="text">Settings</span>`;
	renderInlineIcon(
		title.querySelector("span:first-child"),
		"assets/svgs-fontawesome/solid/gear.svg",
	);
	modal.setAttribute("aria-labelledby", "settings-modal-title");

	const closeBtn = document.createElement("button");
	closeBtn.className = "btn btn-icon";
	const closeIcon = document.createElement("span");
	renderInlineIcon(closeIcon, "assets/svgs-fontawesome/solid/xmark.svg");
	closeBtn.appendChild(closeIcon);
	closeBtn.addEventListener("click", closeSettingsModalIfOpen);

	header.appendChild(title);
	header.appendChild(closeBtn);
	modal.appendChild(header);

	// Cross-tab change notice: hidden until another tab changes settings while
	// this panel is open. Sits between the header and the body so it cannot be
	// scrolled out of view, and offers a one-click refresh.
	const syncWarning = document.createElement("div");
	syncWarning.className = "settings-sync-warning";
	syncWarning.hidden = true;
	syncWarning.setAttribute("role", "status");
	syncWarning.setAttribute("aria-live", "polite");

	const syncWarningText = document.createElement("span");
	syncWarningText.className = "text";
	syncWarningText.textContent =
		"Settings were changed in another tab. Refresh to proceed with the new settings.";

	const syncRefreshBtn = document.createElement("button");
	syncRefreshBtn.type = "button";
	syncRefreshBtn.className = "btn btn-text settings-sync-refresh";
	syncRefreshBtn.textContent = "Refresh";
	syncRefreshBtn.title = "Reload this page with the latest settings";
	syncRefreshBtn.addEventListener("click", () => {
		// Flush any debounced edit first, then rebuild the page from storage so
		// every widget picks up the other tab's values.
		flushSettingsWrite().finally(() => location.reload());
	});

	syncWarning.append(syncWarningText, syncRefreshBtn);
	modal.appendChild(syncWarning);
	syncWarningEl = syncWarning;

	// Body
	const body = document.createElement("div");
	body.className = "settings-body";

	// Sidebar
	const sidebar = document.createElement("div");
	sidebar.className = "settings-sidebar";

	const content = document.createElement("div");
	content.className = "settings-content";

	const tabs = [
		{
			id: "general",
			label: "General",
			icon: "assets/svgs-fontawesome/solid/sliders.svg",
		},
		{
			id: "wallpaper",
			label: "Wallpaper",
			icon: "assets/svgs-fontawesome/solid/image.svg",
		},
		{
			id: "search",
			label: "Search",
			icon: "assets/svgs-fontawesome/solid/search.svg",
		},
		{
			id: "actionbar",
			label: "Action Bar",
			icon: "assets/svgs-fontawesome/solid/bars.svg",
		},
		{
			id: "zen",
			label: "Zen Mode",
			icon: "assets/svgs-fontawesome/solid/headphones.svg",
		},
		{
			id: "about",
			label: "About",
			icon: "assets/svgs-fontawesome/solid/circle-question.svg",
		},
	];

	let activeTabId = "general";
	// Sections whose controls may be stale after a change from another tab.
	const staleSections = new Set();

	tabs.forEach((tab) => {
		const btn = document.createElement("button");
		btn.className = `btn btn-icon-text settings-tab-btn ${
			tab.id === activeTabId ? "active" : ""
		}`;
		const icon = document.createElement("span");
		// icon.className = 'settings-tab-icon'; // Removed
		icon.setAttribute("aria-hidden", "true");
		renderInlineIcon(icon, tab.icon);
		btn.appendChild(icon);
		const label = document.createElement("span");
		label.className = "text";
		label.textContent = tab.label;
		btn.appendChild(label);
		btn.addEventListener("click", () => {
			// Switch tabs
			sidebar
				.querySelectorAll(".settings-tab-btn")
				.forEach((b) => b.classList.remove("active"));
			btn.classList.add("active");

			content
				.querySelectorAll(".settings-section")
				.forEach((s) => s.classList.remove("active"));
			const target = content.querySelector(`#settings-section-${tab.id}`);
			if (target) {
				target.classList.add("active");
				// Rebuild on first view if another tab changed settings while
				// this section was hidden, so it never shows stale values.
				if (staleSections.has(tab.id)) {
					renderSettingsSection(target, currentSettings);
					staleSections.delete(tab.id);
				}
			}
		});
		sidebar.appendChild(btn);
	});

	// Sections
	tabs.forEach((tab) => {
		const section = document.createElement("div");
		section.id = `settings-section-${tab.id}`;
		section.className = `settings-section ${
			tab.id === activeTabId ? "active" : ""
		}`;

		renderSectionContent(section, tab.id, currentSettings);
		content.appendChild(section);
	});

	body.appendChild(sidebar);
	body.appendChild(content);
	modal.appendChild(body);

	document.body.appendChild(modal);
	_settingsModalOpen = true;
	if (_settingsModalA11yCleanup) _settingsModalA11yCleanup();
	_settingsModalA11yCleanup = setupModalA11y(modal, {
		onClose: closeSettingsModalIfOpen,
	});

	// Cross-tab sync: when another tab changes settings, merge the new values
	// into the object every control closure holds and repaint the visible
	// section, so an open modal never keeps showing stale values.
	// Deferred section refresh: while the user is interacting (focus or a held
	// pointer, e.g. a colour picker or upload), refresh after it settles rather
	// than destroying the control under them. Re-evaluated on every focusout,
	// so moving between fields inside the section does not lose the pending
	// refresh (the old `{ once: true }` listener did).
	let pointerDown = false;
	let pendingSectionRefresh = null;

	const flushPendingSectionRefresh = () => {
		const pending = pendingSectionRefresh;
		if (!pending) return;
		if (!pending.section.isConnected) {
			pendingSectionRefresh = null;
			return;
		}
		if (pointerDown) return;
		const focused = document.activeElement;
		if (focused && pending.section.contains(focused)) return;
		pendingSectionRefresh = null;
		renderSettingsSection(pending.section, currentSettings);
		staleSections.delete(pending.tabId);
	};

	const onPointerDown = () => {
		pointerDown = true;
	};
	const onPointerUp = () => {
		pointerDown = false;
		flushPendingSectionRefresh();
	};
	document.addEventListener("focusout", flushPendingSectionRefresh, true);
	document.addEventListener("pointerdown", onPointerDown, true);
	window.addEventListener("pointerup", onPointerUp, true);
	window.addEventListener("pointercancel", onPointerUp, true);

	const stopRemoteSync = onSettingsChanged((next) => {
		// Never rebuild for our own save echoed back, or for values this panel
		// already shows - rebuilding here is what made it jump back to the top.
		if (
			!hasSettingsDelta(currentSettings, next)
		) {
			return;
		}

		// Another tab changed settings while this panel was open. Only warn
		// when this panel still has unflushed local edits that could conflict;
		// otherwise the remote values are merged silently.
		const hasLocalEdits = getPendingSettingsPaths().size > 0;
		if (
			hasLocalEdits &&
			getSettingsRevision() !== settingsOpenedRevision
		) {
			showSettingsSyncWarning();
		} else if (!hasLocalEdits) {
			dismissSettingsSyncWarning();
		}

		const active = content.querySelector(".settings-section.active");
		const focused = document.activeElement;
		const busy =
			!!active && (pointerDown || (!!focused && active.contains(focused)));

		// Merge only keys without an unflushed local edit, so a remote save
		// cannot revert the value the user just changed in this panel.
		applyRemoteSettings(currentSettings, next);
		settingsOpenedRevision = getSettingsRevision();
		tabs.forEach((tab) => staleSections.add(tab.id));
		if (!active) return;

		const tabId = active.id.replace("settings-section-", "");
		if (busy) {
			// Do not rebuild under the user's cursor / an open picker: remember
			// the section and refresh when focus and the pointer leave it.
			pendingSectionRefresh = { section: active, tabId };
			return;
		}

		renderSettingsSection(active, currentSettings);
		staleSections.delete(tabId);
	});
	document.addEventListener(
		"settings:closed",
		() => {
			stopRemoteSync();
			dismissSettingsSyncWarning();
			document.removeEventListener(
				"focusout",
				flushPendingSectionRefresh,
				true,
			);
			document.removeEventListener(
				"pointerdown",
				onPointerDown,
				true,
			);
			window.removeEventListener("pointerup", onPointerUp, true);
			window.removeEventListener("pointercancel", onPointerUp, true);
			pendingSectionRefresh = null;
		},
		{ once: true },
	);

	// Close on click outside
	modal.addEventListener("click", (e) => {
		if (e.target === modal) closeSettingsModalIfOpen();
	});
}

/**
 * Keep a scroll container where it was while its content is rebuilt.
 *
 * The settings content is repopulated asynchronously (the wallpaper grid
 * re-fetches its manifest and user list), so a single synchronous restore is
 * not enough: the container is briefly short, scrollTop clamps, and the panel
 * appears to jump to the top. This re-applies the position while the content
 * grows, and stops the moment the user scrolls themselves.
 */
function keepScrollPosition(scroller, top, timeoutMs = 1200) {
	if (!scroller || !Number.isFinite(top) || top <= 0) return;

	let cancelled = false;
	let observer = null;

	const apply = () => {
		if (cancelled) return;
		scroller.scrollTop = top;
	};
	const stop = () => {
		cancelled = true;
		try {
			observer?.disconnect();
		} catch (e) {}
		["wheel", "touchstart", "keydown"].forEach((ev) =>
			scroller.removeEventListener(ev, stop),
		);
	};

	// Only real user input should cancel the restore - our own scrollTop
	// writes fire "scroll" and would otherwise cancel immediately.
	["wheel", "touchstart", "keydown"].forEach((ev) =>
		scroller.addEventListener(ev, stop, { passive: true }),
	);

	if (typeof ResizeObserver !== "undefined") {
		observer = new ResizeObserver(apply);
		const target =
			scroller.querySelector(".settings-section.active") ||
			scroller.firstElementChild;
		if (target) observer.observe(target);
	}

	apply();
	requestAnimationFrame(apply);
	setTimeout(apply, 60);
	setTimeout(() => {
		apply();
		stop();
	}, timeoutMs);
}

/**
 * Rebuild one settings section from the given settings, preserving the
 * content scroll position. Used when settings changed in another tab.
 */
function renderSettingsSection(section, settings) {
	if (!section) return;
	const tabId = String(section.id || "").replace("settings-section-", "");
	if (!tabId) return;

	const scroller = section.closest(".settings-content");
	const scrollTop = scroller ? scroller.scrollTop : 0;

	cleanupWallpaperGrid();
	// Clearing only (empty string) - no untrusted markup is injected here.
	section.innerHTML = "";
	try {
		renderSectionContent(section, tabId, settings);
	} catch (e) {
		console.warn("[Settings] failed to refresh section", tabId, e);
	}
	// A programmatic refresh should not replay the section's fade-in: that is
	// what made a synced update read as "the panel reloaded".
	section.style.animation = "none";

	keepScrollPosition(scroller, scrollTop);
}

async function getSettings() {
	// Make sure a queued (debounced) change is on disk before reading. The
	// flush now merges against the latest stored value, so wait for it.
	try {
		await flushSettingsWrite();
	} catch (e) {}
	return new Promise((resolve) => {
		chrome.storage.local.get(STORAGE_KEY_SETTINGS, (res) => {
			if (chrome.runtime?.lastError) {
				resolve(DEFAULT_CONFIG);
				return;
			}
			resolve(normalizeSettings(res?.[STORAGE_KEY_SETTINGS]));
		});
	});
}

/** Current slideshow cursor (kept outside userSettings). */
function readWallpaperRotationId() {
	return new Promise((resolve) => {
		try {
			chrome.storage.local.get(STORAGE_KEY_WALLPAPER_ROTATION, (res) => {
				resolve(res?.[STORAGE_KEY_WALLPAPER_ROTATION]?.last_id || null);
			});
		} catch (e) {
			resolve(null);
		}
	});
}

async function saveSettings(newSettings) {
	// The user is proceeding from whatever state another tab wrote. Record the
	// current revision so future remote changes can warn again, and clear any
	// stale banner before the debounced write.
	settingsOpenedRevision = getSettingsRevision();
	dismissSettingsSyncWarning();
	queueSettingsWrite(newSettings);
}

function renderSectionContent(container, tabId, settings) {
	if (tabId === "general") {
		// Theme
		const themes = [
			{ value: "system", label: "System" },
			{ value: "light", label: "Light" },
			{ value: "dark", label: "Dark" },
			{ value: "glass", label: "Glass" },
		];
		const themeSelect = addSelect(
			container,
			"Theme",
			(
				settings.wallpaper.type === "duotone" ||
					settings.wallpaper.type === "matrix"
			) ?
				"Locked to Dark Mode by current wallpaper."
			:	"Choose your preferred theme. Glass adds translucent, blurred panels.",
			themes,
			settings.theme || "system",
			(val) => {
				settings.theme = val;
				saveSettings(settings);
				applyTheme(val);
			},
		);

		// Disable Theme Select if Duotone or Matrix
		if (
			settings.wallpaper.type === "duotone" ||
			settings.wallpaper.type === "matrix"
		) {
			const selectEl = themeSelect.querySelector("select");
			if (selectEl) {
				selectEl.disabled = true;
				selectEl.title =
					"Theme is locked to Dark Mode while Matrix/Duotone wallpaper is active. Change wallpaper type to unlock.";
			}
			// Also disable the navigation buttons (left/right)
			const navBtns = themeSelect.querySelectorAll("button");
			navBtns.forEach((btn) => {
				btn.disabled = true;
				btn.style.opacity = "0.3";
				btn.style.pointerEvents = "none";
			});
		}

		// Action Bar Autohide
		addToggle(
			container,
			"Auto-hide Action Bar",
			"Hide the bottom toolbar when not in use.",
			settings.actionbar.autohide,
			(val) => {
				settings.actionbar.autohide = val;
				saveSettings(settings);
				initActionBar(settings.actionbar, settings); // Re-init to apply
			},
		);

		// UI Scaling
		const scales = [
			{ value: 0.8, label: "Small (80%)" },
			{ value: 1, label: "Normal (100%)" },
			{ value: 1.2, label: "Large (120%)" },
		];
		addSelect(
			container,
			"UI Scaling",
			"Adjust the interface size relative to your screen.",
			scales,
			settings.uiScale || 1,
			(val) => {
				const numVal = parseFloat(val);
				settings.uiScale = numVal;
				saveSettings(settings);
				document.dispatchEvent(
					new CustomEvent("settings:uiScale", { detail: numVal }),
				);
			},
		);

		// Font Family
		const fonts = [
			{ value: "Outfit", label: "Outfit (Default)" },
			{ value: "Inter", label: "Inter" },
			{ value: "Roboto", label: "Roboto" },
			{ value: "Open Sans", label: "Open Sans" },
			{ value: "Lato", label: "Lato" },
		];
		addSelect(
			container,
			"UI Font Family",
			"Choose the primary font for the interface.",
			fonts,
			settings.font.family,
			(val) => {
				settings.font.family = val;
				// Update import URL based on selection (simplified for now)
				if (val === "Outfit")
					settings.font.importUrl =
						"https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;700;800&display=swap";
				if (val === "Inter")
					settings.font.importUrl =
						"https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;700;800&display=swap";
				if (val === "Roboto")
					settings.font.importUrl =
						"https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500;700&display=swap";
				if (val === "Open Sans")
					settings.font.importUrl =
						"https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400;600;700&display=swap";
				if (val === "Lato")
					settings.font.importUrl =
						"https://fonts.googleapis.com/css2?family=Lato:wght@300;400;700&display=swap";

				saveSettings(settings);
				// Apply font immediately
				applyFont(settings.font);
			},
		);

		// On-Screen Clock
		if (!settings.onScreenClock)
			settings.onScreenClock = { enabled: false, font: "default" };

		addToggle(
			container,
			"On-Screen Clock",
			"Show a large clock on the main screen.",
			settings.onScreenClock.enabled,
			(val) => {
				settings.onScreenClock.enabled = val;
				saveSettings(settings);
				document.dispatchEvent(
					new CustomEvent("settings:clock", { detail: settings }),
				);
			},
		);

		const clockFonts = [
			{ value: "default", label: "Default (UI Font)" },
			{ value: "Bitcount Grid Single", label: "Bitcount Grid Single" },
			{ value: "PT Serif", label: "PT Serif" },
			{ value: "Anton", label: "Anton" },
			{ value: "Pacifico", label: "Pacifico" },
			{ value: "Lobster", label: "Lobster" },
			{ value: "Abril Fatface", label: "Abril Fatface" },
			{ value: "Titan One", label: "Titan One" },
			{ value: "Monoton", label: "Monoton" },
			{ value: "Kenia", label: "Kenia" },
			{ value: "Fredericka the Great", label: "Fredericka the Great" },
			{ value: "Libertinus Keyboard", label: "Libertinus Keyboard" },
			{ value: "Stardos Stencil", label: "Stardos Stencil" },

			// New additions
			{ value: "Bebas Neue", label: "Bebas Neue" },
			{ value: "Rubik Dirt", label: "Rubik Dirt" },
			{ value: "Moirai One", label: "Moirai One" },
			{ value: "Rubik Glitch", label: "Rubik Glitch" },
			{ value: "Rampart One", label: "Rampart One" },
			{ value: "Rubik Wet Paint", label: "Rubik Wet Paint" },
			{ value: "Rubik Vinyl", label: "Rubik Vinyl" },
			{ value: "Notable", label: "Notable" },
			{ value: "Plaster", label: "Plaster" },
			{ value: "Tourney", label: "Tourney" },
			{ value: "Kumar One Outline", label: "Kumar One Outline" },
			{ value: "Foldit", label: "Foldit" },
			{ value: "Rubik 80s Fade", label: "Rubik 80s Fade" },
		];

		const fontRow = addSelect(
			container,
			"Clock Font",
			"Choose a font for the on-screen clock.",
			clockFonts,
			settings.onScreenClock.font || "default",
			(val) => {
				settings.onScreenClock.font = val;
				saveSettings(settings);
				document.dispatchEvent(
					new CustomEvent("settings:clock", { detail: settings }),
				);
				updatePreview();
			},
		);

		// Font Preview
		const previewContainer = document.createElement("div");
		previewContainer.style.padding = "var(--dis-4)";
		previewContainer.style.textAlign = "center";
		previewContainer.style.background = "var(--color-off)";
		previewContainer.style.borderRadius = "var(--radius-xs)";
		previewContainer.style.marginTop = "var(--dis-1)";
		previewContainer.style.marginBottom = "var(--dis-2)";
		previewContainer.style.transition = "all 0.3s ease";

		const previewText = document.createElement("div");
		previewText.textContent = "12:34";
		previewText.style.fontSize = "3rem";
		previewText.style.lineHeight = "1";
		previewContainer.appendChild(previewText);

		const updatePreview = () => {
			const cfg = settings.onScreenClock;
			const fontName = cfg.font || "default";

			// Font
			if (fontName && fontName !== "default") {
				loadFont(fontName);
				previewText.style.fontFamily = `"${fontName}", sans-serif`;
			} else {
				previewText.style.fontFamily = ""; // Inherit
			}

			// Color
			previewText.style.color = "";
			if (cfg.color === "inverse") {
				previewText.style.color = "var(--text-invert)";
			} else if (cfg.color === "custom" && cfg.customColor) {
				previewText.style.color = cfg.customColor;
			} else {
				previewText.style.color = "var(--text-base)";
			}

			// Outline
			previewText.style.webkitTextStroke = "";
			if (cfg.outline) {
				let strokeColor;
				if (cfg.outlineColor) {
					strokeColor = cfg.outlineColor;
				} else {
					// Fallback logic
					strokeColor =
						cfg.color === "inverse" ?
							"var(--text-base)"
						:	"var(--text-invert)";
				}
				previewText.style.webkitTextStroke = `0.02em ${strokeColor}`;
			}
		};

		// Initial Update
		updatePreview();

		container.appendChild(previewContainer);

		const clockColors = [
			{ value: "default", label: "Default (Theme Text)" },
			{ value: "inverse", label: "Inverse (Opposite Theme)" },
			{ value: "custom", label: "Custom Color" },
		];

		let customColorRow = null;

		addSelect(
			container,
			"Clock Color",
			"Choose the color style for the clock.",
			clockColors,
			settings.onScreenClock.color || "default",
			(val) => {
				if (!settings.onScreenClock) settings.onScreenClock = {};
				settings.onScreenClock.color = val;
				saveSettings(settings);

				if (customColorRow) {
					customColorRow.style.display =
						val === "custom" ? "flex" : "none";
				}

				document.dispatchEvent(
					new CustomEvent("settings:clock", { detail: settings }),
				);
				updatePreview();
			},
		);

		customColorRow = addColorPicker(
			container,
			"Custom Text Color",
			"Pick a custom color for the clock text.",
			settings.onScreenClock.customColor || "#ffffff",
			(val) => {
				if (!settings.onScreenClock) settings.onScreenClock = {};
				settings.onScreenClock.customColor = val;
				saveSettings(settings);
				document.dispatchEvent(
					new CustomEvent("settings:clock", { detail: settings }),
				);
				updatePreview();
			},
		);
		customColorRow.style.display =
			settings.onScreenClock.color === "custom" ? "flex" : "none";

		addToggle(
			container,
			"Show Seconds",
			"Display seconds on the clock.",
			settings.onScreenClock.showSeconds || false,
			(val) => {
				if (!settings.onScreenClock) settings.onScreenClock = {};
				settings.onScreenClock.showSeconds = val;
				saveSettings(settings);
				document.dispatchEvent(
					new CustomEvent("settings:clock", { detail: settings }),
				);
			},
		);

		let outlineModeRow = null;
		let outlineColorRow = null;

		addToggle(
			container,
			"Outline Text",
			"Add a stroke outline to all clock and greeting text.",
			settings.onScreenClock.outline || false,
			(val) => {
				if (!settings.onScreenClock) settings.onScreenClock = {};
				settings.onScreenClock.outline = val;
				saveSettings(settings);

				if (outlineModeRow) {
					outlineModeRow.style.display = val ? "flex" : "none";
				}
				if (outlineColorRow) {
					const isCustom = !!settings.onScreenClock.outlineColor;
					outlineColorRow.style.display =
						val && isCustom ? "flex" : "none";
				}

				document.dispatchEvent(
					new CustomEvent("settings:clock", { detail: settings }),
				);
				updatePreview();
			},
		);

		const outlineModes = [
			{ value: "default", label: "Default (Invert Theme)" },
			{ value: "custom", label: "Custom Color" },
		];

		outlineModeRow = addSelect(
			container,
			"Outline Color Mode",
			"Choose default theme inversion or a custom color.",
			outlineModes,
			settings.onScreenClock.outlineColor ? "custom" : "default",
			(val) => {
				if (val === "default") {
					settings.onScreenClock.outlineColor = null; // Reset to null for default
				} else {
					if (!settings.onScreenClock.outlineColor) {
						settings.onScreenClock.outlineColor = "#000000"; // Default custom
					}
				}
				saveSettings(settings);

				if (outlineColorRow) {
					outlineColorRow.style.display =
						val === "custom" ? "flex" : "none";
				}

				document.dispatchEvent(
					new CustomEvent("settings:clock", { detail: settings }),
				);
				updatePreview();
			},
		);
		outlineModeRow.style.display =
			settings.onScreenClock.outline ? "flex" : "none";

		outlineColorRow = addColorPicker(
			container,
			"Outline Color",
			"Pick a custom color for the text outline.",
			settings.onScreenClock.outlineColor || "#000000",
			(val) => {
				if (!settings.onScreenClock) settings.onScreenClock = {};
				settings.onScreenClock.outlineColor = val;
				saveSettings(settings);
				document.dispatchEvent(
					new CustomEvent("settings:clock", { detail: settings }),
				);
				updatePreview();
			},
		);
		outlineColorRow.style.display =
			(
				settings.onScreenClock.outline &&
				settings.onScreenClock.outlineColor
			) ?
				"flex"
			:	"none";

		// Greeting Section
		const greetingGroup = document.createElement("div");
		greetingGroup.className = "settings-group";
		const gHeader = document.createElement("div");
		gHeader.className = "settings-group-header";
		const gTitle = document.createElement("div");
		gTitle.className = "settings-group-title";
		gTitle.textContent = "Greeting";
		gHeader.appendChild(gTitle);
		greetingGroup.appendChild(gHeader);
		container.appendChild(greetingGroup);

		if (!settings.greeting)
			settings.greeting = {
				enabled: false,
				type: "default",
				customName: "",
				customText: "",
			};

		addToggle(
			greetingGroup,
			"Show Greeting",
			"Display a greeting message on the main screen.",
			settings.greeting.enabled,
			(val) => {
				settings.greeting.enabled = val;
				saveSettings(settings);
				document.dispatchEvent(
					new CustomEvent("settings:greeting", {
						detail: settings,
					}),
				);
				// Re-render section to show/hide inputs
				// Ideally we'd just toggle visibility, but re-render is easier given the structure
				// container.innerHTML = ''; // Dangerous if we only want partial update
				// Let's just manipulate visibility here or rely on user reopening/refresh?
				// Better: Toggle visibility of inputs here.
				const inputs =
					greetingGroup.querySelectorAll(".greeting-inputs");
				inputs.forEach(
					(el) => (el.style.display = val ? "block" : "none"),
				);
			},
		);

		const inputsContainer = document.createElement("div");
		inputsContainer.className = "greeting-inputs";
		inputsContainer.style.display =
			settings.greeting.enabled ? "block" : "none";
		greetingGroup.appendChild(inputsContainer);

		const greetingTypes = [
			{ value: "default", label: "Time-based (Good Morning [Name])" },
			{ value: "custom", label: "Custom Text" },
		];

		addSelect(
			inputsContainer,
			"Type",
			"Choose the greeting style.",
			greetingTypes,
			settings.greeting.type || "default",
			(val) => {
				settings.greeting.type = val;
				saveSettings(settings);
				document.dispatchEvent(
					new CustomEvent("settings:greeting", {
						detail: settings,
					}),
				);
				// Update input visibility
				updateGreetingInputs();
			},
		);

		const nameInputRow = document.createElement("div");
		const textInputRow = document.createElement("div");
		inputsContainer.appendChild(nameInputRow);
		inputsContainer.appendChild(textInputRow);

		const updateGreetingInputs = () => {
			nameInputRow.innerHTML = "";
			textInputRow.innerHTML = "";

			if (settings.greeting.type === "default") {
				addInput(
					nameInputRow,
					"Your Name (Optional)",
					"Personalize the greeting.",
					settings.greeting.customName || "",
					(val) => {
						settings.greeting.customName = val;
						saveSettings(settings);
						document.dispatchEvent(
							new CustomEvent("settings:greeting", {
								detail: settings,
							}),
						);
					},
					"e.g. John",
				);
			} else {
				addInput(
					textInputRow,
					"Custom Text",
					"Enter your custom message (1-2 lines).",
					settings.greeting.customText || "",
					(val) => {
						settings.greeting.customText = val;
						saveSettings(settings);
						document.dispatchEvent(
							new CustomEvent("settings:greeting", {
								detail: settings,
							}),
						);
					},
					"Enter text...",
				);
			}
		};
		updateGreetingInputs();

		// Daily Quote (local pack, no network)
		const quoteGroup = document.createElement("div");
		quoteGroup.className = "settings-group";
		const qHeader = document.createElement("div");
		qHeader.className = "settings-group-header";
		const qTitle = document.createElement("div");
		qTitle.className = "settings-group-title";
		qTitle.textContent = "Daily Quote";
		qHeader.appendChild(qTitle);
		quoteGroup.appendChild(qHeader);
		container.appendChild(quoteGroup);

		if (!settings.quotes) settings.quotes = { enabled: true };

		addToggle(
			quoteGroup,
			"Show Daily Quote",
			"A short local quote under the clock / search bar. Changes once a day.",
			settings.quotes.enabled ?? true,
			(val) => {
				settings.quotes.enabled = val;
				saveSettings(settings);
				document.dispatchEvent(
					new CustomEvent("settings:clock", { detail: settings }),
				);
				quotePreview.style.display = val ? "block" : "none";
			},
		);

		const quotePreview = document.createElement("div");
		quotePreview.className = "quote-preview";
		quotePreview.style.display =
			settings.quotes.enabled ? "block" : "none";
		quotePreview.style.padding = "var(--dis-2)";
		quotePreview.style.background = "var(--color-off)";
		quotePreview.style.borderRadius = "var(--radius-xs)";
		quotePreview.style.marginTop = "var(--dis-1)";

		const todayQuote = getDailyQuote();
		const qText = document.createElement("div");
		qText.style.fontStyle = "italic";
		qText.textContent = `“${todayQuote.text}”`;
		const qAuthor = document.createElement("div");
		qAuthor.style.marginTop = "var(--dis-1)";
		qAuthor.style.color = "var(--text-off)";
		qAuthor.textContent = todayQuote.author
			? `— ${todayQuote.author}`
			: "";
		quotePreview.appendChild(qText);
		quotePreview.appendChild(qAuthor);
		quoteGroup.appendChild(quotePreview);

		// Discoverable shuffle control (the on-screen quote also has one).
		const shuffleRow = document.createElement("div");
		shuffleRow.className = "setting-row";
		const shuffleInfo = document.createElement("div");
		shuffleInfo.className = "setting-info";
		shuffleInfo.innerHTML =
			'<div class="setting-label">Shuffle</div><div class="setting-desc">Get a different quote for today. The choice is remembered until midnight.</div>';
		const shuffleControl = document.createElement("div");
		shuffleControl.className = "setting-control";
		const shuffleBtn = document.createElement("button");
		shuffleBtn.type = "button";
		shuffleBtn.className = "btn btn-text";
		shuffleBtn.textContent = "Shuffle";
		shuffleBtn.addEventListener("click", async () => {
			const next = await shuffleQuote();
			qText.textContent = `“${next.text}”`;
			qAuthor.textContent = next.author ? `— ${next.author}` : "";
			document.dispatchEvent(
				new CustomEvent("settings:clock", { detail: settings }),
			);
		});
		shuffleControl.appendChild(shuffleBtn);
		shuffleRow.appendChild(shuffleInfo);
		shuffleRow.appendChild(shuffleControl);
		quoteGroup.appendChild(shuffleRow);
	}

	if (tabId === "wallpaper") {
		// Type
		const types = [
			{ value: "mono", label: "Mono" },
			{ value: "duotone", label: "Duotone (Dark Mode)" },
			{ value: "matrix", label: "Matrix Code" },
			{ value: "img", label: "Image" },
			{ value: "video", label: "Video" },
		];
		addSelect(
			container,
			"Type",
			"Choose static images, video wallpapers, or a solid color.",
			types,
			settings.wallpaper.type,
			(val) => {
				const oldType = settings.wallpaper.type;
				const newType = val;

				if (oldType !== newType) {
					// 1. Save state to old bucket
					if (oldType === "img" || oldType === "video") {
						const bucketName = oldType + "Settings";
						settings.wallpaper[bucketName] = {
							collection: settings.wallpaper.collection,
							mode: settings.wallpaper.mode,
							specific: settings.wallpaper.specific,
						};
					}

					// 2. Update Type
					settings.wallpaper.type = newType;

					// 3. Load state from new bucket
					if (newType === "img" || newType === "video") {
						const bucketName = newType + "Settings";
						// Initialize if missing
						if (!settings.wallpaper[bucketName]) {
							settings.wallpaper[bucketName] = {
								collection: "predefined",
								mode: "random",
								specific: null,
							};
						}
						const bucket = settings.wallpaper[bucketName];
						settings.wallpaper.collection = bucket.collection;
						settings.wallpaper.mode = bucket.mode;
						settings.wallpaper.specific = bucket.specific;
					}

					// Force Dark Mode for Duotone or Matrix
					if (newType === "duotone" || newType === "matrix") {
						applyTheme("dark");
					} else {
						applyTheme(settings.theme || "system");
					}

					// Real-time Update of General Tab Theme Selector
					const generalTab = document.getElementById(
						"settings-section-general",
					);
					if (generalTab) {
						generalTab.innerHTML = "";
						renderSectionContent(generalTab, "general", settings);
					}
				}

				saveSettings(settings);

				// Downloads are per type and may have finished since this page
				// cached its media keys (e.g. the default video after install).
				clearMediaKeysCache();

				// Apply Mono or Refresh
				refreshWallpaper(settings);

				// Re-render Dynamic Content
				updateWallpaperDynamicContent(dynamicContent, settings);
			},
		);

		// Container for Filters + Grid (Dynamic)
		const dynamicContent = document.createElement("div");
		dynamicContent.className = "wallpaper-dynamic-content";
		container.appendChild(dynamicContent);

		// Initial Render
		updateWallpaperDynamicContent(dynamicContent, settings);
	}

	if (tabId === "search") {
		addToggle(
			container,
			"Enable Search",
			"Show the search bar on the new tab.",
			settings.searchbar.enabled,
			(val) => {
				settings.searchbar.enabled = val;
				saveSettings(settings);
				if (val) renderSearchbar(settings.searchbar);
				else removeSearchbar();
			},
		);

		const engines = [
			{ value: "default", label: "Browser Default" },
			{ value: "google", label: "Google" },
			{ value: "bing", label: "Bing" },
			{ value: "duckduckgo", label: "DuckDuckGo" },
			{ value: "youtube", label: "YouTube" },
			{ value: "reddit", label: "Reddit" },
			{ value: "github", label: "GitHub" },
			{ value: "quora", label: "Quora" },
			{ value: "stackoverflow", label: "Stack Overflow" },
			{ value: "spotify", label: "Spotify" },
		];
		addSelect(
			container,
			"Default Engine",
			"Primary search engine.",
			engines,
			settings.searchbar.engine,
			(val) => {
				settings.searchbar.engine = val;
				saveSettings(settings);
				if (settings.searchbar.enabled)
					renderSearchbar(settings.searchbar);
			},
		);

		addToggle(
			container,
			"Voice Search",
			"Show microphone icon.",
			settings.searchbar.voice_search,
			(val) => {
				settings.searchbar.voice_search = val;
				saveSettings(settings);
				if (settings.searchbar.enabled)
					renderSearchbar(settings.searchbar);
			},
		);

		// Vertical Align
		const vAligns = [
			{
				value: "top",
				label: "Top",
				icon: "assets/svgs-fontawesome/solid/arrow-up.svg",
			},
			{
				value: "center",
				label: "Center",
				icon: "assets/svgs-fontawesome/solid/grip-lines.svg",
			},
			{
				value: "bottom",
				label: "Bottom",
				icon: "assets/svgs-fontawesome/solid/arrow-down.svg",
			},
		];
		addIconSelect(
			container,
			"Vertical Position",
			"Align search bar vertically.",
			vAligns,
			settings.searchbar.vertical_align || "center",
			(val) => {
				settings.searchbar.vertical_align = val;
				saveSettings(settings); // Async (no await needed for UI update)

				const el = document.getElementById("searchbar");
				if (el) {
					Object.assign(
						el.style,
						computePositionStyles(
							settings.searchbar.vertical_align,
							settings.searchbar.horizontal_align,
						),
					);
				} else if (settings.searchbar.enabled) {
					renderSearchbar(settings.searchbar);
				}
			},
		);

		// Horizontal Align
		const hAligns = [
			{
				value: "left",
				label: "Left",
				icon: "assets/svgs-fontawesome/solid/align-left.svg",
			},
			{
				value: "center",
				label: "Center",
				icon: "assets/svgs-fontawesome/solid/align-center.svg",
			},
			{
				value: "right",
				label: "Right",
				icon: "assets/svgs-fontawesome/solid/align-right.svg",
			},
		];
		addIconSelect(
			container,
			"Horizontal Position",
			"Align search bar horizontally.",
			hAligns,
			settings.searchbar.horizontal_align || "center",
			(val) => {
				settings.searchbar.horizontal_align = val;
				saveSettings(settings);

				const el = document.getElementById("searchbar");
				if (el) {
					Object.assign(
						el.style,
						computePositionStyles(
							settings.searchbar.vertical_align,
							settings.searchbar.horizontal_align,
						),
					);
				} else if (settings.searchbar.enabled) {
					renderSearchbar(settings.searchbar);
				}
			},
		);

		const targets = [
			{ value: "self", label: "Same Tab" },
			{ value: "blank", label: "New Tab" },
		];
		addSelect(
			container,
			"Open Results In",
			"Where search results open.",
			targets,
			settings.searchbar.target,
			async (val) => {
				settings.searchbar.target = val;
				await saveSettings(settings);
				// Re-init searchbar AND actionbar (for shortcuts)
				if (settings.searchbar.enabled)
					renderSearchbar(settings.searchbar);
				initActionBar(settings.actionbar, settings);
			},
		);
	}

	if (tabId === "actionbar") {
		// Display Style
		const styles = [
			{ value: "centralised", label: "Centralised (Default)" },
			{ value: "spread", label: "Spread (Media | Tools | Meta)" },
		];
		addSelect(
			container,
			"Display Style",
			"Choose the layout of the action bar.",
			styles,
			settings.actionbar?.display_style || "centralised",
			async (val) => {
				if (!settings.actionbar) settings.actionbar = {};
				settings.actionbar.display_style = val;
				await saveSettings(settings);
				initActionBar(settings.actionbar, settings);
			},
		);

		// Clock Settings
		addToggle(
			container,
			"Show Clock",
			"Display a clock in the action bar.",
			settings.actionbar?.clock?.enabled ?? true,
			async (val) => {
				if (!settings.actionbar) settings.actionbar = {};
				if (!settings.actionbar.clock) settings.actionbar.clock = {};
				settings.actionbar.clock.enabled = val;
				await saveSettings(settings);
				initActionBar(settings.actionbar, settings);
				document.dispatchEvent(
					new CustomEvent("settings:clock", { detail: settings }),
				);
			},
		);

		const timeFormats = [
			{ value: "12", label: "12-hour (3:45 PM)" },
			{ value: "24", label: "24-hour (15:45)" },
		];
		addSelect(
			container,
			"Time Format",
			"Choose between 12-hour and 24-hour time display.",
			timeFormats,
			settings.actionbar?.clock?.format || "12",
			async (val) => {
				if (!settings.actionbar) settings.actionbar = {};
				if (!settings.actionbar.clock) settings.actionbar.clock = {};
				settings.actionbar.clock.format = val;
				await saveSettings(settings);
				initActionBar(settings.actionbar, settings);
				document.dispatchEvent(
					new CustomEvent("settings:clock", { detail: settings }),
				);
			},
		);

		addToggle(
			container,
			"Show Date",
			"Display the current date in the action bar.",
			settings.actionbar?.date?.enabled ?? false,
			async (val) => {
				if (!settings.actionbar) settings.actionbar = {};
				if (!settings.actionbar.date) settings.actionbar.date = {};
				settings.actionbar.date.enabled = val;
				await saveSettings(settings);
				initActionBar(settings.actionbar, settings);
				document.dispatchEvent(
					new CustomEvent("settings:clock", { detail: settings }),
				);
			},
		);

		addToggle(
			container,
			"Show Upcoming Alarm",
			"Display your next scheduled alarm in the action bar.",
			settings.actionbar?.alarm?.enabled ?? false,
			async (val) => {
				if (!settings.actionbar) settings.actionbar = {};
				if (!settings.actionbar.alarm) settings.actionbar.alarm = {};
				settings.actionbar.alarm.enabled = val;
				await saveSettings(settings);
				initActionBar(settings.actionbar, settings);
			},
		);

		// Weather Settings
		const weatherGroup = document.createElement("div");
		weatherGroup.className = "settings-group";
		const weatherHeader = document.createElement("div");
		weatherHeader.className = "settings-group-header";
		weatherHeader.style.display = "flex";
		weatherHeader.style.justifyContent = "space-between";
		weatherHeader.style.alignItems = "center";

		const wTitle = document.createElement("div");
		wTitle.className = "settings-group-title";
		wTitle.textContent = "Weather";
		weatherHeader.appendChild(wTitle);
		weatherGroup.appendChild(weatherHeader);
		container.appendChild(weatherGroup);

		addToggle(
			weatherGroup,
			"Enable Weather",
			"Show current conditions in the action bar. Powered by Open-Meteo — no API key needed.",
			settings.actionbar?.weather?.enabled ?? false,
			async (val) => {
				if (!settings.actionbar) settings.actionbar = {};
				if (!settings.actionbar.weather)
					settings.actionbar.weather = {};
				settings.actionbar.weather.enabled = val;
				await saveSettings(settings);
				initActionBar(settings.actionbar, settings);
			},
		);

		const cityInput = addInput(
			weatherGroup,
			"City (Optional)",
			"Leave blank to auto-detect from your timezone. Type a city to override.",
			settings.actionbar?.weather?.city || "",
			async (val) => {
				if (!settings.actionbar) settings.actionbar = {};
				if (!settings.actionbar.weather)
					settings.actionbar.weather = {};
				settings.actionbar.weather.city = val;
				// The old coordinates belong to the previous city.
				await clearWeatherPlace();
				await saveSettings(settings);
				initActionBar(settings.actionbar, settings);
			},
			"e.g. London,UK",
		);

		// Location is requested only from this explicit button, never during
		// normal new-tab startup. The resulting coordinates are cached.
		const geoRow = document.createElement("div");
		geoRow.className = "setting-row";
		geoRow.style.alignItems = "flex-start";
		geoRow.style.flexWrap = "wrap";

		const geoInfo = document.createElement("div");
		geoInfo.className = "setting-info";
		geoInfo.style.flex = "1 1 260px";
		const geoLabel = document.createElement("div");
		geoLabel.className = "setting-label";
		geoLabel.textContent = "Location";
		const geoDesc = document.createElement("div");
		geoDesc.className = "setting-desc";
		geoDesc.textContent =
			"Automatic by default (from your timezone). Click for a precise location — coordinates stay on this device.";
		geoInfo.appendChild(geoLabel);
		geoInfo.appendChild(geoDesc);

		const geoControl = document.createElement("div");
		geoControl.className = "setting-control";
		geoControl.style.display = "flex";
		geoControl.style.flexDirection = "column";
		geoControl.style.alignItems = "flex-start";
		geoControl.style.gap = "var(--dis-1)";
		geoControl.style.flex = "0 0 auto";

		const geoButtons = document.createElement("div");
		geoButtons.style.display = "flex";
		geoButtons.style.alignItems = "center";
		geoButtons.style.gap = "var(--dis-1)";
		geoButtons.style.flexWrap = "wrap";

		const geoBtn = document.createElement("button");
		geoBtn.type = "button";
		geoBtn.className = "btn btn-text";
		geoBtn.textContent = "Use my location";

		const autoBtn = document.createElement("button");
		autoBtn.type = "button";
		autoBtn.className = "btn btn-text";
		autoBtn.textContent = "Automatic";
		autoBtn.title = "Detect the city from your timezone";

		const geoStatus = document.createElement("span");
		geoStatus.className = "setting-desc";
		geoStatus.style.maxWidth = "260px";
		geoStatus.style.whiteSpace = "normal";

		const refreshGeoStatus = async () => {
			const place = await getSavedPlace();
			if (place && place.source === "geolocation") {
				geoStatus.textContent = "Using your current location";
			} else if (place && place.name) {
				geoStatus.textContent = `Using ${place.name}${
					place.country ? `, ${place.country}` : ""
				}`;
			} else {
				geoStatus.textContent = "Automatic — from your timezone";
			}
		};
		refreshGeoStatus();

		geoBtn.addEventListener("click", async () => {
			geoBtn.disabled = true;
			geoBtn.textContent = "Locating...";
			geoStatus.textContent = "";

			const place = await requestGeolocation();
			geoBtn.disabled = false;
			geoBtn.textContent = "Use my location";

			if (!place) {
				geoStatus.textContent = "";
				showAlert(
					"Could not determine your location. You can still type a city above.",
					"Location unavailable",
				);
				return;
			}

			if (!settings.actionbar) settings.actionbar = {};
			if (!settings.actionbar.weather)
				settings.actionbar.weather = {};
			settings.actionbar.weather.city = "";
			cityInput.value = "";
			await saveSettings(settings);
			geoStatus.textContent = "Using your current location";
			initActionBar(settings.actionbar, settings);
		});

		autoBtn.addEventListener("click", async () => {
			await clearWeatherPlace();
			if (!settings.actionbar) settings.actionbar = {};
			if (!settings.actionbar.weather)
				settings.actionbar.weather = {};
			settings.actionbar.weather.city = "";
			cityInput.value = "";
			await saveSettings(settings);
			geoStatus.textContent = "Automatic — from your timezone";
			initActionBar(settings.actionbar, settings);
		});

		geoButtons.appendChild(geoBtn);
		geoButtons.appendChild(autoBtn);
		geoControl.appendChild(geoButtons);
		geoControl.appendChild(geoStatus);
		geoRow.appendChild(geoInfo);
		geoRow.appendChild(geoControl);
		weatherGroup.appendChild(geoRow);

		const unitOpts = [
			{ value: "metric", label: "Metric (°C, m/s)" },
			{ value: "imperial", label: "Imperial (°F, mph)" },
		];
		addSelect(
			weatherGroup,
			"Units",
			"Measurement units.",
			unitOpts,
			settings.actionbar?.weather?.units || "metric",
			async (val) => {
				if (!settings.actionbar) settings.actionbar = {};
				if (!settings.actionbar.weather)
					settings.actionbar.weather = {};
				settings.actionbar.weather.units = val;
				await saveSettings(settings);
				initActionBar(settings.actionbar, settings);
			},
		);

		addToggle(
			weatherGroup,
			"Show Humidity",
			"Display humidity percentage.",
			settings.actionbar?.weather?.showHumidity ?? false,
			async (val) => {
				if (!settings.actionbar) settings.actionbar = {};
				if (!settings.actionbar.weather)
					settings.actionbar.weather = {};
				settings.actionbar.weather.showHumidity = val;
				await saveSettings(settings);
				initActionBar(settings.actionbar, settings);
			},
		);

		addToggle(
			weatherGroup,
			"Show Wind",
			"Display wind speed.",
			settings.actionbar?.weather?.showWind ?? false,
			async (val) => {
				if (!settings.actionbar) settings.actionbar = {};
				if (!settings.actionbar.weather)
					settings.actionbar.weather = {};
				settings.actionbar.weather.showWind = val;
				await saveSettings(settings);
				initActionBar(settings.actionbar, settings);
			},
		);

		addToggle(
			weatherGroup,
			"Show Feels Like",
			'Display "feels like" temperature.',
			settings.actionbar?.weather?.showFeelsLike ?? false,
			async (val) => {
				if (!settings.actionbar) settings.actionbar = {};
				if (!settings.actionbar.weather)
					settings.actionbar.weather = {};
				settings.actionbar.weather.showFeelsLike = val;
				await saveSettings(settings);
				initActionBar(settings.actionbar, settings);
			},
		);

		// FamCam Settings
		const famcamGroup = document.createElement("div");
		famcamGroup.className = "settings-group";
		const fcHeader = document.createElement("div");
		fcHeader.className = "settings-group-header";
		fcHeader.innerHTML =
			'<div class="settings-group-title">FamCam (Camera & Flash)</div>';
		famcamGroup.appendChild(fcHeader);
		container.appendChild(famcamGroup);

		if (!settings.actionbar.famcam) {
			// Fallback init if missing
			settings.actionbar.famcam = {
				enabled: true,
				snapAction: "camera",
				flash: {
					tone: "warm",
					customColor: "#ffffff",
					type: "ring-circle",
					borderWidth: 2,
					brightness: 100,
				},
			};
		}
		const fcSettings = settings.actionbar.famcam;

		// Master Toggle
		addToggle(
			famcamGroup,
			"Enable FamCam",
			"Show Camera/Screenshot and Flash tools in Action Bar.",
			fcSettings.enabled,
			async (val) => {
				fcSettings.enabled = val;
				await saveSettings(settings);
				initActionBar(settings.actionbar, settings);
			},
		);

		// Snap Action (Camera vs Screenshot)
		const snapActions = [
			{ value: "camera", label: "Camera (Selfie)" },
			{ value: "screenshot", label: "Page Snapshot" },
		];
		addSelect(
			famcamGroup,
			"Snap Button Action",
			"Choose what the camera button does.",
			snapActions,
			fcSettings.snapAction,
			async (val) => {
				fcSettings.snapAction = val;
				await saveSettings(settings);
				if (window.updateFamCamConfig)
					window.updateFamCamConfig(settings.actionbar.famcam);
			},
		);

		// Flash Settings Sub-group
		const flashTitle = document.createElement("div");
		flashTitle.className = "setting-label";
		flashTitle.style.marginTop = "1rem";
		flashTitle.style.marginBottom = "0.5rem";
		flashTitle.textContent = "Flash Configuration";
		famcamGroup.appendChild(flashTitle);

		// Flash Tone - with dynamic color picker visibility
		const tones = [
			{ value: "warm", label: "Warm (Yellow)" },
			{ value: "cool", label: "Cool (Blue)" },
			{ value: "neutral", label: "Neutral (White)" },
			{ value: "custom", label: "Custom Color" },
		];

		// Create a placeholder for the color picker that we'll show/hide
		let colorPickerRow = null;

		addSelect(
			famcamGroup,
			"Flash Tone",
			"Color temperature of the flash.",
			tones,
			fcSettings.flash.tone,
			async (val) => {
				fcSettings.flash.tone = val;
				await saveSettings(settings);
				// Show/hide color picker based on selection
				if (colorPickerRow) {
					colorPickerRow.style.display =
						val === "custom" ? "flex" : "none";
				}
				// Update live if active
				if (window.updateFamCamConfig)
					window.updateFamCamConfig(settings.actionbar.famcam);
			},
		);

		// Add color picker (always in DOM, visibility controlled by tone)
		colorPickerRow = addColorPicker(
			famcamGroup,
			"Custom Color",
			"Pick a color for the flash.",
			fcSettings.flash.customColor || "#ffffff",
			async (val) => {
				fcSettings.flash.customColor = val;
				await saveSettings(settings);
				if (window.updateFamCamConfig)
					window.updateFamCamConfig(settings.actionbar.famcam);
			},
		);
		// Set initial visibility
		colorPickerRow.style.display =
			fcSettings.flash.tone === "custom" ? "flex" : "none";

		// Flash Type
		const flashTypes = [
			{ value: "fullscreen", label: "Full Screen" },
			{ value: "ring-wide", label: "Wide Ring (Border)" },
			{ value: "ring-circle", label: "Circle Ring (Selfie)" },
		];
		addSelect(
			famcamGroup,
			"Flash Shape",
			"Shape of the light source.",
			flashTypes,
			fcSettings.flash.type,
			async (val) => {
				fcSettings.flash.type = val;
				await saveSettings(settings);
				if (window.updateFamCamConfig)
					window.updateFamCamConfig(settings.actionbar.famcam);
			},
		);

		// Border Width
		addRange(
			famcamGroup,
			"Ring Width",
			"",
			1,
			8,
			fcSettings.flash.borderWidth,
			2,
			async (val) => {
				fcSettings.flash.borderWidth = val;
				await saveSettings(settings);
				if (window.updateFamCamConfig)
					window.updateFamCamConfig(settings.actionbar.famcam);
			},
		);

		// Flash Intensity
		addRange(
			famcamGroup,
			"Flash Intensity",
			"%",
			5,
			100,
			Math.max(5, fcSettings.flash.brightness ?? 100),
			100,
			async (val) => {
				fcSettings.flash.brightness = val;
				await saveSettings(settings);
				if (window.updateFamCamConfig)
					window.updateFamCamConfig(settings.actionbar.famcam);
			},
		);

		// Shortcuts Settings
		const shortcutsGroup = document.createElement("div");
		shortcutsGroup.className = "settings-group";
		const shortcutsHeader = document.createElement("div");
		shortcutsHeader.className = "settings-group-header";
		shortcutsHeader.style.display = "flex";
		shortcutsHeader.style.justifyContent = "space-between";
		shortcutsHeader.style.alignItems = "center";

		const sTitle = document.createElement("div");
		sTitle.className = "settings-group-title";
		sTitle.textContent = "Shortcuts";
		shortcutsHeader.appendChild(sTitle);
		shortcutsGroup.appendChild(shortcutsHeader);
		container.appendChild(shortcutsGroup);

		addToggle(
			shortcutsGroup,
			"Show Shortcuts",
			"Show the quick access shortcuts bar.",
			settings.actionbar?.shortcuts?.enabled ?? true,
			async (val) => {
				if (!settings.actionbar) settings.actionbar = {};
				if (!settings.actionbar.shortcuts)
					settings.actionbar.shortcuts = {};
				settings.actionbar.shortcuts.enabled = val;
				await saveSettings(settings);
				initActionBar(settings.actionbar, settings);
			},
		);

		// Shortcuts List Management
		renderShortcutsList(shortcutsGroup, settings);
	}

	if (tabId === "zen") {
		renderZenSettings(container, settings);
	}

	if (tabId === "about") {
		const about = document.createElement("div");
		about.className = "settings-about";

		// Header Group
		const headerGroup = document.createElement("div");
		headerGroup.className = "settings-group";
		headerGroup.style.textAlign = "center";
		headerGroup.style.padding = "var(--dis-4)";
		headerGroup.style.display = "flex";
		headerGroup.style.flexDirection = "column";
		headerGroup.style.alignItems = "center";
		headerGroup.style.gap = "var(--dis-1)";

		const appVersion = (() => {
			try {
				return chrome.runtime.getManifest().version;
			} catch (e) {
				return "";
			}
		})();

		headerGroup.innerHTML = `
            <img src="icons/icon128.png" alt="Themes+ Logo" style="width: var(--dis-8); height: var(--dis-8);">
            <h2 style="font-size: var(--dis-3); font-weight: 700; color: var(--text-base);">Themes+</h2>
            <div class="setting-desc" style="font-weight: 500;">v${appVersion}</div>
            <p class="setting-desc" style="max-width: 400px; margin-top: var(--dis-1);">
                A beautiful, customizable dashboard for your new tab. <br>
                Built for performance, privacy, and productivity.
            </p>
        `;
		about.appendChild(headerGroup);

		// Live storage meter (usage vs browser quota), refreshed every 2s.
		const storageGroup = document.createElement("div");
		storageGroup.className = "settings-group";
		storageGroup.style.padding = "var(--dis-2)";

		const storageTitle = document.createElement("div");
		storageTitle.className = "settings-group-title";
		storageTitle.textContent = "Storage";
		storageGroup.appendChild(storageTitle);

		const storageText = document.createElement("div");
		storageText.className = "setting-desc";
		storageText.style.margin = "var(--dis-1) 0";
		storageText.textContent = "Measuring local storage…";
		storageGroup.appendChild(storageText);

		const barOuter = document.createElement("div");
		barOuter.style.height = "0.5rem";
		barOuter.style.borderRadius = "999px";
		barOuter.style.background = "var(--color-off)";
		barOuter.style.overflow = "hidden";
		const barFill = document.createElement("div");
		barFill.style.height = "100%";
		barFill.style.width = "0%";
		barFill.style.background = "var(--color-accent)";
		barFill.style.transition = "width var(--transition-fast)";
		barOuter.appendChild(barFill);
		storageGroup.appendChild(barOuter);
		about.appendChild(storageGroup);

		const formatBytes = (bytes) => {
			if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
			const units = ["B", "KB", "MB", "GB", "TB"];
			const i = Math.min(
				units.length - 1,
				Math.floor(Math.log(bytes) / Math.log(1024)),
			);
			return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${
				units[i]
			}`;
		};

		if (_storageMeterTimer) {
			clearInterval(_storageMeterTimer);
			_storageMeterTimer = null;
		}
		const updateStorageMeter = async () => {
			if (!navigator.storage?.estimate) {
				storageText.textContent = "Storage usage is unavailable.";
				return;
			}
			try {
				const { usage = 0, quota = 0 } = await navigator.storage.estimate();
				const pct = quota > 0 ? Math.min(100, (usage / quota) * 100) : 0;
				barFill.style.width = `${pct}%`;
				storageText.textContent = quota
					? `${formatBytes(usage)} of ${formatBytes(quota)} used`
					: `${formatBytes(usage)} used`;
			} catch (e) {
				storageText.textContent = "Storage usage is unavailable.";
			}
		};
		updateStorageMeter();
		_storageMeterTimer = setInterval(updateStorageMeter, 2000);
		document.addEventListener(
			"settings:closed",
			() => {
				if (_storageMeterTimer) {
					clearInterval(_storageMeterTimer);
					_storageMeterTimer = null;
				}
			},
			{ once: true },
		);

		// Instructions Group
		const instructionsGroup = document.createElement("div");
		instructionsGroup.className = "settings-group";

		// Ribbon Warning
		const ribbonRow = document.createElement("div");
		ribbonRow.className = "setting-row";
		ribbonRow.style.alignItems = "flex-start";
		ribbonRow.innerHTML = `
            <div class="setting-info">
                <div class="setting-label" style="color: var(--color-warning); display: flex; align-items: center; gap: var(--dis-1);">
                    <span class="icon-warning"></span> Remove "New Extension" Warning
                </div>
                <div class="setting-desc">
                    Chrome might show a warning dialog or ribbon asking if you want to keep the new tab changes.
                    <ul style="padding-left: 1.2rem; margin-top: 0.5rem; list-style-type: disc;">
                        <li>If you see a dialog, click <strong>"Keep changes"</strong>.</li>
                        <li>If you find a ribbon at the bottom, click <strong>"Keep"</strong>.</li>
                    </ul>
                </div>
            </div>
        `;
		// Inject icon
		renderInlineIcon(
			ribbonRow.querySelector(".icon-warning"),
			"assets/svgs-fontawesome/solid/triangle-exclamation.svg",
		);
		instructionsGroup.appendChild(ribbonRow);

		// Footer Tip
		const footerRow = document.createElement("div");
		footerRow.className = "setting-row";
		footerRow.style.alignItems = "flex-start";
		footerRow.innerHTML = `
            <div class="setting-info">
                <div class="setting-label" style="display: flex; align-items: center; gap: var(--dis-1);">
                    <span class="icon-tip"></span> Hide Default Chrome Footer
                </div>
                <div class="setting-desc">
                    To remove the default pencil icon or footer shown by Chrome:
                    <ul style="padding-left: 1.2rem; margin-top: 0.5rem; list-style-type: disc;">
                        <li>Click the standard <strong>Customize Chrome</strong> button (bottom right of the screen).</li>
                        <li>Disable the <strong>"Show footer on the newtab page"</strong> toggle.</li>
                    </ul>
                </div>
            </div>
        `;
		renderInlineIcon(
			footerRow.querySelector(".icon-tip"),
			"assets/svgs-fontawesome/solid/lightbulb.svg",
		);
		instructionsGroup.appendChild(footerRow);

		about.appendChild(instructionsGroup);

		// Community Links Group
		const linksGroup = document.createElement("div");
		linksGroup.className = "settings-group";
		linksGroup.style.padding = "var(--dis-2)";

		const linksGrid = document.createElement("div");
		linksGrid.className = "about-links-grid"; // Kept for grid layout, but will simplify CSS

		const links = [
			{
				label: "User Guide",
				url: "userguide.html",
				icon: "assets/svgs-fontawesome/solid/book.svg",
				local: true,
			},
			{
				label: "Rate Us",
				url: "https://chromewebstore.google.com/detail/themes+/afaenafmlblabamefeeedcmonilklgbk/reviews",
				icon: "assets/svgs-fontawesome/brands/chrome.svg",
			},
			{
				label: "Discord Server",
				url: "https://discord.gg/jsjBNzFVqQ",
				icon: "assets/svgs-fontawesome/brands/discord.svg",
			},
			{
				label: "Website",
				url: "https://buildwithkt.dev",
				icon: "assets/svgs-fontawesome/solid/globe.svg",
			},
			{
				label: "GitHub",
				url: "https://github.com/TMtechnomania",
				icon: "assets/svgs-fontawesome/brands/github.svg",
			},
		];

		links.forEach((link) => {
			const btn = document.createElement("a");
			btn.className = "btn btn-icon-text about-action-btn"; // Keeping about-action-btn for minimal width override if needed
			btn.href = link.url;
			btn.target = "_blank";
			btn.style.width = "100%"; // Ensure it fills grid cell
			btn.style.justifyContent = "flex-start"; // Align left for better list look in grid

			// Icon Wrapper
			const iconSpan = document.createElement("span");
			if (link.icon) {
				renderInlineIcon(iconSpan, link.icon);
			}

			// Text Wrapper
			const textSpan = document.createElement("span");
			textSpan.className = "text"; // Critical for base.css .btn styling
			textSpan.textContent = link.label;

			btn.appendChild(iconSpan);
			btn.appendChild(textSpan);

			linksGrid.appendChild(btn);
		});

		linksGroup.appendChild(linksGrid);
		about.appendChild(linksGroup);

		// Legal / Disclaimers
		const legal = document.createElement("p");
		legal.className = "setting-desc";
		legal.style.textAlign = "center";
		legal.style.marginTop = "var(--dis-4)";
		legal.style.marginBottom = "var(--dis-2)";
		legal.style.opacity = "0.7";
		legal.innerHTML = `
            Media assets (images, videos, audio) used in this extension belong to their respective owners.<br>
            If you are a copyright holder and wish to request removal, please contact us.<br>
            Email: <a href="mailto:tmtechnomaniayt@gmail.com" style="color: var(--text-base);">tmtechnomaniayt@gmail.com</a><br><br>
            &copy; ${new Date().getFullYear()} BuildWithKT. All rights reserved.
        `;
		about.appendChild(legal);

		container.appendChild(about);
	}
}

// --- Helper Functions for UI Controls ---

function addToggle(container, label, desc, checked, onChange) {
	const row = document.createElement("div");
	row.className = "setting-row";

	const controlId = `tp-setting-toggle-${++_settingControlSeq}`;
	const labelId = `${controlId}-label`;
	const descId = `${controlId}-desc`;

	const info = document.createElement("div");
	info.className = "setting-info";
	info.innerHTML = `<div class="setting-label" id="${labelId}">${label}</div><div class="setting-desc" id="${descId}">${desc}</div>`;
	info.style.cursor = "pointer";

	const control = document.createElement("div");
	control.className = "setting-control";

	const labelEl = document.createElement("label");
	labelEl.className = "toggle-switch";

	const input = document.createElement("input");
	input.type = "checkbox";
	input.id = controlId;
	input.checked = !!checked;
	input.setAttribute("aria-labelledby", labelId);
	input.setAttribute("aria-describedby", descId);
	input.addEventListener("change", (e) => onChange(e.target.checked));

	// Clicking the visible text should toggle the switch, just like a label.
	info.addEventListener("click", () => {
		input.checked = !input.checked;
		input.dispatchEvent(new Event("change", { bubbles: true }));
	});

	const slider = document.createElement("span");
	slider.className = "toggle-slider";

	labelEl.appendChild(input);
	labelEl.appendChild(slider);
	control.appendChild(labelEl);

	row.appendChild(info);
	row.appendChild(control);
	container.appendChild(row);
}

function addInput(
	container,
	label,
	desc,
	value,
	onChange,
	placeholder = "",
	type = "text",
) {
	const row = document.createElement("div");
	row.className = "setting-row";

	const controlId = `tp-setting-input-${++_settingControlSeq}`;
	const labelId = `${controlId}-label`;
	const descId = `${controlId}-desc`;

	const info = document.createElement("div");
	info.className = "setting-info";
	info.innerHTML = `<div class="setting-label" id="${labelId}">${label}</div><div class="setting-desc" id="${descId}">${desc}</div>`;

	const control = document.createElement("div");
	control.className = "setting-control";

	const input = document.createElement("input");
	input.type = type;
	if (type === "password") input.autocomplete = "off";
	input.id = controlId;
	input.setAttribute("aria-labelledby", labelId);
	input.setAttribute("aria-describedby", descId);
	input.className = "input";
	input.value = value;
	input.placeholder = placeholder;

	// Inline styles removed in favor of base.css .input

	input.addEventListener("focus", () => {
		input.style.borderColor = "var(--color-accent)";
		input.style.backgroundColor = "var(--color-base)";
	});

	input.addEventListener("blur", () => {
		input.style.borderColor = "transparent";
		input.style.backgroundColor = "var(--color-off)";
	});

	input.addEventListener("change", (e) => onChange(e.target.value));

	control.appendChild(input);
	row.appendChild(info);
	row.appendChild(control);
	container.appendChild(row);
	return input;
}

function addSelect(container, label, desc, options, value, onChange) {
	const row = document.createElement("div");
	row.className = "setting-row";

	const controlId = `tp-setting-select-${++_settingControlSeq}`;
	const labelId = `${controlId}-label`;
	const descId = `${controlId}-desc`;

	const info = document.createElement("div");
	info.className = "setting-info";
	info.innerHTML = `<div class="setting-label" id="${labelId}">${label}</div><div class="setting-desc" id="${descId}">${desc}</div>`;

	const control = document.createElement("div");
	control.className = "setting-control";
	// Flex container for controls
	control.style.display = "flex";
	control.style.alignItems = "center";
	control.style.gap = "var(--dis-1)";

	const select = document.createElement("select");
	select.id = controlId;
	select.setAttribute("aria-labelledby", labelId);
	select.setAttribute("aria-describedby", descId);
	select.className = "select"; // Uses base.css .select
	options.forEach((opt) => {
		const o = document.createElement("option");
		o.value = opt.value;
		o.textContent = opt.label;
		if (opt.value === value) o.selected = true;
		select.appendChild(o);
	});

	// Navigation Buttons
	const createNavBtn = (iconPath, delta) => {
		const btn = document.createElement("button");
		btn.className = "btn btn-icon";
		btn.setAttribute(
			"aria-label",
			delta < 0 ? "Previous option" : "Next option",
		);
		btn.style.width = "var(--dis-4)"; // Smaller width for nav buttons
		btn.style.height = "var(--dis-4)";
		btn.innerHTML = "<span></span>";
		renderInlineIcon(btn.querySelector("span"), iconPath);

		btn.onclick = () => {
			const newIndex = select.selectedIndex + delta;
			if (newIndex >= 0 && newIndex < select.options.length) {
				select.selectedIndex = newIndex;
				select.dispatchEvent(new Event("change"));
			}
		};
		return btn;
	};

	const prevBtn = createNavBtn(
		"assets/svgs-fontawesome/solid/chevron-left.svg",
		-1,
	);
	const nextBtn = createNavBtn(
		"assets/svgs-fontawesome/solid/chevron-right.svg",
		1,
	);

	const updateBtnState = () => {
		prevBtn.disabled = select.selectedIndex <= 0;
		// Visual disable style if needed, though btn:disabled should handle opacity
		prevBtn.style.opacity = prevBtn.disabled ? "0.3" : "1";
		prevBtn.style.pointerEvents = prevBtn.disabled ? "none" : "auto";

		nextBtn.disabled = select.selectedIndex >= select.options.length - 1;
		nextBtn.style.opacity = nextBtn.disabled ? "0.3" : "1";
		nextBtn.style.pointerEvents = nextBtn.disabled ? "none" : "auto";
	};

	// Initial State
	updateBtnState();

	select.addEventListener("change", (e) => {
		updateBtnState();
		onChange(e.target.value);
	});

	control.appendChild(prevBtn);
	control.appendChild(select);
	control.appendChild(nextBtn);

	row.appendChild(info);
	row.appendChild(control);
	container.appendChild(row);
	return row;
}

function addRange(
	container,
	label,
	unit,
	min,
	max,
	value,
	defaultValue,
	onChange,
	key,
) {
	const row = document.createElement("div");
	row.className = "setting-row";

	const info = document.createElement("div");
	info.className = "setting-info";
	info.innerHTML = `<div class="setting-label">${label}</div>`;

	// Reset Button (individual)
	const resetBtn = document.createElement("button");
	resetBtn.className = "btn btn-icon";
	resetBtn.title = "Reset to default";
	resetBtn.innerHTML = "<span></span>";
	renderInlineIcon(
		resetBtn.querySelector("span"),
		"assets/svgs-fontawesome/solid/rotate-left.svg",
	); // or similar icon
	resetBtn.style.display = "inline-flex"; // Always visible
	resetBtn.style.opacity = value !== defaultValue ? "1" : "0.3";
	resetBtn.style.pointerEvents = value !== defaultValue ? "auto" : "none";

	info.appendChild(resetBtn);

	const control = document.createElement("div");
	control.className = "setting-control";

	const wrapper = document.createElement("div");
	wrapper.className = "range-wrapper";

	const input = document.createElement("input");
	input.type = "range";
	input.className = "input-range";
	input.min = min;
	input.max = max;
	input.value = value;
	// Filter sliders carry their config key so a preset can sync them in place.
	if (key) {
		input.dataset.filterKey = key;
		input.dataset.unit = unit || "";
	}

	const valDisplay = document.createElement("div");
	valDisplay.className = "range-value";
	valDisplay.textContent = value + unit;

	const updateResetVisibility = (v) => {
		// resetBtn.style.display = v !== defaultValue ? 'inline-flex' : 'none';
		// User requested always visible
		resetBtn.style.display = "inline-flex";
		resetBtn.style.opacity = v !== defaultValue ? "1" : "0.3"; // Visual cue
		resetBtn.style.pointerEvents = v !== defaultValue ? "auto" : "none";
	};

	input.addEventListener("input", (e) => {
		const val = Number(e.target.value);
		valDisplay.textContent = val + unit;
		updateResetVisibility(val);
		onChange(val);
	});

	resetBtn.addEventListener("click", () => {
		input.value = defaultValue;
		valDisplay.textContent = defaultValue + unit;
		updateResetVisibility(defaultValue);
		onChange(defaultValue);
	});

	wrapper.appendChild(input);
	wrapper.appendChild(valDisplay);
	wrapper.appendChild(resetBtn); // Append reset button at the end
	control.appendChild(wrapper);

	row.appendChild(info);
	row.appendChild(control);
	container.appendChild(row);
}

function addIconSelect(container, label, desc, options, value, onChange) {
	const row = document.createElement("div");
	row.className = "setting-row";

	const info = document.createElement("div");
	info.className = "setting-info";
	info.innerHTML = `<div class="setting-label">${label}</div><div class="setting-desc">${desc}</div>`;

	const control = document.createElement("div");
	control.className = "setting-control";

	const group = document.createElement("div");
	group.className = "icon-select-group";

	// We need to keep track of buttons to manage active state
	const buttons = [];

	options.forEach((opt) => {
		const btn = document.createElement("button");
		btn.className = "btn btn-icon icon-select-btn";
		if (opt.value === value) btn.classList.add("active");
		btn.title = opt.label; // Tooltip

		const icon = document.createElement("span");
		// icon.className = 'ui-icon'; // Removed
		icon.setAttribute("aria-hidden", "true");
		renderInlineIcon(icon, opt.icon);
		btn.appendChild(icon);

		btn.onclick = () => {
			// Update active state
			buttons.forEach((b) => b.classList.remove("active"));
			btn.classList.add("active");
			onChange(opt.value);
		};

		buttons.push(btn);
		group.appendChild(btn);
	});

	control.appendChild(group);
	row.appendChild(info);
	row.appendChild(control);
	container.appendChild(row);
}

function addColorPicker(container, label, desc, value, onChange) {
	const row = document.createElement("div");
	row.className = "setting-row";

	const info = document.createElement("div");
	info.className = "setting-info";
	info.innerHTML = `<div class="setting-label">${label}</div><div class="setting-desc">${desc}</div>`;

	const control = document.createElement("div");
	control.className = "setting-control";

	const wrapper = document.createElement("div");
	wrapper.style.display = "flex";
	wrapper.style.alignItems = "center";
	wrapper.style.gap = "0.5rem";

	// Native color input
	const colorInput = document.createElement("input");
	colorInput.type = "color";
	colorInput.value = value || "#ffffff";
	colorInput.style.width = "3rem";
	colorInput.style.height = "2rem";
	colorInput.style.padding = "0";
	colorInput.style.border = "none";
	colorInput.style.borderRadius = "var(--radius-base)";
	colorInput.style.cursor = "pointer";
	colorInput.style.backgroundColor = "transparent";

	// Text input for hex code
	const textInput = document.createElement("input");
	textInput.type = "text";
	textInput.className = "input";
	textInput.value = value || "#ffffff";
	textInput.placeholder = "#ffffff";
	textInput.style.width = "6rem";
	textInput.style.textTransform = "uppercase";

	// Sync color picker to text
	colorInput.addEventListener("input", (e) => {
		const hex = e.target.value;
		textInput.value = hex;
		onChange(hex);
	});

	// Sync text to color picker
	textInput.addEventListener("change", (e) => {
		let hex = e.target.value.trim();
		if (!hex.startsWith("#")) hex = "#" + hex;
		if (/^#[0-9A-Fa-f]{6}$/.test(hex)) {
			colorInput.value = hex;
			onChange(hex);
		}
	});

	wrapper.appendChild(colorInput);
	wrapper.appendChild(textInput);
	control.appendChild(wrapper);

	row.appendChild(info);
	row.appendChild(control);
	container.appendChild(row);

	return row; // Return row so caller can control visibility
}

// --- Helper for Dynamic Wallpaper Content ---
function updateWallpaperDynamicContent(container, settings) {
	container.innerHTML = "";

	// If Mono, show message and stop
	if (settings.wallpaper.type === "mono") {
		const msg = document.createElement("div");
		msg.className = "setting-desc";
		msg.style.padding = "2rem";
		msg.style.textAlign = "center";
		msg.textContent = "Mono mode selected. Background set to solid color.";
		container.appendChild(msg);
		return;
	}

	// Duotone Settings
	if (settings.wallpaper.type === "duotone") {
		const duoGroup = document.createElement("div");
		duoGroup.className = "settings-group";

		const dHeader = document.createElement("div");
		dHeader.className = "settings-group-header";
		const dTitle = document.createElement("div");
		dTitle.className = "settings-group-title";
		dTitle.textContent = "Duotone Theme";
		dHeader.appendChild(dTitle);
		duoGroup.appendChild(dHeader);

		// Prepare options from DUOTONE_THEMES
		const themeOptions = Object.entries(DUOTONE_THEMES).map(
			([key, val]) => ({
				value: key,
				label: val.name,
			}),
		);
		// Add Custom option
		themeOptions.push({ value: "custom", label: "Custom" });

		// Match Theme Toggle
		addToggle(
			duoGroup,
			"Match Theme Colors",
			"Apply duotone colors to the rest of the interface.",
			settings.wallpaper.duotoneSettings?.matchTheme || false,
			(val) => {
				if (!settings.wallpaper.duotoneSettings)
					settings.wallpaper.duotoneSettings = {};
				settings.wallpaper.duotoneSettings.matchTheme = val;
				saveSettings(settings); // Async
				refreshWallpaper(settings);
				// Re-render to show/hide custom UI colors
				updateWallpaperDynamicContent(container, settings);
			},
		);

		// Theme Select

		// Theme Select
		addSelect(
			duoGroup,
			"Theme",
			"Choose a preset or create your own.",
			themeOptions,
			settings.wallpaper.duotoneSettings?.theme || "sunset",
			(val) => {
				if (!settings.wallpaper.duotoneSettings)
					settings.wallpaper.duotoneSettings = {};
				settings.wallpaper.duotoneSettings.theme = val;
				saveSettings(settings); // Assume saveSettings handles deep merge or simple object update
				refreshWallpaper(settings);
				// Re-render to show/hide custom colors
				updateWallpaperDynamicContent(container, settings);
			},
		);

		container.appendChild(duoGroup);

		// Custom Colors
		if (settings.wallpaper.duotoneSettings?.theme === "custom") {
			const colorGroup = document.createElement("div");
			colorGroup.className = "settings-group";
			colorGroup.style.marginTop = "0";

			const cHeader = document.createElement("div");
			cHeader.className = "settings-group-header";
			const cTitle = document.createElement("div");
			cTitle.className = "settings-group-title";
			cTitle.textContent = "Custom Colors";
			cHeader.appendChild(cTitle);
			colorGroup.appendChild(cHeader);

			const row = document.createElement("div");
			row.style.display = "flex";
			row.style.gap = "var(--dis-2)";
			row.style.alignItems = "center";

			const colors =
				settings.wallpaper.duotoneSettings.customColors ||
				DEFAULT_CONFIG.wallpaper.duotoneSettings.customColors;

			// Color 1
			const c1 = document.createElement("input");
			c1.type = "color";
			c1.value = colors[0];
			c1.className = "input-color"; // Assuming some style or just default
			c1.style.height = "var(--dis-6)"; // Make it bigger
			c1.style.width = "100%";
			c1.style.cursor = "pointer";
			c1.onchange = (e) => {
				const newColors = [e.target.value, colors[1] || "#000000"];
				settings.wallpaper.duotoneSettings.customColors = newColors;
				saveSettings(settings);
				refreshWallpaper(settings);
			};

			// Color 2
			const c2 = document.createElement("input");
			c2.type = "color";
			c2.value = colors[1];
			c2.className = "input-color";
			c2.style.height = "var(--dis-6)";
			c2.style.width = "100%";
			c2.style.cursor = "pointer";
			c2.onchange = (e) => {
				const newColors = [colors[0] || "#ffffff", e.target.value];
				settings.wallpaper.duotoneSettings.customColors = newColors;
				saveSettings(settings);
				refreshWallpaper(settings);
			};

			row.appendChild(c1);
			row.appendChild(c2);
			colorGroup.appendChild(row);

			// UI Custom Colors (Only if Match Theme is ON)
			if (settings.wallpaper.duotoneSettings.matchTheme) {
				const uHeader = document.createElement("div");
				uHeader.className = "settings-group-header";
				uHeader.style.marginTop = "var(--dis-2)";
				const uTitle = document.createElement("div");
				uTitle.className = "settings-group-title";
				uTitle.textContent = "UI Colors (Base, Off, Accent)";
				uHeader.appendChild(uTitle);
				colorGroup.appendChild(uHeader);

				const uRow = document.createElement("div");
				uRow.style.display = "flex";
				uRow.style.gap = "var(--dis-2)";
				uRow.style.alignItems = "center";

				const uiColors = settings.wallpaper.duotoneSettings
					.customUiColors || ["#ffffff", "#f0f0f0", "#0072ff"];

				// Helper to make color input
				const makeInput = (idx, defaultVal) => {
					const inp = document.createElement("input");
					inp.type = "color";
					inp.value = uiColors[idx] || defaultVal;
					inp.className = "input-color";
					inp.style.height = "var(--dis-6)";
					inp.style.width = "100%";
					inp.style.cursor = "pointer";
					inp.onchange = (e) => {
						const newUi = [...uiColors];
						newUi[idx] = e.target.value;
						settings.wallpaper.duotoneSettings.customUiColors =
							newUi;
						saveSettings(settings);
						refreshWallpaper(settings);
					};
					return inp;
				};

				uRow.appendChild(makeInput(0, "#ffffff")); // Base
				uRow.appendChild(makeInput(1, "#f0f0f0")); // Off
				uRow.appendChild(makeInput(2, "#0072ff")); // Accent

				colorGroup.appendChild(uRow);
			}

			container.appendChild(colorGroup);
		}

		// Allow filters for Duotone too? strict requirements?
		// "base on the settings, we have a mono theme, but what if we can add more such theme like duotones"
		// Mono hides filters. I'll let Duotone have filters (blur/brightness etc) as they might look cool on gradients.

		// UPDATE: User requested to hide filters for Duotone
		return;
	}

	// Matrix Settings
	if (settings.wallpaper.type === "matrix") {
		const mGroup = document.createElement("div");
		mGroup.className = "settings-group";

		const mHeader = document.createElement("div");
		mHeader.className = "settings-group-header";
		const mTitle = document.createElement("div");
		mTitle.className = "settings-group-title";
		mTitle.textContent = "Matrix Configuration";
		mHeader.appendChild(mTitle);
		mGroup.appendChild(mHeader);

		// Defaults
		const defaults = DEFAULT_CONFIG.wallpaper.matrixSettings;
		const cfg = settings.wallpaper.matrixSettings || defaults;

		// Color
		addColorPicker(
			mGroup,
			"Code Color",
			"Color of the falling characters.",
			cfg.color || defaults.color,
			(val) => {
				if (!settings.wallpaper.matrixSettings)
					settings.wallpaper.matrixSettings = {};
				settings.wallpaper.matrixSettings.color = val;
				saveSettings(settings);

				// Real-time update (requires restarting effect with new config)
				// We can import startMatrix from here? No, settingsModal doesn't import from matrixEffect.
				// We rely on refreshWallpaper logic or dispatch event?
				// refreshWallpaper re-calls renderWallpaper, which calls startMatrix.
				refreshWallpaper(settings);
			},
		);

		// Speed (Interval ms: Lower is faster)
		// UI should probably show "Speed" where Higher is Faster
		// So we invert logic: UI [1-100], Config = 100 - UI + 10 ?
		// Let's keep it simple: "Update Interval (ms)" - Lower is faster
		// Or "Speed" - 1 (Slow) to 10 (Fast).
		// Let's do Interval for direct control, but label it "Speed (Lower is Faster)" or invert it.
		// Let's do: Speed 1 (Slow, 100ms) to 100 (Fast, 1ms).
		// Config speed = 101 - UI Value.
		const currentUIInfo = (ms) => 101 - (ms || 50);

		addRange(
			mGroup,
			"Speed",
			"",
			1,
			100,
			101 - (cfg.speed || 50),
			51, // Default 50ms -> 51
			(val) => {
				if (!settings.wallpaper.matrixSettings)
					settings.wallpaper.matrixSettings = {};
				settings.wallpaper.matrixSettings.speed = 101 - val;
				saveSettings(settings);
				refreshWallpaper(settings);
			},
		);

		// Font Size
		addRange(
			mGroup,
			"Font Size",
			"px",
			10,
			40,
			cfg.fontSize || defaults.fontSize,
			16,
			(val) => {
				if (!settings.wallpaper.matrixSettings)
					settings.wallpaper.matrixSettings = {};
				settings.wallpaper.matrixSettings.fontSize = val;
				saveSettings(settings);
				refreshWallpaper(settings);
			},
		);

		container.appendChild(mGroup);
		return;
	}

	// 0. Video Settings (Mute)
	if (settings.wallpaper.type === "video") {
		const videoGroup = document.createElement("div");
		videoGroup.className = "settings-group";

		const vHeader = document.createElement("div");
		vHeader.className = "settings-group-header";
		const vTitle = document.createElement("div");
		vTitle.className = "settings-group-title";
		vTitle.textContent = "Video Audio";
		vHeader.appendChild(vTitle);
		videoGroup.appendChild(vHeader);

		addToggle(
			videoGroup,
			"Mute Audio",
			"Mute sound for video wallpapers. Note: Not all wallpapers have audio.",
			settings.wallpaper.muted !== false, // Default true
			(val) => {
				settings.wallpaper.muted = val;
				saveSettings(settings);
				// Apply limit: We must Re-render to update the media session blockers
				// previously we just toggled the property, but that doesn't add/remove the blockers
				// const vEl = document.querySelector("video#wallpaper");
				// if (vEl) vEl.muted = val;
				refreshWallpaper(settings);
			},
		);
		container.appendChild(videoGroup);
	}

	// 1. Filters Group
	const filterGroup = document.createElement("div");
	filterGroup.className = "settings-group";

	const groupHeader = document.createElement("div");
	groupHeader.className = "settings-group-header"; // New class for flex layout
	groupHeader.style.display = "flex";
	groupHeader.style.justifyContent = "space-between";
	groupHeader.style.alignItems = "center";

	const title = document.createElement("div");
	title.className = "settings-group-title";
	title.textContent = "Visual Filters";
	groupHeader.appendChild(title);

	// Always show Reset All
	const resetAll = document.createElement("button");
	resetAll.className = "btn btn-icon-text";
	resetAll.title = "Reset all filters to default";

	const resetIcon = document.createElement("span");
	// resetIcon.className = 'ui-icon'; // Removed
	renderInlineIcon(
		resetIcon,
		"assets/svgs-fontawesome/solid/rotate-left.svg",
	);
	resetAll.appendChild(resetIcon);

	const resetText = document.createElement("span");
	resetText.className = "text";
	resetText.textContent = "Reset All";
	resetAll.appendChild(resetText);

	resetAll.onclick = () => {
		settings.wallpaper.blur = 0;
		settings.wallpaper.brightness = 100;
		settings.wallpaper.contrast = 100;
		settings.wallpaper.grayscale = 0;
		settings.wallpaper.saturate = 100;
		settings.wallpaper.sharpness = 0;
		settings.wallpaper.rain = false; // Reset Rain
		settings.wallpaper.rainSettings = {
			...DEFAULT_CONFIG.wallpaper.rainSettings,
		};
		saveSettings(settings);
		updateWallpaperFilters(settings.wallpaper);
		toggleRain(false); // Stop Rain
		// Re-render this section to update sliders
		updateWallpaperDynamicContent(container, settings);
	};
	groupHeader.appendChild(resetAll);

	filterGroup.appendChild(groupHeader);
	container.appendChild(filterGroup);

	// Filter presets (None / Vivid / Cinematic / Dreamy / Custom). These are
	// global — applying one simply drives the Visual Filter sliders below, so
	// they work for catalog wallpapers and custom uploads alike.
	const filterPresetUI = renderFilterPresets(filterGroup, container, settings);

	// Rain Toggle
	const rainDetails = document.createElement("div");
	rainDetails.className = "rain-settings";

	const renderRainDetails = () => {
		rainDetails.innerHTML = "";
		if (!settings.wallpaper.rain) {
			rainDetails.hidden = true;
			return;
		}
		rainDetails.hidden = false;
		if (!settings.wallpaper.rainSettings) {
			settings.wallpaper.rainSettings = {
				...DEFAULT_CONFIG.wallpaper.rainSettings,
			};
		}
		const rainCfg = settings.wallpaper.rainSettings;
		const defaults = DEFAULT_CONFIG.wallpaper.rainSettings;
		const updateRain = (key, value) => {
			rainCfg[key] = value;
			saveSettings(settings);
			toggleRain(true, rainCfg);
		};

		addRange(
			rainDetails,
			"Drops",
			"",
			20,
			400,
			rainCfg.count ?? defaults.count,
			defaults.count,
			(val) => updateRain("count", val),
		);
		addRange(
			rainDetails,
			"Speed",
			"",
			1,
			40,
			rainCfg.speed ?? defaults.speed,
			defaults.speed,
			(val) => updateRain("speed", val),
		);
		addRange(
			rainDetails,
			"Drop Length",
			"px",
			5,
			60,
			rainCfg.length ?? defaults.length,
			defaults.length,
			(val) => updateRain("length", val),
		);
		addRange(
			rainDetails,
			"Opacity",
			"%",
			0,
			100,
			rainCfg.opacity ?? defaults.opacity,
			defaults.opacity,
			(val) => updateRain("opacity", val),
		);
		addColorPicker(
			rainDetails,
			"Drop Color",
			"Color of the rain streaks.",
			rainCfg.color ?? defaults.color,
			(val) => updateRain("color", val),
		);
	};

	addToggle(
		filterGroup,
		"Rain Overlay",
		"Enable a cinematic rain effect over the wallpaper.",
		settings.wallpaper.rain || false,
		(val) => {
			settings.wallpaper.rain = val;
			if (val && !settings.wallpaper.rainSettings) {
				settings.wallpaper.rainSettings = {
					...DEFAULT_CONFIG.wallpaper.rainSettings,
				};
			}
			saveSettings(settings);
			if (val) {
				toggleRain(true, settings.wallpaper.rainSettings);
			} else {
				toggleRain(false);
			}
			renderRainDetails();
		},
	);
	filterGroup.appendChild(rainDetails);
	renderRainDetails();

	addRange(
		filterGroup,
		"Blur",
		"px",
		0,
		20,
		settings.wallpaper.blur,
		0,
		(val) => {
			settings.wallpaper.blur = val;
			saveSettings(settings);
			updateWallpaperFilters(settings.wallpaper);
			// updateWallpaperDynamicContent(container, settings); // REMOVED to fix drag glitch
			noteFilterPresetChange(settings);
			filterPresetUI?.refresh();
		},
		"blur",
	);

	addRange(
		filterGroup,
		"Brightness",
		"%",
		50,
		150,
		settings.wallpaper.brightness,
		100,
		(val) => {
			settings.wallpaper.brightness = val;
			saveSettings(settings);
			updateWallpaperFilters(settings.wallpaper);
			noteFilterPresetChange(settings);
			filterPresetUI?.refresh();
		},
		"brightness",
	);

	addRange(
		filterGroup,
		"Contrast",
		"%",
		50,
		150,
		settings.wallpaper.contrast,
		100,
		(val) => {
			settings.wallpaper.contrast = val;
			saveSettings(settings);
			updateWallpaperFilters(settings.wallpaper);
			noteFilterPresetChange(settings);
			filterPresetUI?.refresh();
		},
		"contrast",
	);

	addRange(
		filterGroup,
		"Sharpness",
		"",
		0,
		100,
		settings.wallpaper.sharpness ?? 0,
		0,
		(val) => {
			settings.wallpaper.sharpness = val;
			saveSettings(settings);
			updateWallpaperFilters(settings.wallpaper);
			noteFilterPresetChange(settings);
			filterPresetUI?.refresh();
		},
		"sharpness",
	);

	addRange(
		filterGroup,
		"Saturation",
		"%",
		0,
		200,
		settings.wallpaper.saturate ?? 100,
		100,
		(val) => {
			settings.wallpaper.saturate = val;
			saveSettings(settings);
			updateWallpaperFilters(settings.wallpaper);
			noteFilterPresetChange(settings);
			filterPresetUI?.refresh();
		},
		"saturate",
	);

	addRange(
		filterGroup,
		"Grayscale",
		"%",
		0,
		100,
		settings.wallpaper.grayscale,
		0,
		(val) => {
			settings.wallpaper.grayscale = val;
			saveSettings(settings);
			updateWallpaperFilters(settings.wallpaper);
			noteFilterPresetChange(settings);
			filterPresetUI?.refresh();
		},
		"grayscale",
	);

	// 2. Wallpaper Grid
	const grid = document.createElement("div");
	grid.className = "wallpaper-grid";
	container.appendChild(grid);

	renderWallpaperGrid(grid, settings);
}

// --- Logic Helpers ---

// --- Filter presets ---

/** Pull just the preset-controlled filter keys out of a config object. */
function pickFilterValues(cfg) {
	const out = {};
	for (const k of FILTER_PRESET_KEYS) {
		const v = cfg?.[k];
		out[k] = Number(v != null ? v : DEFAULT_CONFIG.wallpaper[k]);
	}
	return out;
}

function filterValuesEqual(a, b) {
	return FILTER_PRESET_KEYS.every(
		(k) => Number(a?.[k]) === Number(b?.[k]),
	);
}

/** The preset id whose values currently match, or null for a manual mix. */
function detectActivePreset(settings) {
	const cur = pickFilterValues(settings.wallpaper);
	for (const [id, preset] of Object.entries(FILTER_PRESETS)) {
		if (filterValuesEqual(cur, preset)) return id;
	}
	const custom = settings.wallpaper.customPreset;
	if (custom && filterValuesEqual(cur, custom)) return "custom";
	return null;
}

/** Keep the Presets dropdown in step when the sliders are edited by hand. */
function noteFilterPresetChange(settings) {
	const match = detectActivePreset(settings);
	if (match) settings.wallpaper.filterPreset = match;
}

/** Write the given filter values into the live wallpaper config. */
function applyFilterValues(settings, values) {
	for (const k of FILTER_PRESET_KEYS) {
		if (values?.[k] != null) settings.wallpaper[k] = Number(values[k]);
	}
	saveSettings(settings);
	updateWallpaperFilters(settings.wallpaper);
}

/** Move the on-screen sliders to match the settings without a full re-render. */
function syncFilterSliders(container, settings) {
	container.querySelectorAll("input[data-filter-key]").forEach((input) => {
		const key = input.dataset.filterKey;
		if (settings.wallpaper[key] == null) return;
		input.value = settings.wallpaper[key];
		const display = input.parentElement?.querySelector(".range-value");
		if (display)
			display.textContent = `${input.value}${input.dataset.unit || ""}`;
	});
}

function renderFilterPresets(group, container, settings) {
	const makeControl = () => {
		const control = document.createElement("div");
		control.className = "setting-control";
		control.style.display = "flex";
		control.style.alignItems = "center";
		control.style.gap = "var(--dis-1)";
		control.style.flexWrap = "wrap";
		control.style.justifyContent = "flex-end";
		return control;
	};

	const makeInfo = (labelText, descText) => {
		const info = document.createElement("div");
		info.className = "setting-info";
		const label = document.createElement("div");
		label.className = "setting-label";
		label.textContent = labelText;
		const desc = document.createElement("div");
		desc.className = "setting-desc";
		desc.textContent = descText;
		info.append(label, desc);
		return info;
	};

	const makeIconBtn = (icon, title, extraClass) => {
		const btn = document.createElement("button");
		btn.type = "button";
		btn.className = "btn btn-icon" + (extraClass ? ` ${extraClass}` : "");
		btn.title = title;
		btn.setAttribute("aria-label", title);
		btn.style.width = "var(--dis-4)";
		btn.style.height = "var(--dis-4)";
		btn.innerHTML = "<span></span>";
		renderInlineIcon(
			btn.querySelector("span"),
			`assets/svgs-fontawesome/solid/${icon}`,
		);
		return btn;
	};

	// Row 1 — Preset: dropdown with prev/next navigation.
	const presetRow = document.createElement("div");
	presetRow.className = "setting-row";
	const prevBtn = makeIconBtn("chevron-left.svg", "Previous preset");
	const nextBtn = makeIconBtn("chevron-right.svg", "Next preset");
	const select = document.createElement("select");
	select.className = "select";
	select.setAttribute("aria-label", "Filter preset");
	const presetControl = makeControl();
	presetControl.append(prevBtn, select, nextBtn);
	presetRow.append(
		makeInfo("Preset", "Apply a saved filter look to any wallpaper."),
		presetControl,
	);

	// Row 2 — Custom preset: save the current filters / clear the saved one.
	const customRow = document.createElement("div");
	customRow.className = "setting-row";
	const saveBtn = makeIconBtn(
		"floppy-disk.svg",
		"Save the current filter values as your custom preset",
		"filter-preset-save",
	);
	const resetBtn = makeIconBtn(
		"rotate-left.svg",
		"Clear the saved custom preset",
		"filter-preset-reset",
	);
	const customControl = makeControl();
	customControl.append(saveBtn, resetBtn);
	customRow.append(
		makeInfo(
			"Custom preset",
			"Save the current filters as your own preset.",
		),
		customControl,
	);

	const presetList = () => {
		const list = Object.entries(FILTER_PRESETS).map(([id, preset]) => ({
			id,
			label: preset.label,
			values: preset,
		}));
		if (settings.wallpaper.customPreset) {
			list.push({
				id: "custom",
				label: "Custom",
				values: {
					label: "Custom",
					...settings.wallpaper.customPreset,
				},
			});
		}
		return list;
	};

	const selectedId = () => {
		const list = presetList();
		const stored = settings.wallpaper.filterPreset;
		if (stored && list.some((p) => p.id === stored)) return stored;
		return detectActivePreset(settings) || "none";
	};

	const render = () => {
		const list = presetList();
		select.innerHTML = "";
		for (const preset of list) {
			const option = document.createElement("option");
			option.value = preset.id;
			option.textContent = preset.label;
			select.appendChild(option);
		}
		select.value = selectedId();
		const hasCustom = !!settings.wallpaper.customPreset;
		resetBtn.disabled = !hasCustom;
		resetBtn.style.opacity = hasCustom ? "1" : "0.35";
	};

	const applyPreset = (preset) => {
		applyFilterValues(settings, preset.values);
		settings.wallpaper.filterPreset = preset.id;
		saveSettings(settings);
		syncFilterSliders(container, settings);
		render();
	};

	select.addEventListener("change", () => {
		const preset = presetList().find((p) => p.id === select.value);
		if (preset) applyPreset(preset);
	});

	const step = (delta) => {
		const list = presetList();
		if (!list.length) return;
		const current = list.findIndex((p) => p.id === selectedId());
		const index =
			(((current < 0 ? 0 : current) + delta) % list.length +
				list.length) %
			list.length;
		applyPreset(list[index]);
	};
	prevBtn.addEventListener("click", () => step(-1));
	nextBtn.addEventListener("click", () => step(1));

	saveBtn.addEventListener("click", () => {
		settings.wallpaper.customPreset = pickFilterValues(
			settings.wallpaper,
		);
		settings.wallpaper.filterPreset = "custom";
		saveSettings(settings);
		render();
	});

	resetBtn.addEventListener("click", () => {
		if (!settings.wallpaper.customPreset) return;
		settings.wallpaper.customPreset = null;
		if (settings.wallpaper.filterPreset === "custom") {
			settings.wallpaper.filterPreset = "none";
		}
		saveSettings(settings);
		render();
	});

	render();
	group.append(presetRow, customRow);

	return { refresh: render };
}

function updateWallpaperFilters(cfg) {
	const el = document.getElementById("wallpaper");
	if (!el) return;
	applyWallpaperFilters(el, cfg);
}

async function refreshWallpaper(settings, forceReload = false) {
	// Re-fetch manifest (for availability) but use passed settings for config
	const manifest = await new Promise((resolve) => {
		chrome.storage.local.get("wallpaperDB", (res) =>
			resolve(res?.wallpaperDB || null),
		);
	});
	if (manifest) {
		console.log(
			"[Settings] Refreshing wallpaper with:",
			settings.wallpaper,
		);
		// Use the shared slideshow cursor for sequence/random exclusion.
		const rotationId = await readWallpaperRotationId();
		const wallpaperCfg =
			rotationId && settings.wallpaper ?
				{ ...settings.wallpaper, last_id: rotationId }
			:	settings.wallpaper;
		renderWallpaper(wallpaperCfg, manifest);
	}
}

// Helper: Sync current wallpaper settings to the type-specific bucket
// This ensures that when switching types, settings are preserved
function syncTypeBucket(settings) {
	const type = settings.wallpaper.type;
	if (type === "img" || type === "video") {
		const bucketName = type + "Settings";
		if (!settings.wallpaper[bucketName]) {
			settings.wallpaper[bucketName] = {};
		}
		settings.wallpaper[bucketName].collection =
			settings.wallpaper.collection;
		settings.wallpaper[bucketName].mode = settings.wallpaper.mode;
		settings.wallpaper[bucketName].specific = settings.wallpaper.specific;
	}
}

function applyFont(fontCfg) {
	if (!fontCfg) return;
	try {
		const existing = document.getElementById("user-font-link");
		if (existing) existing.remove();

		if (fontCfg.importUrl) {
			const link = document.createElement("link");
			link.id = "user-font-link";
			link.rel = "stylesheet";
			link.href = fontCfg.importUrl;
			document.head.appendChild(link);
		}

		const family = fontCfg.family || "Outfit";
		const fallback =
			"system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
		document.documentElement.style.setProperty(
			"--font-family",
			`${family}, ${fallback}`,
		);
	} catch (e) {
		// console.error('applyFont error', e);
	}
}

// --- Wallpaper Grid Helpers ---

let gridObjectUrls = [];

function cleanupWallpaperGrid() {
	if (gridObjectUrls.length > 0) {
		// console.debug(`[Settings] Cleaning up ${gridObjectUrls.length} blob URLs.`);
		gridObjectUrls.forEach((url) => URL.revokeObjectURL(url));
		gridObjectUrls = [];
	}
}

async function renderWallpaperGrid(container, settings, forceReload = false) {
	// Preserve Scroll Position
	const scrollParent = container.closest(".settings-content");
	let savedScroll = 0;
	if (scrollParent) {
		savedScroll = scrollParent.scrollTop;
	}

	// Prevent layout collapse
	container.style.minHeight = `${container.offsetHeight}px`;

	cleanupWallpaperGrid();
	container.innerHTML = "";

	// ... Rendering logic ...

	// Restoration is done at the end of the function (see next chunk)

	// Filter type (User wants to see Request Type only)
	const currentType = settings.wallpaper.type; // 'img' or 'video'

	// Fetch User Wallpapers
	const allUserWalls = await getUserWallpaperList();
	// Filter user wallpapers by type
	const userWallpapers = allUserWalls.filter((w) => w.type === currentType);
	const hasUserContent = userWallpapers.length > 0;

	// --- Actions Container (Top) ---
	const actionsContainer = document.createElement("div");
	actionsContainer.className = "grid-actions";
	container.appendChild(actionsContainer);

	// Upload Button
	const uploadBtn = document.createElement("button");
	uploadBtn.className = "btn btn-icon-text action-btn upload-btn";
	uploadBtn.innerHTML = `<span></span><span class="text">Upload</span>`;
	renderInlineIcon(
		uploadBtn.querySelector("span:first-child"),
		"assets/svgs-fontawesome/solid/upload.svg",
	);

	// Hidden File Input
	const fileInput = document.createElement("input");
	fileInput.type = "file";
	fileInput.accept = "image/*,video/*";
	fileInput.style.display = "none";
	fileInput.onchange = async (e) => {
		const file = e.target.files[0];
		if (!file) return;

		// Enforce Limits
		const isVideo = file.type.startsWith("video");
		const limits = UPLOAD_LIMITS[isVideo ? "video" : "img"];
		const limitMb = Math.round(limits.maxBytes / (1024 * 1024));
		if (file.size > limits.maxBytes) {
			showAlert(
				`File too large. Maximum size is ${limitMb}MB.`,
				"File too large",
			);
			fileInput.value = "";
			return;
		}

		uploadBtn.disabled = true;
		uploadBtn.innerHTML = `<span></span> Processing...`;
		renderInlineIcon(
			uploadBtn.querySelector("span"),
			"assets/svgs-fontawesome/solid/spinner.svg",
		);
		uploadBtn.querySelector("span").classList.add("animate-spin");

		try {
			const isVideo = file.type.startsWith("video");
			const type = isVideo ? "video" : "img";

			// Check Count Limit
			const currentCount = allUserWalls.filter(
				(w) => w.type === type,
			).length;
			const maxCount = UPLOAD_LIMITS[isVideo ? "video" : "img"].maxCount;

			if (currentCount >= maxCount) {
				const typeLabel = isVideo ? "video" : "image";
				showAlert(
					`Upload limit reached. You can only have ${maxCount} ${typeLabel} wallpapers.`,
					"Upload limit reached",
				);
				fileInput.value = "";
				return;
			}

			let thumbBlob = null;

			if (isVideo) {
				// thumbBlob handled below for both
			}

			// Generate thumbnail for both images and videos
			thumbBlob = await generateThumbnail(file);

			await saveUserWallpaper(file, type, thumbBlob);

			// If type mismatch, we do NOT switch automatically as per user request.
			// if (settings.wallpaper.type !== type) { ... }

			// Refresh grid
			clearMediaKeysCache();
			await renderWallpaperGrid(container, settings);
		} catch (err) {
			// console.error('Upload failed', err);
			showAlert("Failed to upload wallpaper.", "Upload failed");
		} finally {
			// Reset logic handled by re-render
		}
	};
	container.appendChild(fileInput); // Append to container so it's in DOM
	uploadBtn.onclick = () => fileInput.click();
	actionsContainer.appendChild(uploadBtn);

	// Refresh Button (Existing)
	const refreshBtn = document.createElement("button");
	refreshBtn.className = "btn btn-icon-text action-btn refresh-all";
	refreshBtn.innerHTML = `<span></span><span class="text">Refresh</span>`;
	renderInlineIcon(
		refreshBtn.querySelector("span:first-child"),
		"assets/svgs-fontawesome/solid/rotate.svg",
	);
	refreshBtn.onclick = async () => {
		refreshBtn.disabled = true;
		refreshBtn.innerHTML = `<span></span> Syncing...`;
		renderInlineIcon(
			refreshBtn.querySelector("span"),
			"assets/svgs-fontawesome/solid/spinner.svg",
		);
		refreshBtn.querySelector("span").classList.add("animate-spin");
		try {
			// 1. Regenerate User Thumbnails
			refreshBtn.innerHTML = `<span></span> Regenerating Inputs...`;
			renderInlineIcon(
				refreshBtn.querySelector("span"),
				"assets/svgs-fontawesome/solid/spinner.svg",
			);
			refreshBtn.querySelector("span").classList.add("animate-spin");

			// Check if getAllUserWallpapers is imported/available in scope? Yes.
			// We need to fetch fresh list
			const userWalls = await getAllUserWallpapers();
			for (const w of userWalls) {
				if (w.blob) {
					const newThumb = await generateThumbnail(w.blob);
					// Update existing entry (using the newly added 4th param for ID)
					await saveUserWallpaper(w.blob, w.type, newThumb, w.id);
				}
			}

			// 2. Original Sync
			refreshBtn.innerHTML = `<span></span> Syncing...`;
			renderInlineIcon(
				refreshBtn.querySelector("span"),
				"assets/svgs-fontawesome/solid/spinner.svg",
			);
			refreshBtn.querySelector("span").classList.add("animate-spin");

			await new Promise((resolve) => {
				let done = false;
				const finish = async () => {
					if (done) return;
					done = true;
					try {
						await refreshWallpaper(settings, true);
						clearMediaKeysCache();
						await renderWallpaperGrid(container, settings, true);
					} finally {
						resolve();
					}
				};
				// Safety valve only: never re-render a stale grid while the SW is
				// still syncing. The success callback refreshes it when done.
				const timer = setTimeout(() => {
					if (done) return;
					done = true;
					resolve();
				}, 120000);
				try {
					chrome.runtime.sendMessage(
						{ action: "refreshManifest" },
						() => {
							clearTimeout(timer);
							finish();
						},
					);
				} catch (e) {
					clearTimeout(timer);
					finish();
				}
			});
		} catch (e) {
			// console.error(e);
			await renderWallpaperGrid(container, settings);
		} finally {
			if (refreshBtn.isConnected) {
				refreshBtn.disabled = false;
				refreshBtn.innerHTML = `<span></span><span class="text">Refresh</span>`;
				renderInlineIcon(
					refreshBtn.querySelector("span:first-child"),
					"assets/svgs-fontawesome/solid/rotate.svg",
				);
			}
		}
	};
	actionsContainer.appendChild(refreshBtn);

	// --- User Wallpapers Section ---
	if (hasUserContent) {
		// Section Header with Delete All Uploads button
		const userHeaderContainer = document.createElement("div");
		userHeaderContainer.style.gridColumn = "1 / -1";
		userHeaderContainer.style.marginTop = "1rem";
		userHeaderContainer.style.display = "flex";
		userHeaderContainer.style.justifyContent = "space-between";
		userHeaderContainer.style.alignItems = "center";

		const userHeader = document.createElement("div");
		userHeader.className = "settings-group-title";
		userHeader.textContent = "User Wallpapers";
		userHeaderContainer.appendChild(userHeader);

		// Delete All Uploads Button (for current type only)
		if (userWallpapers.length > 0) {
			const delUploadsBtn = document.createElement("button");
			delUploadsBtn.className = "btn btn-icon-text action-btn delete-all";
			delUploadsBtn.innerHTML = `<span></span><span class="text">All</span>`;
			renderInlineIcon(
				delUploadsBtn.querySelector("span:first-child"),
				"assets/svgs-fontawesome/solid/trash.svg",
			);
			delUploadsBtn.onclick = () => {
				const typeLabel = currentType === "img" ? "image" : "video";
				showConfirmation(
					`Delete all uploaded ${typeLabel} wallpapers?`,
					async () => {
						// Delete all user wallpapers of current type (no fallback needed)
						for (const wall of userWallpapers) {
							await deleteUserWallpaper(wall.id);
						}
						clearMediaKeysCache();
						await renderWallpaperGrid(container, settings);
					},
				);
			};
			userHeaderContainer.appendChild(delUploadsBtn);
		}

		container.appendChild(userHeaderContainer);

		// 1. Random User Tile
		const isUserRandom =
			settings.wallpaper.collection === "user" &&
			settings.wallpaper.mode === "random";
		const rndUserTile = createOptionTile(
			"Random User",
			"assets/svgs-fontawesome/solid/shuffle.svg",
			isUserRandom,
		);
		rndUserTile.addEventListener("click", () => {
			container
				.querySelectorAll(".active")
				.forEach((e) => e.classList.remove("active"));
			rndUserTile.classList.add("active");

			settings.wallpaper.collection = "user";
			settings.wallpaper.mode = "random";
			settings.wallpaper.specific = null;
			syncTypeBucket(settings);
			saveSettings(settings);
			refreshWallpaper(settings);
		});
		container.appendChild(rndUserTile);

		// 2. Sequence User Tile
		const isUserSeq =
			settings.wallpaper.collection === "user" &&
			settings.wallpaper.mode === "sequence";
		const seqUserTile = createOptionTile(
			"Sequence User",
			"assets/svgs-fontawesome/solid/list-ol.svg",
			isUserSeq,
		);
		seqUserTile.addEventListener("click", () => {
			container
				.querySelectorAll(".active")
				.forEach((e) => e.classList.remove("active"));
			seqUserTile.classList.add("active");

			settings.wallpaper.collection = "user";
			settings.wallpaper.mode = "sequence";
			settings.wallpaper.specific = null;
			syncTypeBucket(settings);
			saveSettings(settings);
			refreshWallpaper(settings);
		});
		container.appendChild(seqUserTile);

		// 3. User Tiles
		// We'll sort by timestamp desc (newest first)?
		userWallpapers.sort((a, b) => b.timestamp - a.timestamp);

		for (const wall of userWallpapers) {
			const tile = document.createElement("div");
			const isActive =
				settings.wallpaper.collection === "user" &&
				settings.wallpaper.mode === "specific" &&
				settings.wallpaper.specific === wall.id;
			tile.className = `wallpaper-tile ${isActive ? "active" : ""}`;

			// Determine source for grid
			let displayUrl = null;

			if (wall.thumbBlob) {
				displayUrl = URL.createObjectURL(wall.thumbBlob);
			} else {
				// getUserWallpaperList() omits the heavy blob. Legacy uploads
				// or failed thumbnails must be fetched by id before rendering.
				const full = await getUserWallpaperById(wall.id);
				if (full && full.blob) {
					displayUrl = URL.createObjectURL(full.blob);
				}
			}

			if (!displayUrl) {
				const placeholder = document.createElement("div");
				placeholder.className = "setting-desc";
				placeholder.style.padding = "2rem";
				placeholder.style.textAlign = "center";
				placeholder.textContent = "No preview";
				tile.appendChild(placeholder);
			} else {
				gridObjectUrls.push(displayUrl);
				// Render as IMG always to "avoid page overload"
				// If video has NO thumb (legacy?), fallback to video tag.
				if (wall.type === "video" && !wall.thumbBlob) {
					const vid = document.createElement("video");
					vid.src = displayUrl;
					vid.muted = true;
					vid.style.objectFit = "cover";
					tile.appendChild(vid);
				} else {
					const img = document.createElement("img");
					img.src = displayUrl;
					img.loading = "lazy";
					tile.appendChild(img);
				}
			}

			// Click -> Select
			tile.addEventListener("click", (e) => {
				if (e.target.closest(".delete-overlay")) return;
				// Update selection in place. Re-rendering the whole grid here
				// blanked and rebuilt every tile (the visible "glitch").
				container
					.querySelectorAll(".option-tile")
					.forEach((t) => t.classList.remove("active"));
				container
					.querySelectorAll(".wallpaper-tile")
					.forEach((t) => t.classList.toggle("active", t === tile));
				const scroller = container.closest(".settings-content");
				const scrollTop = scroller ? scroller.scrollTop : 0;
				settings.wallpaper.collection = "user";
				settings.wallpaper.mode = "specific";
				settings.wallpaper.specific = wall.id;
				syncTypeBucket(settings); // Sync to type bucket
				saveSettings(settings);
				refreshWallpaper(settings).then(() =>
					keepScrollPosition(scroller, scrollTop),
				);
			});

			// Delete Overlay
			const delOverlay = document.createElement("button");
			delOverlay.className = "btn btn-icon btn-small delete-overlay";
			delOverlay.title = "Delete Wallpaper";
			renderInlineIcon(
				delOverlay,
				"assets/svgs-fontawesome/solid/trash.svg",
			);
			delOverlay.onclick = (e) => {
				e.stopPropagation();
				showConfirmation(
					"Delete this uploaded wallpaper?",
					async () => {
						await deleteUserWallpaper(wall.id);
						await renderWallpaperGrid(container, settings);
					},
				);
			};
			tile.appendChild(delOverlay);

			container.appendChild(tile);
		}

		// Separator
		const sep = document.createElement("div");
		sep.style.gridColumn = "1 / -1";
		sep.style.height = "1px";
		sep.style.background = "var(--text-secondary)";
		sep.style.opacity = "0.1";
		sep.style.margin = "1rem 0";
		container.appendChild(sep);
	} // End User Content

	// --- Predefined Section ---
	const predefinedHeader = document.createElement("div");
	predefinedHeader.className = "settings-group-title";
	predefinedHeader.style.gridColumn = "1 / -1";
	predefinedHeader.textContent = "Predefined Wallpapers";
	container.appendChild(predefinedHeader);

	// 1. Random (Predefined)
	// Default collection is often undefined or 'predefined'
	const isPredefRandom =
		settings.wallpaper.collection !== "user" &&
		settings.wallpaper.mode === "random";
	const randomTile = createOptionTile(
		"Random",
		"assets/svgs-fontawesome/solid/shuffle.svg",
		isPredefRandom,
	);
	randomTile.addEventListener("click", () => {
		container
			.querySelectorAll(".active")
			.forEach((e) => e.classList.remove("active"));
		randomTile.classList.add("active");

		settings.wallpaper.collection = "predefined";
		settings.wallpaper.mode = "random";
		settings.wallpaper.specific = null;
		syncTypeBucket(settings);
		saveSettings(settings);
		refreshWallpaper(settings);
	});
	container.appendChild(randomTile);

	// 2. Sequence (Predefined)
	const isPredefSeq =
		settings.wallpaper.collection !== "user" &&
		settings.wallpaper.mode === "sequence";
	const sequenceTile = createOptionTile(
		"Sequence",
		"assets/svgs-fontawesome/solid/list-ol.svg",
		isPredefSeq,
	);
	sequenceTile.addEventListener("click", () => {
		container
			.querySelectorAll(".active")
			.forEach((e) => e.classList.remove("active"));
		sequenceTile.classList.add("active");

		settings.wallpaper.collection = "predefined";
		settings.wallpaper.mode = "sequence";
		settings.wallpaper.specific = null;
		syncTypeBucket(settings);
		saveSettings(settings);
		// refreshWallpaper might not be needed for sequence if it just continues?
		// But safer to call it to sync state if we were on specific.
		refreshWallpaper(settings);
	});
	container.appendChild(sequenceTile);

	// 3. Thumbnails (Don't render if Mono)
	if (settings.wallpaper.type === "mono") {
		const monoNote = document.createElement("div");
		monoNote.className = "setting-desc";
		monoNote.style.gridColumn = "1/-1";
		monoNote.style.textAlign = "center";
		monoNote.style.padding = "2rem";
		monoNote.textContent =
			"Mono mode selected. Background set to solid color.";
		container.appendChild(monoNote);
		return;
	}

	const type = settings.wallpaper.type === "img" ? "images" : "videos";

	// Fetch manifest
	let manifest = await new Promise((resolve) => {
		chrome.storage.local.get("wallpaperDB", (res) =>
			resolve(res?.wallpaperDB || null),
		);
	});

	if (!manifest || !manifest[type]) return;

	let list = manifest[type];

	// First image/video are downloaded on install and are the app's fallback
	// wallpapers. They are never deleted: no tile trash button (badge instead)
	// and "Delete All" always keeps the current type's default.
	const storedDefaults = await readDefaultMediaIds();
	const catalogDefaults = {
		img: manifest.images?.[0]?.id || null,
		video: manifest.videos?.[0]?.id || null,
	};
	const defaultType = type === "images" ? "img" : "video";
	const storedDefault = storedDefaults?.[defaultType] || null;
	// A stored id that is no longer in the catalog (mid-sync) must not disable
	// protection for the current first entry.
	const defaultId =
		(storedDefault && list.some((i) => i.id === storedDefault) ?
			storedDefault
		:	null) ||
		catalogDefaults[defaultType] ||
		null;

	// Get existing media keys
	const allKeys = (await getAllMediaKeys()) || [];
	const downloadedSet = new Set(
		allKeys
			.filter((k) => k.endsWith("::media"))
			.map((k) => k.split("::")[0]),
	);

	// Download All button - only downloads current type (images OR videos)
	const downloadableCount = list.filter(
		(i) => !downloadedSet.has(i.id),
	).length;

	if (downloadableCount > 0) {
		const dlBtn = document.createElement("button");
		dlBtn.className = "btn btn-icon-text action-btn download-all";
		dlBtn.innerHTML = `<span></span><span class="text">All</span>`;
		renderInlineIcon(
			dlBtn.querySelector("span:first-child"),
			"assets/svgs-fontawesome/solid/download.svg",
		);
		dlBtn.onclick = async () => {
			dlBtn.disabled = true;
			dlBtn.innerHTML = `<span></span> Downloading...`;
			renderInlineIcon(
				dlBtn.querySelector("span"),
				"assets/svgs-fontawesome/solid/spinner.svg",
			);
			dlBtn.querySelector("span").classList.add("animate-spin");

			// Only download items from the current type's list
			const toDownload = list.filter((i) => !downloadedSet.has(i.id));

			// Visual cue: add loading spinners to pending items
			toDownload.forEach((item) => {
				const t = container.querySelector(
					`.wallpaper-tile[data-id="${item.id}"] .download-overlay`,
				);
				if (t) t.classList.add("loading");
			});

			for (const item of toDownload) {
				// URL encode the asset paths to handle special characters
				const encodedAssetUrl = resolveAssetUrl(item.asset);
				const encodedThumbUrl = resolveAssetUrl(item.thumb);

				await downloadAndStoreResource({
					url: encodedAssetUrl,
					assetPath: item.id,
					kind: "media",
					manifestEntry: item,
				});
				await downloadAndStoreResource({
					url: encodedThumbUrl,
					assetPath: item.id,
					kind: "thumb",
					manifestEntry: item,
				});

				// Incremental UI Update
				const oldTile = container.querySelector(
					`.wallpaper-tile[data-id="${item.id}"]`,
				);
				if (oldTile) oldTile.remove();

				const newTile = await createWallpaperTile(
					item,
					true,
					false,
					smartHandlers,
					false,
					item.id === defaultId,
				);
				insertSorted(container, newTile, item.id, list, true);
				clearMediaKeysCache(); // Clear cache so the new wallpaper is recognized as downloaded immediately
			}

			// Final refresh to update Action Buttons (Delete All / Hide Download All)
			renderWallpaperGrid(container, settings);
		};
		actionsContainer.appendChild(dlBtn);
	}

	// Delete All button - only deletes the current type and does NOT touch user
	// uploads. The product default for this type is always kept.
	const deletableCount = list.filter(
		(i) => downloadedSet.has(i.id) && i.id !== defaultId,
	).length;

	if (deletableCount >= 1) {
		const delBtn = document.createElement("button");
		delBtn.className = "btn btn-icon-text action-btn delete-all";
		delBtn.innerHTML = `<span></span><span class="text">All</span>`;
		renderInlineIcon(
			delBtn.querySelector("span:first-child"),
			"assets/svgs-fontawesome/solid/trash.svg",
		);
		delBtn.onclick = () => {
			const typeLabelLower = currentType === "img" ? "image" : "video";
			showConfirmation(
				`Delete all downloaded ${typeLabelLower} wallpapers? Your default ${typeLabelLower} wallpaper will be kept.`,
				async () => {
					try {
						// Get the IDs of all items in the current type's list
						const currentTypeIds = new Set(
							list.map((item) => item.id),
						);

						// Keep the product default, plus one downloaded fallback
						// for profiles where the default download failed.
						const fallbackId =
							downloadedSet.has(defaultId) ?
								defaultId
							:	list.find((item) =>
									downloadedSet.has(item.id),
								)?.id ||
								defaultId ||
								null;

						const allKeys = (await getAllMediaKeys()) || [];

						const mediaKeysToDelete = allKeys.filter((k) => {
							if (!k.endsWith("::media")) return false;
							const id = k.split("::")[0];
							// Only delete if it's from the current type's list
							if (!currentTypeIds.has(id)) return false;
							// Defaults are never deleted
							if (id === defaultId) return false;
							// Don't delete the protected fallback
							if (id === fallbackId) return false;
							return true;
						});

						// Only delete media files, NOT thumbnails
						await Promise.all(
							mediaKeysToDelete.map((k) => deleteMediaEntry(k)),
						);

						// Set wallpaper to the fallback
						if (fallbackId) {
							settings.wallpaper.collection = "predefined";
							settings.wallpaper.mode = "specific";
							settings.wallpaper.specific = fallbackId;
							await saveSettings(settings);
							await refreshWallpaper(settings);
						}

						renderWallpaperGrid(container, settings);
						clearMediaKeysCache();
					} catch (e) {
						console.error("Delete All failed:", e);
					}
				},
			);
		};
		actionsContainer.appendChild(delBtn);
	}

	// Sort for initial render: Downloaded first, then Original Order
	const renderList = [...list];
	renderList.sort((a, b) => {
		const aDown = downloadedSet.has(a.id);
		const bDown = downloadedSet.has(b.id);
		if (aDown && !bDown) return -1;
		if (!aDown && bDown) return 1;
		return list.indexOf(a) - list.indexOf(b);
	});

	// Smart Handlers for Optimistic UI Updates
	const smartHandlers = {
		onSelect: (id) => {
			// Toggle active class only
			container
				.querySelectorAll(".option-tile")
				.forEach((t) => t.classList.remove("active"));
			container
				.querySelectorAll(".wallpaper-tile")
				.forEach((t) =>
					t.classList.toggle("active", t.dataset.id === id),
				);
			settings.wallpaper.collection = "predefined";
			settings.wallpaper.mode = "specific";
			settings.wallpaper.specific = id;
			syncTypeBucket(settings);
			saveSettings(settings);
			const scroller = container.closest(".settings-content");
			const scrollTop = scroller ? scroller.scrollTop : 0;
			refreshWallpaper(settings).then(() =>
				keepScrollPosition(scroller, scrollTop),
			);
		},
		onDelete: (tile, item) => {
			if (item.id === defaultId) {
				showAlert(
					"This is a default wallpaper. It is kept as a fallback and can't be deleted.",
					"Default wallpaper",
				);
				return;
			}
			showConfirmation("Delete this wallpaper?", async () => {
				await deleteMediaEntry(`${item.id}::media`);
				clearMediaKeysCache();
				// DOM Update
				tile.remove();
				// Re-insert as Available (Not Downloaded)
				const newTile = await createWallpaperTile(
					item,
					false,
					false,
					smartHandlers,
					false,
					item.id === defaultId,
				);
				insertSorted(container, newTile, item.id, list, false);
			});
		},
		onDownload: async (tile, item) => {
			const overlay = tile.querySelector(".download-overlay");
			if (overlay) overlay.classList.add("loading");

			await downloadAndStoreResource({
				url: resolveAssetUrl(item.asset),
				assetPath: item.id,
				kind: "media",
				manifestEntry: item,
			});
			// Thumb too
			await downloadAndStoreResource({
				url: resolveAssetUrl(item.thumb),
				assetPath: item.id,
				kind: "thumb",
				manifestEntry: item,
			});

			// DOM Update
			tile.remove();
			// Re-insert as Downloaded (Active)
			const newTile = await createWallpaperTile(
				item,
				true,
				true,
				smartHandlers,
				false,
				item.id === defaultId,
			);
			insertSorted(container, newTile, item.id, list, true);

			// Auto-select downloaded item
			settings.wallpaper.collection = "predefined";
			settings.wallpaper.mode = "specific";
			settings.wallpaper.specific = item.id;
			syncTypeBucket(settings); // Sync to type bucket
			saveSettings(settings);
			clearMediaKeysCache();
			refreshWallpaper(settings);

			// Update active state in UI
			container
				.querySelectorAll(".option-tile")
				.forEach((t) => t.classList.remove("active"));
			container
				.querySelectorAll(".wallpaper-tile")
				.forEach((t) => t.classList.remove("active"));
			newTile.classList.add("active");
		},
	};

	for (const item of renderList) {
		const isDownloaded = downloadedSet.has(item.id);
		const isActive =
			settings.wallpaper.collection !== "user" &&
			settings.wallpaper.mode === "specific" &&
			settings.wallpaper.specific === item.id;

		const tile = await createWallpaperTile(
			item,
			isDownloaded,
			isActive,
			smartHandlers,
			forceReload,
			item.id === defaultId,
		);
		container.appendChild(tile);
	}

	// Restore Scroll & remove min-height
	container.style.minHeight = "";
	if (scrollParent) {
		scrollParent.scrollTop = savedScroll;
	}
}

// Helper: Unified Thumbnail Generation
async function generateThumbnail(file) {
	if (!file) return null;
	const isVideo = file.type.startsWith("video");
	const isImage = file.type.startsWith("image");
	if (!isVideo && !isImage) return null;

	return new Promise((resolve) => {
		const fileUrl = URL.createObjectURL(file);
		const MAX_DIM = 320;
		const timer = setTimeout(() => {
			try {
				URL.revokeObjectURL(fileUrl);
			} catch (e) {}
			resolve(null);
		}, 30000);

		const processCanvas = (source, w, h) => {
			let width = w;
			let height = h;

			// Scaling logic: Fit within MAX_DIM x MAX_DIM aspect ratio preserved
			if (width > MAX_DIM || height > MAX_DIM) {
				const ratio = width / height;
				if (width > height) {
					width = MAX_DIM;
					height = width / ratio;
				} else {
					height = MAX_DIM;
					width = height * ratio;
				}
			}

			const canvas = document.createElement("canvas");
			canvas.width = width;
			canvas.height = height;
			const ctx = canvas.getContext("2d");
			ctx.drawImage(source, 0, 0, width, height);

			// Aggressive Cleanup: If video, clear src to release buffer immediately
			if (source.tagName === "VIDEO") {
				source.removeAttribute("src");
				source.load();
			}

			canvas.toBlob(
				(blob) => {
					clearTimeout(timer);
					URL.revokeObjectURL(fileUrl);
					resolve(blob);
				},
				"image/jpeg",
				0.8,
			);
		};

		if (isVideo) {
			const video = document.createElement("video");
			video.preload = "metadata";
			video.muted = true;
			video.playsInline = true;
			video.src = fileUrl;
			video.onloadedmetadata = () => {
				let time = 1.0;
				if (video.duration && isFinite(video.duration)) {
					time = video.duration / 2;
				}
				video.currentTime = time;
			};
			// Robust seek handling: if 1.0 is > duration, it might fail or clamp.
			// Usually 1.0 is safe for wallpapers. If fail, seek 0.
			video.onseeked = () =>
				processCanvas(video, video.videoWidth, video.videoHeight);
			video.onerror = () => {
				clearTimeout(timer);
				URL.revokeObjectURL(fileUrl);
				resolve(null);
			};
		} else {
			const img = new Image();
			img.onload = () =>
				processCanvas(img, img.naturalWidth, img.naturalHeight);
			img.onerror = () => {
				clearTimeout(timer);
				URL.revokeObjectURL(fileUrl);
				resolve(null);
			};
			img.src = fileUrl;
		}
	});
}

// Helper: Create Wallpaper Tile (Isolated for reuse)
async function createWallpaperTile(
	item,
	isDownloaded,
	isActive,
	handlers,
	forceReload = false,
	isDefault = false,
) {
	const tile = document.createElement("div");
	tile.className = `wallpaper-tile ${isActive ? "active" : ""}`;
	tile.dataset.id = item.id;
	if (isDownloaded) tile.dataset.downloaded = "true";
	if (isDefault) tile.dataset.default = "true";

	// Thumbnail logic
	let thumbUrl = null;
	try {
		const thumbKey = `${item.id}::thumb`;
		const entry = await getMediaEntry(thumbKey);
		if (entry && entry.blob) {
			thumbUrl = URL.createObjectURL(entry.blob);
			gridObjectUrls.push(thumbUrl);
		}
	} catch (e) {}

	if (!thumbUrl && item.thumb) {
		thumbUrl = resolveAssetUrl(item.thumb);
		if (forceReload && thumbUrl.startsWith("http")) {
			const sep = thumbUrl.includes("?") ? "&" : "?";
			thumbUrl += `${sep}t=${Date.now()}`;
		}
	}

	if (thumbUrl) {
		const img = document.createElement("img");
		img.src = thumbUrl;
		img.loading = "lazy";
		tile.appendChild(img);
	} else {
		const placeholder = document.createElement("div");
		placeholder.className = "tile-placeholder";
		placeholder.textContent = item.id;
		tile.appendChild(placeholder);
	}

	// Default badge: defaults are auto-downloaded on install and never deleted.
	if (isDefault) {
		const badge = document.createElement("span");
		badge.className = "tile-default-badge";
		badge.textContent = "Default";
		badge.title =
			"Default wallpaper — downloaded automatically and can't be deleted";
		tile.appendChild(badge);
	}

	// Delete Overlay (not for defaults)
	if (isDownloaded && !isDefault) {
		const delOverlay = document.createElement("button");
		delOverlay.className = "btn btn-icon btn-small delete-overlay";
		delOverlay.title = "Delete Download";
		// Direct icon render, no wrapper span needed for btn-icon
		renderInlineIcon(delOverlay, "assets/svgs-fontawesome/solid/trash.svg");
		delOverlay.onclick = (e) => {
			e.stopPropagation();
			if (handlers.onDelete) handlers.onDelete(tile, item);
		};
		tile.appendChild(delOverlay);
	}

	// Download Overlay
	if (!isDownloaded) {
		const dlOverlay = document.createElement("button");
		dlOverlay.className = "btn btn-icon btn-small download-overlay";
		renderInlineIcon(
			dlOverlay,
			"assets/svgs-fontawesome/solid/download.svg",
		);
		tile.appendChild(dlOverlay); // Fixed structure
	}

	// Click Handler used for both Select and Download trigger
	tile.addEventListener("click", (e) => {
		if (e.target.closest(".delete-overlay")) return;

		if (isDownloaded) {
			if (handlers.onSelect) handlers.onSelect(item.id);
		} else {
			if (handlers.onDownload) handlers.onDownload(tile, item);
		}
	});

	return tile;
}

// Helper: Insert Tile Sorted (Smart Insert)
function insertSorted(container, tile, itemId, fullList, isDownloaded) {
	const tiles = [...container.querySelectorAll(".wallpaper-tile")];
	const orderMap = new Map(fullList.map((item, index) => [item.id, index]));

	// Sort Value: Downloaded (0) vs Available (100000) + Index
	const getSortVal = (id, down) => {
		const base = down ? 0 : 100000;
		return base + (orderMap.get(id) || 0);
	};

	const targetVal = getSortVal(itemId, isDownloaded);

	let nextTile = null;
	for (const t of tiles) {
		const tId = t.dataset.id;
		const tDown = t.dataset.downloaded === "true";
		const tVal = getSortVal(tId, tDown);
		if (tVal > targetVal) {
			nextTile = t;
			break;
		}
	}

	if (nextTile) {
		container.insertBefore(tile, nextTile);
	} else {
		container.appendChild(tile);
	}
}

function createOptionTile(label, iconPath, isActive) {
	const tile = document.createElement("div");
	tile.className = `option-tile ${isActive ? "active" : ""}`;
	tile.dataset.mode = label.toLowerCase();

	const icon = document.createElement("span");
	// icon.className = "option-icon"; // Removed
	renderInlineIcon(icon, iconPath);

	const text = document.createElement("span");
	text.textContent = label;

	tile.appendChild(icon);
	tile.appendChild(text);
	return tile;
}

function updateGridActiveState(container, mode, specificId = null) {
	// Clear all active
	container
		.querySelectorAll(".active")
		.forEach((el) => el.classList.remove("active"));

	if (mode === "random") {
		const el = container.querySelector('.option-tile[data-mode="random"]');
		if (el) el.classList.add("active");
	} else if (mode === "sequence") {
		const el = container.querySelector(
			'.option-tile[data-mode="sequence"]',
		);
		if (el) el.classList.add("active");
	} else if (mode === "specific" && specificId) {
		const el = container.querySelector(
			`.wallpaper-tile[data-id="${specificId}"]`,
		);
		if (el) el.classList.add("active");
	}
}

// Custom Confirmation Modal
function showConfirmation(message, onConfirm) {
	const overlay = document.createElement("div");
	overlay.className = "confirm-overlay";

	const modal = document.createElement("div");
	modal.className = "confirm-modal";
	modal.tabIndex = -1;
	modal.setAttribute("role", "alertdialog");
	modal.setAttribute("aria-modal", "true");
	const messageId = `settings-confirm-${++_settingControlSeq}`;
	modal.setAttribute("aria-labelledby", messageId);

	let a11yCleanup = null;
	const close = () => {
		if (a11yCleanup) {
			a11yCleanup();
			a11yCleanup = null;
		}
		try {
			overlay.remove();
		} catch (e) {}
	};

	const msg = document.createElement("p");
	msg.className = "confirm-message";
	msg.id = messageId;
	msg.textContent = message;

	const buttons = document.createElement("div");
	buttons.className = "confirm-buttons";

	const cancelBtn = document.createElement("button");
	cancelBtn.className = "btn btn-text confirm-btn cancel";
	cancelBtn.textContent = "Cancel";
	cancelBtn.onclick = close;

	const okBtn = document.createElement("button");
	okBtn.className = "btn btn-text primary confirm-btn confirm";
	okBtn.textContent = "Confirm";
	okBtn.onclick = () => {
		close();
		onConfirm();
	};

	buttons.appendChild(cancelBtn);
	buttons.appendChild(okBtn);

	modal.appendChild(msg);
	modal.appendChild(buttons);
	overlay.appendChild(modal);

	document.body.appendChild(overlay);
	a11yCleanup = setupModalA11y(modal, { onClose: close });
}

// --- Shortcuts List Helper ---

function renderShortcutsList(container, settings) {
	const wrapper = document.createElement("div");
	wrapper.className = "shortcuts-management-wrapper";
	wrapper.id = "shortcuts-management-section";

	// Header with Add Button
	const header = document.createElement("div");
	header.className = "shortcuts-list-header";
	header.style.display = "flex";
	header.style.justifyContent = "space-between";
	header.style.alignItems = "center";

	const title = document.createElement("div");
	title.className = "setting-label";
	title.textContent = "Manage Shortcuts";
	header.appendChild(title);

	const addBtn = document.createElement("button");
	addBtn.className = "btn btn-icon-text";
	addBtn.innerHTML = `<span></span><span class="text">Add New</span>`;
	renderInlineIcon(
		addBtn.querySelector("span:first-child"),
		"assets/svgs-fontawesome/solid/plus.svg",
	);
	addBtn.onclick = () => {
		openShortcutModal(null, async (newShortcut) => {
			if (!settings.actionbar) settings.actionbar = {};
			if (!settings.actionbar.shortcuts)
				settings.actionbar.shortcuts = {};
			if (!settings.actionbar.shortcuts.items)
				settings.actionbar.shortcuts.items = [];

			settings.actionbar.shortcuts.items.push(newShortcut);
			await saveSettings(settings);
			initActionBar(settings.actionbar, settings);
			// Re-render list
			renderShortcutsList(container, settings);
		});
	};
	header.appendChild(addBtn);
	wrapper.appendChild(header);

	// List Container
	const listContainer = document.createElement("div");
	listContainer.className = "shortcuts-list";

	const refreshList = () => {
		listContainer.innerHTML = "";

		// Combine defaults (if enabled?) - Actually, requirements say "list displaying all shortcuts (including default...)".
		// Usually defaults are immutable.
		// Let's assume defaults are always shown? Or configurable?
		// Previously we had 'configured' array in actionbar.js which merged default + user.
		// Let's replicate that logic.
		const userItems = settings.actionbar?.shortcuts?.items || [];
		const allItems = [...DEFAULT_SHORTCUTS, ...userItems];

		if (allItems.length === 0) {
			listContainer.innerHTML =
				'<div class="setting-desc">No shortcuts added.</div>';
			return;
		}

		allItems.forEach((item, index) => {
			const isUser = !item.builtin; // or check if it's in userItems

			const itemRow = document.createElement("div");
			itemRow.className = "shortcut-list-item"; // Add CSS for this

			// Icon
			const icon = document.createElement("div");
			icon.className = "btn btn-icon shortcut-list-icon";

			const iconSrc =
				item.icon || "assets/svgs-fontawesome/solid/globe.svg";
			const iconEl = document.createElement("span");
			renderInlineIcon(iconEl, iconSrc);
			icon.appendChild(iconEl);

			// Text (textContent: titles/URLs are user-entered)
			const text = document.createElement("div");
			text.className = "shortcut-list-info";
			const titleEl = document.createElement("div");
			titleEl.className = "shortcut-title";
			titleEl.textContent = item.title || "";
			const urlEl = document.createElement("div");
			urlEl.className = "shortcut-url";
			urlEl.textContent = item.url || "";
			text.append(titleEl, urlEl);

			itemRow.appendChild(icon);
			itemRow.appendChild(text);

			// Actions
			if (isUser) {
				const actions = document.createElement("div");
				actions.className = "shortcut-list-actions";

				// Edit
				const editBtn = document.createElement("button");
				editBtn.className = "btn btn-icon";
				/* ... */
				editBtn.title = "Edit";
				editBtn.innerHTML = "<span></span>";
				renderInlineIcon(
					editBtn.querySelector("span"),
					"assets/svgs-fontawesome/solid/pen.svg",
				);
				editBtn.onclick = () => {
					openShortcutModal(item, async (updatedItem) => {
						// Find index in userItems
						// Since 'item' is referentially same? No, from settings.
						// We need robust find.
						const userIndex =
							settings.actionbar.shortcuts.items.indexOf(item);
						if (userIndex !== -1) {
							settings.actionbar.shortcuts.items[userIndex] =
								updatedItem;
							await saveSettings(settings);
							initActionBar(settings.actionbar, settings);
							refreshList(); // Update UI
						}
					});
				};

				// Delete
				const delBtn = document.createElement("button");
				delBtn.className = "btn btn-icon";
				delBtn.title = "Delete";
				delBtn.innerHTML = "<span></span>";
				renderInlineIcon(
					delBtn.querySelector("span"),
					"assets/svgs-fontawesome/solid/trash.svg",
				);
				delBtn.onclick = () => {
					showConfirmation(
						`Delete shortcut "${item.title}"?`,
						async () => {
							const userIndex =
								settings.actionbar.shortcuts.items.indexOf(
									item,
								);
							if (userIndex !== -1) {
								settings.actionbar.shortcuts.items.splice(
									userIndex,
									1,
								);
								await saveSettings(settings);
								initActionBar(settings.actionbar, settings);
								refreshList();
							}
						},
					);
				};

				actions.appendChild(editBtn);
				actions.appendChild(delBtn);
				itemRow.appendChild(actions);
			} else {
				// Built-in Badge
				const badge = document.createElement("div");
				badge.className = "btn btn-text btn-display";
				badge.textContent = "Default";
				itemRow.appendChild(badge);
			}

			listContainer.appendChild(itemRow);
		});
	};

	// Initial Render
	refreshList();

	wrapper.appendChild(listContainer);

	// Check if container already has this wrapper
	const existing = container.querySelector(".shortcuts-management-wrapper");
	if (existing) existing.remove();

	container.appendChild(wrapper);
}

// --- Zen Mode settings ---

// Product limits for personal focus music. Blobs live in IndexedDB, which the
// extension can use without a quota (unlimitedStorage permission).
const ZEN_AUDIO_LIMITS = { maxBytes: 40 * 1024 * 1024, maxCount: 50 };
let _zenTracksRenderSeq = 0;

function formatZenBytes(bytes) {
	if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
	const units = ["B", "KB", "MB", "GB"];
	const i = Math.min(
		units.length - 1,
		Math.floor(Math.log(bytes) / Math.log(1024)),
	);
	return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${
		units[i]
	}`;
}

function isAudioFile(file) {
	if (file.type && file.type.startsWith("audio/")) return true;
	return /\.(mp3|m4a|m4b|aac|ogg|oga|opus|wav|flac|weba|webm)$/i.test(
		file.name || "",
	);
}

function renderZenSettings(container, settings) {
	if (!settings.zen) settings.zen = { musicMode: "loop" };
	const musicMode = ["loop", "repeat-one", "shuffle"].includes(
		settings.zen.musicMode,
	) ?
		settings.zen.musicMode
	:	"loop";
	const musicSource = ["uploaded", "builtin"].includes(
		settings.zen.musicSource,
	) ?
		settings.zen.musicSource
	:	"uploaded";

	// Playback behaviour for uploaded tracks.
	const playbackGroup = document.createElement("div");
	playbackGroup.className = "settings-group";

	const playbackHeader = document.createElement("div");
	playbackHeader.className = "settings-group-header";
	const playbackTitle = document.createElement("div");
	playbackTitle.className = "settings-group-title";
	playbackTitle.textContent = "Playback";
	playbackHeader.appendChild(playbackTitle);
	playbackGroup.appendChild(playbackHeader);

	addSelect(
		playbackGroup,
		"Music Source",
		"Choose between your uploaded tracks and the bundled piano ambience.",
		[
			{ value: "uploaded", label: "My uploaded tracks" },
			{ value: "builtin", label: "Built-in ambience" },
		],
		musicSource,
		(val) => {
			settings.zen.musicSource = val;
			saveSettings(settings);
			setZenMusicSource(val);
		},
	);

	addSelect(
		playbackGroup,
		"Music Playback",
		"How uploaded tracks advance. The built-in ambience always loops.",
		[
			{ value: "loop", label: "Loop playlist (default)" },
			{ value: "repeat-one", label: "Repeat one track" },
			{ value: "shuffle", label: "Shuffle" },
		],
		musicMode,
		(val) => {
			settings.zen.musicMode = val;
			saveSettings(settings);
			setZenMusicMode(val);
		},
	);
	container.appendChild(playbackGroup);

	// Personal music library.
	const musicGroup = document.createElement("div");
	musicGroup.className = "settings-group";

	const musicHeader = document.createElement("div");
	musicHeader.className = "settings-group-header";
	const musicTitle = document.createElement("div");
	musicTitle.className = "settings-group-title";
	musicTitle.textContent = "Music Library";
	musicHeader.appendChild(musicTitle);
	musicGroup.appendChild(musicHeader);

	const uploadRow = document.createElement("div");
	uploadRow.className = "setting-row";
	const uploadInfo = document.createElement("div");
	uploadInfo.className = "setting-info";
	uploadInfo.innerHTML = `<div class="setting-label">Personal tracks</div><div class="setting-desc">Play your own music during focus sessions instead of the built-in ambience. ${ZEN_AUDIO_LIMITS.maxCount} files max, ${Math.round(
		ZEN_AUDIO_LIMITS.maxBytes / (1024 * 1024),
	)} MB each.</div>`;

	const uploadControl = document.createElement("div");
	uploadControl.className = "setting-control";

	const uploadBtn = document.createElement("button");
	uploadBtn.className = "btn btn-icon-text";
	uploadBtn.innerHTML = `<span></span><span class="text">Upload</span>`;
	renderInlineIcon(
		uploadBtn.querySelector("span:first-child"),
		"assets/svgs-fontawesome/solid/upload.svg",
	);

	const fileInput = document.createElement("input");
	fileInput.type = "file";
	fileInput.accept = "audio/*,.mp3,.m4a,.aac,.ogg,.oga,.opus,.wav,.flac";
	fileInput.multiple = true;
	fileInput.style.display = "none";

	uploadBtn.onclick = () => fileInput.click();
	uploadControl.appendChild(uploadBtn);
	uploadControl.appendChild(fileInput);
	uploadRow.appendChild(uploadInfo);
	uploadRow.appendChild(uploadControl);
	musicGroup.appendChild(uploadRow);

	const listContainer = document.createElement("div");
	listContainer.className = "zen-track-list";
	musicGroup.appendChild(listContainer);
	container.appendChild(musicGroup);

	const renderList = async () => {
		const seq = ++_zenTracksRenderSeq;
		let tracks = [];
		try {
			tracks = await getZenTrackList();
		} catch (e) {
			tracks = [];
		}
		if (seq !== _zenTracksRenderSeq || !listContainer.isConnected) return;
		listContainer.innerHTML = "";

		// The bundled ambience is always part of the list, whether or not the
		// user has uploaded personal tracks.
		const builtin = document.createElement("div");
		builtin.className = "zen-track-item zen-track-builtin";
		const builtinIcon = document.createElement("div");
		builtinIcon.className = "zen-track-icon";
		const builtinIconEl = document.createElement("span");
		renderInlineIcon(
			builtinIconEl,
			"assets/svgs-fontawesome/solid/headphones.svg",
		);
		builtinIcon.appendChild(builtinIconEl);
		const builtinInfo = document.createElement("div");
		builtinInfo.className = "zen-track-info";
		const builtinName = document.createElement("div");
		builtinName.className = "zen-track-name";
		builtinName.textContent = "Built-in ambience";
		const builtinMeta = document.createElement("div");
		builtinMeta.className = "zen-track-meta";
		builtinMeta.textContent = "Default piano loop · always available";
		builtinInfo.appendChild(builtinName);
		builtinInfo.appendChild(builtinMeta);
		const builtinBadge = document.createElement("span");
		builtinBadge.className = "zen-track-badge";
		builtinBadge.textContent = "Built-in";
		builtin.appendChild(builtinIcon);
		builtin.appendChild(builtinInfo);
		builtin.appendChild(builtinBadge);
		listContainer.appendChild(builtin);

		if (tracks.length === 0) {
			const empty = document.createElement("div");
			empty.className = "zen-empty-note";
			empty.textContent =
				"No personal tracks yet — upload files to hear your own music in Zen mode.";
			listContainer.appendChild(empty);
			return;
		}

		tracks.forEach((track) => {
			const item = document.createElement("div");
			item.className = "zen-track-item";

			const icon = document.createElement("div");
			icon.className = "zen-track-icon";
			const iconEl = document.createElement("span");
			renderInlineIcon(
				iconEl,
				"assets/svgs-fontawesome/solid/music.svg",
			);
			icon.appendChild(iconEl);

			const info = document.createElement("div");
			info.className = "zen-track-info";
			const nameEl = document.createElement("div");
			nameEl.className = "zen-track-name";
			nameEl.textContent = track.name;
			nameEl.title = track.name;
			const metaEl = document.createElement("div");
			metaEl.className = "zen-track-meta";
			metaEl.textContent = formatZenBytes(track.size);
			info.appendChild(nameEl);
			info.appendChild(metaEl);

			const delBtn = document.createElement("button");
			delBtn.className = "btn btn-icon zen-track-delete";
			delBtn.title = "Remove track";
			delBtn.setAttribute(
				"aria-label",
				`Remove ${track.name} from Zen music`,
			);
			delBtn.innerHTML = "<span></span>";
			renderInlineIcon(
				delBtn.querySelector("span"),
				"assets/svgs-fontawesome/solid/trash.svg",
			);
			delBtn.onclick = () => {
				showConfirmation(
					`Remove "${track.name}" from Zen music?`,
					async () => {
						await deleteZenTrack(track.id);
						await renderList();
						refreshZenMusic();
					},
				);
			};

			item.appendChild(icon);
			item.appendChild(info);
			item.appendChild(delBtn);
			listContainer.appendChild(item);
		});
	};

	fileInput.onchange = async () => {
		const files = [...(fileInput.files || [])];
		fileInput.value = "";
		if (files.length === 0) return;

		const originalHtml = uploadBtn.innerHTML;
		uploadBtn.disabled = true;
		uploadBtn.innerHTML = `<span></span> Adding...`;
		renderInlineIcon(
			uploadBtn.querySelector("span"),
			"assets/svgs-fontawesome/solid/spinner.svg",
		);
		uploadBtn.querySelector("span")?.classList.add("animate-spin");

		let added = 0;
		let skipped = 0;
		let overLimit = 0;
		try {
			const existing = await getZenTrackList();
			let remaining = Math.max(
				0,
				ZEN_AUDIO_LIMITS.maxCount - existing.length,
			);
			for (const file of files) {
				if (!isAudioFile(file) || file.size > ZEN_AUDIO_LIMITS.maxBytes) {
					skipped++;
					continue;
				}
				if (remaining <= 0) {
					overLimit++;
					continue;
				}
				const id = await saveZenTrack(file, file.name);
				if (id) {
					added++;
					remaining--;
				} else {
					skipped++;
				}
			}
		} finally {
			uploadBtn.disabled = false;
			uploadBtn.innerHTML = originalHtml;
			renderInlineIcon(
				uploadBtn.querySelector("span:first-child"),
				"assets/svgs-fontawesome/solid/upload.svg",
			);
		}

		await renderList();
		refreshZenMusic();

		if (skipped > 0 || overLimit > 0) {
			const parts = [`${added} track${added === 1 ? "" : "s"} added.`];
			if (skipped > 0)
				parts.push(
					`${skipped} file${skipped === 1 ? "" : "s"} skipped (unsupported or larger than ${Math.round(
						ZEN_AUDIO_LIMITS.maxBytes / (1024 * 1024),
					)} MB).`,
				);
			if (overLimit > 0)
				parts.push(
					`${overLimit} file${overLimit === 1 ? "" : "s"} not added: the ${ZEN_AUDIO_LIMITS.maxCount}-track limit was reached.`,
				);
			showAlert(parts.join(" "), "Zen music");
		}
	};

	renderList();
}
