import { loadCSS } from './cssLoader.js';
import { renderInlineIcon } from './brandIconLoader.js';

const CSS_ID = 'notes-widget-css';
const CSS_PATH = 'css/notesWidget.css';
const STORAGE_KEY = 'tm_notes_v1';

let _container = null;
// Use a namespace for listeners to clean up if needed
let _listeners = {};

export async function initNotesWidget() {
    await loadCSS(CSS_PATH, CSS_ID);
    
    _container = document.createElement('div');
    _container.id = 'notes-widget-container';
    // Container just holds widgets, position is fixed on widgets
    document.body.appendChild(_container);

    renderWidgets();

    document.addEventListener('notes-updated', renderWidgets);
}

function getNotes() {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    } catch (e) { return []; }
}

function saveNoteState(updatedNote) {
    const notes = getNotes();
    const idx = notes.findIndex(n => n.id === updatedNote.id);
    if (idx !== -1) {
        notes[idx] = updatedNote;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
        // We do NOT dispatch 'notes-updated' here to avoid infinite render loop loops during drag,
        // or we just be careful. Drag ends only trigger save.
    }
}

function renderWidgets() {
    if (!_container) return;
    _container.innerHTML = '';
    
    const notes = getNotes();
    const pinned = notes.filter(n => n.pinned);

    pinned.forEach(note => {
        const w = document.createElement('div');
        w.className = 'note-widget';
        w.id = `widget-${note.id}`;
        
        // Defaults
        const x = note.x || 100;
        const y = note.y || 100;
        const width = note.width || 200;
        const height = note.height || 150;
        
        w.style.left = x + 'px';
        w.style.top = y + 'px';
        w.style.width = width + 'px';
        w.style.height = height + 'px';

        // Header
        const header = document.createElement('div');
        header.className = 'note-widget-header';
        
        const title = document.createElement('span');
        title.className = 'note-widget-title';
        title.textContent = note.title || (note.type==='checklist'?'Checklist':'Note');
        
        const controls = document.createElement('div');
        controls.className = 'note-widget-controls';
        
        const pinBtn = document.createElement('div');
        pinBtn.className = 'note-widget-btn';
        pinBtn.title = 'Unpin';
        const pinIcon = document.createElement('span'); pinIcon.className='ui-icon';
        renderInlineIcon(pinIcon, 'assets/svgs-fontawesome/solid/thumbtack.svg'); // Active
        pinIcon.style.color = 'var(--color-accent)';
        pinBtn.appendChild(pinIcon);
        pinBtn.addEventListener('click', (e) => {
            // Unpin logic
            e.stopPropagation(); // prevent drag start
            note.pinned = false;
            saveNoteState(note);
            renderWidgets(); // Re-render to remove
        });

        // Edit button? Maybe double click content to open modal? Or small edit icon.
        const editBtn = document.createElement('div');
        editBtn.className = 'note-widget-btn';
        editBtn.title = 'Open';
        const editIcon = document.createElement('span'); editIcon.className='ui-icon';
        renderInlineIcon(editIcon, 'assets/svgs-fontawesome/solid/up-right-from-square.svg'); 
        editBtn.appendChild(editIcon);
        editBtn.addEventListener('click', (e) => {
             e.stopPropagation();
             // We need to trigger the modal. 
             // We can emit an event that newtab listens to, or import toggleNotesModal (circular dependency risk?).
             // Let's use custom event.
             document.dispatchEvent(new CustomEvent('notes-open', { detail: { noteId: note.id } }));
        });

        controls.appendChild(editBtn);
        controls.appendChild(pinBtn);
        header.appendChild(title);
        header.appendChild(controls);
        w.appendChild(header);

        // Content
        const content = document.createElement('div');
        content.className = 'note-widget-content';
        
        if (note.type === 'note') {
            content.textContent = note.content;
        } else {
            // Checklist
            (note.items || []).forEach((item, idx) => {
                const row = document.createElement('div');
                row.className = 'widget-checklist-item';
                
                const box = document.createElement('div');
                box.className = 'ui-icon widget-checklist-box';
                 // Keep it simple size
                box.style.width = '16px'; box.style.height = '16px';
                renderInlineIcon(box, item.checked ? 'assets/svgs-fontawesome/solid/square-check.svg' : 'assets/svgs-fontawesome/regular/square.svg');
                
                // Toggle check from widget
                box.addEventListener('click', () => {
                     note.items[idx].checked = !note.items[idx].checked;
                     saveNoteState(note);
                     renderWidgets(); // Update UI
                });

                const txt = document.createElement('span');
                txt.className = `widget-checklist-text ${item.checked ? 'done' : ''}`;
                txt.textContent = item.text;
                
                row.appendChild(box);
                row.appendChild(txt);
                content.appendChild(row);
            });
        }
        w.appendChild(content);

        // DRAG LOGIC
        header.onmousedown = function(e) {
             if (e.target.closest('.note-widget-btn')) return; // Ignore buttons
             
             let shiftX = e.clientX - w.getBoundingClientRect().left;
             let shiftY = e.clientY - w.getBoundingClientRect().top;
             
             w.style.zIndex = 999; // Bring to front

             function moveAt(pageX, pageY) {
                 w.style.left = pageX - shiftX + 'px';
                 w.style.top = pageY - shiftY + 'px';
             }

             function onMouseMove(event) {
                 moveAt(event.clientX, event.clientY);
             }

             document.addEventListener('mousemove', onMouseMove);

             w.onmouseup = function() {
                 document.removeEventListener('mousemove', onMouseMove);
                 w.onmouseup = null;
                 w.style.zIndex = 999;
                 
                 // Save Position
                 note.x = parseInt(w.style.left);
                 note.y = parseInt(w.style.top);
                 saveNoteState(note);
             };
        };
        header.ondragstart = function() { return false; };


        // RESIZE LOGIC via Observer or Mouse events on borders?
        // Using CSS resize: both, we can detect size change via ResizeObserver and save it.
        const observer = new ResizeObserver(entries => {
            for (let entry of entries) {
                const newW = entry.contentRect.width + 16; // contentRect excludes padding/border usually? 
                // wait, resize applies to the element. entry.contentRect might be inner.
                // easier to just read offsetWidth/Height
                const el = entry.target;
                if (parseInt(el.style.width) !== el.offsetWidth || parseInt(el.style.height) !== el.offsetHeight) {
                    // It changed.
                    // But resize observer fires constantly. We need debounce or save only when interaction ends.
                }
            }
        });
        // CSS resize doesn't trigger a "resize end" event easily.
        // Alternative: Listen to 'mouseup' on the widget (resizing involves clicking bottom right).
        w.addEventListener('mouseup', () => {
             // Save size
             const rect = w.getBoundingClientRect();
             // Only save if changed significantly
             note.width = rect.width;
             note.height = rect.height;
             saveNoteState(note);
        });

        _container.appendChild(w);
    });
}
