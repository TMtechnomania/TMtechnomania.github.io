// Content script for Apple Music
(function() {
    'use strict';

    let lastState = { isPlaying: false, title: '', thumbnail: '', duration: '', currentTime: '' };

    function detectMedia() {
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

    // presence broadcast every 3s
    setInterval(()=>{
        const media = detectMedia();
        if (!media) return;
        chrome.runtime.sendMessage({ type: 'MEDIA_PRESENCE', data: { ...media, lastUserAccess } });
    }, 3000);

    // Controls
    chrome.runtime.onMessage.addListener((message) => {
        if (message.type === 'MEDIA_CONTROL') {
            const audio = document.querySelector('audio');
            
            if (message.action === 'play' || message.action === 'pause') {
                const btn = document.querySelector('[data-testid="play-pause-button"]');
                if (btn) btn.click();
                else if (audio) message.action === 'play' ? audio.play() : audio.pause();
            } else if (message.action === 'next') {
                const btn = document.querySelector('[data-testid="next-track-button"]');
                if (btn) btn.click();
            } else if (message.action === 'prev') {
                const btn = document.querySelector('[data-testid="previous-track-button"]');
                if (btn) btn.click();
            }
        } else if (message.type === 'MEDIA_QUERY') {
            const media = detectMedia();
            if (media) chrome.runtime.sendMessage({ type: 'MEDIA_UPDATE', data: media }).catch(()=>{});
        }
    });

    // Throttled update
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
