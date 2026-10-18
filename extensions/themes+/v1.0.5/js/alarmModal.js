import { loadCSS, unloadCSS } from "./cssLoader.js";
import { renderInlineIcon } from "./brandIconLoader.js";

const CSS_ID = "alarm-modal-css";
const CSS_PATH = "css/alarmModal.css";
const AUDIO_SRC = "assets/audio/mixkit-positive-interface-beep-221.wav";
const STORAGE_KEY = "alarms_list_v1";
const PERMISSION_FLAG = "alarms_permission_requested";
const MAX_ALARMS = 3;

function createIconSpan(iconPath, className = "") {
	const icon = document.createElement("span");
	icon.className = className;
	icon.setAttribute("aria-hidden", "true");
	renderInlineIcon(icon, iconPath);
	return icon;
}

function attachIcon(target, iconPath) {
	const icon = createIconSpan(iconPath);
	target.appendChild(icon);
	return icon;
}

// Logic Helper: Get next timestamp for a specific day of week (0=Sun) at HH:MM
function getNextDayTimestamp(dayIndex, h, m) {
	const now = new Date();
	let d = new Date();
	d.setHours(h, m, 0, 0);
	// If today is the day and time hasn't passed, use today.
	// Otherwise move to next occurrence of that day.
	if (d.getDay() === dayIndex && d > now) {
		return d.getTime();
	}
	d.setDate(d.getDate() + 1);
	while (d.getDay() !== dayIndex) {
		d.setDate(d.getDate() + 1);
	}
	return d.getTime();
}

// Logic Helper: Get timestamp for specific date YYYY-MM-DD at HH:MM
function getSpecificDateTimestamp(dateStr, h, m) {
	if (!dateStr) return null;
	const [year, month, day] = dateStr.split("-").map(Number);
	const d = new Date(year, month - 1, day, h, m, 0, 0);
	return d.getTime();
}

let _backdrop = null;
let _popupElement = null;
let _currentFiringAlarm = null;
let _state = {
	alarms: [],
	scheduled: {},
	audio: null,
	permissionAsked: false,
};

function checkPendingAlarm() {
	try {
		chrome.storage.local.get(
			["alarm_firing", "alarm_id", "alarm_label"],
			(result) => {
				if (result.alarm_firing) {
					// Load state to find the alarm
					loadState();

					// Find alarm by ID or create a temporary one with the label
					let alarm = null;
					if (result.alarm_id) {
						const baseId = result.alarm_id.split("_day_")[0];
						alarm = _state.alarms.find((a) => a.id === baseId);
					}

					// If no matching alarm found, create a temp object for display
					if (!alarm) {
						const now = new Date();
						alarm = {
							id: result.alarm_id || "unknown",
							label: result.alarm_label || "Alarm",
							hour: now.getHours(),
							minute: now.getMinutes(),
							type: "once",
						};
					}

					// Trigger the alarm (shows popup and plays audio)
					triggerAlarm(alarm, null);
				}
			},
		);
	} catch (e) {}
}

checkPendingAlarm();

try {
	if (
		navigator &&
		navigator.serviceWorker &&
		navigator.serviceWorker.addEventListener
	) {
		navigator.serviceWorker.addEventListener("message", (ev) => {
			try {
				const d = ev.data || {};
				if (d && d.action === "alarm:fired") {
					try {
						// Ensure state is loaded to find the alarm label
						loadState();
						if (_state.audio) {
							_state.audio.currentTime = 0;
							_state.audio.play().catch(() => {});
						}
						// Find alarm to show notification
						if (d.id) {
							// Strip _day_ suffix if present
							const baseId = d.id.split("_day_")[0];
							let alarm = _state.alarms.find(
								(a) => a.id === baseId,
							);
							// If not found (e.g. snooze), create temp
							if (!alarm) {
								const now = new Date();
								alarm = {
									id: d.id,
									label: d.label || "Alarm",
									hour: now.getHours(),
									minute: now.getMinutes(),
									type: "once",
								};
							}
							if (alarm) {
								triggerAlarm(alarm, null);
							}
						}
					} catch (e) {}
				} else if (d && d.action === "alarm:stop") {
					try {
						if (_state.audio) {
							_state.audio.pause();
							_state.audio.currentTime = 0;
						}
					} catch (e) {}
				}
			} catch (e) {}
		});
	}
} catch (e) {}

