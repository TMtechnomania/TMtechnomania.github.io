// Cross-device notes + checklist sync.
//
// Local storage stays the source of truth for all reads and writes. Every
// local change is mirrored to a timestamped snapshot in chrome.storage.sync;
// on a fresh load (and whenever the sync snapshot changes) the newer side
// wins. If both devices changed since the last sync, notes are merged by id
// with their per-note updatedAt so edits on both devices survive.
//
// Sync snapshot layout (chrome.storage.sync):
//   notesSyncMeta          { version, updatedAt, deviceId, chunks }
//   notesSyncChunk_0..N-1  JSON string chunks (per-item quota is 8 KB)
//
// Local metadata (chrome.storage.local):
//   notesSyncLocalMeta     { updatedAt, syncedAt, deviceId }
//   notesSyncBase          JSON of the last synced notes array
//   notesSyncConflicts     last-resort backup of a losing conflict version

import { storageGetSync, storageSetAsync } from "./storageUtil.js";

const NOTES_KEY = "tm_notes_v1";
const LOCAL_META_KEY = "notesSyncLocalMeta";
const LOCAL_BASE_KEY = "notesSyncBase";
const LOCAL_CONFLICTS_KEY = "notesSyncConflicts";
const SYNC_META_KEY = "notesSyncMeta";
const SYNC_CHUNK_PREFIX = "notesSyncChunk_";
const SYNC_VERSION = 1;

// chrome.storage.sync allows 8 KB per item. Keep a safety margin for UTF-8.
const CHUNK_BYTES = 7000;
const PUSH_DEBOUNCE_MS = 700;
const SYNC_READ_DEBOUNCE_MS = 350;

