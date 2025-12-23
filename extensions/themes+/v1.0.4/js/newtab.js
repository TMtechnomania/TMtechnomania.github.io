import {
	STORAGE_KEY_DB,
	STORAGE_KEY_SETTINGS,
	DEFAULT_CONFIG,
	applyTheme,
} from "./config.js";
import { renderInlineIcon } from "./brandIconLoader.js";
import { renderWallpaper } from "./wallpaper.js";
import { renderSearchbar, removeSearchbar } from "./searchbar.js";
import { initActionBar, updateMediaState } from "./actionbar.js";
import { toggleTimerModal, closeTimerModalIfOpen } from "./timerModal.js";
import { toggleAlarmModal, closeAlarmModalIfOpen } from "./alarmModal.js";
import {
	toggleSettingsModal,
	closeSettingsModalIfOpen,
	openSettingsTab,
} from "./settingsModal.js";
import { toggleToolsModal, closeToolsModal } from "./toolsModal.js";
import { initClock, updateClockSettings } from "./clockWidget.js";

// import { setupFullscreenToggle } from './fullscreen.js'; // Deprecated in favor of delegation
import { toggleTabsRibbon, setTabsToggleElement } from "./tabsRibbon.js";
import {
	toggleBookmarksPanel,
	setBookmarkToggleElement,
	hasBookmarksPermission,
	requestBookmarksPermission,
} from "./bookmarksPanel.js";
import {
	toggleNotesModal,
	openNotesModal,
	closeNotesModal,
} from "./notesModal.js";
import { initNotesWidget } from "./notesWidget.js";

const app = chrome || browser;

// Automatic UI Scaling
let uiScaleMultiplier = 1;

function updateUIScale() {
	const width = screen.width;
	const baseWidth = 1920;
	// Base scale * user preference multiplier
	const scale = (width / baseWidth) * uiScaleMultiplier;
	document.documentElement.style.setProperty("--ui-scale", scale);
}

// Initialize and listen
updateUIScale();
window.addEventListener("resize", updateUIScale);

