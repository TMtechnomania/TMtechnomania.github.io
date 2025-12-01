import { renderInlineIcon } from './brandIconLoader.js';

export function setupFullscreenToggle() {
	const fullscreenToggle = document.getElementById('fullscreen-toggle');
	if (!fullscreenToggle) {
		console.warn('Fullscreen toggle element not found');
		return;
	}

	fullscreenToggle.addEventListener('click', async () => {
		try {
			if (document.fullscreenElement) {
				await document.exitFullscreen();
			} else {
				await document.documentElement.requestFullscreen();
			}
		} catch (e) {
			console.error('Failed to toggle fullscreen', e);
		}
	});

	document.addEventListener('fullscreenchange', () => {
		const isFullscreen = !!document.fullscreenElement;
		const icon = fullscreenToggle.querySelector('.ui-icon');
		if (icon) {
			const path = isFullscreen
				? 'assets/svgs-fontawesome/solid/compress.svg'
				: 'assets/svgs-fontawesome/solid/expand.svg';
			renderInlineIcon(icon, path);
		}
	});
}
