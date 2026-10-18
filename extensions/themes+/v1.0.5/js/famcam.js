import { renderInlineIcon } from "./brandIconLoader.js";
import { loadCSS, unloadCSS } from "./cssLoader.js";

const CSS_ID = "famcam-css";
const CSS_PATH = "css/famcam.css";

let _famCamConfig = null;
let _stream = null;
let _previewEl = null;
let _flashOverlay = null;

function ensureFamCamCSS() {
	try {
		return loadCSS(CSS_PATH, CSS_ID);
	} catch (e) {
		return Promise.resolve(null);
	}
}

function unloadFamCamCSSIfUnused() {
	const hasPreview = !!_previewEl || !!document.getElementById("famcam-preview");
	const hasFlash = !!_flashOverlay || !!document.getElementById("famcam-flash-overlay");
	if (!hasPreview && !hasFlash) {
		unloadCSS(CSS_ID);
	}
}

export function destroyFamCam() {
	try {
		// Remove any active flash UI
		try {
			toggleFlash(false);
		} catch (e) {}

		if (_stream) {
			try {
				_stream.getTracks().forEach((t) => t.stop());
			} catch (e) {}
			_stream = null;
		}

		if (_previewEl) {
			try {
				if (typeof interact !== "undefined") {
					interact(_previewEl).unset();
				}
			} catch (e) {}
			try {
				_previewEl.remove();
			} catch (e) {}
			_previewEl = null;
		}

		// Ensure any leftover flash overlay is removed
		try {
			document.getElementById("famcam-flash-overlay")?.remove();
		} catch (e) {}
		_flashOverlay = null;
	} finally {
		_famCamConfig = null;
		unloadCSS(CSS_ID);
	}
}

// Initialize FamCam with config from Action Bar
export function initFamCam(config) {
	_famCamConfig = config;
}

// Update runtime config
export function updateFamCamConfig(newConfig) {
	_famCamConfig = newConfig;
	updateFlashVisuals();
}

/* --- FLASH FEATURES --- */

function createFlashOverlay() {
	if (document.getElementById("famcam-flash-overlay")) return;

	_flashOverlay = document.createElement("div");
	_flashOverlay.id = "famcam-flash-overlay";
	// Inline fallback styling so flash works even before famcam.css loads
	_flashOverlay.style.position = "fixed";
	_flashOverlay.style.inset = "0";
	_flashOverlay.style.pointerEvents = "none";
	_flashOverlay.style.backgroundColor = "rgba(0,0,0,1)";
	_flashOverlay.style.opacity = "0";
	_flashOverlay.style.transition = "opacity var(--transition-normal)";
	_flashOverlay.style.zIndex = "var(--z-famcam)";

	const source = document.createElement("div");
	source.id = "famcam-flash-source";
	// Inline fallback positioning; updateFlashVisuals will specialize per type
	source.style.position = "fixed";
	source.style.inset = "0";
	source.style.pointerEvents = "none";
	source.style.zIndex = "var(--z-famcam)";

	// Add inner container for ring masking/control
	const inner = document.createElement("div");
	inner.className = "flash-inner";
	source.appendChild(inner);

	_flashOverlay.appendChild(source);

	document.body.appendChild(_flashOverlay);
	updateFlashVisuals();
}

