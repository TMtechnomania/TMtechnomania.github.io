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
	color: "rgba(255, 255, 255, 0.2)", // Color
	splashBounce: true,
};

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
		ctx.strokeStyle = CFG.color;
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

export function toggleRain(enable) {
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
	}
}
