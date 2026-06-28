// ==========================================
// 1. SUPABASE INITIALIZATION
// ==========================================
const SUPABASE_URL = 'https://htrysdkgnmabnidtbddv.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh0cnlzZGtnbm1hYm5pZHRiZGR2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIzODE2MzcsImV4cCI6MjA5Nzk1NzYzN30.nMFlqJwtyi9cBjpy9_gp3gEb2ZR4YezCrugP30zAzks';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Name of the Supabase Storage Bucket
const STORAGE_BUCKET = 'note-images';

// ==========================================
// 2. STATE & ELEMENTS
// ==========================================
let currentUser = null;
let notes = [];
let activeNote = null;
let saveTimeout = null;
let isDirty = false;
let isLoading = false; 

let isEditMode = false;
let selectedNoteIds = new Set();
let uploadInProgress = false; 

const screens = {
    auth: document.getElementById('auth-view'),
    home: document.getElementById('home-view'),
    trash: document.getElementById('trash-view'),
    editor: document.getElementById('editor-view'),
    account: document.getElementById('account-view'),
    settings: document.getElementById('settings-view')
};

// ==========================================
// 3. HARDWARE BACK BUTTON (EXPLICIT ROUTER FIX)
// ==========================================
window.addEventListener('hashchange', handleHashNavigation);

function handleHashNavigation() {
    let hash = window.location.hash.replace('#', '') || 'auth';

    if (!currentUser && hash !== 'auth') {
        window.location.replace('#auth');
        return;
    }
    if (currentUser && (hash === '' || hash === 'auth')) {
        window.location.replace('#home');
        return;
    }

    const previewModal = document.getElementById('image-preview-modal');
    if (previewModal.classList.contains('active')) {
        previewModal.classList.remove('active');
        window.history.pushState(null, null, '#editor');
        return; 
    }

    const isSidebar = hash === 'sidebar';
    const isEdit = hash === 'edit-mode';

    document.getElementById('sidebar').classList.toggle('active', isSidebar);
    document.getElementById('sidebar-overlay').classList.toggle('active', isSidebar);

    isEditMode = isEdit;
    document.getElementById('home-grid-container').classList.toggle('edit-mode-active', isEdit);
    document.getElementById('edit-action-bar').classList.toggle('hidden', !isEdit);
    document.querySelector('.fab-container').classList.toggle('hidden', isEdit);
    
    if (!isEdit) {
        selectedNoteIds.clear();
        updateEditActionUI();
    }

    if (isSidebar || isEdit) return;

    if (hash !== 'editor' && activeNote) {
        if (isDirty) {
            clearTimeout(saveTimeout);
            saveNote();
        }
        activeNote = null;
        uploadInProgress = false; 
        screens.editor.classList.remove('active');
        sessionStorage.removeItem('recoveringNoteId');
        
        notes.sort((a, b) => {
            if(a.is_pinned === b.is_pinned) return new Date(b.updated_at) - new Date(a.updated_at);
            return a.is_pinned ? -1 : 1;
        });
    }

    if (hash === 'editor' && !activeNote) {
        window.location.replace('#home');
        return;
    }

    const validScreens = ['auth', 'home', 'trash', 'account', 'settings', 'editor'];
    
    if (validScreens.includes(hash)) {
        Object.values(screens).forEach(s => s.classList.remove('active'));
        if (screens[hash]) {
            screens[hash].classList.add('active');
        }

        if (hash !== 'auth') {
            document.querySelectorAll('.nav-item').forEach(item => {
                item.classList.remove('active');
                if (item.dataset.target === `${hash}-view`) {
                    item.classList.add('active');
                }
            });
        }

        if (hash === 'home') renderGrid();
        if (hash === 'trash') renderTrashGrid();
    }
}

