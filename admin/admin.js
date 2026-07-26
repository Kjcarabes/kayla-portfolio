/**
 * Kayla Carabes — admin portal
 *
 * Loads content/*.json via the Worker, presents form editors, and saves edits +
 * uploaded images back as one atomic commit. Adding a new work can also post the
 * photo to Instagram in the same action. No build step — plain vanilla JS.
 */

// The deployed Cloudflare Worker (admin-worker/). Update here if it's redeployed.
const WORKER_URL = 'https://kayla-admin.bb69z8ddnz.workers.dev';

// =================== STATE ===================
const state = {
  workerUrl: WORKER_URL,
  secret: localStorage.getItem('kadmin_secret') || '',
  files: {},           // path -> parsed JSON (edit target)
  original: {},        // path -> snapshot at load (change detection)
  baseShas: {},        // path -> git blob SHA at load (optimistic-lock guard)
  pendingImages: [],   // { path, base64, contentType, dataUrl }
  pendingInstagram: null, // { imagePath, caption } set by the add-work flow
  dirty: new Set(),
  openWorks: new Set(), // which work rows are expanded (survives re-render)
  activeTab: 'works',
};

const FILE = {
  works: 'content/works.json',
  blog: 'content/blog.json',
  shop: 'content/shop-items.json',
  about: 'content/about.json',
  settings: 'content/site-settings.json',
  card: 'content/card.json',
};

const SITE = 'https://www.kaylacarabes.com';

// A little love note in the top banner — random each load, greeting is time-aware.
function cuteMessage() {
  const h = new Date().getHours();
  const tod = h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'night';
  const msgs = [
    `good ${tod} beauuuuuutiful ❤️`,
    `hey there, you're lookin' my t fyne 😮‍💨`,
    `hey there sexy, uploading art? 👀`,
    `I love u honeybear 🍯🐻`,
    `you're totally the sesame ball 🥮`,
    `hey baby, nice art you got there 😘`,
    'hey love 😗'
  ];
  return msgs[Math.floor(Math.random() * msgs.length)];
}

// Inline Instagram glyph (CSP-safe — no external image), gradient-tinted.
const IG_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" style="vertical-align:-3px"><defs><linearGradient id="iggrad" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#feda75"/><stop offset=".45" stop-color="#d62976"/><stop offset="1" stop-color="#4f5bd5"/></linearGradient></defs><rect x="2" y="2" width="20" height="20" rx="5.5" fill="none" stroke="url(#iggrad)" stroke-width="2"/><circle cx="12" cy="12" r="4.3" fill="none" stroke="url(#iggrad)" stroke-width="2"/><circle cx="17.6" cy="6.4" r="1.4" fill="url(#iggrad)"/></svg>';

// =================== UTIL ===================
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const escapeAttr = escapeHtml;
const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'item';

