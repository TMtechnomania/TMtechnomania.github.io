import { loadCSS, unloadCSS } from "./cssLoader.js";
import {
	STORAGE_KEY_SETTINGS,
	DEFAULT_CONFIG,
	applyTheme,
	DEFAULT_SHORTCUTS,
	DUOTONE_THEMES,
} from "./config.js";
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
} from "./db.js";
import { initActionBar } from "./actionbar.js";
import { renderInlineIcon } from "./brandIconLoader.js";
import { openShortcutModal } from "./shortcutsModal.js";
import { renderWallpaper } from "./wallpaper.js";

let _settingsModalOpen = false;

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
		// Add slideDown animation before removal
		el.style.animation = "slideDown var(--transition-normal) forwards";
		el.addEventListener(
			"animationend",
			() => {
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

	// Cleanup on close
	document.addEventListener(
		"settings:closed",
		() => {
			document.removeEventListener("settings:updated", onSettingsUpdate);
		},
		{ once: true },
	);

	// Header
	const header = document.createElement("div");
	header.className = "modal-header";

	const title = document.createElement("div");
	title.className = "btn btn-icon-text btn-display modal-title";
	title.innerHTML = `<span></span><span class="text">Settings</span>`;
	renderInlineIcon(
		title.querySelector("span:first-child"),
		"assets/svgs-fontawesome/solid/gear.svg",
	);

	const closeBtn = document.createElement("button");
	closeBtn.className = "btn btn-icon";
	const closeIcon = document.createElement("span");
	renderInlineIcon(closeIcon, "assets/svgs-fontawesome/solid/xmark.svg");
	closeBtn.appendChild(closeIcon);
	closeBtn.addEventListener("click", closeSettingsModalIfOpen);

	header.appendChild(title);
	header.appendChild(closeBtn);
	modal.appendChild(header);

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
			id: "about",
			label: "About",
			icon: "assets/svgs-fontawesome/solid/circle-question.svg",
		},
	];

	let activeTabId = "general";

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
			if (target) target.classList.add("active");
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

	// Close on click outside
	modal.addEventListener("click", (e) => {
		if (e.target === modal) closeSettingsModalIfOpen();
	});
}

async function getSettings() {
	return new Promise((resolve) => {
		chrome.storage.local.get(STORAGE_KEY_SETTINGS, (res) => {
			const stored = res?.[STORAGE_KEY_SETTINGS] || {};
			// Deep merge with default config to ensure all keys exist
			const merged = {
				...DEFAULT_CONFIG,
				...stored,
				wallpaper: {
					...DEFAULT_CONFIG.wallpaper,
					...(stored.wallpaper || {}),
				},
				searchbar: {
					...DEFAULT_CONFIG.searchbar,
					...(stored.searchbar || {}),
				},
				actionbar: {
					...DEFAULT_CONFIG.actionbar,
					...(stored.actionbar || {}),
				},
				font: { ...DEFAULT_CONFIG.font, ...(stored.font || {}) },
			};
			resolve(merged);
		});
	});
}

async function saveSettings(newSettings) {
	return new Promise((resolve) => {
		chrome.storage.local.set(
			{ [STORAGE_KEY_SETTINGS]: newSettings },
			() => {
				resolve();
			},
		);
	});
}

