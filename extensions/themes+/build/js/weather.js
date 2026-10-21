// Zero-config weather (Open-Meteo, no API key).
//
// Location resolution order:
//   1. Coordinates the user explicitly chose ("Use my location") — cached.
//   2. A city typed in Settings — geocoded once and cached.
//   3. The browser timezone, turned into a city name and geocoded once — this
//      is what makes weather work on a fresh install with no setup at all.
//   4. As a last resort, and only after an explicit user action, the browser
//      geolocation prompt.
//
// The new-tab startup path never prompts for location. Forecasts are cached in
// chrome.storage.local for 15 minutes and shared across new-tab pages.

import { fetchJson, getStorageLocal, setStorageLocal } from "./api.js";

const PLACE_KEY = "weatherPlace";
const CACHE_KEY = "weatherData";
const CACHE_TTL_MS = 15 * 60 * 1000;
const GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";

// Timezone ids whose last path segment is not a geocodable city name.
const TIMEZONE_CITY = {
	"Asia/Calcutta": "Kolkata",
	"Asia/Kolkata": "Kolkata",
	"Asia/Saigon": "Ho Chi Minh City",
	"Asia/Ho_Chi_Minh": "Ho Chi Minh City",
	"Asia/Rangoon": "Yangon",
	"Asia/Yangon": "Yangon",
	"Asia/Katmandu": "Kathmandu",
	"Asia/Kathmandu": "Kathmandu",
	"America/Godthab": "Nuuk",
	"America/Nuuk": "Nuuk",
	"Atlantic/Faroe": "Tórshavn",
	"Atlantic/Faeroe": "Tórshavn",
	"Indian/Maldives": "Malé",
	"Indian/Mauritius": "Port Louis",
	"Indian/Reunion": "Saint-Denis",
	"Indian/Seychelles": "Victoria",
	"Indian/Comoro": "Moroni",
	"Indian/Mayotte": "Mamoudzou",
	"Indian/Chagos": "Diego Garcia",
	"Indian/Christmas": "Flying Fish Cove",
	"Indian/Cocos": "West Island",
	"Pacific/Easter": "Hanga Roa",
	"Pacific/Norfolk": "Kingston",
	"Pacific/Pitcairn": "Adamstown",
	"Pacific/Niue": "Alofi",
	"Pacific/Tahiti": "Papeete",
	"Pacific/Marquesas": "Taiohae",
	"Pacific/Gambier": "Rikitea",
	"Pacific/Wallis": "Mata-Utu",
	"Pacific/Tongatapu": "Nuku'alofa",
	"Pacific/Guam": "Hagåtña",
	"Pacific/Palau": "Ngerulmud",
	"Pacific/Chuuk": "Weno",
	"Pacific/Pohnpei": "Palikir",
	"Pacific/Kosrae": "Tofol",
	"Pacific/Nauru": "Yaren",
	"Europe/Isle_of_Man": "Douglas",
	"Europe/Guernsey": "St. Peter Port",
	"Europe/Jersey": "St. Helier",
	"America/North_Dakota/New_Salem": "Bismarck",
	"America/North_Dakota/Beulah": "Bismarck",
	"America/North_Dakota/Center": "Bismarck",
};

function icon(name) {
	return `assets/svgs-fontawesome/solid/${name}.svg`;
}

/** WMO weather code → bundled Font Awesome icon path. */
export function getWmoIcon(code, isDay = true) {
	const c = Number(code);
	if (c === 0) return icon(isDay ? "sun" : "moon");
	if (c === 1 || c === 2)
		return icon(isDay ? "cloud-sun" : "cloud-moon");
	if (c === 3) return icon("cloud");
	if (c === 45 || c === 48) return icon("smog");
	if (c >= 51 && c <= 57) return icon("cloud-rain");
	if ((c >= 61 && c <= 67) || (c >= 80 && c <= 82))
		return icon("cloud-showers-heavy");
	if (c >= 71 && c <= 77) return icon("snowflake");
	if (c === 85 || c === 86) return icon("snowflake");
	if (c >= 95) return icon("cloud-bolt");
	return icon("cloud");
}

