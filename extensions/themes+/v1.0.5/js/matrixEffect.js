/**
 * Matrix Rain Effect using HTML5 Canvas
 */

let canvas = null;
let ctx = null;
let animationId = null;
let columns = [];
const CANVAS_ID = "matrix-overlay";

// Default Configuration
let CFG = {
	color: "#00ff00",
	speed: 50, // lower is faster (interval ms)
	fontSize: 16,
};

const CHARACTERS =
	"ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ";

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
	canvas.style.zIndex = "-1"; // Background level
	canvas.style.backgroundColor = "black"; // Matrix needs black background

	document.body.appendChild(canvas);
	ctx = canvas.getContext("2d");

	resize();
	window.addEventListener("resize", resize);

	// Initialize columns
	initColumns();
}

function initColumns() {
	if (!canvas) return;
	const columnCount = Math.floor(canvas.width / CFG.fontSize);
	columns = Array(columnCount).fill(0);
	// Randomize start Y to avoid "curtain" effect
	columns = columns.map(() => Math.floor(Math.random() * -50));
}

function resize() {
	if (!canvas) return;
	canvas.width = window.innerWidth;
	canvas.height = window.innerHeight;
	initColumns();
}

let lastTime = 0;
let timer = 0;

function animate(timeStamp) {
	if (!ctx) return;

	const deltaTime = timeStamp - lastTime;
	lastTime = timeStamp;

	// Control speed via timer accumulation
	if (timer > CFG.speed) {
		// Semi-transparent black rect to create fade effect
		ctx.fillStyle = "rgba(0, 0, 0, 0.05)";
		ctx.fillRect(0, 0, canvas.width, canvas.height);

		ctx.fillStyle = CFG.color;
		ctx.font = `${CFG.fontSize}px monospace`;

		for (let i = 0; i < columns.length; i++) {
			const text = CHARACTERS.charAt(
				Math.floor(Math.random() * CHARACTERS.length),
			);
			const x = i * CFG.fontSize;
			const y = columns[i] * CFG.fontSize;

			ctx.fillText(text, x, y);

			// Reset column if it goes off screen (randomly)
			if (y > canvas.height && Math.random() > 0.975) {
				columns[i] = 0;
			}
			columns[i]++;
		}
		timer = 0;
	} else {
		timer += deltaTime;
	}

	animationId = requestAnimationFrame(animate);
}

export function startMatrix(config) {
	console.log("Starting Matrix Effect", config);
	if (config) {
		CFG = { ...CFG, ...config };
	}

	init();

	// Ensure visible
	if (canvas) {
		canvas.style.display = "block";
		// Force black background on body to ensure contrast if canvas is transparent-ish,
		// but canvas itself is black.
	}

	if (!animationId) {
		lastTime = performance.now();
		animate(lastTime);
	}
}

export function stopMatrix() {
	if (canvas) {
		canvas.remove(); // Completely remove element to clear state
		canvas = null;
		ctx = null;
	}
	if (animationId) {
		cancelAnimationFrame(animationId);
		animationId = null;
	}
	window.removeEventListener("resize", resize);
}
