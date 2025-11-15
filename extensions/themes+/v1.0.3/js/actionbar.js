export async function renderActionbar(actionCfg = {}) {
	try {
		const actionbar = document.getElementById('actionbar');
		const actioncontent = document.getElementById('actioncontent');
		if (!actionbar || !actioncontent) return;

		// Clear existing content
		actioncontent.innerHTML = '';

		// Set initial position based on autohide by toggling classes (avoid inline style)
		const autohide = actionCfg.autohide !== false; // Default true
		if (autohide) {
			actionbar.classList.add('autohide');
			actionbar.classList.remove('no-autohide');
		} else {
			actionbar.classList.remove('autohide');
			actionbar.classList.add('no-autohide');
		}

		// Example items: Settings button, separator, Quick shortcuts
		const settingsBtn = document.createElement('button');
		settingsBtn.className = 'action-item';
		settingsBtn.textContent = 'Settings';
		settingsBtn.addEventListener('click', () => {
			// TODO: Open settings panel
			console.log('Open settings');
		});

		const separator = document.createElement('div');
		separator.className = 'action-separator';

		const shortcut1 = document.createElement('button');
		shortcut1.className = 'action-item';
		shortcut1.innerHTML = '<img src="assets/icons/example-icon.svg" alt="Shortcut">Shortcut 1';
		shortcut1.addEventListener('click', () => {
			window.open('https://example.com', '_blank');
		});

		// Add items to actioncontent
		actioncontent.appendChild(settingsBtn);
		actioncontent.appendChild(separator);
		actioncontent.appendChild(shortcut1);

		console.log('Action bar rendered, autohide:', autohide);
	} catch (e) {
		console.error('Failed to render action bar', e);
	}
}