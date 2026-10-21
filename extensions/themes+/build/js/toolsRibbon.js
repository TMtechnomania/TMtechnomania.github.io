// Tools Ribbon - bottom ribbon of independent tool toggles
import { loadCSS, unloadCSS } from "./cssLoader.js";
import { renderInlineIcon } from "./brandIconLoader.js";
import { TOOL_WIDGETS } from "./toolsModal.js";
import { storageGetSync, storageSetAsync } from "./storageUtil.js";
import { loadScript } from "./lazyScript.js";
import { makeButtonLike } from "./uiUtil.js";

let _toolsRibbonListeners = null;
let _toolsToggleElement = null;
let _toolsRibbonAutoCloseTimer = null;
const TOOLS_RIBBON_AUTO_CLOSE_MS = 30000;

const STORAGE_KEY = "tm_tool_floats_v2";
const LEGACY_STORAGE_KEY = "tm_tool_floats_v1";
const STATE_VERSION = 2;
const DEFAULT_TOOL_POSITION_REM = 5;
const DEFAULT_TOOL_STAGGER_REM = 1.75;

function getRootRemPx() {
	try {
		const size = parseFloat(
			getComputedStyle(document.documentElement).fontSize,
		);
		return Number.isFinite(size) && size > 0 ? size : 16;
	} catch (e) {
		return 16;
	}
}

function roundRem(value) {
	return Math.round(Number(value) * 100) / 100;
}

function sanitizeTools(value) {
	if (!Array.isArray(value)) return [];
	return value
		.filter(
			(item) =>
				item &&
				typeof item.id === "string" &&
				Number.isFinite(Number(item.x)) &&
				Number.isFinite(Number(item.y)),
		)
		.map((item) => ({
			id: item.id,
			x: roundRem(item.x),
			y: roundRem(item.y),
		}));
}

function saveFloatStateTools(tools) {
	try {
		storageSetAsync(
			STORAGE_KEY,
			JSON.stringify({
				version: STATE_VERSION,
				unit: "rem",
				tools: sanitizeTools(tools),
			}),
		);
	} catch (e) {}
}

/**
 * Load saved tool positions.
 *
 * v1 stored pixels, which overlap when the viewport or the responsive root
 * font-size changes. v2 stores rem so the positions follow the UI scale.
 * Returns { tools, seeded }; seeded=false means no state has ever been saved.
 */
function loadFloatState() {
	const raw = storageGetSync(STORAGE_KEY);
	if (raw) {
		try {
			const parsed = JSON.parse(raw);
			if (parsed && Array.isArray(parsed.tools)) {
				return { tools: sanitizeTools(parsed.tools), seeded: true };
			}
		} catch (e) {}
	}

	const legacyRaw = storageGetSync(LEGACY_STORAGE_KEY);
	if (legacyRaw) {
		try {
			const legacy = JSON.parse(legacyRaw);
			if (Array.isArray(legacy)) {
				const remPx = getRootRemPx();
				const tools = sanitizeTools(legacy).map((tool) => ({
					id: tool.id,
					x: roundRem(tool.x / remPx),
					y: roundRem(tool.y / remPx),
				}));
				saveFloatStateTools(tools);
				return { tools, seeded: true };
			}
		} catch (e) {}
	}

	return { tools: [], seeded: false };
}

function saveFloatState() {
	try {
		const tools = Array.from(_floatPanels.entries()).map(([id, panel]) => ({
			id,
			x: parseFloat(panel.dataset.xRem) || 0,
			y: parseFloat(panel.dataset.yRem) || 0,
		}));
		saveFloatStateTools(tools);
	} catch (e) {}
}

const _floatPanels = new Map();

export function setToolsToggleElement(el) {
	_toolsToggleElement = el;
}

export async function toggleToolsRibbon() {
	const existing = document.getElementById("tools-ribbon");
	if (existing) {
		_clearToolsRibbonAutoCloseTimer();
		try {
			document.body.removeChild(existing);
		} catch (e) {}
		detachToolsListeners();
		if (_toolsToggleElement) {
			_toolsToggleElement.classList.remove("active");
			try {
				_toolsToggleElement.setAttribute("aria-expanded", "false");
			} catch (e) {}
		}
		if (_floatPanels.size === 0 && !document.getElementById("tools-ribbon")) unloadCSS("tools-ribbon-css");
		return;
	}

	await loadCSS("css/toolsRibbon.css", "tools-ribbon-css");
	// interact.js is only needed for draggable floating tools.
	await loadScript("js/interact.min.js").catch(() => {});

	try {
		const ribbon = createToolsRibbon();
		document.body.appendChild(ribbon);

		attachToolsListeners();
		if (_toolsToggleElement) {
			_toolsToggleElement.classList.add("active");
			try {
				_toolsToggleElement.setAttribute("aria-expanded", "true");
			} catch (e) {}
		}

		_scheduleToolsRibbonAutoClose();
	} catch (e) {
		// console.error('Failed to show tools ribbon', e);
	}
}

