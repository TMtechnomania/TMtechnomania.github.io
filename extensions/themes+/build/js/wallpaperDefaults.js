// Default (first) catalog wallpapers.
//
// A fresh profile has no downloads, so the first image and the first video in
// the catalog are downloaded automatically whenever the catalog syncs. They
// are the app's fallback wallpapers and are never deleted — not from the
// per-tile trash button and not by "Delete All" (see settingsModal.js and the
// guard in db.js).
//
// The ids live in chrome.storage.local (not userSettings) so a settings sync
// from another device cannot bring in stale ids that do not exist here.

import { STORAGE_KEY_DEFAULT_MEDIA } from "./config.js";

const app =
	typeof chrome !== "undefined" ?
		chrome
	: typeof browser !== "undefined" ?
		browser
	: null;

/** The default ids implied by a catalog payload. */
export function defaultsFromManifest(manifest) {
	const pick = (list) => {
		const first = Array.isArray(list) ? list[0] : null;
		return first && first.id && first.asset ? first.id : null;
	};
	return {
		img: pick(manifest?.images),
		video: pick(manifest?.videos),
	};
}

/** True when `id` is either of the two protected defaults. */
export function isDefaultMediaId(defaults, id) {
	if (!defaults || !id) return false;
	return defaults.img === id || defaults.video === id;
}

export async function readDefaultMediaIds() {
	if (!app?.storage?.local) return null;
	return new Promise((resolve) => {
		try {
			app.storage.local.get(STORAGE_KEY_DEFAULT_MEDIA, (res) => {
				if (app.runtime?.lastError) return resolve(null);
				resolve(res?.[STORAGE_KEY_DEFAULT_MEDIA] || null);
			});
		} catch (e) {
			resolve(null);
		}
	});
}

export function writeDefaultMediaIds(ids) {
	if (!app?.storage?.local) return Promise.resolve(false);
	return new Promise((resolve) => {
		try {
			app.storage.local.set(
				{ [STORAGE_KEY_DEFAULT_MEDIA]: ids },
				() => resolve(!app.runtime?.lastError),
			);
		} catch (e) {
			resolve(false);
		}
	});
}