function pathTokens(path) {
  return path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(s => s !== '');
}
function getByPath(obj, path) {
  return pathTokens(path).reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
function setByPath(obj, path, value) {
  const ks = pathTokens(path);
  let cur = obj;
  for (let i = 0; i < ks.length - 1; i++) {
    const k = ks[i];
    if (cur[k] == null) cur[k] = /^\d+$/.test(ks[i + 1]) ? [] : {};
    cur = cur[k];
  }
  cur[ks[ks.length - 1]] = value;
}
const deepEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function imgPreviewSrc(path) {
  if (!path) return '';
  const pending = state.pendingImages.find(p => p.path === path);
  if (pending) return pending.dataUrl;
  return `${SITE}/${path}`;
}

// =================== DIRTY TRACKING ===================
function recomputeDirty() {
  state.dirty.clear();
  for (const path of Object.keys(state.files)) {
    if (!deepEqual(state.files[path], state.original[path])) state.dirty.add(path);
  }
  updateDirtyStatus();
}
function updateDirtyStatus() {
  const count = state.dirty.size + (state.pendingImages.length ? 1 : 0);
  const status = $('#dirty-status');
  const btn = $('#save-btn');
  if (!count) {
    status.textContent = 'No changes';
    status.className = 'dirty-status muted';
    btn.disabled = true;
  } else {
    const parts = [];
    if (state.dirty.size) parts.push(`${state.dirty.size} file${state.dirty.size === 1 ? '' : 's'}`);
    if (state.pendingImages.length) parts.push(`${state.pendingImages.length} image${state.pendingImages.length === 1 ? '' : 's'}`);
    status.textContent = `${parts.join(' + ')} changed`;
    status.className = 'dirty-status';
    btn.disabled = false;
  }
}

// =================== CONNECT ===================
async function connect() {
  const url = WORKER_URL;
  const secret = $('#admin-secret').value;
  const errEl = $('#connect-error');
  errEl.hidden = true;
  if (!secret) { errEl.textContent = 'Enter your password.'; errEl.hidden = false; return; }

  const btn = $('#connect-btn');
  btn.disabled = true; btn.textContent = 'Signing in…';
  try {
    const r = await fetch(`${url}/api/load`, {
      method: 'POST',
      headers: { 'X-Admin-Secret': secret, 'Content-Type': 'application/json' },
    });
    if (r.status === 401) throw new Error('Wrong password.');
    if (!r.ok) throw new Error(`Server error ${r.status}.`);
    const data = await r.json();

    state.secret = secret;
    state.files = JSON.parse(JSON.stringify(data.files));
    state.original = JSON.parse(JSON.stringify(data.files));
    state.baseShas = data.shas || {};
    localStorage.setItem('kadmin_secret', secret);

    $('#connect-screen').hidden = true;
    $('#editor').hidden = false;
    renderActiveTab();
    updateDirtyStatus();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.hidden = false;
  } finally {
    btn.disabled = false; btn.textContent = 'Sign in';
  }
}
function disconnect() {
  localStorage.removeItem('kadmin_secret');
  location.reload();
}

// =================== TABS ===================
function switchTab(tab) {
  state.activeTab = tab;
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  $$('.panel').forEach(p => p.classList.toggle('active', p.dataset.panel === tab));
  renderActiveTab();
}
function renderActiveTab() {
  ({ works: renderWorks, blog: renderBlog, shop: renderShop, about: renderAbout, settings: renderSettings, card: renderCard }[state.activeTab])?.();
}

// =================== FIELD HELPERS ===================
function input(file, key, label, opts = {}) {
  const v = getByPath(state.files[file], key) ?? '';
  return `<div class="field">
      <label class="field-label">${escapeHtml(label)}</label>
      <input type="${opts.type || 'text'}" data-file="${escapeAttr(file)}" data-key="${escapeAttr(key)}" value="${escapeAttr(v)}" ${opts.placeholder ? `placeholder="${escapeAttr(opts.placeholder)}"` : ''}>
      ${opts.hint ? `<div class="field-hint">${escapeHtml(opts.hint)}</div>` : ''}
    </div>`;
}
function textarea(file, key, label, opts = {}) {
  const v = getByPath(state.files[file], key) ?? '';
  return `<div class="field">
      <label class="field-label">${escapeHtml(label)}</label>
      <textarea data-file="${escapeAttr(file)}" data-key="${escapeAttr(key)}" rows="${opts.rows || 4}">${escapeHtml(v)}</textarea>
    </div>`;
}
function select(file, key, label, options) {
  const v = getByPath(state.files[file], key) ?? '';
  return `<div class="field">
      <label class="field-label">${escapeHtml(label)}</label>
      <select data-file="${escapeAttr(file)}" data-key="${escapeAttr(key)}">
        ${options.map(o => `<option value="${escapeAttr(o.value)}" ${o.value === v ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}
      </select>
    </div>`;
}
function checkbox(file, key, label) {
  const v = !!getByPath(state.files[file], key);
  return `<label class="field-checkbox">
      <input type="checkbox" data-file="${escapeAttr(file)}" data-key="${escapeAttr(key)}" ${v ? 'checked' : ''}> ${escapeHtml(label)}
    </label>`;
}
// Text input with autocomplete suggestions — lets Kayla pick an existing value
// or type a brand-new one (used for categories).
function datalistInput(file, key, label, options, opts = {}) {
  const v = getByPath(state.files[file], key) ?? '';
  const listId = `dl-${String(key).replace(/[^a-z0-9]/gi, '')}`;
  return `<div class="field">
      <label class="field-label">${escapeHtml(label)}</label>
      <input type="text" list="${listId}" data-file="${escapeAttr(file)}" data-key="${escapeAttr(key)}" value="${escapeAttr(v)}" ${opts.placeholder ? `placeholder="${escapeAttr(opts.placeholder)}"` : ''}>
      <datalist id="${listId}">${options.map(o => `<option value="${escapeAttr(o)}"></option>`).join('')}</datalist>
    </div>`;
}

function imageField(file, key, label) {
  const path = getByPath(state.files[file], key) || '';
  const src = imgPreviewSrc(path);
  return `<div class="field">
      <label class="field-label">${escapeHtml(label)}</label>
      <div class="image-picker">
        <div class="image-preview">${src ? `<img src="${escapeAttr(src)}" alt="">` : 'No image'}</div>
        <div class="image-controls">
          <input type="file" accept="image/*" data-img-file="${escapeAttr(file)}" data-img-key="${escapeAttr(key)}">
          <span class="image-path">${escapeHtml(path || '(no image yet)')}</span>
        </div>
      </div>
    </div>`;
}

// =================== DELEGATED INPUT ===================
document.addEventListener('input', (e) => {
  const t = e.target;
  if (!t.dataset.file || !t.dataset.key) return;
  let value;
  if (t.type === 'checkbox') value = t.checked;
  else if (t.type === 'number') value = t.value === '' ? null : Number(t.value);
  else value = t.value;
  if (!state.files[t.dataset.file]) state.files[t.dataset.file] = {};
  setByPath(state.files[t.dataset.file], t.dataset.key, value);
  recomputeDirty();
});

document.addEventListener('change', async (e) => {
  const t = e.target;
  if (!t.dataset.imgFile) return;
  const file = t.files?.[0];
  if (!file) return;
  const clean = file.name.replace(/[^a-zA-Z0-9._-]+/g, '-').toLowerCase();
  const targetPath = `assets/images/${clean}`;
  const dataUrl = await new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result); r.onerror = rej;
    r.readAsDataURL(file);
  });
  state.pendingImages = state.pendingImages.filter(p => p.path !== targetPath);
  state.pendingImages.push({ path: targetPath, base64: dataUrl.split(',')[1], contentType: file.type, dataUrl });

  setByPath(state.files[t.dataset.imgFile], t.dataset.imgKey, targetPath);
  // Changing a work's image invalidates its precomputed dimensions — let the
  // optimize-images Action recompute them.
  if (t.dataset.imgFile === FILE.works) {
    const base = t.dataset.imgKey.replace(/\.image$/, '');
    const obj = getByPath(state.files[FILE.works], base);
    if (obj && typeof obj === 'object') { delete obj.aspectRatio; delete obj.widths; }
  }
  recomputeDirty();
  renderActiveTab();
});

// =================== PANEL: WORKS ===================
const CATEGORY_OPTS = [{ value: 'Paintings', label: 'Paintings' }, { value: 'Etchings', label: 'Etchings' }];
const CATEGORY_LIST = ['Paintings', 'Etchings'];
const STATUS_OPTS = [
  { value: 'available', label: 'Available (for sale)' },
  { value: 'sold', label: 'Sold' },
  { value: 'nfs', label: 'Not for sale' },
];

function renderWorks() {
  const root = $('[data-panel="works"]');
  const works = getByPath(state.files[FILE.works], 'works') || [];
  root.innerHTML = `
    <div class="section">
      <button class="btn primary big-add" data-action="add-work">+ Add a new work</button>
      <p class="tab-hint" style="margin:.7rem 0 0">Click any work below to edit its details. Adding a work can also post it to Instagram in the same step — image sizes are generated automatically after publishing.</p>
    </div>
    ${works.map((w, i) => `
      <details class="list-item" data-work-id="${escapeAttr(w.id)}" ${state.openWorks.has(w.id) ? 'open' : ''}>
        <summary class="list-item-header">
          <span class="summary-main">
            <span class="summary-caret">▶</span>
            <img class="row-thumb" src="${escapeAttr(imgPreviewSrc(w.image))}" alt="" loading="lazy">
            <span class="list-item-title">${escapeHtml(w.title || w.id || `Work ${i + 1}`)} <span class="muted">· ${escapeHtml(w.originalStatus || '')}</span></span>
          </span>
          <span class="list-item-actions">
            <button data-action="move-work-up" data-i="${i}">↑</button>
            <button data-action="move-work-down" data-i="${i}">↓</button>
            <button data-action="del-work" data-i="${i}" class="danger">Delete</button>
          </span>
        </summary>
        ${workFields(i)}
      </details>
    `).join('')}
  `;
}

function workFields(i) {
  const f = FILE.works;
  const p = `works.${i}`;
  return `
    ${imageField(f, `${p}.image`, 'Image')}
    <div class="field-row">
      ${input(f, `${p}.title`, 'Title')}
      ${input(f, `${p}.id`, 'ID (URL slug — keep unique)')}
    </div>
    <div class="field-row">
      ${input(f, `${p}.date`, 'Date', { type: 'date' })}
      ${datalistInput(f, `${p}.category`, 'Category (pick or type a new one)', CATEGORY_LIST)}
    </div>
    <div class="field-row">
      ${input(f, `${p}.medium`, 'Medium', { placeholder: 'Oil on canvas' })}
      ${input(f, `${p}.size`, 'Size', { placeholder: '16in x 20in' })}
    </div>
    ${textarea(f, `${p}.description`, 'Description', { rows: 3 })}
    <div>
      ${checkbox(f, `${p}.featured`, 'Featured (home “Selected Work”)')}
      ${checkbox(f, `${p}.heroFeature`, 'Hero slideshow')}
      ${checkbox(f, `${p}.noPrint`, 'No print offered')}
    </div>
    <h4>Original</h4>
    ${select(f, `${p}.originalStatus`, 'Original status', STATUS_OPTS)}
    <h4>Print</h4>
    <div class="field-row">
      ${input(f, `${p}.printPrice`, 'Print price ($ — 0 or blank = sold out)', { type: 'number' })}
      ${input(f, `${p}.printStock`, 'Print stock (blank = unlimited)', { type: 'number' })}
    </div>
    <div class="field-row">
      ${input(f, `${p}.printDescription`, 'Print description', { placeholder: 'Print' })}
      ${input(f, `${p}.printOrder`, 'Print sort order (lower = first)', { type: 'number' })}
    </div>
    <h4>Extra detail images (shown on this work’s own page)</h4>
    ${(getByPath(state.files[f], `${p}.detail_images`) || []).map((_, j) => `
      <div style="display:flex;gap:.5rem;align-items:flex-start">
        <div style="flex:1">${imageField(f, `${p}.detail_images.${j}`, `Detail image ${j + 1}`)}</div>
        <button data-action="del-detail-img" data-i="${i}" data-j="${j}" class="danger" style="margin-top:1.5rem">Remove</button>
      </div>`).join('')}
    <button class="add-btn" data-action="add-detail-img" data-i="${i}">+ Add detail image</button>
  `;
}

// ---- Add-work modal (with optional Instagram post) ----
function showAddWorkModal() {
  const root = $('#modal-root');
  const today = new Date().toISOString().slice(0, 10);
  root.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal">
        <button class="modal-close" id="aw-x" aria-label="Close">&times;</button>
        <h2>Add a new work</h2>
        <div id="aw-image">${'' /* filled below */}</div>
        <div class="field"><label class="field-label">Title</label><input type="text" id="aw-title"></div>
        <div class="field-row">
          <div class="field"><label class="field-label">Date</label><input type="date" id="aw-date" value="${today}"></div>
          <div class="field"><label class="field-label">Category</label>
            <select id="aw-category">${CATEGORY_OPTS.map(o => `<option value="${o.value}">${o.label}</option>`).join('')}</select>
          </div>
        </div>
        <div class="field-row">
          <div class="field"><label class="field-label">Medium</label><input type="text" id="aw-medium" placeholder="Oil on canvas"></div>
          <div class="field"><label class="field-label">Size</label><input type="text" id="aw-size" placeholder="16in x 20in"></div>
        </div>
        <div class="field"><label class="field-label">Description</label><textarea id="aw-description" rows="3"></textarea></div>
        <div class="field-row">
          <div class="field"><label class="field-label">Original status</label>
            <select id="aw-status">${STATUS_OPTS.map(o => `<option value="${o.value}">${o.label}</option>`).join('')}</select>
          </div>
          <div class="field"><label class="field-label">Print price ($, blank = none)</label><input type="number" id="aw-printprice"></div>
        </div>
        <div class="field-row">
          <div class="field"><label class="field-label">Print stock / edition size (blank = unlimited)</label><input type="number" id="aw-printstock"></div>
          <div class="field"><label class="field-label">Print note (optional)</label><input type="text" id="aw-printdesc" placeholder="e.g. Made to order — ships in ~2 weeks"></div>
        </div>
        <div>
          <label class="field-checkbox"><input type="checkbox" id="aw-featured"> Featured on home</label>
          <label class="field-checkbox"><input type="checkbox" id="aw-hero"> Hero slideshow</label>
        </div>

        <h4>Instagram</h4>
        <label class="field-checkbox"><input type="checkbox" id="aw-ig" checked> ${IG_ICON} Also post this photo to Instagram</label>
        <div class="field"><label class="field-label">Caption</label><textarea id="aw-caption" rows="3"></textarea></div>

        <p id="aw-error" class="error-text" hidden></p>
        <div class="modal-actions">
          <button id="aw-cancel">Cancel</button>
          <button id="aw-publish" class="primary">Publish</button>
        </div>
      </div>
    </div>`;

  // image picker (uses a dedicated handler, not the JSON-bound one)
  $('#aw-image').innerHTML = `<div class="field">
      <label class="field-label">Image (required)</label>
      <div class="image-picker">
        <div class="image-preview" id="aw-preview">No image</div>
        <div class="image-controls"><input type="file" accept="image/*" id="aw-file"><span class="image-path" id="aw-filename">Choose a JPG</span></div>
      </div>
    </div>`;

  let picked = null; // { path, base64, contentType, dataUrl }
  const syncCaption = () => {
    const t = $('#aw-title').value.trim();
    const m = $('#aw-medium').value.trim();
    const s = $('#aw-size').value.trim();
    const cap = $('#aw-caption');
    if (!cap.dataset.touched) {
      cap.value = [t, [m, s].filter(Boolean).join(' · ')].filter(Boolean).join('\n');
    }
  };
  $('#aw-title').addEventListener('input', syncCaption);
  $('#aw-medium').addEventListener('input', syncCaption);
  $('#aw-size').addEventListener('input', syncCaption);
  $('#aw-caption').addEventListener('input', () => { $('#aw-caption').dataset.touched = '1'; });

  $('#aw-file').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const clean = file.name.replace(/[^a-zA-Z0-9._-]+/g, '-').toLowerCase();
    const dataUrl = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(file); });
    picked = { path: `assets/images/${clean}`, base64: dataUrl.split(',')[1], contentType: file.type, dataUrl };
    $('#aw-preview').innerHTML = `<img src="${dataUrl}" alt="">`;
    $('#aw-filename').textContent = picked.path;
  });

  $('#aw-cancel').onclick = () => { root.innerHTML = ''; };
  $('#aw-x').onclick = () => { root.innerHTML = ''; };
  $('#aw-publish').onclick = () => submitAddWork(picked);
}

