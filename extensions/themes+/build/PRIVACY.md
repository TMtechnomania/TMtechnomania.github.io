# Privacy Policy — Themes+ New Tab

This document explains what data the **Themes+ New Tab** extension reads, stores, and sends, and why each permission is requested. It is written to support both user transparency and Chrome Web Store review (including the store's privacy-disclosure form).

## Short answer

- The extension does **not** collect, sell, or share personal data with the developer. There are no analytics, telemetry, crash reporting, advertising, or tracking SDKs in this codebase.
- Almost everything you do (settings, notes, alarms, timers, bookmarks-panel state, wallpapers, workspaces, tool inputs) is stored **locally on your device** - in Chrome's extension storage (`chrome.storage.local`) and IndexedDB for custom wallpapers. Legacy `localStorage` values are migrated once. Nothing is uploaded to a developer server. Notes and checklists are additionally mirrored to Chrome's own sync storage (`chrome.storage.sync`) so they can follow you between signed-in devices; see the sync row below.
- The extension does make network requests in the following cases:
  1. **Default and selected web fonts** are loaded from Google Fonts (`fonts.googleapis.com` for the stylesheet and `fonts.gstatic.com` for the font files). The default Outfit font is used on every new-tab page unless you change or remove it.
  2. **The wallpaper catalog** is loaded from `buildwithkt.dev`, the developer-operated static site. On install/update and when the catalog is refreshed, the extension fetches `wallpaper.json` and downloads catalog thumbnails. Full image/video media is cached only when a wallpaper is displayed.
  3. **Optional or user-triggered features**: custom remote wallpaper URLs, weather (`api.open-meteo.com` and `geocoding-api.open-meteo.com`), currency rates (`api.exchangerate-api.com`), RSS feeds you add, voice search, and shortcut icons you configure.
  4. **The media widget** loads album/video artwork from the streaming site you are already using (for example Spotify, YouTube, SoundCloud, Apple Music, Amazon Music, Twitch, Netflix, Disney+/Hotstar, or Vimeo).
  5. **FamCam screenshots** may re-fetch font and image resources referenced by the new-tab page so the captured image renders correctly. The screenshot itself is never uploaded.
- As with any web request, the destination service can see your IP address and standard request headers (such as the browser user-agent). The extension does not attach identifiers, account data, or browsing history to these requests. The developer does not use them to build user profiles.

## Third-party services and when they are contacted

| Feature | Service | When data leaves your device | What is sent |
| --- | --- | --- | --- |
| Default / selected web font | Google Fonts (`fonts.googleapis.com`, `fonts.gstatic.com`) | On new-tab load while a Google-hosted font (Outfit by default) is selected | A request for the font stylesheet and font files. Google receives your IP address and standard request headers; no search, browsing, or account data is included. |
| Wallpaper catalog and bundled wallpapers | `buildwithkt.dev` (developer-operated) | On install/update, when the catalog is refreshed, when the user guide is opened, and when catalog artwork is displayed | Requests for `wallpaper.json` and catalog thumbnails. Full image/video assets are fetched only when that wallpaper is displayed. These are ordinary static-file requests with no account or identifier attached. |
| Custom remote wallpapers | The image/video URL **you** configure | When that wallpaper is displayed or rotated | A request to the URL you supplied. |
| Weather widget | `api.open-meteo.com` and `geocoding-api.open-meteo.com` | Only when the weather widget is enabled and refreshes (forecasts are cached locally for 15 minutes) | Approximate coordinates derived from the city you typed, your browser's timezone (automatic, no prompt), or the location you explicitly chose. No API key, account, or identifier is sent. |
| Notes & checklists sync | Chrome Sync (`chrome.storage.sync`) | When notes/checklists change, if you are signed in to Chrome with sync enabled | The note/checklist content, per-note timestamps, and a random device id used only to ignore your own sync echoes. Chrome Sync is operated by Google; the extension only accesses its own sync area. Without sync, everything stays local. |
| Location for weather | Browser/OS geolocation service | Only after you explicitly click **Use my location** in Settings, or click the weather widget when no location can be resolved | Your approximate coordinates. They are cached locally in `chrome.storage.local` and reused; the extension does not prompt for location during normal new-tab startup. |
| Currency converter | `api.exchangerate-api.com` | Only when the currency tool is opened/refreshed | A public rate-table request (`/v4/latest/USD`). No personal data. |
| RSS reader | The feed URL **you** enter | Only after you explicitly grant the optional host permission, and only to the exact feed origin you entered | A request for that feed URL. No other site is contacted by this feature. |
| Voice search | Google's speech-recognition service (via the browser's built-in `SpeechRecognition` API) | Only while you activate voice search in the new-tab search bar | The audio you speak, processed by Google to produce text. This is a Chrome platform API; the extension does not transmit audio itself. |
| Media widget | Spotify, YouTube, SoundCloud, Apple Music, Amazon Music, Twitch, Netflix, Disney+/Hotstar, Vimeo, and their image CDNs | While a supported media tab is open and the widget displays now-playing artwork | The content script reads playback metadata already present on the page and sends it to the extension's own local service worker. The new-tab page loads the artwork URL from the streaming service's CDN, which receives your IP address and request headers. Playback metadata is not sent to the developer. |
| FamCam screenshots | Third-party font/image hosts referenced by the new-tab page | Only when you take a screenshot and font embedding is enabled | SnapDOM may re-fetch font or image files already referenced by the page so they appear in the capture. The screenshot is saved locally and is never uploaded. |
| Shortcut icons | The icon URL **you** configure | When the shortcut is displayed | A request for that icon URL. |
| Support / store links | Chrome Web Store, Discord, GitHub, `buildwithkt.dev` | Only when you click a link | Whatever your browser normally sends when visiting that site. |