function updateFlashVisuals() {
	if (!_famCamConfig) return;

	// Get overlay from DOM if reference is lost
	if (!_flashOverlay) {
		_flashOverlay = document.getElementById("famcam-flash-overlay");
	}
	if (!_flashOverlay) return;

	const source = _flashOverlay.querySelector("#famcam-flash-source");
	if (!source) return;

	let inner = source.querySelector(".flash-inner");
	if (!inner) {
		inner = document.createElement("div");
		inner.className = "flash-inner";
		source.appendChild(inner);
	}

	const cfg = _famCamConfig.flash;
	if (!cfg) return;

	// Reset styles
	source.className = "";
	source.style.cssText = "";
	source.classList.add(`flash-${cfg.type}`);

	inner.style.cssText = ""; // Reset inner styles

	// Determine color
	let color = cfg.customColor || "#ffffff";
	if (cfg.tone === "warm") color = "#ffb74d";
	if (cfg.tone === "cool") color = "#40c4ff";
	if (cfg.tone === "neutral") color = "#f5f5f5";

	// Width logic: user requests dis-2 for width 1, dis-4 for width 2, etc.
	// Formula: dis-{val * 2}
	const borderVal = cfg.borderWidth || 2;
	const disVar = `var(--dis-${borderVal * 2})`;

	const brightness = Math.max(5, cfg.brightness ?? 100);
	const opacity = brightness / 100;

	// Common base styles
	source.style.position = "fixed";
	source.style.pointerEvents = "none";
	source.style.zIndex = "var(--z-famcam)";
	source.style.opacity = opacity;
	source.style.display = "flex";
	source.style.alignItems = "center";
	source.style.justifyContent = "center";

	if (cfg.type === "fullscreen") {
		source.style.inset = "var(--dis-8)";
		// Fullscreen: Solid block, inner ignored (or full size?)
		source.style.backgroundColor = color;
		source.style.borderRadius = `var(--dis-${borderVal})`; // Dynamic radius or fixed? User said "adjust circle and border radius"
		// source.style.borderRadius = "var(--dis-4)"; // Default for screen corners?

		// Outer glow
		source.style.boxShadow = `0 0 ${brightness}px ${color}`;

		// Inner: just hide or make transparent?
		inner.style.display = "none";
	} else if (cfg.type === "ring-wide") {
		source.style.inset = "var(--dis-8)";
		// Ring Wide (Rectangular) - "Better Solution" Logic with 0.5 Multiplier
		// Outer Radius: Fixed (width-8 * 0.5)
		// Thickness (Subtract): (width-(Scale * 2) * 0.5)
		// Inner Radius: (width-(8 - Scale) * 0.5)

		source.style.backgroundColor = color;
		source.style.borderRadius = "calc(var(--width-9) * 0.5)";
		source.style.boxShadow = `0 0 ${brightness}px ${color}`; // Outer glow

		// Inner: The "Hole"
		const subtractIndex = borderVal * 2;
		const widthVar = `var(--width-${subtractIndex})`;
		inner.style.width = `calc(100% - (${widthVar} * 0.5))`;
		inner.style.height = `calc(100% - (${widthVar} * 0.5))`;
		inner.style.backgroundColor = "#000"; // Black hole

		// Inner radius
		const innerRadiusIndex = 9 - borderVal;
		if (innerRadiusIndex > 0) {
			inner.style.borderRadius = `calc(var(--width-${innerRadiusIndex}) * 0.5)`;
		} else {
			inner.style.borderRadius = "0px";
		}

		// Inset shadow on inner div (inner glow of the ring)
		inner.style.boxShadow = `inset 0 0 ${brightness / 2}px ${color}`;
	} else {
		// Ring Circle
		source.style.top = "50%";
		source.style.left = "50%";
		source.style.transform = "translate(-50%, -50%)";
		source.style.width = "calc(100vmin - (2 * var(--dis-8)))";
		source.style.height = "calc(100vmin - (2 * var(--dis-8)))";
		// Ring Circle
		source.style.backgroundColor = color;
		source.style.borderRadius = "50%";
		source.style.boxShadow = `0 0 ${brightness}px ${color}`;

		// Inner: The "Hole"
		const subtractIndex = borderVal * 2;
		const widthVar = `var(--width-${subtractIndex})`;
		inner.style.width = `calc(100% - (${widthVar} * 0.5))`;
		inner.style.height = `calc(100% - (${widthVar} * 0.5))`;
		inner.style.borderRadius = "50%";
		inner.style.backgroundColor = "#000"; // Black hole

		// Inset shadow on inner div
		inner.style.boxShadow = `inset 0 0 ${brightness / 2}px ${color}`;
	}
}

