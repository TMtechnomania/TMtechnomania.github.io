// Import shared config and the new wallpaper renderer
import {
	STORAGE_KEY_DB,
	STORAGE_KEY_SETTINGS,
	DEFAULT_CONFIG,
} from "./config.js";
import { renderWallpaper } from "./wallpaper.js";
import { renderSearchbar, removeSearchbar } from "./searchbar.js";
import { renderActionbar } from "./actionbar.js";

const app = chrome || browser;

/**
 * Gets the user's config, merging it with defaults.
 */
async function getStoredConfig() {
	return new Promise((resolve) => {
		// Use a try/catch for the *initial* call
		try {
			app.storage.local.get(STORAGE_KEY_SETTINGS, (res) => {
				// Use a try/catch *inside* the callback to handle async errors
				try {
					// Check for any runtime errors
					if (app.runtime.lastError) {
						console.error(app.runtime.lastError.message);
						resolve(DEFAULT_CONFIG);
						return;
					}

					// FIX: Use optional chaining. The old code failed when res[STORAGE_KEY_SETTINGS]
					// was undefined, making 'stored' undefined and causing 'stored.wallpaper' to crash.
					const stored = res?.[STORAGE_KEY_SETTINGS] ?? {};

					// Deep merge with defaults to ensure all keys are present
					const mergedConfig = {
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
					};
					console.log("Loaded stored config:", stored, "merged:", mergedConfig);
					resolve(mergedConfig);
				} catch (e) {
					console.error("Failed to parse stored config:", e);
					resolve(DEFAULT_CONFIG); // Fallback on any parsing error
				}
			});
		} catch (e) {
			// This outer catch handles immediate errors from app.storage.local.get itself
			console.error("Failed to call app.storage.local.get:", e);
			resolve(DEFAULT_CONFIG);
		}
	});
}

/**
 * Would save the ID of the last rendered wallpaper for 'sequence' mode.
 * Disabled until a settings panel is created to handle config changes.
 */
async function setLastWallpaperId(id) {
	// TODO: Implement saving last_id once settings panel exists
	console.log(`Wallpaper rendered: ${id} (not saving last_id until settings panel)`);
}

/**
 * Gets the wallpaper manifest from local storage.
 */
async function getManifest() {
	return new Promise((resolve) => {
		try {
			app.storage.local.get(STORAGE_KEY_DB, (res) => {
				if (app.runtime.lastError) {
					console.error(app.runtime.lastError.message);
					resolve(null);
					return;
				}
				resolve(
					res && res[STORAGE_KEY_DB] ? res[STORAGE_KEY_DB] : null,
				);
			});
		} catch (e) {
			console.error("Failed to call app.storage.local.get for manifest:", e);
			resolve(null);
		}
	});
}

// --- Main Execution ---
(async () => {
	const config = await getStoredConfig();
	const manifest = await getManifest();
	let renderedId = null;

	if (!manifest || !(manifest.images || manifest.videos)) {
		console.warn("Manifest not found or is empty, using defaults.");
		// Pass an empty object for manifest, renderWallpaper will handle it.
		renderedId = await renderWallpaper(
			config.wallpaper || DEFAULT_CONFIG.wallpaper,
			{},
		);
	} else {
		// Fetch config and manifest, then let the wallpaper module handle the rest
		renderedId = await renderWallpaper(
			config.wallpaper || DEFAULT_CONFIG.wallpaper,
			manifest,
		);
	}

	// Save the ID of the wallpaper that was just rendered
	if (renderedId) {
		await setLastWallpaperId(renderedId);
	}

	// Render or remove searchbar depending on settings
	try {
		if (config && config.searchbar && config.searchbar.enabled) {
			await renderSearchbar(config.searchbar);
		} else {
			removeSearchbar();
		}
	} catch (e) {
		console.error('Failed to render/remove searchbar', e);
	}

	// Render action bar
	try {
		await renderActionbar(config.actionbar || DEFAULT_CONFIG.actionbar);
	} catch (e) {
		console.error('Failed to render action bar', e);
	}
})();