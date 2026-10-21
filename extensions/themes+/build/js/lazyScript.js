// Loads legacy (non-module) browser scripts on demand.
// Used to keep snapdom.js and interact.min.js off the initial new-tab parse
// path; they are only needed for screenshots, pinned notes and floating tools.

const _scriptPromises = new Map();

export function loadScript(src) {
	if (!src) return Promise.reject(new Error("Missing script src"));
	if (_scriptPromises.has(src)) return _scriptPromises.get(src);

	const promise = new Promise((resolve, reject) => {
		const script = document.createElement("script");
		script.src = src;
		script.async = true;
		script.dataset.lazySrc = src;
		script.addEventListener("load", () => resolve(), { once: true });
		script.addEventListener(
			"error",
			() => {
				_scriptPromises.delete(src);
				reject(new Error(`Failed to load ${src}`));
			},
			{ once: true },
		);
		document.head.appendChild(script);
	});

	_scriptPromises.set(src, promise);
	return promise;
}
