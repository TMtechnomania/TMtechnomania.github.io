import { STORAGE_KEY_SETTINGS, DEFAULT_CONFIG } from './config.js';
import { renderInlineIcon } from './brandIconLoader.js';

const DEFAULT_SHORTCUTS = [
    { id: 's_chrome', title: 'Chrome Web Store', url: 'https://chrome.google.com/webstore', icon: 'assets/svgs-fontawesome/brands/chrome.svg', builtin: true },
    { id: 's_youtube', title: 'YouTube', url: 'https://www.youtube.com', icon: 'assets/svgs-fontawesome/brands/youtube.svg', builtin: true },
    { id: 's_dribbble', title: 'Dribbble', url: 'https://dribbble.com', icon: 'assets/svgs-fontawesome/brands/dribbble.svg', builtin: true },
    { id: 's_mdn', title: 'MDN Web Docs', url: 'https://developer.mozilla.org', icon: 'assets/svgs-fontawesome/brands/firefox-browser.svg', builtin: true }
];

const DEFAULT_SHORTCUT_ICON_FALLBACK = 'assets/svgs-fontawesome/regular/compass.svg';

function createUiIcon(iconPath, className = '', fallback = null) {
    const el = document.createElement('span');
    el.className = ['ui-icon', className].filter(Boolean).join(' ');
    el.setAttribute('aria-hidden', 'true');
    renderInlineIcon(el, iconPath || fallback, { fallbackSrc: fallback });
    return el;
}