// ==========================================
// 4. APP INITIALIZATION & AUTH
// ==========================================
supabaseClient.auth.onAuthStateChange((event, session) => {
    if (session) {
        currentUser = session.user;
        const displayUsername = currentUser.user_metadata?.username || currentUser.email.split('@')[0];
        
        document.getElementById('acc-username').textContent = displayUsername;
        document.getElementById('acc-email-display').textContent = currentUser.email;
        document.getElementById('acc-id').textContent = `ID: ${currentUser.id}`;
        
        let currentHash = window.location.hash.replace('#', '');
        if (currentHash === '' || currentHash === 'auth') {
            window.location.replace('#home');
        } else {
            handleHashNavigation();
        }
        
        fetchNotes();
        loadSettings();
    } else {
        currentUser = null;
        notes = [];
        activeNote = null;
        uploadInProgress = false;

        document.getElementById('sidebar').classList.remove('active');
        document.getElementById('sidebar-overlay').classList.remove('active');
        
        document.getElementById('email').value = '';
        document.getElementById('password').value = '';
        document.getElementById('auth-error').textContent = '';

        if (window.location.hash !== '#auth') {
            window.location.replace('#auth');
        } else {
            handleHashNavigation();
        }
    }
});

document.getElementById('auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const errorEl = document.getElementById('auth-error');
    errorEl.textContent = 'Authenticating...';

    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    
    if (error) {
        const defaultUsername = email.split('@')[0];
        const { data: signUpData, error: signUpError } = await supabaseClient.auth.signUp({ 
            email, password, options: { data: { username: defaultUsername } }
        });
        
        if (signUpError) {
            errorEl.textContent = signUpError.message;
        } else if (signUpData.user && signUpData.user.identities.length === 0) {
             errorEl.textContent = 'Account exists but incorrect password.';
        } else {
            errorEl.textContent = 'Account created! Logging in...';
        }
    }
});

document.querySelectorAll('.toggle-password-btn').forEach(btn => {
    btn.addEventListener('click', function() {
        const targetId = this.getAttribute('data-target');
        const pwdInput = document.getElementById(targetId);
        
        if (pwdInput.type === 'password') {
            pwdInput.type = 'text';
            this.classList.replace('fa-eye', 'fa-eye-slash');
        } else {
            pwdInput.type = 'password';
            this.classList.replace('fa-eye-slash', 'fa-eye');
        }
    });
});

document.getElementById('logout-btn').addEventListener('click', async () => { 
    await supabaseClient.auth.signOut(); 
});

// ==========================================
// 5. NAVIGATION EXPLICIT UI BINDINGS
// ==========================================
document.querySelectorAll('.menu-btn-global').forEach(btn => btn.addEventListener('click', () => { window.location.hash = 'sidebar'; }));
document.getElementById('sidebar-overlay').addEventListener('click', () => { window.history.back(); });

document.querySelectorAll('.nav-item[data-target]').forEach(item => {
    item.addEventListener('click', (e) => {
        window.location.hash = e.currentTarget.dataset.target.replace('-view', '');
    });
});

// ==========================================
// 6. DATABASE LOGIC (FETCH & SAVE)
// ==========================================
async function fetchNotes() {
    isLoading = true;
    document.getElementById('home-loading').style.display = 'block';
    document.getElementById('trash-loading').style.display = 'block';
    document.getElementById('empty-state').style.display = 'none';
    document.getElementById('trash-empty-state').style.display = 'none';
    document.getElementById('notes-grid').innerHTML = '';
    document.getElementById('trash-grid').innerHTML = '';

    const { data, error } = await supabaseClient
        .from('notes')
        .select('*')
        .order('is_pinned', { ascending: false })
        .order('updated_at', { ascending: false });
    
    isLoading = false;
    document.getElementById('home-loading').style.display = 'none';
    document.getElementById('trash-loading').style.display = 'none';
    
    if (!error) { 
        notes = data; 
        if (screens.trash.classList.contains('active')) renderTrashGrid();
        else renderGrid(); 
        
        const recoveringNoteId = sessionStorage.getItem('recoveringNoteId');
        if (recoveringNoteId) {
            const noteToRecover = notes.find(n => n.id === recoveringNoteId && !n.is_trashed);
            if (noteToRecover) openEditor(noteToRecover);
            sessionStorage.removeItem('recoveringNoteId');
        }
    }
}

async function createNote(type = 'text') {
    const newNote = { 
        user_id: currentUser.id, title: '', content: '', note_type: type, 
        todos: [], images: [], color: 'default', text_color: '', is_trashed: false
    };
    
    const { data, error } = await supabaseClient.from('notes').insert([newNote]).select().single();
    if (error) { alert("Failed to create note: " + error.message); return; }
    if (data) {
        notes.unshift(data);
        openEditor(data);
    }
}

