// Tools Modal - Dashboard Layout
import { renderInlineIcon } from './brandIconLoader.js';
import { closeSettingsModalIfOpen } from './settingsModal.js';
import { loadCSS, unloadCSS } from './cssLoader.js';

let toolsModal = null;
let toolsBackdrop = null;
let statsInterval = null;

export function initToolsModal() {
    if (document.getElementById('tools-modal')) return;

    toolsModal = document.createElement('div');
    toolsModal.id = 'tools-modal';
    toolsModal.className = 'tools-modal';
    
    // Header
    const header = document.createElement('div');
    header.className = 'tools-header';
    header.innerHTML = `
        <div class="tools-title">
            <span class="ui-icon"></span>
            <span>Tools Dashboard</span>
        </div>
    `;
    renderInlineIcon(header.querySelector('.tools-title .ui-icon'), 'assets/svgs-fontawesome/solid/wrench.svg');

    // Expand Button
    const expandBtn = document.createElement('button');
    expandBtn.className = 'tools-icon-btn tools-expand';
    expandBtn.title = 'Expand';
    const expandIcon = document.createElement('span');
    expandIcon.className = 'ui-icon';
    renderInlineIcon(expandIcon, 'assets/svgs-fontawesome/solid/expand.svg');
    expandBtn.appendChild(expandIcon);
    header.appendChild(expandBtn);

    expandBtn.onclick = () => {
        toolsModal.classList.toggle('expanded');
        const isExpanded = toolsModal.classList.contains('expanded');
        expandBtn.title = isExpanded ? 'Compress' : 'Expand';
        const iconName = isExpanded ? 'compress' : 'expand';
        renderInlineIcon(expandIcon, `assets/svgs-fontawesome/solid/${iconName}.svg`);
    };

    // Dashboard Grid
    const dashboard = document.createElement('div');
    dashboard.className = 'tools-dashboard';

    // Create all widgets
    dashboard.appendChild(createStatsWidget());
    dashboard.appendChild(createWorkspacesWidget());
    dashboard.appendChild(createCalculatorWidget());
    dashboard.appendChild(createConverterWidget());
    dashboard.appendChild(createQRWidget());
    dashboard.appendChild(createTextToolsWidget());
    dashboard.appendChild(createPasswordWidget());
    dashboard.appendChild(createJsonWidget());
    dashboard.appendChild(createBase64Widget());
    dashboard.appendChild(createLoremWidget());
    dashboard.appendChild(createRegexWidget());
    dashboard.appendChild(createHashWidget());
    dashboard.appendChild(createRssWidget());

    toolsModal.appendChild(header);
    toolsModal.appendChild(dashboard);
    document.body.appendChild(toolsModal);

    // Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && toolsModal.classList.contains('active')) {
            closeToolsModal();
        }
    });
}

