import { loadCSS, unloadCSS } from './cssLoader.js';
import { renderInlineIcon } from './brandIconLoader.js';

const CSS_ID = 'alarm-modal-css';
const CSS_PATH = 'css/alarmModal.css';
const AUDIO_SRC = 'assets/audio/mixkit-positive-interface-beep-221.wav';
const STORAGE_KEY = 'alarms_list_v1';
const PERMISSION_FLAG = 'alarms_permission_requested';
const MAX_ALARMS = 3;

function createIconSpan(iconPath, className = '') {
    const icon = document.createElement('span');
    icon.className = ['ui-icon', className].filter(Boolean).join(' ');
    icon.setAttribute('aria-hidden', 'true');
    renderInlineIcon(icon, iconPath);
    return icon;
}

function addIconWithLabel(target, iconPath, labelText = '', className = 'tm-btn-icon') {
    const icon = createIconSpan(iconPath, className);
    target.appendChild(icon);
    if (labelText) {
        const span = document.createElement('span');
        span.textContent = labelText;
        target.appendChild(span);
    }
    return icon;
}

let _backdrop = null;
let _state = {
    alarms: [],
    scheduled: {},
    audio: null,
    permissionAsked: false,
};

function checkPendingAlarm() {
    try {
        chrome.storage.local.get('alarm_firing', (result) => {
            if (result.alarm_firing) {
                if (!_state.audio) {
                    _state.audio = new Audio(AUDIO_SRC);
                    _state.audio.loop = false;
                    _state.audio.addEventListener('ended', () => {
                        if (_state.audio) {
                            _state.audio.currentTime = 0;
                            _state.audio.play().catch(() => {});
                        }
                    });
                }
                _state.audio.currentTime = 0;
                _state.audio.play().catch(() => {});
                chrome.storage.local.set({ 'alarm_firing': false });
            }
        });
    } catch (e) {}
}

checkPendingAlarm();

try {
    if (navigator && navigator.serviceWorker && navigator.serviceWorker.addEventListener) {
        navigator.serviceWorker.addEventListener('message', (ev) => {
            try {
                const d = ev.data || {};
                if (d && d.action === 'alarm:fired') {
                    try {
                        if (_state.audio) {
                            _state.audio.currentTime = 0;
                            _state.audio.play().catch(() => {});
                        }
                    } catch (e) {}
                } else if (d && d.action === 'alarm:stop') {
                    try { if (_state.audio) { _state.audio.pause(); _state.audio.currentTime = 0; } } catch (e) {}
                }
            } catch (e) {}
        });
    }
} catch (e) {}

function hasChromeAlarmsPermission() {
    return new Promise((resolve) => {
        try {
            if (!chrome || !chrome.permissions || !chrome.permissions.contains) return resolve(false);
            chrome.permissions.contains({ permissions: ['alarms'] }, (res) => resolve(!!res));
        } catch (e) { resolve(false); }
    });
}

function createChromeAlarmFor(alarm) {
    try {
        if (!chrome || !chrome.alarms || !chrome.alarms.create) return;
        const now = new Date();
        let target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), alarm.hour, alarm.minute, 0, 0);
        if (target <= now) target.setDate(target.getDate() + 1);
        const when = target.getTime();
        if (alarm.frequency === 'daily') {
            chrome.alarms.create(alarm.id, { when, periodInMinutes: 1440 });
        } else {
            chrome.alarms.create(alarm.id, { when });
        }
    } catch (e) {}
}

function clearChromeAlarm(id) {
    try { if (chrome && chrome.alarms && chrome.alarms.clear) chrome.alarms.clear(id, ()=>{}); } catch (e) {}
}

function loadState() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) _state.alarms = JSON.parse(raw) || [];
    } catch (e) { _state.alarms = []; }
    try { _state.permissionAsked = !!localStorage.getItem(PERMISSION_FLAG); } catch (e) { _state.permissionAsked = false; }
}

function saveState() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(_state.alarms || [])); } catch (e) {}
}

function uid(prefix='a') { return `${prefix}_${Date.now().toString(36)}_${Math.floor(Math.random()*1000)}`; }

function formatTime(h,m){
    const hh = String(h).padStart(2,'0'); const mm = String(m).padStart(2,'0');
    return `${hh}:${mm}`;
}