async function saveNote() {
    if (!activeNote) return;
    
    activeNote.title = document.getElementById('note-title').value;
    if (activeNote.note_type === 'text') {
        activeNote.content = document.getElementById('note-content').innerHTML;
    } else {
        activeNote.todos = Array.from(document.getElementById('todo-list').children).map(item => ({
            text: item.querySelector('.todo-input').value,
            checked: item.querySelector('.todo-checkbox').checked
        })).filter(t => t.text.trim() !== '');
    }
    
    activeNote.updated_at = new Date().toISOString();
    
    if (!uploadInProgress) {
        document.getElementById('save-status').textContent = 'Saving...';
    }
    
    const { error } = await supabaseClient.from('notes').update({ 
        title: activeNote.title, content: activeNote.content, note_type: activeNote.note_type,
        todos: activeNote.todos, images: activeNote.images, 
        is_pinned: activeNote.is_pinned, color: activeNote.color, text_color: activeNote.text_color, 
        updated_at: activeNote.updated_at 
    }).eq('id', activeNote.id);

    if (!error) {
        if (!uploadInProgress) {
            document.getElementById('save-status').textContent = 'Saved';
        }
        isDirty = false;
    } else {
        if (!uploadInProgress) {
            document.getElementById('save-status').textContent = 'Error';
        }
    }
}

function debouncedSave() {
    isDirty = true;
    clearTimeout(saveTimeout);
    if (!uploadInProgress) {
        document.getElementById('save-status').textContent = 'Typing...';
    }
    saveTimeout = setTimeout(saveNote, 1000); 
}

// ==========================================
// 7. MULTI-SELECT EDIT MODE
// ==========================================
function updateEditActionUI() {
    document.getElementById('selected-count').textContent = `${selectedNoteIds.size} Selected`;
    const visibleCards = document.querySelectorAll('#notes-grid .note-card');
    const selectAllBtn = document.getElementById('select-all-btn');
    
    if (visibleCards.length > 0 && selectedNoteIds.size === visibleCards.length) {
        selectAllBtn.textContent = 'Deselect All';
    } else {
        selectAllBtn.textContent = 'Select All';
    }

    document.querySelectorAll('.note-card').forEach(card => {
        if (selectedNoteIds.has(card.dataset.id)) card.classList.add('selected');
        else card.classList.remove('selected');
    });
}

document.getElementById('select-all-btn').addEventListener('click', () => {
    const visibleCards = document.querySelectorAll('#notes-grid .note-card');
    if (selectedNoteIds.size === visibleCards.length && visibleCards.length > 0) {
        selectedNoteIds.clear();
    } else {
        visibleCards.forEach(card => selectedNoteIds.add(card.dataset.id));
    }
    updateEditActionUI();
});

async function deleteSelectedNotes() {
    if (selectedNoteIds.size === 0) return;
    if (!confirm(`Move ${selectedNoteIds.size} note(s) to trash?`)) return;

    const idsArray = Array.from(selectedNoteIds);
    await supabaseClient.from('notes').update({ is_trashed: true, updated_at: new Date().toISOString() }).in('id', idsArray);

    notes.forEach(n => { if (idsArray.includes(n.id)) n.is_trashed = true; });
    window.location.hash = 'home'; 
    renderGrid();
}

document.getElementById('edit-mode-btn').addEventListener('click', () => { window.location.hash = 'edit-mode'; });
document.getElementById('cancel-edit-btn').addEventListener('click', () => { window.history.back(); });
document.getElementById('delete-selected-btn').addEventListener('click', deleteSelectedNotes);

