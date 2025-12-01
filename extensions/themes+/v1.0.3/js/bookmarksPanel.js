import { loadCSS, unloadCSS } from './cssLoader.js';
import { renderBrandIcon, renderInlineIcon } from './brandIconLoader.js';

let _bookmarksAutoCloseInterval = null;
let _bookmarksAutoCloseListeners = null;
const BOOKMARKS_AUTO_CLOSE_MS = 30000;
let _bookmarkToggleElement = null;

export function setBookmarkToggleElement(el) {
	_bookmarkToggleElement = el;
}

export async function toggleBookmarksPanel() {
	const existing = document.getElementById('bookmarks-panel');
	if (existing) {
		try { document.body.removeChild(existing); } catch (e) {}
		detachBookmarksAutoClose();
		if (_bookmarkToggleElement) {
			_bookmarkToggleElement.classList.remove('active');
			try { _bookmarkToggleElement.setAttribute('aria-expanded', 'false'); } catch (e) {}
			try { _bookmarkToggleElement.focus(); } catch (e) {}
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

	const expandBtn = document.createElement('button');
	expandBtn.className = 'bookmarks-expand';
	expandBtn.title = 'Expand';
	const expandIcon = document.createElement('span');
	expandIcon.className = 'ui-icon bookmarks-expand-icon';
	expandIcon.setAttribute('aria-hidden', 'true');
	renderInlineIcon(expandIcon, 'assets/svgs-fontawesome/solid/expand.svg');
	expandBtn.appendChild(expandIcon);
	header.appendChild(expandBtn);

	const closeBtn = document.createElement('button');
	closeBtn.className = 'bookmarks-close';
	closeBtn.textContent = 'Close';
	header.appendChild(closeBtn);

	panel.appendChild(header);

	expandBtn.addEventListener('click', () => {
		panel.classList.toggle('expanded');
		const isExpanded = panel.classList.contains('expanded');
		expandBtn.title = isExpanded ? 'Compress' : 'Expand';
		const iconName = isExpanded ? 'compress' : 'expand';
		renderInlineIcon(expandIcon, `assets/svgs-fontawesome/solid/${iconName}.svg`);
	});

	const results = document.createElement('div');
	results.className = 'bookmarks-search-results';
	results.style.display = 'none';
	panel.appendChild(results);

	const list = document.createElement('div');
	list.className = 'bookmarks-list';
	panel.appendChild(list);

	document.body.appendChild(panel);
	if (_bookmarkToggleElement) {
		_bookmarkToggleElement.classList.add('active');
		try { _bookmarkToggleElement.setAttribute('aria-expanded', 'true'); } catch (e) {}
	}

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

		const fav = document.createElement('span');
		fav.className = 'bookmark-icon brand-icon';
		fav.setAttribute('aria-hidden', 'true');
		renderBrandIcon(fav, n.url);

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
		const copyIcon = document.createElement('span');
		copyIcon.className = 'ui-icon bookmark-action-icon';
		copyIcon.setAttribute('aria-hidden', 'true');
		renderInlineIcon(copyIcon, 'assets/svgs-fontawesome/solid/link.svg');
		copyBtn.appendChild(copyIcon);
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
		const shareIcon = document.createElement('span');
		shareIcon.className = 'ui-icon bookmark-action-icon';
		shareIcon.setAttribute('aria-hidden', 'true');
		renderInlineIcon(shareIcon, 'assets/svgs-fontawesome/regular/share-from-square.svg');
		shareBtn.appendChild(shareIcon);
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
		const openIcon = document.createElement('span');
		openIcon.className = 'ui-icon bookmark-action-icon';
		openIcon.setAttribute('aria-hidden', 'true');
		renderInlineIcon(openIcon, 'assets/svgs-fontawesome/solid/external-link.svg');
		openBtn.appendChild(openIcon);
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
	if (tree && tree[0] && tree[0].children) {
		renderTree(tree[0].children, list);
	} else {
		renderTree(tree, list);
	}

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
		if (_bookmarkToggleElement) {
			_bookmarkToggleElement.classList.remove('active');
			try { _bookmarkToggleElement.setAttribute('aria-expanded', 'false'); } catch (e) {}
			try { _bookmarkToggleElement.focus(); } catch (e) {}
		}
	});

	panel.addEventListener('keydown', (ev) => {
		if (ev.key === 'Escape') {
			try { document.body.removeChild(panel); } catch (e) {}
			if (_bookmarkToggleElement) {
				_bookmarkToggleElement.classList.remove('active');
				try { _bookmarkToggleElement.setAttribute('aria-expanded', 'false'); } catch (e) {}
				try { _bookmarkToggleElement.focus(); } catch (e) {}
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
						if (_bookmarkToggleElement) {
							_bookmarkToggleElement.classList.remove('active');
							try { _bookmarkToggleElement.setAttribute('aria-expanded', 'false'); } catch (e) {}
							try { _bookmarkToggleElement.focus(); } catch (e) {}
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

export function hasBookmarksPermission() {
	return new Promise((resolve) => {
		if (!chrome.permissions || !chrome.permissions.contains) return resolve(false);
		chrome.permissions.contains({ permissions: ['bookmarks'] }, (res) => resolve(!!res));
	});
}

export function requestBookmarksPermission() {
	return new Promise((resolve) => {
		if (!chrome.permissions || !chrome.permissions.request) return resolve(false);
		chrome.permissions.request({ permissions: ['bookmarks'] }, (granted) => resolve(!!granted));
	});
}
