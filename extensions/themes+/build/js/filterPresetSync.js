// Cross-device sync for the single custom wallpaper filter preset.
//
// The preset lives in `userSettings.wallpaper.customPreset` (chrome.storage.local)
// like the rest of the settings, and is mirrored to chrome.storage.sync — the
// same storage area notes/checklists use. The preset is a tiny object, so it
// occupies a single sync item (no chunking). Conflicts are last-write-wins,
// tracked by `updatedAt`.
//
// Sync item (chrome.storage.sync):
//   filterPresetSync  { version, updatedAt, deviceId, preset }
// Local metadata (chrome.storage.local):
//   filterPresetSyncLocalMeta  { updatedAt, deviceId }

import { STORAGE_KEY_SETTINGS } from "./config.js";
import {
	normalizeSettings,
	queueSettingsWrite,
} from "./settingsSync.js";

const LOCAL_META_KEY = "filterPresetSyncLocalMeta";
const SYNC_KEY = "filterPresetSync";
const SYNC_VERSION = 1;

const PUSH_DEBOUNCE_MS = 700;
const READ_DEBOUNCE_MS = 350;

const PRESET_KEYS = [
	"blur",
	"brightness",
	"contrast",
	"sharpness",
	"saturate",
	"grayscale",
];

let _started = false;
let _deviceId = null;
let _lastSyncedJSON = null;
let _pushTimer = null;
let _readTimer = null;

// ─── small async helpers ────────────────────────────────────────────────────

function hasSyncStorage() {
	try {
		return !!(chrome?.storage?.sync);
	} catch (e) {
		return false;
	}
}

function localGet(keys) {
	return new Promise((resolve) => {
		try {
			chrome.storage.local.get(keys, (res) => resolve(res || {}));
		} catch (e) {
			resolve({});
		}
	});
}

function localSet(obj) {
	return new Promise((resolve) => {
		try {
			chrome.storage.local.set(obj, () => resolve());
		} catch (e) {
			resolve();
		}
	});
}

function syncGet(keys) {
	return new Promise((resolve) => {
		try {
			chrome.storage.sync.get(keys, (res) => resolve(res || {}));
		} catch (e) {
			resolve({});
		}
	});
}

function syncSet(obj) {
	return new Promise((resolve) => {
		try {
			chrome.storage.sync.set(obj, () => resolve());
		} catch (e) {
			resolve();
		}
	});
}

// ─── preset helpers ─────────────────────────────────────────────────────────

function presetEqual(a, b) {
	if (!a && !b) return true;
	if (!a || !b) return false;
	return PRESET_KEYS.every((k) => Number(a[k]) === Number(b[k]));
}

async function readLocalPreset() {
	const res = await localGet(STORAGE_KEY_SETTINGS);
	const settings = res?.[STORAGE_KEY_SETTINGS];
	return settings?.wallpaper?.customPreset ?? null;
}

/** Persist a remote preset into the local settings (via the safe write path). */
async function writeLocalPreset(preset) {
	const res = await localGet(STORAGE_KEY_SETTINGS);
	const settings = normalizeSettings(res?.[STORAGE_KEY_SETTINGS]);
	if (!settings.wallpaper) settings.wallpaper = {};
	settings.wallpaper.customPreset = preset || null;
	queueSettingsWrite(settings);
}

async function pushNow(force = false) {
	const preset = await readLocalPreset();
	const json = JSON.stringify(preset);
	if (!force && json === _lastSyncedJSON) return;
	const updatedAt = Date.now();
	await syncSet({
		[SYNC_KEY]: {
			version: SYNC_VERSION,
			updatedAt,
			deviceId: _deviceId,
			preset: preset || null,
		},
	});
	_lastSyncedJSON = json;
	await localSet({
		[LOCAL_META_KEY]: { updatedAt, deviceId: _deviceId },
	});
}

async function reconcile() {
	const [localPreset, metaRes, syncRes] = await Promise.all([
		readLocalPreset(),
		localGet(LOCAL_META_KEY),
		syncGet(SYNC_KEY),
	]);
	const localMeta = metaRes?.[LOCAL_META_KEY] || {};
	const remote = syncRes?.[SYNC_KEY];
	const localAt = Number(localMeta.updatedAt) || 0;
	const remoteAt = Number(remote?.updatedAt) || 0;

	// Nothing published yet: upload ours if we have one.
	if (!remote) {
		if (localPreset) await pushNow(true);
		return;
	}

	// Our own write echoed back — just remember the timestamp.
	if (remote.deviceId === _deviceId) {
		_lastSyncedJSON = JSON.stringify(remote.preset ?? null);
		await localSet({
			[LOCAL_META_KEY]: { updatedAt: remoteAt, deviceId: _deviceId },
		});
		return;
	}

	if (remoteAt > localAt) {
		// Remote is newer: adopt it locally.
		const incoming = remote.preset ?? null;
		_lastSyncedJSON = JSON.stringify(incoming);
		if (!presetEqual(incoming, localPreset)) {
			await writeLocalPreset(incoming);
		}
		await localSet({
			[LOCAL_META_KEY]: { updatedAt: remoteAt, deviceId: _deviceId },
		});
	} else if (localAt > remoteAt) {
		// Local is newer: publish it.
		await pushNow(true);
	} else if (!presetEqual(remote.preset ?? null, localPreset)) {
		// Same timestamp, different content — make them agree.
		await pushNow(true);
	}
}

function schedulePush() {
	if (_pushTimer) clearTimeout(_pushTimer);
	_pushTimer = setTimeout(() => {
		_pushTimer = null;
		pushNow().catch(() => {});
	}, PUSH_DEBOUNCE_MS);
}

/**
 * Start mirroring the custom filter preset to chrome.storage.sync.
 * Safe to call more than once; no-op without sync storage.
 */
export async function initFilterPresetSync() {
	if (_started || !hasSyncStorage()) return;
	_started = true;

	const meta = (await localGet(LOCAL_META_KEY))?.[LOCAL_META_KEY];
	_deviceId = meta?.deviceId || "";
	if (!_deviceId) {
		try {
			_deviceId = crypto.randomUUID();
		} catch (e) {
			_deviceId = `dev-${Date.now().toString(36)}-${Math.random()
				.toString(36)
				.slice(2)}`;
		}
	}
	_lastSyncedJSON = JSON.stringify(await readLocalPreset());

	try {
		await reconcile();
	} catch (e) {}

	try {
		chrome.storage.onChanged.addListener((changes, area) => {
			if (area === "local" && changes[STORAGE_KEY_SETTINGS]) {
				// Only mirror when the preset itself actually changed, so slider
				// edits don't hammer sync storage.
				const before =
					changes[STORAGE_KEY_SETTINGS].oldValue?.wallpaper
						?.customPreset ?? null;
				const after =
					changes[STORAGE_KEY_SETTINGS].newValue?.wallpaper
						?.customPreset ?? null;
				if (!presetEqual(before, after)) schedulePush();
			}
			if (area === "sync" && changes[SYNC_KEY]) {
				if (_readTimer) clearTimeout(_readTimer);
				_readTimer = setTimeout(() => {
					_readTimer = null;
					reconcile().catch(() => {});
				}, READ_DEBOUNCE_MS);
			}
		});
	} catch (e) {}
}
