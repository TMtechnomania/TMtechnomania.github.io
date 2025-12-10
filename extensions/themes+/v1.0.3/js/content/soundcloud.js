// Content script for SoundCloud
(function() {
    'use strict';

    let lastState = { isPlaying: false, title: '', thumbnail: '', duration: '' };

    function detectMedia() {
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
    }

    let lastUserAccess = Date.now();
    function updateUserAccess(){ lastUserAccess = Date.now(); }

    function sendUpdate() {
        const media = detectMedia();
        if (media.isPlaying !== lastState.isPlaying || 
            media.title !== lastState.title ||
            media.thumbnail !== lastState.thumbnail ||
            media.duration !== lastState.duration) {
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
                const playButton = document.querySelector('.playControl');
                if (playButton) playButton.click();
            } else if (message.action === 'next') {
                const nextBtn = document.querySelector('.skipControl__next');
                if (nextBtn) nextBtn.click();
            } else if (message.action === 'prev') {
                const prevBtn = document.querySelector('.skipControl__previous');
                if (prevBtn) prevBtn.click();
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
