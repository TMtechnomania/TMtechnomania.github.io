import { renderInlineIcon } from "./brandIconLoader.js";
import { loadCSS, unloadCSS } from "./cssLoader.js";
import { setupModalA11y } from "./uiUtil.js";
import { setZenWallpaperMuted } from "./wallpaper.js";
import { getZenTrackById, getZenTrackList } from "./db.js";
import { STORAGE_KEY_SETTINGS } from "./config.js";
import { updateSettings } from "./settingsSync.js";

let _zenA11yCleanup = null;

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
		mute: false,
	},
};

const CSS_ID = "ambient-mode-css";
const CSS_PATH = "css/ambientMode.css";

const UI_CONTAINER_ID = "zen-mode-overlay";
const PIANO_SRC = "assets/audio/soothing-piano-harmony-224434.mp3";
const ZEN_STATE_KEY = "zenModeState";

// ─── Zen music ──────────────────────────────────────────────────────────────
// Uploaded tracks win over the built-in ambience. The playlist is read from
// IndexedDB on open; `musicMode` comes from userSettings so the choice sticks
// across sessions and is shared on the Zen overlay itself.
const MUSIC_MODES = ["loop", "repeat-one", "shuffle"];
const MUSIC_SOURCES = ["uploaded", "builtin"];
const BUILTIN_TRACK_NAME = "Built-in ambience";
const MUSIC_MODE_LABELS = {
	loop: "Loop",
	"repeat-one": "Repeat 1",
	shuffle: "Shuffle",
};
const MUSIC_MODE_ICONS = {
	loop: "assets/svgs-fontawesome/solid/repeat.svg",
	"repeat-one": "assets/svgs-fontawesome/solid/repeat.svg",
	shuffle: "assets/svgs-fontawesome/solid/shuffle.svg",
};

let zenTracks = [];
let zenTrackIndex = 0;
let zenMusicMode = "loop";
let zenMusicSource = "uploaded";
let zenTrackUrl = null; // blob URL for the currently loaded track
let zenTrackLoadToken = 0;
let zenUsingBuiltin = true;
let zenCurrentTrackId = null;

// Persist the Zen session in chrome.storage.session so a reload (or a service
// worker restart for the blocking/mute state) does not lose it. Session storage
// is cleared when the browser closes, which is the right lifetime for a focus
// session.
function getZenSnapshot() {
	const overlay = document.getElementById(UI_CONTAINER_ID);
	return {
		active: !!overlay && overlay.classList.contains("active"),
		isPlaying: ambientConfig.isPlaying,
		timeLeft: ambientConfig.timeLeft,
		totalTime: ambientConfig.totalTime,
		endsAt:
			ambientConfig.isPlaying ?
				Date.now() + ambientConfig.timeLeft * 1000
			:	null,
		settings: { ...ambientConfig.settings },
	};
}

function persistZenState() {
	try {
		chrome.storage.session.set({ [ZEN_STATE_KEY]: getZenSnapshot() });
	} catch (e) {}
}

function clearZenState() {
	try {
		chrome.storage.session.remove(ZEN_STATE_KEY);
	} catch (e) {}
}

function readZenState() {
	return new Promise((resolve) => {
		try {
			chrome.storage.session.get(ZEN_STATE_KEY, (res) =>
				resolve(res?.[ZEN_STATE_KEY] || null),
			);
		} catch (e) {
			resolve(null);
		}
	});
}

function applyZenState(state) {
	if (!state) return;
	ambientConfig.settings = {
		...ambientConfig.settings,
		...(state.settings || {}),
	};
	ambientConfig.totalTime = state.totalTime || ambientConfig.totalTime;
	const remaining =
		state.isPlaying && state.endsAt ?
			Math.max(0, Math.round((state.endsAt - Date.now()) / 1000))
		:	Math.max(0, state.timeLeft || 0);
	ambientConfig.timeLeft = remaining;
	ambientConfig.isPlaying = false;

	updateTimerDisplay();
	updateProgress(
		ambientConfig.totalTime ? remaining / ambientConfig.totalTime : 1,
	);

	const overlay = document.getElementById(UI_CONTAINER_ID);
	if (overlay) {
		overlay
			.querySelector("#zen-toggle-music")
			?.classList.toggle("active", !!ambientConfig.settings.music);
		overlay
			.querySelector("#zen-toggle-fullscreen")
			?.classList.toggle("active", !!ambientConfig.settings.fullscreen);
		overlay
			.querySelector("#zen-toggle-block")
			?.classList.toggle("active", !!ambientConfig.settings.block);
		overlay
			.querySelector("#zen-toggle-mute")
			?.classList.toggle("active", !!ambientConfig.settings.mute);
	}

	// Re-assert mute ownership for the restored session (the SW merges its
	// existing muted-tab list, so this cannot orphan tabs).
	if (ambientConfig.settings.mute) toggleMuteOthers(true);

	if (remaining <= 0) {
		clearZenState();
		const activePreset = overlay?.querySelector(".preset-btn.active");
		setTime(
			(activePreset ? parseInt(activePreset.dataset.min) : 45) * 60,
		);
		updatePlayButton(false);
		return;
	}
	if (state.isPlaying) startSession();
	else updatePlayButton(false);
}

