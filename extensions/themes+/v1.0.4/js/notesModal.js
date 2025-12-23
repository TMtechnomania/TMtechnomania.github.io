import { loadCSS, unloadCSS } from "./cssLoader.js";
import { renderInlineIcon } from "./brandIconLoader.js";

const CSS_ID = "notes-modal-css";
const CSS_PATH = "css/notesModal.css";
const STORAGE_KEY = "tm_notes_v1";
const MAX_NOTES = 10;

let _backdrop = null;
let _onKeyDown = null;
let _state = {
	notes: [],
	currentEditId: null,
	checkUnsaved: null, // Function that returns true if unsaved changes exist
};

// --- Helpers ---
function createIconSpan(iconPath, className = "") {
	const icon = document.createElement("span");
	icon.className = className;
	icon.setAttribute("aria-hidden", "true");
	renderInlineIcon(icon, iconPath);
	return icon;
}

function attachIcon(target, iconPath) {
	const icon = createIconSpan(iconPath);
	target.appendChild(icon);
	return icon;
}

function uid() {
	return (
		"n_" + Date.now().toString(36) + Math.random().toString(36).substr(2, 5)
	);
}

// --- Storage ---
function loadState() {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		_state.notes = raw ? JSON.parse(raw) : [];
	} catch (e) {
		_state.notes = [];
	}
}

function saveState() {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(_state.notes));
		document.dispatchEvent(new CustomEvent("notes-updated"));
	} catch (e) {}
}

// --- UI Rendering ---

export async function toggleNotesModal() {
	if (_backdrop) closeNotesModal();
	else openNotesModal();
}

export async function openNotesModal(opts = {}) {
	if (_backdrop) {
		try {
			if (_backdrop.classList && _backdrop.classList.contains("notes-modal")) {
				_backdrop.focus();
			} else {
				_backdrop.querySelector(".notes-modal")?.focus();
			}
		} catch (e) {}
		return;
	}
	loadState();
	await loadCSS(CSS_PATH, CSS_ID);

	const modal = document.createElement("div");
	modal.className = "notes-modal";
	modal.tabIndex = -1;

	// Header
	const header = document.createElement("div");
	header.className = "modal-header";

	const headerTitle = document.createElement("div");
	headerTitle.className = "btn btn-icon-text btn-display modal-title";
	headerTitle.innerHTML = `<span></span><span class="text">Notes</span>`;
	renderInlineIcon(
		headerTitle.querySelector("span:first-child"),
		"assets/svgs-fontawesome/solid/note-sticky.svg",
	);

	const actionsGroup = document.createElement("div");
	actionsGroup.style.display = "flex";
	actionsGroup.style.gap = "var(--dis-1)";

	const closeBtn = document.createElement("button");
	closeBtn.className = "btn btn-icon";
	closeBtn.title = "Close";
	attachIcon(closeBtn, "assets/svgs-fontawesome/solid/xmark.svg");
	closeBtn.addEventListener("click", () => closeNotesModal());

	actionsGroup.appendChild(closeBtn);
	header.appendChild(headerTitle);
	header.appendChild(actionsGroup);

	modal.appendChild(header);

	// Body container
	const body = document.createElement("div");
	body.className = "notes-body";
	modal.appendChild(body);

	document.body.appendChild(modal);
	_backdrop = modal;

	_onKeyDown = (ev) => {
		if (ev.key === "Escape") closeNotesModal();
	};
	document.addEventListener("keydown", _onKeyDown);

	try {
		modal.focus();
	} catch (e) {}

	renderListView(body);

	if (opts && opts.mode === "edit" && opts.noteId) {
		try {
			const target = _state.notes.find((n) => n.id === opts.noteId);
			if (target) openEditor(body, target.type, target);
		} catch (e) {}
	}
}