export function toggleFlash(enable) {
	if (enable) {
		ensureFamCamCSS();
		if (!_flashOverlay) createFlashOverlay();
		updateFlashVisuals();
		if (_flashOverlay) {
			_flashOverlay.classList.add("active");
			// Inline fallback if CSS hasn't loaded yet
			_flashOverlay.style.opacity = "1";
		}
		return;
	}

	// Turning off: remove from DOM entirely (no idle overlay)
	try {
		if (!_flashOverlay) {
			_flashOverlay = document.getElementById("famcam-flash-overlay");
		}
		if (_flashOverlay) _flashOverlay.remove();
	} catch (e) {}
	_flashOverlay = null;
	unloadFamCamCSSIfUnused();
}

/* --- SNAP FEATURES --- */

export async function handleSnap() {
	if (!_famCamConfig) return;
	const action = _famCamConfig.snapAction;

	if (action === "camera") {
		await captureCamera();
	} else {
		// Capture Tab -> Watermark -> Download (Direct)
		await captureTabAndDownload();
	}
}

async function captureCamera() {
	try {
		_stream = await navigator.mediaDevices.getUserMedia({
			video: {
				facingMode: "user",
				width: { ideal: 1920 },
				height: { ideal: 1080 },
			},
			audio: false,
		});

		const video = document.createElement("video");
		video.srcObject = _stream;
		video.play();
		await new Promise((r) => (video.onloadedmetadata = r));

		const canvas = document.createElement("canvas");
		canvas.width = video.videoWidth;
		canvas.height = video.videoHeight;
		const ctx = canvas.getContext("2d");

		ctx.translate(canvas.width, 0);
		ctx.scale(-1, 1);
		ctx.drawImage(video, 0, 0);

		_stream.getTracks().forEach((t) => t.stop());
		_stream = null;

		canvas.toBlob((blob) => {
			createPreviewOverlay(blob);
		}, "image/png");
	} catch (err) {
		console.error("FamCam Error:", err);
		alert("Could not access camera. Please allow camera permissions.");
	}
}

async function captureTabAndDownload() {
	try {
		const dataUrl = await captureVisibleTabAsync();
		const finalUrl = await compositeWatermark(dataUrl, true);
		downloadDataUrl(finalUrl, `snap-screenshot-${Date.now()}.png`);
	} catch (e) {
		console.error(e);
		alert("Screenshot failed. Permission issue?");
	}
}

async function captureVisibleTabAsync(includePreview = false) {
	// Handle Video Wallpaper: manually rasterize to canvas for SnapDOM
	const wallpaper = document.getElementById("wallpaper");
	let canvasPlaceholder = null;
	let wasPlaying = false;

	if (wallpaper && wallpaper.tagName === "VIDEO") {
		try {
			wasPlaying = !wallpaper.paused;
			wallpaper.pause();

			const w = wallpaper.offsetWidth;
			const h = wallpaper.offsetHeight;
			const vw = wallpaper.videoWidth;
			const vh = wallpaper.videoHeight;

			// emulate object-fit: cover
			canvasPlaceholder = document.createElement("canvas");
			canvasPlaceholder.width = w;
			canvasPlaceholder.height = h;
			canvasPlaceholder.style.cssText =
				window.getComputedStyle(wallpaper).cssText;
			const ctx = canvasPlaceholder.getContext("2d");

			const r = w / h;
			const vr = vw / vh;

			let sx, sy, sw, sh;
			if (vr > r) {
				// Video is wider than container: crop sides
				sh = vh;
				sw = vh * r;
				sx = (vw - sw) / 2;
				sy = 0;
			} else {
				// Video is taller than container: crop top/bottom
				sw = vw;
				sh = vw / r;
				sx = 0;
				sy = (vh - sh) / 2;
			}

			ctx.drawImage(wallpaper, sx, sy, sw, sh, 0, 0, w, h);
			wallpaper.replaceWith(canvasPlaceholder);
		} catch (e) {
			console.warn("Wallpaper rasterization failed", e);
			// Fallback: leave video (might render black)
			if (canvasPlaceholder && canvasPlaceholder.parentNode) {
				canvasPlaceholder.replaceWith(wallpaper);
			}
			canvasPlaceholder = null;
		}
	}

	try {
		// Use snapdom for simpler, faster screenshot
		const img = await snapdom.toPng(document.body, {
			width: window.innerWidth,
			height: window.innerHeight,
			backgroundColor: null, // Transparent
			embedFonts: true, // Ensure fonts are rendered correctly
			filter: (el) => {
				// For regular screenshot (not SnapDesk), ignore the preview completely
				if (!includePreview && el.id === "famcam-preview") {
					return false;
				}
				// For SnapDesk, only hide the control buttons (overlay is visible)
				if (
					el.classList &&
					el.classList.contains("famcam-overlay-controls")
				) {
					return false;
				}
				// Hide the flash brightness slider container ONLY if it is hidden
				if (
					el.classList &&
					el.classList.contains("famcam-slider-container") &&
					el.classList.contains("is-hidden")
				) {
					return false;
				}
				return true;
			},
		});
		return img.src;
	} finally {
		// Restore Video
		if (canvasPlaceholder && wallpaper) {
			canvasPlaceholder.replaceWith(wallpaper);
			if (wasPlaying) wallpaper.play().catch(() => {});
		}
	}
}