export async function initActionBar(actionCfg = {}) {
    try {
        const actionBar = document.getElementById('action-bar');
        if (!actionBar) {
            console.warn('Action bar element not found');
            return;
        }

        const autohide = actionCfg.autohide !== false; 

        if (!autohide) {
            
            actionBar.style.bottom = '0';
        } else {
            
            actionBar.style.removeProperty('bottom');
        }

        
        const actionContent = document.getElementById('action-content');
        if (!actionContent) {
            console.warn('Action content element not found');
            return;
        }

        
        actionContent.innerHTML = '';

        
        const iconGroup = document.createElement('div');
        iconGroup.className = 'action-group';

        
        const actionKey = document.createElement('div');
        actionKey.className = 'action-item';
        actionKey.appendChild(createUiIcon('assets/svgs-fontawesome/regular/keyboard.svg'));
        iconGroup.appendChild(actionKey);


        const tabsIcon = document.createElement('div');
        tabsIcon.className = 'action-item';
        tabsIcon.appendChild(createUiIcon('assets/svgs-fontawesome/regular/clone.svg'));
        iconGroup.appendChild(tabsIcon);


        const bookmarkIcon = document.createElement('div');
        bookmarkIcon.className = 'action-item';
        bookmarkIcon.id = 'bookmark-toggle';
        bookmarkIcon.appendChild(createUiIcon('assets/svgs-fontawesome/regular/bookmark.svg'));
        iconGroup.appendChild(bookmarkIcon);

        
        const fullscreenIcon = document.createElement('div');
        fullscreenIcon.className = 'action-item';
        fullscreenIcon.id = 'fullscreen-toggle';
        fullscreenIcon.appendChild(createUiIcon('assets/svgs-fontawesome/solid/expand.svg'));
        iconGroup.appendChild(fullscreenIcon);

        actionContent.appendChild(iconGroup);

        
        const shortcutsContainer = document.createElement('div');
        shortcutsContainer.id = 'shortcuts-container';
        shortcutsContainer.className = 'action-group';

        
        const stored = await new Promise((resolve) => {
            try {
                chrome.storage.local.get(STORAGE_KEY_SETTINGS, (res) => {
                    resolve(res?.[STORAGE_KEY_SETTINGS] || {});
                });
            } catch (e) { resolve({}); }
        });

        const configured = Array.isArray(stored.shortcuts) && stored.shortcuts.length ? stored.shortcuts : DEFAULT_SHORTCUTS.slice();

        
        const searchbarCfg = stored.searchbar || DEFAULT_CONFIG.searchbar;
        const shortcutTarget = searchbarCfg.target || 'blank';

        function saveShortcuts(arr) {
            const toSave = {};
            toSave[STORAGE_KEY_SETTINGS] = { ...(stored || {}), shortcuts: arr };
            try {
                chrome.storage.local.set(toSave);
            } catch (e) {
                console.warn('Failed to save shortcuts', e);
            }
        }

        function createShortcutTile(s, index) {
            const wrap = document.createElement('div');
            
            wrap.className = 'action-item shortcut-item';
            wrap.title = s.title || s.url;

            const icon = createUiIcon(s.icon, 'shortcut-icon', DEFAULT_SHORTCUT_ICON_FALLBACK);
            wrap.appendChild(icon);

            
            wrap.addEventListener('click', (ev) => {
                ev.stopPropagation();
                const target = (shortcutTarget === 'self' || shortcutTarget === '_self') ? '_self' : '_blank';
                window.open(s.url, target);
            });

            
            const actions = document.createElement('div');
            actions.className = 'shortcut-actions';
            if (!s.builtin) {
                const edit = document.createElement('button');
                edit.className = 'shortcut-action-btn';
                edit.appendChild(createUiIcon('assets/svgs-fontawesome/regular/pen-to-square.svg', 'shortcut-action-icon'));
                edit.title = 'Edit shortcut';
                edit.addEventListener('click', (ev) => {
                    ev.stopPropagation();
                    const newTitle = prompt('Shortcut title', s.title) || s.title;
                    const newUrl = prompt('Shortcut URL', s.url) || s.url;
                    const newIcon = prompt('Icon URL (optional)', s.icon || '') || s.icon;
                    configured[index] = { ...configured[index], title: newTitle, url: newUrl, icon: newIcon };
                    saveShortcuts(configured);
                    
                    renderShortcuts();
                });
                actions.appendChild(edit);

                const del = document.createElement('button');
                del.className = 'shortcut-action-btn';
                del.appendChild(createUiIcon('assets/svgs-fontawesome/regular/trash-can.svg', 'shortcut-action-icon'));
                del.title = 'Delete shortcut';
                del.addEventListener('click', (ev) => {
                    ev.stopPropagation();
                    if (!confirm(`Delete shortcut "${s.title}"?`)) return;
                    configured.splice(index, 1);
                    saveShortcuts(configured);
                    renderShortcuts();
                });
                actions.appendChild(del);
            }

            wrap.appendChild(actions);
            return wrap;
        }

        function renderShortcuts() {
            shortcutsContainer.innerHTML = '';
            
            configured.slice(0, 4).forEach((s, i) => shortcutsContainer.appendChild(createShortcutTile(s, i)));

            
            const add = document.createElement('div');
            add.className = 'action-item shortcut-add';
            add.appendChild(createUiIcon('assets/svgs-fontawesome/solid/plus.svg'));
            add.title = 'Add shortcut';
            add.addEventListener('click', (ev) => {
                ev.stopPropagation();
                const title = prompt('Shortcut title (eg. My Site)');
                const url = prompt('Shortcut URL (eg. https://example.com)');
                if (!url) return;
                const icon = prompt('Icon URL (optional)') || '';
                const newS = { id: `user_${Date.now()}`, title: title || url, url, icon, builtin: false };
                configured.push(newS);
                saveShortcuts(configured);
                renderShortcuts();
            });
            shortcutsContainer.appendChild(add);

            
            const hasUser = configured.some(s => !s.builtin);
            if (hasUser) {
                    const manage = document.createElement('div');
                    manage.className = 'action-item shortcut-manage';
                manage.appendChild(createUiIcon('assets/svgs-fontawesome/solid/gear.svg'));
                manage.title = 'Manage shortcuts';
                manage.addEventListener('click', (ev) => {
                    ev.stopPropagation();
                    
                    const list = configured.map((s, idx) => `${idx+1}. ${s.title} — ${s.url}`).join('\n');
                    alert('Current shortcuts:\n' + list);
                });
                shortcutsContainer.appendChild(manage);
            }
        }

        renderShortcuts();
        actionContent.appendChild(shortcutsContainer);

        
        const thirdGroup = document.createElement('div');
        thirdGroup.className = 'action-group';

        const makeAction = (id, title, iconPath, eventName) => {
            const el = document.createElement('div');
            el.className = 'action-item';
            el.id = id;
            el.title = title;
            el.setAttribute('role', 'button');
            el.setAttribute('tabindex', '0');
            el.appendChild(createUiIcon(iconPath));

            const trigger = (ev) => {
                ev && ev.stopPropagation && ev.stopPropagation();
                
                try {
                    document.dispatchEvent(new CustomEvent(eventName, { detail: { id, title } }));
                } catch (e) {  }
            };

            el.addEventListener('click', trigger);
            el.addEventListener('keydown', (k) => { if (k.key === 'Enter' || k.key === ' ') { k.preventDefault(); trigger(k); } });
            return el;
        };

        thirdGroup.appendChild(makeAction('action-timer', 'Timer/Stopwatch', 'assets/svgs-fontawesome/regular/clock.svg', 'action:timer'));
        thirdGroup.appendChild(makeAction('action-alarm', 'Alarm', 'assets/svgs-fontawesome/regular/bell.svg', 'action:alarm'));
        thirdGroup.appendChild(makeAction('action-notes', 'Notes', 'assets/svgs-fontawesome/regular/note-sticky.svg', 'action:notes'));
        thirdGroup.appendChild(makeAction('action-settings', 'Settings', 'assets/svgs-fontawesome/solid/gear.svg', 'action:settings'));

        actionContent.appendChild(thirdGroup);

        console.log('Action bar initialized, autohide:', autohide);
    } catch (e) {
        console.error('Failed to initialize action bar', e);
    }
}
