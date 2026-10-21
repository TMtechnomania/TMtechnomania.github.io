// Small shared DOM/UI helpers used across extension pages.

/**
 * Escape a string for safe interpolation into innerHTML templates.
 * User-controllable values (bookmark titles, workspace names, shortcut URLs,
 * RSS titles, ...) MUST go through this before being placed in markup to
 * prevent stored XSS on the new tab page.
 */
export function escapeHtml(value) {
	return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
		"&": "&amp;",
		"<": "&lt;",
		">": "&gt;",
		'"': "&quot;",
		"'": "&#39;",
	}[ch]));
}

/** Escape a string for safe use inside a RegExp pattern. */
export function escapeRegExp(value) {
	return String(value ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/* ------------------------------------------------------------------ */
/* HTML sanitizer for rich-text content (notes)                        */
/* Removes scripts, frames, media, styles and all attributes so that   */
/* stored note HTML can be rendered without network beacons or markup  */
/* injection. Only a small allowlist of formatting tags is kept.       */
/* ------------------------------------------------------------------ */

const NOTE_ALLOWED_TAGS = new Set([
	"B",
	"STRONG",
	"I",
	"EM",
	"U",
	"S",
	"STRIKE",
	"DEL",
	"BR",
	"P",
	"DIV",
	"SPAN",
	"UL",
	"OL",
	"LI",
	"H1",
	"H2",
	"H3",
	"H4",
	"H5",
	"H6",
	"BLOCKQUOTE",
	"PRE",
	"CODE",
]);

const NOTE_DROPPED_TAGS = new Set([
	"SCRIPT",
	"STYLE",
	"IFRAME",
	"FRAME",
	"FRAMESET",
	"OBJECT",
	"EMBED",
	"APPLET",
	"LINK",
	"META",
	"BASE",
	"FORM",
	"INPUT",
	"BUTTON",
	"TEXTAREA",
	"SELECT",
	"OPTION",
	"IMG",
	"PICTURE",
	"SOURCE",
	"VIDEO",
	"AUDIO",
	"TRACK",
	"CANVAS",
	"SVG",
	"MATH",
	"TEMPLATE",
	"NOSCRIPT",
]);

/**
 * Sanitize an HTML string to a safe subset of formatting markup.
 * The input is parsed in an inert <template>, so no resources are fetched
 * while sanitizing. Disallowed elements are unwrapped (their text is kept)
 * unless they are active/embedded content, which is removed entirely.
 * All attributes are stripped.
 */
export function sanitizeHtml(value) {
	const template = document.createElement("template");
	template.innerHTML = String(value ?? "");

	const output = document.createElement("div");

	const copyChildren = (source, parent) => {
		source.childNodes.forEach((child) => {
			if (child.nodeType === Node.TEXT_NODE) {
				parent.appendChild(document.createTextNode(child.nodeValue));
				return;
			}
			if (child.nodeType !== Node.ELEMENT_NODE) return; // comments, etc.

			const tag = child.tagName.toUpperCase();
			if (NOTE_DROPPED_TAGS.has(tag)) return;

			if (!NOTE_ALLOWED_TAGS.has(tag)) {
				copyChildren(child, parent); // unwrap unknown formatting
				return;
			}

			const clean = document.createElement(tag.toLowerCase());
			copyChildren(child, clean);
			parent.appendChild(clean);
		});
	};

	copyChildren(template.content, output);
	return output.innerHTML;
}

/* ------------------------------------------------------------------ */
/* URL scheme allowlist                                                */
/* ------------------------------------------------------------------ */

export const WEB_URL_PROTOCOLS = Object.freeze(["http:", "https:"]);
export const SHORTCUT_URL_PROTOCOLS = Object.freeze([
	"http:",
	"https:",
	"mailto:",
	"tel:",
]);
export const BOOKMARK_URL_PROTOCOLS = Object.freeze([
	"http:",
	"https:",
	"chrome:",
	"file:",
]);

/**
 * True when the URL is absolute and uses one of the allowed schemes.
 * javascript:, data:, blob:, vbscript: and malformed input are rejected.
 */
export function isSafeUrl(value, allowedProtocols = WEB_URL_PROTOCOLS) {
	const raw = String(value ?? "").trim();
	if (!raw) return false;
	try {
		const url = new URL(raw);
		return allowedProtocols.includes(url.protocol);
	} catch (e) {
		return false;
	}
}

/** Web-only allowlist (RSS links, remote wallpapers, etc.). */
export function isSafeExternalUrl(value) {
	return isSafeUrl(value, WEB_URL_PROTOCOLS);
}

/**
 * Open a URL only when it uses an allowed scheme. The default is web-only;
 * callers that support mail/telephone or browser-internal bookmarks pass the
 * corresponding allowlist.
 */
export function openSafeUrl(
	value,
	target = "_blank",
	allowedProtocols = WEB_URL_PROTOCOLS,
) {
	if (!isSafeUrl(value, allowedProtocols)) {
		showAlert(
			"This link uses an unsupported or unsafe URL scheme.",
			"Unsafe link blocked",
		);
		return false;
	}
	window.open(String(value).trim(), target);
	return true;
}

/**
 * Give a clickable non-button element (div/span) button semantics:
 * role, tab stop, accessible label, and Enter/Space activation.
 * Existing <button> elements and already-prepared elements are untouched.
 */
export function makeButtonLike(el) {
	if (!el || el.tagName === "BUTTON") return el;
	if (
		el.getAttribute("role") === "button" &&
		el.hasAttribute("tabindex")
	) {
		return el;
	}
	el.setAttribute("role", "button");
	if (!el.hasAttribute("tabindex")) el.tabIndex = 0;
	if (!el.hasAttribute("aria-label") && el.title) {
		el.setAttribute("aria-label", el.title);
	}
	el.addEventListener("keydown", (e) => {
		if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
			e.preventDefault();
			el.click();
		}
	});
	return el;
}

/* ------------------------------------------------------------------ */
/* Promise-based modal dialogs                                         */
/* Replace blocking native alert()/confirm()/prompt() calls, which     */
/* clash with the extension UI and are frowned upon by store reviewers.*/
/* All message text is inserted via textContent (XSS-safe).            */
/* ------------------------------------------------------------------ */

const DIALOG_STYLE_ID = "tp-dialog-styles";

function ensureDialogStyles() {
	if (document.getElementById(DIALOG_STYLE_ID)) return;
	const style = document.createElement("style");
	style.id = DIALOG_STYLE_ID;
	style.textContent = `
.tp-dialog-backdrop{position:fixed;inset:0;z-index:2147483646;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;}
.tp-dialog{background:var(--color-base,#1c1c22);color:var(--text-base,#f2f2f5);border:1px solid var(--color-off,rgba(255,255,255,.08));border-radius:14px;box-shadow:0 16px 48px rgba(0,0,0,.5);min-width:320px;max-width:min(480px,calc(108rem));padding:20px;}
.tp-dialog-title{font-size:15px;font-weight:600;margin-bottom:8px;}
.tp-dialog-message{font-size:13.5px;line-height:1.5;color:var(--text-off,#cfcfd6);white-space:pre-wrap;word-break:break-word;margin-bottom:18px;}
.tp-dialog-input{width:100%;box-sizing:border-box;background:rgba(255,255,255,.06);border:1px solid var(--color-off,rgba(255,255,255,.14));border-radius:8px;color:var(--text-base,#fff);font-size:13.5px;padding:9px 12px;margin-bottom:16px;outline:none;font-family:inherit;}
.tp-dialog-input:focus{border-color:var(--color-accent,#0072ff);}
.tp-dialog-actions{display:flex;justify-content:flex-end;gap:10px;}
.tp-btn{appearance:none;border:none;cursor:pointer;border-radius:8px;padding:9px 16px;font-size:13.5px;font-weight:600;font-family:inherit;line-height:1;transition:filter .15s ease,background .15s ease;}
.tp-btn:focus-visible{outline:2px solid var(--color-accent,#0072ff);outline-offset:2px;}
.tp-btn-primary{background:var(--color-accent,#0072ff);color:#fff;}
.tp-btn-primary:hover{filter:brightness(1.15);}
.tp-btn-secondary{background:rgba(255,255,255,.08);color:var(--text-base,#eee);}
.tp-btn-secondary:hover{background:rgba(255,255,255,.14);}`;
	document.head.appendChild(style);
}

/**
 * Open a modal dialog and resolve when the user dismisses it.
 * kind: "alert" | "confirm" | "prompt"
 * Resolves to: alert → undefined; confirm → boolean; prompt → string|null (null = cancel).
 */
function openDialog({ kind, title, message, defaultValue }) {
	return new Promise((resolve) => {
		ensureDialogStyles();
		const previouslyFocused = document.activeElement;

		const backdrop = document.createElement("div");
		backdrop.className = "tp-dialog-backdrop";
		const dialog = document.createElement("div");
		dialog.className = "tp-dialog";
		dialog.setAttribute("role", kind === "alert" ? "alertdialog" : "dialog");
		dialog.setAttribute("aria-modal", "true");

		let input = null;
		if (title) {
			const t = document.createElement("div");
			t.className = "tp-dialog-title";
			t.textContent = title; // textContent: safe for any string
			dialog.appendChild(t);
		}
		if (message) {
			const m = document.createElement("div");
			m.className = "tp-dialog-message";
			m.textContent = message; // textContent: safe for any string
			dialog.appendChild(m);
		}
		if (kind === "prompt") {
			input = document.createElement("input");
			input.type = "text";
			input.className = "tp-dialog-input";
			input.value = defaultValue ?? "";
			input.setAttribute(
				"aria-label",
				title || message || "Text input",
			);
			dialog.appendChild(input);
		}

		const actions = document.createElement("div");
		actions.className = "tp-dialog-actions";
		const makeBtn = (label, primary) => {
			const b = document.createElement("button");
			b.type = "button";
			b.className = primary ? "tp-btn tp-btn-primary" : "tp-btn tp-btn-secondary";
			b.textContent = label;
			actions.appendChild(b);
			return b;
		};

		let secondaryBtn, primaryBtn;
		if (kind === "alert") {
			primaryBtn = makeBtn("OK", true);
		} else if (kind === "confirm") {
			secondaryBtn = makeBtn("Cancel", false);
			primaryBtn = makeBtn("Confirm", true);
		} else {
			secondaryBtn = makeBtn("Cancel", false);
			primaryBtn = makeBtn("OK", true);
		}
		dialog.appendChild(actions);

		let settled = false;
		const close = (result) => {
			if (settled) return;
			settled = true;
			window.removeEventListener("keydown", onKeydown, true);
			backdrop.remove();
			try {
				if (
					previouslyFocused &&
					document.contains(previouslyFocused) &&
					typeof previouslyFocused.focus === "function"
				)
					previouslyFocused.focus();
			} catch (e) {
				/* focus restore is best-effort */
			}
			resolve(result);
		};

		// Native-dialog key semantics: Escape cancels, Enter accepts.
		const onKeydown = (ev) => {
			if (ev.key === "Escape") {
				ev.preventDefault();
				ev.stopPropagation(); // don't let underlying modals react
				close(kind === "confirm" ? false : null);
			} else if (
				ev.key === "Enter" &&
				kind !== "prompt" &&
				ev.target !== input
			) {
				ev.preventDefault();
				ev.stopPropagation();
				close(kind === "confirm" ? true : undefined);
			} else if (ev.key === "Enter" && kind === "prompt" && ev.target === input) {
				ev.preventDefault();
				ev.stopPropagation();
				close(input.value);
			} else if (ev.key === "Tab") {
				// Simple focus trap inside the dialog.
				const focusables = [...dialog.querySelectorAll("button, input")].filter(
					(el) => !el.disabled,
				);
				if (focusables.length === 0) return;
				const first = focusables[0];
				const last = focusables[focusables.length - 1];
				if (ev.shiftKey && document.activeElement === first) {
					ev.preventDefault();
					last.focus();
				} else if (!ev.shiftKey && document.activeElement === last) {
					ev.preventDefault();
					first.focus();
				}
			}
		};

		primaryBtn.addEventListener("click", () =>
			close(kind === "confirm" ? true : kind === "prompt" ? input.value : undefined),
		);
		if (secondaryBtn) secondaryBtn.addEventListener("click", () => close(false));

		backdrop.appendChild(dialog);
		document.body.appendChild(backdrop);
		window.addEventListener("keydown", onKeydown, true);

		// Initial focus: prompt → input; otherwise the primary button (native behavior).
		try {
			(kind === "prompt" ? input : primaryBtn).focus();
		} catch (e) {
			/* best-effort */
		}
	});
}

/** Non-blocking replacement for alert(). Resolves on OK/Escape. */
export function showAlert(message, title = "Notice") {
	return openDialog({ kind: "alert", title, message });
}

/** Non-blocking replacement for confirm(). Resolves true (Confirm/Enter) or false (Cancel/Escape). */
export function showConfirm(message, title = "Please confirm") {
	return openDialog({ kind: "confirm", title, message });
}

/** Non-blocking replacement for prompt(). Resolves with the entered string, or null on cancel. */
export function showPrompt(message, defaultValue = "", title = "Input required") {
	return openDialog({ kind: "prompt", title, message, defaultValue });
}

/* ------------------------------------------------------------------ */
/* Modal accessibility helper                                          */
/* ------------------------------------------------------------------ */

const FOCUSABLE_SELECTOR = [
	"a[href]",
	"button:not([disabled])",
	"input:not([disabled])",
	"select:not([disabled])",
	"textarea:not([disabled])",
	"[tabindex]:not([tabindex=\"-1\"])",
].join(", ");

/**
 * Adds dialog semantics and focus management to a modal element:
 *  - Ensures role="dialog", aria-modal="true" and tabIndex=-1.
 *  - Moves initial focus into the modal ([data-autofocus] > first visible
 *    focusable element > the dialog container itself).
 *  - Traps Tab / Shift+Tab inside the modal while it is active, pulling
 *    stray focus back in when it escapes to the page behind.
 *  - Escape invokes onClose() (when provided) only if the key event
 *    originates from within this modal, so stacked modals close topmost-first.
 *
 * Options:
 *   onClose    – callback invoked on Escape (optional).
 *   whenActive – predicate; all handling is skipped while it returns false
 *                (needed for persistent panels toggled via a class/flag).
 *
 * Returns cleanup(): removes the keydown listener and restores focus to the
 * element that was focused before setup. Call it when the modal closes.
 *
 * Layering note: openDialog() (showAlert/showConfirm/showPrompt) listens on
 * window capture and stopPropagation's Escape/Enter/Tab, so a tp-dialog
 * stacked above this modal always wins — its keys never reach this handler.
 */
export function setupModalA11y(
	dialogEl,
	{ onClose = null, whenActive = null } = {},
) {
	dialogEl.setAttribute("role", "dialog");
	dialogEl.setAttribute("aria-modal", "true");
	if (dialogEl.tabIndex < 0) dialogEl.tabIndex = -1;

	const previouslyFocused = document.activeElement;
	const isActive = () => !whenActive || whenActive();

	// Initial focus — only if the modal is already active/visible.
	if (!whenActive || whenActive()) {
		try {
			const auto = dialogEl.querySelector("[data-autofocus]");
			const firstVisible = [...dialogEl.querySelectorAll(FOCUSABLE_SELECTOR)].find(
				(el) => el.getClientRects().length > 0,
			);
			const target =
				(auto && auto.getClientRects().length > 0 ? auto : null) ||
				firstVisible ||
				dialogEl;
			target.focus();
		} catch (e) {
			/* focus is best-effort */
		}
	}

	const onKeydown = (ev) => {
		if (!isActive()) return;
		if (ev.key === "Escape") {
			// Only react when the key originates inside this modal so that a
			// stacked modal on top is closed first, not this one.
			if (onClose && dialogEl.contains(ev.target)) {
				ev.preventDefault();
				onClose();
			}
		} else if (ev.key === "Tab") {
			const focusables = [...dialogEl.querySelectorAll(FOCUSABLE_SELECTOR)].filter(
				(el) => el.getClientRects().length > 0,
			);
			if (focusables.length === 0) return;
			const first = focusables[0];
			const last = focusables[focusables.length - 1];
			const active = document.activeElement;
			if (!dialogEl.contains(active)) {
				// Focus escaped to the page behind — pull it back in.
				ev.preventDefault();
				first.focus();
				return;
			}
			if (ev.shiftKey && (active === first || active === dialogEl)) {
				ev.preventDefault();
				last.focus();
			} else if (!ev.shiftKey && (active === last || active === dialogEl)) {
				ev.preventDefault();
				first.focus();
			}
		}
	};
	document.addEventListener("keydown", onKeydown, true);

	return function cleanup() {
		document.removeEventListener("keydown", onKeydown, true);
		try {
			if (
				previouslyFocused &&
				document.contains(previouslyFocused) &&
				typeof previouslyFocused.focus === "function"
			)
				previouslyFocused.focus();
		} catch (e) {
			/* focus restore is best-effort */
		}
	};
}
