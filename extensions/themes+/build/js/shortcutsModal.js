import { renderInlineIcon, getIconForUrl } from "./brandIconLoader.js";
import { BRAND_ICONS } from "./brandIcons.js";
import { loadCSS } from "./cssLoader.js";
import { setupModalA11y, showAlert } from "./uiUtil.js";

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

	let a11yCleanup = null;
	const closeModal = () => {
		if (a11yCleanup) {
			a11yCleanup();
			a11yCleanup = null;
		}
		try {
			overlay.remove();
		} catch (e) {}
	};

	const modal = document.createElement("div");
	modal.className = "confirm-modal"; // Reuse existing modal style base
	modal.style.textAlign = "left";
	modal.style.maxWidth = "500px";
	modal.tabIndex = -1;
	modal.setAttribute("role", "dialog");
	modal.setAttribute("aria-modal", "true");
	modal.setAttribute("aria-labelledby", "shortcut-modal-title");

	const title = document.createElement("h3");
	title.id = "shortcut-modal-title";
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
		"Icon (Optional)",
		shortcut?.icon,
		"https://... or pick/upload below",
	);
	modal.appendChild(iconField.wrap);

	// Live icon preview, brand picker and local upload (Feature: logo picker).
	const DEFAULT_SHORTCUT_ICON = "assets/svgs-fontawesome/solid/globe.svg";
	// Uploaded files are kept out of the text field (a 200 KB data URL would be
	// unreadable there) and merged back on save.
	let uploadedIcon =
		typeof shortcut?.icon === "string" && shortcut.icon.startsWith("data:") ?
			shortcut.icon
		: "";
	if (uploadedIcon) {
		iconField.input.value = "";
		iconField.input.placeholder = "Uploaded logo selected";
	}
	const iconPreviewRow = document.createElement("div");
	iconPreviewRow.style.display = "flex";
	iconPreviewRow.style.alignItems = "center";
	iconPreviewRow.style.gap = "var(--dis-1)";
	iconPreviewRow.style.marginBottom = "1rem";

	const iconPreview = document.createElement("span");
	iconPreview.className = "shortcut-icon-preview";
	iconPreview.style.width = "2.25rem";
	iconPreview.style.height = "2.25rem";
	iconPreview.style.display = "inline-flex";
	iconPreview.style.alignItems = "center";
	iconPreview.style.justifyContent = "center";
	iconPreview.style.flex = "0 0 auto";
	iconPreview.style.borderRadius = "var(--radius-xs)";
	iconPreview.style.background = "var(--color-off)";

	const previewLabel = document.createElement("span");
	previewLabel.className = "setting-desc";
	previewLabel.textContent = "Icon preview";

	iconPreviewRow.append(iconPreview, previewLabel);
	modal.appendChild(iconPreviewRow);

	const updateIconPreview = () => {
		const value = uploadedIcon || iconField.input.value.trim();
		const url = urlField.input.value.trim();
		const iconPath = value || (url ? getIconForUrl(url) : DEFAULT_SHORTCUT_ICON);
		renderInlineIcon(iconPreview, iconPath, {
			fallbackSrc: DEFAULT_SHORTCUT_ICON,
		});
	};
	iconField.input.addEventListener("input", () => {
		uploadedIcon = "";
		iconField.input.placeholder = "https://... or pick/upload below";
		updateIconPreview();
	});
	urlField.input.addEventListener("input", updateIconPreview);

	const iconActions = document.createElement("div");
	iconActions.style.display = "flex";
	iconActions.style.gap = "var(--dis-1)";
	iconActions.style.flexWrap = "wrap";
	iconActions.style.marginBottom = "1rem";

	const browseBtn = document.createElement("button");
	browseBtn.type = "button";
	browseBtn.className = "btn btn-text";
	browseBtn.textContent = `Browse Brand Logos (${BRAND_ICONS.length})`;

	const uploadBtn = document.createElement("button");
	uploadBtn.type = "button";
	uploadBtn.className = "btn btn-text";
	uploadBtn.textContent = "Upload Logo";

	const uploadInput = document.createElement("input");
	uploadInput.type = "file";
	uploadInput.accept = "image/svg+xml,image/png,image/jpeg,image/webp,image/gif";
	uploadInput.style.display = "none";
	const MAX_ICON_BYTES = 256 * 1024;
	uploadInput.addEventListener("change", () => {
		const file = uploadInput.files?.[0];
		if (!file) return;
		if (file.size > MAX_ICON_BYTES) {
			showAlert("Logo file must be 256 KB or smaller.", "File too large");
			uploadInput.value = "";
			return;
		}
		const reader = new FileReader();
		reader.onload = () => {
			uploadedIcon = String(reader.result || "");
			iconField.input.value = "";
			iconField.input.placeholder = "Uploaded logo selected";
			updateIconPreview();
		};
		reader.onerror = () => showAlert("Could not read that logo file.", "Read failed");
		reader.readAsDataURL(file);
	});
	uploadBtn.addEventListener("click", () => uploadInput.click());

	const clearIconBtn = document.createElement("button");
	clearIconBtn.type = "button";
	clearIconBtn.className = "btn btn-text";
	clearIconBtn.textContent = "Clear Icon";
	clearIconBtn.addEventListener("click", () => {
		uploadedIcon = "";
		iconField.input.value = "";
		iconField.input.placeholder = "https://... or pick/upload below";
		updateIconPreview();
	});

	iconActions.append(browseBtn, uploadBtn, clearIconBtn, uploadInput);
	modal.appendChild(iconActions);

	// Brand picker (549 FontAwesome brand SVGs shipped with the extension).
	const picker = document.createElement("div");
	picker.style.display = "none";
	picker.style.maxHeight = "220px";
	picker.style.overflow = "auto";
	picker.style.border = "1px solid var(--color-off)";
	picker.style.borderRadius = "var(--radius-xs)";
	picker.style.padding = "var(--dis-1)";
	picker.style.marginBottom = "1rem";

	const pickerSearch = document.createElement("input");
	pickerSearch.type = "search";
	pickerSearch.className = "input";
	pickerSearch.placeholder = "Search brand logos...";
	picker.appendChild(pickerSearch);

	const pickerGrid = document.createElement("div");
	pickerGrid.style.display = "grid";
	pickerGrid.style.gridTemplateColumns =
		"repeat(auto-fill, minmax(2.1rem, 1fr))";
	pickerGrid.style.gap = "var(--dis-1)";
	pickerGrid.style.marginTop = "var(--dis-1)";

	const pickerButtons = [];
	BRAND_ICONS.forEach((name) => {
		const btn = document.createElement("button");
		btn.type = "button";
		btn.className = "btn btn-icon";
		btn.title = name;
		btn.setAttribute("aria-label", name);
		btn.dataset.brand = name;
		const img = document.createElement("img");
		img.src = `assets/svgs-fontawesome/brands/${name}.svg`;
		img.alt = "";
		img.loading = "lazy";
		img.style.width = "100%";
		img.style.height = "100%";
		img.style.objectFit = "contain";
		btn.appendChild(img);
		btn.addEventListener("click", () => {
			uploadedIcon = "";
			iconField.input.placeholder = "https://... or pick/upload below";
			iconField.input.value = `assets/svgs-fontawesome/brands/${name}.svg`;
			updateIconPreview();
			picker.style.display = "none";
			pickerSearch.value = "";
			pickerButtons.forEach((b) => (b.style.display = ""));
		});
		pickerButtons.push(btn);
		pickerGrid.appendChild(btn);
	});

	pickerSearch.addEventListener("input", () => {
		const query = pickerSearch.value.trim().toLowerCase();
		pickerButtons.forEach((btn) => {
			const name = btn.dataset.brand || "";
			btn.style.display = !query || name.includes(query) ? "" : "none";
		});
	});

	picker.appendChild(pickerGrid);
	modal.appendChild(picker);

	browseBtn.addEventListener("click", () => {
		const opening = picker.style.display === "none";
		picker.style.display = opening ? "block" : "none";
		if (opening) pickerSearch.focus();
	});

	updateIconPreview();

	// Buttons
	const btnGroup = document.createElement("div");
	btnGroup.className = "confirm-buttons";
	btnGroup.style.marginTop = "2rem";
	btnGroup.style.justifyContent = "flex-end";

	const cancelBtn = document.createElement("button");
	cancelBtn.className = "btn btn-text confirm-btn cancel";
	cancelBtn.textContent = "Cancel";
	cancelBtn.onclick = () => closeModal();

	const saveBtn = document.createElement("button");
	saveBtn.className = "btn btn-text primary confirm-btn confirm";
	saveBtn.textContent = "Save";
	saveBtn.onclick = () => {
		const newTitle = titleField.input.value.trim();
		const newUrl = urlField.input.value.trim();
		const newIcon = uploadedIcon || iconField.input.value.trim();

		if (!newTitle || !newUrl) {
			showAlert("Title and URL are required.", "Missing details");
			return;
		}

		onSave({
			title: newTitle,
			url: newUrl,
			icon: newIcon,
		});
		closeModal();
	};

	btnGroup.appendChild(cancelBtn);
	btnGroup.appendChild(saveBtn);
	modal.appendChild(btnGroup);

	overlay.appendChild(modal);
	document.body.appendChild(overlay);
	a11yCleanup = setupModalA11y(modal, { onClose: closeModal });

	titleField.input.focus();

	// Close on overlay click
	overlay.addEventListener("click", (e) => {
		if (e.target === overlay) closeModal();
	});
}
