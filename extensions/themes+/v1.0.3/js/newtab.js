import {
	STORAGE_KEY_DB,
	STORAGE_KEY_SETTINGS,
	DEFAULT_CONFIG,
	applyTheme
} from "./config.js";
import { renderWallpaper } from "./wallpaper.js";
import { renderSearchbar, removeSearchbar } from "./searchbar.js";
import { initActionBar } from "./actionbar.js";
import { toggleTimerModal, closeTimerModalIfOpen } from './timerModal.js';
import { toggleAlarmModal, closeAlarmModalIfOpen } from './alarmModal.js';
import { toggleSettingsModal, closeSettingsModalIfOpen } from './settingsModal.js';
import { setupFullscreenToggle } from './fullscreen.js';
import { toggleTabsRibbon, setTabsToggleElement } from './tabsRibbon.js';
import { toggleBookmarksPanel, setBookmarkToggleElement, hasBookmarksPermission, requestBookmarksPermission } from './bookmarksPanel.js';

const app = chrome || browser;

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
					console.log("Loaded stored config:", stored, "merged:", mergedConfig);
					resolve(mergedConfig);
				} catch (e) {
					console.error("Failed to parse stored config:", e);
					resolve(DEFAULT_CONFIG);
				}
			});
		} catch (e) {
			console.error("Failed to call app.storage.local.get:", e);
			resolve(DEFAULT_CONFIG);
		}
	});
}

async function setLastWallpaperId(id) {
	console.log(`Wallpaper rendered: ${id} (not saving last_id until settings panel)`);
}

async function getManifest() {
	return new Promise((resolve) => {
		try {
			app.storage.local.get(STORAGE_KEY_DB, (res) => {
				if (app.runtime.lastError) {
					console.error(app.runtime.lastError.message);
					resolve(null);
					return;
				}
				resolve(
					res && res[STORAGE_KEY_DB] ? res[STORAGE_KEY_DB] : null,
				);
			});
		} catch (e) {
			console.error("Failed to call app.storage.local.get for manifest:", e);
			resolve(null);
		}
	});
}

function applyFontConfig(fontConfig) {
	if (!fontConfig) return;
	const { family, importUrl, weight } = fontConfig;
	if (importUrl) {
		const link = document.createElement('link');
		link.href = importUrl;
		link.rel = 'stylesheet';
		document.head.appendChild(link);
	}
	if (family) {
		document.documentElement.style.setProperty('--font-family', family);
	}
	if (weight) {
		document.documentElement.style.setProperty('--font-weight-base', weight);
	}
}

function closeAllOverlays() {
	closeTimerModalIfOpen();
	closeAlarmModalIfOpen();
	closeSettingsModalIfOpen();
	if (document.getElementById('bookmarks-panel')) toggleBookmarksPanel();
	if (document.getElementById('tabs-ribbon')) toggleTabsRibbon();
}

