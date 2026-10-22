import {
	STORAGE_KEY_DB,
	STORAGE_KEY_SETTINGS,
	STORAGE_KEY_WALLPAPER_ROTATION,
	DEFAULT_CONFIG,
	applyTheme,
	applyUiScale,
} from "./config.js";
import { renderInlineIcon } from "./brandIconLoader.js";
import { renderWallpaper } from "./wallpaper.js";
import { renderSearchbar, removeSearchbar } from "./searchbar.js";
import { initActionBar, updateMediaState } from "./actionbar.js";
import { initClock, updateClockSettings } from "./clockWidget.js";
import { toggleTabsRibbon, setTabsToggleElement } from "./tabsRibbon.js";
import { showAlert } from "./uiUtil.js";
import { installGlobalErrorLogging } from "./logger.js";

installGlobalErrorLogging("newtab-page");
import {
	toggleBookmarksPanel,
	setBookmarkToggleElement,
	hasBookmarksPermission,
	requestBookmarksPermission,
} from "./bookmarksPanel.js";
import { initNotesWidget } from "./notesWidget.js";
import { initStorageSync } from "./storageUtil.js";
import { initNotesSync } from "./notesSync.js";
import { initFilterPresetSync } from "./filterPresetSync.js";
import {
	onSettingsChanged,
	normalizeSettings,
	sameSettings,
} from "./settingsSync.js";

// --- Lazy-loaded modules (only fetched on first use) ---
let _timerModule = null;
let _alarmModule = null;
let _settingsModule = null;
let _toolsModule = null;
let _notesModule = null;

async function getTimerModule() {
	if (!_timerModule) _timerModule = await import("./timerModal.js");
	return _timerModule;
}
async function getAlarmModule() {
	if (!_alarmModule) _alarmModule = await import("./alarmModal.js");
	return _alarmModule;
}
async function getSettingsModule() {
	if (!_settingsModule) _settingsModule = await import("./settingsModal.js");
	return _settingsModule;
}
async function getToolsModule() {
	if (!_toolsModule) _toolsModule = await import("./toolsModal.js");
	return _toolsModule;
}
async function getNotesModule() {
	if (!_notesModule) _notesModule = await import("./notesModal.js");
	return _notesModule;
}

const app = chrome || browser;

// Shared slideshow cursor. Kept outside userSettings so advancing it never
// writes (or broadcasts) the settings object.
let wallpaperRotation = { last_id: null, persisted: false };

// Page state shared with the cross-tab listener. The listener is registered
// before initialization starts (a save from another tab during startup would
// otherwise be missed) and buffers the latest snapshot until the UI is ready.
let config = null;
let manifest = null;
let settingsUiReady = false;
let remoteApplyInFlight = false;
let bufferedRemoteSettings = null;

function queueRemoteConfig(next) {
	if (!next) return;
	if (!settingsUiReady || remoteApplyInFlight) {
		bufferedRemoteSettings = next; // latest full snapshot wins
		return;
	}
	remoteApplyInFlight = true;
	applyRemoteConfig(next)
		.catch(() => {})
		.finally(() => {
			remoteApplyInFlight = false;
			if (bufferedRemoteSettings && settingsUiReady) {
				const latest = bufferedRemoteSettings;
				bufferedRemoteSettings = null;
				queueRemoteConfig(latest);
			}
		});
}

/**
 * Apply a settings snapshot written by another tab, touching only the parts
 * that changed. The open settings modal refreshes its own controls through the
 * same storage event (see js/settingsModal.js).
 */