function submitAddWork(picked) {
  const err = $('#aw-error');
  const title = $('#aw-title').value.trim();
  if (!title) { err.textContent = 'Title is required.'; err.hidden = false; return; }
  if (!picked) { err.textContent = 'Please choose an image.'; err.hidden = false; return; }

  const works = getByPath(state.files[FILE.works], 'works');
  const existingIds = new Set(works.map(w => w.id));
  let id = slug(title);
  if (existingIds.has(id)) { let n = 2; while (existingIds.has(`${id}-${n}`)) n++; id = `${id}-${n}`; }

  const printPrice = $('#aw-printprice').value === '' ? undefined : Number($('#aw-printprice').value);
  const printStock = $('#aw-printstock').value === '' ? undefined : Number($('#aw-printstock').value);
  const printDesc = $('#aw-printdesc').value.trim() || undefined;
  const work = {
    id, title,
    date: $('#aw-date').value || undefined,
    category: $('#aw-category').value,
    image: picked.path,
    description: $('#aw-description').value.trim() || undefined,
    medium: $('#aw-medium').value.trim() || undefined,
    size: $('#aw-size').value.trim() || undefined,
    featured: $('#aw-featured').checked,
    heroFeature: $('#aw-hero').checked,
    originalStatus: $('#aw-status').value,
  };
  if (printPrice !== undefined) work.printPrice = printPrice;
  if (printStock !== undefined) work.printStock = printStock;
  if (printDesc) work.printDescription = printDesc;
  Object.keys(work).forEach(k => work[k] === undefined && delete work[k]);

  works.unshift(work);
  state.pendingImages = state.pendingImages.filter(p => p.path !== picked.path);
  state.pendingImages.push(picked);

  if ($('#aw-ig').checked) {
    state.pendingInstagram = { imagePath: picked.path, caption: $('#aw-caption').value };
  }
  recomputeDirty();

  const btn = $('#aw-publish');
  doSave(`Add work: ${title}`, btn);
}

