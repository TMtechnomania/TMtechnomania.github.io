import { renderInlineIcon } from './brandIconLoader.js';
import {
    MEDIA_UPDATE,
    MEDIA_PRESENCE,
    MEDIA_QUERY,
    MEDIA_CONTROL
} from './messageTypes.js';

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
            type: MEDIA_CONTROL, 
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
        if (message.type === MEDIA_UPDATE || message.type === MEDIA_PRESENCE) {
            updateUI(message.data);
            // No silence-based auto-hide: the service worker explicitly
            // broadcasts MEDIA_UPDATE with data:null when a media tab is
            // closed or navigates away, which deactivates the widget.
        }
    });

    // Initial query (in case media is already playing): service.js routes
    // MEDIA_QUERY to all tabs; content scripts answer with a fresh
    // MEDIA_UPDATE, so the widget no longer shows "No Media" for ~3s.
    chrome.runtime.sendMessage({ type: MEDIA_QUERY }).catch(() => {});
}