// === STATS WIDGET ===
function createStatsWidget() {
    const widget = document.createElement('div');
    widget.className = 'tool-widget stats-widget';
    widget.innerHTML = `
        <div class="widget-header">
            <span class="ui-icon"></span>
            <span>System Stats</span>
        </div>
        <div class="widget-body stats-cards">
            <div class="stat-card" id="cpu-card">
                <div class="stat-card-header">
                    <span class="stat-card-icon ui-icon"></span>
                    <span class="stat-card-title">CPU</span>
                    <span class="stat-card-value">--%</span>
                </div>
                <div class="stat-card-chart">
                    <div class="stat-chart-bar" style="width: 0%"></div>
                </div>
                <div class="stat-card-details">
                    <div class="stat-detail"><span>Model:</span><span class="cpu-model">Loading...</span></div>
                    <div class="stat-detail"><span>Cores:</span><span class="cpu-cores">--</span></div>
                    <div class="stat-detail"><span>Architecture:</span><span class="cpu-arch">--</span></div>
                </div>
            </div>
            <div class="stat-card" id="mem-card">
                <div class="stat-card-header">
                    <span class="stat-card-icon ui-icon"></span>
                    <span class="stat-card-title">Memory</span>
                    <span class="stat-card-value">--%</span>
                </div>
                <div class="stat-card-chart">
                    <div class="stat-chart-bar" style="width: 0%"></div>
                </div>
                <div class="stat-card-details">
                    <div class="stat-detail"><span>Used:</span><span class="mem-used">-- GB</span></div>
                    <div class="stat-detail"><span>Available:</span><span class="mem-avail">-- GB</span></div>
                    <div class="stat-detail"><span>Total:</span><span class="mem-total">-- GB</span></div>
                </div>
            </div>
            <div class="stat-card" id="storage-card">
                <div class="stat-card-header">
                    <span class="stat-card-icon ui-icon"></span>
                    <span class="stat-card-title">Storage</span>
                    <span class="stat-card-value">--</span>
                </div>
                <div class="stat-card-details storage-drives"></div>
            </div>
        </div>
    `;
    renderInlineIcon(widget.querySelector('.widget-header .ui-icon'), 'assets/svgs-fontawesome/solid/chart-pie.svg');
    renderInlineIcon(widget.querySelector('#cpu-card .stat-card-icon'), 'assets/svgs-fontawesome/solid/microchip.svg');
    renderInlineIcon(widget.querySelector('#mem-card .stat-card-icon'), 'assets/svgs-fontawesome/solid/memory.svg');
    renderInlineIcon(widget.querySelector('#storage-card .stat-card-icon'), 'assets/svgs-fontawesome/solid/hard-drive.svg');

    let prevCpuInfo = null;
    
    const updateStats = () => {
        // CPU
        if (chrome.system?.cpu) {
            chrome.system.cpu.getInfo((info) => {
                const modelShort = info.modelName.replace(/\(R\)|\(TM\)|Core|Intel|AMD|Processor|CPU|@.*$/g, '').trim();
                widget.querySelector('.cpu-model').textContent = modelShort || 'Unknown';
                widget.querySelector('.cpu-cores').textContent = info.numOfProcessors;
                widget.querySelector('.cpu-arch').textContent = info.archName || 'x86_64';
                
                if (prevCpuInfo) {
                    let totalUsage = 0;
                    info.processors.forEach((proc, i) => {
                        const prev = prevCpuInfo.processors[i];
                        const totalDelta = proc.usage.total - prev.usage.total;
                        const idleDelta = proc.usage.idle - prev.usage.idle;
                        const usage = ((totalDelta - idleDelta) / totalDelta) * 100;
                        totalUsage += usage;
                    });
                    const avg = Math.round(totalUsage / info.processors.length);
                    widget.querySelector('#cpu-card .stat-card-value').textContent = `${avg}%`;
                    widget.querySelector('#cpu-card .stat-chart-bar').style.width = `${avg}%`;
                }
                prevCpuInfo = info;
            });
        }

        // Memory
        if (chrome.system?.memory) {
            chrome.system.memory.getInfo((info) => {
                const total = info.capacity / 1024 / 1024 / 1024;
                const avail = info.availableCapacity / 1024 / 1024 / 1024;
                const used = total - avail;
                const percent = Math.round((used / total) * 100);
                
                widget.querySelector('#mem-card .stat-card-value').textContent = `${percent}%`;
                widget.querySelector('#mem-card .stat-chart-bar').style.width = `${percent}%`;
                widget.querySelector('.mem-used').textContent = `${used.toFixed(1)} GB`;
                widget.querySelector('.mem-avail').textContent = `${avail.toFixed(1)} GB`;
                widget.querySelector('.mem-total').textContent = `${total.toFixed(1)} GB`;
            });
        }

        // Storage
        if (chrome.system?.storage) {
            chrome.system.storage.getInfo((units) => {
                const drives = widget.querySelector('.storage-drives');
                drives.innerHTML = '';
                let totalCap = 0;
                
                units.forEach(unit => {
                    if (unit.capacity > 0) {
                        totalCap += unit.capacity;
                        const name = unit.name.replace(/[^a-zA-Z0-9 :]/g, '') || 'Drive';
                        const sizeGB = Math.round(unit.capacity / 1e9);
                        
                        const row = document.createElement('div');
                        row.className = 'stat-detail';
                        row.innerHTML = `
                            <span class="drive-info">
                                <span class="drive-icon ui-icon"></span>
                                <span>${name}</span>
                            </span>
                            <span>${sizeGB} GB</span>
                        `;
                        const iconPath = unit.type === 'removable' 
                            ? 'assets/svgs-fontawesome/solid/floppy-disk.svg'
                            : 'assets/svgs-fontawesome/solid/hard-drive.svg';
                        renderInlineIcon(row.querySelector('.drive-icon'), iconPath);
                        drives.appendChild(row);
                    }
                });
                
                widget.querySelector('#storage-card .stat-card-value').textContent = `${units.length} Drive${units.length > 1 ? 's' : ''}`;
            });
        }
    };

    updateStats();
    statsInterval = setInterval(updateStats, 2000);

    return widget;
}