// =================== PANEL: BLOG ===================
function renderBlog() {
  const root = $('[data-panel="blog"]');
  const posts = getByPath(state.files[FILE.blog], 'posts') || [];
  const f = FILE.blog;
  root.innerHTML = `
    <div class="section"><button class="btn primary big-add" data-action="add-blog">+ Add a blog post</button></div>
    ${posts.map((post, i) => `
      <details class="list-item">
        <summary class="list-item-header">
          <span class="summary-main">
            <span class="summary-caret">▶</span>
            ${post.images && post.images[0] ? `<img class="row-thumb" src="${escapeAttr(imgPreviewSrc(post.images[0]))}" alt="" loading="lazy">` : ''}
            <span class="list-item-title">${escapeHtml(post.title || post.id || `Post ${i + 1}`)} <span class="muted">· ${escapeHtml(post.date || '')}</span></span>
          </span>
          <span class="list-item-actions">
            <button data-action="move-blog-up" data-i="${i}">↑</button>
            <button data-action="move-blog-down" data-i="${i}">↓</button>
            <button data-action="del-blog" data-i="${i}" class="danger">Delete</button>
          </span>
        </summary>
        ${input(f, `posts.${i}.title`, 'Title (heading shown on the post)')}
        <div class="field-row">
          ${input(f, `posts.${i}.id`, 'ID (internal identifier)')}
          ${input(f, `posts.${i}.date`, 'Date', { type: 'date' })}
        </div>
        ${textarea(f, `posts.${i}.content`, 'Content', { rows: 4 })}
        <h4>Images</h4>
        ${(post.images || []).map((_, j) => `
          <div style="display:flex;gap:.5rem;align-items:flex-start">
            <div style="flex:1">${imageField(f, `posts.${i}.images.${j}`, `Image ${j + 1}`)}</div>
            <button data-action="del-blog-img" data-i="${i}" data-j="${j}" class="danger" style="margin-top:1.5rem">Remove</button>
          </div>
        `).join('')}
        <button class="add-btn" data-action="add-blog-img" data-i="${i}">+ Add image</button>
      </details>
    `).join('')}
  `;
}

