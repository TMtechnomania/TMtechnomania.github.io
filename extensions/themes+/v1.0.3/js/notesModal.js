import { loadCSS, unloadCSS } from './cssLoader.js';
import { renderInlineIcon } from './brandIconLoader.js';

const CSS_ID = 'notes-modal-css';
const CSS_PATH = 'css/notesModal.css';
const STORAGE_KEY = 'tm_notes_v1';
const MAX_NOTES = 10; // Max combined notes and checklists

let _backdrop = null;
let _state = {
    notes: [],
    currentEditId: null
};

// --- Storage ---
function loadState() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        _state.notes = raw ? JSON.parse(raw) : [];
    } catch (e) {
        _state.notes = [];
    }
}

function saveState() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(_state.notes));
        // Dispatch event for widgets
        document.dispatchEvent(new CustomEvent('notes-updated'));
    } catch (e) {}
}

function uid() {
    return 'n_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

// --- Icons ---
function createIcon(path, cls = '') {
    const span = document.createElement('span');
    span.className = 'ui-icon ' + cls;
    renderInlineIcon(span, path);
    return span;
}

// --- UI Rendering ---

export async function toggleNotesModal() {
    if (_backdrop) closeNotesModal();
    else openNotesModal();
}

export async function openNotesModal() {
    if (_backdrop) return;
    loadState();
    await loadCSS(CSS_PATH, CSS_ID);

    _backdrop = document.createElement('div');
    _backdrop.className = 'notes-modal-backdrop';
    
    // Close on click outside
    _backdrop.addEventListener('click', (e) => {
        if (e.target === _backdrop) closeNotesModal();
    });

    const modal = document.createElement('div');
    modal.className = 'notes-modal';
    
    // Header
    const header = document.createElement('div');
    header.className = 'notes-header';
    header.innerHTML = `<h3>Notes</h3>`;
    
    modal.appendChild(header);

    // Body container
    const body = document.createElement('div');
    body.className = 'notes-body';
    modal.appendChild(body);

    _backdrop.appendChild(modal);
    document.body.appendChild(_backdrop);

    // Render List or Edit View
    renderListView(body);
}

export function closeNotesModal() {
    if (!_backdrop) return;
    document.body.removeChild(_backdrop);
    _backdrop = null;
    unloadCSS(CSS_ID);
    document.dispatchEvent(new CustomEvent('notes:closed'));
}

// --- Views ---

function renderListView(container) {
    container.innerHTML = '';
    _state.currentEditId = null;

    // Add Buttons
    const controls = document.createElement('div');
    controls.className = 'notes-controls'; // Reusing class for top controls too? No, let's put at top or bottom.
    // Let's put Add buttons at the top of list
    const actionRow = document.createElement('div');
    actionRow.style.display = 'flex';
    actionRow.style.gap = '8px';
    actionRow.style.marginBottom = '10px';

    const addNoteBtn = document.createElement('button');
    addNoteBtn.className = 'tm-btn';
    addNoteBtn.innerHTML = `<span>+ Note</span>`;
    addNoteBtn.addEventListener('click', () => openEditor(container, 'note'));
    
    const addCheckBtn = document.createElement('button');
    addCheckBtn.className = 'tm-btn';
    addCheckBtn.innerHTML = `<span>+ Checklist</span>`;
    addCheckBtn.addEventListener('click', () => openEditor(container, 'checklist'));

    // Enforce max limit
    const atLimit = _state.notes.length >= MAX_NOTES;
    if (atLimit) {
        addNoteBtn.disabled = true;
        addNoteBtn.title = `Maximum ${MAX_NOTES} notes/checklists reached`;
        addCheckBtn.disabled = true;
        addCheckBtn.title = `Maximum ${MAX_NOTES} notes/checklists reached`;
    }

    actionRow.appendChild(addNoteBtn);
    actionRow.appendChild(addCheckBtn);
    container.appendChild(actionRow);

    const list = document.createElement('div');
    list.className = 'notes-list';

    if (_state.notes.length === 0) {
        list.innerHTML = `<div style="text-align:center; color: var(--text-off); padding: 20px;">No notes yet</div>`;
    } else {
        _state.notes.forEach(note => {
            const item = document.createElement('div');
            item.className = 'note-item';
            
            const info = document.createElement('div');
            info.className = 'note-info';
            
            const title = document.createElement('div');
            title.className = 'note-title';
            title.textContent = note.title || (note.type === 'checklist' ? 'Untitled Checklist' : 'Untitled Note');
            
            const preview = document.createElement('div');
            preview.className = 'note-preview';
            if (note.type === 'note') {
                preview.textContent = note.content || 'No content';
            } else {
                const checked = note.items ? note.items.filter(i => i.checked).length : 0;
                const total = note.items ? note.items.length : 0;
                preview.textContent = `${checked}/${total} items`;
            }

            info.appendChild(title);
            info.appendChild(preview);
            
            item.appendChild(info);

            // Actions: Pin, Delete
            const actions = document.createElement('div');
            actions.className = 'note-actions';

            const pinBtn = document.createElement('button');
            pinBtn.className = `tm-btn round ${note.pinned ? 'pinned-active' : ''}`;
            pinBtn.title = note.pinned ? 'Unpin' : 'Pin';
            pinBtn.appendChild(createIcon('assets/svgs-fontawesome/solid/thumbtack.svg'));
            pinBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                note.pinned = !note.pinned;
                if (note.pinned && !note.x) {
                     // Set default position if pinning for first time
                     note.x = 100; note.y = 100; note.width = 200; note.height = 200;
                }
                saveState();
                renderListView(container);
            });

            const editBtn = document.createElement('button');
            editBtn.className = 'tm-btn round';
            editBtn.title = 'Edit';
            editBtn.appendChild(createIcon('assets/svgs-fontawesome/regular/pen-to-square.svg'));
            editBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                openEditor(container, note.type, note);
            });

            const delBtn = document.createElement('button');
            delBtn.className = 'tm-btn round';
            delBtn.title = 'Delete';
            delBtn.appendChild(createIcon('assets/svgs-fontawesome/regular/trash-can.svg'));
            delBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (confirm('Delete this note?')) {
                    _state.notes = _state.notes.filter(n => n.id !== note.id);
                    saveState();
                    renderListView(container);
                }
            });

            actions.appendChild(pinBtn);
            actions.appendChild(editBtn);
            actions.appendChild(delBtn);
            item.appendChild(actions);

            item.addEventListener('click', () => openEditor(container, note.type, note));

            list.appendChild(item);
        });
    }
    container.appendChild(list);
}

