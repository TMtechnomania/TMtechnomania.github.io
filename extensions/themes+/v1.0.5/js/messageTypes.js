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
