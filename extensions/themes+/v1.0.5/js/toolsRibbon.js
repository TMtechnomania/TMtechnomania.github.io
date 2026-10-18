// Tools Ribbon - bottom ribbon of independent tool toggles
import { loadCSS, unloadCSS } from "./cssLoader.js";
import { renderInlineIcon } from "./brandIconLoader.js";
import { TOOL_WIDGETS } from "./toolsModal.js";

let _toolsRibbonListeners = null;
let _toolsToggleElement = null;
let _toolsRibbonAutoCloseTimer = null;
const TOOLS_RIBBON_AUTO_CLOSE_MS = 30000;

const STORAGE_KEY = "tm_tool_floats_v1";

function loadFloatState() {
	try {
		return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
	} catch (e) {
		return [];
	}
}

function saveFloatState() {
	try {
		const state = Array.from(_floatPanels.entries()).map(([id, panel]) => ({
			id,
			x: parseFloat(panel.dataset.x) || 0,
			y: parseFloat(panel.dataset.y) || 0,
		}));
		localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
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
		if (_floatPanels.size === 0) unloadCSS("tools-ribbon-css");
		return;
	}

	await loadCSS("css/toolsRibbon.css", "tools-ribbon-css");

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

	const x = pos?.x ?? 80 + count * 28;
	const y = pos?.y ?? 80 + count * 28;
	widget.style.transform = `translate(${x}px, ${y}px)`;
	widget.dataset.x = x;
	widget.dataset.y = y;

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

	if (typeof interact !== "undefined") {
		try {
			interact(widget).unset();
		} catch (e) {}
		interact(widget).draggable({
			allowFrom: ".widget-header",
			ignoreFrom: ".tool-float-close, .tool-float-close *",
			listeners: {
				move(event) {
					let x = (parseFloat(widget.dataset.x) || 0) + event.dx;
					let y = (parseFloat(widget.dataset.y) || 0) + event.dy;
					const maxX = window.innerWidth - widget.offsetWidth;
					const maxY = window.innerHeight - widget.offsetHeight;
					x = Math.max(0, Math.min(x, Math.max(0, maxX)));
					y = Math.max(0, Math.min(y, Math.max(0, maxY)));
					widget.style.transform = `translate(${x}px, ${y}px)`;
					widget.dataset.x = x;
					widget.dataset.y = y;
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
		if (typeof interact !== "undefined") interact(panel).unset();
	} catch (e) {}
	try {
		panel.remove();
	} catch (e) {}
	_floatPanels.delete(toolId);
	if (_floatPanels.size === 0) unloadCSS("tools-ribbon-css");
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
		if (_floatPanels.size === 0) unloadCSS("tools-ribbon-css");
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
			if (_floatPanels.size === 0) unloadCSS("tools-ribbon-css");
		}
	}
	document.addEventListener("keydown", onKeyDown);
	_toolsRibbonListeners = { onKeyDown };
}

export function restoreToolFloats() {
	const state = loadFloatState();
	if (!state.length) return;
	loadCSS("css/toolsRibbon.css", "tools-ribbon-css");
	loadCSS("css/toolsModal.css", "tools-modal-css");
	state.forEach(({ id, x, y }) => {
		const tool = TOOL_WIDGETS.find((t) => t.id === id);
		if (tool) openToolFloat(tool, { x, y });
	});
}

function detachToolsListeners() {
	if (!_toolsRibbonListeners) return;
	document.removeEventListener("keydown", _toolsRibbonListeners.onKeyDown);
	_toolsRibbonListeners = null;
}
