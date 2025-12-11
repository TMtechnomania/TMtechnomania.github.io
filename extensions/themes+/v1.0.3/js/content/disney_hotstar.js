// Content script for Disney+ web and Hotstar
(function() {
    'use strict';

    let lastState = { isPlaying: false, title: '', thumbnail: '', duration: '', currentTime: '' };

    function detectMedia() {
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
                     duration = `${h}:${m.toString().padStart(2,'0')}:${s.toString().padStart(2, '0')}`;
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
                     currentTime = `${h}:${m.toString().padStart(2,'0')}:${s.toString().padStart(2, '0')}`;
                } else {
                     currentTime = `${m}:${s.toString().padStart(2, '0')}`;
                }
            }
        }

        return { isPlaying, title, thumbnail, duration, currentTime, platform: 'disney' };
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
            const video = document.querySelector('video');
            if (message.action === 'play' || message.action === 'pause') {
                if (video) message.action === 'play' ? video.play() : video.pause();
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