function parseTimeValue(val){
    if (!val) return null;
    const parts = val.split(':'); if (parts.length < 2) return null;
    const h = parseInt(parts[0],10)||0; const m = parseInt(parts[1],10)||0; return {h,m};
}

function scheduleAlarm(alarm, modal) {
    clearScheduled(alarm.id);
    clearChromeAlarm(alarm.id);
    if (!alarm.on) return;
    hasChromeAlarmsPermission().then((has) => {
        if (has) {
            createChromeAlarmFor(alarm);
            return;
        }
        try {
            const now = new Date();
            const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), alarm.hour, alarm.minute, 0, 0);
            if (target <= now) target.setDate(target.getDate() + 1);
            if (alarm.frequency === 'weekdays') {
                while (target.getDay() === 0 || target.getDay() === 6) target.setDate(target.getDate() + 1);
            }
            const delay = Math.max(0, target - now);
            const tid = setTimeout(() => {
                triggerAlarm(alarm, modal);
                if (alarm.frequency === 'daily' || alarm.frequency === 'weekdays') {
                    if (alarm.frequency === 'daily') {
                        scheduleAlarm(alarm, modal);
                    } else {
                        let next = new Date(); next.setHours(alarm.hour, alarm.minute, 0, 0); next.setDate(next.getDate() + 1);
                        while (next.getDay() === 0 || next.getDay() === 6) next.setDate(next.getDate() + 1);
                        const d = Math.max(0, next - new Date());
                        _state.scheduled[alarm.id] = setTimeout(() => { triggerAlarm(alarm, modal); scheduleAlarm(alarm, modal); }, d);
                    }
                } else {
                    alarm.on = false; saveState(); renderAlarms(modal);
                }
            }, delay);
            _state.scheduled[alarm.id] = tid;
        } catch (e) {}
    }).catch(()=>{});
}

function clearScheduled(id) { try { const t = _state.scheduled[id]; if (t) clearTimeout(t); delete _state.scheduled[id]; } catch (e) {} }

function triggerAlarm(alarm, modal) {
    try {
        if (_state.audio) {
            _state.audio.currentTime = 0;
            _state.audio.play().catch(() => {});
        }
    } catch (e) {}
    try {
        if (window.Notification && Notification.permission === 'granted') {
            new Notification(alarm.label || 'Alarm', { body: `Alarm ${formatTime(alarm.hour,alarm.minute)}`, icon: chrome.runtime.getURL('icons/icon128.png'), silent: false });
        }
    } catch (e) {}
}

function renderAlarms(modal) {
    const list = modal.querySelector('#alarms-list'); if (!list) return;
    list.innerHTML = '';
    if (!_state.alarms || _state.alarms.length === 0) {
        const none = document.createElement('div'); none.className='alarm-empty'; none.textContent='No alarms yet'; list.appendChild(none); return;
    }
    _state.alarms.forEach(al => {
        const item = document.createElement('div'); item.className='alarm-item'; item.dataset.id = al.id;
        const left = document.createElement('div'); left.className='alarm-left';
        const label = document.createElement('div'); label.className='alarm-label'; label.textContent = al.label || 'Alarm';
        const time = document.createElement('div'); time.className='alarm-time'; time.textContent = formatTime(al.hour, al.minute);
        const freq = document.createElement('div'); freq.className='alarm-freq'; freq.textContent = al.frequency === 'once' ? 'Once' : (al.frequency==='daily'?'Daily':'Weekdays');
        left.appendChild(label); left.appendChild(time); left.appendChild(freq);
        const right = document.createElement('div'); right.className='alarm-right';
        const toggle = document.createElement('button'); toggle.className='tm-btn alarm-toggle round'; toggle.title = al.on ? 'Disable' : 'Enable';
        toggle.setAttribute('aria-pressed', al.on ? 'true' : 'false');
        const checkIcon = 'assets/svgs-fontawesome/solid/square-check.svg';
        const uncheckIcon = 'assets/svgs-fontawesome/regular/square.svg';
        addIconWithLabel(toggle, al.on ? checkIcon : uncheckIcon);
        toggle.addEventListener('click', (ev)=>{
            al.on = !al.on; saveState(); renderAlarms(modal);
            if (al.on) scheduleAlarm(al, modal); else { clearScheduled(al.id); clearChromeAlarm(al.id); }
        });
        const edit = document.createElement('button'); edit.className='tm-btn alarm-edit round'; edit.title='Edit';
        addIconWithLabel(edit, 'assets/svgs-fontawesome/regular/pen-to-square.svg');
        edit.addEventListener('click', ()=> openEditForm(modal, al));
        const del = document.createElement('button'); del.className='tm-btn alarm-del round'; del.title='Delete';
        addIconWithLabel(del, 'assets/svgs-fontawesome/regular/circle-xmark.svg');
        del.addEventListener('click', ()=> { _state.alarms = _state.alarms.filter(x=>x.id!==al.id); clearScheduled(al.id); clearChromeAlarm(al.id); saveState(); renderAlarms(modal); });
        right.appendChild(toggle); right.appendChild(edit); right.appendChild(del);
        item.appendChild(left); item.appendChild(right); list.appendChild(item);
    });
    try { const addBtn = modal.querySelector('#alarm-add'); if (addBtn) addBtn.disabled = _state.alarms.length >= MAX_ALARMS; } catch (e) {}
}