// Listen for settings changes
document.addEventListener("settings:uiScale", (e) => {
	uiScaleMultiplier = parseFloat(e.detail) || 1;
	updateUIScale();
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

					const mergedConfig = {
						...DEFAULT_CONFIG,
						...stored,
						wallpaper: {
							...DEFAULT_CONFIG.wallpaper,
							...(stored.wallpaper || {}),
						},
					};

					resolve(mergedConfig);
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

async function setLastWallpaperId(id) {
	try {
		app.storage.local.get(STORAGE_KEY_SETTINGS, (res) => {
			const current = res?.[STORAGE_KEY_SETTINGS] || DEFAULT_CONFIG;
			if (!current.wallpaper) current.wallpaper = {};

			// Only update if changed prevents unnecessary writes, but for sequence we need to know the *current* one to find *next* one.
			// Actually sequence logic relies on last_id being the one *just displayed*.
			if (current.wallpaper.last_id !== id) {
				current.wallpaper.last_id = id;
				app.storage.local.set({ [STORAGE_KEY_SETTINGS]: current });
			}
		});
	} catch (e) {
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

function applyFontConfig(fontConfig) {
	if (!fontConfig) return;
	const { family, importUrl, weight } = fontConfig;
	if (importUrl) {
		const link = document.createElement("link");
		link.href = importUrl;
		link.rel = "stylesheet";
		document.head.appendChild(link);
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

function closeAllOverlays() {
	closeTimerModalIfOpen();
	closeAlarmModalIfOpen();
	closeSettingsModalIfOpen();
	closeToolsModal();
	closeNotesModal(); // Close notes if open
	if (document.getElementById("bookmarks-panel")) toggleBookmarksPanel();
	if (document.getElementById("tabs-ribbon")) toggleTabsRibbon();
}

(async () => {
	const config = await getStoredConfig();

	try {
		// Apply UI Scale
		if (config.uiScale) {
			uiScaleMultiplier = config.uiScale;
			updateUIScale();
		}

		applyFontConfig(
			config && config.font ? config.font : DEFAULT_CONFIG.font,
		);
		applyTheme(config.theme);
	} catch (e) {
		// console.error('Failed to apply config', e);
	}
	const manifest = await getManifest();

	initNotesWidget();
	document.addEventListener("notes-open", (e) => openNotesModal(e.detail || {}));
	let renderedId = null;

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
		await initActionBar(config.actionbar || DEFAULT_CONFIG.actionbar);
	} catch (e) {
		// console.error('Failed to initialize action bar', e);
	}

	try {
		initClock(config);
	} catch (e) {
		// console.error('Failed to initialize on-screen clock', e);
	}

	// Action Listeners
	try {
		document.addEventListener("action:timer", () => {
			try {
				const toggleEl = document.getElementById("action-timer");
				const isOpen = !!document.getElementById("timer-modal");
				closeAllOverlays();

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
					toggleTimerModal();
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
		document.addEventListener("action:alarm", () => {
			try {
				const toggleEl = document.getElementById("action-alarm");
				const isOpen = !!document.getElementById("alarm-modal");
				closeAllOverlays();

				if (isOpen) {
					if (toggleEl) {
						toggleEl.classList.remove("active");
						try {
							toggleEl.setAttribute("aria-expanded", "false");
						} catch (e) {}
					}
				} else {
					toggleAlarmModal();
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
		document.addEventListener("action:settings", (e) => {
			try {
				const targetTab = e.detail?.tab;
				const isOpen = !!document.getElementById("settings-modal");
				const toggleEl = document.getElementById("action-settings");

				// If isOpen and we just want to switch tab:
				if (isOpen && targetTab) {
					// Don't close, just switch
					openSettingsTab(targetTab);
					if (toggleEl) toggleEl.classList.add("active");
					return;
				}

				closeAllOverlays(); // Closes settings if open (via closeSettingsModalIfOpen)

				// If we want to open (toggle on, or force open with tab)
				if (targetTab) {
					openSettingsTab(targetTab);
					if (toggleEl) toggleEl.classList.add("active");
				} else {
					if (!isOpen) {
						toggleSettingsModal();
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
		document.addEventListener("action:tools", () => {
			const toggleEl = document.getElementById("action-tools");
			const isOpen = !!document.getElementById("tools-modal");
			closeAllOverlays();

			if (!isOpen) {
				toggleToolsModal();
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

	// Setup Components
	// setupFullscreenToggle(); // Moved to delegation below

	// Setup Action Bar Actions Delegation (Handles dynamic recreation of action bar)
	document.addEventListener("click", async (e) => {
		// Tabs Toggle
		const tabsToggle = e.target.closest("#tabs-toggle");
		if (tabsToggle) {
			setTabsToggleElement(tabsToggle);
			const wasOpen = !!document.getElementById("tabs-ribbon");
			closeAllOverlays();
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
				closeAllOverlays();
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
					alert("Please press F11 or ESC to exit fullscreen mode.");
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
				const path = isFullscreen
					? "assets/svgs-fontawesome/solid/compress.svg"
					: "assets/svgs-fontawesome/solid/expand.svg";
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
					const path = isFullscreenByHeight
						? "assets/svgs-fontawesome/solid/compress.svg"
						: "assets/svgs-fontawesome/solid/expand.svg";
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

	document.addEventListener("action:notes", () => {
		const toggleEl = document.getElementById("action-notes");
		const isOpen = !!document.querySelector(".notes-modal");
		closeAllOverlays();

		if (!isOpen) {
			toggleNotesModal();
			if (toggleEl) toggleEl.classList.add("active");
		} else {
			if (toggleEl) toggleEl.classList.remove("active");
		}
	});
})();
