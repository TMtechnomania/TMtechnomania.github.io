import { loadCSS, unloadCSS } from './cssLoader.js';
const CSS_ID = 'timer-modal-css';
const CSS_PATH = 'css/timerModal.css';
const AUDIO_SRC = 'assets/audio/mixkit-positive-interface-beep-221.wav';
let _backdrop = null;
let _state = {
    mode: 'timer',
    timerRemaining: 0,
    timerRunning: false,
    stopwatchTime: 0,
    stopwatchRunning: false,
    stopwatchLaps: [],
    timerInterval: null,
    stopwatchInterval: null,
    audio: null,
};
const PRESETS = [
    { id: 'p_coffee', title: 'Coffee brew', seconds: 300 },
    { id: 'p_tea', title: 'Tea steep', seconds: 180 },
    { id: 'p_workout', title: 'Quick workout', seconds: 600 },
    { id: 'p_focus', title: 'Focus (Pomodoro)', seconds: 1500 }
];
function formatTimeMs(ms, showMs = false) {
    const total = Math.max(0, Math.floor(ms));
    const s = Math.floor(total / 1000);
    const minutes = Math.floor(s / 60);
    const seconds = s % 60;
    const remMs = total % 1000;
    return showMs ? `${String(minutes).padStart(2,'0')}:${String(seconds).padStart(2,'0')}.${String(Math.floor(remMs/10)).padStart(2,'0')}` : `${String(minutes).padStart(2,'0')}:${String(seconds).padStart(2,'0')}`;
}
function parseTimeInput(str) {
    if (!str) return 0;
    const s = String(str).trim().toLowerCase();
    if (s.includes(':')) {
        const parts = s.split(':').map(p => p.trim());
        if (parts.length === 2) {
            const m = parseInt(parts[0], 10) || 0;
            const sec = parseInt(parts[1], 10) || 0;
            return (m * 60 + sec) * 1000;
        }
        if (parts.length === 3) {
            const h = parseInt(parts[0], 10) || 0;
            const m = parseInt(parts[1], 10) || 0;
            const sec = parseInt(parts[2], 10) || 0;
            return (h * 3600 + m * 60 + sec) * 1000;
        }
    }
    const match = s.match(/^([0-9]+)\s*(m|s)?$/);
    if (match) {
        const val = parseInt(match[1], 10) || 0;
        if (match[2] === 'm') return val * 60 * 1000;
        return val * 1000;
    }
    const num = parseInt(s, 10);
    if (!isNaN(num)) return num * 1000;
    return null;
}
async function openTimerModal() {
    if (_backdrop) {
        try { _backdrop.querySelector('.timer-modal').focus(); } catch (e) {}
        return;
    }
    try { if (_state.timerInterval) { clearInterval(_state.timerInterval); _state.timerInterval = null; } } catch (e) {}
    try { if (_state.stopwatchInterval) { clearInterval(_state.stopwatchInterval); _state.stopwatchInterval = null; } } catch (e) {}
    try { if (_state.audio) { _state.audio.pause(); _state.audio.currentTime = 0; } } catch (e) {}
    _state.timerRunning = false;
    _state.stopwatchRunning = false;
    if (typeof _state.alertEnabled === 'undefined') _state.alertEnabled = true;
    await loadCSS(CSS_PATH, CSS_ID);
    try {
        const raw = localStorage.getItem('timer_last_laps');
        if (raw) _state.stopwatchLaps = JSON.parse(raw).slice(-3);
    } catch (e) { }
    _backdrop = document.createElement('div');
    _backdrop.className = 'timer-modal-backdrop';
    const modal = document.createElement('div');
    modal.id = 'timer-modal';
    modal.className = 'timer-modal';
    modal.setAttribute('role','dialog');
    modal.setAttribute('aria-modal','true');
    modal.tabIndex = -1;
    const close = document.createElement('div');
    close.className = 'tm-close';
    close.innerHTML = '<img src="assets/icons/Delete--Streamline-Outlined-Material-Symbols.svg" alt="Close"/>';
    close.addEventListener('click', closeTimerModal);
    modal.appendChild(close);
    const body = document.createElement('div'); body.className='timer-body';
        const displayWrap = document.createElement('div'); displayWrap.className = 'timer-display-wrap';
        const display = document.createElement('div'); display.className='timer-display'; display.id='timer-display'; display.textContent='00:00';
        const editBtn = document.createElement('button'); editBtn.className = 'tm-btn edit-btn'; editBtn.id = 'tm-edit';
        editBtn.title = 'Edit time';
        editBtn.innerHTML = `<img src="assets/icons/Edit-Note--Streamline-Outlined-Material-Symbols.svg" alt="Edit">`;
        displayWrap.appendChild(display);
        displayWrap.appendChild(editBtn);
        body.append(displayWrap);
        const presets = document.createElement('div'); presets.className='presets'; presets.id='timer-presets';
    PRESETS.forEach(p => {
        const btn = document.createElement('div'); btn.className='preset-btn';
        btn.innerHTML = `<div>${p.title}</div><div>${Math.floor(p.seconds/60)}:${String(p.seconds%60).padStart(2,'0')}</div>`;
        btn.id = `preset-${p.id}`;
        btn.addEventListener('click', () => {
            try {
                _state.editing = false;
                display.contentEditable = 'false';
                display.classList.remove('editing');
                editBtn.innerHTML = `<img src="assets/icons/Edit-Note--Streamline-Outlined-Material-Symbols.svg" alt="Edit">`;
            } catch (e) {}
            _state.timerRemaining = p.seconds * 1000;
            updateDisplay();
            try { const el = document.getElementById('tm-start-pause'); if (el) el.innerHTML = `<img src="assets/icons/Play-Circle--Streamline-Outlined-Material-Symbols.svg" alt="Start">`; } catch (e) {}
        });
        presets.appendChild(btn);
    });
    body.appendChild(presets);
    const saveIcon = 'assets/icons/Save--Streamline-Outlined-Material-Symbols.svg';
    editBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (!_state.editing) {
            _state.editing = true;
            try { pauseTimer(); } catch (e) {}
            try { display.contentEditable = 'true'; display.classList.add('editing'); } catch (e) {}
            try {
                editBtn.innerHTML = `<img src="${saveIcon}" alt="Save">`;
                const sp = document.getElementById('tm-start-pause'); if (sp) sp.disabled = true;
            } catch (e) {}
            try { display.focus();
                const range = document.createRange(); range.selectNodeContents(display);
                const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
            } catch (e) {}
            return;
        }
        const ms = parseTimeInput(display.textContent);
        if (ms === null) {
            try { alert('Please enter a valid time (mm:ss or seconds).'); } catch (e) {}
            return;
        }
        _state.timerRemaining = ms;
        _state.editing = false;
        try { display.contentEditable = 'false'; display.classList.remove('editing'); } catch (e) {}
        try { editBtn.innerHTML = `<img src="assets/icons/Edit-Note--Streamline-Outlined-Material-Symbols.svg" alt="Edit">`; } catch (e) {}
        updateDisplay();
        try { const sp = document.getElementById('tm-start-pause'); if (sp) sp.disabled = !(_state.timerRemaining > 0); } catch (e) {}
    });
    display.addEventListener('keydown', (ev) => {
        if (!_state.editing) return;
        if (ev.key === 'Enter') {
            ev.preventDefault();
            try { editBtn.click(); } catch (e) {}
        }
        if (ev.key === 'Escape') {
            _state.editing = false;
            try { display.contentEditable = 'false'; display.classList.remove('editing'); } catch (e) {}
            try { editBtn.innerHTML = `<img src="assets/icons/Edit-Note--Streamline-Outlined-Material-Symbols.svg" alt="Edit">`; } catch (e) {}
            try { const sp = document.getElementById('tm-start-pause'); if (sp) sp.disabled = !(_state.timerRemaining > 0); } catch (e) {}
            updateDisplay();
        }
    });
    const controls = document.createElement('div'); controls.className='timer-controls action-group'; controls.id = 'timer-controls';
    const startPauseBtn = document.createElement('button'); startPauseBtn.className='tm-btn action-item'; startPauseBtn.id='tm-start-pause';
    startPauseBtn.innerHTML = `<img src="assets/icons/Play-Circle--Streamline-Outlined-Material-Symbols.svg" alt="Start">`;
    const resetBtn = document.createElement('button'); resetBtn.className='tm-btn action-item'; resetBtn.id='tm-reset'; resetBtn.innerHTML = `<img src="assets/icons/Restart-Alt--Streamline-Outlined-Material-Symbols.svg" alt="Reset">`;
    const alertBtn = document.createElement('button'); alertBtn.className = 'tm-btn action-item alert-btn'; alertBtn.id = 'tm-alert';
    alertBtn.title = 'Alert on/off';
    alertBtn.setAttribute('aria-pressed', String(!!_state.alertEnabled));
    const volOn = 'assets/icons/Volume-Up--Streamline-Outlined-Material-Symbols.svg';
    const volOff = 'assets/icons/Volume-Off--Streamline-Outlined-Material-Symbols.svg';
    alertBtn.innerHTML = `<img src="${_state.alertEnabled ? volOn : volOff}" alt="Alert">`;
    controls.appendChild(startPauseBtn);
    controls.appendChild(resetBtn);
    controls.appendChild(alertBtn);
    body.appendChild(controls);
    try { document.getElementById('tm-start-pause').disabled = _state.editing || !(_state.timerRemaining > 0); } catch (e) {}
    if (_state.alertEnabled) alertBtn.classList.add('active'); else alertBtn.classList.remove('active');
    const swLaps = document.createElement('div'); swLaps.className='stopwatch-laps'; swLaps.id='stopwatch-laps';
    body.appendChild(swLaps);
    const swControls = document.createElement('div'); swControls.className='timer-controls action-group'; swControls.id = 'stopwatch-controls';
    const swStart = document.createElement('button'); swStart.className='tm-btn action-item'; swStart.id='sw-start'; swStart.innerHTML=`<img src="assets/icons/Play-Circle--Streamline-Outlined-Material-Symbols.svg" alt="Play">`;
    const swLap = document.createElement('button'); swLap.className='tm-btn action-item'; swLap.id='sw-lap'; swLap.innerHTML=`<img src="assets/icons/Avg-Time--Streamline-Outlined-Material-Symbols.svg" alt="Lap">`;
    const swReset = document.createElement('button'); swReset.className='tm-btn action-item'; swReset.id='sw-reset'; swReset.innerHTML=`<img src="assets/icons/Restart-Alt--Streamline-Outlined-Material-Symbols.svg" alt="Reset">`;
    swControls.appendChild(swStart); swControls.appendChild(swLap); swControls.appendChild(swReset);
    body.appendChild(swControls);
    modal.appendChild(body);
    const tabs = document.createElement('div');
    tabs.className = 'timer-tabs';
    const t1 = document.createElement('div'); t1.className='timer-tab active'; t1.id='tab-timer'; t1.textContent='Timer';
    const t2 = document.createElement('div'); t2.className='timer-tab'; t2.id='tab-stopwatch'; t2.textContent='Stopwatch';
    tabs.appendChild(t1); tabs.appendChild(t2);
    modal.appendChild(tabs);
    _backdrop.appendChild(modal);
    document.body.appendChild(_backdrop);
    _state.audio = new Audio(AUDIO_SRC);
    _state.audio.loop = true;
    t1.addEventListener('click', () => switchMode('timer', modal));
    t2.addEventListener('click', () => switchMode('stopwatch', modal));
    startPauseBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (_state.editing) return;
        const el = document.getElementById('tm-start-pause');
        if (_state.timerRunning) {
            pauseTimer();
            if (el) el.innerHTML = `<img src="assets/icons/Play-Circle--Streamline-Outlined-Material-Symbols.svg" alt="Start">`;
        } else {
            startTimer();
            if (el) el.innerHTML = `<img src="assets/icons/Pause-Circle--Streamline-Outlined-Material-Symbols.svg" alt="Pause">`;
        }
    });
    resetBtn.addEventListener('click', resetTimer);
    swStart.addEventListener('click', toggleStopwatch);
    swLap.addEventListener('click', recordLap);
    swReset.addEventListener('click', resetStopwatch);
    _state.alertEnabled = true;
    alertBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        _state.alertEnabled = !_state.alertEnabled;
        alertBtn.classList.toggle('active', _state.alertEnabled);
        alertBtn.setAttribute('aria-pressed', String(!!_state.alertEnabled));
        try {
            const img = alertBtn.querySelector('img');
            if (img) img.src = _state.alertEnabled ? volOn : volOff;
        } catch (e) {}
    });
    _backdrop.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') closeTimerModal(); });
    switchMode(_state.mode, modal);
    updateDisplay();
    renderLaps();
    try { modal.focus(); } catch (e) {}
}
function closeTimerModal() {
    if (!_backdrop) return;
    clearInterval(_state.timerInterval); _state.timerInterval = null;
    clearInterval(_state.stopwatchInterval); _state.stopwatchInterval = null;
    try { document.body.removeChild(_backdrop); } catch (e) {}
    _backdrop = null;
    try { unloadCSS(CSS_ID); } catch (e) {}
    try { if (_state.audio) { _state.audio.pause(); _state.audio.currentTime = 0; } } catch (e) {}
    try { document.dispatchEvent(new CustomEvent('timer:closed')); } catch (e) {}
}
export function toggleTimerModal() {
    if (_backdrop) {
        closeTimerModal();
    } else {
        openTimerModal();
    }
}
function switchMode(mode, modal) {
    _state.mode = mode;
    const t1 = modal.querySelector('#tab-timer');
    const t2 = modal.querySelector('#tab-stopwatch');
    if (t1 && t2) {
        t1.classList.toggle('active', mode === 'timer');
        t2.classList.toggle('active', mode === 'stopwatch');
    }
    const presets = modal.querySelector('#timer-presets');
    const laps = modal.querySelector('#stopwatch-laps');
    const timerControls = modal.querySelector('#timer-controls');
    const stopwatchControls = modal.querySelector('#stopwatch-controls');
    const custom = modal.querySelector('#custom-time-row');
    const editBtn = modal.querySelector('#tm-edit');
    if (presets) presets.style.display = mode === 'timer' ? '' : 'none';
    if (laps) laps.style.display = mode === 'stopwatch' ? '' : 'none';
    if (timerControls) timerControls.style.display = mode === 'timer' ? '' : 'none';
    if (stopwatchControls) stopwatchControls.style.display = mode === 'stopwatch' ? '' : 'none';
    if (custom) custom.style.display = mode === 'timer' ? '' : 'none';
    try { if (editBtn) editBtn.style.display = mode === 'timer' ? '' : 'none'; } catch (e) {}
    if (mode === 'stopwatch' && _state.editing) {
        _state.editing = false;
        try { const disp = modal.querySelector('#timer-display'); if (disp) { disp.contentEditable = 'false'; disp.classList.remove('editing'); } } catch (e) {}
        try { const sp = modal.querySelector('#tm-start-pause'); if (sp) { sp.innerHTML = `<img src="assets/icons/Play-Circle--Streamline-Outlined-Material-Symbols.svg" alt="Start">`; sp.disabled = !(_state.timerRemaining > 0); } } catch (e) {}
        try { if (editBtn) editBtn.innerHTML = `<img src="assets/icons/Edit-Note--Streamline-Outlined-Material-Symbols.svg" alt="Edit">`; } catch (e) {}
    }
    updateDisplay();
}
function updateDisplay() {
    const disp = document.getElementById('timer-display');
    if (!disp) return;
    if (_state.mode === 'timer') {
        if (!_state.editing) disp.textContent = formatTimeMs(_state.timerRemaining, false);
        try {
            const sp = document.getElementById('tm-start-pause');
            if (sp) sp.disabled = _state.editing || !(_state.timerRemaining > 0);
        } catch (e) {}
    } else {
        disp.textContent = formatTimeMs(_state.stopwatchTime, true);
    }
}
function startTimer() {
    if (_state.timerRunning) return;
    if (!(_state.timerRemaining > 0)) return;
    _state.timerRunning = true;
    const start = Date.now();
    const endBase = Date.now() + _state.timerRemaining;
    _state.timerInterval = setInterval(() => {
        _state.timerRemaining = Math.max(0, endBase - Date.now());
        updateDisplay();
        if (_state.timerRemaining <= 0) {
            clearInterval(_state.timerInterval); _state.timerInterval = null; _state.timerRunning = false;
            try { if (_state.audio && _state.alertEnabled) _state.audio.play(); } catch (e) {}
            try { const el = document.getElementById('tm-start-pause'); if (el) el.innerHTML = `<img src="assets/icons/Play-Circle--Streamline-Outlined-Material-Symbols.svg" alt="Start">`; } catch (e) {}
        }
    }, 200);
}
function pauseTimer() {
    if (!_state.timerRunning) return;
    _state.timerRunning = false;
    clearInterval(_state.timerInterval);
    _state.timerInterval = null;
    try { const el = document.getElementById('tm-start-pause'); if (el) el.innerHTML = `<img src="assets/icons/Play-Circle--Streamline-Outlined-Material-Symbols.svg" alt="Start">`; } catch (e) {}
}
function resetTimer() {
    _state.timerRunning = false;
    clearInterval(_state.timerInterval);
    _state.timerInterval = null;
    _state.timerRemaining = 0;
    try { if (_state.audio) { _state.audio.pause(); _state.audio.currentTime = 0; } } catch (e) {}
    updateDisplay();
    try { const el = document.getElementById('tm-start-pause'); if (el) { el.innerHTML = `<img src="assets/icons/Play-Circle--Streamline-Outlined-Material-Symbols.svg" alt="Start">`; el.disabled = true; } } catch (e) {}
}
function toggleStopwatch() {
    if (_state.stopwatchRunning) {
        _state.stopwatchRunning = false;
        clearInterval(_state.stopwatchInterval);
        _state.stopwatchInterval = null;
    } else {
        _state.stopwatchRunning = true;
        const last = Date.now();
        const startTime = Date.now() - _state.stopwatchTime;
        _state.stopwatchInterval = setInterval(() => {
            _state.stopwatchTime = Date.now() - startTime;
            updateDisplay();
        }, 50);
    }
}
function recordLap() {
    if (!_state.stopwatchRunning) return;
    const val = _state.stopwatchTime;
    _state.stopwatchLaps.push(val);
    _state.stopwatchLaps = _state.stopwatchLaps.slice(-3);
    try { localStorage.setItem('timer_last_laps', JSON.stringify(_state.stopwatchLaps)); } catch (e) {}
    renderLaps();
}
function resetStopwatch() {
    _state.stopwatchRunning = false;
    clearInterval(_state.stopwatchInterval);
    _state.stopwatchInterval = null;
    _state.stopwatchTime = 0;
    _state.stopwatchLaps = [];
    try { localStorage.removeItem('timer_last_laps'); } catch (e) {}
    renderLaps();
    updateDisplay();
}
function renderLaps() {
    const cont = document.getElementById('stopwatch-laps');
    if (!cont) return;
    cont.innerHTML = '';
    if (!_state.stopwatchLaps || _state.stopwatchLaps.length === 0) {
        const none = document.createElement('div'); none.className='lap-list-empty'; none.textContent='No laps yet'; cont.appendChild(none); return;
    }
    _state.stopwatchLaps.slice().reverse().forEach((ms, idx) => {
        const item = document.createElement('div'); item.className='lap-item';
        const label = document.createElement('div'); label.textContent = `Lap ${_state.stopwatchLaps.length - idx}`;
        const time = document.createElement('div'); time.textContent = formatTimeMs(ms, true);
        item.appendChild(label); item.appendChild(time); cont.appendChild(item);
    });
}
export function showTimerModal() { openTimerModal(); }
export function closeTimerModalIfOpen() { closeTimerModal(); }