function openEditForm(modal, alarm) {
    const existing = modal.querySelector('.alarm-form'); if (existing) existing.remove();
    const form = document.createElement('div'); form.className='alarm-form';
    const label = document.createElement('input'); label.type='text'; label.placeholder='Label'; label.value = alarm ? (alarm.label||'') : '';
    const time = document.createElement('input'); time.type='time'; time.value = alarm ? formatTime(alarm.hour,alarm.minute) : '07:00';
    const freq = document.createElement('select'); freq.innerHTML = `<option value="once">Once</option><option value="daily">Daily</option><option value="weekdays">Weekdays</option>`; freq.value = alarm ? alarm.frequency : 'once';
    const row = document.createElement('div'); row.className='alarm-form-row';
    const save = document.createElement('button'); save.className='tm-btn'; save.title='Save'; addIconWithLabel(save, 'assets/svgs-fontawesome/regular/floppy-disk.svg', 'Save');
    const cancel = document.createElement('button'); cancel.className='tm-btn'; cancel.title='Cancel'; addIconWithLabel(cancel, 'assets/svgs-fontawesome/regular/circle-xmark.svg', 'Cancel');
    row.appendChild(save); row.appendChild(cancel);
    form.appendChild(label); form.appendChild(time); form.appendChild(freq); form.appendChild(row);
    modal.querySelector('.alarm-body').appendChild(form);
    cancel.addEventListener('click', ()=> { form.remove(); });
    save.addEventListener('click', ()=>{
        const tv = parseTimeValue(time.value);
        if (!tv) { alert('Please choose a valid time'); return; }
        if (alarm) {
            alarm.label = label.value; alarm.hour = tv.h; alarm.minute = tv.m; alarm.frequency = freq.value; saveState(); renderAlarms(modal); scheduleAlarm(alarm, modal);
        } else {
            const newA = { id: uid('al'), label: label.value, hour: tv.h, minute: tv.m, frequency: freq.value||'once', on: true };
            _state.alarms.push(newA); saveState(); renderAlarms(modal); scheduleAlarm(newA, modal);
        }
        form.remove();
    });
}