// === WORKSPACES WIDGET ===
function createWorkspacesWidget() {
    const widget = document.createElement('div');
    widget.className = 'tool-widget workspaces-widget';
    widget.innerHTML = `
        <div class="widget-header">
            <span class="ui-icon"></span>
            <span>Workspaces</span>
            <button class="widget-action" id="ws-add-btn" title="New Workspace"><span class="ui-icon"></span></button>
        </div>
        <div class="widget-body">
            <div class="ws-list-view">
                <div class="workspace-list"></div>
            </div>
            <div class="ws-create-view" style="display: none;">
                <input type="text" class="tools-input ws-name-input" placeholder="Workspace name...">
                <div class="ws-tabs-select"></div>
                <div class="ws-create-actions">
                    <button class="tools-btn ws-cancel-btn">Cancel</button>
                    <button class="tools-btn primary ws-save-btn">Save</button>
                </div>
            </div>
        </div>
    `;
    renderInlineIcon(widget.querySelector('.widget-header > .ui-icon'), 'assets/svgs-fontawesome/solid/layer-group.svg');
    renderInlineIcon(widget.querySelector('#ws-add-btn .ui-icon'), 'assets/svgs-fontawesome/solid/plus.svg');

    const listView = widget.querySelector('.ws-list-view');
    const createView = widget.querySelector('.ws-create-view');
    const list = widget.querySelector('.workspace-list');

    const loadWorkspaces = () => {
        chrome.storage.local.get('workspaces', (res) => {
            const workspaces = res.workspaces || [];
            
            if (workspaces.length === 0) {
                list.innerHTML = '<div class="empty-msg">No workspaces yet</div>';
            } else {
                list.innerHTML = '';
                workspaces.forEach((ws, idx) => {
                    const item = document.createElement('div');
                    item.className = 'ws-item';
                    item.innerHTML = `
                        <div class="ws-name">${ws.name}</div>
                        <div class="ws-count">${ws.urls.length} tabs</div>
                        <div class="ws-actions">
                            <button class="tools-icon-btn ws-open" title="Open"><span class="ui-icon"></span></button>
                            <button class="tools-icon-btn ws-delete" title="Delete"><span class="ui-icon"></span></button>
                        </div>
                    `;
                    renderInlineIcon(item.querySelector('.ws-open .ui-icon'), 'assets/svgs-fontawesome/solid/arrow-up-right-from-square.svg');
                    renderInlineIcon(item.querySelector('.ws-delete .ui-icon'), 'assets/svgs-fontawesome/solid/trash.svg');
                    
                    item.querySelector('.ws-open').onclick = () => ws.urls.forEach(url => chrome.tabs.create({ url, active: false }));
                    item.querySelector('.ws-delete').onclick = () => {
                        if (confirm(`Delete "${ws.name}"?`)) {
                            workspaces.splice(idx, 1);
                            chrome.storage.local.set({ workspaces }, loadWorkspaces);
                        }
                    };
                    
                    list.appendChild(item);
                });
            }
        });
    };

    // Show create view
    widget.querySelector('#ws-add-btn').onclick = async () => {
        const tabs = await chrome.tabs.query({ currentWindow: true });
        const tabsSelect = widget.querySelector('.ws-tabs-select');
        tabsSelect.innerHTML = '';
        
        tabs.forEach(tab => {
            const row = document.createElement('label');
            row.className = 'ws-tab-item';
            row.innerHTML = `
                <input type="checkbox" checked value="${tab.url}">
                <img src="${tab.favIconUrl || 'icons/icon16.png'}" class="ws-tab-icon" onerror="this.src='icons/icon16.png'">
                <span class="ws-tab-title">${tab.title}</span>
            `;
            tabsSelect.appendChild(row);
        });
        
        widget.querySelector('.ws-name-input').value = '';
        listView.style.display = 'none';
        createView.style.display = 'flex';
    };

    // Cancel
    widget.querySelector('.ws-cancel-btn').onclick = () => {
        createView.style.display = 'none';
        listView.style.display = 'block';
    };

    // Save
    widget.querySelector('.ws-save-btn').onclick = () => {
        const name = widget.querySelector('.ws-name-input').value.trim() || 'My Workspace';
        const selected = Array.from(widget.querySelectorAll('.ws-tabs-select input:checked')).map(cb => cb.value);
        
        if (selected.length === 0) return;

        chrome.storage.local.get('workspaces', (res) => {
            const current = res.workspaces || [];
            current.push({ id: Date.now(), name, urls: selected });
            chrome.storage.local.set({ workspaces: current }, () => {
                createView.style.display = 'none';
                listView.style.display = 'block';
                loadWorkspaces();
            });
        });
    };

    loadWorkspaces();
    return widget;
}

// === CALCULATOR WIDGET ===
function createCalculatorWidget() {
    const widget = document.createElement('div');
    widget.className = 'tool-widget calculator-widget';
    widget.innerHTML = `
        <div class="widget-header">
            <span class="ui-icon"></span>
            <span>Calculator</span>
        </div>
        <div class="widget-body">
            <div class="calc-display">0</div>
            <div class="calc-grid">
                <button class="tools-btn calc-btn" data-action="clear">C</button>
                <button class="tools-btn calc-btn" data-action="delete">⌫</button>
                <button class="tools-btn calc-btn" data-action="percent">%</button>
                <button class="tools-btn calc-btn" data-action="divide">÷</button>
                <button class="tools-btn calc-btn" data-num="7">7</button>
                <button class="tools-btn calc-btn" data-num="8">8</button>
                <button class="tools-btn calc-btn" data-num="9">9</button>
                <button class="tools-btn calc-btn" data-action="multiply">×</button>
                <button class="tools-btn calc-btn" data-num="4">4</button>
                <button class="tools-btn calc-btn" data-num="5">5</button>
                <button class="tools-btn calc-btn" data-num="6">6</button>
                <button class="tools-btn calc-btn" data-action="subtract">−</button>
                <button class="tools-btn calc-btn" data-num="1">1</button>
                <button class="tools-btn calc-btn" data-num="2">2</button>
                <button class="tools-btn calc-btn" data-num="3">3</button>
                <button class="tools-btn calc-btn" data-action="add">+</button>
                <button class="tools-btn calc-btn span-2" data-num="0">0</button>
                <button class="tools-btn calc-btn" data-num=".">.</button>
                <button class="tools-btn calc-btn" data-action="equals">=</button>
            </div>
        </div>
    `;
    renderInlineIcon(widget.querySelector('.widget-header .ui-icon'), 'assets/svgs-fontawesome/solid/calculator.svg');

    const display = widget.querySelector('.calc-display');
    let current = '', previous = '', operation = null;

    const update = () => display.textContent = current || '0';
    const compute = () => {
        const a = parseFloat(previous), b = parseFloat(current);
        if (isNaN(a) || isNaN(b)) return;
        switch (operation) {
            case '+': current = a + b; break;
            case '-': current = a - b; break;
            case '×': current = a * b; break;
            case '÷': current = a / b; break;
        }
        operation = null;
        previous = '';
    };

    widget.querySelector('.calc-grid').onclick = (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;

        if (btn.dataset.num) {
            if (btn.dataset.num === '.' && current.includes('.')) return;
            current += btn.dataset.num;
        } else if (btn.dataset.action === 'clear') {
            current = previous = '';
            operation = null;
        } else if (btn.dataset.action === 'delete') {
            current = current.slice(0, -1);
        } else if (['add', 'subtract', 'multiply', 'divide'].includes(btn.dataset.action)) {
            if (current && previous && operation) compute();
            operation = btn.textContent;
            previous = current;
            current = '';
        } else if (btn.dataset.action === 'percent') {
            if (current) current = (parseFloat(current) / 100).toString();
        } else if (btn.dataset.action === 'equals') {
            compute();
        }
        update();
    };

    return widget;
}