// =================== PANEL: SHOP ===================
function renderShop() {
  const root = $('[data-panel="shop"]');
  const f = FILE.shop;
  const items = getByPath(state.files[f], 'items') || [];
  root.innerHTML = `
    <div class="section">
      <button class="btn primary big-add" data-action="add-shop">+ Add a shop item</button>
      <p class="tab-hint" style="margin:.7rem 0 0">Only for <strong>crafts &amp; merch</strong> — paintings &amp; prints are managed automatically from Works, not here. Publishing builds the Stripe checkout for you.</p>
    </div>
    ${items.map((it, i) => it._example ? '' : `
      <details class="list-item">
        <summary class="list-item-header">
          <span class="summary-main">
            <span class="summary-caret">▶</span>
            ${it.image ? `<img class="row-thumb" src="${escapeAttr(imgPreviewSrc(it.image))}" alt="" loading="lazy">` : ''}
            <span class="list-item-title">${escapeHtml(it.title || it.id || `Item ${i + 1}`)}</span>
          </span>
          <span class="list-item-actions">
            <button data-action="del-shop" data-i="${i}" class="danger">Delete</button>
          </span>
        </summary>
        ${imageField(f, `items.${i}.image`, 'Image')}
        <div class="field-row">
          ${input(f, `items.${i}.title`, 'Title')}
          ${input(f, `items.${i}.id`, 'ID (unique)')}
        </div>
        <div class="field-row">
          ${input(f, `items.${i}.category`, 'Category', { placeholder: 'Crafts' })}
          ${input(f, `items.${i}.price`, 'Price ($)', { type: 'number' })}
        </div>
        ${input(f, `items.${i}.description`, 'Description')}
        <div class="field-row">
          ${input(f, `items.${i}.stock`, 'Stock (0 = sold out, blank = unlimited)', { type: 'number' })}
          ${input(f, `items.${i}.order`, 'Sort order', { type: 'number' })}
        </div>
      </details>
    `).join('')}
  `;
}