export function maybeRestoreAmbientMode() {
	try {
		const nav = performance.getEntriesByType?.("navigation")?.[0];
		// Only auto-open on a reload; new tabs should not inherit an unrelated
		// session, but the saved state is still applied if Zen is reopened.
		if (nav?.type !== "reload") return;
		readZenState().then((state) => {
			if (state?.active && (state.isPlaying || state.timeLeft > 0)) {
				restoreAmbientMode();
			}
		});
	} catch (e) {}
}

async function restoreAmbientMode() {
	const state = await readZenState();
	if (!state?.active) return;
	const overlay = await ensureAmbientModeLoaded();
	if (!overlay) return;
	applyZenState(state);
	overlay.classList.add("active");
	document.body.classList.add("zen-active");
	// A restored session is still a focus session: keep the wallpaper silent.
	setZenWallpaperMuted(true);
}

// SVG Circle Constants
const RADIUS = 140;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function initAmbientMode() {
	if (document.getElementById(UI_CONTAINER_ID)) return;

	const overlay = document.createElement("div");
	overlay.id = UI_CONTAINER_ID;
	overlay.className = "ambient-modal";
	overlay.tabIndex = -1;
	overlay.setAttribute("role", "dialog");
	overlay.setAttribute("aria-modal", "true");
	overlay.setAttribute("aria-label", "Focus timer");
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

            <div class="zen-music" id="zen-music-player">
                <button class="zen-music-btn" id="zen-track-prev" title="Previous track" aria-label="Previous track" hidden>
                    <span></span>
                </button>
                <div class="zen-now-playing">
                    <span class="zen-now-playing-name">Built-in ambience</span>
                </div>
                <button class="zen-music-btn" id="zen-track-next" title="Next track" aria-label="Next track" hidden>
                    <span></span>
                </button>
                <button class="zen-music-btn zen-mode-btn" id="zen-playback-mode"
                    title="Playback mode: Loop" aria-label="Playback mode: Loop" hidden>
                    <span class="zen-mode-icon"></span>
                    <span class="zen-mode-label">Loop</span>
                </button>
            </div>
        </div>
    `;

	document.body.appendChild(overlay);
	_zenA11yCleanup = setupModalA11y(overlay, {
		onClose: () => toggleAmbientMode(),
		whenActive: () => overlay.classList.contains("active"),
	});

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
	renderInlineIcon(
		overlay.querySelector("#zen-track-prev span"),
		"assets/svgs-fontawesome/solid/step-backward.svg",
	);
	renderInlineIcon(
		overlay.querySelector("#zen-track-next span"),
		"assets/svgs-fontawesome/solid/step-forward.svg",
	);
	renderInlineIcon(
		overlay.querySelector("#zen-playback-mode .zen-mode-icon"),
		MUSIC_MODE_ICONS.loop,
	);

	// Setup Audio. The source is attached on demand: uploaded Zen tracks take
	// precedence, otherwise the built-in piano ambience loops.
	ambientConfig.audio = new Audio();
	ambientConfig.audio.loop = true;
	ambientConfig.audio.addEventListener("ended", handleZenTrackEnded);

	// Restore the saved playback mode and playlist.
	loadZenMusicSettings();
	loadZenPlaylist();

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
		// Leaving Zen mode restores the wallpaper's normal audio state.
		setZenWallpaperMuted(false);
		stopSession();
		document.body.classList.remove("zen-active");
		clearZenState();
		if (_zenA11yCleanup) {
			_zenA11yCleanup();
			_zenA11yCleanup = null;
		}
		try {
			overlay.remove();
		} catch (e) {}
		unloadCSS(CSS_ID);
		try {
			ambientConfig.audio?.pause();
		} catch (e) {}
		ambientConfig.audio = null;
		revokeZenTrackUrl();
		zenCurrentTrackId = null;
		zenUsingBuiltin = true;
		zenTrackLoadToken++;
		return;
	}

	overlay.classList.add("active");
	document.body.classList.add("zen-active");
	// Zen (Pomodoro) mode silences the video wallpaper for as long as the
	// overlay stays open, then unmutes on exit.
	setZenWallpaperMuted(true);

	// Resume a session saved by this tab (reload or reopening Zen).
	const stored = await readZenState();
	if (stored && (stored.isPlaying || stored.timeLeft > 0)) {
		applyZenState(stored);
	} else if (!ambientConfig.isPlaying) {
		const activePreset = overlay.querySelector(".preset-btn.active");
		const mins = activePreset ? parseInt(activePreset.dataset.min) : 25;
		setTime(mins * 60);
		persistZenState();
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
			persistZenState();
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
			if (ambientConfig.settings.music) playZenMusic();
			else ambientConfig.audio?.pause();
		}
		persistZenState();
	});

	// Fullscreen Toggle
	const fsToggle = overlay.querySelector("#zen-toggle-fullscreen");
	fsToggle.addEventListener("click", () => {
		ambientConfig.settings.fullscreen = !ambientConfig.settings.fullscreen;
		fsToggle.classList.toggle("active", ambientConfig.settings.fullscreen);
		toggleFullscreen(ambientConfig.settings.fullscreen);
		persistZenState();
	});

	// Mute Others Toggle
	const muteToggle = overlay.querySelector("#zen-toggle-mute");
	renderInlineIcon(
		muteToggle.querySelector("span"),
		"assets/svgs-fontawesome/solid/volume-xmark.svg",
	);
	muteToggle.addEventListener("click", () => {
		const isMuted = muteToggle.classList.contains("active");
		const nextMuted = !isMuted;
		ambientConfig.settings.mute = nextMuted;
		toggleMuteOthers(nextMuted);
		muteToggle.classList.toggle("active", nextMuted);
		persistZenState();
	});

	// Music playlist controls (hidden until tracks are uploaded)
	overlay
		.querySelector("#zen-track-prev")
		.addEventListener("click", () => skipZenTrack(-1));
	overlay
		.querySelector("#zen-track-next")
		.addEventListener("click", () => skipZenTrack(1));
	overlay
		.querySelector("#zen-playback-mode")
		.addEventListener("click", () => {
			const nextIndex =
				(MUSIC_MODES.indexOf(zenMusicMode) + 1) % MUSIC_MODES.length;
			setZenMusicMode(MUSIC_MODES[nextIndex]);
			persistZenMusicMode(zenMusicMode);
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
		persistZenState();
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

// Logic for Mute Others. The service worker performs the muting so it can
// restore it even if this tab is closed or the SW was suspended.
async function toggleMuteOthers(enable) {
	try {
		const current = await chrome.tabs.getCurrent();
		chrome.runtime.sendMessage({
			type: "ZEN_MODE_CONTROL",
			action: "MUTE_OTHERS",
			enable: !!enable,
			keepTabId: current?.id ?? null,
		});
	} catch (e) {
		console.warn("Mute toggle failed", e);
	}
}

// ─── Zen music playback ─────────────────────────────────────────────────────

function currentZenTrack() {
	return zenTracks[zenTrackIndex] || null;
}

function randomZenIndex() {
	if (zenTracks.length <= 1) return 0;
	let next = zenTrackIndex;
	while (next === zenTrackIndex) {
		next = Math.floor(Math.random() * zenTracks.length);
	}
	return next;
}

function revokeZenTrackUrl() {
	if (zenTrackUrl) {
		try {
			URL.revokeObjectURL(zenTrackUrl);
		} catch (e) {}
		zenTrackUrl = null;
	}
}

function loadZenMusicSettings() {
	try {
		chrome.storage.local.get(STORAGE_KEY_SETTINGS, (res) => {
			const zen = res?.[STORAGE_KEY_SETTINGS]?.zen || {};
			if (MUSIC_MODES.includes(zen.musicMode)) {
				setZenMusicMode(zen.musicMode);
			}
			if (MUSIC_SOURCES.includes(zen.musicSource)) {
				setZenMusicSource(zen.musicSource);
			}
		});
	} catch (e) {}
}

async function persistZenMusicMode(mode) {
	try {
		await updateSettings((draft) => {
			if (!draft.zen) draft.zen = {};
			if (draft.zen.musicMode === mode) return false;
			draft.zen.musicMode = mode;
		});
	} catch (e) {}
}

/**
 * Re-read the uploaded playlist. Keeps the current track when it still exists,
 * and swaps between uploaded tracks and the built-in ambience when the list
 * changes under an open session.
 */
async function loadZenPlaylist() {
	let list = [];
	try {
		list = await getZenTrackList();
	} catch (e) {
		list = [];
	}
	zenTracks = Array.isArray(list) ? list : [];

	if (zenCurrentTrackId) {
		const idx = zenTracks.findIndex((t) => t.id === zenCurrentTrackId);
		if (idx >= 0) zenTrackIndex = idx;
		else {
			zenCurrentTrackId = null;
			zenTrackIndex = 0;
		}
	}
	if (zenTrackIndex >= zenTracks.length) zenTrackIndex = 0;

	updateZenMusicUI();

	// A restored session may already be playing the built-in ambience by the
	// time IndexedDB answers; switch to the user's playlist now.
	if (
		zenMusicSource === "uploaded" &&
		zenTracks.length > 0 &&
		ambientConfig.isPlaying &&
		ambientConfig.settings.music &&
		(zenUsingBuiltin ||
			!currentZenTrack() ||
			zenCurrentTrackId !== currentZenTrack().id)
	) {
		playZenTrackAt(zenTrackIndex);
	}
}

/** Start (or resume) whatever music the session should currently play. */
function playZenMusic() {
	const audio = ambientConfig.audio;
	if (!audio || !ambientConfig.settings.music) return;

	if (zenMusicSource === "builtin" || zenTracks.length === 0) {
		playBuiltinMusic();
		return;
	}

	const track = currentZenTrack();
	if (track && !zenUsingBuiltin && zenCurrentTrackId === track.id) {
		audio.play().catch(() => {});
		return;
	}
	playZenTrackAt(zenTrackIndex);
}

function playBuiltinMusic() {
	const audio = ambientConfig.audio;
	if (!audio) return;
	const previousUrl = zenTrackUrl;
	zenTrackUrl = null;
	zenCurrentTrackId = null;
	if (!zenUsingBuiltin || !audio.src) {
		audio.src = PIANO_SRC;
		zenUsingBuiltin = true;
	}
	if (previousUrl) {
		try {
			URL.revokeObjectURL(previousUrl);
		} catch (e) {}
	}
	audio.loop = true;
	audio.play().catch(() => {});
	updateZenMusicUI();
}

async function playZenTrackAt(index) {
	if (!zenTracks.length) {
		playBuiltinMusic();
		return;
	}
	const safeIndex =
		((index % zenTracks.length) + zenTracks.length) % zenTracks.length;
	const track = zenTracks[safeIndex];
	zenTrackIndex = safeIndex;
	updateZenMusicUI();

	const token = ++zenTrackLoadToken;
	let entry = null;
	try {
		entry = await getZenTrackById(track.id);
	} catch (e) {
		entry = null;
	}
	if (
		!entry?.blob ||
		token !== zenTrackLoadToken ||
		!ambientConfig.audio ||
		zenMusicSource !== "uploaded"
	)
		return;

	const audio = ambientConfig.audio;
	const previousUrl = zenTrackUrl;
	zenTrackUrl = URL.createObjectURL(entry.blob);
	zenCurrentTrackId = track.id;
	zenUsingBuiltin = false;
	audio.src = zenTrackUrl;
	if (previousUrl) {
		try {
			URL.revokeObjectURL(previousUrl);
		} catch (e) {}
	}
	audio.loop = zenMusicMode === "repeat-one";
	if (ambientConfig.settings.music) audio.play().catch(() => {});
	updateZenMusicUI();
}

function skipZenTrack(delta) {
	if (zenMusicSource !== "uploaded" || !zenTracks.length) return;
	const next =
		zenMusicMode === "shuffle" && delta > 0 ?
			randomZenIndex()
		:	(zenTrackIndex + delta + zenTracks.length) % zenTracks.length;
	playZenTrackAt(next);
}

function handleZenTrackEnded() {
	const audio = ambientConfig.audio;
	if (!audio || !ambientConfig.settings.music) return;
	if (zenMusicSource !== "uploaded" || !zenTracks.length) {
		audio.play().catch(() => {});
		return;
	}
	if (zenMusicMode === "repeat-one") {
		playZenTrackAt(zenTrackIndex);
	} else if (zenMusicMode === "shuffle") {
		playZenTrackAt(randomZenIndex());
	} else {
		playZenTrackAt(zenTrackIndex + 1);
	}
}

/** Update the playback mode (also used by the Settings panel). */
export function setZenMusicMode(mode) {
	if (!MUSIC_MODES.includes(mode)) return;
	zenMusicMode = mode;
	const audio = ambientConfig.audio;
	if (audio) {
		audio.loop =
			zenMusicSource === "builtin" ||
			zenUsingBuiltin ||
			zenTracks.length === 0 ?
				true
			:	mode === "repeat-one";
	}
	updateZenMusicUI();
}

/**
 * Switch between the personal playlist and the bundled ambience. The choice is
 * persisted by the Settings panel; this only applies it to the live session.
 */
export function setZenMusicSource(source) {
	if (!MUSIC_SOURCES.includes(source)) return;
	if (zenMusicSource === source) {
		updateZenMusicUI();
		return;
	}
	zenMusicSource = source;
	// Cancel any in-flight track load before switching audio sources.
	zenTrackLoadToken++;
	updateZenMusicUI();
	if (!ambientConfig.isPlaying || !ambientConfig.settings.music) return;
	if (source === "builtin" || zenTracks.length === 0) {
		playBuiltinMusic();
	} else {
		playZenMusic();
	}
}

/** Re-read tracks after the Settings panel uploads or deletes a file. */
export async function refreshZenMusic() {
	await loadZenPlaylist();
	if (!ambientConfig.isPlaying || !ambientConfig.settings.music) return;
	if (zenTracks.length) playZenMusic();
	else playBuiltinMusic();
}

function updateZenMusicUI() {
	const overlay = document.getElementById(UI_CONTAINER_ID);
	if (!overlay) return;
	const player = overlay.querySelector("#zen-music-player");
	if (!player) return;

	const useUploaded =
		zenMusicSource === "uploaded" && zenTracks.length > 0;
	// Always visible: the built-in ambience must stay listed even after the
	// user uploads personal tracks.
	player.hidden = false;
	player.classList.toggle("is-builtin", !useUploaded);

	const track = useUploaded ? currentZenTrack() : null;
	const nameEl = player.querySelector(".zen-now-playing-name");
	if (nameEl) {
		nameEl.textContent =
			useUploaded ? track?.name || "Track" : BUILTIN_TRACK_NAME;
	}

	// Track controls only apply to the uploaded playlist.
	for (const sel of [
		"#zen-track-prev",
		"#zen-track-next",
		"#zen-playback-mode",
	]) {
		const btn = player.querySelector(sel);
		if (btn) btn.hidden = !useUploaded;
	}

	const modeBtn = player.querySelector("#zen-playback-mode");
	if (!modeBtn) return;
	const label = MUSIC_MODE_LABELS[zenMusicMode] || "Loop";
	const labelEl = modeBtn.querySelector(".zen-mode-label");
	if (labelEl) labelEl.textContent = label;
	modeBtn.title = `Playback mode: ${label}`;
	modeBtn.setAttribute("aria-label", `Playback mode: ${label}`);
	if (modeBtn.dataset.mode !== zenMusicMode) {
		modeBtn.dataset.mode = zenMusicMode;
		renderInlineIcon(
			modeBtn.querySelector(".zen-mode-icon"),
			MUSIC_MODE_ICONS[zenMusicMode],
		);
	}
}

// The Zen overlay itself can change the mode, and another new-tab page may do
// the same, so keep this instance in sync with the stored setting.
try {
	chrome.storage.onChanged.addListener((changes, area) => {
		if (area !== "local" || !changes[STORAGE_KEY_SETTINGS]) return;
		const zen = changes[STORAGE_KEY_SETTINGS].newValue?.zen || {};
		if (MUSIC_MODES.includes(zen.musicMode)) {
			setZenMusicMode(zen.musicMode);
		}
		if (MUSIC_SOURCES.includes(zen.musicSource)) {
			setZenMusicSource(zen.musicSource);
		}
	});
} catch (e) {}

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

	// Audio: uploaded tracks if present, built-in ambience otherwise. Refresh
	// the library first so tracks uploaded from another tab are picked up.
	loadZenPlaylist();
	if (ambientConfig.settings.music) {
		playZenMusic();
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

	persistZenState();
}

function pauseSession() {
	ambientConfig.isPlaying = false;
	updatePlayButton(false);
	clearInterval(ambientConfig.timerInterval);
	ambientConfig.audio?.pause();
	persistZenState();
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
	persistZenState();
}

// Best-effort cleanup if the Zen tab is closed/reloaded without hitting the
// exit button. The service worker also restores mutes when the tab disappears.
if (typeof window !== "undefined") {
	window.addEventListener("pagehide", () => {
		const muteBtn = document.querySelector("#zen-toggle-mute");
		if (muteBtn && muteBtn.classList.contains("active")) {
			toggleMuteOthers(false);
		}
	});
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