function hasChromeAlarmsPermission() {
	return new Promise((resolve) => {
		try {
			if (!chrome || !chrome.permissions || !chrome.permissions.contains)
				return resolve(false);
			chrome.permissions.contains({ permissions: ["alarms"] }, (res) =>
				resolve(!!res),
			);
		} catch (e) {
			resolve(false);
		}
	});
}

function clearChromeAlarm(id) {
	try {
		if (chrome && chrome.alarms && chrome.alarms.clear)
			chrome.alarms.clear(id, () => {});
	} catch (e) {}
}

function loadState() {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (raw) _state.alarms = JSON.parse(raw) || [];
	} catch (e) {
		_state.alarms = [];
	}
	// Migration: Convert legacy frequency to new structure
	if (_state.alarms.some((a) => a.frequency)) {
		_state.alarms = _state.alarms.map((a) => {
			if (!a.frequency) return a;
			const newA = { ...a };
			if (a.frequency === "daily") {
				newA.type = "repeating";
				newA.days = [0, 1, 2, 3, 4, 5, 6];
			} else if (a.frequency === "weekdays") {
				newA.type = "repeating";
				newA.days = [1, 2, 3, 4, 5];
			} else {
				// 'once' -> type: 'once'
				newA.type = "once";
			}
			delete newA.frequency;
			return newA;
		});
		saveState();
	}

	try {
		_state.permissionAsked = !!localStorage.getItem(PERMISSION_FLAG);
	} catch (e) {
		_state.permissionAsked = false;
	}
}

function saveState() {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(_state.alarms || []));
		document.dispatchEvent(new CustomEvent("alarms-updated"));
	} catch (e) {}
}

function uid(prefix = "a") {
	return `${prefix}_${Date.now().toString(36)}_${Math.floor(
		Math.random() * 1000,
	)}`;
}

function formatTime(h, m) {
	const hh = String(h).padStart(2, "0");
	const mm = String(m).padStart(2, "0");
	return `${hh}:${mm}`;
}

function parseTimeValue(val) {
	if (!val) return null;
	const parts = val.split(":");
	if (parts.length < 2) return null;
	const h = parseInt(parts[0], 10) || 0;
	const m = parseInt(parts[1], 10) || 0;
	return { h, m };
}

function scheduleAlarm(alarm, modal) {
	clearScheduled(alarm.id); // Clear legacy timeouts
	// Also clear all potential sub-alarms from chrome
	// We don't know the exact IDs easily without checking type, so we try to clear base ID and potential days
	clearChromeAlarm(alarm.id);
	for (let i = 0; i < 7; i++) clearChromeAlarm(`${alarm.id}_day_${i}`);

	if (!alarm.on) return;

	hasChromeAlarmsPermission().then((has) => {
		if (has) {
			if (alarm.type === "repeating" && alarm.days && alarm.days.length) {
				alarm.days.forEach((d) => {
					const when = getNextDayTimestamp(
						d,
						alarm.hour,
						alarm.minute,
					);
					// 10080 minutes = 1 week
					if (chrome && chrome.alarms && chrome.alarms.create) {
						chrome.alarms.create(`${alarm.id}_day_${d}`, {
							when,
							periodInMinutes: 10080,
						});
					}
				});
			} else if (alarm.type === "sdate" && alarm.date) {
				const when = getSpecificDateTimestamp(
					alarm.date,
					alarm.hour,
					alarm.minute,
				);
				if (when && when > Date.now()) {
					if (chrome && chrome.alarms && chrome.alarms.create) {
						chrome.alarms.create(alarm.id, { when });
					}
				}
			} else if (alarm.type === "once") {
				const now = new Date();
				let target = new Date();
				target.setHours(alarm.hour, alarm.minute, 0, 0);
				if (target <= now) target.setDate(target.getDate() + 1);
				const when = target.getTime();
				if (chrome && chrome.alarms && chrome.alarms.create) {
					chrome.alarms.create(alarm.id, { when });
				}
			}
			return;
		}

		// Fallback for no permissions (kept simple, mostly just for open tab)
		// We only schedule the VERY NEXT occurrence
		let nextTime = null;
		if (alarm.type === "repeating" && alarm.days && alarm.days.length) {
			let minDiff = Infinity;
			alarm.days.forEach((d) => {
				const ts = getNextDayTimestamp(d, alarm.hour, alarm.minute);
				if (ts < minDiff) minDiff = ts;
			});
			if (minDiff !== Infinity) nextTime = minDiff;
		} else if (alarm.type === "sdate" && alarm.date) {
			const ts = getSpecificDateTimestamp(
				alarm.date,
				alarm.hour,
				alarm.minute,
			);
			if (ts && ts > Date.now()) nextTime = ts;
		} else if (alarm.type === "once") {
			const now = new Date();
			let target = new Date();
			target.setHours(alarm.hour, alarm.minute, 0, 0);
			if (target <= now) target.setDate(target.getDate() + 1);
			nextTime = target.getTime();
		}

		if (nextTime) {
			const delay = Math.max(0, nextTime - Date.now());
			// Cap delay to typical setTimeout limits (24 days) just in case
			if (delay < 2147483647) {
				const tid = setTimeout(() => {
					triggerAlarm(alarm, modal);
					// Reschedule if repeating
					if (alarm.type === "repeating") {
						scheduleAlarm(alarm, modal);
					} else {
						alarm.on = false;
						saveState();
						renderAlarms(modal);
					}
				}, delay);
				_state.scheduled[alarm.id] = tid;
			}
		}
	});
}

