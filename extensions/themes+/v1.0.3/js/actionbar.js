import { STORAGE_KEY_SETTINGS, DEFAULT_CONFIG, DEFAULT_SHORTCUTS, DEFAULT_SHORTCUT_ICON_FALLBACK } from './config.js';


import { renderInlineIcon, getIconForUrl } from './brandIconLoader.js';
import { toggleSettingsModal, openSettingsTab } from './settingsModal.js';
import { toggleToolsModal, closeToolsModal } from './toolsModal.js';

let updateMediaUI = null;
let activeIntervals = [];

export function cleanupActionBar() {
    activeIntervals.forEach(clearInterval);
    activeIntervals = [];
}

export function updateMediaState(media, tabId = null) {

    if (updateMediaUI) updateMediaUI(media, tabId);
    else {} // console.warn('updateMediaUI not yet initialized');
}



function createUiIcon(iconPath, className = '', fallback = null) {
    const el = document.createElement('span');
    el.className = ['ui-icon', className].filter(Boolean).join(' ');
    el.setAttribute('aria-hidden', 'true');
    renderInlineIcon(el, iconPath || fallback, { fallbackSrc: fallback });
    return el;
}

export async function initActionBar(actionCfg = {}) {
    try {
        cleanupActionBar();
        const actionBar = document.getElementById('action-bar');
        if (!actionBar) {
            // console.warn('Action bar element not found');
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
            // console.warn('Action content element not found');
            return;
        }

        
        actionContent.innerHTML = '';

        
        const stored = await new Promise((resolve) => {
            try {
                chrome.storage.local.get(STORAGE_KEY_SETTINGS, (res) => {
                    resolve(res?.[STORAGE_KEY_SETTINGS] || {});
                });
            } catch (e) { resolve({}); }
        });

        const iconGroup = document.createElement('div');
        iconGroup.className = 'action-group';

        
        const actionKey = document.createElement('div');
        actionKey.className = 'action-item';
        actionKey.id = 'action-tools';
        actionKey.title = 'Tools';
        actionKey.appendChild(createUiIcon('assets/svgs-fontawesome/regular/keyboard.svg'));
        actionKey.addEventListener('click', toggleToolsModal);
        iconGroup.appendChild(actionKey);


        const tabsIcon = document.createElement('div');
        tabsIcon.className = 'action-item';
        tabsIcon.id = 'tabs-toggle';
        tabsIcon.appendChild(createUiIcon('assets/svgs-fontawesome/regular/clone.svg'));
        iconGroup.appendChild(tabsIcon);


        // Bookmark Toggle
        const bookmarkIcon = document.createElement('div');
        bookmarkIcon.className = 'action-item';
        bookmarkIcon.id = 'bookmark-toggle';
        bookmarkIcon.appendChild(createUiIcon('assets/svgs-fontawesome/solid/bookmark.svg'));
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

        
        // stored fetched above

        const shortcutsEnabled = stored.actionbar?.shortcuts?.enabled ?? actionCfg.shortcuts?.enabled ?? DEFAULT_CONFIG.actionbar.shortcuts.enabled ?? true;

        if (shortcutsEnabled) {
            const userShortcuts = stored.actionbar?.shortcuts?.items || [];
            const configured = [...DEFAULT_SHORTCUTS, ...userShortcuts];



        

        const searchbarCfg = stored.searchbar || DEFAULT_CONFIG.searchbar;
        const shortcutTarget = searchbarCfg.target || 'blank';


        function createShortcutTile(s, index) {
            const wrap = document.createElement('div');
            
            wrap.className = 'action-item shortcut-item';
            wrap.title = s.title || s.url;
            
            // Auto-discover icon if missing
            const iconPath = s.icon || getIconForUrl(s.url);
            const icon = createUiIcon(iconPath, 'shortcut-icon', DEFAULT_SHORTCUT_ICON_FALLBACK);
            wrap.appendChild(icon);

            
            wrap.addEventListener('click', (ev) => {
                ev.stopPropagation();
                const target = (shortcutTarget === 'self' || shortcutTarget === '_self') ? '_self' : '_blank';
                window.open(s.url, target);
            });
            
            // No inline actions anymore

            return wrap;
        }

        function renderShortcuts() {
            shortcutsContainer.innerHTML = '';
            
            configured.forEach((s, i) => shortcutsContainer.appendChild(createShortcutTile(s, i)));

            
            /* Add Button removed - management moved to settings */ 


            

            // Manage Button always shown to access shortcuts settings
            const manage = document.createElement('div');
            manage.className = 'action-item shortcut-manage';
            manage.appendChild(createUiIcon('assets/svgs-fontawesome/solid/pen-to-square.svg'));
            manage.title = 'Manage shortcuts';
            
            manage.addEventListener('click', (ev) => {
                ev.stopPropagation();
                document.dispatchEvent(new CustomEvent('action:settings', { detail: { tab: 'actionbar' } }));
            });
            shortcutsContainer.appendChild(manage);

        }

            renderShortcuts();
            actionContent.appendChild(shortcutsContainer);
        }



        
        // Media Controls Group
        const mediaGroup = document.createElement('div');
        mediaGroup.id = 'media-control';
        mediaGroup.className = 'action-group media-controls';
        mediaGroup.innerHTML = `
            <img class="media-poster">
            <div class="media-meta">
                <span class="media-title">No Media</span>
                <span class="media-duration"></span>
            </div>
            <div class="media-buttons">
                <button class="media-btn" id="media-prev" title="Previous">
                    <span class="ui-icon"></span>
                </button>
                <button class="media-btn" id="media-play" title="Play/Pause">
                    <span class="ui-icon"></span>
                </button>
                <button class="media-btn" id="media-next" title="Next">
                    <span class="ui-icon"></span>
                </button>
            </div>
        `;
        // Icons
        renderInlineIcon(mediaGroup.querySelector('#media-prev .ui-icon'), 'assets/svgs-fontawesome/solid/backward-step.svg');
        renderInlineIcon(mediaGroup.querySelector('#media-play .ui-icon'), 'assets/svgs-fontawesome/solid/play.svg');
        renderInlineIcon(mediaGroup.querySelector('#media-next .ui-icon'), 'assets/svgs-fontawesome/solid/forward-step.svg');

        // Logic
        const mPoster = mediaGroup.querySelector('.media-poster');
        const mTitle = mediaGroup.querySelector('.media-title');
        const mDuration = mediaGroup.querySelector('.media-duration');
        const mPlayBtn = mediaGroup.querySelector('#media-play');
        const mPrevBtn = mediaGroup.querySelector('#media-prev');
        const mNextBtn = mediaGroup.querySelector('#media-next');
        const mPlayIcon = mPlayBtn.querySelector('.ui-icon');

        let currentMedia = null;
        let currentMediaTabId = null;

        // Click on media group to switch to media tab
        mediaGroup.addEventListener('click', (e) => {
            // Don't switch if clicking on buttons
            if (e.target.closest('.media-btn')) return;
            
            // Ask service worker to activate the current priority tab
            chrome.runtime.sendMessage({ type: 'MEDIA_CONTROL', action: 'activate_tab' });
        });

        mPlayBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const action = currentMedia && currentMedia.isPlaying ? 'pause' : 'play';
            chrome.runtime.sendMessage({ type: 'MEDIA_CONTROL', action });
            // Optimistic
             if (currentMedia) {
                currentMedia.isPlaying = !currentMedia.isPlaying;
                refreshUI(currentMedia);
            }
        });

        mNextBtn.addEventListener('click', (e) => {
             e.stopPropagation();
             chrome.runtime.sendMessage({ type: 'MEDIA_CONTROL', action: 'next' });
        });

        mPrevBtn.addEventListener('click', (e) => {
             e.stopPropagation();
             chrome.runtime.sendMessage({ type: 'MEDIA_CONTROL', action: 'prev' });
        });

        const getPlatformIcon = (platform) => {
            if (!platform) return 'assets/svgs-fontawesome/solid/music.svg';
            if (platform.includes('spotify')) return 'assets/svgs-fontawesome/brands/spotify.svg';
            if (platform.includes('youtube')) return 'assets/svgs-fontawesome/brands/youtube.svg';
            if (platform.includes('soundcloud')) return 'assets/svgs-fontawesome/brands/soundcloud.svg';
            return 'assets/svgs-fontawesome/solid/music.svg';
        };

        function refreshUI(media, tabId = null) {
            // console.log('[ActionBar] refreshUI called with:', media, 'tabId:', tabId);
            currentMedia = media;
            currentMediaTabId = tabId;
            if (!media) {
                mediaGroup.classList.remove('active');
                setTimeout(() => { if(!currentMedia) mediaGroup.style.display = 'none'; }, 300);
                return;
            }
            // Ensure visible
            mediaGroup.style.display = 'flex';
            // force reflow
            void mediaGroup.offsetWidth;
            mediaGroup.classList.add('active');

            mTitle.textContent = media.title || 'Unknown';
            
            // Display time as "current / duration" or just duration if no current time
            if (media.currentTime && media.duration) {
                mDuration.textContent = `${media.currentTime} / ${media.duration}`;
            } else if (media.duration) {
                mDuration.textContent = media.duration;
            } else {
                mDuration.textContent = '';
            }
            
            // Fallback Logic
            if (media.thumbnail) {
                 mPoster.src = media.thumbnail;
                 mPoster.style.backgroundColor = 'var(--color-off)';
            } else {
                 // Use platform icon
                 mPoster.src = getPlatformIcon(media.platform);
                 mPoster.style.backgroundColor = 'transparent';
            }

            if (media.isPlaying) mPoster.classList.add('playing');
            else mPoster.classList.remove('playing');

            renderInlineIcon(mPlayIcon, media.isPlaying ? 'assets/svgs-fontawesome/solid/pause.svg' : 'assets/svgs-fontawesome/solid/play.svg');
        }

        updateMediaUI = refreshUI;

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
        actionContent.appendChild(mediaGroup);

        // Clock Group - Always rightmost
        const clockGroup = document.createElement('div');
        clockGroup.className = 'action-group clock-group';
        clockGroup.innerHTML = `
            <div class="action-item clock-display">
                <span class="clock-time">--:--</span>
            </div>
        `;

        // Get time format from settings (12 or 24 hour)
        const clockEnabled = stored.clock?.enabled ?? actionCfg.clock?.enabled ?? true;
        const use24Hour = (stored.clock?.format || actionCfg.clock?.format || '12') === '24';

        function updateClock() {
            const now = new Date();
            let hours = now.getHours();
            const minutes = now.getMinutes().toString().padStart(2, '0');
            
            if (use24Hour) {
                // 24-hour format
                clockGroup.querySelector('.clock-time').textContent = `${hours.toString().padStart(2, '0')}:${minutes}`;
            } else {
                // 12-hour format with AM/PM
                const ampm = hours >= 12 ? 'PM' : 'AM';
                hours = hours % 12 || 12; // Convert 0 to 12
                clockGroup.querySelector('.clock-time').textContent = `${hours.toString().padStart(2, '0')}:${minutes} ${ampm}`;
            }
        }

        // Update clock immediately and every second
        if (clockEnabled) {
            updateClock();
            activeIntervals.push(setInterval(updateClock, 1000));
            actionContent.appendChild(clockGroup);
        }

        // Date Group
        const dateEnabled = stored.date?.enabled ?? actionCfg.date?.enabled ?? false;
        if (dateEnabled) {
            const dateGroup = document.createElement('div');
            dateGroup.className = 'action-group date-group';
            dateGroup.innerHTML = `
                <div class="action-item date-display">
                    <div class="date-content">
                        <span class="date-short"></span>
                        <span class="date-full"></span>
                    </div>
                </div>
            `;

            function updateDate() {
                const now = new Date();
                const options = { weekday: 'short', month: 'short', day: 'numeric' };
                const dateStr = now.toLocaleDateString('en-US', options);
                
                // Full date for hover
                const fullOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
                const fullDateStr = now.toLocaleDateString('en-US', fullOptions);
                
                const dateDisplay = dateGroup.querySelector('.date-display');
                dateDisplay.querySelector('.date-short').textContent = dateStr;
                dateDisplay.querySelector('.date-full').textContent = fullDateStr;
            }

            updateDate();
            activeIntervals.push(setInterval(updateDate, 60000)); // Update every minute
            actionContent.appendChild(dateGroup);
        }

        // Alarm Group
        const alarmEnabled = stored.alarm?.enabled ?? actionCfg.alarm?.enabled ?? false;
        if (alarmEnabled) {
            const alarmGroup = document.createElement('div');
            alarmGroup.className = 'action-group alarm-group';
            // Removed action-item class to avoid fixed width button constraints
            alarmGroup.innerHTML = `
                <div class="alarm-icon"></div>
                <span class="alarm-text">No alarms</span>
            `;

            // Render alarm icon
            renderInlineIcon(alarmGroup.querySelector('.alarm-icon'), 'assets/svgs-fontawesome/regular/bell.svg');

            // Fetch and display next alarm
            async function updateAlarmDisplay() {
                try {
                    // Fetch alarms from localStorage (where alarm modal stores them)
                    const raw = localStorage.getItem('alarms_list_v1');
                    const alarms = raw ? JSON.parse(raw) : [];
                    const alarmText = alarmGroup.querySelector('.alarm-text');
                    

                    
                    if (alarms && alarms.length > 0) {
                        // Filter for active alarms only (using 'on' property)
                        const activeAlarms = alarms.filter(alarm => alarm.on);
                        
                        if (activeAlarms.length > 0) {
                            // Find the next alarm (earliest scheduled time)
                            const now = new Date();
                            const nextAlarm = activeAlarms.reduce((earliest, alarm) => {
                                // Parse alarm time from hour/minute properties
                                const alarmDate = new Date();
                                alarmDate.setHours(alarm.hour, alarm.minute, 0, 0);
                                
                                // If alarm time has passed today, it's for tomorrow
                                if (alarmDate < now) {
                                    alarmDate.setDate(alarmDate.getDate() + 1);
                                }
                                
                                if (!earliest) return { ...alarm, scheduledTime: alarmDate };
                                
                                const earliestDate = earliest.scheduledTime;
                                return alarmDate < earliestDate ? { ...alarm, scheduledTime: alarmDate } : earliest;
                            }, null);

                            // Format the alarm time
                            const use24Hour = (stored.clock?.format || actionCfg.clock?.format || '12') === '24';
                            const hours = nextAlarm.hour;
                            const minutes = nextAlarm.minute;
                            
                            let timeStr;
                            if (use24Hour) {
                                timeStr = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
                            } else {
                                const ampm = hours >= 12 ? 'PM' : 'AM';
                                const displayHours = hours % 12 || 12;
                                timeStr = `${displayHours}:${minutes.toString().padStart(2, '0')} ${ampm}`;
                            }

                            // Show alarm label and time (using 'label' property)
                            alarmText.textContent = nextAlarm.label ? `${nextAlarm.label} - ${timeStr}` : timeStr;
                        } else {
                            alarmText.textContent = 'No active alarms';
                        }
                    } else {
                        alarmText.textContent = 'No alarms';
                    }
                } catch (e) {
                    // console.warn('[ActionBar] Failed to fetch alarms:', e);
                    alarmGroup.querySelector('.alarm-text').textContent = 'No alarms';
                }
            }

            updateAlarmDisplay();
            updateAlarmDisplay();
            // Update every minute
            activeIntervals.push(setInterval(updateAlarmDisplay, 60000));
            // Listen for realtime updates from alarm modal
            document.addEventListener('alarms-updated', updateAlarmDisplay);
            
            actionContent.appendChild(alarmGroup);
        }

        // Weather Group
        const weatherEnabled = stored.actionbar?.weather?.enabled ?? actionCfg.weather?.enabled ?? false;
        const weatherKey = stored.actionbar?.weather?.apiKey;

        if (weatherEnabled && weatherKey) {
            const weatherGroup = document.createElement('div');
            weatherGroup.className = 'action-group weather-group';
            weatherGroup.title = 'Click to force refresh';
            // Structure matching alarm-group
            weatherGroup.innerHTML = `
                <div class="weather-icon"></div>
                <span class="weather-text">--</span>
            `;
            
            const wIcon = weatherGroup.querySelector('.weather-icon');
            const wText = weatherGroup.querySelector('.weather-text');

            // Icon Mapping
            const getIcon = (code) => {
                if (code >= 200 && code < 300) return 'assets/svgs-fontawesome/solid/cloud-bolt.svg';
                if (code >= 300 && code < 600) return 'assets/svgs-fontawesome/solid/cloud-rain.svg';
                if (code >= 600 && code < 700) return 'assets/svgs-fontawesome/solid/snowflake.svg';
                if (code >= 700 && code < 800) return 'assets/svgs-fontawesome/solid/smog.svg';
                if (code === 800) return 'assets/svgs-fontawesome/solid/sun.svg';
                if (code > 800) return 'assets/svgs-fontawesome/solid/cloud.svg';
                return 'assets/svgs-fontawesome/solid/cloud.svg';
            };

            const renderWeatherData = (data) => {
                if (!data || !data.main) return;
                
                const cfg = stored.actionbar?.weather || {};
                const isImp = cfg.units === 'imperial';
                const tempUnit = isImp ? '°F' : '°C';
                const speedUnit = isImp ? 'mph' : 'm/s';

                const temp = Math.round(data.main.temp);
                
                // Icon
                if (data.weather && data.weather[0]) {
                    const code = data.weather[0].id;
                    const iconCode = data.weather[0].icon;
                    let iconPath = getIcon(code);
                    if (code === 800 && iconCode.endsWith('n')) iconPath = 'assets/svgs-fontawesome/solid/moon.svg';
                    if (code > 800 && iconCode.endsWith('n')) iconPath = 'assets/svgs-fontawesome/solid/cloud-moon.svg';
                    
                    renderInlineIcon(wIcon, iconPath);
                }

                // Construct Text HTML
                wText.innerHTML = ''; // Clear

                // Temp
                const tempCheck = document.createElement('span');
                tempCheck.className = 'weather-temp';
                tempCheck.textContent = `${temp}${tempUnit}`;
                wText.appendChild(tempCheck);

                // Helper for divider
                const addDivider = () => {
                    const span = document.createElement('span');
                    span.className = 'weather-divider'; // CSS opcional if needed, otherwise just text
                    span.style.margin = '0 5px';
                    span.textContent = '|';
                    wText.appendChild(span);
                };

                if (cfg.showFeelsLike) {
                    addDivider();
                    const sp = document.createElement('span');
                    sp.textContent = `Feels Like ${Math.round(data.main.feels_like)}°`;
                    wText.appendChild(sp);
                }
                
                if (cfg.showHumidity) {
                    addDivider();
                    const sp = document.createElement('span');
                    sp.style.display = 'inline-flex';
                    sp.style.alignItems = 'center';
                    
                    const ico = document.createElement('span');
                    ico.className = 'ui-icon';
                    ico.style.width = '10px';
                    ico.style.height = '10px';
                    ico.style.marginRight = '3px';
                    // We must use renderInlineIcon. 
                    renderInlineIcon(ico, 'assets/svgs-fontawesome/solid/droplet.svg', {fallbackSrc: 'assets/svgs-fontawesome/solid/water.svg'});
                    
                    sp.appendChild(ico);
                    sp.appendChild(document.createTextNode(`${data.main.humidity}%`));
                    wText.appendChild(sp);
                }

                if (cfg.showWind && data.wind) {
                    addDivider();
                    const sp = document.createElement('span');
                    sp.style.display = 'inline-flex';
                    sp.style.alignItems = 'center';

                    const ico = document.createElement('span');
                    ico.className = 'ui-icon';
                    ico.style.width = '10px';
                    ico.style.height = '10px';
                    ico.style.marginRight = '3px';
                    renderInlineIcon(ico, 'assets/svgs-fontawesome/solid/wind.svg');
                    
                    sp.appendChild(ico);
                    sp.appendChild(document.createTextNode(`${Math.round(data.wind.speed)}${speedUnit}`));
                    wText.appendChild(sp);
                }
            };

            const fetchWeather = async () => {
                try {
                     const cfg = stored.actionbar?.weather || {};
                     const currentUnits = cfg.units || 'metric';

                     // Check cache first
                     const cache = await new Promise(r => chrome.storage.local.get('weatherData', d => r(d.weatherData)));
                     const now = Date.now();
                     
                     // Valid if < 15 mins AND units match
                     if (cache && (now - cache.timestamp < 900000) && cache.data && cache.units === currentUnits) {
                         renderWeatherData(cache.data);
                         return;
                     } 

                     let url = '';
                     if (cfg.city) {
                         url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(cfg.city)}&appid=${weatherKey}&units=${currentUnits}`;
                     } else {
                         // Geo
                         const pos = await new Promise((resolve, reject) => {
                             navigator.geolocation.getCurrentPosition(resolve, reject);
                         });
                         url = `https://api.openweathermap.org/data/2.5/weather?lat=${pos.coords.latitude}&lon=${pos.coords.longitude}&appid=${weatherKey}&units=${currentUnits}`;
                     }

                     const res = await fetch(url);
                     if (!res.ok) throw new Error(res.statusText);
                     const data = await res.json();

                     // Save with Units
                     const toStore = { timestamp: now, units: currentUnits, data };
                     chrome.storage.local.set({ weatherData: toStore });
                     renderWeatherData(data);

                } catch (e) {
                    // console.error('Weather fetch failed', e);
                    wText.textContent = 'Err';
                }
            };

            // Initial fetch
            fetchWeather();

            // Listener for cross-tab updates
            const storageListener = (changes, area) => {
                if (area === 'local' && changes.weatherData) {
                    const newVal = changes.weatherData.newValue;
                    if (newVal && newVal.data) {
                        renderWeatherData(newVal.data);
                    }
                }
            };
            chrome.storage.onChanged.addListener(storageListener);

            // Click to force refresh
            weatherGroup.addEventListener('click', async () => {
                wText.textContent = '...';
                await chrome.storage.local.remove('weatherData');
                fetchWeather();
            });

            actionContent.appendChild(weatherGroup);
        }


            

        // Apply Display Style (Centralised vs Spread)
        const displayStyle = stored.actionbar?.display_style || 'centralised';
        if (displayStyle === 'spread') {
            const leftDiv = document.createElement('div'); leftDiv.className = 'ab-section-left';
            const centerDiv = document.createElement('div'); centerDiv.className = 'ab-section-center';
            const rightDiv = document.createElement('div'); rightDiv.className = 'ab-section-right';

            // Iterate through existing children (move them)
            const children = Array.from(actionContent.children);
            children.forEach(child => {
                if (child.id === 'media-control') {
                    leftDiv.appendChild(child);
                } else if (child.classList.contains('clock-group') || 
                           child.classList.contains('date-group') || 
                           child.classList.contains('alarm-group') || 
                           child.classList.contains('weather-group')) {
                    rightDiv.appendChild(child);
                } else {
                    // Defaults (Icons, Shortcuts, Tools)
                    centerDiv.appendChild(child);
                }
            });

            // Re-populate in order
            actionContent.appendChild(leftDiv);
            actionContent.appendChild(centerDiv);
            actionContent.appendChild(rightDiv);
        }

            // Restore active states if modals are open (in case of re-render)
            if (document.getElementById('settings-modal')) {
                 const btn = document.getElementById('action-settings');
                 if (btn) btn.classList.add('active');
            }
            if (document.getElementById('timer-modal')) {
                 const btn = document.getElementById('action-timer');
                 if (btn) btn.classList.add('active');
            }
            if (document.getElementById('alarm-modal')) {
                 const btn = document.getElementById('action-alarm');
                 if (btn) btn.classList.add('active');
            }
            // Notes modal backdrop check (since modal might be inside backdrop)
            if (document.querySelector('.notes-modal-backdrop')) {
                 const btn = document.getElementById('action-notes');
                 if (btn) btn.classList.add('active');
            }
            // Tabs Ribbon
            if (document.getElementById('tabs-ribbon-container')) {
                 const btn = document.getElementById('tabs-toggle');
                 if (btn) btn.classList.add('active');
            }
            // Bookmarks Panel
            if (document.getElementById('bookmarks-panel')) {
                 const btn = document.getElementById('bookmark-toggle');
                 if (btn) btn.classList.add('active');
            }

    } catch (e) {
        // console.error('Failed to initialize action bar', e);
    }
}
