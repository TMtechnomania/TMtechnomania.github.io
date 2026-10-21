import {
	DEFAULT_CONFIG,
	DEFAULT_SHORTCUTS,
	DEFAULT_SHORTCUT_ICON_FALLBACK,
} from "./config.js";
import { updateSettings } from "./settingsSync.js";
import { storageGetSync } from "./storageUtil.js";
import { getWeather, getWmoIcon, getPlaceLabel } from "./weather.js";

import { renderInlineIcon, getIconForUrl } from "./brandIconLoader.js";
import {
	openSafeUrl,
	makeButtonLike,
	SHORTCUT_URL_PROTOCOLS,
} from "./uiUtil.js";
import {
	initFamCam,
	destroyFamCam,
	toggleFlash,
	handleSnap,
	updateFamCamConfig,
} from "./famcam.js";
import { toggleAmbientMode } from "./ambientMode.js";
// Imports removed as they are now handled via event delegation in newtab.js

let updateMediaUI = null;
let activeIntervals = [];
// Listener handles kept so cleanupActionBar() can detach them on rebuild.
let actionBarRuntimeListener = null;
let actionBarAlarmsListener = null;
let actionBarStorageListener = null;
let actionBarWallpaperListener = null;
let actionBarFocusListener = null;
let _syncWallpaperInfo = { type: null, mode: null };
let _syncNeed = false;
// Latest media snapshot, replayed after a rebuild so the widget does not go
// blank until the next MEDIA_UPDATE/MEDIA_PRESENCE message.
let lastMediaState = null;

export function cleanupActionBar() {
	activeIntervals.forEach(clearInterval);
	activeIntervals = [];
	if (actionBarRuntimeListener) {
		try {
			chrome.runtime.onMessage.removeListener(actionBarRuntimeListener);
		} catch (e) {}
		actionBarRuntimeListener = null;
	}
	if (actionBarAlarmsListener) {
		try {
			document.removeEventListener(
				"alarms-updated",
				actionBarAlarmsListener,
			);
		} catch (e) {}
		actionBarAlarmsListener = null;
	}
	if (actionBarStorageListener) {
		try {
			chrome.storage.onChanged.removeListener(actionBarStorageListener);
		} catch (e) {}
		actionBarStorageListener = null;
	}
	if (actionBarWallpaperListener) {
		try {
			document.removeEventListener(
				"wallpaper:rendered",
				actionBarWallpaperListener,
			);
		} catch (e) {}
		actionBarWallpaperListener = null;
	}
	if (actionBarFocusListener) {
		try {
			window.removeEventListener("focus", actionBarFocusListener);
		} catch (e) {}
		actionBarFocusListener = null;
	}
	// The old closure points at removed DOM; drop it until init reassigns it.
	updateMediaUI = null;
	try {
		destroyFamCam();
	} catch (e) {}
	try {
		delete window.updateFamCamConfig;
	} catch (e) {}
}

export function updateMediaState(media, tabId = null) {
	lastMediaState = { media, tabId };
	if (updateMediaUI) updateMediaUI(media, tabId);
}

function createUiIcon(iconPath, className = "", fallback = null) {
	const el = document.createElement("span");
	el.className = className || "";
	el.setAttribute("aria-hidden", "true");
	renderInlineIcon(el, iconPath || fallback, { fallbackSrc: fallback });
	return el;
}