function clearScheduled(id) {
	try {
		const t = _state.scheduled[id];
		if (t) clearTimeout(t);
		delete _state.scheduled[id];
	} catch (e) {}
}

function triggerAlarm(alarm, modal) {
	// Initialize audio if not already
	if (!_state.audio) {
		_state.audio = new Audio(AUDIO_SRC);
		_state.audio.loop = false;
		_state.audio.addEventListener("ended", () => {
			if (_state.audio && _currentFiringAlarm) {
				_state.audio.currentTime = 0;
				_state.audio.play().catch(() => {});
			}
		});
	}

	try {
		_state.audio.currentTime = 0;
		_state.audio.play().catch(() => {});
	} catch (e) {}

	// Show popup
	showAlarmPopup(alarm);
}

async function showAlarmPopup(alarm) {
	// Load CSS if not already loaded
	await loadCSS(CSS_PATH, CSS_ID);

	// Remove existing popup if any
	if (_popupElement) {
		try {
			_popupElement.remove();
		} catch (e) {}
	}

	_currentFiringAlarm = alarm;

	const popup = document.createElement("div");
	popup.className = "alarm-popup";
	popup.id = "alarm-popup";

	// Header with icon and info
	const header = document.createElement("div");
	header.className = "alarm-popup-header";

	const icon = document.createElement("span");
	icon.className = "alarm-popup-icon";
	renderInlineIcon(icon, "assets/svgs-fontawesome/solid/bell.svg");

	const info = document.createElement("div");
	info.className = "alarm-popup-info";

	const label = document.createElement("div");
	label.className = "alarm-popup-label";
	label.textContent = alarm.label || "Alarm";

	const time = document.createElement("div");
	time.className = "alarm-popup-time";
	time.textContent = formatTime(alarm.hour, alarm.minute);

	info.appendChild(label);
	info.appendChild(time);
	header.appendChild(icon);
	header.appendChild(info);
	popup.appendChild(header);

	// Actions
	const actions = document.createElement("div");
	actions.className = "alarm-popup-actions";

	const stopBtn = document.createElement("button");
	stopBtn.className = "btn btn-icon-text";
	attachIcon(stopBtn, "assets/svgs-fontawesome/solid/stop.svg");
	const stopText = document.createElement("span");
	stopText.className = "text";
	stopText.textContent = "Stop";
	stopBtn.appendChild(stopText);
	stopBtn.addEventListener("click", () => stopAlarm(alarm));

	const snoozeBtn = document.createElement("button");
	snoozeBtn.className = "btn btn-icon-text";
	attachIcon(
		snoozeBtn,
		"assets/svgs-fontawesome/solid/clock-rotate-left.svg",
	);
	const snoozeText = document.createElement("span");
	snoozeText.className = "text";
	snoozeText.textContent = "Snooze";
	snoozeBtn.appendChild(snoozeText);
	snoozeBtn.addEventListener("click", () => snoozeAlarm(alarm));

	actions.appendChild(stopBtn);
	actions.appendChild(snoozeBtn);
	popup.appendChild(actions);

	document.body.appendChild(popup);
	_popupElement = popup;
}