/* --- PREVIEW OVERLAY --- */

async function createPreviewOverlay(blob) {
	if (_previewEl) _previewEl.remove();
	await ensureFamCamCSS();

	// Convert blob to base64 data URL (html2canvas cannot capture blob URLs)
	const url = await blobToDataUrl(blob);

	_previewEl = document.createElement("div");
	_previewEl.id = "famcam-preview";

	// Dedicated Drag Handle (visual only, pointer-events: none in CSS)
	const dragHandle = document.createElement("div");
	dragHandle.className = "famcam-drag-handle";
	const handleBar = document.createElement("div");
	handleBar.className = "famcam-drag-indicator";
	dragHandle.appendChild(handleBar);

	const img = document.createElement("img");
	img.src = url;
	img.id = "famcam-preview-img";

	// Overlay Controls
	const controls = document.createElement("div");
	controls.className = "famcam-overlay-controls";

	const btnDown = createBtn("download", "Download", () =>
		downloadDataUrl(url, `snap-cam-${Date.now()}.png`),
	);
	const btnDel = createBtn("trash", "Delete", () => {
		if (_previewEl && typeof interact !== "undefined") {
			interact(_previewEl).unset(); // Cleanup interact
		}
		if (_previewEl) _previewEl.remove();
		_previewEl = null;
		URL.revokeObjectURL(url);
		unloadFamCamCSSIfUnused();
	});
	const btnSnapDesk = createBtn("desktop", "SnapDesk", () =>
		handleSnapDesk(),
	);

	controls.appendChild(btnDown);
	controls.appendChild(btnDel);
	controls.appendChild(btnSnapDesk);

	// Set initial size using CSS variables for 16:9 aspect ratio
	// Get computed value of --dis-16 for width
	const styles = getComputedStyle(document.documentElement);
	const dis16 = parseFloat(styles.getPropertyValue("--dis-16")) || 320;
	const dis9 = parseFloat(styles.getPropertyValue("--dis-9")) || 180;
	const uiScale = parseFloat(styles.getPropertyValue("--ui-scale")) || 1;
	const initialW = dis16 * uiScale;
	const initialH = dis9 * uiScale;
	_previewEl.style.width = `${initialW}px`;
	_previewEl.style.height = `${initialH}px`;

	// Calculate center position for viewport
	const centerX = Math.max(0, (window.innerWidth - initialW) / 2);
	const centerY = Math.max(0, (window.innerHeight - initialH) / 2);

	// Set initial position via transform (not left/top)
	_previewEl.style.transform = `translate(${centerX}px, ${centerY}px)`;
	_previewEl.setAttribute("data-x", centerX);
	_previewEl.setAttribute("data-y", centerY);

	_previewEl.appendChild(dragHandle);
	_previewEl.appendChild(img);
	_previewEl.appendChild(controls);
	document.body.appendChild(_previewEl);

	// Setup Interact.js for drag and resize
	setupInteract(_previewEl);
}