export function closeNotesModal() {
	if (!_backdrop) return;

	// Protection check
	if (_state.checkUnsaved) {
		if (_state.checkUnsaved()) {
			if (
				!confirm(
					"You have unsaved changes. Are you sure you want to discard them?",
				)
			) {
				return;
			}
		}
		_state.checkUnsaved = null; // Clear checker
	}

	try {
		document.body.removeChild(_backdrop);
	} catch (e) {}
	_backdrop = null;
	if (_onKeyDown) {
		document.removeEventListener("keydown", _onKeyDown);
		_onKeyDown = null;
	}
	unloadCSS(CSS_ID);
	document.dispatchEvent(new CustomEvent("notes:closed"));
}

// --- Views ---

function renderListView(container) {
	container.innerHTML = "";
	_state.currentEditId = null;
	_state.checkUnsaved = null; // Clear any editor checkers

	// Buttons
	const controls = document.createElement("div");
	controls.className = "notes-controls-top";

	const addNoteBtn = document.createElement("button");
	addNoteBtn.type = "button";
	addNoteBtn.className = "btn btn-icon-text";
	attachIcon(addNoteBtn, "assets/svgs-fontawesome/solid/plus.svg");
	const nSpan = document.createElement("span");
	nSpan.className = "text";
	nSpan.textContent = "Note";
	addNoteBtn.appendChild(nSpan);
	addNoteBtn.addEventListener("click", () => openEditor(container, "note"));

	const addCheckBtn = document.createElement("button");
	addCheckBtn.type = "button";
	addCheckBtn.className = "btn btn-icon-text";
	attachIcon(addCheckBtn, "assets/svgs-fontawesome/solid/plus.svg");
	const cSpan = document.createElement("span");
	cSpan.className = "text";
	cSpan.textContent = "Checklist";
	addCheckBtn.appendChild(cSpan);
	addCheckBtn.addEventListener("click", () =>
		openEditor(container, "checklist"),
	);

	// Enforce max limit
	const atLimit = _state.notes.length >= MAX_NOTES;
	if (atLimit) {
		addNoteBtn.disabled = true;
		addNoteBtn.title = `Maximum ${MAX_NOTES} items reached`;
		addCheckBtn.disabled = true;
		addCheckBtn.title = `Maximum ${MAX_NOTES} items reached`;
	}

	controls.appendChild(addNoteBtn);
	controls.appendChild(addCheckBtn);
	container.appendChild(controls);

	const list = document.createElement("div");
	list.className = "notes-list";

	if (_state.notes.length === 0) {
		list.innerHTML = `<div class="notes-empty">No notes yet</div>`;
	} else {
		_state.notes.forEach((note) => {
			const item = document.createElement("div");
			item.className = "note-item";
			item.tabIndex = 0;

			const info = document.createElement("div");
			info.className = "note-info";

			const title = document.createElement("div");
			title.className = "note-title";
			title.textContent =
				note.title ||
				(note.type === "checklist"
					? "Untitled Checklist"
					: "Untitled Note");

			const preview = document.createElement("div");
			preview.className = "note-preview";
			if (note.type === "note") {
				preview.textContent = note.content || "No content";
			} else {
				const checked = note.items
					? note.items.filter((i) => i.checked).length
					: 0;
				const total = note.items ? note.items.length : 0;
				preview.textContent = `${checked}/${total} items`;
			}

			info.appendChild(title);
			info.appendChild(preview);
			item.appendChild(info);

			const actions = document.createElement("div");
			actions.className = "note-actions";

			const pinBtn = document.createElement("button");
			pinBtn.className = `btn btn-icon ${note.pinned ? "active" : ""}`;
			pinBtn.title = note.pinned ? "Unpin" : "Pin";
			attachIcon(pinBtn, "assets/svgs-fontawesome/solid/thumbtack.svg");
			pinBtn.addEventListener("click", (e) => {
				e.stopPropagation();
				note.pinned = !note.pinned;
				if (note.pinned && !note.x) {
					// Default pos
					note.x = 100;
					note.y = 100;
					note.width = 200;
					note.height = 200;
				}
				saveState();
				renderListView(container);
			});

			const editBtn = document.createElement("button");
			editBtn.className = "btn btn-icon";
			editBtn.title = "Edit";
			attachIcon(
				editBtn,
				"assets/svgs-fontawesome/solid/pen-to-square.svg",
			);
			editBtn.addEventListener("click", (e) => {
				e.stopPropagation();
				openEditor(container, note.type, note);
			});

			const delBtn = document.createElement("button");
			delBtn.className = "btn btn-icon";
			delBtn.title = "Delete";
			attachIcon(delBtn, "assets/svgs-fontawesome/solid/trash-can.svg");
			delBtn.addEventListener("click", (e) => {
				e.stopPropagation();
				if (confirm("Delete this note?")) {
					_state.notes = _state.notes.filter((n) => n.id !== note.id);
					saveState();
					renderListView(container);
				}
			});

			actions.appendChild(pinBtn);
			actions.appendChild(editBtn);
			actions.appendChild(delBtn);
			item.appendChild(actions);

			item.addEventListener("click", () =>
				openEditor(container, note.type, note),
			);
			list.appendChild(item);
		});
	}
	container.appendChild(list);
}

