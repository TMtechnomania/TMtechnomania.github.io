// Content script for Spotify web player
(function() {
    'use strict';

    let lastState = { isPlaying: false, title: '', thumbnail: '', duration: '', currentTime: '' };

    function detectMedia() {
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
    }

    let lastUserAccess = Date.now();
    function updateUserAccess(){ lastUserAccess = Date.now(); }

    function sendUpdate() {
        const media = detectMedia();
        if (media.isPlaying !== lastState.isPlaying || 
            media.title !== lastState.title ||
            media.thumbnail !== lastState.thumbnail ||
            media.duration !== lastState.duration ||
            media.currentTime !== lastState.currentTime) {
            lastState = media;
            chrome.runtime.sendMessage({ type: 'MEDIA_UPDATE', data: media });
        }
    }

    // presence broadcast every 3s including lastUserAccess
    setInterval(()=>{
        const media = detectMedia();
        if (!media) return;
        chrome.runtime.sendMessage({ type: 'MEDIA_PRESENCE', data: { ...media, lastUserAccess } });
    }, 3000);

    chrome.runtime.onMessage.addListener((message) => {
        if (message.type === 'MEDIA_CONTROL') {
            if (message.action === 'play' || message.action === 'pause') {
                const playButton = document.querySelector('[data-testid="control-button-playpause"]');
                if (playButton) playButton.click();
            } else if (message.action === 'next') {
                const nextButton = document.querySelector('[data-testid="control-button-skip-forward"]');
                if (nextButton) nextButton.click();
            } else if (message.action === 'prev') {
                const prevButton = document.querySelector('[data-testid="control-button-skip-back"]');
                if (prevButton) prevButton.click();
            }
        } else if (message.type === 'MEDIA_QUERY') {
            const media = detectMedia();
            if (media) {
                chrome.runtime.sendMessage({ type: 'MEDIA_UPDATE', data: media }).catch(()=>{});
            }
        }
    });
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

    // user activity listeners to update lastUserAccess and trigger update
    ['click','keydown','mousemove','touchstart'].forEach(evt => document.addEventListener(evt, triggerImmediateUpdate, { passive: true }));
    setInterval(sendUpdate, 1000);
})();