function createBtn(iconName, title, onClick) {
	const btn = document.createElement("div");
	btn.className = "btn btn-icon"; // Standard classes
	btn.title = title;
	const icon = document.createElement("span");
	renderInlineIcon(icon, `assets/svgs-fontawesome/solid/${iconName}.svg`);
	btn.appendChild(icon);
	// Stop drag propagation
	btn.addEventListener("mousedown", (e) => e.stopPropagation());
	btn.addEventListener("click", onClick);
	return btn;
}

function setupInteract(el) {
	// Ensure interact is available
	if (typeof interact === "undefined") {
		console.error("[FamCam] interact.js not loaded");
		return;
	}

	// Double check element is in DOM or valid
	if (!el) {
		console.error("[FamCam] No element provided to setupInteract");
		return;
	}

	// Unset previous if any exists on this element (just in case re-init)
	interact(el).unset();

	interact(el)
		.draggable({
			inertia: true,
			autoScroll: false,

			listeners: {
				move(event) {
					const target = event.target;

					// Get current position from data attributes
					let x =
						(parseFloat(target.getAttribute("data-x")) || 0) +
						event.dx;
					let y =
						(parseFloat(target.getAttribute("data-y")) || 0) +
						event.dy;

					// Clamp to viewport
					const maxX = window.innerWidth - target.offsetWidth;
					const maxY = window.innerHeight - target.offsetHeight;
					x = Math.max(0, Math.min(x, maxX));
					y = Math.max(0, Math.min(y, maxY));

					// Apply transform
					target.style.transform = `translate(${x}px, ${y}px)`;

					// Store position
					target.setAttribute("data-x", x);
					target.setAttribute("data-y", y);
				},
			},
		})
		.resizable({
			// Resize from edges and corners, but only within 10px margin
			// This leaves the center area for dragging
			edges: { left: true, right: true, bottom: true, top: true },
			margin: 10, // Only 10px from edge triggers resize

			listeners: {
				move: function (event) {
					let x = parseFloat(event.target.dataset.x) || 0;
					let y = parseFloat(event.target.dataset.y) || 0;

					x += event.deltaRect.left;
					y += event.deltaRect.top;

					let newWidth = event.rect.width;
					let newHeight = event.rect.height;

					// Clamp position to viewport
					x = Math.max(0, Math.min(x, window.innerWidth - newWidth));
					y = Math.max(
						0,
						Math.min(y, window.innerHeight - newHeight),
					);

					// Clamp size to not exceed viewport from current position
					newWidth = Math.min(newWidth, window.innerWidth - x);
					newHeight = Math.min(newHeight, window.innerHeight - y);

					Object.assign(event.target.style, {
						width: `${newWidth}px`,
						height: `${newHeight}px`,
						transform: `translate(${x}px, ${y}px)`,
					});

					Object.assign(event.target.dataset, { x, y });
				},
			},
			modifiers: [
				// Keep edges inside viewport
				interact.modifiers.restrictEdges({
					outer: () => ({
						left: 0,
						top: 0,
						right: window.innerWidth,
						bottom: window.innerHeight,
					}),
				}),
				// Minimum size
				interact.modifiers.restrictSize({
					min: { width: 200, height: 150 },
					max: {
						width: window.innerWidth * 0.9,
						height: window.innerHeight * 0.9,
					},
				}),
			],
			inertia: true,
		});
}

/* --- SNAPDESK & COMPOSITING --- */

