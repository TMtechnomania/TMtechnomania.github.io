import { renderInlineIcon } from "./brandIconLoader.js";
import { loadCSS, unloadCSS } from "./cssLoader.js";

let ambientConfig = {
	active: false,
	timeLeft: 0,
	totalTime: 0,
	timerInterval: null,
	audio: null,
	isPlaying: false,
	inactivityTimer: null,
	settings: {
		music: true,
		fullscreen: false,
		block: false, // Visual blocking
	},
};

const CSS_ID = "ambient-mode-css";
const CSS_PATH = "css/ambientMode.css";

const UI_CONTAINER_ID = "zen-mode-overlay";
const PIANO_SRC = "assets/audio/soothing-piano-harmony-224434.mp3";

// SVG Circle Constants
const RADIUS = 140;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function initAmbientMode() {
	if (document.getElementById(UI_CONTAINER_ID)) return;

	const overlay = document.createElement("div");
	overlay.id = UI_CONTAINER_ID;
	overlay.className = "ambient-modal";
	overlay.innerHTML = `
        <button class="zen-close" title="Exit Zen Mode">&times;</button>
        
        <div class="zen-timer-container">
            <svg class="zen-svg" width="300" height="300" viewBox="0 0 300 300">
                <circle class="zen-circle-bg" cx="150" cy="150" r="${RADIUS}"></circle>
                <circle class="zen-circle-progress" cx="150" cy="150" r="${RADIUS}"></circle>
            </svg>
            <div class="zen-time-display">00:00</div>
        </div>

        <div class="zen-controls">
            <div class="zen-presets">
                <button class="btn btn-text preset-btn" data-min="10">10m</button>
                <button class="btn btn-text preset-btn" data-min="25">25m</button>
                <button class="btn btn-text preset-btn active" data-min="45">45m</button>
            </div>

            <button class="zen-play-btn" title="Start/Pause">
                <div class="zen-play-icon"></div>
            </button>

            <div class="zen-toggles">
                <button class="btn btn-icon-text toggle-btn active" id="zen-toggle-music" title="Toggle Music">
                    <span></span> Music
                </button>
                <button class="btn btn-icon-text toggle-btn" id="zen-toggle-fullscreen" title="Toggle Fullscreen">
                    <span></span> Fullscreen
                </button>
                <button class="btn btn-icon-text toggle-btn" id="zen-toggle-mute" title="Mute other tabs">
                    <span></span> Mute Others
                </button>
                <button class="btn btn-icon-text toggle-btn" id="zen-toggle-block" title="Prevent tab switching">
                    <span></span> Block Web
                </button>
            </div>
        </div>
    `;

	document.body.appendChild(overlay);

	// Icons
	renderInlineIcon(
		overlay.querySelector(".zen-play-btn .zen-play-icon"),
		"assets/svgs-fontawesome/solid/play.svg",
	);
	renderInlineIcon(
		overlay.querySelector("#zen-toggle-music span"),
		"assets/svgs-fontawesome/solid/music.svg",
	);
	renderInlineIcon(
		overlay.querySelector("#zen-toggle-fullscreen span"),
		"assets/svgs-fontawesome/solid/expand.svg",
	);

	// Setup Audio
	ambientConfig.audio = new Audio(PIANO_SRC);
	ambientConfig.audio.loop = true;

	// Bind Events
	bindEvents(overlay);

	// Init default state
	setTime(45 * 60); // Default 45m
}


async function ensureAmbientModeLoaded() {
	await loadCSS(CSS_PATH, CSS_ID);
	initAmbientMode();
	return document.getElementById(UI_CONTAINER_ID);
}

export async function toggleAmbientMode() {
	let overlay = document.getElementById(UI_CONTAINER_ID);
	if (!overlay) {
		overlay = await ensureAmbientModeLoaded();
	}
	if (!overlay) return;

	const isActive = overlay.classList.contains("active");
	if (isActive) {
		stopSession();
		document.body.classList.remove("zen-active");
		try {
			overlay.remove();
		} catch (e) {}
		unloadCSS(CSS_ID);
		try {
			ambientConfig.audio?.pause();
		} catch (e) {}
		ambientConfig.audio = null;
		return;
	}

	overlay.classList.add("active");
	document.body.classList.add("zen-active");
	// Reset state if needed
	if (!ambientConfig.isPlaying) {
		const activePreset = overlay.querySelector(".preset-btn.active");
		const mins = activePreset ? parseInt(activePreset.dataset.min) : 25;
		setTime(mins * 60);
	}
}

