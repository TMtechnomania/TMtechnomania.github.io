import { loadCSS } from "./cssLoader.js";
import { renderInlineIcon } from "./brandIconLoader.js";

const CSS_ID = "notes-widget-css";
const CSS_PATH = "css/notesWidget.css";
const STORAGE_KEY = "tm_notes_v1";

let _container = null;
// Use a namespace for listeners to clean up if needed
let _listeners = {};

function attachIcon(target, iconPath) {
	const icon = document.createElement("span");
	icon.setAttribute("aria-hidden", "true");
	renderInlineIcon(icon, iconPath);
	target.appendChild(icon);
	return icon;
}

export async function initNotesWidget() {
	await loadCSS(CSS_PATH, CSS_ID);

	_container = document.createElement("div");
	_container.id = "notes-widget-container";
	// Container just holds widgets, position is fixed on widgets
	document.body.appendChild(_container);

	renderWidgets();

	document.addEventListener("notes-updated", renderWidgets);
}

function getNotes() {
	try {
		return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
	} catch (e) {
		return [];
	}
}

function saveNoteState(updatedNote) {
	const notes = getNotes();
	const idx = notes.findIndex((n) => n.id === updatedNote.id);
	if (idx !== -1) {
		notes[idx] = updatedNote;
		localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
		// We do NOT dispatch 'notes-updated' here to avoid infinite render loop loops during drag,
		// or we just be careful. Drag ends only trigger save.
	}
}

function renderWidgets() {
	if (!_container) return;

	// Cleanup interact instances from previous render
	try {
		if (typeof interact !== "undefined") {
			_container
				.querySelectorAll(".note-widget")
				.forEach((el) => {
					try {
						interact(el).unset();
					} catch (e) {}
				});
		}
	} catch (e) {}

	_container.innerHTML = "";

	const notes = getNotes();
	const pinned = notes.filter((n) => n.pinned);

	pinned.forEach((note) => {
		const w = document.createElement("div");
		w.className = "note-widget";
		w.id = `widget-${note.id}`;

		// Defaults
		const x = note.x || 100;
		const y = note.y || 100;
		const width = note.width || 200;
		const height = note.height || 150;

		// Position with transform so interact.js can clamp and persist cleanly
		w.style.left = "0px";
		w.style.top = "0px";
		w.style.transform = `translate(${x}px, ${y}px)`;
		w.dataset.x = x;
		w.dataset.y = y;
		w.style.width = width + "px";
		w.style.height = height + "px";

		// Header
		const header = document.createElement("div");
		header.className = "note-widget-header";

		const title = document.createElement("span");
		title.className = "note-widget-title";
		title.textContent =
			note.title || (note.type === "checklist" ? "Checklist" : "Note");

		const controls = document.createElement("div");
		controls.className = "note-widget-controls";

		const openBtn = document.createElement("button");
		openBtn.type = "button";
		openBtn.className = "btn btn-small btn-icon";
		openBtn.title = "Open";
		attachIcon(openBtn, "assets/svgs-fontawesome/solid/up-right-from-square.svg");
		openBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			document.dispatchEvent(new CustomEvent("notes-open", { detail: { mode: "list" } }));
		});

		const editBtn = document.createElement("button");
		editBtn.type = "button";
		editBtn.className = "btn btn-small btn-icon";
		editBtn.title = "Edit";
		attachIcon(editBtn, "assets/svgs-fontawesome/solid/pen-to-square.svg");
		editBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			document.dispatchEvent(
				new CustomEvent("notes-open", {
					detail: { noteId: note.id, mode: "edit" },
				}),
			);
		});

		controls.appendChild(editBtn);
		controls.appendChild(openBtn);
		header.appendChild(title);
		header.appendChild(controls);
		w.appendChild(header);

		// Content
		const content = document.createElement("div");
		content.className = "note-widget-content";

		if (note.type === "note") {
			content.textContent = note.content;
		} else {
			// Checklist
			(note.items || []).forEach((item, idx) => {
				const row = document.createElement("div");
				row.className = "widget-checklist-item";

				const box = document.createElement("div");
				box.className = "ui-icon widget-checklist-box";
				// Keep it simple size
				box.style.width = "16px";
				box.style.height = "16px";
				renderInlineIcon(
					box,
					item.checked
						? "assets/svgs-fontawesome/solid/square-check.svg"
						: "assets/svgs-fontawesome/solid/square.svg",
				);

				// Toggle check from widget
				box.addEventListener("click", () => {
					note.items[idx].checked = !note.items[idx].checked;
					saveNoteState(note);
					renderWidgets(); // Update UI
				});

				const txt = document.createElement("span");
				txt.className = `widget-checklist-text ${
					item.checked ? "done" : ""
				}`;
				txt.textContent = item.text;

				row.appendChild(box);
				row.appendChild(txt);
				content.appendChild(row);
			});
		}
		w.appendChild(content);

		// Interact.js drag + resize (keeps widget inside viewport)
		setupInteract(w, header, note);

		_container.appendChild(w);
	});
}

