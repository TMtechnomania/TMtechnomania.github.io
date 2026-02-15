// Map of font names to their Google Fonts import URLs
export const FONT_MAP = {
	default: null, // Uses system/UI font
	"Bitcount Grid Single":
		"https://fonts.googleapis.com/css2?family=Bitcount+Grid+Single&display=swap",
	"PT Serif":
		"https://fonts.googleapis.com/css2?family=PT+Serif:wght@400;700&display=swap",
	Anton: "https://fonts.googleapis.com/css2?family=Anton&display=swap",
	Pacifico: "https://fonts.googleapis.com/css2?family=Pacifico&display=swap",
	Lobster: "https://fonts.googleapis.com/css2?family=Lobster&display=swap",
	"Abril Fatface":
		"https://fonts.googleapis.com/css2?family=Abril+Fatface&display=swap",
	"Titan One":
		"https://fonts.googleapis.com/css2?family=Titan+One&display=swap",
	Monoton: "https://fonts.googleapis.com/css2?family=Monoton&display=swap",
	Kenia: "https://fonts.googleapis.com/css2?family=Kenia&display=swap",
	"Fredericka the Great":
		"https://fonts.googleapis.com/css2?family=Fredericka+the+Great&display=swap",
	"Libertinus Keyboard":
		"https://fonts.googleapis.com/css2?family=Libertinus+Keyboard&display=swap",
	"Stardos Stencil":
		"https://fonts.googleapis.com/css2?family=Stardos+Stencil:wght@400;700&display=swap",

	// New additions
	"Bebas Neue":
		"https://fonts.googleapis.com/css2?family=Bebas+Neue&display=swap",
	"Rubik Dirt":
		"https://fonts.googleapis.com/css2?family=Rubik+Dirt&display=swap",
	"Moirai One":
		"https://fonts.googleapis.com/css2?family=Moirai+One&display=swap",
	"Rubik Glitch":
		"https://fonts.googleapis.com/css2?family=Rubik+Glitch&display=swap",
	"Rampart One":
		"https://fonts.googleapis.com/css2?family=Rampart+One&display=swap",
	"Rubik Wet Paint":
		"https://fonts.googleapis.com/css2?family=Rubik+Wet+Paint&display=swap",
	"Rubik Vinyl":
		"https://fonts.googleapis.com/css2?family=Rubik+Vinyl&display=swap",
	Notable: "https://fonts.googleapis.com/css2?family=Notable&display=swap",
	Plaster: "https://fonts.googleapis.com/css2?family=Plaster&display=swap",
	Tourney:
		"https://fonts.googleapis.com/css2?family=Tourney:wght@100..900&display=swap",
	"Kumar One Outline":
		"https://fonts.googleapis.com/css2?family=Kumar+One+Outline&display=swap",
	Foldit: "https://fonts.googleapis.com/css2?family=Foldit:wght@100..900&display=swap",
	"Rubik 80s Fade":
		"https://fonts.googleapis.com/css2?family=Rubik+80s+Fade&display=swap",
};

// Handle special case for Science Gothic if it requires specific query parameters or is hosted differently?
// For now we use standard.

let clockInterval = null;
let currentSettings = null;

export function initClock(settings) {
	currentSettings = settings;
	renderClock();
	startClock();
}

export function updateClockSettings(newSettings) {
	currentSettings = newSettings;
	applyClockStyles();
	// Force immediate update of time string/date visibility
	updateTime();
}

function startClock() {
	if (clockInterval) clearInterval(clockInterval);
	updateTime(); // Run immediately
	clockInterval = setInterval(updateTime, 1000);
}

function updateTime() {
	const clockEnabled =
		currentSettings &&
		currentSettings.onScreenClock &&
		currentSettings.onScreenClock.enabled;
	const greetingEnabled =
		currentSettings &&
		currentSettings.greeting &&
		currentSettings.greeting.enabled;
	const dateEnabled =
		currentSettings &&
		currentSettings.actionbar &&
		currentSettings.actionbar.date &&
		currentSettings.actionbar.date.enabled;

	if (!clockEnabled && !greetingEnabled && !dateEnabled) {
		const container = document.getElementById("on-screen-clock");
		if (container) container.style.display = "none";
		return;
	}

	// Ensure anchoring and existence
	ensureAnchoring();

	const container = document.getElementById("on-screen-clock");
	if (!container) return; // Should exist now

	container.style.display = "flex"; // Ensure visible

	const now = new Date();
	// Re-check anchoring every second to handle searchbar toggles
	ensureAnchoring();

	// Elements
	const greetingEl = container.querySelector(".os-clock-greeting");
	const timeEl = container.querySelector(".os-clock-time");
	const dateEl = container.querySelector(".os-clock-date");

	// Greeting
	if (greetingEnabled) {
		if (greetingEl) {
			greetingEl.style.display = "block";
			if (currentSettings.greeting.type === "custom") {
				greetingEl.textContent =
					currentSettings.greeting.customText || "Hello";
			} else {
				// Time-based
				const hour = now.getHours();
				let greet = "Good Evening";
				if (hour >= 0 && hour < 5) greet = "You still up, Night Owl?";
				else if (hour >= 5 && hour < 12) greet = "Good Morning";
				else if (hour >= 12 && hour < 17) greet = "Good Afternoon";

				const name = currentSettings.greeting.customName;
				if (name && name.trim()) {
					greetingEl.textContent =
						greet.endsWith("?") ?
							`${greet} ${name.trim()}`
						:	`${greet}, ${name.trim()}`;
				} else {
					greetingEl.textContent = greet;
				}
			}
		}
	} else {
		if (greetingEl) greetingEl.style.display = "none";
	}

	// Time Format
	if (timeEl) {
		if (clockEnabled) {
			timeEl.style.display = "block";
			const use24 =
				currentSettings.actionbar &&
				currentSettings.actionbar.clock &&
				currentSettings.actionbar.clock.format === "24";
			const showSeconds =
				currentSettings.onScreenClock &&
				currentSettings.onScreenClock.showSeconds;

			let hours = now.getHours();
			const minutes = now.getMinutes().toString().padStart(2, "0");
			const seconds = now.getSeconds().toString().padStart(2, "0");

			let timeStr = "";
			if (use24) {
				timeStr = `${hours.toString().padStart(2, "0")}:${minutes}`;
				if (showSeconds) timeStr += `:${seconds}`;
			} else {
				const ampm = hours >= 12 ? "PM" : "AM";
				hours = hours % 12;
				hours = hours ? hours : 12;
				timeStr = `${hours.toString().padStart(2, "0")}:${minutes}`;
				if (showSeconds) timeStr += `:${seconds}`;
				timeStr += ` ${ampm}`;
			}
			timeEl.textContent = timeStr;
		} else {
			timeEl.style.display = "none";
		}
	}

	// Date
	if (dateEnabled) {
		if (dateEl) {
			dateEl.style.display = "block";
			const options = { weekday: "long", month: "long", day: "numeric" };
			dateEl.textContent = now.toLocaleDateString(undefined, options);
		}
	} else {
		if (dateEl) dateEl.style.display = "none";
	}
}

