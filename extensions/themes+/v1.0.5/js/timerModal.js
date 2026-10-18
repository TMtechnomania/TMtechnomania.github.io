import { loadCSS, unloadCSS } from "./cssLoader.js";
import { renderInlineIcon } from "./brandIconLoader.js";
const CSS_ID = "timer-modal-css";
const CSS_PATH = "css/timerModal.css";
const AUDIO_SRC = "assets/audio/mixkit-positive-interface-beep-221.wav";
let _backdrop = null;
let _state = {
	mode: "timer",
	timerRemaining: 0,
	timerRunning: false,
	stopwatchTime: 0,
	stopwatchRunning: false,
	stopwatchLaps: [],
	timerInterval: null,
	stopwatchInterval: null,
	audio: null,
};
const PRESETS = [
	{ id: "p_tea", title: "Tea steep", seconds: 180 },
	{ id: "p_coffee", title: "Coffee brew", seconds: 300 },
	{ id: "p_workout", title: "Quick workout", seconds: 600 },
	{ id: "p_focus", title: "Focus", seconds: 1500 },
];

function createIconSpan(iconPath, className = "") {
	const icon = document.createElement("span");
	icon.className = ["ui-icon", className].filter(Boolean).join(" ");
	icon.setAttribute("aria-hidden", "true");
	renderInlineIcon(icon, iconPath);
	return icon;
}

function attachIcon(target, iconPath, className = "") {
	if (!target) return null;
	const icon = createIconSpan(iconPath, className);
	target.appendChild(icon);
	return icon;
}

function updateAttachedIcon(target, iconPath, className = "") {
	if (!target) return;
	const icon =
		(className && target.querySelector(`.${className}`)) ||
		target.querySelector(".ui-icon");
	if (icon) {
		renderInlineIcon(icon, iconPath);
	}
}