function openEditor(container, type, existingNote = null) {
    container.innerHTML = '';
    
    // Create new object structure if not existing
    const note = existingNote ? JSON.parse(JSON.stringify(existingNote)) : {
        id: uid(),
        type: type,
        title: '',
        content: '', // For text
        items: [],   // For checklist {text, checked}
        pinned: false,
        x: 100, y: 100, width: 200, height: 200
    };
    
    _state.currentEditId = note.id;

    const form = document.createElement('div');
    form.className = 'note-edit-form';

    // Header Actions (Back, Pin)
    const topBar = document.createElement('div');
    topBar.style.display = 'flex';
    topBar.style.justifyContent = 'space-between';
    topBar.style.alignItems = 'center';

    const backBtn = document.createElement('button');
    backBtn.className = 'tm-btn';
    backBtn.innerHTML = `<span style="margin-right:5px">←</span> Back`;
    backBtn.addEventListener('click', () => renderListView(container));
    
    const pinBtn = document.createElement('button');
    pinBtn.className = `tm-btn round ${note.pinned ? 'pinned-active' : ''}`;
    pinBtn.title = 'Pin to Desktop';
    pinBtn.appendChild(createIcon('assets/svgs-fontawesome/solid/thumbtack.svg'));
    pinBtn.addEventListener('click', () => {
        note.pinned = !note.pinned;
        pinBtn.classList.toggle('pinned-active', note.pinned);
    });

    topBar.appendChild(backBtn);
    topBar.appendChild(pinBtn);
    form.appendChild(topBar);

    // Title
    const titleIn = document.createElement('input');
    titleIn.className = 'note-input-title';
    titleIn.placeholder = 'Title';
    titleIn.value = note.title;
    titleIn.addEventListener('input', (e) => note.title = e.target.value);
    form.appendChild(titleIn);

    // Content Editor
    if (type === 'note') {
        const text = document.createElement('textarea');
        text.className = 'note-input-content';
        text.placeholder = 'Type your note here...';
        text.value = note.content || '';
        text.addEventListener('input', (e) => note.content = e.target.value);
        form.appendChild(text);
    } else {
        // Checklist Editor
        const checkContainer = document.createElement('div');
        checkContainer.className = 'checklist-container';
        
        const renderCheckItems = () => {
            checkContainer.innerHTML = '';
            note.items.forEach((item, idx) => {
                const row = document.createElement('div');
                row.className = 'checklist-item-row';
                
                const box = document.createElement('div'); // Visual only in editor? No, functional toggle
                box.className = 'ui-icon checklist-checkbox';
                let checkIcon = item.checked ? 'assets/svgs-fontawesome/solid/square-check.svg' : 'assets/svgs-fontawesome/regular/square.svg';
                renderInlineIcon(box, checkIcon);
                box.addEventListener('click', () => {
                    item.checked = !item.checked;
                    renderCheckItems();
                });

                const textIn = document.createElement('input');
                textIn.className = `checklist-input ${item.checked ? 'strike' : ''}`;
                textIn.value = item.text;
                textIn.placeholder = 'Item...';
                textIn.addEventListener('input', (e) => item.text = e.target.value);
                // Enter to add new
                textIn.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                         note.items.splice(idx + 1, 0, { text: '', checked: false });
                         renderCheckItems();
                         // Focus next
                         setTimeout(() => {
                             const inputs = checkContainer.querySelectorAll('input');
                             if (inputs[idx+1]) inputs[idx+1].focus();
                         }, 10);
                    }
                    // Backspace empty to delete
                    if (e.key === 'Backspace' && item.text === '' && note.items.length > 1) {
                         e.preventDefault();
                         note.items.splice(idx, 1);
                         renderCheckItems();
                         if (idx > 0) {
                             setTimeout(() => {
                                 const inputs = checkContainer.querySelectorAll('input');
                                 if (inputs[idx-1]) inputs[idx-1].focus();
                             }, 10);
                         }
                    }
                });

                const del = document.createElement('div');
                del.className = 'tm-btn round';
                del.style.width = '24px'; del.style.height = '24px';
                del.appendChild(createIcon('assets/svgs-fontawesome/solid/xmark.svg'));
                del.addEventListener('click', () => {
                    note.items.splice(idx, 1);
                    renderCheckItems();
                });

                row.appendChild(box);
                row.appendChild(textIn);
                row.appendChild(del);
                checkContainer.appendChild(row);
            });

            // Add new item button at bottom
             const addRow = document.createElement('button');
             addRow.className = 'tm-btn';
             addRow.style.alignSelf = 'flex-start';
             addRow.style.marginTop = '8px';
             addRow.innerHTML = `<span>+ Add Item</span>`;
             addRow.addEventListener('click', () => {
                 note.items.push({ text: '', checked: false });
                 renderCheckItems();
                  setTimeout(() => {
                     const inputs = checkContainer.querySelectorAll('input');
                     if (inputs.length > 0) inputs[inputs.length-1].focus();
                 }, 10);
             });
             checkContainer.appendChild(addRow);
        };

        if (!note.items.length) note.items.push({text:'', checked: false});
        renderCheckItems();
        form.appendChild(checkContainer);
    }

    // Footer Controls (Save)
    const footer = document.createElement('div');
    footer.className = 'notes-controls';
    
    const saveBtn = document.createElement('button');
    saveBtn.className = 'tm-btn primary';
    saveBtn.innerHTML = `<span>Save</span>`;
    saveBtn.addEventListener('click', () => {
        // Update state
        if (existingNote) {
            const idx = _state.notes.findIndex(n => n.id === existingNote.id);
            if (idx !== -1) _state.notes[idx] = note;
        } else {
            _state.notes.push(note);
        }
        saveState();
        renderListView(container);
    });

    footer.appendChild(saveBtn);
    form.appendChild(footer);

    container.appendChild(form);
}