// ==========================================
// 8. GRID RENDERING (HOME VS TRASH)
// ==========================================
function createNoteCard(note, isTrashView = false) {
    const card = document.createElement('div');
    card.className = 'note-card';
    card.dataset.id = note.id; 
    card.style.background = note.color === 'default' ? 'var(--bg-card)' : note.color;
    
    if (note.text_color) {
        card.style.color = note.text_color;
        card.classList.add('has-custom-text-color');
    }
    
    const checkboxHtml = `<div class="card-checkbox"></div>`;

    let iconsHtml = `<div class="card-icons">
        ${note.is_pinned && !isTrashView ? '<i class="fa-solid fa-thumbtack is-active-icon"></i>' : ''}
    </div>`;

    let contentHtml = '';
    if (note.images && note.images.length > 0) contentHtml += `<img src="${note.images[0]}" class="card-img-preview">`;

    if (note.note_type === 'todo' && note.todos) {
        const todoPrev = note.todos.slice(0,3).map(t => `<div class="card-todo-item">${t.checked ? '☑' : '☐'} ${t.text}</div>`).join('');
        contentHtml += `<div>${todoPrev}${note.todos.length > 3 ? '<div class="card-todo-item">...</div>':''}</div>`;
    } else {
        let textOnly = document.createElement('div');
        textOnly.innerHTML = note.content;
        contentHtml += `<div class="card-preview">${textOnly.textContent || textOnly.innerText || ''}</div>`;
    }

    let trashActionsHtml = isTrashView ? `
        <div class="trash-actions">
            <button class="trash-btn btn-restore" onclick="restoreNote('${note.id}', event)"><i class="fa-solid fa-rotate-left"></i> Restore</button>
            <button class="trash-btn btn-perm-delete" onclick="permanentlyDeleteNote('${note.id}', event)"><i class="fa-solid fa-trash"></i></button>
        </div>
    ` : '';

    card.innerHTML = `
        ${!isTrashView ? checkboxHtml : ''}
        ${iconsHtml}
        <div class="card-title">${note.title || 'Untitled'}</div>
        ${contentHtml}
        <div class="card-date">${new Date(note.updated_at).toLocaleDateString('en-US', {month:'short', day:'numeric'})}</div>
        ${trashActionsHtml}
    `;

    card.addEventListener('click', (e) => {
        if (isTrashView) return; 
        
        if (isEditMode) {
            if (selectedNoteIds.has(note.id)) selectedNoteIds.delete(note.id);
            else selectedNoteIds.add(note.id);
            updateEditActionUI();
        } else {
            openEditor(note);
        }
    });
    return card;
}

function renderGrid() {
    const grid = document.getElementById('notes-grid');
    const query = document.getElementById('search-input').value.toLowerCase();
    grid.innerHTML = '';
    
    if (isLoading) {
        document.getElementById('empty-state').style.display = 'none';
        return;
    }

    let filtered = notes.filter(n => !n.is_trashed && (n.title.toLowerCase().includes(query) || (n.content && n.content.toLowerCase().includes(query))));
    
    if (filtered.length === 0) {
        document.getElementById('empty-state').style.display = 'block';
    } else {
        document.getElementById('empty-state').style.display = 'none';
        filtered.forEach(note => grid.appendChild(createNoteCard(note, false)));
    }
}
document.getElementById('search-input').addEventListener('input', renderGrid);

function renderTrashGrid() {
    const grid = document.getElementById('trash-grid');
    grid.innerHTML = '';

    if (isLoading) {
        document.getElementById('trash-empty-state').style.display = 'none';
        return;
    }

    let trashedNotes = notes.filter(n => n.is_trashed);
    
    if (trashedNotes.length === 0) {
        document.getElementById('trash-empty-state').style.display = 'block';
    } else {
        document.getElementById('trash-empty-state').style.display = 'none';
        trashedNotes.forEach(note => grid.appendChild(createNoteCard(note, true)));
    }
}

async function restoreNote(id, e) {
    if(e) e.stopPropagation();
    await supabaseClient.from('notes').update({ is_trashed: false }).eq('id', id);
    const note = notes.find(n => n.id === id);
    if(note) note.is_trashed = false;
    renderTrashGrid(); renderGrid();      
}

async function permanentlyDeleteNote(id, e) {
    if(e) e.stopPropagation();
    if(!confirm("Permanently delete this note? This cannot be undone.")) return;
    
    const note = notes.find(n => n.id === id);
    if (note && note.images && note.images.length > 0) {
        for (let imgUrl of note.images) {
            if (imgUrl.includes(STORAGE_BUCKET)) {
                const pathParts = imgUrl.split(`${STORAGE_BUCKET}/`);
                if (pathParts.length > 1) {
                    await supabaseClient.storage.from(STORAGE_BUCKET).remove([pathParts[1]]);
                }
            }
        }
    }

    await supabaseClient.from('notes').delete().eq('id', id);
    notes = notes.filter(n => n.id !== id);
    renderTrashGrid();
}