async function handleSnapDesk() {
	if (!_previewEl) return;

	// Get preview position and size BEFORE hiding
	const previewImg = _previewEl.querySelector("#famcam-preview-img");
	if (!previewImg) return;

	const previewX = parseFloat(_previewEl.getAttribute("data-x")) || 0;
	const previewY = parseFloat(_previewEl.getAttribute("data-y")) || 0;
	const previewW = _previewEl.offsetWidth;
	const previewH = _previewEl.offsetHeight;
	const previewSrc = previewImg.src; // This is now a data URL

	// HIDE the preview completely so html2canvas ignores it
	_previewEl.style.display = "none";

	await new Promise((r) => setTimeout(r, 100)); // buffer

	try {
		// Capture page WITHOUT preview
		const pageDataUrl = await captureVisibleTabAsync(false);

		// Restore preview
		_previewEl.style.display = "flex";

		// Manually composite: page + preview image + watermark footer
		const finalUrl = await compositeSnapDesk(
			pageDataUrl,
			previewSrc,
			previewX,
			previewY,
			previewW,
			previewH,
		);
		downloadDataUrl(finalUrl, `snap-desk-${Date.now()}.png`);
	} catch (e) {
		console.error(e);
		_previewEl.style.display = "flex";
	}
}

async function compositeSnapDesk(
	pageDataUrl,
	previewSrc,
	previewX,
	previewY,
	previewW,
	previewH,
) {
	return new Promise((resolve, reject) => {
		const pageImg = new Image();
		const camImg = new Image();
		const iconImg = new Image();

		let loaded = 0;
		const onLoad = () => {
			loaded++;
			if (loaded < 3) return;

			// Get theme colors from CSS variables
			const styles = getComputedStyle(document.documentElement);
			const bgColor =
				styles.getPropertyValue("--color-base").trim() || "#1a1a1a";
			const textColor =
				styles.getPropertyValue("--text-base").trim() || "#ffffff";

			const footerHeight = 60;
			const canvas = document.createElement("canvas");
			canvas.width = pageImg.width;
			canvas.height = pageImg.height + footerHeight;
			const ctx = canvas.getContext("2d");

			// Draw page screenshot
			ctx.drawImage(pageImg, 0, 0);

			// Draw camera preview with object-fit:cover style (maintain aspect ratio, crop to fit)
			const scale = window.devicePixelRatio || 1;
			const destX = previewX * scale;
			const destY = previewY * scale;
			const destW = previewW * scale;
			const destH = previewH * scale;

			// Calculate cover dimensions (like CSS object-fit: cover)
			const imgRatio = camImg.width / camImg.height;
			const destRatio = destW / destH;
			let srcX = 0,
				srcY = 0,
				srcW = camImg.width,
				srcH = camImg.height;

			if (imgRatio > destRatio) {
				// Image is wider - crop horizontally
				srcW = camImg.height * destRatio;
				srcX = (camImg.width - srcW) / 2;
			} else {
				// Image is taller - crop vertically
				srcH = camImg.width / destRatio;
				srcY = (camImg.height - srcH) / 2;
			}

			ctx.drawImage(
				camImg,
				srcX,
				srcY,
				srcW,
				srcH,
				destX,
				destY,
				destW,
				destH,
			);

			// Draw footer
			addWatermarkFooter(
				ctx,
				pageImg.width,
				pageImg.height,
				footerHeight,
				bgColor,
				textColor,
				iconImg,
			);

			resolve(canvas.toDataURL("image/png"));
		};

		pageImg.onload = onLoad;
		camImg.onload = onLoad;
		iconImg.onload = onLoad;

		pageImg.onerror = reject;
		camImg.onerror = reject;
		iconImg.onerror = () => {
			// Icon load failed, continue without it
			iconImg.src = ""; // Clear src
			onLoad();
		};

		pageImg.src = pageDataUrl;
		camImg.src = previewSrc;
		iconImg.src = "icons/icon48.png";
	});
}

