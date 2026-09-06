// Shared helpers for MV3 optional permissions and host origins.
// Standard API permissions are requested via chrome.permissions with `permissions`.
// Match patterns (<all_urls>) are requested with `origins`.
// Media & location capabilities are governed by Web Platform APIs.

function partitionPermissionsAndOrigins(names = []) {
	const permissions = [];
	const origins = [];
	const special = [];

	for (const name of names) {
		if (name === "<all_urls>" || name.includes("://") || name.includes("*")) {
			origins.push(name);
		} else if (
			name === "video-capture" ||
			name === "audio-capture" ||
			name === "camera" ||
			name === "microphone" ||
			name === "geolocation"
		) {
			special.push(name);
		} else if (name && name !== "permissions") {
			permissions.push(name);
		}
	}
	return { permissions, origins, special };
}

export async function hasPermissions(names) {
	try {
		const { permissions, origins, special } = partitionPermissionsAndOrigins(names);

		// Check Web Platform permissions if queried
		if (special.length > 0) {
			for (const s of special) {
				if (s === "geolocation") {
					if (navigator.permissions && navigator.permissions.query) {
						try {
							const res = await navigator.permissions.query({ name: "geolocation" });
							if (res.state !== "granted") return false;
						} catch (_) {
							// Query not supported or denied
						}
					}
				} else if (s === "video-capture" || s === "camera") {
					if (navigator.permissions && navigator.permissions.query) {
						try {
							const res = await navigator.permissions.query({ name: "camera" });
							if (res.state !== "granted") return false;
						} catch (_) {
							// Query not supported or denied
						}
					}
				} else if (s === "audio-capture" || s === "microphone") {
					if (navigator.permissions && navigator.permissions.query) {
						try {
							const res = await navigator.permissions.query({ name: "microphone" });
							if (res.state !== "granted") return false;
						} catch (_) {
							// Query not supported or denied
						}
					}
				}
			}
		}

		if (permissions.length === 0 && origins.length === 0) {
			return true;
		}

		const req = {};
		if (permissions.length) req.permissions = permissions;
		if (origins.length) req.origins = origins;

		if (typeof chrome !== "undefined" && chrome.permissions && chrome.permissions.contains) {
			return await chrome.permissions.contains(req);
		}
		return false;
	} catch (e) {
		console.warn("[permUtil] hasPermissions error:", e);
		return false;
	}
}

export async function requestPermissions(names) {
	try {
		const { permissions, origins, special } = partitionPermissionsAndOrigins(names);

		// Handle Web Platform permissions prompt
		if (special.length > 0) {
			for (const s of special) {
				if (s === "geolocation") {
					try {
						await new Promise((resolve, reject) => {
							navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 10000 });
						});
					} catch (_) {
						return false;
					}
				} else if (s === "video-capture" || s === "camera") {
					try {
						if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
							const stream = await navigator.mediaDevices.getUserMedia({ video: true });
							stream.getTracks().forEach((track) => track.stop());
						}
					} catch (_) {
						return false;
					}
				} else if (s === "audio-capture" || s === "microphone") {
					try {
						if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
							const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
							stream.getTracks().forEach((track) => track.stop());
						}
					} catch (_) {
						return false;
					}
				}
			}
		}

		if (permissions.length === 0 && origins.length === 0) {
			return true;
		}

		const req = {};
		if (permissions.length) req.permissions = permissions;
		if (origins.length) req.origins = origins;

		if (typeof chrome !== "undefined" && chrome.permissions && chrome.permissions.request) {
			return await chrome.permissions.request(req);
		}
		return false;
	} catch (e) {
		console.warn("[permUtil] requestPermissions error:", e);
		return false;
	}
}