document.getElementById('empty-trash-btn').addEventListener('click', async () => {
    let trashedNotes = notes.filter(n => n.is_trashed);
    if (trashedNotes.length === 0) return;
    if(!confirm("Empty Trash? All deleted notes will be permanently destroyed.")) return;
    
    for (let note of trashedNotes) {
        if (note.images && note.images.length > 0) {
            for (let imgUrl of note.images) {
                if (imgUrl.includes(STORAGE_BUCKET)) {
                    const pathParts = imgUrl.split(`${STORAGE_BUCKET}/`);
                    if (pathParts.length > 1) {
                        await supabaseClient.storage.from(STORAGE_BUCKET).remove([pathParts[1]]);
                    }
                }
            }
        }
    }

    const ids = trashedNotes.map(n => n.id);
    await supabaseClient.from('notes').delete().in('id', ids);
    notes = notes.filter(n => !n.is_trashed);
    renderTrashGrid();
});

// ==========================================
// 9. EDITOR LOGIC
// ==========================================
document.getElementById('text-color-picker').addEventListener('input', function(e) {
    const color = e.target.value;
    activeNote.text_color = color;
    
    document.getElementById('text-color-indicator').style.backgroundColor = color;
    screens.editor.style.setProperty('--note-text-color', color);
    
    debouncedSave();
});

function openEditor(note) {
    activeNote = note;
    isDirty = false; 
    uploadInProgress = false;
    sessionStorage.setItem('recoveringNoteId', note.id); 
    document.getElementById('save-status').textContent = '';
    
    document.getElementById('note-title').value = note.title;
    document.getElementById('note-date').textContent = new Date(note.updated_at).toLocaleString();
    screens.editor.style.background = note.color === 'default' ? 'var(--bg-card)' : note.color;
    document.getElementById('color-picker').classList.add('hidden');
    document.getElementById('pin-btn').className = note.is_pinned ? 'is-active-icon' : '';

    if (note.text_color) {
        screens.editor.style.setProperty('--note-text-color', note.text_color);
        document.getElementById('text-color-picker').value = note.text_color;
        document.getElementById('text-color-indicator').style.backgroundColor = note.text_color;
    } else {
        screens.editor.style.removeProperty('--note-text-color');
        const defaultColor = document.documentElement.getAttribute('data-theme') === 'dark' ? '#ffffff' : '#000000';
        document.getElementById('text-color-picker').value = defaultColor;
        document.getElementById('text-color-indicator').style.backgroundColor = defaultColor;
    }

    if (note.note_type === 'todo') {
        document.getElementById('note-content').classList.add('hidden');
        document.getElementById('todo-content').classList.remove('hidden');
        renderTodos();
    } else {
        document.getElementById('note-content').classList.remove('hidden');
        document.getElementById('todo-content').classList.add('hidden');
        document.getElementById('note-content').innerHTML = note.content;
    }

    renderMedia();
    window.location.hash = 'editor'; 
}

document.getElementById('back-btn').addEventListener('click', () => { window.history.back(); });

document.getElementById('delete-btn').addEventListener('click', async () => {
    if(confirm('Move this note to Trash?')) {
        await supabaseClient.from('notes').update({ is_trashed: true, updated_at: new Date().toISOString() }).eq('id', activeNote.id);
        const note = notes.find(n => n.id === activeNote.id);
        if(note) { note.is_trashed = true; note.updated_at = new Date().toISOString(); }
        isDirty = false; 
        window.history.back();
    }
});

document.getElementById('note-title').addEventListener('input', debouncedSave);
document.getElementById('note-content').addEventListener('input', function() {
    if (this.innerHTML === '<br>') this.innerHTML = '';
    debouncedSave();
});
document.getElementById('new-todo-input').addEventListener('keypress', function(e) {
    if(e.key === 'Enter' && this.value.trim() !== '') {
        if (!activeNote.todos) activeNote.todos = [];
        activeNote.todos.push({ text: this.value.trim(), checked: false });
        this.value = '';
        renderTodos();
        debouncedSave();
    }
});
document.getElementById('pin-btn').addEventListener('click', function() { activeNote.is_pinned = !activeNote.is_pinned; this.classList.toggle('is-active-icon'); debouncedSave(); });
document.getElementById('color-btn').addEventListener('click', () => document.getElementById('color-picker').classList.toggle('hidden'));

