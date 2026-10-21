// Unified media-detection content script for all supported streaming sites.
// Loaded for every supported host in manifest.json; the old per-site scripts
// have been removed.
//
// Engine improvements over the per-site originals:
//  - Safe messaging: detects "Extension context invalidated" and tears down
//    all timers/listeners instead of throwing uncaught rejections after an
//    extension reload/update.
//  - No unconditional presence broadcast: MEDIA_PRESENCE is sent only on first
//    detection, on user activity (throttled), or on state change — not every
//    3s regardless of whether anything changed.
//  - Progress (currentTime) updates are throttled to ~5s while playing, so a
//    steady-state track no longer messages the service worker every second.
//  - All polling pauses while the tab is hidden; a catch-up run happens on
//    visibilitychange.
//  - Activity tracking uses click/keydown/touchstart only (no mousemove).
//  - YouTube "prev" no longer falls back to window.history.back().

(function () {
    'use strict';

    // Message type constants (must match js/service.js)
    const MSG = {
        UPDATE: 'MEDIA_UPDATE',
        PRESENCE: 'MEDIA_PRESENCE',
        QUERY: 'MEDIA_QUERY',
        CONTROL: 'MEDIA_CONTROL'
    };

    if (!chrome.runtime || !chrome.runtime.id) return; // context already gone

    // ------------------------------------------------------------------
    // Per-site configs. detect() returns { isPlaying, title, thumbnail,
    // duration, currentTime?, platform } or null when no media is present.
    // controls(action) handles play/pause/next/prev (and mute for Twitch).
    // Logic ported verbatim from the original per-site scripts.
    // ------------------------------------------------------------------

    const spotify = {
        platform: 'spotify',
        detect() {
            const playButton = document.querySelector('[data-testid="control-button-playpause"]');
            const isPlaying = playButton?.getAttribute('aria-label')?.toLowerCase().includes('pause') || false;

            const title = document.querySelector('[data-testid="context-item-link"]')?.textContent?.trim() ||
                document.querySelector('a[data-testid="context-item-info-title"]')?.textContent?.trim() ||
                document.querySelector('.Root__now-playing-bar .track-info__name')?.textContent?.trim() ||
                document.title.replace(' - Spotify', '');

            let thumbnail = '';
            const imgEl = document.querySelector('.Root__now-playing-bar img') ||
                document.querySelector('[data-testid="now-playing-widget"] img') ||
                document.querySelector('.cover-art img');
            if (imgEl) thumbnail = imgEl.src;

            let duration = '';
            let currentTime = '';
            const durEl = document.querySelector('[data-testid="playback-duration"]');
            const curEl = document.querySelector('[data-testid="playback-position"]');
            if (durEl) duration = durEl.textContent;
            if (curEl) currentTime = curEl.textContent;

            return { isPlaying, title, thumbnail, duration, currentTime, platform: 'spotify' };
        },
        controls(action) {
            if (action === 'play' || action === 'pause') {
                const playButton = document.querySelector('[data-testid="control-button-playpause"]');
                if (playButton) playButton.click();
            } else if (action === 'next') {
                const nextButton = document.querySelector('[data-testid="control-button-skip-forward"]');
                if (nextButton) nextButton.click();
            } else if (action === 'prev') {
                const prevButton = document.querySelector('[data-testid="control-button-skip-back"]');
                if (prevButton) prevButton.click();
            }
        }
    };

    const youtube = {
        platform: 'youtube',
        detect() {
            const video = document.querySelector('video');
            if (!video) return null;

            const isPlaying = !video.paused && !video.ended && video.readyState > 2;
            const title = document.querySelector('h1.ytd-video-primary-info-renderer, h1.title')?.textContent?.trim() ||
                document.querySelector('meta[name="title"]')?.content ||
                document.title.replace(' - YouTube', '');

            let thumbnail = '';
            const thumbEl = document.querySelector('link[rel="image_src"]') ||
                document.querySelector('meta[property="og:image"]');
            if (thumbEl) thumbnail = thumbEl.href || thumbEl.content;

            // Fallback to video ID-based thumbnail
            if (!thumbnail) {
                const videoId = new URLSearchParams(window.location.search).get('v');
                if (videoId) thumbnail = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
            }

            let duration = '';
            let currentTime = '';
            const durEl = document.querySelector('.ytp-time-duration');
            const curEl = document.querySelector('.ytp-time-current');
            if (durEl) duration = durEl.textContent;
            if (curEl) currentTime = curEl.textContent;

            return { isPlaying, title, thumbnail, duration, currentTime, platform: 'youtube' };
        },
        controls(action) {
            const video = document.querySelector('video');
            if (!video) return;
            if (action === 'play') video.play();
            else if (action === 'pause') video.pause();
            else if (action === 'next') {
                const nextBtn = document.querySelector('.ytp-next-button');
                if (nextBtn) nextBtn.click();
            } else if (action === 'prev') {
                // .ytp-prev-button only exists in playlist context; do nothing
                // otherwise. The old history.back() fallback caused surprising
                // navigation on a third-party site and was removed.
                const prevBtn = document.querySelector('.ytp-prev-button');
                if (prevBtn) prevBtn.click();
            }
        },
        // YouTube is an SPA: the <video> element can be swapped between videos,
        // so event listeners must be re-attached when a new element appears.
        onTick() {
            const video = document.querySelector('video');
            if (video && !video.hasAttribute('data-listener')) {
                ['play', 'pause', 'ended'].forEach(event => {
                    video.addEventListener(event, () => { updateUserAccess(); tick(true); });
                });
                video.setAttribute('data-listener', 'true');
            }
        }
    };

    const soundcloud = {
        platform: 'soundcloud',
        detect() {
            const playButton = document.querySelector('.playControl');
            const isPlaying = playButton?.classList.contains('playing') || false;

            const title = document.querySelector('.playbackSoundBadge__titleLink')?.textContent?.trim() ||
                document.querySelector('.soundTitle__title')?.textContent?.trim() ||
                document.title.replace(' by ', ' - ').split(' | ')[0];

            let thumbnail = '';
            const imgEl = document.querySelector('.playbackSoundBadge .sc-artwork') ||
                document.querySelector('.sound__coverArt');
            if (imgEl) {
                const bg = window.getComputedStyle(imgEl).backgroundImage;
                const match = bg.match(/url\(["']?([^"')]+)["']?\)/);
                if (match) thumbnail = match[1];
            }

            let duration = '';
            const durEl = document.querySelector('.playbackTimeline__duration span:last-child');
            if (durEl) duration = durEl.textContent;

            return { isPlaying, title, thumbnail, duration, platform: 'soundcloud' };
        },
        controls(action) {
            if (action === 'play' || action === 'pause') {
                const playButton = document.querySelector('.playControl');
                if (playButton) playButton.click();
            } else if (action === 'next') {
                const nextBtn = document.querySelector('.skipControl__next');
                if (nextBtn) nextBtn.click();
            } else if (action === 'prev') {
                const prevBtn = document.querySelector('.skipControl__previous');
                if (prevBtn) prevBtn.click();
            }
        }
    };

    const appleMusic = {
        platform: 'apple_music',
        detect() {
            // Apple Music uses specific web components, but standard audio elements often exist
            const audio = document.querySelector('audio');
            const isPlaying = audio ? !audio.paused : false;

            let title = '';
            const titleEl = document.querySelector('[data-testid="now-playing-title"]') ||
                document.querySelector('.headline .primary-text') ||
                document.title.replace(' - Apple Music', '');
            if (titleEl) title = (titleEl.textContent || document.title).trim();

            let thumbnail = '';
            // Try to find artwork
            const img = document.querySelector('img.box-artwork') ||
                document.querySelector('amp-chrome-player img') ||
                document.querySelector('.media-artwork-v2 img');
            if (img) thumbnail = img.src || img.currentSrc;

            let duration = '';
            let currentTime = '';

            if (audio) {
                if (!isNaN(audio.duration)) {
                    let m = Math.floor(audio.duration / 60);
                    let s = Math.floor(audio.duration % 60);
                    duration = `${m}:${s.toString().padStart(2, '0')}`;
                }
                if (!isNaN(audio.currentTime)) {
                    let m = Math.floor(audio.currentTime / 60);
                    let s = Math.floor(audio.currentTime % 60);
                    currentTime = `${m}:${s.toString().padStart(2, '0')}`;
                }
            }

            return { isPlaying, title, thumbnail, duration, currentTime, platform: 'apple_music' };
        },
        controls(action) {
            const audio = document.querySelector('audio');

            if (action === 'play' || action === 'pause') {
                const btn = document.querySelector('[data-testid="play-pause-button"]');
                if (btn) btn.click();
                else if (audio) action === 'play' ? audio.play() : audio.pause();
            } else if (action === 'next') {
                const btn = document.querySelector('[data-testid="next-track-button"]');
                if (btn) btn.click();
            } else if (action === 'prev') {
                const btn = document.querySelector('[data-testid="previous-track-button"]');
                if (btn) btn.click();
            }
        }
    };

    const amazonMusic = {
        platform: 'amazon_music',
        detect() {
            // Amazon uses <music-button icon-name="pause"> while playing
            const pauseBtn = document.querySelector('music-button[icon-name="pause"]');
            const isPlaying = !!pauseBtn && pauseBtn.style.display !== 'none';

            let title = '';
            const titleEl = document.querySelector('music-horizontal-item[slot="primary-text"]');
            if (titleEl) title = titleEl.getAttribute('primary-text') || titleEl.textContent;
            if (!title) title = document.title.replace('Amazon Music', '').trim();

            let thumbnail = '';
            // Note: the original selector "music-image# art" contained a space and
            // never matched; it is corrected to "music-image#art" here.
            const img = document.querySelector('music-image#art') || document.querySelector('.track-artwork img');
            if (img) thumbnail = img.src;

            let duration = '';
            let currentTime = '';

            // Amazon often hides audio element or uses blobs. Scraping time UI is safer:
            const curEl = document.querySelector('#gui_timestamp_time_current');
            const durEl = document.querySelector('#gui_timestamp_time_total');
            if (curEl) currentTime = curEl.textContent.trim();
            if (durEl) duration = durEl.textContent.trim();

            return { isPlaying, title, thumbnail, duration, currentTime, platform: 'amazon_music' };
        },
        controls(action) {
            if (action === 'play' || action === 'pause') {
                const btn = document.querySelector('music-button[icon-name="play"], music-button[icon-name="pause"]');
                if (btn) btn.click();
            } else if (action === 'next') {
                const btn = document.querySelector('music-button[icon-name="next"]');
                if (btn) btn.click();
            } else if (action === 'prev') {
                const btn = document.querySelector('music-button[icon-name="previous"]');
                if (btn) btn.click();
            }
        }
    };

    const twitch = {
        platform: 'twitch',
        detect() {
            const video = document.querySelector('video');
            const isPlaying = video ? !video.paused : false;

            let title = '';
            const titleEl = document.querySelector('[data-a-target="stream-title"]') ||
                document.querySelector('h1.core-activity-target');
            if (titleEl) title = titleEl.textContent;
            // Fallback to channel name
            if (!title && video) {
                const chan = document.querySelector('[data-a-target="user-channel-header-item"] h1');
                if (chan) title = chan.textContent;
            }
            if (!title) title = document.title.split(' - ')[0];

            let thumbnail = '';
            // For live streams, use the channel avatar.
            const avatar = document.querySelector('.tw-image-avatar');
            if (avatar) thumbnail = avatar.src;

            let duration = 'LIVE';
            let currentTime = '';

            if (video) {
                if (video.duration !== Infinity) {
                    // VOD
                    let m = Math.floor(video.duration / 60);
                    let s = Math.floor(video.duration % 60);
                    duration = `${m}:${s.toString().padStart(2, '0')}`;
                }
                // Current Time always relevant
                let m = Math.floor(video.currentTime / 60);
                let s = Math.floor(video.currentTime % 60);
                currentTime = `${m}:${s.toString().padStart(2, '0')}`;
            }

            return { isPlaying, title, thumbnail, duration, currentTime, platform: 'twitch' };
        },
        controls(action) {
            const video = document.querySelector('video');
            if (action === 'play' || action === 'pause') {
                const btn = document.querySelector('[data-a-target="player-play-pause-button"]');
                if (btn) btn.click();
                else if (video) action === 'play' ? video.play() : video.pause();
            } else if (action === 'mute') {
                // Twitch specific mute
                const btn = document.querySelector('[data-a-target="player-mute-button"]');
                if (btn) btn.click();
            }
        }
    };

    const netflix = {
        platform: 'netflix',
        detect() {
            const video = document.querySelector('video');
            const isPlaying = video ? !video.paused : false;

            let title = '';
            // Netflix specific: .ellipsize-text usually contains title
            const titleContainer = document.querySelector('.ellipsize-text') ||
                document.querySelector('.video-title') ||
                document.querySelector('.player-status-main-title'); // Sometimes
            if (titleContainer) {
                title = titleContainer.textContent;
                // Maybe add episode title?
                const epTitle = document.querySelector('.ellipsize-text + .ellipsize-text'); // Subtitle
                if (epTitle) title += ` - ${epTitle.textContent}`;
            }
            if (!title) title = document.title.replace(' - Netflix', '');

            let thumbnail = '';
            // Netflix uses blobs for video and the player UI exposes no box art.

            let duration = '';
            let currentTime = '';

            if (video && !isNaN(video.duration)) {
                let m = Math.floor(video.duration / 60);
                let s = Math.floor(video.duration % 60);
                if (m > 60) {
                    let h = Math.floor(m / 60);
                    m = m % 60;
                    duration = `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
                } else {
                    duration = `${m}:${s.toString().padStart(2, '0')}`;
                }
            }
            if (video && !isNaN(video.currentTime)) {
                let m = Math.floor(video.currentTime / 60);
                let s = Math.floor(video.currentTime % 60);
                if (duration.split(':').length > 2) {
                    let h = Math.floor(m / 60);
                    m = m % 60;
                    currentTime = `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
                } else {
                    currentTime = `${m}:${s.toString().padStart(2, '0')}`;
                }
            }

            return { isPlaying, title, thumbnail, duration, currentTime, platform: 'netflix' };
        },
        controls(action) {
            const video = document.querySelector('video');
            if (action === 'play' || action === 'pause') {
                // Netflix has a specific wrapper click logic usually, but video play/pause works often if user interacted
                if (video) action === 'play' ? video.play() : video.pause();
                const btn = document.querySelector('.button-nfplayerPlay') || document.querySelector('.button-nfplayerPause');
                if (btn) btn.click();
            }
            // Next/Prev often specific to "Next Episode"
            if (action === 'next') {
                const next = document.querySelector('[data-uia="next-episode"]');
                if (next) next.click();
            }
        }
    };

    const disneyHotstar = {
        platform: 'disney',
        detect() {
            const video = document.querySelector('video');
            const isPlaying = video ? !video.paused : false;

            let title = '';
            // Disney+
            const titleEl = document.querySelector('[data-testid="player-title"]');
            if (titleEl) title = titleEl.textContent;

            // Hotstar (India)
            if (!title) {
                const hTitle = document.querySelector('.player-title') || document.querySelector('.content-title');
                if (hTitle) title = hTitle.textContent;
            }

            if (!title) title = document.title;

            let thumbnail = '';
            // Hard to capture without accessing internal props or specific img

            let duration = '';
            let currentTime = '';

            if (video) {
                if (!isNaN(video.duration)) {
                    let m = Math.floor(video.duration / 60);
                    let s = Math.floor(video.duration % 60);
                    if (m > 60) {
                        let h = Math.floor(m / 60);
                        m = m % 60;
                        duration = `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
                    } else {
                        duration = `${m}:${s.toString().padStart(2, '0')}`;
                    }
                }
                if (!isNaN(video.currentTime)) {
                    let m = Math.floor(video.currentTime / 60);
                    let s = Math.floor(video.currentTime % 60);
                    if (duration && duration.split(':').length > 2) {
                        let h = Math.floor(m / 60);
                        m = m % 60;
                        currentTime = `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
                    } else {
                        currentTime = `${m}:${s.toString().padStart(2, '0')}`;
                    }
                }
            }

            return { isPlaying, title, thumbnail, duration, currentTime, platform: 'disney' };
        },
        controls(action) {
            const video = document.querySelector('video');
            if (action === 'play' || action === 'pause') {
                if (video) action === 'play' ? video.play() : video.pause();
            }
        }
    };

    const vimeo = {
        platform: 'vimeo',
        detect() {
            const video = document.querySelector('video');
            const isPlaying = video ? !video.paused : false;

            let title = '';
            const titleEl = document.querySelector('.vp-title-header h1') || document.querySelector('.clip_header h1');
            if (titleEl) title = titleEl.textContent;
            if (!title) title = document.title.replace(' on Vimeo', '');

            let thumbnail = '';
            // If meta tag exists
            const metaImg = document.querySelector('meta[property="og:image"]');
            if (metaImg) thumbnail = metaImg.content;

            let duration = '';
            let currentTime = '';

            if (video) {
                if (!isNaN(video.duration)) {
                    let m = Math.floor(video.duration / 60);
                    let s = Math.floor(video.duration % 60);
                    duration = `${m}:${s.toString().padStart(2, '0')}`;
                }
                if (!isNaN(video.currentTime)) {
                    let m = Math.floor(video.currentTime / 60);
                    let s = Math.floor(video.currentTime % 60);
                    currentTime = `${m}:${s.toString().padStart(2, '0')}`;
                }
            }

            return { isPlaying, title, thumbnail, duration, currentTime, platform: 'vimeo' };
        },
        controls(action) {
            const video = document.querySelector('video');
            if (action === 'play' || action === 'pause') {
                const btn = document.querySelector('.play'); // Vimeo specific often .play
                if (btn) btn.click();
                else if (video) action === 'play' ? video.play() : video.pause();
            }
        }
    };

    const SITES = {
        'open.spotify.com': spotify,
        'www.youtube.com': youtube,
        'm.youtube.com': youtube,
        'soundcloud.com': soundcloud,
        'music.apple.com': appleMusic,
        'music.amazon.com': amazonMusic,
        'www.twitch.tv': twitch,
        'www.netflix.com': netflix,
        'www.disneyplus.com': disneyHotstar,
        'www.hotstar.com': disneyHotstar,
        'www.disneyplus.hotstar.com': disneyHotstar,
        'vimeo.com': vimeo
    };

    const site = SITES[location.hostname];
    if (!site) return; // Not a supported host (manifest matches should prevent this)

    // ------------------------------------------------------------------
    // Shared engine
    // ------------------------------------------------------------------

    let stopped = false;
    let lastState = null; // last media snapshot actually sent to the extension
    let registered = false; // whether an initial MEDIA_PRESENCE was sent
    let lastUserAccess = Date.now();
    let lastTimeSendAt = 0;
    const timers = [];

    function safeSend(msg) {
        if (stopped || !chrome.runtime?.id) return;
        try {
            const p = chrome.runtime.sendMessage(msg);
            if (p && typeof p.catch === 'function') {
                p.catch((e) => {
                    const text = String((e && e.message) || e);
                    // Extension reloaded/updated/disabled: tear down cleanly
                    // instead of leaving uncaught "Extension context
                    // invalidated" rejections behind.
                    if (/context invalidated|is not available|Receiving end does not exist/i.test(text)) stop();
                });
            }
        } catch (_) {
            stop();
        }
    }

    function stop() {
        if (stopped) return;
        stopped = true;
        timers.forEach(t => clearInterval(t));
        if (activityTimeout) clearTimeout(activityTimeout);
        ACTIVITY_EVENTS.forEach(evt => document.removeEventListener(evt, onActivity));
        document.removeEventListener('visibilitychange', onVisibility);
        try { chrome.runtime.onMessage.removeListener(onMessage); } catch (_) {}
    }

    function updateUserAccess() { lastUserAccess = Date.now(); }

    // Volatile fields (currentTime) are excluded so steady-state playback does
    // not count as a "state change".
    function stateChanged(a, b) {
        return a.isPlaying !== b.isPlaying ||
            a.title !== b.title ||
            a.thumbnail !== b.thumbnail ||
            a.duration !== b.duration;
    }

    function sendPresence(media) {
        if (!media || stopped) return;
        registered = true;
        safeSend({ type: MSG.PRESENCE, data: Object.assign({}, media, { lastUserAccess }) });
    }

    // Main detection tick. Runs every second (skipped while the tab is hidden),
    // and immediately after user activity / video events when `immediate` is set.
    function tick(immediate) {
        if (stopped || document.hidden) return;
        if (site.onTick) site.onTick();

        const media = site.detect();
        if (!media) {
            lastState = null;
            registered = false; // allow re-registration after a fresh load
            return;
        }

        if (!registered) sendPresence(media);

        if (!lastState || stateChanged(media, lastState)) {
            lastState = media;
            lastTimeSendAt = Date.now();
            safeSend({ type: MSG.UPDATE, data: media });
        } else if (media.isPlaying && media.currentTime && media.currentTime !== lastState.currentTime) {
            // Throttled progress update (~5s) so the new-tab time display stays
            // fresh without messaging the service worker every second.
            const now = Date.now();
            if (immediate || now - lastTimeSendAt >= 5000) {
                lastState = media;
                lastTimeSendAt = now;
                safeSend({ type: MSG.UPDATE, data: media });
            }
        }
    }

    // User activity: refresh lastUserAccess (used by the service worker for
    // priority-tab selection) and pick up state changes promptly. Throttled to
    // one send per 500ms; mousemove is intentionally excluded.
    let activityTimeout = null;
    const ACTIVITY_EVENTS = ['click', 'keydown', 'touchstart'];

    function onActivity() {
        updateUserAccess();
        if (activityTimeout) return;
        activityTimeout = setTimeout(() => {
            activityTimeout = null;
            if (stopped || document.hidden) return;
            const media = site.detect();
            if (!media) return;
            sendPresence(media);
            tick(true);
        }, 500);
    }

    function onVisibility() {
        // Catch up on any state that changed while the tab was hidden.
        if (!document.hidden) tick(true);
    }

    function onMessage(message) {
        if (stopped || !message) return;
        if (message.type === MSG.CONTROL) {
            site.controls(message.action);
        } else if (message.type === MSG.QUERY) {
            const media = site.detect();
            if (media) safeSend({ type: MSG.UPDATE, data: media });
        }
    }

    // ------------------------------------------------------------------
    // Initialize
    // ------------------------------------------------------------------

    ACTIVITY_EVENTS.forEach(evt => document.addEventListener(evt, onActivity, { passive: true }));
    document.addEventListener('visibilitychange', onVisibility);
    chrome.runtime.onMessage.addListener(onMessage);
    timers.push(setInterval(() => tick(false), 1000));
    if (site.onTick) site.onTick(); // e.g. attach YouTube video listeners up front
    tick(true);

})();