async function applyRemoteConfig(next) {
	const prev = config;
	config = next;
	const changed = (key) => !sameSettings(prev?.[key], next[key]);
	// Wallpaper rotation bookkeeping (last_id) is per-tab: ignore it so
	// another tab advancing its slideshow does not re-render ours.
	const wallpaperChanged = (() => {
		const withoutLastId = (cfg) => {
			if (!cfg || typeof cfg !== "object") return cfg;
			const { last_id, ...rest } = cfg;
			return rest;
		};
		return !sameSettings(
			withoutLastId(prev?.wallpaper),
			withoutLastId(next.wallpaper),
		);
	})();

	try {
		if (changed("theme")) applyTheme(next.theme);
		if (changed("font")) applyFontConfig(next.font || DEFAULT_CONFIG.font);
		if (changed("uiScale")) applyUiScale(next.uiScale);
		// actionbar.clock.format and actionbar.date are rendered by the big
		// on-screen clock too, so refresh it for action-bar changes as well.
		if (
			changed("onScreenClock") ||
			changed("greeting") ||
			changed("quotes") ||
			changed("actionbar")
		) {
			updateClockSettings(next);
		}
	} catch (e) {}

	try {
		if (changed("searchbar")) {
			if (next.searchbar && next.searchbar.enabled) {
				await renderSearchbar(next.searchbar);
			} else {
				removeSearchbar();
			}
		}
	} catch (e) {}

	try {
		if (changed("actionbar") || changed("shortcuts")) {
			// Flash-only edits can be applied live; don't tear down the bar
			// (which also stops intervals/camera) for them.
			const prevBar = prev?.actionbar || {};
			const nextBar = next.actionbar || {};
			const onlyFamCamFlash =
				!!prevBar.famcam &&
				!!nextBar.famcam &&
				sameSettings(prevBar.famcam.enabled, nextBar.famcam.enabled) &&
				sameSettings(prevBar.famcam.snapAction, nextBar.famcam.snapAction) &&
				!sameSettings(prevBar.famcam.flash, nextBar.famcam.flash) &&
				sameSettings(
					{ ...prevBar, famcam: undefined },
					{ ...nextBar, famcam: undefined },
				);

			if (
				onlyFamCamFlash &&
				typeof window.updateFamCamConfig === "function"
			) {
				window.updateFamCamConfig(nextBar.famcam);
			} else {
				await initActionBar(
					next.actionbar || DEFAULT_CONFIG.actionbar,
					next,
				);
			}
		}
	} catch (e) {}

	try {
		if (wallpaperChanged) {
			// Re-attach this tab's slideshow cursor (not stored in settings).
			const wallpaperCfg = {
				...(next.wallpaper || DEFAULT_CONFIG.wallpaper),
				last_id: wallpaperRotation.last_id,
			};
			const renderedId = await renderWallpaper(wallpaperCfg, manifest);
			if (renderedId) await setLastWallpaperId(renderedId);
		}
	} catch (e) {}
}

// Register immediately: saves that land while the page is still loading are
// buffered and replayed once initialization completes.
onSettingsChanged(queueRemoteConfig, { includeSelf: false });

// === NEW TAB INSTANCE REGISTRATION ===
// Register this tab so the service worker can manage wallpaper audio across instances
try {
    app.runtime.sendMessage({ type: "NEWTAB_REGISTER" }).catch(() => {});
} catch (e) {}

// Deregister when the tab is closing
window.addEventListener("pagehide", () => {
    try {
        app.runtime.sendMessage({ type: "NEWTAB_UNREGISTER" }).catch(() => {});
    } catch (e) {}
});

// UI size preference (Small / Normal / Large).
// The automatic per-screen scaling lives in CSS (fluid vmin root); this only
// carries the user's multiplier, so it must be applied on every settings change.
document.addEventListener("settings:uiScale", (e) => {
	applyUiScale(e.detail);
});

document.addEventListener("settings:clock", (e) => {
	// e.detail contains the full settings object or just the relevant parts.
	// Let's pass the full settings if available, or fetch them?
	// The settingsModal usually saves then dispatches.
	// Ideally we pass the new config.
	// For now assuming detail is the full config or we refetch.
	// Let's assume detail IS the config or we rely on the widget to have reference?
	// The widget exports updateClockSettings.
	if (e.detail) {
		updateClockSettings(e.detail);
	}
});

document.addEventListener("settings:greeting", (e) => {
	if (e.detail) {
		updateClockSettings(e.detail);
	}
});

async function getStoredConfig() {
	return new Promise((resolve) => {
		try {
			app.storage.local.get(STORAGE_KEY_SETTINGS, (res) => {
				try {
					if (app.runtime.lastError) {
						resolve(DEFAULT_CONFIG);
						return;
					}

					const stored = res?.[STORAGE_KEY_SETTINGS] ?? {};

					resolve(normalizeSettings(stored));
				} catch (e) {
					// console.error("Failed to parse stored config:", e);
					resolve(DEFAULT_CONFIG);
				}
			});
		} catch (e) {
			// console.error("Failed to call app.storage.local.get:", e);
			resolve(DEFAULT_CONFIG);
		}
	});
}

