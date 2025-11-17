import {
	STORAGE_KEY_DB,
	STORAGE_KEY_SETTINGS,
	DEFAULT_CONFIG,
} from "./config.js";
import { renderWallpaper } from "./wallpaper.js";
import { renderSearchbar, removeSearchbar } from "./searchbar.js";
import { initActionBar } from "./actionbar.js";
import { loadCSS, unloadCSS } from './cssLoader.js';
import { toggleTimerModal, closeTimerModalIfOpen } from './timerModal.js';
import { toggleAlarmModal, closeAlarmModalIfOpen } from './alarmModal.js';
import { safeSetIconWithFallback as setIconWithFallback, DEFAULT_ICON as DEFAULT_TAB_ICON } from './iconLoader.min.js';

const app = chrome || browser;

async function getStoredConfig() {
	return new Promise((resolve) => {
		try {
			app.storage.local.get(STORAGE_KEY_SETTINGS, (res) => {
				try {
					if (app.runtime.lastError) {
						console.error(app.runtime.lastError.message);
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

(async () => {
	const config = await getStoredConfig();

	try {
		applyFontConfig(config && config.font ? config.font : DEFAULT_CONFIG.font);
	} catch (e) {
		console.error('Failed to apply font config', e);
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

	try {
		document.addEventListener('action:timer', () => {
			try {
				const toggleEl = document.getElementById('action-timer');
				const isOpen = !!document.getElementById('timer-modal');
				closeAlarmModalIfOpen();
				if (document.getElementById('bookmarks-panel')) _toggleBookmarksPanel();
				if (document.getElementById('tabs-ribbon')) toggleTabsRibbon();
				if (isOpen) {
					closeTimerModalIfOpen();
					if (toggleEl) {
						toggleEl.classList.remove('active');
						try { toggleEl.setAttribute('aria-expanded', 'false'); } catch (e) {}
					}
				} else {
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
					closeTimerModalIfOpen();
					if (document.getElementById('bookmarks-panel')) _toggleBookmarksPanel();
					if (document.getElementById('tabs-ribbon')) toggleTabsRibbon();
					if (isOpen) {
						closeAlarmModalIfOpen();
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

	setupFullscreenToggle();

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

	setupTabsViewer();
	setupBookmarksViewer();
})();

function setupBookmarksViewer() {
	const bookmarkToggle = document.getElementById('bookmark-toggle') || document.querySelector('.action-group .action-item:nth-child(3)');
	if (!bookmarkToggle) {
		console.warn('Bookmark toggle element not found');
		return;
	}

	try { bookmarkToggle.setAttribute('aria-controls', 'bookmarks-panel'); } catch (e) {}
	try { bookmarkToggle.setAttribute('aria-expanded', 'false'); } catch (e) {}

	bookmarkToggle.addEventListener('click', async () => {
		try {
			const has = await _hasBookmarksPermission();
			if (!has) {
				const granted = await _requestBookmarksPermission();
				if (!granted) {
					console.warn('Bookmarks permission not granted');
					return;
				}
			}
			closeTimerModalIfOpen();
			closeAlarmModalIfOpen();
			if (document.getElementById('tabs-ribbon')) toggleTabsRibbon();
			await _toggleBookmarksPanel();
		} catch (e) {
			console.error('Bookmark toggle failed', e);
		}
	});
}

function _hasBookmarksPermission() {
	return new Promise((resolve) => {
		if (!chrome.permissions || !chrome.permissions.contains) return resolve(false);
		chrome.permissions.contains({ permissions: ['bookmarks'] }, (res) => resolve(!!res));
	});
}

function _requestBookmarksPermission() {
	return new Promise((resolve) => {
		if (!chrome.permissions || !chrome.permissions.request) return resolve(false);
		chrome.permissions.request({ permissions: ['bookmarks'] }, (granted) => resolve(!!granted));
	});
}

async function _toggleBookmarksPanel() {
	const existing = document.getElementById('bookmarks-panel');
	const toggleEl = document.getElementById('bookmark-toggle') || document.querySelector('.action-group .action-item:nth-child(3)');
	if (existing) {
		try { document.body.removeChild(existing); } catch (e) {}
		detachBookmarksAutoClose();
		if (toggleEl) {
			toggleEl.classList.remove('active');
			try { toggleEl.setAttribute('aria-expanded', 'false'); } catch (e) {}
			try { toggleEl.focus(); } catch (e) {}
		}
		unloadCSS('bookmarks-css');
		return;
	}

	await loadCSS('css/bookmarks.css', 'bookmarks-css');

	let bookmarkTarget = '_self';
	try {
		const stored = await new Promise((resolve) => {
			chrome.storage.local.get('userSettings', (res) => resolve(res?.userSettings || {}));
		});
		const searchbarCfg = stored.searchbar || { target: 'self' };
		bookmarkTarget = (searchbarCfg.target === 'self' || searchbarCfg.target === '_self') ? '_self' : '_blank';
	} catch (e) {
		console.warn('Failed to load searchbar config for bookmarks, using default _self', e);
	}

	const panel = document.createElement('div');
	panel.id = 'bookmarks-panel';
	panel.className = 'bookmarks-panel';
	panel.setAttribute('role', 'dialog');
	panel.setAttribute('aria-modal', 'true');
	panel.setAttribute('tabindex', '-1');

	const header = document.createElement('div');
	header.className = 'bookmarks-panel-header';

	const search = document.createElement('input');
	search.type = 'search';
	search.className = 'bookmarks-search';
	search.placeholder = 'Search bookmarks, links or collections...';
	search.id = 'bookmarks-search-input';
	panel.setAttribute('aria-labelledby', 'bookmarks-search-input');
	header.appendChild(search);

	const closeBtn = document.createElement('button');
	closeBtn.className = 'bookmarks-close';
	closeBtn.textContent = 'Close';
	header.appendChild(closeBtn);

	panel.appendChild(header);

	const results = document.createElement('div');
	results.className = 'bookmarks-search-results';
	results.style.display = 'none';
	panel.appendChild(results);

	const list = document.createElement('div');
	list.className = 'bookmarks-list';
	panel.appendChild(list);

	document.body.appendChild(panel);
	if (toggleEl) toggleEl.classList.add('active');
	try { toggleEl.setAttribute('aria-expanded', 'true'); } catch (e) {}

	let tree = [];
	try {
		tree = await new Promise((resolve) => chrome.bookmarks.getTree((res) => resolve(res || [])));
	} catch (e) {
		console.error('Failed to get bookmarks', e);
	}

	const flat = [];
	function walk(nodes, path = []) {
		for (const n of nodes) {
			const curPath = n.title ? [...path, n.title] : path;
			if (n.url) {
				flat.push({ id: n.id, title: n.title || n.url, url: n.url, path: curPath.join(' / ') });
			}
			if (n.children) walk(n.children, curPath);
		}
	}
	walk(tree);

	function createBookmarkElement(n) {
		const item = document.createElement('div');
		item.className = 'bookmark-item';
		item.tabIndex = 0;

		const fav = document.createElement('img');
		fav.className = 'bookmark-icon';
		fav.loading = 'lazy';
			try {
				const u = new URL(n.url);
				const favUrl = `https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(u.hostname)}`;
				setIconWithFallback(fav, favUrl, DEFAULT_TAB_ICON, 'provider').then((ok) => { if (!ok) fav.src = DEFAULT_TAB_ICON; }).catch(() => { fav.src = DEFAULT_TAB_ICON; });
			} catch (e) {
				setIconWithFallback(fav, null).then((ok) => { if (!ok) fav.src = DEFAULT_TAB_ICON; }).catch(() => { fav.src = DEFAULT_TAB_ICON; });
							fav.src = DEFAULT_TAB_ICON;
			}

		const main = document.createElement('div');
		main.className = 'bookmark-main';
		const title = document.createElement('div');
		title.className = 'bookmark-title';
		title.textContent = n.title || n.url;
		const urlEl = document.createElement('div');
		urlEl.className = 'bookmark-url';
		urlEl.textContent = n.url;
		main.appendChild(title);
		main.appendChild(urlEl);

		const actions = document.createElement('div');
		actions.className = 'bookmark-actions';

		const copyBtn = document.createElement('div');
		copyBtn.className = 'bookmark-action-btn';
		copyBtn.setAttribute('role', 'button');
		copyBtn.tabIndex = 0;
		const copyImg = document.createElement('img');
		setIconWithFallback(copyImg, 'assets/icons/Link--Streamline-Outlined-Material-Symbols.svg', undefined, 'asset').catch(()=>{copyImg.src='assets/icons/Link--Streamline-Outlined-Material-Symbols.svg'});
		copyImg.alt = 'Copy';
		copyBtn.appendChild(copyImg);
		copyBtn.title = 'Copy link';
		copyBtn.addEventListener('click', (ev) => {
			ev.stopPropagation();
			try { navigator.clipboard.writeText(n.url); } catch (e) {}
		});
		copyBtn.addEventListener('keydown', (ev) => {
			if (ev.key === 'Enter' || ev.key === ' ') {
				ev.preventDefault(); ev.stopPropagation();
				try { navigator.clipboard.writeText(n.url); } catch (e) {}
			}
		});

		const shareBtn = document.createElement('div');
		shareBtn.className = 'bookmark-action-btn';
		shareBtn.setAttribute('role', 'button');
		shareBtn.tabIndex = 0;
		const shareImg = document.createElement('img');
		setIconWithFallback(shareImg, 'assets/icons/Share--Streamline-Outlined-Material-Symbols.svg', undefined, 'asset').catch(()=>{shareImg.src='assets/icons/Share--Streamline-Outlined-Material-Symbols.svg'});
		shareImg.alt = 'Share';
		shareBtn.appendChild(shareImg);
		shareBtn.title = 'Share link';
		shareBtn.addEventListener('click', (ev) => {
			ev.stopPropagation();
			if (navigator.share) {
				try { navigator.share({ title: n.title, url: n.url }); } catch (e) { navigator.clipboard.writeText(n.url); }
			} else {
				try { navigator.clipboard.writeText(n.url); } catch (e) {}
			}
		});
		shareBtn.addEventListener('keydown', (ev) => {
			if (ev.key === 'Enter' || ev.key === ' ') {
				ev.preventDefault(); ev.stopPropagation();
				if (navigator.share) {
					try { navigator.share({ title: n.title, url: n.url }); } catch (e) { navigator.clipboard.writeText(n.url); }
				} else {
					try { navigator.clipboard.writeText(n.url); } catch (e) {}
				}
			}
		});

		const openBtn = document.createElement('div');
		openBtn.className = 'bookmark-action-btn';
		openBtn.setAttribute('role', 'button');
		openBtn.tabIndex = 0;
		const openImg = document.createElement('img');
		setIconWithFallback(openImg, 'assets/icons/Open-In-New--Streamline-Outlined-Material-Symbols.svg', undefined, 'asset').catch(()=>{openImg.src='assets/icons/Open-In-New--Streamline-Outlined-Material-Symbols.svg'});
		openImg.alt = 'Open';
		openBtn.appendChild(openImg);
		openBtn.title = 'Open in new tab';
		openBtn.addEventListener('click', (ev) => {
			ev.stopPropagation();
			try { chrome.tabs.create({ url: n.url }); } catch (e) { window.open(n.url, '_blank'); }
		});
		openBtn.addEventListener('keydown', (ev) => {
			if (ev.key === 'Enter' || ev.key === ' ') {
				ev.preventDefault(); ev.stopPropagation();
				try { chrome.tabs.create({ url: n.url }); } catch (e) { window.open(n.url, '_blank'); }
			}
		});

		actions.appendChild(copyBtn);
		actions.appendChild(shareBtn);
		actions.appendChild(openBtn);

		item.addEventListener('click', () => {
			window.open(n.url, bookmarkTarget);
		});

		item.addEventListener('keydown', (ev) => {
			if (ev.key === 'Enter' || ev.key === ' ') {
				ev.preventDefault();
				window.open(n.url, bookmarkTarget);
			}
			if (ev.key === 'ArrowDown') {
				ev.preventDefault();
				const next = item.nextElementSibling;
				if (next && next.classList && next.classList.contains('bookmark-item')) next.focus();
			}
			if (ev.key === 'ArrowUp') {
				ev.preventDefault();
				let prev = item.previousElementSibling;
				while (prev && (!prev.classList || !prev.classList.contains('bookmark-item'))) prev = prev.previousElementSibling;
				if (prev) prev.focus();
			}
		});

		item.appendChild(fav);
		item.appendChild(main);
		item.appendChild(actions);
		return item;
	}

	function renderTree(nodes, container) {
		nodes.forEach(n => {
			if (n.url) {
				const item = createBookmarkElement(n);
				container.appendChild(item);
			} else {
				const folder = document.createElement('div');
				folder.className = 'bookmark-folder';

				const title = document.createElement('div');
				title.className = 'bookmark-folder-title';
				title.textContent = n.title || 'Folder';
				title.tabIndex = 0;
				title.setAttribute('role', 'button');
				title.setAttribute('aria-expanded', 'true');

				const children = document.createElement('div');
				children.className = 'bookmark-folder-children';
				if (n.children && n.children.length) renderTree(n.children, children);

				function setCollapsed(collapsed) {
					if (collapsed) {
						children.style.display = 'none';
						title.setAttribute('aria-expanded', 'false');
						folder.classList.add('collapsed');
					} else {
						children.style.display = '';
						title.setAttribute('aria-expanded', 'true');
						folder.classList.remove('collapsed');
					}
				}

				title.addEventListener('click', (ev) => {
					ev.stopPropagation();
					const isCollapsed = folder.classList.contains('collapsed');
					setCollapsed(!isCollapsed);
				});
				title.addEventListener('keydown', (ev) => {
					if (ev.key === 'Enter' || ev.key === ' ') {
						ev.preventDefault(); ev.stopPropagation();
						const isCollapsed = folder.classList.contains('collapsed');
						setCollapsed(!isCollapsed);
					}
					if (ev.key === 'ArrowDown') {
						const first = children.querySelector('.bookmark-item');
						if (first) first.focus();
					}
				});

				folder.appendChild(title);
				folder.appendChild(children);
				container.appendChild(folder);
			}
		});
	}
	renderTree(tree, list);

	function doSearch(q) {
		const value = (q || '').trim().toLowerCase();
		if (!value) {
			results.style.display = 'none';
			list.style.display = '';
			results.innerHTML = '';
			return;
		}
		const found = flat.filter(b => (b.title && b.title.toLowerCase().includes(value)) || (b.url && b.url.toLowerCase().includes(value)) || (b.path && b.path.toLowerCase().includes(value)));
		results.innerHTML = '';
		if (found.length === 0) {
			const none = document.createElement('div'); none.className = 'bookmarks-none'; none.textContent = 'No bookmarks found'; results.appendChild(none);
		} else {
			found.forEach(b => {
				const item = createBookmarkElement(b);
				results.appendChild(item);
			});
		}
		results.style.display = '';
		list.style.display = 'none';
	}

	let searchDebounce = null;
	search.addEventListener('input', (ev) => {
		clearTimeout(searchDebounce);
		searchDebounce = setTimeout(() => doSearch(ev.target.value), 200);
	});

	search.addEventListener('keydown', (ev) => {
		if (ev.key === 'ArrowDown') {
			ev.preventDefault();
			const first = list.querySelector('.bookmark-item');
			if (first) first.focus();
		}
	});

	closeBtn.addEventListener('click', () => {
		try { document.body.removeChild(panel); } catch (e) {}
		detachBookmarksAutoClose();
		if (toggleEl) {
			toggleEl.classList.remove('active');
			try { toggleEl.setAttribute('aria-expanded', 'false'); } catch (e) {}
			try { toggleEl.focus(); } catch (e) {}
		}
	});

	panel.addEventListener('keydown', (ev) => {
		if (ev.key === 'Escape') {
			try { document.body.removeChild(panel); } catch (e) {}
			if (toggleEl) {
				toggleEl.classList.remove('active');
				try { toggleEl.setAttribute('aria-expanded', 'false'); } catch (e) {}
				try { toggleEl.focus(); } catch (e) {}
			}
			return;
		}

		if (ev.key === 'Tab') {
			const focusable = panel.querySelectorAll('button, [href], input, [tabindex]:not([tabindex="-1"])');
			if (!focusable || focusable.length === 0) return;
			const listArr = Array.prototype.slice.call(focusable).filter(el => !el.disabled && el.offsetParent !== null);
			const idx = listArr.indexOf(document.activeElement);
			if (ev.shiftKey) {
				if (idx === 0) {
					ev.preventDefault();
					listArr[listArr.length - 1].focus();
				}
			} else {
				if (idx === listArr.length - 1) {
					ev.preventDefault();
					listArr[0].focus();
				}
			}
		}
	});

	try { search.focus(); } catch (e) {}

	function detachBookmarksAutoClose() {
		try {
			if (_bookmarksAutoCloseInterval) {
				clearInterval(_bookmarksAutoCloseInterval);
				_bookmarksAutoCloseInterval = null;
			}
			if (_bookmarksAutoCloseListeners) {
				const { onMouseMove, onPanelInteraction, onPanelEnter, onPanelLeave } = _bookmarksAutoCloseListeners;
				document.removeEventListener('mousemove', onMouseMove);
				document.removeEventListener('pointerdown', onPanelInteraction);
				document.removeEventListener('wheel', onPanelInteraction);
				if (panel) {
					panel.removeEventListener('mouseenter', onPanelEnter);
					panel.removeEventListener('mouseleave', onPanelLeave);
					panel.removeEventListener('scroll', onPanelInteraction);
					panel.removeEventListener('pointerdown', onPanelInteraction);
				}
				_bookmarksAutoCloseListeners = null;
			}
		} catch (e) {
		}
	}

	(function attachBookmarksAutoClose() {
		try {
			let lastMouseMove = Date.now();
			let lastInteraction = Date.now();

			function onMouseMove(ev) {
				lastMouseMove = Date.now();
				if (panel && panel.contains(ev.target)) lastInteraction = Date.now();
			}

			function onPanelInteraction(ev) {
				lastInteraction = Date.now();
			}

			function onPanelEnter() {
				lastInteraction = Date.now();
			}

			function onPanelLeave() {
			}

			_bookmarksAutoCloseInterval = setInterval(() => {
				try {
					const now = Date.now();
					const hovering = panel && panel.matches(':hover');
					if (!hovering && (now - lastMouseMove) > BOOKMARKS_AUTO_CLOSE_MS && (now - lastInteraction) > BOOKMARKS_AUTO_CLOSE_MS) {
						try { document.body.removeChild(panel); } catch (e) {}
						if (toggleEl) {
							toggleEl.classList.remove('active');
							try { toggleEl.setAttribute('aria-expanded', 'false'); } catch (e) {}
							try { toggleEl.focus(); } catch (e) {}
						}
						detachBookmarksAutoClose();
						unloadCSS('bookmarks-css');
					}
				} catch (e) {
				}
			}, 1000);

			document.addEventListener('mousemove', onMouseMove);
			document.addEventListener('pointerdown', onPanelInteraction);
			document.addEventListener('wheel', onPanelInteraction, { passive: true });

			panel.addEventListener('mouseenter', onPanelEnter);
			panel.addEventListener('mouseleave', onPanelLeave);
			panel.addEventListener('scroll', onPanelInteraction, { passive: true });
			panel.addEventListener('pointerdown', onPanelInteraction);

			_bookmarksAutoCloseListeners = { onMouseMove, onPanelInteraction, onPanelEnter, onPanelLeave };
		} catch (e) {
		}
	})();
}

function setupFullscreenToggle() {
	const fullscreenToggle = document.getElementById('fullscreen-toggle');
	if (!fullscreenToggle) {
		console.warn('Fullscreen toggle element not found');
		return;
	}

	fullscreenToggle.addEventListener('click', async () => {
		try {
			if (document.fullscreenElement) {
				await document.exitFullscreen();
			} else {
				await document.documentElement.requestFullscreen();
			}
		} catch (e) {
			console.error('Failed to toggle fullscreen', e);
		}
	});

	document.addEventListener('fullscreenchange', () => {
		const isFullscreen = !!document.fullscreenElement;
		const img = fullscreenToggle.querySelector('img');
		if (img) {
			img.src = isFullscreen
				? 'assets/icons/Fullscreen-Exit--Streamline-Outlined-Material-Symbols.svg'
				: 'assets/icons/Fullscreen--Streamline-Outlined-Material-Symbols.svg';
		}
	});
}

function setupTabsViewer() {
	const tabsToggle = document.querySelector('.action-group .action-item:nth-child(2)');
	if (!tabsToggle) {
		console.warn('Tabs toggle element not found');
		return;
	}

	_tabsToggleElement = tabsToggle;

	try { tabsToggle.setAttribute('aria-controls', 'tabs-ribbon'); } catch (e) {}
	try { tabsToggle.setAttribute('aria-expanded', 'false'); } catch (e) {}

	tabsToggle.addEventListener('click', () => {
		closeTimerModalIfOpen();
		closeAlarmModalIfOpen();
		if (document.getElementById('bookmarks-panel')) _toggleBookmarksPanel();
		toggleTabsRibbon();
	});
}

let _tabsRibbonListeners = null;
let _tabsToggleElement = null;
let _tabsRibbonAutoCloseTimer = null;
const TABS_RIBBON_AUTO_CLOSE_MS = 15000;

let _bookmarksAutoCloseInterval = null;
let _bookmarksAutoCloseListeners = null;
const BOOKMARKS_AUTO_CLOSE_MS = 30000;

async function toggleTabsRibbon() {
	let ribbon = document.getElementById('tabs-ribbon');
	if (ribbon) {
		_clearTabsRibbonAutoCloseTimer();
		document.body.removeChild(ribbon);
		detachTabsListeners();
		if (_tabsToggleElement) {
			_tabsToggleElement.classList.remove('active');
			try { _tabsToggleElement.setAttribute('aria-expanded', 'false'); } catch (e) {}
		}
		unloadCSS('tabs-css');
		return;
	}

	await loadCSS('css/tabs.css', 'tabs-css');

	try {
		const tabs = await chrome.tabs.query({});
		ribbon = createTabsRibbon(tabs);
		document.body.appendChild(ribbon);
		attachTabsListeners();
		if (_tabsToggleElement) {
			_tabsToggleElement.classList.add('active');
			try { _tabsToggleElement.setAttribute('aria-expanded', 'true'); } catch (e) {}
		}

		_scheduleTabsRibbonAutoClose();
	} catch (e) {
		console.error('Failed to show tabs ribbon', e);
	}
}

function createTabsRibbon(tabs) {
	const grouped = {};
	tabs.forEach(t => {
		if (!grouped[t.windowId]) grouped[t.windowId] = [];
		grouped[t.windowId].push(t);
	});

	const ribbon = document.createElement('div');
	ribbon.id = 'tabs-ribbon';

	const content = document.createElement('div');
	content.className = 'tabs-ribbon-content';

	const windowIds = Object.keys(grouped);

	let mergeBtn = null;
	if (windowIds.length > 1) {
		mergeBtn = document.createElement('div');
		mergeBtn.className = 'merge-windows-btn action-item';
		const mergeImg = document.createElement('img');
		setIconWithFallback(mergeImg, 'assets/icons/Select-Window-Off--Streamline-Outlined-Material-Symbols.svg', undefined, 'asset').catch(()=>{mergeImg.src='assets/icons/Select-Window-Off--Streamline-Outlined-Material-Symbols.svg'});
		mergeImg.alt = 'Merge windows';
		mergeBtn.appendChild(mergeImg);
		mergeBtn.title = 'Merge all windows into first window';
		mergeBtn.addEventListener('click', async () => {
			try {
				await mergeAllToFirstWindow(windowIds);
				await refreshTabsRibbon();
			} catch (e) {
				console.error('Failed to merge windows', e);
			}
		});
	}

	Object.entries(grouped).forEach(([windowId, windowTabs]) => {
		const group = document.createElement('div');
		group.className = 'window-group';
		group.dataset.windowId = windowId;

		const windowPill = document.createElement('div');
		windowPill.className = 'window-selector';
		windowPill.title = `Select window ${windowId}`;
		const winImg = document.createElement('img');
		winImg.className = 'window-selector-icon';
		setIconWithFallback(winImg, 'assets/icons/Select-Window--Streamline-Outlined-Material-Symbols.svg', undefined, 'asset').catch(()=>{winImg.src='assets/icons/Select-Window--Streamline-Outlined-Material-Symbols.svg'});
		winImg.alt = `Window ${windowId}`;
		windowPill.appendChild(winImg);

		windowPill.addEventListener('click', async () => {
			try {
				const activeTabs = await chrome.tabs.query({ windowId: parseInt(windowId), active: true });
				const active = activeTabs && activeTabs[0];
				if (active) {
					try {
						if (chrome.windows && chrome.windows.update) {
							await chrome.windows.update(parseInt(windowId), { focused: true });
						}
						await chrome.tabs.update(active.id, { active: true });
					} catch (err) {
						const tabEl = content.querySelector(`.tab-item[data-tab-id='${active.id}']`);
						if (tabEl) {
							tabEl.click();
							return;
						}
						if (active.url) await chrome.tabs.create({ url: active.url });
					}
				} else {
					if (windowTabs && windowTabs[0]) {
						const firstId = windowTabs[0].id;
						document.querySelectorAll('#tabs-ribbon .tab-item.active').forEach(el => el.classList.remove('active'));
						const firstEl = content.querySelector(`.tab-item[data-tab-id='${firstId}']`);
						if (firstEl) firstEl.classList.add('active');
					}
				}
			} catch (e) {
				console.error('Select window pill failed', e);
			}
		});

		group.appendChild(windowPill);

		const list = document.createElement('div');
		list.className = 'tabs-ribbon-list';

		windowTabs.forEach(tab => {
			const item = document.createElement('div');
			item.className = 'tab-item';
			if (tab.active) item.classList.add('active');
			item.dataset.tabId = tab.id;
			item.dataset.windowId = tab.windowId;

			const img = document.createElement('img');
			img.className = 'tab-icon';
			setIconWithFallback(img, tab.favIconUrl, DEFAULT_TAB_ICON, 'tab-provider').then((ok) => { if (!ok) img.src = DEFAULT_TAB_ICON; }).catch(() => { img.src = DEFAULT_TAB_ICON; });
			img.alt = tab.title || 'tab';

			const title = document.createElement('span');
			title.className = 'tab-title';
			title.textContent = tab.title || tab.url || 'Untitled';

			item.appendChild(img);
			item.appendChild(title);

			item.addEventListener('click', async () => {
				const tabId = parseInt(item.dataset.tabId);
				const windowId = parseInt(item.dataset.windowId);
				try {
					await chrome.windows.update(windowId, { focused: true });
					await chrome.tabs.update(tabId, { active: true });
					updateActiveTabVisual(tabId);
					const r = document.getElementById('tabs-ribbon');
					if (r) document.body.removeChild(r);
					detachTabsListeners();
				} catch (e) {
					console.error('Failed to switch to tab', e);
				}
			});

			list.appendChild(item);
		});

		group.appendChild(list);
		content.appendChild(group);
	});

	if (mergeBtn) content.appendChild(mergeBtn);

	content.addEventListener('mouseenter', () => {
		_clearTabsRibbonAutoCloseTimer();
	});
	content.addEventListener('mouseleave', () => {
		_scheduleTabsRibbonAutoClose();
	});

	ribbon.appendChild(content);
	return ribbon;
}

async function refreshTabsRibbon() {
	const ribbon = document.getElementById('tabs-ribbon');
	if (!ribbon) return;
	try {
		_clearTabsRibbonAutoCloseTimer();
		const tabs = await chrome.tabs.query({});
		const newRibbon = createTabsRibbon(tabs);
		ribbon.replaceWith(newRibbon);
	} catch (e) {
		console.error('Failed to refresh tabs ribbon', e);
	}
}

async function mergeAllToFirstWindow(windowIds) {
	if (!windowIds || windowIds.length < 2) return;
	const targetWindowId = parseInt(windowIds[0]);

	const allTabs = await chrome.tabs.query({});
	const tabsToMove = allTabs.filter(t => t.windowId !== targetWindowId).map(t => t.id);

	for (const tabId of tabsToMove) {
		try {
			await chrome.tabs.move(tabId, { windowId: targetWindowId, index: -1 });
		} catch (e) {
			console.warn('Could not move tab', tabId, e);
			try {
				const tab = allTabs.find(t => t.id === tabId);
				if (tab && tab.url) {
					await chrome.tabs.create({ windowId: targetWindowId, url: tab.url });
					await chrome.tabs.remove(tabId);
				}
			} catch (inner) {
				console.error('Fallback move failed for tab', tabId, inner);
			}
		}
	}
}

function updateActiveTabVisual(activeTabId) {
	document.querySelectorAll('#tabs-ribbon .tab-item.active').forEach(el => el.classList.remove('active'));
	const el = document.querySelector(`#tabs-ribbon .tab-item[data-tab-id='${activeTabId}']`);
	if (el) el.classList.add('active');
}

function attachTabsListeners() {
	if (_tabsRibbonListeners) return;
	_tabsRibbonListeners = {};

	const handler = () => refreshTabsRibbon();

	_tabsRibbonListeners.onCreated = chrome.tabs.onCreated.addListener(handler);
	_tabsRibbonListeners.onRemoved = chrome.tabs.onRemoved.addListener(handler);
	_tabsRibbonListeners.onUpdated = chrome.tabs.onUpdated.addListener(handler);
	_tabsRibbonListeners.onMoved = chrome.tabs.onMoved.addListener(handler);
	_tabsRibbonListeners.onAttached = chrome.tabs.onAttached.addListener(handler);
	_tabsRibbonListeners.onDetached = chrome.tabs.onDetached.addListener(handler);
	_tabsRibbonListeners.onActivated = chrome.tabs.onActivated.addListener(({tabId}) => {
		updateActiveTabVisual(tabId);
	});
}

function detachTabsListeners() {
	if (!_tabsRibbonListeners) return;

	_clearTabsRibbonAutoCloseTimer();
	try {
		chrome.tabs.onCreated.removeListener(_tabsRibbonListeners.onCreated);
		chrome.tabs.onRemoved.removeListener(_tabsRibbonListeners.onRemoved);
		chrome.tabs.onUpdated.removeListener(_tabsRibbonListeners.onUpdated);
		chrome.tabs.onMoved.removeListener(_tabsRibbonListeners.onMoved);
		chrome.tabs.onAttached.removeListener(_tabsRibbonListeners.onAttached);
		chrome.tabs.onDetached.removeListener(_tabsRibbonListeners.onDetached);
		chrome.tabs.onActivated.removeListener(_tabsRibbonListeners.onActivated);
	} catch (e) {
	}
	_tabsRibbonListeners = null;
}

function _clearTabsRibbonAutoCloseTimer() {
	if (_tabsRibbonAutoCloseTimer) {
		clearTimeout(_tabsRibbonAutoCloseTimer);
		_tabsRibbonAutoCloseTimer = null;
	}
}

function _scheduleTabsRibbonAutoClose() {
	_clearTabsRibbonAutoCloseTimer();
	_tabsRibbonAutoCloseTimer = setTimeout(() => {
		const r = document.getElementById('tabs-ribbon');
		if (r) {
			try {
				document.body.removeChild(r);
				detachTabsListeners();
			} catch (e) {}
		}
		if (_tabsToggleElement) _tabsToggleElement.classList.remove('active');
		if (_tabsToggleElement) {
			try { _tabsToggleElement.setAttribute('aria-expanded', 'false'); } catch (e) {}
		}
		_tabsRibbonAutoCloseTimer = null;
	}, TABS_RIBBON_AUTO_CLOSE_MS);
}

function applyFontConfig(fontCfg) {
	if (!fontCfg) return;
	try {
		const existing = document.getElementById('user-font-link');
		if (existing) existing.remove();

		if (fontCfg.importUrl) {
			const link = document.createElement('link');
			link.id = 'user-font-link';
			link.rel = 'stylesheet';
			link.href = fontCfg.importUrl;
			document.head.appendChild(link);
		}

		const family = fontCfg.family || 'Outfit';
		const fallback = "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
		document.documentElement.style.setProperty('--font-family', `${family}, ${fallback}`);
	} catch (e) {
		console.error('applyFontConfig error', e);
	}
}