function setupInteract(widgetEl, headerEl, note) {
	if (typeof interact === "undefined") {
		return;
	}

	try {
		interact(widgetEl).unset();
	} catch (e) {}

	const clamp = (value, min, max) => Math.max(min, Math.min(value, max));

	interact(widgetEl)
		.draggable({
			inertia: true,
			autoScroll: false,
			allowFrom: ".note-widget-header",
			ignoreFrom: ".note-widget-controls, .note-widget-controls *",
			listeners: {
				start() {
					widgetEl.classList.add("is-dragging");
				},
				move(event) {
					let x = (parseFloat(widgetEl.dataset.x) || 0) + event.dx;
					let y = (parseFloat(widgetEl.dataset.y) || 0) + event.dy;

					const maxX = window.innerWidth - widgetEl.offsetWidth;
					const maxY = window.innerHeight - widgetEl.offsetHeight;
					x = clamp(x, 0, Math.max(0, maxX));
					y = clamp(y, 0, Math.max(0, maxY));

					widgetEl.style.transform = `translate(${x}px, ${y}px)`;
					widgetEl.dataset.x = x;
					widgetEl.dataset.y = y;
				},
				end() {
					widgetEl.classList.remove("is-dragging");
					try {
						note.x = parseFloat(widgetEl.dataset.x) || 0;
						note.y = parseFloat(widgetEl.dataset.y) || 0;
						saveNoteState(note);
					} catch (e) {}
				},
			},
		})
		.resizable({
			edges: { left: true, right: true, bottom: true, top: true },
			margin: 10,
			inertia: true,
			listeners: {
				move(event) {
					let x = parseFloat(widgetEl.dataset.x) || 0;
					let y = parseFloat(widgetEl.dataset.y) || 0;

					x += event.deltaRect.left;
					y += event.deltaRect.top;

					let newWidth = event.rect.width;
					let newHeight = event.rect.height;

					// Clamp position and size to viewport
					x = clamp(x, 0, Math.max(0, window.innerWidth - newWidth));
					y = clamp(y, 0, Math.max(0, window.innerHeight - newHeight));
					newWidth = Math.min(newWidth, window.innerWidth - x);
					newHeight = Math.min(newHeight, window.innerHeight - y);

					Object.assign(widgetEl.style, {
						width: `${newWidth}px`,
						height: `${newHeight}px`,
						transform: `translate(${x}px, ${y}px)`,
					});

					widgetEl.dataset.x = x;
					widgetEl.dataset.y = y;
				},
				end() {
					try {
						note.x = parseFloat(widgetEl.dataset.x) || 0;
						note.y = parseFloat(widgetEl.dataset.y) || 0;
						note.width = widgetEl.getBoundingClientRect().width;
						note.height = widgetEl.getBoundingClientRect().height;
						saveNoteState(note);
					} catch (e) {}
				},
			},
			modifiers: [
				interact.modifiers.restrictEdges({
					outer: () => ({
						left: 0,
						top: 0,
						right: window.innerWidth,
						bottom: window.innerHeight,
					}),
				}),
				interact.modifiers.restrictSize({
					min: { width: 200, height: 150 },
					max: {
						width: window.innerWidth * 0.9,
						height: window.innerHeight * 0.9,
					},
				}),
			],
		});
}
