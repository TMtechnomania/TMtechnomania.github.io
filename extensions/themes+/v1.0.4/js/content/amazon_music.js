// Content script for Amazon Music
(function() {
    'use strict';

    let lastState = { isPlaying: false, title: '', thumbnail: '', duration: '', currentTime: '' };

    function detectMedia() {
        const playBtn = document.querySelector('music-button[icon-name="play"]');
        // If play button is hidden or pause button is visible?
        // Amazon uses <music-button icon-name="pause"> when playing
        const pauseBtn = document.querySelector('music-button[icon-name="pause"]');
        const isPlaying = !!pauseBtn && pauseBtn.style.display !== 'none';

        let title = '';
        const titleEl = document.querySelector('music-horizontal-item[slot="primary-text"]');
        if (titleEl) title = titleEl.getAttribute('primary-text') || titleEl.textContent;
        if (!title) title = document.title.replace('Amazon Music', '').trim();

        let thumbnail = '';
        const img = document.querySelector('music-image# art') || document.querySelector('.track-artwork img');
        if (img) thumbnail = img.src;

        let duration = '';
        let currentTime = '';
        
        // Amazon often hides audio element or uses blobs. Scraping time UI is safer:
        const curEl = document.querySelector('#gui_timestamp_time_current');
        const durEl = document.querySelector('#gui_timestamp_time_total');
        if (curEl) currentTime = curEl.textContent.trim();
        if (durEl) duration = durEl.textContent.trim();

        return { isPlaying, title, thumbnail, duration, currentTime, platform: 'amazon_music' };
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

    setInterval(()=>{
        const media = detectMedia();
        if (!media) return;
        chrome.runtime.sendMessage({ type: 'MEDIA_PRESENCE', data: { ...media, lastUserAccess } });
    }, 3000);

    chrome.runtime.onMessage.addListener((message) => {
        if (message.type === 'MEDIA_CONTROL') {
            if (message.action === 'play' || message.action === 'pause') {
                const btn = document.querySelector('music-button[icon-name="play"], music-button[icon-name="pause"]');
                if (btn) btn.click();
            } else if (message.action === 'next') {
                const btn = document.querySelector('music-button[icon-name="next"]');
                if (btn) btn.click();
            } else if (message.action === 'prev') {
                const btn = document.querySelector('music-button[icon-name="previous"]');
                if (btn) btn.click();
            }
        } else if (message.type === 'MEDIA_QUERY') {
            const media = detectMedia();
            if (media) chrome.runtime.sendMessage({ type: 'MEDIA_UPDATE', data: media }).catch(()=>{});
        }
    });

    let updateTimeout;
    function triggerImmediateUpdate() {
        updateUserAccess();
        if (updateTimeout) return;
        updateTimeout = setTimeout(() => {
            const media = detectMedia();
            if (media) chrome.runtime.sendMessage({ type: 'MEDIA_PRESENCE', data: { ...media, lastUserAccess } });
            updateTimeout = null;
        }, 500);
    }

    ['click','keydown','mousemove','touchstart'].forEach(evt => document.addEventListener(evt, triggerImmediateUpdate, { passive: true }));
    setInterval(sendUpdate, 1000);
})();