async function getWallpaperRotation(fallbackSettings) {
	const fallback = {
		last_id: fallbackSettings?.wallpaper?.last_id || null,
		persisted: false,
	};
	return new Promise((resolve) => {
		try {
			app.storage.local.get(STORAGE_KEY_WALLPAPER_ROTATION, (res) => {
				if (app.runtime.lastError) {
					resolve(fallback);
					return;
				}
				const stored = res?.[STORAGE_KEY_WALLPAPER_ROTATION];
				if (stored && typeof stored === "object" && stored.last_id) {
					resolve({ last_id: stored.last_id, persisted: true });
					return;
				}
				// Migration: older builds kept the cursor inside userSettings.
				resolve(fallback);
			});
		} catch (e) {
			resolve(fallback);
		}
	});
}

async function setLastWallpaperId(id) {
	if (!id) return;
	// Per-tab no-op guard; other tabs write their own cursor value.
	if (wallpaperRotation.persisted && wallpaperRotation.last_id === id) return;
	wallpaperRotation = { last_id: id, persisted: true };
	try {
		await new Promise((resolve) => {
			app.storage.local.set(
				{ [STORAGE_KEY_WALLPAPER_ROTATION]: { last_id: id } },
				() => {
					if (app.runtime.lastError) wallpaperRotation.persisted = false;
					resolve();
				},
			);
		});
	} catch (e) {
		wallpaperRotation.persisted = false;
		// console.warn('Failed to save last_id', e);
	}
}

async function getManifest() {
	return new Promise((resolve) => {
		try {
			app.storage.local.get(STORAGE_KEY_DB, (res) => {
				if (app.runtime.lastError) {
					// console.error(app.runtime.lastError.message);
					resolve(null);
					return;
				}
				resolve(
					res && res[STORAGE_KEY_DB] ? res[STORAGE_KEY_DB] : null,
				);
			});
		} catch (e) {
			// console.error("Failed to call app.storage.local.get for manifest:", e);
			resolve(null);
		}
	});
}

const FONT_LINK_ID = "themes-font-import";

function applyFontConfig(fontConfig) {
	if (!fontConfig) return;
	const { family, importUrl, weight } = fontConfig;
	// Reuse one stylesheet link; recreating it on every sync leaked a <link>
	// (and triggered a refetch) for each cross-tab font change.
	let link = document.getElementById(FONT_LINK_ID);
	if (importUrl) {
		if (!link) {
			link = document.createElement("link");
			link.id = FONT_LINK_ID;
			link.rel = "stylesheet";
			document.head.appendChild(link);
		}
		if (link.getAttribute("href") !== importUrl) {
			link.href = importUrl;
		}
	} else if (link) {
		link.remove();
	}
	if (family) {
		document.documentElement.style.setProperty("--font-family", family);
	}
	if (weight) {
		document.documentElement.style.setProperty(
			"--font-weight-base",
			weight,
		);
	}
}

async function closeAllOverlays() {
	// Only call close on modules that have been loaded (if not loaded, modal can't be open)
	if (
		_timerModule &&
		(await _timerModule.closeTimerModalIfOpen()) === false
	) {
		return false;
	}
	if (_alarmModule) _alarmModule.closeAlarmModalIfOpen();
	if (_settingsModule) _settingsModule.closeSettingsModalIfOpen();
	if (_toolsModule) _toolsModule.closeToolsModal();
	if (
		_notesModule &&
		(await _notesModule.closeNotesModal()) === false
	) {
		return false;
	}
	if (document.getElementById("bookmarks-panel")) toggleBookmarksPanel();
	if (document.getElementById("tabs-ribbon")) toggleTabsRibbon();
	const toolsRibbon = document.getElementById("tools-ribbon");
	if (toolsRibbon) {
		try {
			document.body.removeChild(toolsRibbon);
		} catch (e) {}
		const toolsCss = document.getElementById("tools-ribbon-css");
		if (toolsCss) {
			// Only unload if no floating tool panels remain
			if (!document.querySelector(".tool-float-widget")) toolsCss.remove();
		}
	}
	const widgetPanel = document.getElementById("tools-widget-panel");
	if (widgetPanel) {
		try {
			document.body.removeChild(widgetPanel);
		} catch (e) {}
	}
	const toolsToggle = document.getElementById("action-tools");
	if (toolsToggle) {
		toolsToggle.classList.remove("active");
		try {
			toolsToggle.setAttribute("aria-expanded", "false");
		} catch (e) {}
	}
	// Close floating tool panels? keep them, but update ribbon active states later
	return true;
}