(async () => {
	const config = await getStoredConfig();

	try {
		applyFontConfig(config && config.font ? config.font : DEFAULT_CONFIG.font);
		applyTheme(config.theme);
	} catch (e) {
		console.error('Failed to apply config', e);
	}
	const manifest = await getManifest();
	let renderedId = null;

	if (!manifest || !(manifest.images || manifest.videos)) {
		console.warn("Manifest not found or is empty, using defaults.");
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
		console.error('Failed to render/remove searchbar', e);
	}

	try {
		await initActionBar(config.actionbar || DEFAULT_CONFIG.actionbar);
	} catch (e) {
		console.error('Failed to initialize action bar', e);
	}

	// Action Listeners
	try {
		document.addEventListener('action:timer', () => {
			try {
				const toggleEl = document.getElementById('action-timer');
				const isOpen = !!document.getElementById('timer-modal');
				closeAllOverlays();
				
				if (isOpen) {
					// It was open, and closeAllOverlays closed it (via closeTimerModalIfOpen? No, closeTimerModalIfOpen closes it).
					// Wait, closeTimerModalIfOpen closes it. So if it was open, it is now closed.
					// We want to toggle.
					// If it was open, we want it closed. closeAllOverlays did that.
					// But we also need to update the toggle button state.
					if (toggleEl) {
						toggleEl.classList.remove('active');
						try { toggleEl.setAttribute('aria-expanded', 'false'); } catch (e) {}
					}
				} else {
					// It was closed. closeAllOverlays ensured everything else is closed.
					// Now open it.
					toggleTimerModal();
					if (toggleEl) {
						toggleEl.classList.add('active');
						try { toggleEl.setAttribute('aria-expanded', 'true'); } catch (e) {}
					}
				}
			} catch (inner) { console.error('Timer toggle handler error', inner); }
		});
	} catch (e) {
		console.error('Failed to attach timer action listener', e);
	}

	try {
		document.addEventListener('action:alarm', () => {
			try {
				const toggleEl = document.getElementById('action-alarm');
				const isOpen = !!document.getElementById('alarm-modal');
				closeAllOverlays();

				if (isOpen) {
					if (toggleEl) {
						toggleEl.classList.remove('active');
						try { toggleEl.setAttribute('aria-expanded', 'false'); } catch (e) {}
					}
				} else {
					toggleAlarmModal();
					if (toggleEl) {
						toggleEl.classList.add('active');
						try { toggleEl.setAttribute('aria-expanded', 'true'); } catch (e) {}
					}
				}
			} catch (inner) { console.error('Alarm toggle handler error', inner); }
		});
	} catch (e) {
		console.error('Failed to attach alarm action listener', e);
	}

	try {
		document.addEventListener('action:settings', () => {
			try {
				const isOpen = !!document.getElementById('settings-modal');
				closeAllOverlays();
				if (!isOpen) {
					toggleSettingsModal();
				}
			} catch (inner) { console.error('Settings toggle handler error', inner); }
		});
	} catch (e) {
		console.error('Failed to attach settings action listener', e);
	}

	// Modal Close Listeners (to update toggle buttons)
	try {
		document.addEventListener('timer:closed', () => {
			try {
				const toggleEl = document.getElementById('action-timer');
				if (toggleEl) {
					toggleEl.classList.remove('active');
					try { toggleEl.setAttribute('aria-expanded', 'false'); } catch (e) {}
					try { toggleEl.focus(); } catch (e) {}
				}
			} catch (e) {}
		});
	} catch (e) {}

	try {
		document.addEventListener('alarm:closed', () => {
			try {
				const toggleEl = document.getElementById('action-alarm');
				if (toggleEl) {
					toggleEl.classList.remove('active');
					try { toggleEl.setAttribute('aria-expanded', 'false'); } catch (e) {}
					try { toggleEl.focus(); } catch (e) {}
				}
			} catch (e) {}
		});
	} catch (e) {}

	// Setup Components
	setupFullscreenToggle();

	// Setup Tabs Viewer
	const tabsToggle = document.querySelector('.action-group .action-item:nth-child(2)');
	if (tabsToggle) {
		setTabsToggleElement(tabsToggle);
		try { tabsToggle.setAttribute('aria-controls', 'tabs-ribbon'); } catch (e) {}
		try { tabsToggle.setAttribute('aria-expanded', 'false'); } catch (e) {}

		tabsToggle.addEventListener('click', () => {
			closeAllOverlays();
			// If it was already open, closeAllOverlays closed it.
			// But toggleTabsRibbon toggles.
			// If it was open, closeAllOverlays closed it. So toggleTabsRibbon will open it again?
			// Wait. closeAllOverlays calls toggleTabsRibbon if it exists.
			// So if it was open, closeAllOverlays closed it.
			// Then we call toggleTabsRibbon again, which opens it?
			// This logic is tricky.
			
			// Let's adjust closeAllOverlays to NOT close the one we are about to toggle?
			// Or just handle it explicitly here.
			
			// Actually, closeAllOverlays checks `if (document.getElementById('tabs-ribbon')) toggleTabsRibbon();`
			// So it closes it.
			// If we call toggleTabsRibbon() immediately after, it will open it.
			// So clicking the button when open -> closes then opens -> no change (flicker).
			
			// Fix: Check if it was open BEFORE closing others.
			const wasOpen = !!document.getElementById('tabs-ribbon');
			closeAllOverlays();
			if (!wasOpen) {
				toggleTabsRibbon();
			}
		});
	} else {
		console.warn('Tabs toggle element not found');
	}

	// Setup Bookmarks Viewer
	const bookmarkToggle = document.getElementById('bookmark-toggle') || document.querySelector('.action-group .action-item:nth-child(3)');
	if (bookmarkToggle) {
		setBookmarkToggleElement(bookmarkToggle);
		try { bookmarkToggle.setAttribute('aria-controls', 'bookmarks-panel'); } catch (e) {}
		try { bookmarkToggle.setAttribute('aria-expanded', 'false'); } catch (e) {}

		bookmarkToggle.addEventListener('click', async () => {
			try {
				const has = await hasBookmarksPermission();
				if (!has) {
					const granted = await requestBookmarksPermission();
					if (!granted) {
						console.warn('Bookmarks permission not granted');
						return;
					}
				}
				
				const wasOpen = !!document.getElementById('bookmarks-panel');
				closeAllOverlays();
				if (!wasOpen) {
					await toggleBookmarksPanel();
				}
			} catch (e) {
				console.error('Bookmark toggle failed', e);
			}
		});
	} else {
		console.warn('Bookmark toggle element not found');
	}

})();