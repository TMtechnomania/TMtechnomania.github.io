import { loadCSS, unloadCSS } from './cssLoader.js';
import { renderBrandIcon, renderInlineIcon } from './brandIconLoader.js';

let _tabsRibbonListeners = null;
let _tabsToggleElement = null;
let _tabsRibbonAutoCloseTimer = null;
const TABS_RIBBON_AUTO_CLOSE_MS = 15000;

export function setTabsToggleElement(el) {
	_tabsToggleElement = el;
}

export async function toggleTabsRibbon() {
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
		const mergeIcon = document.createElement('span');
		mergeIcon.className = 'ui-icon merge-windows-icon';
		mergeIcon.setAttribute('aria-hidden', 'true');
		renderInlineIcon(mergeIcon, 'assets/svgs-fontawesome/regular/window-minimize.svg');
		mergeBtn.appendChild(mergeIcon);
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
		const winIcon = document.createElement('span');
		winIcon.className = 'ui-icon window-selector-icon';
		winIcon.setAttribute('aria-hidden', 'true');
		renderInlineIcon(winIcon, 'assets/svgs-fontawesome/regular/window-maximize.svg');
		windowPill.appendChild(winIcon);

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

			const icon = document.createElement('span');
			icon.className = 'tab-icon brand-icon';
			icon.setAttribute('aria-hidden', 'true');
			renderBrandIcon(icon, tab.url);

			const title = document.createElement('span');
			title.className = 'tab-title';
			title.textContent = tab.title || tab.url || 'Untitled';

			item.appendChild(icon);
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

function _scheduleTabsRibbonAutoClose() {
	_clearTabsRibbonAutoCloseTimer();
	_tabsRibbonAutoCloseTimer = setTimeout(() => {
		const ribbon = document.getElementById('tabs-ribbon');
		if (ribbon) {
			try { document.body.removeChild(ribbon); } catch (e) {}
			detachTabsListeners();
			if (_tabsToggleElement) {
				_tabsToggleElement.classList.remove('active');
				try { _tabsToggleElement.setAttribute('aria-expanded', 'false'); } catch (e) {}
			}
			unloadCSS('tabs-css');
		}
	}, TABS_RIBBON_AUTO_CLOSE_MS);
}

function _clearTabsRibbonAutoCloseTimer() {
	if (_tabsRibbonAutoCloseTimer) {
		clearTimeout(_tabsRibbonAutoCloseTimer);
		_tabsRibbonAutoCloseTimer = null;
	}
}

function attachTabsListeners() {
	if (_tabsRibbonListeners) return;
	function onKeyDown(ev) {
		if (ev.key === 'Escape') {
			const ribbon = document.getElementById('tabs-ribbon');
			if (ribbon) {
				try { document.body.removeChild(ribbon); } catch (e) {}
				detachTabsListeners();
				if (_tabsToggleElement) {
					_tabsToggleElement.classList.remove('active');
					try { _tabsToggleElement.setAttribute('aria-expanded', 'false'); } catch (e) {}
				}
				unloadCSS('tabs-css');
			}
		}
	}
	document.addEventListener('keydown', onKeyDown);
	_tabsRibbonListeners = { onKeyDown };
}

function detachTabsListeners() {
	if (!_tabsRibbonListeners) return;
	document.removeEventListener('keydown', _tabsRibbonListeners.onKeyDown);
	_tabsRibbonListeners = null;
}