function ensureAnchoring() {
	const container = document.getElementById("on-screen-clock");
	if (!container) {
		renderClock();
		return;
	}

	const searchBar = document.getElementById("searchbar");

	if (searchBar) {
		if (container.parentNode !== searchBar) {
			searchBar.prepend(container);
			container.style.position = "relative";
			container.style.top = "auto";
			container.style.left = "auto";
			container.style.transform = "none";
			container.style.marginBottom = "0";
		}
	} else {
		if (container.parentNode !== document.body) {
			document.body.insertBefore(
				container,
				document.getElementById("action-bar"),
			);
			container.style.position = "fixed";
			container.style.top = "50%";
			container.style.left = "50%";
			container.style.transform = "translate(-50%, -50%)";
			container.style.marginBottom = "0";
		}
	}
}

function renderClock() {
	let container = document.getElementById("on-screen-clock");
	if (!container) {
		container = document.createElement("div");
		container.id = "on-screen-clock";
		// Add column flex direction in styles or here if needed, but assuming CSS handles it or default div block behavior (row? no, block)
		// Actually .os-clock-time is div, so they stack.
		// But we want to ensure centered text probably?
		container.style.display = "flex";
		container.style.flexDirection = "column";
		container.style.alignItems = "center";
		container.style.justifyContent = "center";
		container.style.textAlign = "center"; // Text center

		const greetingEl = document.createElement("div");
		greetingEl.className = "os-clock-greeting";

		const timeEl = document.createElement("div");
		timeEl.className = "os-clock-time";

		const dateEl = document.createElement("div");
		dateEl.className = "os-clock-date";

		container.appendChild(greetingEl);
		container.appendChild(timeEl);
		container.appendChild(dateEl);

		document.body.appendChild(container);
	}

	ensureAnchoring();

	applyClockStyles();
}

function applyClockStyles() {
	const container = document.getElementById("on-screen-clock");
	if (!container) return;

	// Check if ANY component is enabled
	const clockEnabled =
		currentSettings &&
		currentSettings.onScreenClock &&
		currentSettings.onScreenClock.enabled;
	const greetingEnabled =
		currentSettings &&
		currentSettings.greeting &&
		currentSettings.greeting.enabled;
	const dateEnabled =
		currentSettings &&
		currentSettings.actionbar &&
		currentSettings.actionbar.date &&
		currentSettings.actionbar.date.enabled;

	if (!clockEnabled && !greetingEnabled && !dateEnabled) {
		container.style.display = "none";
		return;
	}
	container.style.display = "flex";

	// Font
	const fontName = currentSettings.onScreenClock.font || "default";
	if (fontName !== "default") {
		loadFont(fontName);
		container.style.setProperty(
			"--clock-font",
			`"${fontName}", sans-serif`,
		);
	} else {
		container.style.removeProperty("--clock-font");
	}

	// Color
	const colorMode = currentSettings.onScreenClock.color || "default";
	container.classList.remove("color-inverse", "color-custom");

	if (colorMode === "inverse") {
		container.classList.add("color-inverse");
	} else if (colorMode === "custom") {
		container.classList.add("color-custom");
		if (currentSettings.onScreenClock.customColor) {
			container.style.setProperty(
				"--ui-text-display",
				currentSettings.onScreenClock.customColor,
			);
		}
	}

	// Outline (Clock)
	if (currentSettings.onScreenClock.outline) {
		container.classList.add("clock-outline");
		// Set outline color variable
		const outlineColor = currentSettings.onScreenClock.outlineColor;
		if (outlineColor) {
			container.style.setProperty("--ui-text-outline", outlineColor);
		} else {
			// Default fallback for outline depends on main color...
			// But CSS handles fallback to var(--text-invert) or var(--text-base) based on class.
			// We can just remove the property to let CSS fallback work.
			container.style.removeProperty("--ui-text-outline");
		}
	} else {
		container.classList.remove("clock-outline");
		container.style.removeProperty("--ui-text-outline");
	}
}

export function loadFont(fontName) {
	const url = FONT_MAP[fontName];
	if (!url) return;

	const id = `font-${fontName.replace(/\s+/g, "-").toLowerCase()}`;
	if (!document.getElementById(id)) {
		const link = document.createElement("link");
		link.id = id;
		link.rel = "stylesheet";
		link.href = url;
		document.head.appendChild(link);
	}
}
