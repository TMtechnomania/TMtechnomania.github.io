import { renderInlineIcon } from "./brandIconLoader.js";
import { loadCSS } from "./cssLoader.js";

let _callback = null;

export async function openShortcutModal(shortcut = null, onSave) {
	await loadCSS("css/settingsModal.css", "settings-css");
	// Note: We reuse settings-css. If settings modal is opened later, it's fine.
	// But if we close this, we might unload it?
	// settingsModal.js unloads it on close.
	// Here we should probably NOT unload it or check ref count.
	// For simplicity, we just load it.
	// Ideally we should have a shared css file.

	const isEdit = !!shortcut;

	// Create Modal Elements
	const overlay = document.createElement("div");
	overlay.className = "confirm-overlay"; // Reuse existing overlay style

	const modal = document.createElement("div");
	modal.className = "confirm-modal"; // Reuse existing modal style base
	modal.style.textAlign = "left";
	modal.style.maxWidth = "500px";

	const title = document.createElement("h3");
	title.textContent = isEdit ? "Edit Shortcut" : "Add Shortcut";
	title.style.marginTop = "0";
	title.style.marginBottom = "1.5rem";
	title.style.color = "var(--text-accent)";
	modal.appendChild(title);

	// Form Fields Helper
	const createField = (label, value, placeholder) => {
		const wrap = document.createElement("div");
		wrap.style.marginBottom = "1rem";

		const lbl = document.createElement("div");
		lbl.textContent = label;
		lbl.className = "input-label";
		wrap.appendChild(lbl);

		const input = document.createElement("input");
		input.type = "text";
		input.className = "input";
		input.value = value || "";
		input.placeholder = placeholder || "";
		wrap.appendChild(input);

		return { wrap, input };
	};

	const titleField = createField("Title", shortcut?.title, "e.g. My Site");
	modal.appendChild(titleField.wrap);

	const urlField = createField(
		"URL",
		shortcut?.url,
		"e.g. https://example.com",
	);
	modal.appendChild(urlField.wrap);

	const iconField = createField(
		"Icon URL (Optional)",
		shortcut?.icon,
		"https://...",
	);
	modal.appendChild(iconField.wrap);

	// Buttons
	const btnGroup = document.createElement("div");
	btnGroup.className = "confirm-buttons";
	btnGroup.style.marginTop = "2rem";
	btnGroup.style.justifyContent = "flex-end";

	const cancelBtn = document.createElement("button");
	cancelBtn.className = "btn btn-text confirm-btn cancel";
	cancelBtn.textContent = "Cancel";
	cancelBtn.onclick = () => document.body.removeChild(overlay);

	const saveBtn = document.createElement("button");
	saveBtn.className = "btn btn-text primary confirm-btn confirm";
	saveBtn.textContent = "Save";
	saveBtn.onclick = () => {
		const newTitle = titleField.input.value.trim();
		const newUrl = urlField.input.value.trim();
		const newIcon = iconField.input.value.trim();

		if (!newTitle || !newUrl) {
			alert("Title and URL are required.");
			return;
		}

		onSave({
			title: newTitle,
			url: newUrl,
			icon: newIcon,
		});
		document.body.removeChild(overlay);
	};

	btnGroup.appendChild(cancelBtn);
	btnGroup.appendChild(saveBtn);
	modal.appendChild(btnGroup);

	overlay.appendChild(modal);
	document.body.appendChild(overlay);

	titleField.input.focus();

	// Close on overlay click
	overlay.addEventListener("click", (e) => {
		if (e.target === overlay) document.body.removeChild(overlay);
	});
}
