// Content script for Netflix
(function() {
    'use strict';

    let lastState = { isPlaying: false, title: '', thumbnail: '', duration: '', currentTime: '' };

    function detectMedia() {
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
        // Netflix uses blobs for video, but maybe we can find a box art
        // The player often has a background image before playing, but during play it's just video.
        // We can't easily get the box art from the player UI except maybe if we find a specific img.
        // Fallback: empty, or generic.

        let duration = '';
        let currentTime = '';
        
        if (video && !isNaN(video.duration)) {
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
        if (video && !isNaN(video.currentTime)) {
             let m = Math.floor(video.currentTime / 60);
             let s = Math.floor(video.currentTime % 60);
             if (duration.split(':').length > 2) {
                  let h = Math.floor(m / 60);
                  m = m % 60;
                  currentTime = `${h}:${m.toString().padStart(2,'0')}:${s.toString().padStart(2, '0')}`;
             } else {
                  currentTime = `${m}:${s.toString().padStart(2, '0')}`;
             }
        }

        return { isPlaying, title, thumbnail, duration, currentTime, platform: 'netflix' };
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
                // Netflix has a specific wrapper click logic usually, but video play/pause works often if user interacted
                if (video) message.action === 'play' ? video.play() : video.pause();
                // Or try button
                const btn = document.querySelector('.button-nfplayerPlay') || document.querySelector('.button-nfplayerPause');
                if (btn) btn.click();
            }
            // Next/Prev often specific to "Next Episode"
            if (message.action === 'next') {
                const next = document.querySelector('[data-uia="next-episode"]');
                if (next) next.click();
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