function renderSectionContent(container, tabId, settings) {
	if (tabId === "general") {
		// Theme
		const themes = [
			{ value: "system", label: "System" },
			{ value: "light", label: "Light" },
			{ value: "dark", label: "Dark" },
		];
		const themeSelect = addSelect(
			container,
			"Theme",
			settings.wallpaper.type === "duotone"
				? "Locked to Dark Mode by Duotone wallpaper."
				: "Choose your preferred theme.",
			themes,
			settings.theme || "system",
			(val) => {
				settings.theme = val;
				saveSettings(settings);
				applyTheme(val);
			},
		);

		// Disable Theme Select if Duotone
		if (settings.wallpaper.type === "duotone") {
			const selectEl = themeSelect.querySelector("select");
			if (selectEl) {
				selectEl.disabled = true;
				selectEl.title =
					"Theme is locked to Dark Mode while Duotone wallpaper is active. Change wallpaper type to unlock.";
			}
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
				initActionBar(settings.actionbar); // Re-init to apply
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

		addSelect(
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
			},
		);

		const clockColors = [
			{ value: "default", label: "Default (Theme Text)" },
			{ value: "inverse", label: "Inverse (Opposite Theme)" },
		];
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
				document.dispatchEvent(
					new CustomEvent("settings:clock", { detail: settings }),
				);
			},
		);

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

		addToggle(
			container,
			"Outline Text",
			"Add a stroke outline to all clock and greeting text.",
			settings.onScreenClock.outline || false,
			(val) => {
				if (!settings.onScreenClock) settings.onScreenClock = {};
				settings.onScreenClock.outline = val;
				saveSettings(settings);
				document.dispatchEvent(
					new CustomEvent("settings:clock", { detail: settings }),
				);
			},
		);

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
		inputsContainer.style.display = settings.greeting.enabled
			? "block"
			: "none";
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
	}

	if (tabId === "wallpaper") {
		// Type
		const types = [
			{ value: "mono", label: "Mono" },
			{ value: "img", label: "Image" },
			{ value: "video", label: "Video" },
			{ value: "duotone", label: "Duotone (Dark Mode)" },
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

					// Force Dark Mode for Duotone
					if (newType === "duotone") {
						applyTheme("dark");
					}

					// Real-time Update of General Tab Theme Selector
					const generalTab = document.getElementById(
						"settings-section-general",
					);
					if (generalTab) {
						// Theme is the first select in the General tab
						const themeSelect = generalTab.querySelector("select");
						if (themeSelect) {
							if (newType === "duotone") {
								themeSelect.disabled = true;
								themeSelect.title =
									"Theme is locked to Dark Mode while Duotone wallpaper is active. Change wallpaper type to unlock.";
								themeSelect.value = "dark"; // Visual sync
							} else {
								themeSelect.disabled = false;
								themeSelect.title = "";
							}
						}
					}
				}

				saveSettings(settings);

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
				initActionBar(settings.actionbar);
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
				initActionBar(settings.actionbar);
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
				initActionBar(settings.actionbar);
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
				initActionBar(settings.actionbar);
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
				initActionBar(settings.actionbar);
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
				initActionBar(settings.actionbar);
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
			"Show weather information in the action bar. Requires OpenWeather API Key.",
			settings.actionbar?.weather?.enabled ?? false,
			async (val) => {
				if (!settings.actionbar) settings.actionbar = {};
				if (!settings.actionbar.weather)
					settings.actionbar.weather = {};
				settings.actionbar.weather.enabled = val;
				await saveSettings(settings);
				initActionBar(settings.actionbar);
			},
		);

		addInput(
			weatherGroup,
			"API Key",
			"Your OpenWeatherMap API Key.",
			settings.actionbar?.weather?.apiKey || "",
			async (val) => {
				if (!settings.actionbar) settings.actionbar = {};
				if (!settings.actionbar.weather)
					settings.actionbar.weather = {};
				settings.actionbar.weather.apiKey = val;
				await saveSettings(settings);
				// Re-init happens on blur/change, maybe wait for full input? Helper handles change event.
				initActionBar(settings.actionbar);
			},
			"Enter API Key",
		);

		addInput(
			weatherGroup,
			"City (Optional)",
			"Leave blank to use auto-geolocation.",
			settings.actionbar?.weather?.city || "",
			async (val) => {
				if (!settings.actionbar) settings.actionbar = {};
				if (!settings.actionbar.weather)
					settings.actionbar.weather = {};
				settings.actionbar.weather.city = val;
				await saveSettings(settings);
				initActionBar(settings.actionbar);
			},
			"e.g. London,UK",
		);

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
				initActionBar(settings.actionbar);
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
				initActionBar(settings.actionbar);
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
				initActionBar(settings.actionbar);
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
				initActionBar(settings.actionbar);
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
				initActionBar(settings.actionbar);
			},
		);

		// Snap Action (Camera vs Screenshot)
		const snapActions = [
			{ value: "camera", label: "Camera (Selfie)" },
			{ value: "screenshot", label: "Screenshot (Tab)" },
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
				await saveSettings(settings);
				initActionBar(settings.actionbar);
			},
		);

		// Shortcuts List Management
		renderShortcutsList(shortcutsGroup, settings);
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

		headerGroup.innerHTML = `
            <img src="icons/icon128.png" alt="Themes+ Logo" style="width: var(--dis-8); height: var(--dis-8);">
            <h2 style="font-size: var(--dis-3); font-weight: 700; color: var(--text-base);">Themes+</h2>
            <div class="setting-desc" style="font-weight: 500;">v1.0.4</div>
            <p class="setting-desc" style="max-width: 400px; margin-top: var(--dis-1);">
                A beautiful, customizable dashboard for your new tab. <br>
                Built for performance, privacy, and productivity.
            </p>
        `;
		about.appendChild(headerGroup);

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

	const info = document.createElement("div");
	info.className = "setting-info";
	info.innerHTML = `<div class="setting-label">${label}</div><div class="setting-desc">${desc}</div>`;

	const control = document.createElement("div");
	control.className = "setting-control";

	const labelEl = document.createElement("label");
	labelEl.className = "toggle-switch";

	const input = document.createElement("input");
	input.type = "checkbox";
	input.checked = !!checked;
	input.addEventListener("change", (e) => onChange(e.target.checked));

	const slider = document.createElement("span");
	slider.className = "toggle-slider";

	labelEl.appendChild(input);
	labelEl.appendChild(slider);
	control.appendChild(labelEl);

	row.appendChild(info);
	row.appendChild(control);
	container.appendChild(row);
}

