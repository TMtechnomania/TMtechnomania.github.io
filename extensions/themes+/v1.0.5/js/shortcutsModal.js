import { BRAND_ICONS } from "./brandIcons.js";
import {
	renderInlineIcon,
	getIconForUrl,
	normalizeIconPath,
} from "./brandIconLoader.js";
import { loadCSS } from "./cssLoader.js";
import { showAlert, setupModalA11y } from "./uiUtil.js";

const DEFAULT_FALLBACK_ICON = "assets/svgs-fontawesome/solid/globe.svg";

export async function openShortcutModal(shortcut = null, onSave) {
	await loadCSS("css/settingsModal.css", "settings-css");

	const isEdit = !!shortcut;

	// Create Modal Elements
	const overlay = document.createElement("div");
	overlay.className = "confirm-overlay";

	const modal = document.createElement("div");
	modal.className = "confirm-modal";
	modal.style.textAlign = "left";
	modal.style.maxWidth = "540px";
	modal.style.maxHeight = "90vh";
	modal.style.overflowY = "auto";

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

	// --- Enhanced Icon / Logo Section ---
	const iconSectionWrap = document.createElement("div");
	iconSectionWrap.style.marginBottom = "1.25rem";
	iconSectionWrap.style.padding = "1rem";
	iconSectionWrap.style.background = "var(--color-off)";
	iconSectionWrap.style.borderRadius = "var(--radius-child)";
	iconSectionWrap.style.border = "1px solid rgba(128, 128, 128, 0.15)";

	const iconSectionHeader = document.createElement("div");
	iconSectionHeader.style.display = "flex";
	iconSectionHeader.style.alignItems = "center";
	iconSectionHeader.style.justifyContent = "space-between";
	iconSectionHeader.style.marginBottom = "0.75rem";

	const iconLabel = document.createElement("div");
	iconLabel.textContent = "Shortcut Logo";
	iconLabel.className = "input-label";
	iconLabel.style.margin = "0";
	iconLabel.style.fontWeight = "600";
	iconSectionHeader.appendChild(iconLabel);

	iconSectionWrap.appendChild(iconSectionHeader);

	// Preview Box & Info
	const previewRow = document.createElement("div");
	previewRow.style.display = "flex";
	previewRow.style.alignItems = "center";
	previewRow.style.gap = "1rem";
	previewRow.style.marginBottom = "1rem";

	const previewTile = document.createElement("div");
	previewTile.className = "btn btn-icon";
	previewTile.style.width = "48px";
	previewTile.style.height = "48px";
	previewTile.style.minWidth = "48px";
	previewTile.style.borderRadius = "var(--radius-child)";
	previewTile.style.background = "var(--color-base)";
	previewTile.style.border = "1px solid rgba(128, 128, 128, 0.25)";
	previewTile.style.display = "flex";
	previewTile.style.alignItems = "center";
	previewTile.style.justifyContent = "center";
	previewTile.style.overflow = "hidden";

	const previewIconEl = document.createElement("span");
	previewIconEl.style.width = "28px";
	previewIconEl.style.height = "28px";
	previewIconEl.style.display = "flex";
	previewIconEl.style.alignItems = "center";
	previewIconEl.style.justifyContent = "center";
	previewTile.appendChild(previewIconEl);
	previewRow.appendChild(previewTile);

	const previewInfo = document.createElement("div");
	previewInfo.style.fontSize = "0.85rem";
	previewInfo.style.color = "var(--text-off)";
	previewInfo.textContent = "Live logo preview";
	previewRow.appendChild(previewInfo);

	iconSectionWrap.appendChild(previewRow);

	// Current chosen icon value (can be brand key, URL, relative path, or data URI)
	let currentIconValue = shortcut?.icon || "";

	const updatePreview = () => {
		const targetUrl = urlField.input.value.trim();
		let effectiveIcon = currentIconValue.trim();

		if (!effectiveIcon) {
			effectiveIcon = targetUrl ? getIconForUrl(targetUrl) : DEFAULT_FALLBACK_ICON;
			previewInfo.textContent = targetUrl
				? "Auto-detected from URL domain"
				: "Default fallback icon";
		} else if (effectiveIcon.startsWith("data:")) {
			previewInfo.textContent = "Custom uploaded file";
		} else if (effectiveIcon.startsWith("http://") || effectiveIcon.startsWith("https://")) {
			previewInfo.textContent = "Custom remote URL";
		} else if (BRAND_ICONS.includes(effectiveIcon) || effectiveIcon.includes("/brands/")) {
			const brandName = effectiveIcon.replace(/^.*\/|\.svg$/g, "");
			previewInfo.textContent = `Brand logo: ${brandName}`;
		} else {
			previewInfo.textContent = "Custom icon path";
		}

		renderInlineIcon(previewIconEl, effectiveIcon, {
			fallbackSrc: DEFAULT_FALLBACK_ICON,
		});
	};

	// 1. Existing Brand Logos Dropdown
	const dropdownWrap = document.createElement("div");
	dropdownWrap.style.marginBottom = "0.75rem";

	const dropdownLabel = document.createElement("div");
	dropdownLabel.className = "input-label";
	dropdownLabel.style.fontSize = "0.8rem";
	dropdownLabel.textContent = "Choose from 500+ Existing Brand Logos:";
	dropdownWrap.appendChild(dropdownLabel);

	const brandSelect = document.createElement("select");
	brandSelect.className = "input";
	brandSelect.style.width = "100%";
	brandSelect.style.cursor = "pointer";

	const defaultOption = document.createElement("option");
	defaultOption.value = "";
	defaultOption.textContent = "-- Select an Existing Brand Logo --";
	brandSelect.appendChild(defaultOption);

	const sortedBrands = [...BRAND_ICONS].sort((a, b) => a.localeCompare(b));
	sortedBrands.forEach((brand) => {
		const opt = document.createElement("option");
		opt.value = brand;
		opt.textContent = brand;
		if (shortcut?.icon === brand || shortcut?.icon === `assets/svgs-fontawesome/brands/${brand}.svg`) {
			opt.selected = true;
		}
		brandSelect.appendChild(opt);
	});

	dropdownWrap.appendChild(brandSelect);
	iconSectionWrap.appendChild(dropdownWrap);

	// 2. Custom Upload & Reset Controls
	const actionsRow = document.createElement("div");
	actionsRow.style.display = "flex";
	actionsRow.style.gap = "0.5rem";
	actionsRow.style.flexWrap = "wrap";
	actionsRow.style.marginBottom = "0.75rem";

	// Upload Button
	const fileInput = document.createElement("input");
	fileInput.type = "file";
	fileInput.accept = "image/*,.svg";
	fileInput.style.display = "none";

	const uploadBtn = document.createElement("button");
	uploadBtn.type = "button";
	uploadBtn.className = "btn btn-icon-text";
	uploadBtn.innerHTML = `<span></span><span class="text">Upload Custom Logo</span>`;
	renderInlineIcon(uploadBtn.querySelector("span"), "assets/svgs-fontawesome/solid/upload.svg");
	uploadBtn.onclick = () => fileInput.click();

	fileInput.onchange = (e) => {
		const file = e.target.files?.[0];
		if (!file) return;

		// Limit icon upload size to 2MB to keep storage lightweight
		if (file.size > 2 * 1024 * 1024) {
			showAlert("Logo file is too large. Maximum size is 2MB.", "File too large");
			fileInput.value = "";
			return;
		}

		const reader = new FileReader();
		reader.onload = (loadEvent) => {
			const dataUrl = loadEvent.target?.result;
			if (dataUrl) {
				currentIconValue = dataUrl;
				customUrlInput.value = dataUrl;
				brandSelect.value = "";
				updatePreview();
			}
		};
		reader.readAsDataURL(file);
	};

	actionsRow.appendChild(fileInput);
	actionsRow.appendChild(uploadBtn);

	// Reset to Auto Button
	const resetBtn = document.createElement("button");
	resetBtn.type = "button";
	resetBtn.className = "btn btn-icon-text";
	resetBtn.innerHTML = `<span></span><span class="text">Auto-Detect Logo</span>`;
	renderInlineIcon(resetBtn.querySelector("span"), "assets/svgs-fontawesome/solid/rotate.svg");
	resetBtn.onclick = () => {
		currentIconValue = "";
		customUrlInput.value = "";
		brandSelect.value = "";
		fileInput.value = "";
		updatePreview();
	};
	actionsRow.appendChild(resetBtn);

	iconSectionWrap.appendChild(actionsRow);

	// 3. Custom URL / Path Input
	const customUrlLabel = document.createElement("div");
	customUrlLabel.className = "input-label";
	customUrlLabel.style.fontSize = "0.8rem";
	customUrlLabel.textContent = "Or Custom Logo URL / Image Source:";
	iconSectionWrap.appendChild(customUrlLabel);

	const customUrlInput = document.createElement("input");
	customUrlInput.type = "text";
	customUrlInput.className = "input";
	customUrlInput.placeholder = "https://... or data:image/...";
	customUrlInput.value = shortcut?.icon || "";
	iconSectionWrap.appendChild(customUrlInput);

	// Event Handlers for Logo Inputs
	brandSelect.onchange = () => {
		if (brandSelect.value) {
			currentIconValue = brandSelect.value;
			customUrlInput.value = `assets/svgs-fontawesome/brands/${brandSelect.value}.svg`;
		} else {
			currentIconValue = customUrlInput.value.trim();
		}
		updatePreview();
	};

	customUrlInput.oninput = () => {
		currentIconValue = customUrlInput.value.trim();
		const matchedBrand = sortedBrands.find(
			(b) => currentIconValue === b || currentIconValue === `assets/svgs-fontawesome/brands/${b}.svg`
		);
		brandSelect.value = matchedBrand || "";
		updatePreview();
	};

	urlField.input.oninput = () => {
		if (!currentIconValue) {
			updatePreview();
		}
	};

	modal.appendChild(iconSectionWrap);

	// Initial Preview
	updatePreview();

	// Buttons
	const btnGroup = document.createElement("div");
	btnGroup.className = "confirm-buttons";
	btnGroup.style.marginTop = "1.5rem";
	btnGroup.style.justifyContent = "flex-end";

	const cancelBtn = document.createElement("button");
	cancelBtn.type = "button";
	cancelBtn.className = "btn btn-text confirm-btn cancel";
	cancelBtn.textContent = "Cancel";
	cancelBtn.onclick = () => removeOverlay();

	const saveBtn = document.createElement("button");
	saveBtn.type = "button";
	saveBtn.className = "btn btn-text primary confirm-btn confirm";
	saveBtn.textContent = "Save";
	saveBtn.onclick = async () => {
		const newTitle = titleField.input.value.trim();
		const newUrl = urlField.input.value.trim();
		let newIcon = currentIconValue.trim();

		if (!newTitle || !newUrl) {
			await showAlert("Title and URL are required.", "Missing fields");
			return;
		}

		// Normalize brand icon if brand name was selected
		if (BRAND_ICONS.includes(newIcon)) {
			newIcon = `assets/svgs-fontawesome/brands/${newIcon}.svg`;
		}

		onSave({
			title: newTitle,
			url: newUrl,
			icon: newIcon,
		});
		removeOverlay();
	};

	btnGroup.appendChild(cancelBtn);
	btnGroup.appendChild(saveBtn);
	modal.appendChild(btnGroup);

	overlay.appendChild(modal);
	document.body.appendChild(overlay);

	// Accessibility: dialog semantics, initial focus, Tab trap and Escape-to-close.
	let a11yCleanup = null;
	const removeOverlay = () => {
		if (a11yCleanup) {
			a11yCleanup();
			a11yCleanup = null;
		}
		try {
			document.body.removeChild(overlay);
		} catch (e) {
			/* already removed */
		}
	};
	a11yCleanup = setupModalA11y(modal, { onClose: removeOverlay });

	titleField.input.focus();

	// Close on overlay click
	overlay.addEventListener("click", (e) => {
		if (e.target === overlay) removeOverlay();
	});
}