async function compositeWatermark(sourceDataUrl, addFooter) {
	return new Promise((resolve) => {
		const img = new Image();
		const iconImg = new Image();
		let loaded = 0;
		const total = addFooter ? 2 : 1;

		const onAllLoaded = () => {
			loaded++;
			if (loaded < total) return;

			const footerHeight = addFooter ? 60 : 0;
			const canvas = document.createElement("canvas");
			canvas.width = img.width;
			canvas.height = img.height + footerHeight;
			const ctx = canvas.getContext("2d");

			// Draw the screenshot
			ctx.drawImage(img, 0, 0);

			// Add footer strip if needed
			if (addFooter) {
				const styles = getComputedStyle(document.documentElement);
				const bgColor =
					styles.getPropertyValue("--color-base").trim() || "#1a1a1a";
				const textColor =
					styles.getPropertyValue("--text-base").trim() || "#ffffff";
				addWatermarkFooter(
					ctx,
					img.width,
					img.height,
					footerHeight,
					bgColor,
					textColor,
					iconImg,
				);
			}

			resolve(canvas.toDataURL("image/png"));
		};

		img.onload = onAllLoaded;
		img.onerror = () => resolve(sourceDataUrl); // Fallback

		if (addFooter) {
			iconImg.onload = onAllLoaded;
			iconImg.onerror = () => {
				// If icon fails, just mark as loaded (pass empty/broken img)
				onAllLoaded();
			};
			iconImg.src = "icons/icon48.png";
		}

		img.src = sourceDataUrl;
	});
}

function addWatermarkFooter(
	ctx,
	imgWidth,
	imgHeight,
	footerHeight,
	bgColor,
	textColor,
	iconImg,
) {
	const footerY = imgHeight;

	// Draw footer background using theme color
	ctx.fillStyle = bgColor;
	ctx.fillRect(0, footerY, imgWidth, footerHeight);

	// Icon
	const iconSize = 36;
	const iconX = 16;
	const iconY = footerY + (footerHeight - iconSize) / 2;

	if (iconImg && iconImg.src && iconImg.width > 0) {
		ctx.drawImage(iconImg, iconX, iconY, iconSize, iconSize);
	} else {
		// Fallback: blue circle
		ctx.beginPath();
		ctx.arc(
			iconX + iconSize / 2,
			footerY + footerHeight / 2,
			iconSize / 2 - 2,
			0,
			Math.PI * 2,
		);
		ctx.fillStyle = "#0072ff";
		ctx.fill();
	}

	// Title text (using theme text color)
	const textX = iconX + iconSize + 12;
	ctx.fillStyle = textColor;
	ctx.font = '600 18px "Outfit", "Segoe UI", sans-serif';
	ctx.fillText("Themes+ New Tab", textX, footerY + 28);

	// Subtitle (dimensions) - slightly transparent
	ctx.globalAlpha = 0.6;
	ctx.font = '400 14px "Outfit", "Segoe UI", sans-serif';
	ctx.fillText(`${imgWidth}×${imgHeight}`, textX, footerY + 48);
	ctx.globalAlpha = 1;

	// Right side - timestamp
	const now = new Date();
	const timeStr = now.toLocaleTimeString([], {
		hour: "2-digit",
		minute: "2-digit",
	});
	const dateStr = now.toLocaleDateString([], {
		month: "short",
		day: "numeric",
		year: "numeric",
	});

	ctx.textAlign = "right";
	ctx.fillStyle = textColor;
	ctx.globalAlpha = 0.8;
	ctx.font = '500 16px "Outfit", "Segoe UI", sans-serif';
	ctx.fillText(timeStr, imgWidth - 20, footerY + 28);

	ctx.globalAlpha = 0.5;
	ctx.font = '400 13px "Outfit", "Segoe UI", sans-serif';
	ctx.fillText(dateStr, imgWidth - 20, footerY + 46);

	ctx.globalAlpha = 1;
	ctx.textAlign = "left";
}

function roundRect(ctx, x, y, w, h, r) {
	if (w < 2 * r) r = w / 2;
	if (h < 2 * r) r = h / 2;
	ctx.beginPath();
	ctx.moveTo(x + r, y);
	ctx.arcTo(x + w, y, x + w, y + h, r);
	ctx.arcTo(x + w, y + h, x, y + h, r);
	ctx.arcTo(x, y + h, x, y, r);
	ctx.arcTo(x, y, x + w, y, r);
	ctx.closePath();
}

function downloadDataUrl(url, filename) {
	const a = document.createElement("a");
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
}

function blobToDataUrl(blob) {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onloadend = () => resolve(reader.result);
		reader.onerror = reject;
		reader.readAsDataURL(blob);
	});
}
