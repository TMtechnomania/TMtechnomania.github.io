// Content script for YouTube media detection
(function() {
    'use strict';

    let lastState = { isPlaying: false, title: '', thumbnail: '', duration: '', currentTime: '' };

    function detectMedia() {
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
    }

    let lastUserAccess = Date.now();

    function updateUserAccess() {
        lastUserAccess = Date.now();
    }

    function sendUpdate() {
        const media = detectMedia();
        if (!media) return;

        if (media.isPlaying !== lastState.isPlaying || 
            media.title !== lastState.title ||
            media.thumbnail !== lastState.thumbnail ||
            media.duration !== lastState.duration ||
            media.currentTime !== lastState.currentTime) {
            lastState = media;
            chrome.runtime.sendMessage({ type: 'MEDIA_UPDATE', data: media });
        }
    }

    // Periodic presence broadcast (every 3s) when media is detected
    setInterval(() => {
        const media = detectMedia();
        if (!media) return;
        chrome.runtime.sendMessage({ type: 'MEDIA_PRESENCE', data: { ...media, lastUserAccess } });
    }, 3000);

    // Listen for video events
    function attachListeners() {
        const video = document.querySelector('video');
        if (video) {
            ['play', 'pause', 'ended'].forEach(event => {
                video.addEventListener(event, () => { updateUserAccess(); sendUpdate(); });
            });
        }
    }

    // Listen for control messages
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.type === 'MEDIA_CONTROL') {
            const video = document.querySelector('video');
            if (video) {
                if (message.action === 'play') video.play();
                else if (message.action === 'pause') video.pause();
                else if (message.action === 'next') {
                    const nextBtn = document.querySelector('.ytp-next-button');
                    if (nextBtn) nextBtn.click();
                }
                else if (message.action === 'prev') {
                    // YouTube doesn't always have a prev button in player, rely on history.back? 
                    // Or scrape .ytp-prev-button (often playlist only)
                    const prevBtn = document.querySelector('.ytp-prev-button');
                    if (prevBtn) prevBtn.click();
                    else window.history.back();
                }
            }
        } else if (message.type === 'MEDIA_QUERY') {
            // respond with current media info even if unchanged
            const media = detectMedia();
            if (media) {
                chrome.runtime.sendMessage({ type: 'MEDIA_UPDATE', data: media }).catch(()=>{});
            }
        }
    });

    // Initialize
    attachListeners();

    // Throttled update function
    let updateTimeout;
    function triggerImmediateUpdate() {
        updateUserAccess();
        if (updateTimeout) return;
        
        updateTimeout = setTimeout(() => {
            const media = detectMedia();
            if (media) {
                chrome.runtime.sendMessage({ type: 'MEDIA_PRESENCE', data: { ...media, lastUserAccess } });
            }
            updateTimeout = null;
        }, 500); // 500ms throttle
    }

    // user activity -> update lastUserAccess
    ['click','keydown','mousemove','touchstart'].forEach(evt => document.addEventListener(evt, triggerImmediateUpdate, { passive: true }));

    setInterval(() => {
        if (!document.querySelector('video')?.hasAttribute('data-listener')) {
            attachListeners();
            const video = document.querySelector('video');
            if (video) video.setAttribute('data-listener', 'true');
        }
        sendUpdate();
    }, 1000);
})();
