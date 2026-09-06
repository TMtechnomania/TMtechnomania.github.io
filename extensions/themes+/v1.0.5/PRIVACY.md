# Privacy Policy — Themes+ New Tab

This document explains what data the **Themes+ New Tab** extension reads, stores, and sends, and why each permission is requested. It is written to support both user transparency and Chrome Web Store review (including the store's privacy-disclosure form).

## Short answer

- The extension does **not** collect, sell, or share any personal data with the developer. There are no analytics, telemetry, crash reporting, or ad networks in this codebase.
- Almost everything you do (notes, alarms, timers, bookmarks panel state, wallpapers, settings) is stored **locally on your device** in Chrome's extension storage (`chrome.storage.local`) and IndexedDB. Nothing is uploaded anywhere.
- The only network requests the extension makes are:
  1. Your own wallpaper image/video URLs (if you configure remote ones),
  2. Optional user-initiated features described below (weather, currency rates, RSS feeds, voice search).

## Third-party services and when they are contacted

| Feature | Service | When data leaves your device | What is sent |
| --- | --- | --- | --- |
| Voice search | Google's speech-recognition service (via the browser's built-in `SpeechRecognition` API) | Only while you hold/activate voice search in the new-tab search bar | The audio of what you say, processed by Google to produce text. This is a Chrome platform API; the extension itself never transmits audio directly. |
| Weather widget | `api.openweathermap.org` | Only when the weather widget is enabled and refreshes | Your OpenWeatherMap **API key** (which you supply in Settings) plus either your city name or, if you grant the optional geolocation permission, your approximate location. |
| Currency converter | `api.exchangerate-api.com` | Only when the currency tool is opened/refreshed | Nothing personal — a public rate-table request (`/v4/latest/USD`). |
| RSS reader | The feed URL **you** enter | Only after you explicitly grant the optional "read and modify all websites" permission, and only to the exact feed URL you typed | Your browser fetches that one URL. No other site is contacted by this feature. |

Everything else — QR codes (generated locally with a vendored MIT-licensed library), calculator, password generator, hash/JSON/Base64 tools, notes, alarms, timers, workspaces, tab management — runs **entirely on-device** and makes no network requests.

## Why the extension injects into music/video sites

The new-tab page shows a small media widget (now-playing title + play/pause/skip). To read that state, one lightweight content script (`js/content/mediaContent.js`) is injected on Spotify, YouTube, SoundCloud, Apple Music, Amazon Music, Twitch, Netflix, Disney+/Hotstar, and Vimeo.

- It **only reads** playback state already present in the page (title, artwork URL, play/pause position).
- That data is sent to the extension's **own local service worker** via `chrome.runtime.sendMessage` — it never leaves your machine and is not transmitted to any third party or to the developer.
- It does not modify pages, track you across sites, read form input, or collect browsing history.

## Permissions

### Always-on (required)

| Permission | Why |
| --- | --- |
| `storage` | Save your settings, notes, alarms, timer laps, and custom wallpapers on-device. |
| `unlimitedStorage` | Store user 4K images and large video wallpapers locally without browser origin eviction. |
| `tabs` | Tab manager / workspaces: list open tabs so you can group, pin, or restore them. |
| `alarms` | Wake the service worker at alarm times (the Chrome-internal scheduler; no network involved). |
| `notifications` | Show alarm and timer alerts as system notifications. |
| `search` | Open search-engine results from the new-tab search bar. |

### Optional (only active after you explicitly grant them)

| Permission / Origin | Used by | What it enables |
| --- | --- | --- |
| `bookmarks` | Bookmarks panel & search suggestions | Manage your Chrome bookmarks from the new tab. |
| `<all_urls>` (Optional Host Permission) | RSS reader; FamCam tab screenshots | Fetch user-entered feed URLs; capture a screenshot of the active tab. |
| `system.cpu`, `system.memory`, `system.storage` | System-stats tool | Display live CPU/RAM/disk usage charts in the tools dashboard. |
| Camera (`getUserMedia`) | FamCam | Webcam selfies and ring-flash effects (standard browser permission prompt). |
| Microphone (`SpeechRecognition`) | Voice search | Microphone access for dictating searches (standard browser permission prompt). |
| Geolocation (Web API) | Weather widget | Show weather for your current location instead of a typed city (standard browser permission prompt). |

You can revoke any optional permission at any time in **chrome://extensions → Themes+ → Permissions**; the affected feature will simply prompt you again next time it is used.

## Data storage on your device

- Settings, notes, alarms, timer laps: `chrome.storage.local` (older versions kept some of these in `localStorage`; they are migrated automatically and transparently).
- Custom wallpaper uploads: IndexedDB inside the extension's own database.
- Clearing site data for the extension removes all of it. There is no server-side account system.

## Contact

Questions or a data-deletion request: contact the developer at **buildwithkt.dev**. Because no personal data is stored off-device, deleting the extension (or clearing its storage) deletes everything.