// === CONVERTER WIDGET ===
function createConverterWidget() {
    const widget = document.createElement('div');
    widget.className = 'tool-widget converter-widget';
    widget.innerHTML = `
        <div class="widget-header">
            <span class="ui-icon"></span>
            <span>Converter</span>
        </div>
        <div class="widget-body">
            <div class="tools-chip-group conv-tabs">
                <button class="tools-chip active" data-type="length">Length</button>
                <button class="tools-chip" data-type="weight">Weight</button>
                <button class="tools-chip" data-type="currency">Currency</button>
            </div>
            <div class="conv-form">
                <input type="number" id="conv-in" class="tools-input" value="1">
                <select id="conv-from" class="tools-select"></select>
                <div class="conv-arrow">→</div>
                <input type="number" id="conv-out" class="tools-input" readonly>
                <select id="conv-to" class="tools-select"></select>
            </div>
            <div class="conv-rate"></div>
        </div>
    `;
    renderInlineIcon(widget.querySelector('.widget-header .ui-icon'), 'assets/svgs-fontawesome/solid/arrow-right-arrow-left.svg');

    const DEFS = {
        length: {
            units: { m: 1, km: 1000, cm: 0.01, mm: 0.001, mi: 1609.34, ft: 0.3048, in: 0.0254 },
            labels: { m: 'Meters', km: 'Kilometers', cm: 'Centimeters', mm: 'Millimeters', mi: 'Miles', ft: 'Feet', in: 'Inches' }
        },
        weight: {
            units: { kg: 1, g: 0.001, lb: 0.453592, oz: 0.0283495 },
            labels: { kg: 'Kilograms', g: 'Grams', lb: 'Pounds', oz: 'Ounces' }
        },
        currency: {
            units: null,
            labels: { USD: 'USD', EUR: 'EUR', GBP: 'GBP', JPY: 'JPY', INR: 'INR', CAD: 'CAD', AUD: 'AUD' }
        }
    };

    let type = 'length', rates = null;

    const populate = (t) => {
        const from = widget.querySelector('#conv-from');
        const to = widget.querySelector('#conv-to');
        from.innerHTML = to.innerHTML = '';
        Object.keys(DEFS[t].labels).forEach(k => {
            from.add(new Option(DEFS[t].labels[k], k));
            to.add(new Option(DEFS[t].labels[k], k));
        });
        if (t === 'length') to.value = 'km';
        if (t === 'weight') to.value = 'lb';
        if (t === 'currency') to.value = 'EUR';
    };

    const convert = () => {
        const val = parseFloat(widget.querySelector('#conv-in').value);
        if (isNaN(val)) return;
        const from = widget.querySelector('#conv-from').value;
        const to = widget.querySelector('#conv-to').value;
        const out = widget.querySelector('#conv-out');
        const rateEl = widget.querySelector('.conv-rate');

        if (type === 'currency') {
            if (!rates) return;
            const result = (val / rates[from]) * rates[to];
            out.value = result.toFixed(2);
            rateEl.textContent = `1 ${from} = ${(rates[to] / rates[from]).toFixed(4)} ${to}`;
        } else {
            const units = DEFS[type].units;
            const result = (val * units[from]) / units[to];
            out.value = result < 0.001 ? result.toExponential(4) : parseFloat(result.toFixed(4));
            rateEl.textContent = '';
        }
    };

    widget.querySelectorAll('.conv-tabs button').forEach(btn => {
        btn.onclick = async () => {
            widget.querySelectorAll('.conv-tabs button').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            type = btn.dataset.type;
            
            if (type === 'currency' && !rates) {
                widget.querySelector('.conv-rate').textContent = 'Loading rates...';
                try {
                    const res = await fetch('https://api.exchangerate-api.com/v4/latest/USD');
                    const data = await res.json();
                    rates = data.rates;
                } catch {
                    rates = { USD: 1, EUR: 0.9, GBP: 0.8 };
                }
            }
            populate(type);
            convert();
        };
    });

    widget.querySelector('#conv-in').oninput = convert;
    widget.querySelector('#conv-from').onchange = convert;
    widget.querySelector('#conv-to').onchange = convert;

    populate('length');
    return widget;
}