function closeAlarmPopup() {
	if (_popupElement) {
		try {
			_popupElement.remove();
		} catch (e) {}
		_popupElement = null;
	}
	_currentFiringAlarm = null;

	// Stop audio
	if (_state.audio) {
		try {
			_state.audio.pause();
			_state.audio.currentTime = 0;
		} catch (e) {}
	}
}

function stopAlarm(alarm) {
	closeAlarmPopup();

	// Reload state to ensure we have latest
	loadState();

	// Reschedule if repeating alarm, otherwise disable
	if (alarm && alarm.type === "repeating") {
		// For repeating, just reschedule next occurrence
		scheduleAlarm(alarm, null);
	} else if (alarm && (alarm.type === "once" || alarm.type === "sdate")) {
		// For "once" or "sdate" alarms, find and disable them in the state
		const alarmIndex = _state.alarms.findIndex((a) => a.id === alarm.id);
		if (alarmIndex !== -1) {
			_state.alarms[alarmIndex].on = false;
			saveState();
		}
	}

	// Clear storage flag
	try {
		chrome.storage.local.set({
			alarm_firing: false,
			alarm_id: null,
			alarm_label: null,
		});
	} catch (e) {}

	// Dispatch event so action bar updates
	document.dispatchEvent(new CustomEvent("alarms-updated"));
}

function snoozeAlarm(alarm) {
	closeAlarmPopup();

	// Reload state to ensure we have latest
	loadState();

	// For "once" or "sdate" alarms, disable the original alarm since we're snoozing
	if (alarm && (alarm.type === "once" || alarm.type === "sdate")) {
		const alarmIndex = _state.alarms.findIndex((a) => a.id === alarm.id);
		if (alarmIndex !== -1) {
			_state.alarms[alarmIndex].on = false;
			saveState();
		}
	}

	// Create a snooze alarm for 5 minutes from now
	const snoozeId = `snooze_${Date.now()}`;
	const snoozeWhen = Date.now() + 5 * 60 * 1000; // 5 minutes

	// Create chrome alarm for snooze
	hasChromeAlarmsPermission().then((has) => {
		if (has && chrome.alarms && chrome.alarms.create) {
			chrome.alarms.create(snoozeId, { when: snoozeWhen });

			// Store snooze alarm info so we can find the label when it fires
			try {
				chrome.storage.local.get("snooze_alarms", (result) => {
					const snoozes = result.snooze_alarms || {};
					snoozes[snoozeId] = {
						label: alarm.label || "Alarm",
						hour: new Date(snoozeWhen).getHours(),
						minute: new Date(snoozeWhen).getMinutes(),
						originalId: alarm.id,
						originalType: alarm.type,
					};
					chrome.storage.local.set({ snooze_alarms: snoozes });
				});
			} catch (e) {}
		} else {
			// Fallback: use setTimeout
			setTimeout(() => {
				triggerAlarm(alarm, null);
			}, 5 * 60 * 1000);
		}
	});

	// Clear storage flag
	try {
		chrome.storage.local.set({
			alarm_firing: false,
			alarm_id: null,
			alarm_label: null,
		});
	} catch (e) {}

	// Dispatch event so action bar updates
	document.dispatchEvent(new CustomEvent("alarms-updated"));
}