function createToolsRibbon() {
	const ribbon = document.createElement("div");
	ribbon.id = "tools-ribbon";

	const content = document.createElement("div");
	content.className = "tools-ribbon-content";

	const group = document.createElement("div");
	group.className = "tools-ribbon-group";

	TOOL_WIDGETS.forEach((tool) => {
		const item = document.createElement("div");
		item.className = "btn btn-icon-text tools-ribbon-tab";
		item.dataset.toolId = tool.id;
		item.title = tool.label;

		const icon = document.createElement("span");
		icon.setAttribute("aria-hidden", "true");
		renderInlineIcon(icon, `assets/svgs-fontawesome/solid/${tool.icon}.svg`);

		const label = document.createElement("span");
		label.className = "text";
		label.textContent = tool.label;

		item.appendChild(icon);
		item.appendChild(label);
		makeButtonLike(item);

		// Reflect already-open panels
		if (_floatPanels.has(tool.id)) item.classList.add("active");

		item.addEventListener("click", () => {
			if (_floatPanels.has(tool.id)) {
				closeToolFloat(tool.id);
				item.classList.remove("active");
			} else {
				openToolFloat(tool);
				item.classList.add("active");
			}
		});

		group.appendChild(item);
	});

	content.appendChild(group);
	ribbon.appendChild(content);

	content.addEventListener("mouseenter", () => {
		_clearToolsRibbonAutoCloseTimer();
	});
	content.addEventListener("mouseleave", () => {
		_scheduleToolsRibbonAutoClose();
	});

	return ribbon;
}

function applyToolPosition(widget, xRem, yRem) {
	const x = roundRem(xRem);
	const y = roundRem(yRem);
	widget.style.transform = `translate(${x}rem, ${y}rem)`;
	widget.dataset.xRem = String(x);
	widget.dataset.yRem = String(y);
}

function clampToolFloats() {
	if (!_floatPanels.size) return;
	const remPx = getRootRemPx();
	let changed = false;

	for (const panel of _floatPanels.values()) {
		if (!panel.isConnected) continue;
		const x = parseFloat(panel.dataset.xRem) || 0;
		const y = parseFloat(panel.dataset.yRem) || 0;
		const maxX = Math.max(
			0,
			(window.innerWidth - panel.offsetWidth) / remPx,
		);
		const maxY = Math.max(
			0,
			(window.innerHeight - panel.offsetHeight) / remPx,
		);
		const nx = Math.max(0, Math.min(x, maxX));
		const ny = Math.max(0, Math.min(y, maxY));
		if (nx !== x || ny !== y) {
			applyToolPosition(panel, nx, ny);
			changed = true;
		}
	}

	if (changed) saveFloatState();
}

let _floatClampTimer = null;
function scheduleFloatClamp() {
	clearTimeout(_floatClampTimer);
	_floatClampTimer = setTimeout(clampToolFloats, 150);
}

// The root font-size is fluid (720p-2160p + UI scale). Keep floating tools
// inside the viewport after a resize/orientation/scale change.
window.addEventListener("resize", scheduleFloatClamp);
try {
	document.addEventListener("settings:uiScale", scheduleFloatClamp);
} catch (e) {}
try {
	if (typeof ResizeObserver !== "undefined") {
		const observer = new ResizeObserver(scheduleFloatClamp);
		observer.observe(document.documentElement);
	}
} catch (e) {}