let _started = false;
let _deviceId = null;
let _lastLocalJSON = null;
let _pushTimer = null;
let _syncReadTimer = null;

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
	return new Promise((resolve, reject) => {
		try {
			chrome.storage.local.set(obj, () => {
				const err = chrome.runtime?.lastError;
				if (err) reject(new Error(err.message));
				else resolve();
			});
		} catch (e) {
			reject(e);
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
	return new Promise((resolve, reject) => {
		try {
			chrome.storage.sync.set(obj, () => {
				const err = chrome.runtime?.lastError;
				if (err) reject(new Error(err.message));
				else resolve();
			});
		} catch (e) {
			reject(e);
		}
	});
}

function syncRemove(keys) {
	return new Promise((resolve) => {
		try {
			chrome.storage.sync.remove(keys, () => resolve());
		} catch (e) {
			resolve();
		}
	});
}

// ─── payload helpers ────────────────────────────────────────────────────────

function parseJSON(raw, fallback) {
	try {
		const value = JSON.parse(raw);
		return value ?? fallback;
	} catch (e) {
		return fallback;
	}
}

function readLocalNotes() {
	return parseJSON(storageGetSync(NOTES_KEY) || "[]", []);
}

async function readLocalMeta() {
	const res = await localGet(LOCAL_META_KEY);
	const meta = res[LOCAL_META_KEY];
	return meta && typeof meta === "object" ? meta : {};
}

async function readLocalBase() {
	const res = await localGet(LOCAL_BASE_KEY);
	const base = res[LOCAL_BASE_KEY];
	return Array.isArray(base) ? base : [];
}

function notesEqual(a, b) {
	try {
		return JSON.stringify(a) === JSON.stringify(b);
	} catch (e) {
		return false;
	}
}

function noteTime(note) {
	return Number(note?.updatedAt) || 0;
}

/** UTF-8 aware split so every chrome.storage.sync item stays under quota. */
function splitByBytes(str, maxBytes) {
	const chunks = [];
	let start = 0;
	let bytes = 0;
	for (let i = 0; i < str.length; i++) {
		const code = str.charCodeAt(i);
		let size = code < 0x80 ? 1 : code < 0x800 ? 2 : 3;
		if (code >= 0xd800 && code <= 0xdbff) {
			// Surrogate pair: 4 UTF-8 bytes, skip the low surrogate next.
			size = 4;
		}
		if (bytes + size > maxBytes) {
			chunks.push(str.slice(start, i));
			start = i;
			bytes = 0;
		}
		bytes += size;
		if (size === 4) i++;
	}
	if (start < str.length) chunks.push(str.slice(start));
	return chunks;
}

async function readSyncPayload() {
	if (!hasSyncStorage()) return null;
	const metaRes = await syncGet(SYNC_META_KEY);
	const meta = metaRes[SYNC_META_KEY];
	if (!meta || !Number.isInteger(meta.chunks) || meta.chunks <= 0) {
		return null;
	}
	// Sanity cap: the total sync quota cannot hold more than a few dozen
	// chunks; a larger value is corrupt metadata.
	if (meta.chunks > 40) return null;

	const keys = Array.from(
		{ length: meta.chunks },
		(_, i) => `${SYNC_CHUNK_PREFIX}${i}`,
	);
	const chunkRes = await syncGet(keys);
	const raw = keys.map((key) => chunkRes[key] || "").join("");
	if (!raw) return null;

	const payload = parseJSON(raw, null);
	if (!payload || !Array.isArray(payload.notes)) return null;
	return {
		notes: payload.notes,
		updatedAt: Number(payload.updatedAt) || 0,
		deviceId: payload.deviceId || "",
	};
}

async function writeSyncPayload(notes, updatedAt) {
	if (!hasSyncStorage()) return false;

	const payload = {
		version: SYNC_VERSION,
		updatedAt,
		deviceId: _deviceId,
		notes,
	};
	const raw = JSON.stringify(payload);
	const chunks = splitByBytes(raw, CHUNK_BYTES);

	const previous = await syncGet(SYNC_META_KEY);
	const previousChunks = Number(previous[SYNC_META_KEY]?.chunks) || 0;

	const obj = {
		[SYNC_META_KEY]: {
			version: SYNC_VERSION,
			updatedAt,
			deviceId: _deviceId,
			chunks: chunks.length,
		},
	};
	chunks.forEach((chunk, index) => {
		obj[`${SYNC_CHUNK_PREFIX}${index}`] = chunk;
	});

	await syncSet(obj);

	if (previousChunks > chunks.length) {
		const stale = [];
		for (let i = chunks.length; i < previousChunks; i++) {
			stale.push(`${SYNC_CHUNK_PREFIX}${i}`);
		}
		if (stale.length) await syncRemove(stale);
	}
	return true;
}

// ─── merge ──────────────────────────────────────────────────────────────────

/**
 * Merge local and remote notes against the last synced base.
 *
 * - A note changed on only one side takes that side.
 * - A note changed on both sides takes the newer per-note updatedAt.
 * - Deletions are detected with the base: a note missing on one side but
 *   unchanged on the other was deleted there.
 *
 * Returns the merged array plus any losing versions so they can be kept as a
 * local backup instead of disappearing silently.
 */
export function mergeNotes(base, local, remote) {
	const baseMap = new Map((base || []).map((n) => [n.id, n]));
	const localMap = new Map((local || []).map((n) => [n.id, n]));
	const remoteMap = new Map((remote || []).map((n) => [n.id, n]));

	const order = [];
	const seen = new Set();
	const add = (id) => {
		if (!id || seen.has(id)) return;
		seen.add(id);
		order.push(id);
	};
	(local || []).forEach((n) => add(n.id));
	(remote || []).forEach((n) => add(n.id));
	(base || []).forEach((n) => add(n.id));

	const merged = [];
	const conflicts = [];

	for (const id of order) {
		const b = baseMap.get(id);
		const l = localMap.get(id);
		const r = remoteMap.get(id);

		if (l && r) {
			if (notesEqual(l, r)) {
				merged.push(l);
			} else if (b && notesEqual(l, b)) {
				merged.push(r);
			} else if (b && notesEqual(r, b)) {
				merged.push(l);
			} else if (noteTime(r) > noteTime(l)) {
				merged.push(r);
				conflicts.push(l);
			} else {
				merged.push(l);
				conflicts.push(r);
			}
			continue;
		}

		if (l) {
			// Missing remotely: deleted there unless local changed it.
			if (b && notesEqual(l, b)) continue;
			merged.push(l);
			continue;
		}

		if (r) {
			// Missing locally: deleted here unless remote changed it.
			if (b && notesEqual(r, b)) continue;
			merged.push(r);
		}
	}

	return { notes: merged, conflicts };
}

// ─── local apply / push ─────────────────────────────────────────────────────

async function rememberConflict(loser) {
	if (!loser) return;
	const res = await localGet(LOCAL_CONFLICTS_KEY);
	const list = Array.isArray(res[LOCAL_CONFLICTS_KEY])
		? res[LOCAL_CONFLICTS_KEY]
		: [];
	list.unshift({ at: Date.now(), note: loser });
	try {
		await localSet({
			[LOCAL_CONFLICTS_KEY]: list.slice(0, 20),
		});
		console.warn(
			"[notesSync] conflicting edit kept the newest version; the other was backed up locally in",
			LOCAL_CONFLICTS_KEY,
		);
	} catch (e) {}
}

async function applyRemoteNotes(notes, updatedAt) {
	const json = JSON.stringify(notes);
	_lastLocalJSON = json;

	// storageSetAsync updates the in-memory notes snapshot used by the widget
	// and the modal, then persists to chrome.storage.local.
	await storageSetAsync(NOTES_KEY, json);
	await localSet({
		[LOCAL_META_KEY]: {
			updatedAt,
			syncedAt: Date.now(),
			deviceId: _deviceId,
		},
		[LOCAL_BASE_KEY]: notes,
	});

	document.dispatchEvent(new CustomEvent("notes-updated"));
}

function ensureTimestamps(notes, fallback) {
	let changed = false;
	for (const note of notes) {
		if (!Number.isFinite(Number(note.updatedAt)) || !note.updatedAt) {
			note.updatedAt = fallback;
			changed = true;
		}
	}
	return changed;
}

async function pushNow() {
	const notes = readLocalNotes();
	const rawJSON = JSON.stringify(notes);
	const meta = await readLocalMeta();
	const updatedAt = Number(meta.updatedAt) || Date.now();

	// Legacy notes may not have per-note timestamps yet. Stamp a copy for the
	// sync payload, but only write it back if no newer local edit landed
	// while we were preparing the push (otherwise the write would clobber it).
	const stamped = ensureTimestamps(notes, updatedAt);
	if (stamped) {
		const current = storageGetSync(NOTES_KEY) || "[]";
		if (current !== rawJSON) {
			schedulePush();
			return;
		}
		const json = JSON.stringify(notes);
		_lastLocalJSON = json;
		await storageSetAsync(NOTES_KEY, json);
	}

	try {
		await writeSyncPayload(notes, updatedAt);
		await localSet({
			[LOCAL_META_KEY]: {
				updatedAt,
				syncedAt: Date.now(),
				deviceId: _deviceId,
			},
			[LOCAL_BASE_KEY]: notes,
		});
	} catch (e) {
		// Quota/rate-limit errors leave the local copy untouched.
		console.warn("[notesSync] push failed:", e);
	}
}

function schedulePush() {
	if (!hasSyncStorage()) return;
	clearTimeout(_pushTimer);
	_pushTimer = setTimeout(() => {
		_pushTimer = null;
		pushNow().catch(() => {});
	}, PUSH_DEBOUNCE_MS);
}

// ─── local change observer ──────────────────────────────────────────────────

async function handleLocalChange(newValue) {
	const json =
		typeof newValue === "string" ? newValue : JSON.stringify(newValue || []);
	if (json === _lastLocalJSON) return;

	const notes = parseJSON(json, null);
	if (!Array.isArray(notes)) return;

	// The notes modules stamp their own edits with updatedAt. Do not write the
	// array back here: a rapid second edit could be clobbered by the write.
	// Legacy notes are stamped safely inside pushNow().
	_lastLocalJSON = json;

	const meta = await readLocalMeta();
	await localSet({
		[LOCAL_META_KEY]: {
			updatedAt: Date.now(),
			syncedAt: meta.syncedAt || 0,
			deviceId: _deviceId,
		},
	});
	schedulePush();
}

// ─── remote change observer ─────────────────────────────────────────────────

async function reconcileWithSync() {
	if (!hasSyncStorage()) return;
	const remote = await readSyncPayload();
	if (!remote) return;

	const localMeta = await readLocalMeta();
	if (remote.deviceId === _deviceId) return; // our own write echoed back

	const local = readLocalNotes();
	const base = await readLocalBase();
	const localAt = Number(localMeta.updatedAt) || 0;
	const remoteAt = Number(remote.updatedAt) || 0;

	if (remoteAt > localAt) {
		if (notesEqual(local, base)) {
			await applyRemoteNotes(remote.notes, remoteAt);
		} else {
			// Both devices edited since the last sync: merge.
			const { notes, conflicts } = mergeNotes(base, local, remote.notes);
			for (const loser of conflicts) await rememberConflict(loser);
			const mergedAt = Date.now();
			await applyRemoteNotes(notes, mergedAt);
			await pushNow();
		}
		return;
	}

	if (localAt > remoteAt) {
		schedulePush();
		return;
	}

	if (!notesEqual(local, remote.notes)) {
		const { notes, conflicts } = mergeNotes(base, local, remote.notes);
		for (const loser of conflicts) await rememberConflict(loser);
		const mergedAt = Date.now();
		await applyRemoteNotes(notes, mergedAt);
		await pushNow();
		return;
	}

	// Already in sync: refresh the base used for future merges.
	await localSet({ [LOCAL_BASE_KEY]: remote.notes });
}

// ─── boot ───────────────────────────────────────────────────────────────────

export async function initNotesSync() {
	if (_started) return;
	_started = true;

	// A stable per-device id distinguishes our own sync echoes from remote
	// writes. Kept in local storage so it survives reloads.
	const localMeta = await readLocalMeta();
	_deviceId = localMeta.deviceId || "";
	if (!_deviceId) {
		try {
			_deviceId = crypto.randomUUID();
		} catch (e) {
			_deviceId = `dev-${Date.now().toString(36)}-${Math.random()
				.toString(36)
				.slice(2, 8)}`;
		}
		// Persist immediately so other tabs opened at the same time share the
		// same identity and do not treat our own sync writes as remote ones.
		try {
			await localSet({
				[LOCAL_META_KEY]: { ...localMeta, deviceId: _deviceId },
			});
		} catch (e) {}
	}

	const local = readLocalNotes();
	_lastLocalJSON = JSON.stringify(local);
	const base = await readLocalBase();

	if (!hasSyncStorage()) {
		// Keep local-only behavior if sync is unavailable (policy/incognito).
		await localSet({
			[LOCAL_META_KEY]: {
				updatedAt: Number(localMeta.updatedAt) || 0,
				syncedAt: 0,
				deviceId: _deviceId,
			},
		});
		return;
	}

	const remote = await readSyncPayload();
	if (!remote) {
		if (local.length) await pushNow();
	} else {
		const localAt = Number(localMeta.updatedAt) || 0;
		const remoteAt = Number(remote.updatedAt) || 0;

		if (remoteAt > localAt) {
			if (notesEqual(local, base)) {
				await applyRemoteNotes(remote.notes, remoteAt);
			} else {
				const { notes, conflicts } = mergeNotes(
					base,
					local,
					remote.notes,
				);
				for (const loser of conflicts) await rememberConflict(loser);
				const mergedAt = Date.now();
				await applyRemoteNotes(notes, mergedAt);
				await pushNow();
			}
		} else if (localAt > remoteAt) {
			await pushNow();
		} else if (!notesEqual(local, remote.notes)) {
			const { notes, conflicts } = mergeNotes(base, local, remote.notes);
			for (const loser of conflicts) await rememberConflict(loser);
			const mergedAt = Date.now();
			await applyRemoteNotes(notes, mergedAt);
			await pushNow();
		} else {
			await localSet({ [LOCAL_BASE_KEY]: remote.notes });
		}
	}

	// Local writes (notes modal/widget) → debounce → sync.
	try {
		chrome.storage.onChanged.addListener((changes, area) => {
			if (area === "local" && changes[NOTES_KEY]) {
				handleLocalChange(changes[NOTES_KEY].newValue).catch(() => {});
			}
			if (area === "sync") {
				// Meta and chunks may arrive in separate events on another
				// device; re-read on either (debounced).
				const syncChanged = Object.keys(changes).some(
					(key) =>
						key === SYNC_META_KEY ||
						key.startsWith(SYNC_CHUNK_PREFIX),
				);
				if (!syncChanged) return;
				clearTimeout(_syncReadTimer);
				_syncReadTimer = setTimeout(() => {
					_syncReadTimer = null;
					reconcileWithSync().catch(() => {});
				}, SYNC_READ_DEBOUNCE_MS);
			}
		});
	} catch (e) {}
}