document.querySelectorAll('.color-swatch').forEach(el => {
    el.addEventListener('click', (e) => {
        const c = e.target.dataset.color;
        activeNote.color = c;
        screens.editor.style.background = c === 'default' ? 'var(--bg-card)' : c;
        document.getElementById('color-picker').classList.add('hidden');
        debouncedSave();
    });
});

function renderTodos() {
    const list = document.getElementById('todo-list');
    list.innerHTML = '';
    if (!activeNote.todos) activeNote.todos = [];

    activeNote.todos.forEach((todo, idx) => {
        const item = document.createElement('div');
        item.className = `todo-item ${todo.checked ? 'checked' : ''}`;
        
        item.innerHTML = `
            <input type="checkbox" class="todo-checkbox" ${todo.checked ? 'checked' : ''}>
            <input type="text" class="todo-input" value="${todo.text}">
        `;
        
        item.querySelector('.todo-checkbox').addEventListener('change', (e) => {
            todo.checked = e.target.checked;
            item.classList.toggle('checked');
            debouncedSave();
        });
        item.querySelector('.todo-input').addEventListener('input', (e) => {
            todo.text = e.target.value;
            debouncedSave();
        });
        list.appendChild(item);
    });
}

document.getElementById('toggle-todo-btn').addEventListener('click', () => {
    if (activeNote.note_type === 'text') {
        activeNote.note_type = 'todo';
        const txt = document.getElementById('note-content').innerText.trim();
        if(txt) activeNote.todos = [{text: txt, checked: false}];
        document.getElementById('note-content').classList.add('hidden');
        document.getElementById('todo-content').classList.remove('hidden');
        renderTodos();
    } else {
        activeNote.note_type = 'text';
        activeNote.content = activeNote.todos.map(t => t.text).join('<br>');
        document.getElementById('note-content').innerHTML = activeNote.content;
        document.getElementById('note-content').classList.remove('hidden');
        document.getElementById('todo-content').classList.add('hidden');
    }
    debouncedSave();
});

// ==========================================
// 10. MULTIMEDIA & IMAGE PREVIEW (NATIVE DIRECT UPLOAD)
// ==========================================
const clearInputValue = function() { this.value = null; };
document.getElementById('file-upload').addEventListener('click', clearInputValue);

