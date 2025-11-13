// Step 1: Check the configuration setting for new tab page before rendering any content
// The the config is stored in the browser.storage.local api as "config"

const app = chrome || browser; // Support both Chrome and Firefox

const DEFAULT_CONFIG = {
	wallpaper: {
		wallpaper_type: "static", // static or video
		wallpaper_mode: "random", // random, sequence, or specific
		wallpaper_specific: null, // specific wallpaper id if mode is specific
		last_wallpaper_id: null, // last displayed wallpaper id
	},
};

app.storage.local.get("config").then((data) => {
	const config = data.config || DEFAULT_CONFIG;
	console.log(config);
    renderWallpaper(config.wallpaper);
});

function renderWallpaper(wallpaperConfig) {
    // Logic to render wallpaper based on wallpaperConfig
    console.log("Rendering wallpaper with config:", wallpaperConfig);
}