/** Human-readable place label ("Mumbai, India"). */
export function getPlaceLabel(place) {
	if (!place) return "";
	return [place.name, place.country].filter(Boolean).join(", ");
}

function currentTimezone() {
	try {
		return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
	} catch (e) {
		return "UTC";
	}
}

function isCoord(value) {
	return (
		value != null &&
		value.lat != null &&
		value.lon != null &&
		Number.isFinite(Number(value.lat)) &&
		Number.isFinite(Number(value.lon))
	);
}

function normalizePlace(hit, extra = {}) {
	const lat = Number(hit?.latitude ?? hit?.lat);
	const lon = Number(hit?.longitude ?? hit?.lon);
	if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
	return {
		lat,
		lon,
		name: hit.name || extra.name || "My location",
		country: hit.country || extra.country || "",
		admin1: hit.admin1 || "",
		timezone: hit.timezone || "",
		...extra,
	};
}

async function geocodeCity(name) {
	// Open-Meteo matches on a plain place name; tolerate "London,UK" style
	// input by dropping the country suffix.
	const query = String(name || "").split(",")[0].trim();
	if (!query) return null;
	try {
		const url = new URL(GEOCODE_URL);
		url.searchParams.set("name", query);
		url.searchParams.set("count", "1");
		url.searchParams.set("language", "en");
		url.searchParams.set("format", "json");
		const json = await fetchJson(url.href, 8000);
		const hit = Array.isArray(json?.results) ? json.results[0] : null;
		if (!hit) return null;
		return normalizePlace(hit);
	} catch (e) {
		return null;
	}
}

function timezoneCityName(timezone) {
	if (!timezone || timezone === "UTC" || timezone.startsWith("Etc/")) {
		return null;
	}
	if (TIMEZONE_CITY[timezone]) return TIMEZONE_CITY[timezone];
	const parts = timezone.split("/");
	const last = parts[parts.length - 1].replace(/_/g, " ").trim();
	return last || null;
}

async function resolveTimezonePlace(timezone) {
	const name = timezoneCityName(timezone);
	if (!name) return null;
	const place = await geocodeCity(name);
	if (!place) return null;
	return { ...place, timezone: place.timezone || timezone };
}

/** Ask the browser for precise coordinates. Only call from a user action. */
export function requestGeolocation() {
	return new Promise((resolve) => {
		if (!navigator.geolocation) return resolve(null);
		navigator.geolocation.getCurrentPosition(
			async (pos) => {
				const place = {
					lat: pos.coords.latitude,
					lon: pos.coords.longitude,
					name: "My location",
					country: "",
					source: "geolocation",
					timestamp: Date.now(),
				};
				try {
					await setStorageLocal({ [PLACE_KEY]: place });
				} catch (e) {}
				resolve(place);
			},
			() => resolve(null),
			{ maximumAge: 300000, timeout: 10000 },
		);
	});
}

async function resolvePlace(cfg = {}, { userInitiated = false } = {}) {
	const city = String(cfg.city || "").trim();
	let place = await getStorageLocal(PLACE_KEY);

	// Migrate the legacy geolocation cache used by older builds.
	if (!place) {
		const legacy = await getStorageLocal("weatherGeo");
		if (isCoord(legacy)) {
			place = {
				lat: Number(legacy.lat),
				lon: Number(legacy.lon),
				name: legacy.name || "My location",
				country: legacy.country || "",
				source: "geolocation",
			};
			try {
				await setStorageLocal({ [PLACE_KEY]: place });
			} catch (e) {}
		}
	}

	// A typed city always wins; geocode once and cache the result.
	if (city) {
		if (place?.source === "city" && place.query === city) return place;
		const found = await geocodeCity(city);
		if (found) {
			const next = { ...found, query: city, source: "city" };
			try {
				await setStorageLocal({ [PLACE_KEY]: next });
			} catch (e) {}
			return next;
		}
		// Geocoding failed: keep a previously saved explicit place rather than
		// breaking weather entirely.
		if (place && place.source !== "timezone") return place;
		return null;
	}

	// No city typed: keep an explicit user choice.
	if (place?.source === "geolocation") return place;
	if (place?.source === "city") {
		// The city field was cleared — go back to automatic detection.
		try {
			await setStorageLocal({ [PLACE_KEY]: null });
		} catch (e) {}
		place = null;
	}

	const timezone = currentTimezone();
	if (place?.source === "timezone" && place.timezone === timezone) {
		return place;
	}

	const auto = await resolveTimezonePlace(timezone);
	if (auto) {
		const next = { ...auto, source: "timezone", timezone };
		try {
			await setStorageLocal({ [PLACE_KEY]: next });
		} catch (e) {}
		return next;
	}

	// Last resort, and only when the user explicitly asked for a refresh.
	if (userInitiated) {
		const geo = await requestGeolocation();
		if (geo) return geo;
	}

	return place || null;
}