function resetInactivityTimer() {
	const overlay = document.getElementById(UI_CONTAINER_ID);
	if (!overlay) return;

	// Show UI
	overlay.classList.remove("zen-ui-hidden");

	// Clear existing
	if (ambientConfig.inactivityTimer) {
		clearTimeout(ambientConfig.inactivityTimer);
	}

	// Only hide if playing? Or always? User said "when ambient mode is running" -> usually implies active session.
	// But let's do it always when the modal is open for consistency.
	ambientConfig.inactivityTimer = setTimeout(() => {
		overlay.classList.add("zen-ui-hidden");
	}, 10000); // 10s
}

function bindEvents(overlay) {
	// Inactivity Listeners
	const reset = () => resetInactivityTimer();
	overlay.addEventListener("mousemove", reset);
	overlay.addEventListener("click", reset);
	overlay.addEventListener("keydown", reset);

	// Initial reset
	resetInactivityTimer();

	// Close
	overlay.querySelector(".zen-close").addEventListener("click", () => {
		toggleAmbientMode(); // Close
	});

	// Presets
	overlay.querySelectorAll(".preset-btn").forEach((btn) => {
		btn.addEventListener("click", () => {
			stopSession(); // Stop if changing time
			overlay
				.querySelectorAll(".preset-btn")
				.forEach((b) => b.classList.remove("active"));
			btn.classList.add("active");
			const mins = parseInt(btn.dataset.min);
			setTime(mins * 60);
		});
	});

	// Play/Pause
	overlay.querySelector(".zen-play-btn").addEventListener("click", () => {
		if (ambientConfig.isPlaying) {
			pauseSession();
		} else {
			startSession();
		}
	});

	// Music Toggle
	const musicToggle = overlay.querySelector("#zen-toggle-music");
	musicToggle.addEventListener("click", () => {
		ambientConfig.settings.music = !ambientConfig.settings.music;
		musicToggle.classList.toggle("active", ambientConfig.settings.music);
		if (ambientConfig.isPlaying) {
			if (ambientConfig.settings.music) ambientConfig.audio.play();
			else ambientConfig.audio.pause();
		}
	});

	// Fullscreen Toggle
	const fsToggle = overlay.querySelector("#zen-toggle-fullscreen");
	fsToggle.addEventListener("click", () => {
		ambientConfig.settings.fullscreen = !ambientConfig.settings.fullscreen;
		fsToggle.classList.toggle("active", ambientConfig.settings.fullscreen);
		toggleFullscreen(ambientConfig.settings.fullscreen);
	});

	// Mute Others Toggle
	const muteToggle = overlay.querySelector("#zen-toggle-mute");
	renderInlineIcon(
		muteToggle.querySelector("span"),
		"assets/svgs-fontawesome/solid/volume-xmark.svg",
	);
	muteToggle.addEventListener("click", () => {
		const isMuted = muteToggle.classList.contains("active");
		toggleMuteOthers(!isMuted);
		muteToggle.classList.toggle("active", !isMuted);
	});

	// Block Focus Toggle
	const blockToggle = overlay.querySelector("#zen-toggle-block");
	renderInlineIcon(
		blockToggle.querySelector("span"),
		"assets/svgs-fontawesome/solid/shield-halved.svg",
	);
	blockToggle.addEventListener("click", () => {
		ambientConfig.settings.block = !ambientConfig.settings.block;
		blockToggle.classList.toggle("active", ambientConfig.settings.block);
		toggleBlockFocus(ambientConfig.settings.block);
	});
}

// Logic for Block Focus
async function toggleBlockFocus(enable) {
	try {
		// Use query to get the current active tab in the current window
		// This is more reliable than getCurrent for extension pages
		const tabs = await chrome.tabs.query({
			active: true,
			currentWindow: true,
		});
		if (!tabs || tabs.length === 0) {
			console.warn("Could not get current tab for Block Web");
			return;
		}
		const currentTab = tabs[0];
		console.log(
			"Block Web:",
			enable ? "ENABLING" : "DISABLING",
			"for tab ID:",
			currentTab.id,
		);

		chrome.runtime.sendMessage({
			type: "ZEN_MODE_CONTROL",
			action: enable ? "ENABLE_BLOCK" : "DISABLE_BLOCK",
			tabId: currentTab.id,
		});
	} catch (e) {
		console.warn("Failed to toggle block", e);
	}
}

// Logic for Mute Others
let previouslyMutedTabs = []; // Store state? Or just unmute all on exit?
// Simpler: Unmute all on exit that we muted. But tracking is hard if tabs close.
// Strategy: "Mute Others" = mute all except current. "Unmute" = unmute all except current?
// Or restore? Let's try to restore.