// === QR CODE WIDGET ===
function createQRWidget() {
    const widget = document.createElement('div');
    widget.className = 'tool-widget qr-widget';
    widget.innerHTML = `
        <div class="widget-header">
            <span class="ui-icon"></span>
            <span>QR Generator</span>
        </div>
        <div class="widget-body">
            <input type="text" class="tools-input qr-input" placeholder="Enter text or URL...">
            <div class="qr-output"></div>
            <button class="tools-btn primary full-width qr-download-btn" disabled>Download QR</button>
        </div>
    `;
    renderInlineIcon(widget.querySelector('.widget-header .ui-icon'), 'assets/svgs-fontawesome/solid/qrcode.svg');

    const input = widget.querySelector('.qr-input');
    const output = widget.querySelector('.qr-output');
    const downloadBtn = widget.querySelector('.qr-download-btn');

    const generateQR = () => {
        const text = input.value.trim();
        if (!text) {
            output.innerHTML = '<div class="qr-placeholder">Enter text to generate QR</div>';
            downloadBtn.disabled = true;
            return;
        }

        // Generate QR using canvas
        const size = 150;
        
        // Simple QR generation using data URI approach with Google Charts API
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.src = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(text)}`;
        
        img.onload = () => {
            output.innerHTML = '';
            output.appendChild(img);
            downloadBtn.disabled = false;
            downloadBtn.onclick = () => {
                fetch(img.src)
                    .then(res => res.blob())
                    .then(blob => {
                        const url = URL.createObjectURL(blob);
                        const link = document.createElement('a');
                        link.download = 'qrcode.png';
                        link.href = url;
                        link.click();
                        URL.revokeObjectURL(url);
                    });
            };
        };

        img.onerror = () => {
            output.innerHTML = '<div class="qr-error">Failed to generate QR</div>';
            downloadBtn.disabled = true;
        };
    };

    input.addEventListener('input', debounce(generateQR, 500));
    generateQR();

    input.addEventListener('input', debounce(generateQR, 500));
    generateQR();

    return widget;
}

// Debounce helper
function debounce(fn, delay) {
    let timeout;
    return (...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => fn(...args), delay);
    };
}

// === TEXT TOOLS WIDGET ===
function createTextToolsWidget() {
    const widget = document.createElement('div');
    widget.className = 'tool-widget text-tools-widget';
    widget.innerHTML = `
        <div class="widget-header">
            <span class="ui-icon"></span>
            <span>Text Tools</span>
        </div>
        <div class="widget-body">
            <textarea class="tools-textarea text-input" placeholder="Paste your text here..."></textarea>
            <div class="text-stats">
                <span class="stat-item"><strong>0</strong> chars</span>
                <span class="stat-item"><strong>0</strong> words</span>
                <span class="stat-item"><strong>0</strong> lines</span>
            </div>
            <div class="tools-chip-group text-actions">
                <button class="tools-chip" data-action="upper" title="UPPERCASE">Aa→AA</button>
                <button class="tools-chip" data-action="lower" title="lowercase">Aa→aa</button>
                <button class="tools-chip" data-action="title" title="Title Case">Aa→Tt</button>
                <button class="tools-chip" data-action="trim" title="Trim whitespace">Trim</button>
                <button class="tools-chip" data-action="copy" title="Copy">Copy</button>
            </div>
        </div>
    `;
    renderInlineIcon(widget.querySelector('.widget-header .ui-icon'), 'assets/svgs-fontawesome/solid/font.svg');

    const textarea = widget.querySelector('.text-input');
    const stats = widget.querySelector('.text-stats');

    const updateStats = () => {
        const text = textarea.value;
        const chars = text.length;
        const words = text.trim() ? text.trim().split(/\s+/).length : 0;
        const lines = text ? text.split('\n').length : 0;
        stats.innerHTML = `
            <span class="stat-item"><strong>${chars}</strong> chars</span>
            <span class="stat-item"><strong>${words}</strong> words</span>
            <span class="stat-item"><strong>${lines}</strong> lines</span>
        `;
    };

    textarea.addEventListener('input', updateStats);

    widget.querySelector('.text-actions').onclick = (e) => {
        const action = e.target.dataset.action;
        if (!action) return;

        switch (action) {
            case 'upper':
                textarea.value = textarea.value.toUpperCase();
                break;
            case 'lower':
                textarea.value = textarea.value.toLowerCase();
                break;
            case 'title':
                textarea.value = textarea.value.replace(/\b\w/g, c => c.toUpperCase());
                break;
            case 'trim':
                textarea.value = textarea.value.trim().replace(/\s+/g, ' ');
                break;
            case 'copy':
                navigator.clipboard.writeText(textarea.value);
                e.target.textContent = '✓';
                setTimeout(() => e.target.textContent = 'Copy', 1000);
                break;
        }
        updateStats();
    };

    return widget;
}

// === PASSWORD GENERATOR WIDGET ===
function createPasswordWidget() {
    const widget = document.createElement('div');
    widget.className = 'tool-widget password-widget';
    widget.innerHTML = `
        <div class="widget-header">
            <span class="ui-icon"></span>
            <span>Password Generator</span>
            <button class="widget-action" title="Generate"><span class="ui-icon"></span></button>
        </div>
        <div class="widget-body">
            <div class="password-output">
                <input type="text" class="tools-input password-display" readonly>
                <button class="tools-icon-btn password-copy" title="Copy"><span class="ui-icon"></span></button>
            </div>
            <div class="password-strength"></div>
            <div class="password-options">
                <div class="password-length">
                    <label>Length: <span class="length-value">16</span></label>
                    <input type="range" class="length-slider" min="8" max="32" value="16">
                </div>
                <div class="password-toggles">
                    <label><input type="checkbox" checked data-type="upper"> ABC</label>
                    <label><input type="checkbox" checked data-type="lower"> abc</label>
                    <label><input type="checkbox" checked data-type="numbers"> 123</label>
                    <label><input type="checkbox" checked data-type="symbols"> !@#</label>
                </div>
            </div>
        </div>
    `;
    renderInlineIcon(widget.querySelector('.widget-header > .ui-icon'), 'assets/svgs-fontawesome/solid/key.svg');
    renderInlineIcon(widget.querySelector('.widget-action .ui-icon'), 'assets/svgs-fontawesome/solid/rotate.svg');
    renderInlineIcon(widget.querySelector('.password-copy .ui-icon'), 'assets/svgs-fontawesome/solid/copy.svg');

    const display = widget.querySelector('.password-display');
    const strengthBar = widget.querySelector('.password-strength');
    const lengthSlider = widget.querySelector('.length-slider');
    const lengthValue = widget.querySelector('.length-value');

    const CHARS = {
        upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
        lower: 'abcdefghijklmnopqrstuvwxyz',
        numbers: '0123456789',
        symbols: '!@#$%^&*()_+-=[]{}|;:,.<>?'
    };

    const generate = () => {
        const length = parseInt(lengthSlider.value);
        let charset = '';
        
        widget.querySelectorAll('.password-toggles input:checked').forEach(cb => {
            charset += CHARS[cb.dataset.type];
        });

        if (!charset) charset = CHARS.lower;

        let password = '';
        for (let i = 0; i < length; i++) {
            password += charset[Math.floor(Math.random() * charset.length)];
        }
        
        display.value = password;
        updateStrength(password);
    };

    const updateStrength = (password) => {
        let score = 0;
        if (password.length >= 12) score++;
        if (password.length >= 16) score++;
        if (/[a-z]/.test(password)) score++;
        if (/[A-Z]/.test(password)) score++;
        if (/[0-9]/.test(password)) score++;
        if (/[^a-zA-Z0-9]/.test(password)) score++;

        const colors = ['#ff4444', '#ff8844', '#ffcc00', '#88cc00', '#00cc44'];
        const labels = ['Weak', 'Fair', 'Good', 'Strong', 'Very Strong'];
        const idx = Math.min(Math.max(score - 1, 0), 4);
        
        strengthBar.style.background = colors[idx];
        strengthBar.textContent = labels[idx];
        strengthBar.style.color = '#fff';
    };

    lengthSlider.oninput = () => {
        lengthValue.textContent = lengthSlider.value;
        generate();
    };

    widget.querySelectorAll('.password-toggles input').forEach(cb => {
        cb.onchange = generate;
    });

    widget.querySelector('.widget-action').onclick = generate;
    widget.querySelector('.password-copy').onclick = () => {
        navigator.clipboard.writeText(display.value);
        const btn = widget.querySelector('.password-copy');
        btn.style.color = 'var(--color-accent)';
        setTimeout(() => btn.style.color = '', 1000);
    };

    generate();
    return widget;
}

// === JSON FORMATTER WIDGET ===
function createJsonWidget() {
    const widget = document.createElement('div');
    widget.className = 'tool-widget json-widget';
    widget.innerHTML = `
        <div class="widget-header">
            <span class="ui-icon"></span>
            <span>JSON Formatter</span>
        </div>
        <div class="widget-body">
            <textarea class="tools-textarea json-input" placeholder="Paste JSON here..."></textarea>
            <div class="tools-chip-group json-actions">
                <button class="tools-chip" data-action="format">Format</button>
                <button class="tools-chip" data-action="minify">Minify</button>
                <button class="tools-chip" data-action="copy">Copy</button>
            </div>
            <div class="json-status"></div>
        </div>
    `;
    renderInlineIcon(widget.querySelector('.widget-header .ui-icon'), 'assets/svgs-fontawesome/solid/code.svg');

    const input = widget.querySelector('.json-input');
    const status = widget.querySelector('.json-status');

    widget.querySelector('.json-actions').onclick = (e) => {
        const action = e.target.dataset.action;
        if (!action) return;

        try {
            const parsed = JSON.parse(input.value);
            if (action === 'format') {
                input.value = JSON.stringify(parsed, null, 2);
                status.textContent = '✓ Formatted';
                status.style.color = '#00cc44';
            } else if (action === 'minify') {
                input.value = JSON.stringify(parsed);
                status.textContent = '✓ Minified';
                status.style.color = '#00cc44';
            } else if (action === 'copy') {
                navigator.clipboard.writeText(input.value);
                status.textContent = '✓ Copied';
                status.style.color = '#00cc44';
            }
        } catch (err) {
            status.textContent = '✗ Invalid JSON';
            status.style.color = '#ff4444';
        }
        setTimeout(() => status.textContent = '', 2000);
    };

    return widget;
}

// === BASE64 WIDGET ===
function createBase64Widget() {
    const widget = document.createElement('div');
    widget.className = 'tool-widget base64-widget';
    widget.innerHTML = `
        <div class="widget-header">
            <span class="ui-icon"></span>
            <span>Base64</span>
        </div>
        <div class="widget-body">
            <textarea class="tools-textarea base64-input" placeholder="Enter text..."></textarea>
            <div class="tools-chip-group base64-actions">
                <button class="tools-chip" data-action="encode">Encode</button>
                <button class="tools-chip" data-action="decode">Decode</button>
                <button class="tools-chip" data-action="copy">Copy</button>
            </div>
        </div>
    `;
    renderInlineIcon(widget.querySelector('.widget-header .ui-icon'), 'assets/svgs-fontawesome/solid/lock.svg');

    const input = widget.querySelector('.base64-input');

    widget.querySelector('.base64-actions').onclick = (e) => {
        const action = e.target.dataset.action;
        if (!action) return;

        try {
            if (action === 'encode') {
                input.value = btoa(input.value);
            } else if (action === 'decode') {
                input.value = atob(input.value);
            } else if (action === 'copy') {
                navigator.clipboard.writeText(input.value);
                e.target.textContent = '✓';
                setTimeout(() => e.target.textContent = 'Copy', 1000);
            }
        } catch {
            input.value = 'Error: Invalid input';
        }
    };

    return widget;
}

// === LOREM IPSUM WIDGET ===
function createLoremWidget() {
    const widget = document.createElement('div');
    widget.className = 'tool-widget lorem-widget';
    widget.innerHTML = `
        <div class="widget-header">
            <span class="ui-icon"></span>
            <span>Lorem Ipsum</span>
            <button class="widget-action" title="Generate"><span class="ui-icon"></span></button>
        </div>
        <div class="widget-body">
            <div class="lorem-options">
                <select class="tools-select lorem-type">
                    <option value="paragraphs">Paragraphs</option>
                    <option value="sentences">Sentences</option>
                    <option value="words">Words</option>
                </select>
                <input type="number" class="tools-input lorem-count" value="2" min="1" max="10">
            </div>
            <div class="lorem-output"></div>
            <button class="tools-btn primary full-width lorem-copy">Copy</button>
        </div>
    `;
    renderInlineIcon(widget.querySelector('.widget-header > .ui-icon'), 'assets/svgs-fontawesome/solid/paragraph.svg');
    renderInlineIcon(widget.querySelector('.widget-action .ui-icon'), 'assets/svgs-fontawesome/solid/rotate.svg');

    const LOREM = "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.";
    const output = widget.querySelector('.lorem-output');

    const generate = () => {
        const type = widget.querySelector('.lorem-type').value;
        const count = parseInt(widget.querySelector('.lorem-count').value) || 1;
        let text = '';

        if (type === 'paragraphs') {
            text = Array(count).fill(LOREM).join('\n\n');
        } else if (type === 'sentences') {
            const sentences = LOREM.match(/[^.!?]+[.!?]+/g) || [LOREM];
            text = sentences.slice(0, count).join(' ');
        } else {
            const words = LOREM.split(' ');
            text = words.slice(0, count).join(' ');
        }
        output.textContent = text;
    };

    widget.querySelector('.widget-action').onclick = generate;
    widget.querySelector('.lorem-type').onchange = generate;
    widget.querySelector('.lorem-count').onchange = generate;
    widget.querySelector('.lorem-copy').onclick = () => {
        navigator.clipboard.writeText(output.textContent);
    };

    generate();
    return widget;
}

// === REGEX TESTER WIDGET ===
function createRegexWidget() {
    const widget = document.createElement('div');
    widget.className = 'tool-widget regex-widget';
    widget.innerHTML = `
        <div class="widget-header">
            <span class="ui-icon"></span>
            <span>Regex Tester</span>
        </div>
        <div class="widget-body">
            <input type="text" class="tools-input regex-pattern" placeholder="Pattern (e.g. \\d+)">
            <input type="text" class="tools-input regex-flags" placeholder="Flags (e.g. gi)" value="g">
            <textarea class="tools-textarea regex-text" placeholder="Test text..."></textarea>
            <div class="regex-result"><span style="color:var(--text-off); font-style:italic;">Result will appear here...</span></div>
        </div>
    `;
    renderInlineIcon(widget.querySelector('.widget-header .ui-icon'), 'assets/svgs-fontawesome/solid/asterisk.svg');

    const pattern = widget.querySelector('.regex-pattern');
    const flags = widget.querySelector('.regex-flags');
    const text = widget.querySelector('.regex-text');
    const result = widget.querySelector('.regex-result');

    const test = () => {
        if (!pattern.value || !text.value) {
            result.innerHTML = '';
            return;
        }
        try {
            const regex = new RegExp(pattern.value, flags.value);
            const matches = text.value.match(regex);
            if (matches) {
                result.innerHTML = `<span style="color:#00cc44">${matches.length} match${matches.length > 1 ? 'es' : ''}</span>: ${matches.join(', ')}`;
            } else {
                result.innerHTML = '<span style="color:#ff8844">No matches</span>';
            }
        } catch (e) {
            result.innerHTML = `<span style="color:#ff4444">Error: ${e.message}</span>`;
        }
    };

    pattern.oninput = test;
    flags.oninput = test;
    text.oninput = test;

    return widget;
}

// === HASH GENERATOR WIDGET ===
function createHashWidget() {
    const widget = document.createElement('div');
    widget.className = 'tool-widget hash-widget';
    widget.innerHTML = `
        <div class="widget-header">
            <span class="ui-icon"></span>
            <span>Hash Generator</span>
        </div>
        <div class="widget-body">
            <input type="text" class="tools-input hash-input" placeholder="Enter text to hash...">
            <div class="hash-results"></div>
        </div>
    `;
    renderInlineIcon(widget.querySelector('.widget-header .ui-icon'), 'assets/svgs-fontawesome/solid/fingerprint.svg');

    const input = widget.querySelector('.hash-input');
    const results = widget.querySelector('.hash-results');
    const algos = ['SHA-1', 'SHA-256', 'SHA-512'];

    // Pre-render rows
    algos.forEach(algo => {
        const row = document.createElement('div');
        row.className = 'hash-row';
        row.innerHTML = `
            <span class="hash-algo">${algo}</span>
            <input class="tools-input hash-value" readonly>
            <button class="tools-icon-btn hash-copy" title="Copy"><span class="ui-icon"></span></button>
        `;
        renderInlineIcon(row.querySelector('.hash-copy .ui-icon'), 'assets/svgs-fontawesome/solid/copy.svg');
        
        const copyBtn = row.querySelector('.hash-copy');
        const valInput = row.querySelector('.hash-value');
        
        copyBtn.onclick = () => {
            if (valInput.value) {
                navigator.clipboard.writeText(valInput.value);
            }
        };
        results.appendChild(row);
    });

    const hashText = async (text) => {
        const rows = Array.from(results.children); // Inherit order from init
        
        if (!text) {
            rows.forEach(row => row.querySelector('.hash-value').value = '');
            return;
        }

        const encoder = new TextEncoder();
        const data = encoder.encode(text);

        for (let i = 0; i < algos.length; i++) {
            const algo = algos[i];
            const row = rows[i];
            const hash = await crypto.subtle.digest(algo, data);
            const hex = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
            row.querySelector('.hash-value').value = hex;
        }
    };

    input.oninput = () => hashText(input.value);

    return widget;
}

// === RSS FEED WIDGET ===
function createRssWidget() {
    const widget = document.createElement('div');
    widget.className = 'tool-widget rss-widget';
    widget.innerHTML = `
        <div class="widget-header">
            <span class="ui-icon"></span>
            <span>RSS Feed</span>
            <button class="widget-action" title="Refresh"><span class="ui-icon"></span></button>
        </div>
        <div class="widget-body">
            <div class="rss-url-row">
                <input type="text" class="tools-input rss-url" placeholder="Enter RSS feed URL...">
                <button class="tools-btn primary rss-load">Load</button>
            </div>
            <div class="rss-items"></div>
        </div>
    `;
    renderInlineIcon(widget.querySelector('.widget-header > .ui-icon'), 'assets/svgs-fontawesome/solid/rss.svg');
    renderInlineIcon(widget.querySelector('.widget-action .ui-icon'), 'assets/svgs-fontawesome/solid/rotate.svg');

    const urlInput = widget.querySelector('.rss-url');
    const itemsContainer = widget.querySelector('.rss-items');

    const loadFeed = async () => {
        const url = urlInput.value.trim();
        if (!url) return;

        itemsContainer.innerHTML = '<div class="rss-loading">Loading...</div>';

        try {
            // Direct fetch - Chrome extension has host_permissions for all URLs
            const res = await fetch(url);
            const text = await res.text();
            
            const parser = new DOMParser();
            const xml = parser.parseFromString(text, 'text/xml');
            const items = xml.querySelectorAll('item');

            if (items.length === 0) {
                itemsContainer.innerHTML = '<div class="rss-empty">No items found</div>';
                return;
            }

            itemsContainer.innerHTML = '';
            Array.from(items).slice(0, 5).forEach(item => {
                const title = item.querySelector('title')?.textContent || 'Untitled';
                const link = item.querySelector('link')?.textContent || '#';
                
                const row = document.createElement('a');
                row.className = 'rss-item';
                row.href = link;
                row.target = '_blank';
                row.textContent = title;
                itemsContainer.appendChild(row);
            });
        } catch (e) {
            itemsContainer.innerHTML = '<div class="rss-error">Failed to load feed</div>';
        }
    };

    widget.querySelector('.rss-load').onclick = loadFeed;
    widget.querySelector('.widget-action').onclick = loadFeed;
    urlInput.onkeydown = (e) => { if (e.key === 'Enter') loadFeed(); };

    return widget;
}

// === PUBLIC API ===
export async function toggleToolsModal() {
    const existing = document.getElementById('tools-modal');
    
    // If panel exists, close and remove it
    if (existing) {
        closeToolsModal();
        return;
    }
    
    // Close other panels for mutual exclusivity
    closeSettingsModalIfOpen();
    
    // Close bookmarks panel
    const bookmarksPanel = document.querySelector('.bookmarks-panel');
    if (bookmarksPanel) bookmarksPanel.remove();
    document.getElementById('bookmark-toggle')?.classList.remove('active');
    unloadCSS('bookmarks-css');
    
    // Close tabs panel
    const tabsPanel = document.querySelector('.tabs-wrapper');
    if (tabsPanel) tabsPanel.remove();
    document.getElementById('tabs-toggle')?.classList.remove('active');
    
    // Load CSS first
    await loadCSS('css/toolsModal.css', 'tools-modal-css');
    
    // Create and show the modal
    initToolsModal();
    
    // Set active state on button
    const btn = document.getElementById('action-tools');
    if (btn) btn.classList.add('active');
}

export function closeToolsModal() {
    // Clear stats interval
    if (statsInterval) {
        clearInterval(statsInterval);
        statsInterval = null;
    }
    
    // Remove modal from DOM with animation
    const modal = document.getElementById('tools-modal');
    if (modal) {
        modal.style.animation = 'slideDown var(--transition-normal) forwards';
        modal.addEventListener('animationend', () => {
            try { modal.remove(); } catch (e) {}
            toolsModal = null;
            unloadCSS('tools-modal-css');
        }, { once: true });
    } else {
        toolsModal = null;
        unloadCSS('tools-modal-css');
    }
    
    // Remove active state from button
    const btn = document.getElementById('action-tools');
    if (btn) btn.classList.remove('active');
}