async function fetchForecast(place, units) {
	try {
		const url = new URL(FORECAST_URL);
		url.searchParams.set("latitude", String(place.lat));
		url.searchParams.set("longitude", String(place.lon));
		url.searchParams.set(
			"current",
			"temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,is_day,wind_speed_10m",
		);
		url.searchParams.set("timezone", "auto");
		url.searchParams.set("forecast_days", "1");
		if (units === "imperial") {
			url.searchParams.set("temperature_unit", "fahrenheit");
			url.searchParams.set("wind_speed_unit", "mph");
		} else {
			url.searchParams.set("wind_speed_unit", "ms");
		}

		const json = await fetchJson(url.href, 12000);
		const c = json?.current;
		if (!c || typeof c.temperature_2m !== "number") return null;

		return {
			temp: c.temperature_2m,
			feelsLike:
				typeof c.apparent_temperature === "number" ?
					c.apparent_temperature
				:	null,
			humidity:
				typeof c.relative_humidity_2m === "number" ?
					c.relative_humidity_2m
				:	null,
			wind:
				typeof c.wind_speed_10m === "number" ?
					c.wind_speed_10m
				:	null,
			code: Number(c.weather_code) || 0,
			isDay: c.is_day === 1,
			observedAt: c.time || null,
		};
	} catch (e) {
		return null;
	}
}

function isFreshCache(cache, units, place) {
	if (!cache || cache.provider !== "open-meteo") return false;
	if (cache.units !== units) return false;
	if (!cache.data || typeof cache.data.temp !== "number") return false;
	if (!isCoord(cache.place) || !isCoord(place)) return false;
	if (Date.now() - Number(cache.timestamp || 0) > CACHE_TTL_MS) return false;
	return (
		Math.abs(Number(cache.place.lat) - Number(place.lat)) < 0.01 &&
		Math.abs(Number(cache.place.lon) - Number(place.lon)) < 0.01
	);
}

/**
 * Resolve the location and return current conditions.
 * @returns {Promise<{ok: true, data: object, place: object, cached: boolean} | {ok: false, error: string}>}
 */
export async function getWeather(
	cfg = {},
	{ userInitiated = false, force = false } = {},
) {
	const units = cfg.units === "imperial" ? "imperial" : "metric";
	const place = await resolvePlace(cfg, { userInitiated });
	if (!place) return { ok: false, error: "location" };

	const cache = await getStorageLocal(CACHE_KEY);
	if (!force && isFreshCache(cache, units, place)) {
		return { ok: true, data: cache.data, place: cache.place, cached: true };
	}

	const data = await fetchForecast(place, units);
	if (!data) return { ok: false, error: "fetch" };

	const payload = {
		provider: "open-meteo",
		timestamp: Date.now(),
		units,
		place,
		data,
	};
	try {
		await setStorageLocal({ [CACHE_KEY]: payload });
	} catch (e) {}

	return { ok: true, data, place, cached: false };
}

/** Saved location for the Settings panel. */
export async function getSavedPlace() {
	return await getStorageLocal(PLACE_KEY);
}

/** Forget the saved location so the next fetch auto-detects again. */
export async function clearWeatherPlace() {
	try {
		await setStorageLocal({
			[PLACE_KEY]: null,
			weatherGeo: null, // legacy key from older builds
		});
	} catch (e) {}
}