async function toggleMuteOthers(enable) {
	try {
		const current = await chrome.tabs.getCurrent(); // May be undefined in non-tab context, but we are newtab
		if (!current) return;

		const all = await chrome.tabs.query({});
		const others = all.filter((t) => t.id !== current.id);

		if (enable) {
			previouslyMutedTabs = others
				.filter((t) => t.mutedInfo.muted)
				.map((t) => t.id);
			// Mute everyone else
			for (const t of others) {
				if (!t.mutedInfo.muted) {
					chrome.tabs.update(t.id, { muted: true });
				}
			}
		} else {
			// Restore
			for (const t of others) {
				// If it was NOT muted before, unmute it.
				// If it WAS muted before (in previous list), leave it muted.
				if (!previouslyMutedTabs.includes(t.id)) {
					chrome.tabs.update(t.id, { muted: false });
				}
			}
			previouslyMutedTabs = [];
		}
	} catch (e) {
		console.warn("Mute toggle failed", e);
	}
}

function setTime(seconds) {
	ambientConfig.timeLeft = seconds;
	ambientConfig.totalTime = seconds;
	updateTimerDisplay();
	updateProgress(1);
}

function updateTimerDisplay() {
	const min = Math.floor(ambientConfig.timeLeft / 60);
	const sec = ambientConfig.timeLeft % 60;
	const text = `${min.toString().padStart(2, "0")}:${sec
		.toString()
		.padStart(2, "0")}`;
	const el = document.querySelector("#zen-mode-overlay .zen-time-display");
	if (el) el.textContent = text;
}

function updateProgress(percent) {
	// percent 0 to 1
	const offset = CIRCUMFERENCE - percent * CIRCUMFERENCE;
	const circle = document.querySelector(
		"#zen-mode-overlay .zen-circle-progress",
	);
	if (circle) {
		circle.style.strokeDashoffset = offset;
	}
}

function startSession() {
	if (ambientConfig.timeLeft <= 0) return;
	ambientConfig.isPlaying = true;
	updatePlayButton(true);

	// Audio
	if (ambientConfig.settings.music) {
		ambientConfig.audio.play();
	}

	// Fullscreen if requested
	if (ambientConfig.settings.fullscreen) {
		toggleFullscreen(true);
	}

	// Timer
	ambientConfig.timerInterval = setInterval(() => {
		ambientConfig.timeLeft--;
		updateTimerDisplay();
		const progress = ambientConfig.timeLeft / ambientConfig.totalTime;
		updateProgress(progress);

		if (ambientConfig.timeLeft <= 0) {
			stopSession();
			// Maybe play a chime?
			// Reset
		}
	}, 1000);
}

function pauseSession() {
	ambientConfig.isPlaying = false;
	updatePlayButton(false);
	clearInterval(ambientConfig.timerInterval);
	ambientConfig.audio.pause();
}

function stopSession() {
	pauseSession();
	if (ambientConfig.inactivityTimer) {
		clearTimeout(ambientConfig.inactivityTimer);
	}
	// Disable Block Logic
	toggleBlockFocus(false);
	// Unmute (Restore) Logic if active
	const muteBtn = document.querySelector("#zen-toggle-mute");
	if (muteBtn && muteBtn.classList.contains("active")) {
		toggleMuteOthers(false);
		muteBtn.classList.remove("active");
	}

	// Reset time to selected preset
	const overlay = document.getElementById(UI_CONTAINER_ID);
	if (overlay) {
		const activePreset = overlay.querySelector(".preset-btn.active");
		if (activePreset) {
			setTime(parseInt(activePreset.dataset.min) * 60);
		}
	}
	toggleFullscreen(false); // Exit FS on stop? Or keep?
	// User might want to stay in FS. Let's keep unless they close.
}

function updatePlayButton(isPlaying) {
	const btn = document.querySelector("#zen-mode-overlay .zen-play-btn");
	const icon = btn.querySelector(".zen-play-icon");
	if (isPlaying) {
		renderInlineIcon(icon, "assets/svgs-fontawesome/solid/pause.svg");
	} else {
		renderInlineIcon(icon, "assets/svgs-fontawesome/solid/play.svg");
	}
}

function toggleFullscreen(enable) {
	if (enable) {
		document.documentElement.requestFullscreen().catch((e) => {});
	} else {
		if (document.fullscreenElement) {
			document.exitFullscreen().catch((e) => {});
		}
	}
}
