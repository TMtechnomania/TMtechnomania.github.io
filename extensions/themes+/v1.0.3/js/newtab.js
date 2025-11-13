// Step 1: Check the configuration setting for new tab page before rendering any content
// The the config is stored in the browser.storage.local api as "config"

const app = chrome || browser; // Support both Chrome and Firefox

const DEFAULT_CONFIG = {
	wallpaper: {
		wallpaper_type: "video", // img or video
		wallpaper_mode: "random", // random, sequence, or specific
		wallpaper_specific: null, // specific wallpaper id if mode is specific
		last_wallpaper_id: null, // last displayed wallpaper id
	},
};

const WALLPAPERS = {
	img: [{ id: 1, url: "image.jpg" }],
	video: [{ id: 1, url: "video.mp4" }],
};

app.storage.local.get("config").then((data) => {
	const config = data.config || DEFAULT_CONFIG;
	console.log(config);
	renderWallpaper(config.wallpaper);
});

function renderWallpaper(wallpaperConfig) {
	// Logic to render wallpaper based on wallpaperConfig
	console.log("Rendering wallpaper with config:", wallpaperConfig);
	let wallpaperURL = `assets/${wallpaperConfig.wallpaper_type}`;
	let wallpaperElement = document.createElement(
		`${wallpaperConfig.wallpaper_type}`,
	);
	if (wallpaperConfig.wallpaper_mode === "random") {
		const randomId =
			Math.floor(
				Math.random() *
					WALLPAPERS[wallpaperConfig.wallpaper_type].length,
			) + 1;
		wallpaperURL += `/wallpaper_${randomId}`;
	} else if (
		wallpaperConfig.wallpaper_mode === "sequence" &&
		wallpaperConfig.last_wallpaper_id
	) {
		let nextId = wallpaperConfig.last_wallpaper_id + 1;
		if (nextId > WALLPAPERS[wallpaperConfig.wallpaper_type].length) {
			nextId = 1; // Loop back to first wallpaper
		}
		wallpaperURL += `/wallpaper_${nextId}`;
	} else if (
		wallpaperConfig.wallpaper_mode === "specific" &&
		wallpaperConfig.wallpaper_specific
	) {
		wallpaperURL += `/wallpaper_${wallpaperConfig.wallpaper_specific}`;
	}
	wallpaperURL += wallpaperConfig.wallpaper_type === "img" ? ".jpg" : ".mp4";
	wallpaperElement.src = wallpaperURL;
	wallpaperElement.id = "wallpaper";
	// set attributes for video like autoplay, loop, muted
	if (wallpaperConfig.wallpaper_type === "video") {
		wallpaperElement.autoplay = true;
		wallpaperElement.loop = true;
		wallpaperElement.muted = true;
	}
	document.body.appendChild(wallpaperElement);
}