async function handleImageUpload(e) {
    const file = e.target.files[0];
    if(!file) return;
    
    uploadInProgress = true;
    document.getElementById('save-status').textContent = 'Uploading...';

    try {
        const fileExt = file.name.includes('.') ? file.name.split('.').pop() : 'jpg';
        const fileName = `${currentUser.id}/${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;

        const { data, error } = await supabaseClient
            .storage
            .from(STORAGE_BUCKET)
            .upload(fileName, file, {
                contentType: file.type || 'image/jpeg',
                cacheControl: '3600',
                upsert: false
            });

        if (error) {
            alert("SUPABASE UPLOAD ERROR:\n" + error.message);
            console.error("Storage Error Details:", error);
            uploadInProgress = false;
            document.getElementById('save-status').textContent = 'Upload failed';
            return;
        }

        const { data: publicUrlData } = supabaseClient
            .storage
            .from(STORAGE_BUCKET)
            .getPublicUrl(fileName);

        const publicUrl = publicUrlData.publicUrl;

        if(!activeNote.images) activeNote.images = [];
        activeNote.images.push(publicUrl);
        
        renderMedia();
        uploadInProgress = false;
        document.getElementById('save-status').textContent = 'Saved';
        debouncedSave();
    
    } catch (err) {
        alert("UNEXPECTED ERROR:\n" + err.message);
        console.error("Unexpected Error Details:", err);
        uploadInProgress = false;
        document.getElementById('save-status').textContent = 'Upload failed';
    }
}

document.getElementById('file-upload').addEventListener('change', handleImageUpload);

function renderMedia() {
    const gal = document.getElementById('image-gallery');
    gal.innerHTML = '';
    if(activeNote.images) {
        activeNote.images.forEach((src, i) => {
            const w = document.createElement('div');
            w.className = 'img-wrapper';
            w.innerHTML = `<img src="${src}"><div class="delete-img" data-idx="${i}"><i class="fa-solid fa-xmark"></i></div>`;
            
            w.querySelector('img').addEventListener('click', () => {
                document.getElementById('preview-image').src = src;
                document.getElementById('image-preview-modal').classList.add('active'); 
            });

            w.querySelector('.delete-img').addEventListener('click', async (e) => {
                e.stopPropagation(); 
                const idx = e.currentTarget.dataset.idx;
                const imgUrl = activeNote.images[idx];

                activeNote.images.splice(idx, 1);
                renderMedia();
                debouncedSave();

                if (imgUrl.includes(STORAGE_BUCKET)) {
                    const pathParts = imgUrl.split(`${STORAGE_BUCKET}/`);
                    if (pathParts.length > 1) {
                        const filePath = pathParts[1];
                        await supabaseClient.storage.from(STORAGE_BUCKET).remove([filePath]);
                    }
                }
            });
            gal.appendChild(w);
        });
    }
}

document.getElementById('close-preview-btn').addEventListener('click', () => { 
    document.getElementById('image-preview-modal').classList.remove('active');
});

// ==========================================
// 11. FAB ANIMATION
// ==========================================
const fabMain = document.getElementById('fab-main');
const fabMenu = document.getElementById('fab-menu');

fabMain.addEventListener('click', () => {
    fabMain.classList.toggle('active'); 
    fabMenu.classList.toggle('active'); 
});

document.getElementById('fab-text').addEventListener('click', async () => {
    await createNote('text');
    fabMain.classList.remove('active'); fabMenu.classList.remove('active');
});

document.getElementById('fab-image').addEventListener('click', async () => {
    await createNote('text');
    document.getElementById('file-upload').click();
    fabMain.classList.remove('active'); fabMenu.classList.remove('active');
});

document.getElementById('fab-todo').addEventListener('click', async () => {
    await createNote('todo');
    fabMain.classList.remove('active'); fabMenu.classList.remove('active');
});

// ==========================================
// 12. SETTINGS LOGIC 
// ==========================================
function loadSettings() {
    const isDark = localStorage.getItem('theme') === 'dark';
    document.getElementById('theme-toggle').checked = isDark;
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
}

document.getElementById('theme-toggle').addEventListener('change', (e) => {
    const theme = e.target.checked ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
    
    if (activeNote && !activeNote.text_color) {
        document.getElementById('text-color-indicator').style.backgroundColor = theme === 'dark' ? '#ffffff' : '#000000';
        document.getElementById('text-color-picker').value = theme === 'dark' ? '#ffffff' : '#000000';
    }
});

document.getElementById('username-update-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const newUsername = document.getElementById('new-username').value.trim();
    const msg = document.getElementById('username-msg');
    msg.textContent = 'Updating username...'; 
    msg.style.color = 'var(--text-muted)';
    
    const { data, error } = await supabaseClient.auth.updateUser({ data: { username: newUsername } });
    if (error) {
        msg.textContent = error.message;
        msg.style.color = 'var(--danger)';
    } else {
        msg.textContent = 'Username successfully updated!';
        msg.style.color = '#10b981';
        document.getElementById('acc-username').textContent = newUsername;
        currentUser = data.user; 
        document.getElementById('new-username').value = '';
    }
});

document.getElementById('password-reset-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const currentPwd = document.getElementById('current-pwd').value;
    const newPwd = document.getElementById('new-pwd').value;
    const msg = document.getElementById('pwd-msg');
    
    msg.textContent = 'Verifying current password...'; 
    msg.style.color = 'var(--text-muted)';
    
    const { error: verifyError } = await supabaseClient.auth.signInWithPassword({ email: currentUser.email, password: currentPwd });

    if (verifyError) {
        msg.textContent = 'Incorrect current password. Access denied.';
        msg.style.color = 'var(--danger)';
        return;
    }

    msg.textContent = 'Updating to new password...';
    const { error } = await supabaseClient.auth.updateUser({ password: newPwd });
    
    if (error) { 
        msg.textContent = error.message; msg.style.color = 'var(--danger)'; 
    } else { 
        msg.textContent = 'Password successfully updated!'; msg.style.color = '#10b981'; 
        document.getElementById('current-pwd').value = ''; document.getElementById('new-pwd').value = '';
    }
});