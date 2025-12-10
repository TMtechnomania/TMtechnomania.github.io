import { renderInlineIcon } from './brandIconLoader.js';

export function initMediaWidget() {
    // Inject CSS
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'css/mediaWidget.css';
    document.head.appendChild(link);

    // Create Widget DOM
    const widget = document.createElement('div');
    widget.id = 'media-widget';
    widget.innerHTML = `
        <div class="media-thumb">
            <div class="media-control-overlay">
                <span class="ui-icon media-control-icon"></span>
            </div>
        </div>
        <div class="media-info">
            <div class="media-title">No Media</div>
            <div class="media-status">
                <span class="media-platform"></span>
            </div>
        </div>
    `;
    document.body.appendChild(widget);

    const titleEl = widget.querySelector('.media-title');
    const thumbEl = widget.querySelector('.media-thumb');
    const platformEl = widget.querySelector('.media-platform');
    const iconEl = widget.querySelector('.media-control-icon');

    // State
    let currentMedia = null;
    let hideTimer = null;

    function updateUI(media) {
        if (!media) {
            widget.classList.remove('active');
            return;
        }

        currentMedia = media;
        widget.classList.add('active');
        
        titleEl.textContent = media.title || 'Unknown Title';
        thumbEl.style.backgroundImage = media.thumbnail ? `url("${media.thumbnail}")` : '';
        platformEl.textContent = media.platform ? media.platform.charAt(0).toUpperCase() + media.platform.slice(1) : 'External';

        // Icon based on state
        const iconPath = media.isPlaying 
            ? 'assets/svgs-fontawesome/solid/pause.svg'
            : 'assets/svgs-fontawesome/solid/play.svg';
        renderInlineIcon(iconEl, iconPath);
    }

    // Toggle Play/Pause on click
    widget.addEventListener('click', (e) => {
        // e.stopPropagation(); // Should we stop prop? Maybe not.
        chrome.runtime.sendMessage({ 
            type: 'MEDIA_CONTROL', 
            action: currentMedia && currentMedia.isPlaying ? 'pause' : 'play' 
        });
        
        // Optimistic update
        if (currentMedia) {
            currentMedia.isPlaying = !currentMedia.isPlaying;
            updateUI(currentMedia);
        }
    });

    // Listen for updates
    chrome.runtime.onMessage.addListener((message) => {
        if (message.type === 'MEDIA_UPDATE' || message.type === 'MEDIA_PRESENCE') {
            updateUI(message.data);
            
            // Auto hide if paused for long? Maybe not, user might want to resume.
            // But if we haven't heard from it in a while...
            // presence is sent every 3s.
            if (hideTimer) clearTimeout(hideTimer);
            hideTimer = setTimeout(() => {
                // If no updates/presence for 10s, maybe user closed tab?
                // Or video ended.
                // Let's not auto-hide too aggressively. 
                // widget.classList.remove('active'); 
            }, 10000);
        }
    });

    // Initial Query (in case media is already playing)
    // We need to send this to content scripts. service.js should route it?
    // service.js doesn't have MEDIA_QUERY routing in our update. 
    // But content scripts listen to it.
    // We can try broadcasting.
    // chrome.runtime.sendMessage({ type: 'MEDIA_QUERY' });
}