function openToolFloat(tool, pos) {
	const existing = _floatPanels.get(tool.id);
	if (existing) return existing;

	loadCSS("css/toolsModal.css", "tools-modal-css");

	const count = _floatPanels.size;
	let widget;
	try {
		widget = tool.widget();
	} catch (e) {
		// console.error('Failed to render tool', tool.id, e);
		return null;
	}

	widget.classList.add("tool-float-widget");
	widget.dataset.toolId = tool.id;

	const xRem = Number.isFinite(Number(pos?.x)) ?
		Number(pos.x)
	:	DEFAULT_TOOL_POSITION_REM + count * DEFAULT_TOOL_STAGGER_REM;
	const yRem = Number.isFinite(Number(pos?.y)) ?
		Number(pos.y)
	:	DEFAULT_TOOL_POSITION_REM + count * DEFAULT_TOOL_STAGGER_REM;
	applyToolPosition(widget, xRem, yRem);

	// Add a close button into the widget's own header (no wrapper)
	const header = widget.querySelector(".widget-header");
	if (header) {
		const closeBtn = document.createElement("button");
		closeBtn.className = "btn btn-icon btn-small tool-float-close";
		closeBtn.title = "Close";
		const closeIcon = document.createElement("span");
		renderInlineIcon(closeIcon, "assets/svgs-fontawesome/solid/xmark.svg");
		closeBtn.appendChild(closeIcon);
		closeBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			closeToolFloat(tool.id);
			const tab = document.querySelector(
				`.tools-ribbon-tab[data-tool-id='${tool.id}']`,
			);
			if (tab) tab.classList.remove("active");
		});
		header.appendChild(closeBtn);
	}

	document.body.appendChild(widget);
	_floatPanels.set(tool.id, widget);

	saveFloatState();
	scheduleFloatClamp();

	if (typeof interact !== "undefined") {
		try {
			interact(widget).unset();
		} catch (e) {}
		interact(widget).draggable({
			allowFrom: ".widget-header, .shortcut-widget",
			ignoreFrom:
				".tool-float-close, .tool-float-close *, .shortcut-tool-tile, .shortcut-tool-tile *, .shortcut-tool-resize",
			listeners: {
				move(event) {
					const remPx = getRootRemPx();
					let x =
						(parseFloat(widget.dataset.xRem) || 0) +
						event.dx / remPx;
					let y =
						(parseFloat(widget.dataset.yRem) || 0) +
						event.dy / remPx;
					const maxX = Math.max(
						0,
						(window.innerWidth - widget.offsetWidth) / remPx,
					);
					const maxY = Math.max(
						0,
						(window.innerHeight - widget.offsetHeight) / remPx,
					);
					x = Math.max(0, Math.min(x, maxX));
					y = Math.max(0, Math.min(y, maxY));
					applyToolPosition(widget, x, y);
				},
				end() {
					saveFloatState();
				},
			},
		});
	}

	return widget;
}

function closeToolFloat(toolId) {
	const panel = _floatPanels.get(toolId);
	if (!panel) return;
	if (panel._statsInterval) {
		clearInterval(panel._statsInterval);
		panel._statsInterval = null;
	}
	try {
		panel._cleanup?.();
	} catch (e) {}
	try {
		if (typeof interact !== "undefined") interact(panel).unset();
	} catch (e) {}
	try {
		panel.remove();
	} catch (e) {}
	_floatPanels.delete(toolId);
	if (_floatPanels.size === 0 && !document.getElementById("tools-ribbon")) unloadCSS("tools-ribbon-css");
	saveFloatState();
}

function _scheduleToolsRibbonAutoClose() {
	_clearToolsRibbonAutoCloseTimer();
	_toolsRibbonAutoCloseTimer = setTimeout(() => {
		const ribbon = document.getElementById("tools-ribbon");
		if (ribbon) {
			try {
				document.body.removeChild(ribbon);
			} catch (e) {}
		}
		detachToolsListeners();
		if (_toolsToggleElement) {
			_toolsToggleElement.classList.remove("active");
			try {
				_toolsToggleElement.setAttribute("aria-expanded", "false");
			} catch (e) {}
		}
		if (_floatPanels.size === 0 && !document.getElementById("tools-ribbon")) unloadCSS("tools-ribbon-css");
	}, TOOLS_RIBBON_AUTO_CLOSE_MS);
}

function _clearToolsRibbonAutoCloseTimer() {
	if (_toolsRibbonAutoCloseTimer) {
		clearTimeout(_toolsRibbonAutoCloseTimer);
		_toolsRibbonAutoCloseTimer = null;
	}
}

function attachToolsListeners() {
	if (_toolsRibbonListeners) return;
	function onKeyDown(ev) {
		if (ev.key === "Escape") {
			const ribbon = document.getElementById("tools-ribbon");
			if (ribbon) {
				try {
					document.body.removeChild(ribbon);
				} catch (e) {}
			}
			detachToolsListeners();
			if (_toolsToggleElement) {
				_toolsToggleElement.classList.remove("active");
				try {
					_toolsToggleElement.setAttribute("aria-expanded", "false");
				} catch (e) {}
			}
			if (_floatPanels.size === 0 && !document.getElementById("tools-ribbon")) unloadCSS("tools-ribbon-css");
		}
	}
	document.addEventListener("keydown", onKeyDown);
	_toolsRibbonListeners = { onKeyDown };
}

export async function restoreToolFloats() {
	const state = loadFloatState();
	if (!state.tools.length) return;
	await loadScript("js/interact.min.js").catch(() => {});
	loadCSS("css/toolsRibbon.css", "tools-ribbon-css");
	loadCSS("css/toolsModal.css", "tools-modal-css");
	state.tools.forEach(({ id, x, y }) => {
		const tool = TOOL_WIDGETS.find((t) => t.id === id);
		if (tool) openToolFloat(tool, { x, y });
	});
	scheduleFloatClamp();
}

function detachToolsListeners() {
	if (!_toolsRibbonListeners) return;
	document.removeEventListener("keydown", _toolsRibbonListeners.onKeyDown);
	_toolsRibbonListeners = null;
}
