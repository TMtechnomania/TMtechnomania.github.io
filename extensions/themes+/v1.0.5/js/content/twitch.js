// Content script for Twitch
(function() {
    'use strict';

    let lastState = { isPlaying: false, title: '', thumbnail: '', duration: '', currentTime: '' };

    function detectMedia() {
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
         // For live streams, thumbnail is static channel avatar or stream preview (hard to get dynamic).
         // Channel Avatar:
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
                const btn = document.querySelector('[data-a-target="player-play-pause-button"]');
                if (btn) btn.click();
                else if (video) message.action === 'play' ? video.play() : video.pause();
            } else if (message.action === 'mute') {
                 // Twitch specific mute
                 const btn = document.querySelector('[data-a-target="player-mute-button"]');
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