function renderAlarms(modal) {
	const list = modal.querySelector("#alarms-list");
	if (!list) return;
	list.innerHTML = "";
	if (!_state.alarms || _state.alarms.length === 0) {
		const none = document.createElement("div");
		none.className = "alarm-empty";
		none.textContent = "No alarms yet";
		list.appendChild(none);
		return;
	}
	_state.alarms.forEach((al) => {
		const item = document.createElement("div");
		item.className = "alarm-item";
		item.dataset.id = al.id;
		const left = document.createElement("div");
		left.className = "alarm-left";
		const label = document.createElement("div");
		label.className = "alarm-label";
		label.textContent = al.label || "Alarm";
		const time = document.createElement("div");
		time.className = "alarm-time";
		time.textContent = formatTime(al.hour, al.minute);
		const freq = document.createElement("div");
		freq.className = "alarm-freq";
		if (al.type === "repeating" && al.days) {
			const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
			if (al.days.length === 7) freq.textContent = "Every day";
			else if (
				al.days.length === 5 &&
				!al.days.includes(0) &&
				!al.days.includes(6)
			)
				freq.textContent = "Weekdays";
			else if (
				al.days.length === 2 &&
				al.days.includes(0) &&
				al.days.includes(6)
			)
				freq.textContent = "Weekends";
			else if (al.days.length === 0) freq.textContent = "Never";
			else freq.textContent = al.days.map((d) => days[d]).join(", ");
		} else if (al.type === "sdate" && al.date) {
			// Format date nicely if possible? YYYY-MM-DD for now is fine or simple parsing
			freq.textContent = al.date;
		} else {
			freq.textContent = "Once";
		}
		left.appendChild(label);
		left.appendChild(time);
		left.appendChild(freq);
		const right = document.createElement("div");
		right.className = "alarm-right";
		const toggle = document.createElement("button");
		toggle.className = "btn btn-icon alarm-toggle";
		toggle.title = al.on ? "Disable" : "Enable";
		toggle.setAttribute("aria-pressed", al.on ? "true" : "false");
		const checkIcon = "assets/svgs-fontawesome/solid/square-check.svg";
		const uncheckIcon = "assets/svgs-fontawesome/solid/square.svg";
		renderInlineIcon(
			toggle.appendChild(createIconSpan(al.on ? checkIcon : uncheckIcon)),
			al.on ? checkIcon : uncheckIcon,
		);
		toggle.addEventListener("click", (ev) => {
			ev.stopPropagation(); // Good practice
			al.on = !al.on;
			saveState();
			renderAlarms(modal);
			if (al.on) scheduleAlarm(al, modal);
			else {
				clearScheduled(al.id);
				clearChromeAlarm(al.id);
			}
		});
		const edit = document.createElement("button");
		edit.className = "btn btn-icon alarm-edit";
		edit.title = "Edit";
		attachIcon(edit, "assets/svgs-fontawesome/solid/pen-to-square.svg");
		edit.addEventListener("click", () => openEditForm(modal, al));
		const del = document.createElement("button");
		del.className = "btn btn-icon alarm-del";
		del.title = "Delete";
		attachIcon(del, "assets/svgs-fontawesome/solid/circle-xmark.svg");
		del.addEventListener("click", () => {
			_state.alarms = _state.alarms.filter((x) => x.id !== al.id);
			clearScheduled(al.id);
			clearChromeAlarm(al.id);
			saveState();
			renderAlarms(modal);
		});
		right.appendChild(toggle);
		right.appendChild(edit);
		right.appendChild(del);
		item.appendChild(left);
		item.appendChild(right);
		list.appendChild(item);
	});
	try {
		const addBtn = modal.querySelector("#alarm-add");
		if (addBtn) addBtn.disabled = _state.alarms.length >= MAX_ALARMS;
	} catch (e) {}
}

