/**
 * Simple Rain Effect using HTML5 Canvas
 */

let canvas = null;
let ctx = null;
let animationId = null;
let raindrops = [];
const CANVAS_ID = "rain-overlay";

// Rain Configuration
const CFG = {
	count: 150, // Number of drops
	speed: 15, // Falling speed
	length: 20, // Length of drop
	color: "#ffffff", // Drop color (hex)
	opacity: 20, // Drop opacity in percent
	splashBounce: true,
};

function clamp(value, min, max, fallback) {
	const number = Number(value);
	if (!Number.isFinite(number)) return fallback;
	return Math.min(max, Math.max(min, number));
}

function dropColor() {
	const hex = String(CFG.color || "#ffffff")
		.replace("#", "")
		.slice(0, 6);
	const r = parseInt(hex.slice(0, 2), 16);
	const g = parseInt(hex.slice(2, 4), 16);
	const b = parseInt(hex.slice(4, 6), 16);
	const alpha = clamp(CFG.opacity, 0, 100, 20) / 100;
	return `rgba(${Number.isFinite(r) ? r : 255}, ${
		Number.isFinite(g) ? g : 255
	}, ${Number.isFinite(b) ? b : 255}, ${alpha})`;
}

class Drop {
	constructor() {
		this.reset();
		// Randomize initial Y so they don't all start at top
		this.y = Math.random() * window.innerHeight;
	}

	reset() {
		this.x = Math.random() * window.innerWidth;
		this.y = -CFG.length;
		this.vy = Math.random() * 5 + CFG.speed; // Varying speed
		this.len = Math.random() * 10 + CFG.length;
	}

	update() {
		this.y += this.vy;
		if (this.y > window.innerHeight) {
			this.reset();
		}
	}

	draw() {
		ctx.lineWidth = 1;
		ctx.lineCap = "round";
		ctx.strokeStyle = dropColor();
		ctx.beginPath();
		ctx.moveTo(this.x, this.y);
		ctx.lineTo(this.x, this.y + this.len);
		ctx.stroke();
	}
}

function init() {
	if (document.getElementById(CANVAS_ID)) return;

	canvas = document.createElement("canvas");
	canvas.id = CANVAS_ID;
	canvas.style.position = "fixed";
	canvas.style.top = "0";
	canvas.style.left = "0";
	canvas.style.width = "100%";
	canvas.style.height = "100%";
	canvas.style.pointerEvents = "none";
	canvas.style.zIndex = "0"; // Above wallpaper (-1), below widgets (9)

	document.body.appendChild(canvas);
	ctx = canvas.getContext("2d");

	resize();
	window.addEventListener("resize", resize);

	// Create drops
	raindrops = [];
	for (let i = 0; i < CFG.count; i++) {
		raindrops.push(new Drop());
	}
}

function resize() {
	if (!canvas) return;
	canvas.width = window.innerWidth;
	canvas.height = window.innerHeight;
}

function animate() {
	if (!ctx) return;
	ctx.clearRect(0, 0, canvas.width, canvas.height);

	raindrops.forEach((drop) => {
		drop.update();
		drop.draw();
	});

	animationId = requestAnimationFrame(animate);
}

export function updateRainConfig(config = {}) {
	if (!config || typeof config !== "object") return;
	if (config.count != null) CFG.count = clamp(config.count, 10, 600, CFG.count);
	if (config.speed != null) CFG.speed = clamp(config.speed, 1, 60, CFG.speed);
	if (config.length != null)
		CFG.length = clamp(config.length, 2, 100, CFG.length);
	if (typeof config.color === "string" && config.color)
		CFG.color = config.color;
	if (config.opacity != null)
		CFG.opacity = clamp(config.opacity, 0, 100, CFG.opacity);

	// Rebuild drops so count/speed/length changes take effect immediately.
	if (!canvas) return;
	raindrops = [];
	for (let i = 0; i < CFG.count; i++) {
		raindrops.push(new Drop());
	}
	if (animationId) {
		cancelAnimationFrame(animationId);
		animationId = null;
	}
	if (canvas.style.display !== "none") animate();
}

export function toggleRain(enable, config = null) {
	if (config) updateRainConfig(config);
	if (
		enable &&
		window.matchMedia &&
		window.matchMedia("(prefers-reduced-motion: reduce)").matches
	) {
		return;
	}
	if (enable) {
		init();
		// Ensure it's visible
		canvas.style.display = "block";
		// Ensure Z-Index (after checking base.css, assuming wallpaper is lowest)
		// We want it on top of wallpaper.
		// If wallpaper is image element, this canvas appended after it will be on top if z-indices are same.

		if (!animationId) animate();
	} else {
		if (canvas) {
			canvas.style.display = "none";
		}
		if (animationId) {
			cancelAnimationFrame(animationId);
			animationId = null;
		}
		window.removeEventListener("resize", resize);
	}
}