// =================== PANEL: ABOUT ===================
function renderAbout() {
  const root = $('[data-panel="about"]');
  const f = FILE.about;
  const ex = getByPath(state.files[f], 'exhibitions') || [];
  root.innerHTML = `
    <div class="section">
      <h3>Bio</h3>
      ${textarea(f, 'bio', 'Bio (shown on the About page)', { rows: 7 })}
    </div>
    <div class="section">
      <h3>Exhibitions</h3>
      <div>${ex.map((x, i) => `
        <div class="list-item">
          <div class="list-item-header">
            <div class="list-item-title">${escapeHtml(x.title || `Exhibition ${i + 1}`)}</div>
            <div class="list-item-actions">
              <button data-action="move-ex-up" data-i="${i}">↑</button>
              <button data-action="move-ex-down" data-i="${i}">↓</button>
              <button data-action="del-ex" data-i="${i}" class="danger">Delete</button>
            </div>
          </div>
          ${input(f, `exhibitions.${i}.title`, 'Title')}
          ${input(f, `exhibitions.${i}.details`, 'Details (venue | date)')}
        </div>`).join('')}
      </div>
      <button class="add-btn" data-action="add-ex">+ Add exhibition</button>
    </div>
  `;
}

// =================== PANEL: SETTINGS ===================
function renderSettings() {
  const root = $('[data-panel="settings"]');
  const f = FILE.settings;
  const socials = getByPath(state.files[f], 'socialLinks') || [];
  root.innerHTML = `
    <div class="section">
      <h3>Contact</h3>
      ${input(f, 'email', 'Public email', { type: 'email' })}
    </div>
    <div class="section">
      <h3>Social links</h3>
      <div>${socials.map((s, i) => `
        <div class="list-item">
          <div class="list-item-header">
            <div class="list-item-title">${escapeHtml(s.name || 'Untitled')}</div>
            <div class="list-item-actions"><button data-action="del-social" data-i="${i}" class="danger">Delete</button></div>
          </div>
          <div class="field-row">
            ${input(f, `socialLinks.${i}.name`, 'Name')}
            ${input(f, `socialLinks.${i}.url`, 'URL', { type: 'url' })}
          </div>
        </div>`).join('')}
      </div>
      <button class="add-btn" data-action="add-social">+ Add social link</button>
    </div>
    <div class="section">
      <h3>Newsletter</h3>
      ${checkbox(f, 'newsletter.enabled', 'Enabled')}
      ${input(f, 'newsletter.heading', 'Heading')}
      ${textarea(f, 'newsletter.message', 'Message', { rows: 2 })}
      ${input(f, 'newsletter.placeholder', 'Email placeholder')}
      ${input(f, 'newsletter.buttonText', 'Button text')}
      ${input(f, 'newsletter.successMessage', 'Success message')}
      ${input(f, 'newsletter.showAfterDays', 'Show popup again after N days', { type: 'number' })}
    </div>
  `;
}