(async () => {
	// One-time migration of legacy localStorage data (notes, alarms, laps,
	// tool floats) into chrome.storage.local, then hydrate the shared cache.
	try {
		await initStorageSync();
	} catch (e) {
		// Storage sync must never prevent the new-tab UI from rendering.
		console.warn("Storage migration failed:", e);
	}

	// Notes/checklists: local is authoritative; reconcile with chrome.storage.sync
	// in the background (a remote change dispatches notes-updated).
	initNotesSync().catch(() => {});

	// Custom wallpaper filter preset: mirrored to chrome.storage.sync the same
	// way (local settings stay authoritative).
	initFilterPresetSync().catch(() => {});

	try {
		config = (await getStoredConfig()) || DEFAULT_CONFIG;
	} catch (e) {
		console.warn("Could not load settings, using defaults:", e);
		config = DEFAULT_CONFIG;
	}

	// Slideshow cursor lives under its own key, not inside userSettings.
	wallpaperRotation = await getWallpaperRotation(config);
	if (config.wallpaper) config.wallpaper.last_id = wallpaperRotation.last_id;

	try {
			// UI size preference (multiplies the fluid root font-size)
			applyUiScale(config.uiScale);

			applyFontConfig(
				config && config.font ? config.font : DEFAULT_CONFIG.font,
			);
			applyTheme(config.theme);
	} catch (e) {
		// console.error('Failed to apply config', e);
	}

	try {
		manifest = await getManifest();
	} catch (e) {
		manifest = null;
	}

	initNotesWidget();
	// Load the alarm module at startup so its runtime listener is registered
	// before the service worker fires an alarm.
	getAlarmModule().catch(() => {});
		document.addEventListener("notes-open", async (e) => {
			const mod = await getNotesModule();
			mod.openNotesModal(e.detail || {});
		});
		// Restore persistent floating tools
		try {
			const toolsMod = await import("./toolsRibbon.js");
			toolsMod.restoreToolFloats();
		} catch (e) {}
	let renderedId = null;

	try {
		if (!manifest || !(manifest.images || manifest.videos)) {
			// console.warn("Manifest not found or is empty, using defaults.");
			renderedId = await renderWallpaper(
				config.wallpaper || DEFAULT_CONFIG.wallpaper,
				{},
			);
		} else {
			renderedId = await renderWallpaper(
				config.wallpaper || DEFAULT_CONFIG.wallpaper,
				manifest,
			);
		}

		if (renderedId) {
			await setLastWallpaperId(renderedId);
		}
	} catch (e) {
		// A bad manifest/IDB entry must not prevent the rest of the page.
		console.warn("Wallpaper render failed:", e);
	}

	try {
		if (config && config.searchbar && config.searchbar.enabled) {
			await renderSearchbar(config.searchbar);
		} else {
			removeSearchbar();
		}
	} catch (e) {
		// console.error('Failed to render/remove searchbar', e);
	}

	try {
		await initActionBar(config.actionbar || DEFAULT_CONFIG.actionbar, config);
	} catch (e) {
		// console.error('Failed to initialize action bar', e);
	}

	try {
		initClock(config);
	} catch (e) {
		// console.error('Failed to initialize on-screen clock', e);
	}

	// Initialization is complete: replay any settings save that arrived while
	// the page was still loading, then apply future changes directly.
	settingsUiReady = true;
	if (bufferedRemoteSettings) {
		const latest = bufferedRemoteSettings;
		bufferedRemoteSettings = null;
		queueRemoteConfig(latest);
	}

	// Resume a Zen session after a reload (the module is lazy-loaded).
	try {
		const ambient = await import("./ambientMode.js");
		ambient.maybeRestoreAmbientMode();
	} catch (e) {}

	// Action Listeners
	try {
		document.addEventListener("action:timer", async () => {
			try {
				const toggleEl = document.getElementById("action-timer");
				const isOpen = !!document.getElementById("timer-modal");
				if (!(await closeAllOverlays())) return;

				if (isOpen) {
					// It was open, and closeAllOverlays closed it (via closeTimerModalIfOpen? No, closeTimerModalIfOpen closes it).
					// Wait, closeTimerModalIfOpen closes it. So if it was open, it is now closed.
					// We want to toggle.
					// If it was open, we want it closed. closeAllOverlays did that.
					// But we also need to update the toggle button state.
					if (toggleEl) {
						toggleEl.classList.remove("active");
						try {
							toggleEl.setAttribute("aria-expanded", "false");
						} catch (e) {}
					}
				} else {
					// It was closed. closeAllOverlays ensured everything else is closed.
					// Now open it.
					const mod = await getTimerModule();
					mod.toggleTimerModal();
					if (toggleEl) {
						toggleEl.classList.add("active");
						try {
							toggleEl.setAttribute("aria-expanded", "true");
						} catch (e) {}
					}
				}
			} catch (inner) {
				/* console.error('Timer toggle handler error', inner); */
			}
		});
	} catch (e) {
		// console.error('Failed to attach timer action listener', e);
	}

	try {
		document.addEventListener("action:alarm", async () => {
			try {
				const toggleEl = document.getElementById("action-alarm");
				const isOpen = !!document.getElementById("alarm-modal");
				if (!(await closeAllOverlays())) return;

				if (isOpen) {
					if (toggleEl) {
						toggleEl.classList.remove("active");
						try {
							toggleEl.setAttribute("aria-expanded", "false");
						} catch (e) {}
					}
				} else {
					const mod = await getAlarmModule();
					mod.toggleAlarmModal();
					if (toggleEl) {
						toggleEl.classList.add("active");
						try {
							toggleEl.setAttribute("aria-expanded", "true");
						} catch (e) {}
					}
				}
			} catch (inner) {
				/* console.error('Alarm toggle handler error', inner); */
			}
		});
	} catch (e) {
		// console.error('Failed to attach alarm action listener', e);
	}

	try {
		document.addEventListener("action:settings", async (e) => {
			try {
				const targetTab = e.detail?.tab;
				const isOpen = !!document.getElementById("settings-modal");
				const toggleEl = document.getElementById("action-settings");

				// If isOpen and we just want to switch tab:
				if (isOpen && targetTab) {
					// Don't close, just switch
					const mod = await getSettingsModule();
					mod.openSettingsTab(targetTab);
					if (toggleEl) toggleEl.classList.add("active");
					return;
				}

				if (!(await closeAllOverlays())) return; // Closes settings if open (via closeSettingsModalIfOpen)

				// If we want to open (toggle on, or force open with tab)
				if (targetTab) {
					const mod = await getSettingsModule();
					mod.openSettingsTab(targetTab);
					if (toggleEl) toggleEl.classList.add("active");
				} else {
					if (!isOpen) {
						const mod = await getSettingsModule();
						mod.toggleSettingsModal();
						if (toggleEl) toggleEl.classList.add("active");
					} else {
						// Logic for toggle off handled by closeAllOverlays usually,
						// but toggleSettingsModal toggles based on internal state?
						// Step 1105: toggleSettingsModal calls close if open, open if closed.
						// But if we called closeAllOverlays above, it IS closed.
						// So isOpen is false.
						// So we open it.
						// Wait, if !isOpen, we open.
						// If isOpen, we called closeAllOverlays, so it closed.
						// So isOpen becomes false effectively? No, isOpen was captured before.
						// If it WAS open, we closed it. Do we want to re-open?
						// "toggleSettingsModal" implies toggle.
						// If user clicked settings button (action:settings w/o tab), and it was open:
						// isOpen = true. closeAllOverlays() -> closes it.
						// Listener logic: else (no tab) -> if (!isOpen) ...
						// If isOpen is true, we do NOTHING?
						// Yes, because closeAllOverlays already closed it.
						// So we just need to ensure button is inactive.
						if (toggleEl) toggleEl.classList.remove("active");
					}
				}
			} catch (inner) {
				/* console.error('Settings toggle handler error', inner); */
			}
		});
	} catch (e) {
		// console.error('Failed to attach settings action listener', e);
	}

	try {
		document.addEventListener("action:tools", async () => {
			const toggleEl = document.getElementById("action-tools");
			const isOpen = !!document.getElementById("tools-ribbon");
			if (!(await closeAllOverlays())) return;

			if (!isOpen) {
				const { toggleToolsRibbon, setToolsToggleElement } = await import("./toolsRibbon.js");
				setToolsToggleElement(toggleEl);
				toggleToolsRibbon();
				if (toggleEl) toggleEl.classList.add("active");
			} else {
				if (toggleEl) toggleEl.classList.remove("active");
			}
		});
	} catch (e) {}

	// Media Listener for Action Bar
	chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
		if (
			(message.type === "MEDIA_UPDATE" ||
				message.type === "MEDIA_PRESENCE") &&
			message.fromService
		) {
			// Pass tab ID if available
			const tabId = message.tabId || null;
			updateMediaState(message.data, tabId);
		}
		return false; // Not async
	});

	// If the first render happened before the service worker finished
	// caching wallpaper assets, retry once they are ready.
	chrome.runtime.onMessage.addListener((message) => {
		if (
			message &&
			message.type === "WALLPAPER_ASSETS_READY" &&
			config &&
			!document.getElementById("wallpaper")
		) {
			(async () => {
				try {
					const fresh = await getManifest();
					if (fresh) manifest = fresh;
				} catch (e) {}
				renderWallpaper(
					config.wallpaper || DEFAULT_CONFIG.wallpaper,
					manifest,
				).catch(() => {});
			})();
		}
		return false;
	});

	// Request initial state after a short delay to ensure listener is ready
	setTimeout(() => {
		chrome.runtime.sendMessage({ type: "MEDIA_QUERY" }, (response) => {});
	}, 100);

	// Modal Close Listeners (to update toggle buttons)
	try {
		document.addEventListener("timer:closed", () => {
			try {
				const toggleEl = document.getElementById("action-timer");
				if (toggleEl) {
					toggleEl.classList.remove("active");
					try {
						toggleEl.setAttribute("aria-expanded", "false");
					} catch (e) {}
					try {
						toggleEl.focus();
					} catch (e) {}
				}
			} catch (e) {}
		});
	} catch (e) {}

	try {
		document.addEventListener("alarm:closed", () => {
			try {
				const toggleEl = document.getElementById("action-alarm");
				if (toggleEl) {
					toggleEl.classList.remove("active");
					try {
						toggleEl.setAttribute("aria-expanded", "false");
					} catch (e) {}
					try {
						toggleEl.focus();
					} catch (e) {}
				}
			} catch (e) {}
		});
	} catch (e) {}

	try {
		document.addEventListener("settings:closed", () => {
			const toggleEl = document.getElementById("action-settings");
			if (toggleEl) toggleEl.classList.remove("active");
		});
	} catch (e) {}

	try {
		document.addEventListener("notes:closed", () => {
			const toggleEl = document.getElementById("action-notes");
			if (toggleEl) toggleEl.classList.remove("active");
		});
	} catch (e) {}

	// setupFullscreenToggle(); // Moved to delegation below

	// Setup Action Bar Actions Delegation (Handles dynamic recreation of action bar)
	document.addEventListener("click", async (e) => {
		// Tabs Toggle
		const tabsToggle = e.target.closest("#tabs-toggle");
		if (tabsToggle) {
			setTabsToggleElement(tabsToggle);
			const wasOpen = !!document.getElementById("tabs-ribbon");
			if (!(await closeAllOverlays())) return;
			if (!wasOpen) {
				toggleTabsRibbon();
			}
			return;
		}

		// Bookmarks Toggle
		const bookmarkToggle =
			e.target.closest("#bookmark-toggle") ||
			e.target.closest("#bookmarks-toggle");
		if (bookmarkToggle) {
			setBookmarkToggleElement(bookmarkToggle);
			try {
				const has = await hasBookmarksPermission();
				if (!has) {
					const granted = await requestBookmarksPermission();
					if (!granted) {
						// console.warn('Bookmarks permission not granted');
						return;
					}
				}

				const wasOpen = !!document.getElementById("bookmarks-panel");
				if (!(await closeAllOverlays())) return;
				if (!wasOpen) {
					await toggleBookmarksPanel();
				}
			} catch (err) {
				// console.error('Bookmark toggle failed', err);
			}
			return;
		}

		// Fullscreen Toggle
		const fullscreenToggle = e.target.closest("#fullscreen-toggle");
		if (fullscreenToggle) {
			try {
				// Check if in F11 fullscreen mode (viewport matches screen height but no fullscreenElement)
				const isF11Fullscreen =
					window.innerHeight >= screen.height - 1 &&
					!document.fullscreenElement;

				if (isF11Fullscreen) {
					// In F11 mode, we can't exit programmatically
					await showAlert(
						"Please press F11 or ESC to exit fullscreen mode.",
						"Fullscreen",
					);
					return;
				}

				if (document.fullscreenElement) {
					await document.exitFullscreen();
				} else {
					await document.documentElement.requestFullscreen();
				}
			} catch (err) {
				// console.error('Failed to toggle fullscreen', err);
			}
			return;
		}
	});

	// Robust Fullscreen Change Listener
	document.addEventListener("fullscreenchange", () => {
		const isFullscreen = !!document.fullscreenElement;
		const toggleEl = document.getElementById("fullscreen-toggle");
		if (toggleEl) {
			const icon = toggleEl.querySelector("span");
			if (icon) {
				const path =
					isFullscreen ?
						"assets/svgs-fontawesome/solid/compress.svg"
					:	"assets/svgs-fontawesome/solid/expand.svg";
				renderInlineIcon(icon, path);
			}
		}
	});

	// Additional resize listener for fullscreen detection via viewport height
	window.addEventListener("resize", () => {
		// Detect fullscreen by comparing viewport height to screen height
		const isFullscreenByHeight = window.innerHeight >= screen.height - 1; // -1 for tolerance
		const isFullscreenAPI = !!document.fullscreenElement;

		// Update icon if height-based detection differs from API
		if (isFullscreenByHeight !== isFullscreenAPI) {
			const toggleEl = document.getElementById("fullscreen-toggle");
			if (toggleEl) {
				const icon = toggleEl.querySelector("span");
				if (icon) {
					const path =
						isFullscreenByHeight ?
							"assets/svgs-fontawesome/solid/compress.svg"
						:	"assets/svgs-fontawesome/solid/expand.svg";
					renderInlineIcon(icon, path);
				}
			}
		}
	});

	// Components that might need initial setup can still be targeted if they exist,
	// but mostly they rely on click.
	// Ensure aria-controls is set if possible?
	// Since initActionBar might run later or parallel, and it creates the elements,
	// we don't need to force set attributes here if actionbar.js could do it,
	// but actionbar.js is generic.
	// For now, delegation solves the functional click issue.

	// Global Click Outside Listener (Tools, Alarm, Notes, Settings, Tabs, Bookmarks)
	/* 
    document.addEventListener('click', (e) => {
        // 1. Ignore clicks within the Action Bar (toggles)
        if (e.target.closest('#action-bar')) return;

        // 2. Ignore clicks inside modal CONTENT
        // Tools: #tools-modal is the content (popover style)
        if (e.target.closest('#tools-modal')) return;

        // Alarm: #alarm-modal is the content (inside backdrop)
        if (e.target.closest('#alarm-modal')) return;

        // Notes: .notes-modal is the content (inside backdrop)
        if (e.target.closest('.notes-modal')) return;

        // Settings: .settings-body is the content (inside container)
        // Note: #settings-modal is the container/backdrop, so clicking it SHOULD close.
        if (e.target.closest('.settings-body')) return;
        
        // Settings Confirmation Dialog (Delete alerts)
        if (e.target.closest('.confirm-overlay')) return;

        // Tabs Ribbon
        if (e.target.closest('#tabs-ribbon')) return;

        // Bookmarks Panel
        if (e.target.closest('#bookmarks-panel')) return;

        // 3. Close if any supported modal is open
        const toolsOpen = document.getElementById('tools-modal');
        const alarmOpen = document.getElementById('alarm-modal');
        const notesOpen = document.querySelector('.notes-modal-backdrop');
        const settingsOpen = document.getElementById('settings-modal');
        const tabsOpen = document.getElementById('tabs-ribbon');
        const bookmarksOpen = document.getElementById('bookmarks-panel');

        if (toolsOpen || alarmOpen || notesOpen || settingsOpen || tabsOpen || bookmarksOpen) {
            closeAllOverlays();
        }
    }); 
    */

	document.addEventListener("action:notes", async () => {
		const toggleEl = document.getElementById("action-notes");
		const isOpen = !!document.querySelector(".notes-modal");
		if (!(await closeAllOverlays())) return;

		if (!isOpen) {
			const mod = await getNotesModule();
			mod.toggleNotesModal();
			if (toggleEl) toggleEl.classList.add("active");
		} else {
			if (toggleEl) toggleEl.classList.remove("active");
		}
	});
})();