export async function initActionBar(actionCfg = {}, rootSettings = null) {
	try {
		cleanupActionBar();
		const actionBar = document.getElementById("action-bar");
		if (!actionBar) {
			// console.warn('Action bar element not found');
			return;
		}

		// Never re-read chrome.storage here: the settings panel saves through a
		// debounced queue, so storage can still hold the previous value. Callers
		// pass the live settings object (or at least the action-bar section),
		// which is always authoritative and up to date.
		const root =
			rootSettings && typeof rootSettings === "object" ? rootSettings : {};
		const barCfg = actionCfg || root.actionbar || {};

		const autohide = barCfg.autohide !== false;

		if (!autohide) {
			actionBar.style.bottom = "0";
		} else {
			actionBar.style.removeProperty("bottom");
		}

		const actionContent = document.getElementById("action-content");
		if (!actionContent) {
			// console.warn('Action content element not found');
			return;
		}

		actionContent.innerHTML = "";

		const iconGroup = document.createElement("div");
		iconGroup.className = "action-group";

		const actionKey = document.createElement("div");
			actionKey.className = "btn btn-icon";
			actionKey.id = "action-tools";
			actionKey.title = "Tools";
			actionKey.appendChild(
				createUiIcon("assets/svgs-fontawesome/solid/keyboard.svg"),
			);
			actionKey.addEventListener("click", (e) => {
				e.stopPropagation();
				document.dispatchEvent(new CustomEvent("action:tools"));
			});
		iconGroup.appendChild(actionKey);

		const tabsIcon = document.createElement("div");
		tabsIcon.className = "btn btn-icon";
		tabsIcon.id = "tabs-toggle";
		tabsIcon.title = "Tabs";
		tabsIcon.setAttribute("aria-label", "Tabs");
		tabsIcon.appendChild(
			createUiIcon("assets/svgs-fontawesome/solid/clone.svg"),
		);
		iconGroup.appendChild(tabsIcon);

		// Bookmark Toggle
		const bookmarkIcon = document.createElement("div");
		bookmarkIcon.className = "btn btn-icon";
		bookmarkIcon.id = "bookmark-toggle";
		bookmarkIcon.title = "Bookmarks";
		bookmarkIcon.setAttribute("aria-label", "Bookmarks");
		bookmarkIcon.appendChild(
			createUiIcon("assets/svgs-fontawesome/solid/bookmark.svg"),
		);
		iconGroup.appendChild(bookmarkIcon);

		const notesIcon = document.createElement("div");
		notesIcon.className = "btn btn-icon";
		notesIcon.id = "action-notes";
		notesIcon.title = "Notes";
		notesIcon.appendChild(
			createUiIcon("assets/svgs-fontawesome/solid/note-sticky.svg"),
		);
		notesIcon.addEventListener("click", (e) => {
			e.stopPropagation();
			document.dispatchEvent(new CustomEvent("action:notes"));
		});
		iconGroup.appendChild(notesIcon);

		const fullscreenIcon = document.createElement("div");
		fullscreenIcon.className = "btn btn-icon";
		fullscreenIcon.id = "fullscreen-toggle";
		fullscreenIcon.title = "Fullscreen";
		fullscreenIcon.setAttribute("aria-label", "Fullscreen");
		fullscreenIcon.appendChild(
			createUiIcon("assets/svgs-fontawesome/solid/expand.svg"),
		);
		iconGroup.appendChild(fullscreenIcon);

		actionContent.appendChild(iconGroup);

		const shortcutsContainer = document.createElement("div");
		shortcutsContainer.id = "shortcuts-container";
		shortcutsContainer.className = "action-group";

		const shortcutsEnabled =
			barCfg.shortcuts?.enabled ??
			DEFAULT_CONFIG.actionbar.shortcuts.enabled ??
			true;

		if (shortcutsEnabled) {
			const userShortcuts = barCfg.shortcuts?.items || [];
			const configured = [...DEFAULT_SHORTCUTS, ...userShortcuts];

			const searchbarCfg = root.searchbar || DEFAULT_CONFIG.searchbar;
			const shortcutTarget = searchbarCfg.target || "blank";

			function createShortcutTile(s, index) {
				const wrap = document.createElement("div");

				wrap.className = "btn btn-icon shortcut-item";
				wrap.title = s.title || s.url;

				// Auto-discover icon if missing
				const iconPath = s.icon || getIconForUrl(s.url);
				const icon = createUiIcon(
					iconPath,
					"shortcut-icon",
					DEFAULT_SHORTCUT_ICON_FALLBACK,
				);
				wrap.appendChild(icon);

				wrap.addEventListener("click", (ev) => {
					ev.stopPropagation();
					const target =
						shortcutTarget === "self" || shortcutTarget === "_self"
							? "_self"
							: "_blank";
					openSafeUrl(s.url, target, SHORTCUT_URL_PROTOCOLS);
				});

				// No inline actions anymore

				return wrap;
			}

			function renderShortcuts() {
				shortcutsContainer.innerHTML = "";

				configured.forEach((s, i) =>
					shortcutsContainer.appendChild(createShortcutTile(s, i)),
				);

				/* Add Button removed - management moved to settings */

				// Manage Button always shown to access shortcuts settings
				const manage = document.createElement("div");
				manage.className = "btn btn-icon shortcut-manage";
				manage.appendChild(
					createUiIcon(
						"assets/svgs-fontawesome/solid/pen-to-square.svg",
					),
				);
				manage.title = "Manage shortcuts";

						manage.addEventListener("click", (ev) => {
							ev.stopPropagation();
							document.dispatchEvent(
								new CustomEvent("action:settings", {
									detail: { tab: "actionbar" },
								}),
							);
						});
				shortcutsContainer.appendChild(manage);
			}

			renderShortcuts();
			actionContent.appendChild(shortcutsContainer);
		}

		// Media Controls Group
		const mediaGroup = document.createElement("div");
		mediaGroup.id = "media-control";
		mediaGroup.className = "action-group media-controls";
		mediaGroup.innerHTML = `
            <img class="media-poster">
            <div class="media-meta">
                <span class="media-title">No Media</span>
                <span class="media-duration"></span>
            </div>
            <div class="media-buttons">
                <button class="btn btn-icon media-btn" id="media-prev" title="Previous">
                    <span></span>
                </button>
                <button class="btn btn-icon media-btn" id="media-play" title="Play/Pause">
                    <span></span>
                </button>
                <button class="btn btn-icon media-btn" id="media-next" title="Next">
                    <span></span>
                </button>
            </div>
        `;
		// Icons
		renderInlineIcon(
			mediaGroup.querySelector("#media-prev span"),
			"assets/svgs-fontawesome/solid/backward-step.svg",
		);
		renderInlineIcon(
			mediaGroup.querySelector("#media-play span"),
			"assets/svgs-fontawesome/solid/play.svg",
		);
		renderInlineIcon(
			mediaGroup.querySelector("#media-next span"),
			"assets/svgs-fontawesome/solid/forward-step.svg",
		);

		// Logic
		const mPoster = mediaGroup.querySelector(".media-poster");
		const mTitle = mediaGroup.querySelector(".media-title");
		const mDuration = mediaGroup.querySelector(".media-duration");
		const mPlayBtn = mediaGroup.querySelector("#media-play");
		const mPrevBtn = mediaGroup.querySelector("#media-prev");
		const mNextBtn = mediaGroup.querySelector("#media-next");
		const mPlayIcon = mPlayBtn.querySelector("span");

		let currentMedia = null;
		let currentMediaTabId = null;

		// Click on media group to switch to media tab
		mediaGroup.addEventListener("click", (e) => {
			// Don't switch if clicking on buttons
			if (e.target.closest(".media-btn")) return;

			// Ask service worker to activate the current priority tab
			chrome.runtime.sendMessage({
				type: "MEDIA_CONTROL",
				action: "activate_tab",
			});
		});

		mPlayBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			const action =
				currentMedia && currentMedia.isPlaying ? "pause" : "play";
			chrome.runtime.sendMessage({ type: "MEDIA_CONTROL", action });
			// Optimistic
			if (currentMedia) {
				currentMedia.isPlaying = !currentMedia.isPlaying;
				refreshUI(currentMedia);
			}
		});

		mNextBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			chrome.runtime.sendMessage({
				type: "MEDIA_CONTROL",
				action: "next",
			});
		});

		mPrevBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			chrome.runtime.sendMessage({
				type: "MEDIA_CONTROL",
				action: "prev",
			});
		});

		const getPlatformIcon = (platform) => {
			if (!platform) return "assets/svgs-fontawesome/solid/music.svg";
			if (platform.includes("spotify"))
				return "assets/svgs-fontawesome/brands/spotify.svg";
			if (platform.includes("youtube"))
				return "assets/svgs-fontawesome/brands/youtube.svg";
			if (platform.includes("soundcloud"))
				return "assets/svgs-fontawesome/brands/soundcloud.svg";
			return "assets/svgs-fontawesome/solid/music.svg";
		};

		function refreshUI(media, tabId = null) {
			// console.log('[ActionBar] refreshUI called with:', media, 'tabId:', tabId);
			currentMedia = media;
			currentMediaTabId = tabId;
			if (!media) {
				mediaGroup.classList.remove("active");
				setTimeout(() => {
					if (!currentMedia) mediaGroup.style.display = "none";
				}, 300);
				return;
			}
			// Ensure visible
			mediaGroup.style.display = "flex";
			// force reflow
			void mediaGroup.offsetWidth;
			mediaGroup.classList.add("active");

			mTitle.textContent = media.title || "Unknown";

			// Display time as "current / duration" or just duration if no current time
			if (media.currentTime && media.duration) {
				mDuration.textContent = `${media.currentTime} / ${media.duration}`;
			} else if (media.duration) {
				mDuration.textContent = media.duration;
			} else {
				mDuration.textContent = "";
			}

			// Fallback Logic
			if (media.thumbnail) {
				mPoster.src = media.thumbnail;
				mPoster.style.backgroundColor = "var(--color-off)";
			} else {
				// Use platform icon
				mPoster.src = getPlatformIcon(media.platform);
				mPoster.style.backgroundColor = "transparent";
			}

			if (media.isPlaying) mPoster.classList.add("playing");
			else mPoster.classList.remove("playing");

			renderInlineIcon(
				mPlayIcon,
				media.isPlaying
					? "assets/svgs-fontawesome/solid/pause.svg"
					: "assets/svgs-fontawesome/solid/play.svg",
			);
		}

		updateMediaUI = refreshUI;
		// Replay the last media snapshot captured before this rebuild.
		if (lastMediaState) {
			refreshUI(lastMediaState.media, lastMediaState.tabId);
		}

		const thirdGroup = document.createElement("div");
		thirdGroup.className = "action-group";

		const makeAction = (id, title, iconPath, eventName) => {
			const el = document.createElement("div");
			el.className = "btn btn-icon";
			el.id = id;
			el.title = title;
			el.setAttribute("role", "button");
			el.setAttribute("tabindex", "0");
			el.appendChild(createUiIcon(iconPath));

			const trigger = (ev) => {
				ev && ev.stopPropagation && ev.stopPropagation();

				try {
					document.dispatchEvent(
						new CustomEvent(eventName, { detail: { id, title } }),
					);
				} catch (e) {}
			};

			el.addEventListener("click", trigger);
			el.addEventListener("keydown", (k) => {
				if (k.key === "Enter" || k.key === " ") {
					k.preventDefault();
					trigger(k);
				}
			});
			return el;
		};

		thirdGroup.appendChild(
			makeAction(
				"action-timer",
				"Timer/Stopwatch",
				"assets/svgs-fontawesome/solid/clock.svg",
				"action:timer",
			),
		);
		thirdGroup.appendChild(
			makeAction(
				"action-alarm",
				"Alarm",
				"assets/svgs-fontawesome/solid/bell.svg",
				"action:alarm",
			),
		);

		// Zen Mode Button (Before Settings)
		const zenBtn = makeAction(
			"action-zen",
			"Zen Mode",
			"assets/svgs-fontawesome/solid/spa.svg",
			"action:zen",
		);
		// Override click to direct function
		zenBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			toggleAmbientMode();
		});
		thirdGroup.appendChild(zenBtn);

		thirdGroup.appendChild(
			makeAction(
				"action-settings",
				"Settings",
				"assets/svgs-fontawesome/solid/gear.svg",
				"action:settings",
			),
		);

		// Info / User Guide Button
		const infoBtn = makeAction(
			"action-info",
			"User Guide",
			"assets/svgs-fontawesome/solid/circle-info.svg",
			"action:info",
		);
		infoBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			window.open("userguide.html", "_blank");
		});
		thirdGroup.appendChild(infoBtn);

				// Wallpaper Sync Button (hidden by default, end of middle section)
				const syncBtn = document.createElement("div");
				syncBtn.className = "btn btn-icon shortcut-sync";
				syncBtn.id = "wallpaper-sync";
				syncBtn.title = "Sync wallpaper across tabs";
				syncBtn.style.display = "none";
				syncBtn.appendChild(
					createUiIcon("assets/svgs-fontawesome/solid/repeat.svg"),
				);
				syncBtn.addEventListener("click", (ev) => {
					ev.stopPropagation();
					chrome.runtime
						.sendMessage({ type: "WALLPAPER_SYNC" })
						.catch(() => {});
				});
				thirdGroup.appendChild(syncBtn);

				// Listen for sync status from service worker.
				// The button is shown only when there are 2+ new-tab pages and
				// the current wallpaper is a specific video. The wallpaper
				// renderer emits "wallpaper:rendered" so changing the wallpaper
				// updates the button without rebuilding the action bar.
				_syncWallpaperInfo = {
					type: root.wallpaper?.type || null,
					mode: root.wallpaper?.mode || null,
				};
				_syncNeed = false;

				const updateSyncVisibility = () => {
					const isSpecificVideo =
						_syncWallpaperInfo.mode === "specific" &&
						_syncWallpaperInfo.type === "video";
					syncBtn.style.display =
						_syncNeed && isSpecificVideo ? "" : "none";
				};

				// Local fallback: don't depend solely on SW instance tracking.
				const refreshLocalSyncAvailability = () => {
					try {
						const nt = chrome.runtime.getURL("newtab.html");
						chrome.tabs.query({}, (tabs) => {
							if (chrome.runtime.lastError) return;
							const count = (tabs || []).filter(
								(t) => t.url && t.url.startsWith(nt),
							).length;
							_syncNeed = count >= 2;
							updateSyncVisibility();
						});
					} catch (e) {}
				};
				actionBarFocusListener = refreshLocalSyncAvailability;
				window.addEventListener("focus", actionBarFocusListener);
				refreshLocalSyncAvailability();

				actionBarRuntimeListener = (msg) => {
					if (msg.type !== "WALLPAPER_SYNC_STATUS") return;
					_syncNeed = !!msg.needSync;
					updateSyncVisibility();
				};
				chrome.runtime.onMessage.addListener(
					actionBarRuntimeListener,
				);

				actionBarWallpaperListener = (event) => {
					const detail = event.detail || {};
					_syncWallpaperInfo = {
						type: detail.type || null,
						mode: detail.mode || null,
					};
					updateSyncVisibility();
				};
				document.addEventListener(
					"wallpaper:rendered",
					actionBarWallpaperListener,
				);

				// Query initial sync state on action bar init
				chrome.runtime.sendMessage(
					{ type: "WALLPAPER_SYNC_QUERY" },
					(res) => {
						_syncNeed = !!res?.needSync;
						updateSyncVisibility();
					},
				);
				updateSyncVisibility();

				// FamCam Group
				let famcamCfg =
			barCfg.famcam ||
			DEFAULT_CONFIG.actionbar.famcam ||
			{};
		const fcEnabled = famcamCfg.enabled !== false;

		// Reference to brightness slider for syncing with settings modal
		let brightnessSlider = null;

		if (fcEnabled) {
			// Init FamCam Logic
			initFamCam(famcamCfg);

			// Expose update function globally for settings modal
			// Also update local famcamCfg to keep brightness slider in sync
			window.updateFamCamConfig = (newCfg) => {
				famcamCfg = newCfg; // Keep local reference in sync
				updateFamCamConfig(newCfg);
				// Sync brightness slider value if it exists
				if (
					brightnessSlider &&
					newCfg.flash?.brightness !== undefined
				) {
					brightnessSlider.value = newCfg.flash.brightness;
				}
			};

			const famcamGroup = document.createElement("div");
			famcamGroup.className = "action-group famcam-group";

			// 1. Flash Toggle
			const flashBtn = document.createElement("div");
			flashBtn.className = "btn btn-icon";
			flashBtn.title = "Flash / Ring Light";
			flashBtn.appendChild(
				createUiIcon("assets/svgs-fontawesome/solid/bolt.svg"),
			);

			let isFlashOn = false;

			// 1b. Hidden Brightness Slider Container
			const sliderContainer = document.createElement("div");
			sliderContainer.className = "famcam-slider-container is-hidden";
			sliderContainer.style.display = "flex";
			sliderContainer.style.alignItems = "center";
			sliderContainer.style.marginLeft = "var(--dis-1)";

			const bInput = document.createElement("input");
			bInput.type = "range";
			bInput.className = "input-range";
			bInput.min = 5;
			bInput.max = 100;
			bInput.value = Math.max(5, famcamCfg.flash?.brightness ?? 100);
			bInput.style.width = "4rem"; // Compact

			bInput.addEventListener("input", (e) => {
				const val = parseInt(e.target.value);
				famcamCfg.flash.brightness = val;
				updateFamCamConfig(famcamCfg);
			});

			bInput.addEventListener("change", async (e) => {
				const val = parseInt(e.target.value);
				// Save through the shared pending slot: this never touches
				// chrome.storage directly, so a queued panel edit is not lost.
				const saved = await updateSettings((settings) => {
					if (!settings.actionbar) settings.actionbar = {};
					if (!settings.actionbar.famcam)
						settings.actionbar.famcam = {};
					if (!settings.actionbar.famcam.flash)
						settings.actionbar.famcam.flash = {};

					settings.actionbar.famcam.flash.brightness = val;
					return true;
				});

				// Notify other components (like settings modal if open)
				document.dispatchEvent(
					new CustomEvent("settings:updated", {
						detail:
							saved || {
								actionbar: {
									famcam: { flash: { brightness: val } },
								},
							},
					}),
				);
			});

			sliderContainer.appendChild(bInput);
			brightnessSlider = bInput; // Store reference for syncing with settings modal

			flashBtn.addEventListener("click", (e) => {
				e.stopPropagation();
				isFlashOn = !isFlashOn;
				toggleFlash(isFlashOn);

				if (isFlashOn) {
					flashBtn.classList.add("active");
					sliderContainer.classList.remove("is-hidden");
				} else {
					flashBtn.classList.remove("active");
					sliderContainer.classList.add("is-hidden");
				}
			});

			// 2. Snap Button
			const snapBtn = document.createElement("div");
			snapBtn.className = "btn btn-icon";
			snapBtn.title = "Snap";
			snapBtn.appendChild(
				createUiIcon("assets/svgs-fontawesome/solid/camera.svg"),
			);

			snapBtn.addEventListener("click", (e) => {
				e.stopPropagation();
				handleSnap();
			});

			famcamGroup.appendChild(flashBtn);
			famcamGroup.appendChild(sliderContainer); // Inline slider
			famcamGroup.appendChild(snapBtn);

			// Insert before media group or just append?
			// User request: "add a new action group... primarily have 2 buttons"
			actionContent.appendChild(famcamGroup);
		}

		actionContent.appendChild(thirdGroup);
		actionContent.appendChild(mediaGroup);

		// Clock Group - IS the button itself
		const clockGroup = document.createElement("div");
		clockGroup.className = "btn btn-text btn-display clock-group";
		clockGroup.innerHTML = `<span class="clock-time">--:--</span>`;

		// Get time format from settings (12 or 24 hour)
		const clockEnabled = barCfg.clock?.enabled ?? true;
		const use24Hour = (barCfg.clock?.format || "12") === "24";

		function updateClock() {
			const now = new Date();
			let hours = now.getHours();
			const minutes = now.getMinutes().toString().padStart(2, "0");

			if (use24Hour) {
				clockGroup.querySelector(".clock-time").textContent = `${hours
					.toString()
					.padStart(2, "0")}:${minutes}`;
			} else {
				const ampm = hours >= 12 ? "PM" : "AM";
				hours = hours % 12 || 12;
				clockGroup.querySelector(".clock-time").textContent = `${hours
					.toString()
					.padStart(2, "0")}:${minutes} ${ampm}`;
			}
		}

		// Update clock immediately and every second
		if (clockEnabled) {
			updateClock();
			activeIntervals.push(setInterval(updateClock, 1000));
			actionContent.appendChild(clockGroup);
		}

		// Date Group - IS the button itself
		const dateEnabled = barCfg.date?.enabled ?? false;
		if (dateEnabled) {
			const dateGroup = document.createElement("div");
			dateGroup.className = "btn btn-text btn-display date-group";
			dateGroup.innerHTML = `<span class="date-text"></span>`;

			function updateDate() {
				const now = new Date();
				const options = {
					weekday: "short",
					month: "short",
					day: "numeric",
				};
				dateGroup.querySelector(".date-text").textContent =
					now.toLocaleDateString("en-US", options);
			}

			updateDate();
			activeIntervals.push(setInterval(updateDate, 60000));
			actionContent.appendChild(dateGroup);
		}

		// Alarm Group - IS the button itself (icon + text)
		const alarmEnabled = barCfg.alarm?.enabled ?? false;
		if (alarmEnabled) {
			const alarmGroup = document.createElement("div");
			alarmGroup.className = "btn btn-icon-text btn-display alarm-group";
			alarmGroup.innerHTML = `<span></span><span class="text alarm-text">No alarms</span>`;

			// Render alarm icon into the first span
			renderInlineIcon(
				alarmGroup.querySelector("span:first-child"),
				"assets/svgs-fontawesome/solid/bell.svg",
			);

			// Fetch and display next alarm
			async function updateAlarmDisplay() {
				try {
					// Fetch alarms from the shared store (alarm modal writes them)
					const raw = storageGetSync("alarms_list_v1");
					const alarms = raw ? JSON.parse(raw) : [];
					const alarmText = alarmGroup.querySelector(".alarm-text");

					if (alarms && alarms.length > 0) {
						// Filter for active alarms only (using 'on' property)
						const activeAlarms = alarms.filter((alarm) => alarm.on);

						if (activeAlarms.length > 0) {
							// Find the next alarm (earliest scheduled time)
							const now = new Date();
							const nextAlarm = activeAlarms.reduce(
								(earliest, alarm) => {
									// Parse alarm time from hour/minute properties
									const alarmDate = new Date();
									alarmDate.setHours(
										alarm.hour,
										alarm.minute,
										0,
										0,
									);

									// If alarm time has passed today, it's for tomorrow
									if (alarmDate < now) {
										alarmDate.setDate(
											alarmDate.getDate() + 1,
										);
									}

									if (!earliest)
										return {
											...alarm,
											scheduledTime: alarmDate,
										};

									const earliestDate = earliest.scheduledTime;
									return alarmDate < earliestDate
										? { ...alarm, scheduledTime: alarmDate }
										: earliest;
								},
								null,
							);

							// Format the alarm time
							const use24Hour =
								(barCfg.clock?.format || "12") === "24";
							const hours = nextAlarm.hour;
							const minutes = nextAlarm.minute;

							let timeStr;
							if (use24Hour) {
								timeStr = `${hours
									.toString()
									.padStart(2, "0")}:${minutes
									.toString()
									.padStart(2, "0")}`;
							} else {
								const ampm = hours >= 12 ? "PM" : "AM";
								const displayHours = hours % 12 || 12;
								timeStr = `${displayHours}:${minutes
									.toString()
									.padStart(2, "0")} ${ampm}`;
							}

							// Show alarm label and time (using 'label' property)
							alarmText.textContent = nextAlarm.label
								? `${nextAlarm.label} - ${timeStr}`
								: timeStr;
						} else {
							alarmText.textContent = "No active alarms";
						}
					} else {
						alarmText.textContent = "No alarms";
					}
				} catch (e) {
					// console.warn('[ActionBar] Failed to fetch alarms:', e);
					alarmGroup.querySelector(".alarm-text").textContent =
						"No alarms";
				}
			}

			updateAlarmDisplay();
			// Update every minute
			activeIntervals.push(setInterval(updateAlarmDisplay, 60000));
			// Listen for realtime updates from alarm modal
			actionBarAlarmsListener = updateAlarmDisplay;
			document.addEventListener(
				"alarms-updated",
				actionBarAlarmsListener,
			);

			actionContent.appendChild(alarmGroup);
		}

		// Weather Group - IS the button itself (icon + text)
		// Zero-config: Open-Meteo needs no API key. The location is resolved
		// from the saved place, the typed city, or the browser timezone.
		const weatherEnabled = barCfg.weather?.enabled ?? false;

		if (weatherEnabled) {
			const weatherGroup = document.createElement("div");
			weatherGroup.className = "btn btn-icon-text weather-group";
			weatherGroup.title = "Click to refresh weather";
			weatherGroup.innerHTML = `<span class="weather-icon"></span><div class="weather-text">--</div>`;

			const wIcon = weatherGroup.querySelector(".weather-icon");
			const wText = weatherGroup.querySelector(".weather-text");
			const weatherCfg = barCfg.weather || {};

			const renderWeatherData = (data, place) => {
				if (!data || typeof data.temp !== "number") return;

				const isImp = weatherCfg.units === "imperial";
				const tempUnit = isImp ? "°F" : "°C";
				const speedUnit = isImp ? "mph" : "m/s";

				renderInlineIcon(wIcon, getWmoIcon(data.code, data.isDay));

				// Construct Text HTML
				wText.innerHTML = "";

				const tempCheck = document.createElement("div");
				tempCheck.className = "weather-temp";
				tempCheck.textContent = `${Math.round(data.temp)}${tempUnit}`;
				wText.appendChild(tempCheck);

				const addDivider = () => {
					const divider = document.createElement("div");
					divider.className = "weather-divider";
					divider.textContent = "|";
					wText.appendChild(divider);
				};

				if (
					weatherCfg.showFeelsLike &&
					typeof data.feelsLike === "number"
				) {
					addDivider();
					const sp = document.createElement("div");
					sp.textContent = `Feels Like ${Math.round(
						data.feelsLike,
					)}°`;
					wText.appendChild(sp);
				}

				if (
					weatherCfg.showHumidity &&
					typeof data.humidity === "number"
				) {
					addDivider();
					const sp = document.createElement("div");
					sp.className = "weather-detail";

					const ico = document.createElement("div");
					ico.className = "ui-icon";
					renderInlineIcon(
						ico,
						"assets/svgs-fontawesome/solid/droplet.svg",
						{
							fallbackSrc:
								"assets/svgs-fontawesome/solid/water.svg",
						},
					);

					sp.appendChild(ico);
					sp.appendChild(
						document.createTextNode(
							`${Math.round(data.humidity)}%`,
						),
					);
					wText.appendChild(sp);
				}

				if (weatherCfg.showWind && typeof data.wind === "number") {
					addDivider();
					const sp = document.createElement("div");
					sp.className = "weather-detail";

					const ico = document.createElement("div");
					ico.className = "ui-icon";
					renderInlineIcon(
						ico,
						"assets/svgs-fontawesome/solid/wind.svg",
					);

					sp.appendChild(ico);
					sp.appendChild(
						document.createTextNode(
							`${Math.round(data.wind)}${speedUnit}`,
						),
					);
					wText.appendChild(sp);
				}

				const placeLabel = getPlaceLabel(place);
				weatherGroup.title = placeLabel
					? `${placeLabel} — click to refresh`
					: "Click to refresh weather";
			};

			const loadWeather = async (userInitiated = false, force = false) => {
				try {
					const result = await getWeather(weatherCfg, {
						userInitiated,
						force,
					});
					if (!result.ok) {
						wText.textContent =
							result.error === "location" && !weatherCfg.city ?
								"Set city"
							:	"Err";
						return;
					}
					renderWeatherData(result.data, result.place);
				} catch (e) {
					wText.textContent = "Err";
				}
			};

			// Initial load: cached forecast or zero-config timezone lookup.
			loadWeather();

			// Cross-tab updates: another new-tab page refreshed the forecast.
			const storageListener = (changes, area) => {
				if (area !== "local" || !changes.weatherData) return;
				const next = changes.weatherData.newValue;
				if (next && next.provider === "open-meteo" && next.data) {
					renderWeatherData(next.data, next.place);
				}
			};
			actionBarStorageListener = storageListener;
			chrome.storage.onChanged.addListener(
				actionBarStorageListener,
			);

			// Click to refresh. If no place can be resolved, this is also the
			// explicit user action that may ask for browser location.
			weatherGroup.addEventListener("click", async () => {
				wText.textContent = "...";
				await loadWeather(true, true);
			});

			actionContent.appendChild(weatherGroup);
		}

		// Apply Display Style (Centralised vs Spread)
		const displayStyle = barCfg.display_style || "centralised";
		if (displayStyle === "spread") {
			const leftDiv = document.createElement("div");
			leftDiv.className = "ab-section-left";
			const centerDiv = document.createElement("div");
			centerDiv.className = "ab-section-center";
			const rightDiv = document.createElement("div");
			rightDiv.className = "ab-section-right";

			// Iterate through existing children (move them)
			const children = Array.from(actionContent.children);
			children.forEach((child) => {
				if (
					child.id === "media-control" ||
					child.classList.contains("famcam-group")
				) {
					leftDiv.appendChild(child);
				} else if (
					child.classList.contains("clock-group") ||
					child.classList.contains("date-group") ||
					child.classList.contains("alarm-group") ||
					child.classList.contains("weather-group")
				) {
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
		if (document.getElementById("settings-modal")) {
			const btn = document.getElementById("action-settings");
			if (btn) btn.classList.add("active");
		}
		if (document.getElementById("timer-modal")) {
			const btn = document.getElementById("action-timer");
			if (btn) btn.classList.add("active");
		}
		if (document.getElementById("alarm-modal")) {
			const btn = document.getElementById("action-alarm");
			if (btn) btn.classList.add("active");
		}
		// Notes modal backdrop check (since modal might be inside backdrop)
		if (document.querySelector(".notes-modal-backdrop")) {
			const btn = document.getElementById("action-notes");
			if (btn) btn.classList.add("active");
		}
		// Tabs Ribbon
		if (document.getElementById("tabs-ribbon-container")) {
			const btn = document.getElementById("tabs-toggle");
			if (btn) btn.classList.add("active");
		}
		// Bookmarks Panel
		if (document.getElementById("bookmarks-panel")) {
			const btn = document.getElementById("bookmark-toggle");
			if (btn) btn.classList.add("active");
		}

		// Make every interactive action-bar control keyboard operable.
		actionContent
			.querySelectorAll(".btn:not(.btn-display)")
			.forEach(makeButtonLike);
	} catch (e) {
		// console.error('Failed to initialize action bar', e);
	}
}