async function openAlarmModal() {
    if (_backdrop) { try { _backdrop.querySelector('.alarm-modal').focus(); } catch(e){}; return; }
    loadState();
    await loadCSS(CSS_PATH, CSS_ID);
    _backdrop = document.createElement('div'); _backdrop.className='alarm-modal-backdrop';
    const modal = document.createElement('div'); modal.id='alarm-modal'; modal.className='alarm-modal'; modal.tabIndex=-1; modal.setAttribute('role','dialog');
    const close = document.createElement('div'); close.className='tm-close';
    close.appendChild(createIconSpan('assets/svgs-fontawesome/regular/circle-xmark.svg'));
    close.addEventListener('click', closeAlarmModal);
    modal.appendChild(close);
    const header = document.createElement('div'); header.className='alarm-header'; header.innerHTML = `<h3>Alarms</h3>`;
    modal.appendChild(header);
    const permArea = document.createElement('div'); permArea.className='alarm-permission';
    const permText = document.createElement('div'); permText.className='perm-text';
    if (window.Notification && Notification.permission !== 'granted' && !_state.permissionAsked) {
        permText.textContent = 'Enable notifications to allow alarms to show notifications (optional).';
        const permBtn = document.createElement('button'); permBtn.className='tm-btn'; permBtn.title='Enable Notifications';
        addIconWithLabel(permBtn, 'assets/svgs-fontawesome/regular/bell.svg', 'Enable Notifications');
        permBtn.addEventListener('click', async ()=>{
            try { const res = await Notification.requestPermission(); localStorage.setItem(PERMISSION_FLAG,'1'); _state.permissionAsked = true; permArea.remove(); } catch (e) { localStorage.setItem(PERMISSION_FLAG,'1'); _state.permissionAsked = true; permArea.remove(); }
        });
        permArea.appendChild(permText); permArea.appendChild(permBtn);
        modal.appendChild(permArea);
    }

    try {
        if (chrome && chrome.permissions && chrome.permissions.contains) {
            chrome.permissions.contains({ permissions: ['alarms'] }, (has) => {
                if (!has) {
                    const btn = document.createElement('button'); btn.className='tm-btn'; btn.title = 'Enable Background Alarms';
                    addIconWithLabel(btn, 'assets/svgs-fontawesome/regular/bell.svg', 'Enable Background Alarms');
                    btn.addEventListener('click', () => {
                        try {
                            chrome.permissions.request({ permissions: ['alarms', 'notifications'] }, (granted) => {
                                if (granted) {
                                    _state.alarms.forEach(a => { if (a.on) createChromeAlarmFor(a); });
                                    try { btn.remove(); } catch (e) {}
                                } else {
                                    try { alert('Background alarm permission not granted. Alarms will run while this page is open.'); } catch (e) {}
                                }
                            });
                        } catch (e) {}
                    });
                    modal._requestAlarmsBtn = btn;
                }
            });
        }
    } catch (e) {}

    const body = document.createElement('div'); body.className='alarm-body';
    const list = document.createElement('div'); list.id='alarms-list'; list.className='alarms-list';
    body.appendChild(list);
    const controls = document.createElement('div'); controls.className='alarm-controls';
    const add = document.createElement('button'); add.id='alarm-add'; add.className='tm-btn'; add.title='Add Alarm';
    addIconWithLabel(add, 'assets/svgs-fontawesome/solid/plus.svg', 'Add');
    add.addEventListener('click', ()=> openEditForm(modal, null));
    const test = document.createElement('button'); test.className='tm-btn'; test.title='Test Alarm';
    addIconWithLabel(test, 'assets/svgs-fontawesome/regular/bell.svg', 'Test');
    test.addEventListener('click', ()=>{ if (_state.audio) { _state.audio.currentTime = 0; _state.audio.loop = true; _state.audio.play(); setTimeout(() => { _state.audio.pause(); _state.audio.loop = false; }, 5000); } try{ if (window.Notification && Notification.permission==='granted') new Notification('Test Alarm',{body:'This is a test alarm', icon: chrome.runtime.getURL('icons/icon128.png')}); }catch(e){} });
    controls.appendChild(add); controls.appendChild(test);
    body.appendChild(controls);
    try { if (modal._requestAlarmsBtn) controls.appendChild(modal._requestAlarmsBtn); } catch (e) {}
    modal.appendChild(body);
    _backdrop.appendChild(modal); document.body.appendChild(_backdrop);

    _state.audio = new Audio(AUDIO_SRC); _state.audio.loop = false;
    _state.audio.addEventListener('ended', () => {
        if (_state.audio) {
            _state.audio.currentTime = 0;
            _state.audio.play().catch(() => {});
        }
    });
    renderAlarms(modal);
    _state.alarms.forEach(a => { if (a.on) scheduleAlarm(a, modal); });

    _backdrop.addEventListener('keydown', (ev)=>{ if (ev.key === 'Escape') closeAlarmModal(); });
}

function closeAlarmModal() {
    if (!_backdrop) return;
    Object.keys(_state.scheduled).forEach(k=> clearScheduled(k));
    try { document.body.removeChild(_backdrop); } catch (e) {}
    _backdrop = null;
    try { unloadCSS(CSS_ID); } catch (e) {}
    try { document.dispatchEvent(new CustomEvent('alarm:closed')); } catch (e) {}
}

export function toggleAlarmModal() { if (_backdrop) closeAlarmModal(); else openAlarmModal(); }
export function showAlarmModal() { openAlarmModal(); }
export function closeAlarmModalIfOpen() { closeAlarmModal(); }