function openEditForm(modal, alarm) {
	const existing = modal.querySelector(".alarm-form");
	if (existing) existing.remove();
	const form = document.createElement("div");
	form.className = "alarm-form";
	const label = document.createElement("input");
	label.type = "text";
	label.className = "input";
	label.placeholder = "Label";
	label.value = alarm ? alarm.label || "" : "";
	const time = document.createElement("input");
	time.type = "time";
	time.className = "input";
	time.value = alarm ? formatTime(alarm.hour, alarm.minute) : "07:00";
	// Type Toggle
	const typeGroup = document.createElement("div");
	typeGroup.className = "alarm-type-group";
	const typeOnce = document.createElement("button");
	typeOnce.className = "btn btn-text alarm-type-btn";
	typeOnce.textContent = "Once";
	const typeRepeat = document.createElement("button");
	typeRepeat.className = "btn btn-text alarm-type-btn";
	typeRepeat.textContent = "Repeat";
	const typeDate = document.createElement("button");
	typeDate.className = "btn btn-text alarm-type-btn";
	typeDate.textContent = "Date";
	typeGroup.appendChild(typeOnce);
	typeGroup.appendChild(typeRepeat);
	typeGroup.appendChild(typeDate);

	// Container for Repeat (Day Picker)
	const repeatContainer = document.createElement("div");
	repeatContainer.className = "day-picker";
	// S M T W T F S
	const dayLabels = ["S", "M", "T", "W", "T", "F", "S"];
	let currentDays =
		alarm && alarm.type === "repeating" && alarm.days
			? [...alarm.days]
			: [1, 2, 3, 4, 5]; // Default Mon-Fri
	// If switching from sdate or new, default to M-F
	if (alarm && alarm.type === "sdate") currentDays = [1, 2, 3, 4, 5];

	const dayBtns = dayLabels.map((l, idx) => {
		const b = document.createElement("button");
		b.className = "day-btn" + (currentDays.includes(idx) ? " active" : "");
		b.textContent = l;
		b.addEventListener("click", () => {
			if (currentDays.includes(idx)) {
				currentDays = currentDays.filter((d) => d !== idx);
				b.classList.remove("active");
			} else {
				currentDays.push(idx);
				currentDays.sort();
				b.classList.add("active");
			}
		});
		repeatContainer.appendChild(b);
		return b;
	});

	// Container for Specific Date
	const dateContainer = document.createElement("div");
	dateContainer.className = "date-input-wrapper";
	dateContainer.style.display = "none";
	const dateInput = document.createElement("input");
	dateInput.type = "date";
	dateInput.className = "input";
	// Default date: Today or alarm date
	const today = new Date().toISOString().split("T")[0];
	dateInput.min = today; // Prevent selecting past dates
	dateInput.value =
		alarm && alarm.type === "sdate" && alarm.date ? alarm.date : today;
	dateContainer.appendChild(dateInput);

	// Toggle Logic
	let currentType = alarm && alarm.type ? alarm.type : "once";
	const updateView = () => {
		typeOnce.classList.remove("active");
		typeRepeat.classList.remove("active");
		typeDate.classList.remove("active");
		repeatContainer.style.display = "none";
		dateContainer.style.display = "none";

		if (currentType === "repeating") {
			typeRepeat.classList.add("active");
			repeatContainer.style.display = "flex";
		} else if (currentType === "sdate") {
			typeDate.classList.add("active");
			dateContainer.style.display = "flex";
		} else {
			typeOnce.classList.add("active");
		}
	};
	updateView();

	typeOnce.addEventListener("click", () => {
		currentType = "once";
		updateView();
	});
	typeRepeat.addEventListener("click", () => {
		currentType = "repeating";
		updateView();
	});
	typeDate.addEventListener("click", () => {
		currentType = "sdate";
		updateView();
	});

	const row = document.createElement("div");
	row.className = "alarm-form-row";
	const save = document.createElement("button");
	save.className = "btn btn-icon-text";
	save.title = "Save";
	attachIcon(save, "assets/svgs-fontawesome/solid/floppy-disk.svg");
	const saveSpan = document.createElement("span");
	saveSpan.className = "text";
	saveSpan.textContent = "Save";
	save.appendChild(saveSpan);
	const cancel = document.createElement("button");
	cancel.className = "btn btn-icon-text";
	cancel.title = "Cancel";
	attachIcon(cancel, "assets/svgs-fontawesome/solid/circle-xmark.svg");
	const cancelSpan = document.createElement("span");
	cancelSpan.className = "text";
	cancelSpan.textContent = "Cancel";
	cancel.appendChild(cancelSpan);
	row.appendChild(save);
	row.appendChild(cancel);

	form.appendChild(label);
	form.appendChild(time);
	// Add new controls
	form.appendChild(typeGroup);
	form.appendChild(repeatContainer);
	form.appendChild(dateContainer);

	form.appendChild(row);
	modal.querySelector(".alarm-body").appendChild(form);
	cancel.addEventListener("click", () => {
		form.remove();
	});
	save.addEventListener("click", () => {
		const tv = parseTimeValue(time.value);
		if (!tv) {
			alert("Please choose a valid time");
			return;
		}
		// Validate
		if (currentType === "repeating" && currentDays.length === 0) {
			alert("Please select at least one day");
			return;
		}
		if (currentType === "sdate" && !dateInput.value) {
			alert("Please select a date");
			return;
		}
		// Validate that sdate is in the future
		if (currentType === "sdate" && dateInput.value) {
			const selectedTimestamp = getSpecificDateTimestamp(
				dateInput.value,
				tv.h,
				tv.m,
			);
			if (!selectedTimestamp || selectedTimestamp <= Date.now()) {
				alert("Please select a future date and time");
				return;
			}
		}

		const alData = {
			label: label.value,
			hour: tv.h,
			minute: tv.m,
			type: currentType,
			days: currentType === "repeating" ? currentDays : [],
			date: currentType === "sdate" ? dateInput.value : null,
			on: true,
		};

		if (alarm) {
			alarm.label = alData.label;
			alarm.hour = alData.hour;
			alarm.minute = alData.minute;
			alarm.type = alData.type;
			alarm.days = alData.days;
			alarm.date = alData.date;
			alarm.on = true; // reactivate on edit? usually yes
			saveState();
			renderAlarms(modal);
			scheduleAlarm(alarm, modal);
		} else {
			const newA = {
				id: uid("al"),
				...alData,
			};
			_state.alarms.push(newA);
			saveState();
			renderAlarms(modal);
			scheduleAlarm(newA, modal);
		}
		form.remove();
	});
}

