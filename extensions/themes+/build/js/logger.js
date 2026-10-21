// Lightweight error logging shared by the page and the service worker.
// Swallowed errors are the main reason extension failures are invisible, so
// this module provides one place to report them without depending on a
// third-party logging service.

let _debug = false;

export function setDebugLogging(enabled) {
	_debug = !!enabled;
}

export function logError(scope, error, context = null) {
	const message =
		error && error.message ? error.message : String(error ?? "Unknown error");
	try {
		if (_debug) {
			console.error(`[Themes+][${scope}]`, message, context || "", error);
		} else {
			console.warn(`[Themes+][${scope}]`, message, context || "");
		}
	} catch (e) {
		// Logging must never throw.
	}
}

/**
 * Install global handlers for otherwise-unhandled page/worker errors.
 * Call once per execution context (new-tab page, service worker).
 */
export function installGlobalErrorLogging(scope = "app") {
	const target =
		typeof window !== "undefined"
			? window
			: typeof self !== "undefined"
				? self
				: null;
	if (!target || target.__tpErrorLoggingInstalled) return;
	target.__tpErrorLoggingInstalled = true;

	target.addEventListener("error", (event) => {
		logError(scope, event.error || event.message || event);
	});
	target.addEventListener("unhandledrejection", (event) => {
		logError(scope, event.reason || "Unhandled promise rejection");
	});
}
