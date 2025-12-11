// Content script for Vimeo
(function() {
    'use strict';

    let lastState = { isPlaying: false, title: '', thumbnail: '', duration: '', currentTime: '' };

    function detectMedia() {
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
                const btn = document.querySelector('.play'); // Vimeo specific often .play
                if (btn) btn.click();
                else if (video) message.action === 'play' ? video.play() : video.pause();
            }
        } else if (message.type === 'MEDIA_QUERY') {
            const detect = detectMedia();
            if (detect) chrome.runtime.sendMessage({ type: 'MEDIA_UPDATE', data: detect }).catch(()=>{});
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