async function openAlarmModal() {
	if (_backdrop) {
		try {
			_backdrop.querySelector(".alarm-modal").focus();
		} catch (e) {}
		return;
	}
	loadState();
	await loadCSS(CSS_PATH, CSS_ID);
	_backdrop = document.createElement("div");
	_backdrop.className = "alarm-modal-backdrop";
	const modal = document.createElement("div");
	modal.id = "alarm-modal";
	modal.className = "alarm-modal";
	modal.tabIndex = -1;
	modal.setAttribute("role", "dialog");
	const header = document.createElement("div");
	header.className = "modal-header";
	const headerTitle = document.createElement("div");
	headerTitle.className = "btn btn-icon-text btn-display modal-title";
	headerTitle.innerHTML = `<span></span><span class="text">Alarms</span>`;
	renderInlineIcon(
		headerTitle.querySelector("span:first-child"),
		"assets/svgs-fontawesome/solid/bell.svg",
	);
	header.appendChild(headerTitle);

	const actionsGroup = document.createElement("div");
	actionsGroup.style.display = "flex";
	actionsGroup.style.gap = "var(--dis-1)";

	const closeBtn = document.createElement("button");
	closeBtn.className = "btn btn-icon";
	closeBtn.title = "Close";
	renderInlineIcon(
		closeBtn.appendChild(
			createIconSpan("assets/svgs-fontawesome/solid/xmark.svg"),
		),
		"assets/svgs-fontawesome/solid/xmark.svg",
	);
	closeBtn.addEventListener("click", () => closeAlarmModal());
	actionsGroup.appendChild(closeBtn);
	header.appendChild(actionsGroup);

	modal.appendChild(header);
	const permArea = document.createElement("div");
	permArea.className = "alarm-permission";
	const permText = document.createElement("div");
	permText.className = "perm-text";
	if (
		window.Notification &&
		Notification.permission !== "granted" &&
		!_state.permissionAsked
	) {
		permText.textContent =
			"Enable notifications to allow alarms to show notifications (optional).";
		const permBtn = document.createElement("button");
		permBtn.className = "btn btn-icon-text";
		permBtn.title = "Enable Notifications";
		attachIcon(permBtn, "assets/svgs-fontawesome/solid/bell.svg");
		const permSpan = document.createElement("span");
		permSpan.className = "text";
		permSpan.textContent = "Enable Notifications";
		permBtn.appendChild(permSpan);
		permBtn.addEventListener("click", async () => {
			try {
				const res = await Notification.requestPermission();
				localStorage.setItem(PERMISSION_FLAG, "1");
				_state.permissionAsked = true;
				permArea.remove();
			} catch (e) {
				localStorage.setItem(PERMISSION_FLAG, "1");
				_state.permissionAsked = true;
				permArea.remove();
			}
		});
		permArea.appendChild(permText);
		permArea.appendChild(permBtn);
		modal.appendChild(permArea);
	}

	try {
		if (chrome && chrome.permissions && chrome.permissions.contains) {
			chrome.permissions.contains({ permissions: ["alarms"] }, (has) => {
				if (!has) {
					const btn = document.createElement("button");
					btn.className = "btn btn-icon-text";
					btn.title = "Enable Background Alarms";
					attachIcon(btn, "assets/svgs-fontawesome/solid/bell.svg");
					const btnSpan = document.createElement("span");
					btnSpan.className = "text";
					btnSpan.textContent = "Enable Background Alarms";
					btn.appendChild(btnSpan);
					btn.addEventListener("click", () => {
						try {
							chrome.permissions.request(
								{ permissions: ["alarms", "notifications"] },
								(granted) => {
									if (granted) {
										_state.alarms.forEach((a) => {
											if (a.on) scheduleAlarm(a, modal);
										});
										try {
											btn.remove();
										} catch (e) {}
									} else {
										try {
											alert(
												"Background alarm permission not granted. Alarms will run while this page is open.",
											);
										} catch (e) {}
									}
								},
							);
						} catch (e) {}
					});
					modal._requestAlarmsBtn = btn;
				}
			});
		}
	} catch (e) {}

	const body = document.createElement("div");
	body.className = "alarm-body";
	const list = document.createElement("div");
	list.id = "alarms-list";
	list.className = "alarms-list";
	body.appendChild(list);
	const controls = document.createElement("div");
	controls.className = "alarm-controls";
	const add = document.createElement("button");
	add.id = "alarm-add";
	add.className = "btn btn-icon-text";
	add.title = "Add Alarm";
	attachIcon(add, "assets/svgs-fontawesome/solid/plus.svg");
	const addSpan = document.createElement("span");
	addSpan.className = "text";
	addSpan.textContent = "Add";
	add.appendChild(addSpan);
	add.addEventListener("click", () => openEditForm(modal, null));
	const test = document.createElement("button");
	test.className = "btn btn-icon-text";
	test.title = "Test Alarm";
	attachIcon(test, "assets/svgs-fontawesome/solid/bell.svg");
	const testSpan = document.createElement("span");
	testSpan.className = "text";
	testSpan.textContent = "Test";
	test.appendChild(testSpan);
	test.addEventListener("click", () => {
		if (_state.audio) {
			_state.audio.currentTime = 0;
			_state.audio.loop = true;
			_state.audio.play();
			setTimeout(() => {
				_state.audio.pause();
				_state.audio.loop = false;
			}, 5000);
		}
		try {
			if (window.Notification && Notification.permission === "granted")
				new Notification("Test Alarm", {
					body: "This is a test alarm",
					icon: chrome.runtime.getURL("icons/icon128.png"),
				});
		} catch (e) {}
	});
	controls.appendChild(add);
	controls.appendChild(test);
	body.appendChild(controls);
	try {
		if (modal._requestAlarmsBtn)
			controls.appendChild(modal._requestAlarmsBtn);
	} catch (e) {}
	modal.appendChild(body);
	_backdrop.appendChild(modal);
	document.body.appendChild(_backdrop);

	if (!_state.audio) {
		_state.audio = new Audio(AUDIO_SRC);
	}
	_state.audio.loop = false;
	_state.audio.addEventListener("ended", () => {
		if (_state.audio) {
			_state.audio.currentTime = 0;
			_state.audio.play().catch(() => {});
		}
	});
	renderAlarms(modal);
	_state.alarms.forEach((a) => {
		if (a.on) scheduleAlarm(a, modal);
	});

	_backdrop.addEventListener("keydown", (ev) => {
		if (ev.key === "Escape") closeAlarmModal();
	});
}

function closeAlarmModal() {
	if (!_backdrop) return;
	Object.keys(_state.scheduled).forEach((k) => clearScheduled(k));
	try {
		document.body.removeChild(_backdrop);
	} catch (e) {}
	_backdrop = null;
	try {
		unloadCSS(CSS_ID);
	} catch (e) {}
	try {
		document.dispatchEvent(new CustomEvent("alarm:closed"));
	} catch (e) {}
}

export function toggleAlarmModal() {
	if (_backdrop) closeAlarmModal();
	else openAlarmModal();
}
export function showAlarmModal() {
	openAlarmModal();
}
export function closeAlarmModalIfOpen() {
	closeAlarmModal();
}