function addInput(container, label, desc, value, onChange, placeholder = "") {
	const row = document.createElement("div");
	row.className = "setting-row";

	const info = document.createElement("div");
	info.className = "setting-info";
	info.innerHTML = `<div class="setting-label">${label}</div><div class="setting-desc">${desc}</div>`;

	const control = document.createElement("div");
	control.className = "setting-control";

	const input = document.createElement("input");
	input.type = "text";
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
}

function addSelect(container, label, desc, options, value, onChange) {
	const row = document.createElement("div");
	row.className = "setting-row";

	const info = document.createElement("div");
	info.className = "setting-info";
	info.innerHTML = `<div class="setting-label">${label}</div><div class="setting-desc">${desc}</div>`;

	const control = document.createElement("div");
	control.className = "setting-control";

	const select = document.createElement("select");
	select.className = "select"; // Uses base.css .select
	options.forEach((opt) => {
		const o = document.createElement("option");
		o.value = opt.value;
		o.textContent = opt.label;
		if (opt.value === value) o.selected = true;
		select.appendChild(o);
	});

	select.addEventListener("change", (e) => onChange(e.target.value));

	control.appendChild(select);
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
		saveSettings(settings);
		updateWallpaperFilters(settings.wallpaper);
		// Re-render this section to update sliders
		updateWallpaperDynamicContent(container, settings);
	};
	groupHeader.appendChild(resetAll);

	filterGroup.appendChild(groupHeader);
	container.appendChild(filterGroup);

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
		},
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
		},
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
		},
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
		},
	);

	// 2. Wallpaper Grid
	const grid = document.createElement("div");
	grid.className = "wallpaper-grid";
	container.appendChild(grid);

	renderWallpaperGrid(grid, settings);
}

// --- Logic Helpers ---

function updateWallpaperFilters(cfg) {
	const el = document.getElementById("wallpaper");
	if (!el) return;

	const parts = [];
	if (cfg.blur > 0) parts.push(`blur(${cfg.blur}px)`);
	if (cfg.brightness !== 100) parts.push(`brightness(${cfg.brightness}%)`);
	if (cfg.contrast !== 100) parts.push(`contrast(${cfg.contrast}%)`);
	if (cfg.grayscale > 0) parts.push(`grayscale(${cfg.grayscale}%)`);

	el.style.filter = parts.join(" ");
}