// =================== PANEL: CARD ===================
function renderCard() {
  const root = $('[data-panel="card"]');
  const f = FILE.card;
  const links = getByPath(state.files[f], 'links') || [];
  root.innerHTML = `
    <div class="section">
      <h3>Profile</h3>
      ${input(f, 'name', 'Name')}
      ${input(f, 'tagline', 'Tagline')}
      ${input(f, 'location', 'Location')}
      ${imageField(f, 'photo', 'Portrait photo')}
      ${imageField(f, 'featured', 'Banner painting')}
      ${imageField(f, 'logo', 'Logo mark')}
    </div>
    <div class="section">
      <h3>Links</h3>
      <div>${links.map((l, i) => `
        <div class="list-item">
          <div class="list-item-header">
            <div class="list-item-title">${escapeHtml(l.label || 'Untitled')}</div>
            <div class="list-item-actions">
              <button data-action="move-cardlink-up" data-i="${i}">↑</button>
              <button data-action="move-cardlink-down" data-i="${i}">↓</button>
              <button data-action="del-cardlink" data-i="${i}" class="danger">Delete</button>
            </div>
          </div>
          <div class="field-row">
            ${input(f, `links.${i}.label`, 'Label')}
            ${input(f, `links.${i}.url`, 'URL')}
          </div>
          ${checkbox(f, `links.${i}.external`, 'Opens in new tab (external)')}
        </div>`).join('')}
      </div>
      <button class="add-btn" data-action="add-cardlink">+ Add link</button>
    </div>
  `;
}

// =================== LIST ACTIONS ===================
function moveItem(arr, i, delta) {
  const j = i + delta;
  if (j < 0 || j >= arr.length) return;
  [arr[i], arr[j]] = [arr[j], arr[i]];
}

document.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  const i = btn.dataset.i !== undefined ? Number(btn.dataset.i) : null;
  const j = btn.dataset.j !== undefined ? Number(btn.dataset.j) : null;
  const works = getByPath(state.files[FILE.works], 'works');
  const blog = getByPath(state.files[FILE.blog], 'posts');
  const shopItems = getByPath(state.files[FILE.shop], 'items');
  const exhibitions = () => (state.files[FILE.about].exhibitions ||= []);
  const socials = () => (state.files[FILE.settings].socialLinks ||= []);
  const cardLinks = () => (state.files[FILE.card].links ||= []);

  const handlers = {
    'add-work': () => { showAddWorkModal(); return; },
    'del-work': () => { if (confirm('Delete this work?')) { works.splice(i, 1); rerender(); } },
    'move-work-up': () => { moveItem(works, i, -1); rerender(); },
    'move-work-down': () => { moveItem(works, i, 1); rerender(); },
    'add-detail-img': () => { (works[i].detail_images ||= []).push(''); rerender(); },
    'del-detail-img': () => { works[i].detail_images.splice(j, 1); rerender(); },

    'add-blog': () => { blog.unshift({ id: 'new-post', title: '', date: todayStr(), images: [], content: '' }); rerender(); },
    'del-blog': () => { if (confirm('Delete this post?')) { blog.splice(i, 1); rerender(); } },
    'move-blog-up': () => { moveItem(blog, i, -1); rerender(); },
    'move-blog-down': () => { moveItem(blog, i, 1); rerender(); },
    'add-blog-img': () => { (blog[i].images ||= []).push(''); rerender(); },
    'del-blog-img': () => { blog[i].images.splice(j, 1); rerender(); },

    'add-shop': () => { shopItems.push({ id: 'new-item', title: '', category: 'Crafts', price: 0, image: '', description: '', stock: 0, order: shopItems.length }); rerender(); },
    'del-shop': () => { if (confirm('Delete this item?')) { shopItems.splice(i, 1); rerender(); } },

    'add-ex': () => { exhibitions().push({ title: '', details: '' }); rerender(); },
    'del-ex': () => { state.files[FILE.about].exhibitions.splice(i, 1); rerender(); },
    'move-ex-up': () => { moveItem(state.files[FILE.about].exhibitions, i, -1); rerender(); },
    'move-ex-down': () => { moveItem(state.files[FILE.about].exhibitions, i, 1); rerender(); },

    'add-social': () => { socials().push({ name: '', url: '' }); rerender(); },
    'del-social': () => { state.files[FILE.settings].socialLinks.splice(i, 1); rerender(); },

    'add-cardlink': () => { cardLinks().push({ label: '', url: '' }); rerender(); },
    'del-cardlink': () => { state.files[FILE.card].links.splice(i, 1); rerender(); },
    'move-cardlink-up': () => { moveItem(state.files[FILE.card].links, i, -1); rerender(); },
    'move-cardlink-down': () => { moveItem(state.files[FILE.card].links, i, 1); rerender(); },
  };
  if (handlers[action]) { handlers[action](); }
});

