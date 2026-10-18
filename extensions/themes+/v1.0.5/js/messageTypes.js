// Shared runtime message-type constants for chrome.runtime messaging.
// Using named constants instead of raw strings makes typos visible at a
// glance and keeps senders/receivers in sync.
// NOTE: js/content/mediaContent.js is a classic (non-module) content script
// and cannot import this file — it keeps an inline MSG constant that must be
// kept in sync with the values below.

export const MEDIA_UPDATE = "MEDIA_UPDATE"; // media state changed (content script → SW/new tab; also broadcast by SW)
export const MEDIA_PRESENCE = "MEDIA_PRESENCE"; // media detected on a page (content script → SW, sent once per detection)
export const MEDIA_QUERY = "MEDIA_QUERY"; // request current media state (new tab/SW → tabs)
export const MEDIA_CONTROL = "MEDIA_CONTROL"; // play/pause/next/prev/mute command (action bar/widget → content script)
export const ZEN_MODE_CONTROL = "ZEN_MODE_CONTROL"; // enable/disable site blocking (ambient mode → SW)
export const NEWTAB_REGISTER = "NEWTAB_REGISTER"; // new tab page registers itself with SW
export const NEWTAB_UNREGISTER = "NEWTAB_UNREGISTER"; // new tab page deregisters from SW
export const WALLPAPER_MUTE = "WALLPAPER_MUTE"; // SW tells a tab to mute wallpaper audio
export const WALLPAPER_UNMUTE = "WALLPAPER_UNMUTE"; // SW tells a tab to unmute wallpaper audio
export const WALLPAPER_SYNC = "WALLPAPER_SYNC"; // user requests wallpaper sync
export const WALLPAPER_SYNC_TIME = "WALLPAPER_SYNC_TIME"; // target time for sync
export const WALLPAPER_SYNC_STATUS = "WALLPAPER_SYNC_STATUS"; // sync state change
export const WALLPAPER_SYNC_QUERY = "WALLPAPER_SYNC_QUERY"; // request current video times