async function refreshWallpaper(settings, forceReload = false) {
	// Re-fetch manifest and render
	const manifest = await new Promise((resolve) => {
		chrome.storage.local.get("wallpaperDB", (res) =>
			resolve(res?.wallpaperDB || null),
		);
	});
	if (manifest) {
		// If forceReload, we might want to pass it to renderWallpaper if it supported it,
		// or just rely on the fact that we fetched a fresh manifest.
		// For the active background, standard render is usually enough unless URL changed.
		renderWallpaper(settings.wallpaper, manifest);
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
	const allUserWalls = await getAllUserWallpapers();
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
		const limitBytes = isVideo ? 100 * 1024 * 1024 : 10 * 1024 * 1024; // 100MB or 10MB
		if (file.size > limitBytes) {
			alert(
				`File too large. Maximum size is ${
					isVideo ? "100MB" : "10MB"
				}.`,
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
			const maxCount = isVideo ? 10 : 20;

			if (currentCount >= maxCount) {
				alert(
					`Upload limit reached. You can only have ${maxCount} ${type} wallpapers.`,
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
			await renderWallpaperGrid(container, settings);
		} catch (err) {
			// console.error('Upload failed', err);
			alert("Failed to upload wallpaper.");
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
				chrome.runtime.sendMessage(
					{ action: "refreshManifest" },
					async () => {
						await refreshWallpaper(settings, true);
						await renderWallpaperGrid(container, settings, true);
						resolve();
					},
				);
			});
		} catch (e) {
			// console.error(e);
			await renderWallpaperGrid(container, settings);
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
			let displayUrl;
			let isThumb = false;

			if (wall.thumbBlob) {
				displayUrl = URL.createObjectURL(wall.thumbBlob);
				isThumb = true;
			} else {
				displayUrl = URL.createObjectURL(wall.blob);
			}
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

			// Click -> Select
			tile.addEventListener("click", (e) => {
				if (e.target.closest(".delete-overlay")) return;
				settings.wallpaper.collection = "user";
				settings.wallpaper.mode = "specific";
				settings.wallpaper.specific = wall.id;
				syncTypeBucket(settings); // Sync to type bucket
				saveSettings(settings);
				refreshWallpaper(settings);
				renderWallpaperGrid(container, settings);
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
		container.innerHTML +=
			'<div class="setting-desc" style="grid-column: 1/-1; text-align: center; padding: 2rem;">Mono mode selected. Background set to solid color.</div>';
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

	// Get existing media keys
	const allKeys = await getAllMediaKeys();
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
				);
				insertSorted(container, newTile, item.id, list, true);
			}

			// Final refresh to update Action Buttons (Delete All / Hide Download All)
			renderWallpaperGrid(container, settings);
		};
		actionsContainer.appendChild(dlBtn);
	}

	// Delete All button - only deletes current type, preserves first one for fallback, does NOT touch user uploads
	// Show button as soon as at least 1 wallpaper is downloaded
	const downloadedCount = list.filter((i) => downloadedSet.has(i.id)).length;
	if (downloadedCount >= 1) {
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
				`Delete all downloaded ${typeLabelLower} wallpapers? (First one kept as fallback)`,
				async () => {
					try {
						// Get the IDs of all items in the current type's list
						const currentTypeIds = new Set(
							list.map((item) => item.id),
						);

						// Protect the first item of current type as fallback
						const protectedId = list.length > 0 ? list[0].id : null;

						const allKeys = await getAllMediaKeys();

						const mediaKeysToDelete = allKeys.filter((k) => {
							if (!k.endsWith("::media")) return false;
							const id = k.split("::")[0];
							// Only delete if it's from the current type's list
							if (!currentTypeIds.has(id)) return false;
							// Don't delete the protected fallback
							if (id === protectedId) return false;
							return true;
						});

						// Only delete media files, NOT thumbnails
						await Promise.all(
							mediaKeysToDelete.map((k) => deleteMediaEntry(k)),
						);

						// Set wallpaper to the fallback
						if (protectedId) {
							settings.wallpaper.collection = "predefined";
							settings.wallpaper.mode = "specific";
							settings.wallpaper.specific = protectedId;
							await saveSettings(settings);
							await refreshWallpaper(settings);
						}

						renderWallpaperGrid(container, settings);
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
			refreshWallpaper(settings);
		},
		onDelete: (tile, item) => {
			showConfirmation("Delete this wallpaper?", async () => {
				await deleteMediaEntry(`${item.id}::media`);
				// DOM Update
				tile.remove();
				// Re-insert as Available (Not Downloaded)
				const newTile = await createWallpaperTile(
					item,
					false,
					false,
					smartHandlers,
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
			);
			insertSorted(container, newTile, item.id, list, true);

			// Auto-select downloaded item
			settings.wallpaper.collection = "predefined";
			settings.wallpaper.mode = "specific";
			settings.wallpaper.specific = item.id;
			syncTypeBucket(settings); // Sync to type bucket
			saveSettings(settings);
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
				URL.revokeObjectURL(fileUrl);
				resolve(null);
			};
		} else {
			const img = new Image();
			img.onload = () =>
				processCanvas(img, img.naturalWidth, img.naturalHeight);
			img.onerror = () => {
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
) {
	const tile = document.createElement("div");
	tile.className = `wallpaper-tile ${isActive ? "active" : ""}`;
	tile.dataset.id = item.id;
	if (isDownloaded) tile.dataset.downloaded = "true";

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

	// Delete Overlay
	if (isDownloaded) {
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

	const msg = document.createElement("p");
	msg.className = "confirm-message";
	msg.textContent = message;

	const buttons = document.createElement("div");
	buttons.className = "confirm-buttons";

	const cancelBtn = document.createElement("button");
	cancelBtn.className = "btn btn-text confirm-btn cancel";
	cancelBtn.textContent = "Cancel";
	cancelBtn.onclick = () => {
		document.body.removeChild(overlay);
	};

	const okBtn = document.createElement("button");
	okBtn.className = "btn btn-text primary confirm-btn confirm";
	okBtn.textContent = "Confirm";
	okBtn.onclick = () => {
		document.body.removeChild(overlay);
		onConfirm();
	};

	buttons.appendChild(cancelBtn);
	buttons.appendChild(okBtn);

	modal.appendChild(msg);
	modal.appendChild(buttons);
	overlay.appendChild(modal);

	document.body.appendChild(overlay);
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
			initActionBar(settings.actionbar);
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

			// Text
			const text = document.createElement("div");
			text.className = "shortcut-list-info";
			text.innerHTML = `<div class="shortcut-title">${item.title}</div><div class="shortcut-url">${item.url}</div>`;

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
							initActionBar(settings.actionbar);
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
								initActionBar(settings.actionbar);
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