// Remember which work rows are expanded so a re-render (add image, reorder, etc.)
// doesn't collapse the row you're editing. (toggle doesn't bubble → capture.)
document.addEventListener('toggle', (e) => {
  const d = e.target;
  if (d.tagName === 'DETAILS' && d.dataset.workId) {
    if (d.open) state.openWorks.add(d.dataset.workId);
    else state.openWorks.delete(d.dataset.workId);
  }
}, true);

function rerender() { renderActiveTab(); recomputeDirty(); }
function todayStr() { return new Date().toISOString().slice(0, 10); }

// =================== SAVE ===================
function changeSummary() {
  const lines = [];
  for (const path of state.dirty) {
    const before = state.original[path], after = state.files[path];
    if (Array.isArray(after) && Array.isArray(before)) {
      const d = after.length - before.length;
      lines.push(`${path} (${d > 0 ? '+' + d : d < 0 ? d : 'edited'})`);
    } else lines.push(path);
  }
  for (const img of state.pendingImages) lines.push(`${img.path} (${Math.round(img.base64.length * 0.75 / 1024)}KB)`);
  return lines;
}

function showSaveModal() {
  const summary = changeSummary();
  const root = $('#modal-root');
  root.innerHTML = `
    <div class="modal-backdrop"><div class="modal">
      <button class="modal-close" id="save-x" aria-label="Close">&times;</button>
      <h2>Publish changes?</h2>
      <p class="muted">Commits to the site. It’ll be live in ~1–2 minutes (images get optimized automatically).</p>
      <ul class="changes-list">${summary.map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ul>
      <div class="field"><label class="field-label">Note (commit message)</label><input type="text" id="commit-message" value="Update site via admin"></div>
      <p id="save-error" class="error-text" hidden></p>
      <div class="modal-actions">
        <button id="cancel-save">Cancel</button>
        <button id="confirm-save" class="primary">Publish</button>
      </div>
    </div></div>`;
  $('#cancel-save').onclick = () => { root.innerHTML = ''; };
  $('#save-x').onclick = () => { root.innerHTML = ''; };
  $('#confirm-save').onclick = () => doSave($('#commit-message').value.trim() || 'Update site via admin', $('#confirm-save'));
}

async function doSave(message, btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'Publishing…'; }
  const files = [...state.dirty].map(path => ({ path, content: JSON.stringify(state.files[path], null, 2) + '\n' }));
  const images = state.pendingImages.map(img => ({ path: img.path, base64: img.base64 }));
  const payload = { message, files, images, baseShas: state.baseShas };
  if (state.pendingInstagram) payload.instagram = state.pendingInstagram;

  try {
    const r = await fetch(`${state.workerUrl}/api/save`, {
      method: 'POST',
      headers: { 'X-Admin-Secret': state.secret, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await r.json();
    if (!r.ok || !data.ok) throw new Error(data.error || `Server error ${r.status}`);

    state.original = JSON.parse(JSON.stringify(state.files));
    if (data.newShas) state.baseShas = { ...state.baseShas, ...data.newShas };
    state.pendingImages = [];
    const ig = state.pendingInstagram ? data.instagram : null;
    state.pendingInstagram = null;
    recomputeDirty();
    $('#modal-root').innerHTML = '';
    renderActiveTab();

    let msg = 'Published.';
    if (ig) msg += ig.ok ? ' Posted to Instagram ✓' : ` (Instagram failed: ${ig.error})`;
    toast(`${msg} <a href="${escapeAttr(data.commitUrl)}" target="_blank" rel="noopener">View commit</a>`, ig && !ig.ok ? 'error' : '');
  } catch (err) {
    const se = $('#save-error');
    if (se) { se.textContent = `Save failed: ${err.message}`; se.hidden = false; }
    toast(`Save failed: ${err.message}`, 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'Publish'; }
  }
}

function toast(html, cls) {
  const el = document.createElement('div');
  el.className = `toast ${cls || ''}`;
  el.innerHTML = html;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 9000);
}

// =================== BOOT ===================
$('#admin-secret').value = state.secret;
$('#admin-secret').addEventListener('keydown', (e) => { if (e.key === 'Enter') connect(); });
$('#connect-btn').onclick = connect;
$('#logout-btn').onclick = disconnect;
$('#save-btn').onclick = showSaveModal;
$$('.tab').forEach(t => t.onclick = () => switchTab(t.dataset.tab));

const _cute = cuteMessage();
$$('.cute-banner').forEach(el => { el.textContent = _cute; });

if (state.secret) connect();