Everything else — QR codes (generated locally with a vendored MIT-licensed library), calculator, password generator, hash/JSON/Base64/regex/Lorem tools, notes, alarms, timers, workspaces, tab management, and system stats — runs **entirely on-device** and makes no network requests.

## Why the extension injects into music/video sites

The new-tab page shows a small media widget (now-playing title, artwork, and play/pause/skip controls). To read that state, one lightweight content script is injected on Spotify, YouTube, SoundCloud, Apple Music, Amazon Music, Twitch, Netflix, Disney+/Hotstar, and Vimeo.

- It **only reads** playback state already present in the page (title, artwork URL, play/pause position).
- That data is sent to the extension's **own local service worker** via `chrome.runtime.sendMessage` — it is not transmitted to the developer or any third party.
- It does not modify pages, track you across sites, read form input, or collect browsing history.

## Permissions

### Always-on (required)

| Permission / Origin | Why |
| --- | --- |
| `storage` | Save your settings, notes, alarms, timer laps, and other preferences on-device; also mirrors notes/checklists to Chrome Sync when it is enabled. |
| `unlimitedStorage` | Store user 4K images and large video wallpapers locally without browser origin eviction. |
| `tabs` | Tab manager / workspaces: list open tabs so you can group, pin, or restore them. |
| `alarms` | Wake the service worker at alarm times (the Chrome-internal scheduler; no network involved). |
| `notifications` | Show alarm and timer alerts as system notifications. |
| `search` | Open search-engine results from the new-tab search bar. |
| `system.cpu`, `system.memory`, `system.storage` | System-stats tool: display live CPU/RAM/disk usage charts in the tools dashboard. |
| `https://buildwithkt.dev/*` | Fetch the wallpaper catalog, thumbnails, and bundled wallpaper media. |
| `https://api.open-meteo.com/*` | Fetch weather data when the weather widget is enabled. |
| `https://geocoding-api.open-meteo.com/*` | Turn a typed city (or the city derived from your timezone) into coordinates for the weather widget. |
| `https://api.exchangerate-api.com/*` | Fetch public currency rates when the currency converter is used. |

### Optional (only active after you explicitly grant them)

| Permission / Origin | Used by | What it enables |
| --- | --- | --- |
| `bookmarks` | Bookmarks panel & search suggestions | Read your Chrome bookmarks from the new tab. Requested at runtime. |
| `<all_urls>` (Optional Host Permission) | RSS reader | Fetch the user-entered feed URL; requested per origin when you load a feed. |
| Camera (`getUserMedia`) | FamCam | Webcam selfies and ring-flash effects (standard browser permission prompt). |
| Microphone (`SpeechRecognition`) | Voice search | Microphone access for dictating searches (standard browser permission prompt). |
| Geolocation (Web API) | Weather widget | Show weather for your current location. Requested only after a user action (the **Use my location** button or a weather-widget click), never automatically on new-tab startup. Weather otherwise uses the city you type or the city derived from your timezone. |

You can revoke any optional permission at any time in **chrome://extensions → Themes+ → Permissions**; the affected feature will simply prompt you again next time it is used.

## Data storage on your device

- Settings, notes, alarms, timer laps, workspaces, and floating-tool positions: `chrome.storage.local`.
- Notes/checklists sync snapshot, timestamps, and last-synced base: `chrome.storage.local` plus `chrome.storage.sync` (the latter follows your Chrome sync account).
- Custom wallpaper uploads: IndexedDB inside the extension's own database.
- Cached weather data and saved weather coordinates: `chrome.storage.local`.
- Clearing site data for the extension removes all of it. There is no server-side account system.

## Contact

Questions or a data-deletion request: contact the developer at **buildwithkt.dev**. Because no personal data is stored off-device, deleting the extension (or clearing its storage) deletes everything.