function updateIconById(elementId, iconPath, className = "tm-btn-icon") {
	const target = document.getElementById(elementId);
	if (target) updateAttachedIcon(target, iconPath, className);
}
function formatTimeMs(ms, showMs = false) {
	const total = Math.max(0, Math.floor(ms));
	const s = Math.floor(total / 1000);
	const minutes = Math.floor(s / 60);
	const seconds = s % 60;
	const remMs = total % 1000;
	return showMs
		? `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(
				2,
				"0",
		  )}.${String(Math.floor(remMs / 10)).padStart(2, "0")}`
		: `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(
				2,
				"0",
		  )}`;
}
function parseTimeInput(str) {
	if (!str) return 0;
	const s = String(str).trim().toLowerCase();
	if (s.includes(":")) {
		const parts = s.split(":").map((p) => p.trim());
		if (parts.length === 2) {
			const m = parseInt(parts[0], 10) || 0;
			const sec = parseInt(parts[1], 10) || 0;
			return (m * 60 + sec) * 1000;
		}
		if (parts.length === 3) {
			const h = parseInt(parts[0], 10) || 0;
			const m = parseInt(parts[1], 10) || 0;
			const sec = parseInt(parts[2], 10) || 0;
			return (h * 3600 + m * 60 + sec) * 1000;
		}
	}
	const match = s.match(/^([0-9]+)\s*(m|s)?$/);
	if (match) {
		const val = parseInt(match[1], 10) || 0;
		if (match[2] === "m") return val * 60 * 1000;
		return val * 1000;
	}
	const num = parseInt(s, 10);
	if (!isNaN(num)) return num * 1000;
	return null;
}
async function openTimerModal() {
	if (_backdrop) {
		try {
			_backdrop.querySelector(".timer-modal").focus();
		} catch (e) {}
		return;
	}
	try {
		if (_state.timerInterval) {
			clearInterval(_state.timerInterval);
			_state.timerInterval = null;
		}
	} catch (e) {}
	try {
		if (_state.stopwatchInterval) {
			clearInterval(_state.stopwatchInterval);
			_state.stopwatchInterval = null;
		}
	} catch (e) {}
	try {
		if (_state.audio) {
			_state.audio.pause();
			_state.audio.currentTime = 0;
		}
	} catch (e) {}
	_state.timerRunning = false;
	_state.stopwatchRunning = false;
	if (typeof _state.alertEnabled === "undefined") _state.alertEnabled = true;
	await loadCSS(CSS_PATH, CSS_ID);
	try {
		const raw = localStorage.getItem("timer_last_laps");
		if (raw) _state.stopwatchLaps = JSON.parse(raw).slice(-3);
	} catch (e) {}
	_backdrop = document.createElement("div");
	_backdrop.className = "timer-modal-backdrop";
	const modal = document.createElement("div");
	modal.id = "timer-modal";
	modal.className = "timer-modal";
	modal.setAttribute("role", "dialog");
	modal.setAttribute("aria-modal", "true");
	modal.tabIndex = -1;

	// Header
	const header = document.createElement("div");
	header.className = "modal-header";
	const headerTitle = document.createElement("div");
	headerTitle.className = "btn btn-icon-text btn-display modal-title";
	headerTitle.innerHTML = `<span></span><span class="text">Timer</span>`;
	renderInlineIcon(
		headerTitle.querySelector("span:first-child"),
		"assets/svgs-fontawesome/solid/hourglass-half.svg",
	);
	header.appendChild(headerTitle);

	// Header Actions Group
	const actionsGroup = document.createElement("div");
	actionsGroup.style.display = "flex";
	actionsGroup.style.gap = "var(--dis-1)";

	const closeBtn = document.createElement("button");
	closeBtn.className = "btn btn-icon";
	closeBtn.title = "Close";
	const closeIcon = document.createElement("span");
	renderInlineIcon(closeIcon, "assets/svgs-fontawesome/solid/xmark.svg");
	closeBtn.appendChild(closeIcon);
	closeBtn.addEventListener("click", () => closeTimerModal());
	actionsGroup.appendChild(closeBtn);

	header.appendChild(actionsGroup);
	modal.appendChild(header);

	const body = document.createElement("div");
	body.className = "timer-body";
	const displayWrap = document.createElement("div");
	displayWrap.className = "timer-display-wrap";
	const display = document.createElement("div");
	display.className = "timer-display";
	display.id = "timer-display";
	display.textContent = "00:00";
	const editBtn = document.createElement("button");
	editBtn.className = "btn btn-icon edit-btn";
	editBtn.id = "tm-edit";
	editBtn.title = "Edit time";
	const editBtnIcon = attachIcon(
		editBtn,
		"assets/svgs-fontawesome/solid/pen-to-square.svg",
	);
	displayWrap.appendChild(display);
	displayWrap.appendChild(editBtn);
	body.append(displayWrap);
	const presets = document.createElement("div");
	presets.className = "presets";
	presets.id = "timer-presets";
	PRESETS.forEach((p) => {
		const btn = document.createElement("button");
		btn.className = "btn btn-text preset-btn";
		btn.innerHTML = `<div>${p.title}</div><div>${Math.floor(
			p.seconds / 60,
		)}:${String(p.seconds % 60).padStart(2, "0")}</div>`;
		btn.id = `preset-${p.id}`;
		btn.addEventListener("click", () => {
			try {
				_state.editing = false;
				display.contentEditable = "false";
				display.classList.remove("editing");
				updateAttachedIcon(
					editBtn,
					"assets/svgs-fontawesome/solid/pen-to-square.svg",
				);
			} catch (e) {}
			_state.timerRemaining = p.seconds * 1000;
			updateDisplay();
			try {
				updateIconById(
					"tm-start-pause",
					"assets/svgs-fontawesome/solid/circle-play.svg",
				);
			} catch (e) {}
		});
		presets.appendChild(btn);
	});
	body.appendChild(presets);
	const saveIcon = "assets/svgs-fontawesome/solid/floppy-disk.svg";
	editBtn.addEventListener("click", (ev) => {
		ev.stopPropagation();
		if (!_state.editing) {
			_state.editing = true;
			try {
				pauseTimer();
			} catch (e) {}
			try {
				display.contentEditable = "true";
				display.classList.add("editing");
			} catch (e) {}
			try {
				updateAttachedIcon(editBtn, saveIcon);
				const sp = document.getElementById("tm-start-pause");
				if (sp) sp.disabled = true;
			} catch (e) {}
			try {
				display.focus();
				const range = document.createRange();
				range.selectNodeContents(display);
				const sel = window.getSelection();
				sel.removeAllRanges();
				sel.addRange(range);
			} catch (e) {}
			return;
		}
		const ms = parseTimeInput(display.textContent);
		if (ms === null) {
			try {
				alert("Please enter a valid time (mm:ss or seconds).");
			} catch (e) {}
			return;
		}
		_state.timerRemaining = ms;
		_state.editing = false;
		try {
			display.contentEditable = "false";
			display.classList.remove("editing");
		} catch (e) {}
		try {
			updateAttachedIcon(
				editBtn,
				"assets/svgs-fontawesome/solid/pen-to-square.svg",
			);
		} catch (e) {}
		updateDisplay();
		try {
			const sp = document.getElementById("tm-start-pause");
			if (sp) sp.disabled = !(_state.timerRemaining > 0);
		} catch (e) {}
	});
	display.addEventListener("keydown", (ev) => {
		if (!_state.editing) return;
		if (ev.key === "Enter") {
			ev.preventDefault();
			try {
				editBtn.click();
			} catch (e) {}
		}
		if (ev.key === "Escape") {
			_state.editing = false;
			try {
				display.contentEditable = "false";
				display.classList.remove("editing");
			} catch (e) {}
			try {
				updateAttachedIcon(
					editBtn,
					"assets/svgs-fontawesome/solid/pen-to-square.svg",
				);
			} catch (e) {}
			try {
				const sp = document.getElementById("tm-start-pause");
				if (sp) sp.disabled = !(_state.timerRemaining > 0);
			} catch (e) {}
			updateDisplay();
		}
	});
	const controls = document.createElement("div");
	controls.className = "timer-controls action-group";
	controls.id = "timer-controls";
	const startPauseBtn = document.createElement("button");
	startPauseBtn.className = "btn btn-icon";
	startPauseBtn.id = "tm-start-pause";
	attachIcon(startPauseBtn, "assets/svgs-fontawesome/solid/circle-play.svg");
	const resetBtn = document.createElement("button");
	resetBtn.className = "btn btn-icon";
	resetBtn.id = "tm-reset";
	attachIcon(resetBtn, "assets/svgs-fontawesome/solid/rotate-left.svg");
	const alertBtn = document.createElement("button");
	alertBtn.className = "btn btn-icon alert-btn";
	alertBtn.id = "tm-alert";
	alertBtn.title = "Alert on/off";
	alertBtn.setAttribute("aria-pressed", String(!!_state.alertEnabled));
	const volOn = "assets/svgs-fontawesome/solid/volume-high.svg";
	const volOff = "assets/svgs-fontawesome/solid/volume-xmark.svg";
	attachIcon(alertBtn, _state.alertEnabled ? volOn : volOff);
	controls.appendChild(startPauseBtn);
	controls.appendChild(resetBtn);
	controls.appendChild(alertBtn);
	body.appendChild(controls);
	try {
		document.getElementById("tm-start-pause").disabled =
			_state.editing || !(_state.timerRemaining > 0);
	} catch (e) {}
	if (_state.alertEnabled) alertBtn.classList.add("active");
	else alertBtn.classList.remove("active");
	const swLaps = document.createElement("div");
	swLaps.className = "stopwatch-laps";
	swLaps.id = "stopwatch-laps";
	body.appendChild(swLaps);
	const swControls = document.createElement("div");
	swControls.className = "timer-controls action-group";
	swControls.id = "stopwatch-controls";
	const swStart = document.createElement("button");
	swStart.className = "btn btn-icon";
	swStart.id = "sw-start";
	attachIcon(swStart, "assets/svgs-fontawesome/solid/circle-play.svg");
	const swLap = document.createElement("button");
	swLap.className = "btn btn-icon";
	swLap.id = "sw-lap";
	attachIcon(swLap, "assets/svgs-fontawesome/solid/flag.svg");
	const swReset = document.createElement("button");
	swReset.className = "btn btn-icon";
	swReset.id = "sw-reset";
	attachIcon(swReset, "assets/svgs-fontawesome/solid/rotate-left.svg");
	swControls.appendChild(swStart);
	swControls.appendChild(swLap);
	swControls.appendChild(swReset);
	body.appendChild(swControls);
	modal.appendChild(body);
	const tabs = document.createElement("div");
	tabs.className = "timer-tabs";
	const t1 = document.createElement("div");
	t1.className = "btn btn-icon-text btn-display timer-tab active";
	t1.id = "tab-timer";
	attachIcon(
		t1,
		"assets/svgs-fontawesome/solid/hourglass-half.svg",
		"btn-icon-svg",
	);
	const t1Label = document.createElement("span");
	t1Label.className = "text";
	t1Label.textContent = "Timer";
	t1.appendChild(t1Label);
	const t2 = document.createElement("div");
	t2.className = "btn btn-icon-text btn-display timer-tab";
	t2.id = "tab-stopwatch";
	attachIcon(
		t2,
		"assets/svgs-fontawesome/solid/stopwatch.svg",
		"btn-icon-svg",
	);
	const t2Label = document.createElement("span");
	t2Label.className = "text";
	t2Label.textContent = "Stopwatch";
	t2.appendChild(t2Label);
	tabs.appendChild(t1);
	tabs.appendChild(t2);
	modal.appendChild(tabs);
	_backdrop.appendChild(modal);
	document.body.appendChild(_backdrop);
	_state.audio = new Audio(AUDIO_SRC);
	_state.audio.loop = true;
	t1.addEventListener("click", () => switchMode("timer", modal));
	t2.addEventListener("click", () => switchMode("stopwatch", modal));
	startPauseBtn.addEventListener("click", (ev) => {
		ev.stopPropagation();
		if (_state.editing) return;
		const el = document.getElementById("tm-start-pause");
		if (_state.timerRunning) {
			pauseTimer();
			if (el)
				updateAttachedIcon(
					el,
					"assets/svgs-fontawesome/solid/circle-play.svg",
				);
		} else {
			startTimer();
			if (el)
				updateAttachedIcon(
					el,
					"assets/svgs-fontawesome/solid/circle-pause.svg",
				);
		}
	});
	resetBtn.addEventListener("click", resetTimer);
	swStart.addEventListener("click", toggleStopwatch);
	swLap.addEventListener("click", recordLap);
	swReset.addEventListener("click", resetStopwatch);
	_state.alertEnabled = true;
	alertBtn.addEventListener("click", (ev) => {
		ev.stopPropagation();
		_state.alertEnabled = !_state.alertEnabled;
		alertBtn.classList.toggle("active", _state.alertEnabled);
		alertBtn.setAttribute("aria-pressed", String(!!_state.alertEnabled));
		try {
			updateAttachedIcon(alertBtn, _state.alertEnabled ? volOn : volOff);
		} catch (e) {}
	});
	_backdrop.addEventListener("keydown", (ev) => {
		if (ev.key === "Escape") closeTimerModal();
	});
	switchMode(_state.mode, modal);
	updateDisplay();
	renderLaps();
	try {
		modal.focus();
	} catch (e) {}
}
function closeTimerModal() {
	if (!_backdrop) return;
	if (_state.timerRunning || _state.stopwatchRunning) {
		if (
			!confirm(
				"Timer or Stopwatch is running. Closing will reset it. Continue?",
			)
		) {
			return;
		}
	}
	clearInterval(_state.timerInterval);
	_state.timerInterval = null;
	clearInterval(_state.stopwatchInterval);
	_state.stopwatchInterval = null;
	try {
		document.body.removeChild(_backdrop);
	} catch (e) {}
	_backdrop = null;
	try {
		unloadCSS(CSS_ID);
	} catch (e) {}
	try {
		if (_state.audio) {
			_state.audio.pause();
			_state.audio.currentTime = 0;
		}
	} catch (e) {}
	try {
		document.dispatchEvent(new CustomEvent("timer:closed"));
	} catch (e) {}
}
export function toggleTimerModal() {
	if (_backdrop) {
		closeTimerModal();
	} else {
		openTimerModal();
	}
}
function switchMode(mode, modal) {
	_state.mode = mode;
	const t1 = modal.querySelector("#tab-timer");
	const t2 = modal.querySelector("#tab-stopwatch");
	if (t1 && t2) {
		t1.classList.toggle("active", mode === "timer");
		t2.classList.toggle("active", mode === "stopwatch");
	}
	const presets = modal.querySelector("#timer-presets");
	const laps = modal.querySelector("#stopwatch-laps");
	const timerControls = modal.querySelector("#timer-controls");
	const stopwatchControls = modal.querySelector("#stopwatch-controls");
	const custom = modal.querySelector("#custom-time-row");
	const editBtn = modal.querySelector("#tm-edit");
	if (presets) presets.style.display = mode === "timer" ? "" : "none";
	if (laps) laps.style.display = mode === "stopwatch" ? "" : "none";
	if (timerControls)
		timerControls.style.display = mode === "timer" ? "" : "none";
	if (stopwatchControls)
		stopwatchControls.style.display = mode === "stopwatch" ? "" : "none";
	if (custom) custom.style.display = mode === "timer" ? "" : "none";
	try {
		if (editBtn) editBtn.style.display = mode === "timer" ? "" : "none";
	} catch (e) {}
	if (mode === "stopwatch" && _state.editing) {
		_state.editing = false;
		try {
			const disp = modal.querySelector("#timer-display");
			if (disp) {
				disp.contentEditable = "false";
				disp.classList.remove("editing");
			}
		} catch (e) {}
		try {
			const sp = modal.querySelector("#tm-start-pause");
			if (sp) {
				updateAttachedIcon(
					sp,
					"assets/svgs-fontawesome/solid/circle-play.svg",
				);
				sp.disabled = !(_state.timerRemaining > 0);
			}
		} catch (e) {}
		try {
			if (editBtn)
				updateAttachedIcon(
					editBtn,
					"assets/svgs-fontawesome/solid/pen-to-square.svg",
				);
		} catch (e) {}
	}
	updateDisplay();
}
function updateDisplay() {
	const disp = document.getElementById("timer-display");
	if (!disp) return;
	if (_state.mode === "timer") {
		if (!_state.editing)
			disp.textContent = formatTimeMs(_state.timerRemaining, false);
		try {
			const sp = document.getElementById("tm-start-pause");
			if (sp)
				sp.disabled = _state.editing || !(_state.timerRemaining > 0);
		} catch (e) {}
	} else {
		disp.textContent = formatTimeMs(_state.stopwatchTime, true);
	}
}
function startTimer() {
	if (_state.timerRunning) return;
	if (!(_state.timerRemaining > 0)) return;
	_state.timerRunning = true;
	const start = Date.now();
	const endBase = Date.now() + _state.timerRemaining;
	_state.timerInterval = setInterval(() => {
		_state.timerRemaining = Math.max(0, endBase - Date.now());
		updateDisplay();
		if (_state.timerRemaining <= 0) {
			clearInterval(_state.timerInterval);
			_state.timerInterval = null;
			_state.timerRunning = false;
			try {
				if (_state.audio && _state.alertEnabled) _state.audio.play();
			} catch (e) {}
			try {
				updateIconById(
					"tm-start-pause",
					"assets/svgs-fontawesome/solid/circle-play.svg",
				);
			} catch (e) {}
		}
	}, 200);
}
function pauseTimer() {
	if (!_state.timerRunning) return;
	_state.timerRunning = false;
	clearInterval(_state.timerInterval);
	_state.timerInterval = null;
	try {
		updateIconById(
			"tm-start-pause",
			"assets/svgs-fontawesome/solid/circle-play.svg",
		);
	} catch (e) {}
}
function resetTimer() {
	_state.timerRunning = false;
	clearInterval(_state.timerInterval);
	_state.timerInterval = null;
	_state.timerRemaining = 0;
	try {
		if (_state.audio) {
			_state.audio.pause();
			_state.audio.currentTime = 0;
		}
	} catch (e) {}
	updateDisplay();
	try {
		const el = document.getElementById("tm-start-pause");
		if (el) {
			updateAttachedIcon(
				el,
				"assets/svgs-fontawesome/solid/circle-play.svg",
			);
			el.disabled = true;
		}
	} catch (e) {}
}
function toggleStopwatch(ev) {
	const btn = ev.currentTarget;
	if (_state.stopwatchRunning) {
		_state.stopwatchRunning = false;
		clearInterval(_state.stopwatchInterval);
		_state.stopwatchInterval = null;
		try {
			if (btn)
				updateAttachedIcon(
					btn,
					"assets/svgs-fontawesome/solid/circle-play.svg",
				);
		} catch (e) {}
	} else {
		_state.stopwatchRunning = true;
		const last = Date.now();
		const startTime = Date.now() - _state.stopwatchTime;
		_state.stopwatchInterval = setInterval(() => {
			_state.stopwatchTime = Date.now() - startTime;
			updateDisplay();
		}, 50);
		try {
			if (btn)
				updateAttachedIcon(
					btn,
					"assets/svgs-fontawesome/solid/circle-pause.svg",
				);
		} catch (e) {}
	}
}
function recordLap() {
	if (!_state.stopwatchRunning) return;
	const val = _state.stopwatchTime;
	_state.stopwatchLaps.push(val);
	_state.stopwatchLaps = _state.stopwatchLaps.slice(-3);
	try {
		localStorage.setItem(
			"timer_last_laps",
			JSON.stringify(_state.stopwatchLaps),
		);
	} catch (e) {}
	renderLaps();
}
function resetStopwatch() {
	_state.stopwatchRunning = false;
	clearInterval(_state.stopwatchInterval);
	_state.stopwatchInterval = null;
	_state.stopwatchTime = 0;
	_state.stopwatchLaps = [];
	try {
		localStorage.removeItem("timer_last_laps");
	} catch (e) {}
	renderLaps();
	updateDisplay();
	try {
		updateIconById(
			"sw-start",
			"assets/svgs-fontawesome/solid/circle-play.svg",
		);
	} catch (e) {}
}
function renderLaps() {
	const cont = document.getElementById("stopwatch-laps");
	if (!cont) return;
	cont.innerHTML = "";
	if (!_state.stopwatchLaps || _state.stopwatchLaps.length === 0) {
		const none = document.createElement("div");
		none.className = "lap-list-empty";
		none.textContent = "No laps yet";
		cont.appendChild(none);
		return;
	}
	_state.stopwatchLaps
		.slice()
		.reverse()
		.forEach((ms, idx) => {
			const item = document.createElement("div");
			item.className = "btn btn-text btn-display lap-item";
			const label = document.createElement("div");
			label.textContent = `Lap ${_state.stopwatchLaps.length - idx}`;
			const time = document.createElement("div");
			time.textContent = formatTimeMs(ms, true);
			item.appendChild(label);
			item.appendChild(time);
			cont.appendChild(item);
		});
}
export function showTimerModal() {
	openTimerModal();
}
export function closeTimerModalIfOpen() {
	closeTimerModal();
}