function openEditor(container, type, existingNote = null) {
	container.innerHTML = "";

	// Deep copy or create new
	const note = existingNote
		? JSON.parse(JSON.stringify(existingNote))
		: {
				id: uid(),
				type: type,
				title: "",
				content: "",
				items: [],
				pinned: false,
				x: 100,
				y: 100,
				width: 200,
				height: 200,
		  };

	// Initialize checklist items if needed BEFORE capturing original state
	if (type === "checklist" && !note.items.length) {
		note.items.push({ text: "", checked: false });
	}

	_state.currentEditId = note.id;

	// Create "Original" state for dirty checking
	const originalStr = existingNote
		? JSON.stringify(existingNote)
		: JSON.stringify(note);

	// Checker function
	_state.checkUnsaved = () => {
		const currentStr = JSON.stringify(note);
		// Compare checks equality. If different from original, we have unsaved changes.
		// NOTE: New notes are also "unsaved" if they differ from their blank init state?
		// Yes, if user typed something and leaves, warn them.
		return currentStr !== originalStr;
	};

	const form = document.createElement("div");
	form.className = "note-edit-form";

	// Top Bar
	const topBar = document.createElement("div");
	topBar.className = "note-top-bar";

	const backBtn = document.createElement("button");
	backBtn.className = "btn btn-text";
	const bSpan = document.createElement("span");
	bSpan.textContent = "Back";
	// Prepend arrow manually or use icon
	bSpan.innerHTML = "← Back";
	backBtn.appendChild(bSpan);
	backBtn.addEventListener("click", () => {
		if (_state.checkUnsaved && _state.checkUnsaved()) {
			if (!confirm("Unsaved changes will be lost. Continue?")) return;
		}
		renderListView(container);
	});

	const pinBtn = document.createElement("button");
	pinBtn.className = `btn btn-icon ${note.pinned ? "active" : ""}`;
	pinBtn.title = "Pin to Desktop";
	attachIcon(pinBtn, "assets/svgs-fontawesome/solid/thumbtack.svg");
	pinBtn.addEventListener("click", () => {
		note.pinned = !note.pinned;
		pinBtn.classList.toggle("active", note.pinned);
	});

	topBar.appendChild(backBtn);
	topBar.appendChild(pinBtn);
	form.appendChild(topBar);

	// Wrapper for Title and Content
	const contentWrapper = document.createElement("div");
	contentWrapper.className = "note-content-wrapper";

	// Title
	const titleIn = document.createElement("input");
	titleIn.className = "input note-input-title";
	titleIn.placeholder = "Title";
	titleIn.value = note.title;
	titleIn.addEventListener("input", (e) => (note.title = e.target.value));
	contentWrapper.appendChild(titleIn);

	// Content
	if (type === "note") {
		const text = document.createElement("textarea");
		text.className = "textarea note-input-content";
		text.placeholder = "Type your note here...";
		text.value = note.content || "";
		text.addEventListener("input", (e) => (note.content = e.target.value));
		contentWrapper.appendChild(text);
	} else {
		// Checklist
		const checkContainer = document.createElement("div");
		checkContainer.className = "checklist-container";

		const renderCheckItems = () => {
			checkContainer.innerHTML = "";
			// Note: We already ensured items length > 0 if empty
			note.items.forEach((item, idx) => {
				const row = document.createElement("div");
				row.className = "checklist-item-row";

				const box = document.createElement("button");
				box.className = "btn btn-icon checklist-checkbox";
				const icon = item.checked
					? "assets/svgs-fontawesome/solid/square-check.svg"
					: "assets/svgs-fontawesome/solid/square.svg";
				renderInlineIcon(box.appendChild(createIconSpan(icon)), icon);
				box.addEventListener("click", () => {
					item.checked = !item.checked;
					renderCheckItems();
				});

				const textIn = document.createElement("input");
				textIn.className = `input checklist-input ${
					item.checked ? "strike" : ""
				}`;
				textIn.value = item.text;
				textIn.placeholder = "Item...";
				textIn.addEventListener(
					"input",
					(e) => (item.text = e.target.value),
				);
				textIn.addEventListener("keydown", (e) => {
					if (e.key === "Enter") {
						note.items.splice(idx + 1, 0, {
							text: "",
							checked: false,
						});
						renderCheckItems();
						setTimeout(() => {
							const inputs = checkContainer.querySelectorAll(
								"input.checklist-input",
							);
							if (inputs[idx + 1]) inputs[idx + 1].focus();
						}, 10);
					}
					if (
						e.key === "Backspace" &&
						item.text === "" &&
						note.items.length > 0
					) {
						e.preventDefault();
						note.items.splice(idx, 1);
						renderCheckItems();
						if (idx > 0) {
							setTimeout(() => {
								const inputs = checkContainer.querySelectorAll(
									"input.checklist-input",
								);
								if (inputs[idx - 1]) inputs[idx - 1].focus();
							}, 10);
						}
					}
				});

				const del = document.createElement("button");
				del.className = "btn btn-icon";
				attachIcon(del, "assets/svgs-fontawesome/solid/xmark.svg");
				del.addEventListener("click", () => {
					note.items.splice(idx, 1);
					renderCheckItems();
				});

				row.appendChild(box);
				row.appendChild(textIn);
				row.appendChild(del);
				checkContainer.appendChild(row);
			});

			// Add Item Button
			const addRow = document.createElement("button");
			addRow.className = "btn btn-text";
			addRow.style.alignSelf = "flex-start";
			addRow.style.marginTop = "var(--dis-1)";
			const addSpan = document.createElement("span");
			addSpan.textContent = "+ Add Item";
			addRow.appendChild(addSpan);
			addRow.addEventListener("click", () => {
				note.items.push({ text: "", checked: false });
				renderCheckItems();
				setTimeout(() => {
					const inputs = checkContainer.querySelectorAll(
						"input.checklist-input",
					);
					if (inputs.length > 0) inputs[inputs.length - 1].focus();
				}, 10);
			});
			checkContainer.appendChild(addRow);
		};

		renderCheckItems();
		contentWrapper.appendChild(checkContainer);
	}

	form.appendChild(contentWrapper);

	// Footer
	const footer = document.createElement("div");
	footer.className = "notes-controls-bottom";

	const saveBtn = document.createElement("button");
	saveBtn.className = "btn btn-text primary";
	const sSpan = document.createElement("span");
	sSpan.textContent = "Save";
	saveBtn.appendChild(sSpan);
	saveBtn.addEventListener("click", () => {
		if (existingNote) {
			const idx = _state.notes.findIndex((n) => n.id === existingNote.id);
			if (idx !== -1) _state.notes[idx] = note;
		} else {
			_state.notes.push(note);
		}
		saveState();
		_state.checkUnsaved = null; // Changes saved, no more dirty
		renderListView(container);
	});

	footer.appendChild(saveBtn);
	form.appendChild(footer);
	container.appendChild(form);
}
