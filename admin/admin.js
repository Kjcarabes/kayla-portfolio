/**
 * Kayla Carabes — admin portal
 *
 * Loads content/*.json via the Worker, presents form editors, and saves edits +
 * uploaded images back as one atomic commit. Adding a new work can also post the
 * photo to Instagram / the Facebook Page in the same action, and any already-
 * published work can be shared later from its row. No build step — plain JS.
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
  pendingSocial: null, // { imagePath, caption, targets } set by the add-work flow
  social: { instagram: false, facebook: false }, // which networks the Worker has keys for
  dirty: new Set(),
  openRows: new Set(), // which rows are expanded (survives re-render), keyed "tab:id"
  sales: null,         // { markup, priceList[], saleRecord[] } from private KV
  salesOriginal: null,
  orders: null,        // live Stripe orders + Gelato state (never stored in the repo)
  orderEdits: {},      // sessionId -> { status, tracking, notes } pending save
  orderFilter: 'all',  // which pipeline stage the Orders table is showing
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
    `you're totally the sesame ball 🍘`,
    `hey baby, nice art you got there 😘`,
    'hey love 😗'
  ];
  return msgs[Math.floor(Math.random() * msgs.length)];
}

// Inline Instagram glyph (CSP-safe — no external image), gradient-tinted.
// Stand-in preview for a video detail file (an <img> would render as a broken link).
const VIDEO_ICON = '<svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="5" width="19" height="14" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M10 9.2v5.6l4.6-2.8z" fill="currentColor"/></svg>';
const VIDEO_EXTS = /\.(mp4|mov|m4v|webm|ogv)$/i;
const isVideoPath = (p) => VIDEO_EXTS.test(String(p || ''));

const IG_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" style="vertical-align:-3px"><defs><linearGradient id="iggrad" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#feda75"/><stop offset=".45" stop-color="#d62976"/><stop offset="1" stop-color="#4f5bd5"/></linearGradient></defs><rect x="2" y="2" width="20" height="20" rx="5.5" fill="none" stroke="url(#iggrad)" stroke-width="2"/><circle cx="12" cy="12" r="4.3" fill="none" stroke="url(#iggrad)" stroke-width="2"/><circle cx="17.6" cy="6.4" r="1.4" fill="url(#iggrad)"/></svg>';
const FB_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" style="vertical-align:-3px"><circle cx="12" cy="12" r="10" fill="#1877f2"/><path d="M13.3 19.4V13h2.1l.4-2.5h-2.5V8.9c0-.7.2-1.2 1.2-1.2h1.3V5.5c-.2 0-1-.1-1.9-.1-1.9 0-3.2 1.2-3.2 3.3v1.8H8.5V13h2.2v6.4z" fill="#fff"/></svg>';

// Where a photo can be shared. `state.social` (from /api/load) says which ones
// the Worker actually has keys for — an unconfigured network stays visible but
// disabled, so a post is never offered that could only fail.
const NETWORKS = [
  { key: 'instagram', label: 'Instagram', icon: IG_ICON, jpgOnly: true },
  { key: 'facebook', label: 'Facebook page', icon: FB_ICON, jpgOnly: false },
];
const isJpg = (path, contentType) => /\.jpe?g$/i.test(String(path || '')) || contentType === 'image/jpeg';

// `chosen` is the caller's tick state, kept outside the markup so re-rendering
// (e.g. after picking a file) doesn't wipe what was already ticked.
function networkChecks(chosen, jpg) {
  return NETWORKS.map(n => {
    const off = !state.social[n.key];
    const blocked = off || (n.jpgOnly && !jpg);
    const note = off ? 'not set up yet' : (blocked ? 'JPG photos only' : '');
    return `<label class="field-checkbox${blocked ? ' is-off' : ''}">
        <input type="checkbox" data-network="${n.key}" ${blocked ? 'disabled' : (chosen[n.key] ? 'checked' : '')}>
        ${n.icon} ${escapeHtml(n.label)}${note ? ` <span class="muted">(${note})</span>` : ''}
      </label>`;
  }).join('');
}
// Only enabled+ticked boxes count, so a blocked network can't sneak into a post.
function readNetworkChecks(scope = document) {
  const targets = {};
  $$('input[data-network]', scope).forEach(el => { if (el.checked && !el.disabled) targets[el.dataset.network] = true; });
  return targets;
}
function socialSummary(posted) {
  return NETWORKS.filter(n => posted && posted[n.key])
    .map(n => posted[n.key].ok ? `${n.label} ✓` : `${n.label} failed: ${posted[n.key].error}`)
    .join(' · ');
}
const socialFailed = (posted) => Object.values(posted || {}).some(r => r && !r.ok);

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

// Small thumbnail source: use the optimized WebP variant when one exists (so the
// list doesn't download full-size originals). `widths` comes from works.json.
function thumbSrc(path, widths) {
  if (!path) return '';
  const pending = state.pendingImages.find(p => p.path === path);
  if (pending) return pending.dataUrl;
  if (Array.isArray(widths) && widths.length) {
    const w = Math.min(...widths);
    const rel = path.replace(/^assets\/images\//, '').replace(/\.[^.]+$/, '');
    return `${SITE}/assets/images/optimized/${rel}-${w}.webp`;
  }
  return `${SITE}/${path}`;
}

// =================== DIRTY TRACKING ===================
function recomputeDirty() {
  state.dirty.clear();
  for (const path of Object.keys(state.files)) {
    if (!deepEqual(state.files[path], state.original[path])) state.dirty.add(path);
  }
  updateDirtyStatus();
  scheduleDraftSave();
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
    status.innerHTML = `${escapeHtml(parts.join(' + '))} changed · <button type="button" class="linklike" data-action="discard-changes">undo all</button>`;
    status.className = 'dirty-status';
    btn.disabled = false;
  }
}

// =================== DRAFT PERSISTENCE ===================
// Unsaved edits used to vanish on a refresh. Every change is now mirrored
// (debounced) into IndexedDB — localStorage is too small for pending photo
// uploads — and brought back after the next sign-in. Publishing, or "undo all"
// in the status bar, clears the mirror.
function draftOp(mode, fn) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('kadmin', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('drafts');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const req = fn(db.transaction('drafts', mode).objectStore('drafts'));
      req.onsuccess = () => { db.close(); resolve(req.result); };
      req.onerror = () => { db.close(); reject(req.error); };
    };
  });
}

let draftTimer = null;
function scheduleDraftSave() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => persistDraft().catch(() => {}), 400);
}
async function persistDraft() {
  if (!state.dirty.size && !state.pendingImages.length && !state.pendingSocial) {
    return draftOp('readwrite', s => s.delete('draft'));
  }
  const files = {};
  for (const path of state.dirty) files[path] = JSON.parse(JSON.stringify(state.files[path]));
  return draftOp('readwrite', s => s.put({
    savedAt: Date.now(),
    files,
    pendingImages: state.pendingImages,
    pendingSocial: state.pendingSocial,
  }, 'draft'));
}
function clearDraft() {
  clearTimeout(draftTimer);
  draftTimer = null;
  draftOp('readwrite', s => s.delete('draft')).catch(() => {});
}
async function restoreDraft() {
  const draft = await draftOp('readonly', s => s.get('draft')).catch(() => null);
  if (!draft) return;
  for (const [path, content] of Object.entries(draft.files || {})) {
    if (!(path in state.files)) continue;
    state.files[path] = JSON.parse(JSON.stringify(content));
    // Heal machine-managed fields the workflows committed after the draft was taken.
    adoptMachineFields(path, state.files[path], state.original[path]);
  }
  state.pendingImages = Array.isArray(draft.pendingImages) ? draft.pendingImages : [];
  state.pendingSocial = draft.pendingSocial || null;
  recomputeDirty();
  if (state.dirty.size || state.pendingImages.length) {
    toast('Brought back your unpublished changes — hit Publish to make them live, or “undo all” (next to Publish) to drop them.');
  } else {
    clearDraft(); // everything in the draft is already live — done with it
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
    // Missing on a Worker that predates Facebook support — assume Instagram-only.
    state.social = data.social || { instagram: true, facebook: false };
    localStorage.setItem('kadmin_secret', secret);

    $('#connect-screen').hidden = true;
    $('#editor').hidden = false;
    await restoreDraft().catch(() => {});
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
  const panels = $('.panels');
  if (panels) panels.classList.toggle('wide', tab === 'sales' || tab === 'analytics' || tab === 'orders');
  renderActiveTab();
}
function renderActiveTab() {
  ({ works: renderWorks, blog: renderBlog, shop: renderShop, orders: renderOrders, about: renderAbout, newsletter: renderNewsletter, popups: renderPopups, sales: renderSales, analytics: renderAnalytics, settings: renderSettings, card: renderCard }[state.activeTab])?.();
}

// =================== FIELD HELPERS ===================
function input(file, key, label, opts = {}) {
  const v = getByPath(state.files[file], key) ?? '';
  const type = opts.type || 'text';
  // Spellcheck plain-text (prose) fields by default; off for urls/emails/numbers/dates
  // and anywhere opts.spellcheck is explicitly false (IDs/slugs).
  const spell = opts.spellcheck !== undefined ? opts.spellcheck : (type === 'text');
  return `<div class="field">
      <label class="field-label">${escapeHtml(label)}</label>
      <input type="${type}" spellcheck="${spell}" data-file="${escapeAttr(file)}" data-key="${escapeAttr(key)}" value="${escapeAttr(v)}" ${opts.placeholder ? `placeholder="${escapeAttr(opts.placeholder)}"` : ''}>
      ${opts.hint ? `<div class="field-hint">${escapeHtml(opts.hint)}</div>` : ''}
    </div>`;
}
function textarea(file, key, label, opts = {}) {
  const v = getByPath(state.files[file], key) ?? '';
  return `<div class="field">
      <label class="field-label">${escapeHtml(label)}</label>
      <textarea spellcheck="true" data-file="${escapeAttr(file)}" data-key="${escapeAttr(key)}" rows="${opts.rows || 4}">${escapeHtml(v)}</textarea>
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
      <input type="text" spellcheck="false" list="${listId}" data-file="${escapeAttr(file)}" data-key="${escapeAttr(key)}" value="${escapeAttr(v)}" ${opts.placeholder ? `placeholder="${escapeAttr(opts.placeholder)}"` : ''}>
      <datalist id="${listId}">${options.map(o => `<option value="${escapeAttr(o)}"></option>`).join('')}</datalist>
    </div>`;
}

// Date + time for a value stored as ISO-8601 *with* an offset (the countdown
// bar's end time — main.js needs the zone to count down correctly). The browser
// control carries no timezone, so what's typed is read as Kayla's local time and
// stamped with her current offset.
function localDateTimeValue(iso) {
  const d = iso ? new Date(iso) : null;
  if (!d || isNaN(d)) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function isoWithOffset(local) {
  const d = local ? new Date(local) : null;
  if (!d || isNaN(d)) return '';
  const p = (n) => String(n).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00`
    + `${sign}${p(Math.floor(Math.abs(off) / 60))}:${p(Math.abs(off) % 60)}`;
}
function datetimeField(file, key, label) {
  const iso = getByPath(state.files[file], key);
  return `<div class="field">
      <label class="field-label">${escapeHtml(label)}</label>
      <input type="datetime-local" data-dt-file="${escapeAttr(file)}" data-dt-key="${escapeAttr(key)}" value="${escapeAttr(localDateTimeValue(iso))}">
      <div class="field-hint" data-dt-note>${deadlineNote(iso)}</div>
    </div>`;
}
// Says what the chosen time actually means, because a date in the past silently
// hides the bar — the one mistake that looks like the feature is broken.
function deadlineNote(iso) {
  const t = iso ? new Date(iso).getTime() : NaN;
  if (isNaN(t)) return 'Pick the date and time it ends.';
  if (t <= Date.now()) return '<span class="field-warn">That time has already passed — the bar stays hidden.</span>';
  const hrs = (t - Date.now()) / 3600000;
  const left = hrs < 48 ? `${Math.max(1, Math.round(hrs))} hour${Math.round(hrs) === 1 ? '' : 's'}` : `${Math.round(hrs / 24)} days`;
  return `Counts down and disappears on its own — about ${left} from now.`;
}

// "Limit stock" caps how many can sell: blank = unlimited, a number = that many,
// 0 = sold out. 0 is the easy thing to type when you mean "I don't keep any on a
// shelf" (it's how the Jimothy print and the tote both ended up hidden), so it
// gets a loud inline warning instead of silently pulling the item from the shop.
const STOCK_HINT = 'Leave blank for unlimited. Only enter a number to cap the run.';
const STOCK_WARN = '0 means <strong>sold out</strong> — clear the box for unlimited.';
function stockField(file, key, label) {
  const v = getByPath(state.files[file], key);
  const zero = v !== '' && v != null && Number(v) === 0;
  return `<div class="field">
      <label class="field-label">${escapeHtml(label)}</label>
      <input type="number" min="0" step="1" placeholder="Unlimited" data-stock-warn
             data-file="${escapeAttr(file)}" data-key="${escapeAttr(key)}" value="${escapeAttr(v ?? '')}">
      <div class="field-hint">${STOCK_HINT} <span class="field-warn"${zero ? '' : ' hidden'}>${STOCK_WARN}</span></div>
    </div>`;
}

function imageField(file, key, label) {
  const path = getByPath(state.files[file], key) || '';
  const src = imgPreviewSrc(path);
  // A detail slot can hold a video (work-detail.html plays them). Browsers can't
  // render one in an <img>, so show a film glyph rather than a broken-image icon.
  const preview = !src ? 'No image'
    : isVideoPath(path) ? `<span class="video-badge" title="Video">${VIDEO_ICON}<span>Video</span></span>`
    : `<img src="${escapeAttr(src)}" alt="">`;
  return `<div class="field">
      <label class="field-label">${escapeHtml(label)}</label>
      <div class="image-picker">
        <div class="image-preview">${preview}</div>
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
  if (t.hasAttribute?.('data-stock-warn')) {
    const warn = t.parentElement?.querySelector('.field-warn');
    if (warn) warn.hidden = !(t.value !== '' && Number(t.value) === 0);
  }
  if (t.dataset.order && t.dataset.orderField) {
    const row = (state.orders || []).find(o => o.id === t.dataset.order);
    if (row) row[t.dataset.orderField] = t.value;
    const edit = (state.orderEdits[t.dataset.order] ||= { status: row?.status, tracking: row?.tracking || '', notes: row?.notes || '' });
    edit[t.dataset.orderField] = t.value;
    if (t.dataset.orderField === 'status') updateOrdersBanner();
    updateOrderButtons();
    return;
  }
  if (t.dataset.dtKey) {
    const iso = isoWithOffset(t.value);
    // Cleared box → drop the key entirely; main.js treats a missing endsAt as "no bar".
    setByPath(state.files[t.dataset.dtFile], t.dataset.dtKey, iso || undefined);
    const note = t.parentElement?.querySelector('[data-dt-note]');
    if (note) note.innerHTML = deadlineNote(iso);
    recomputeDirty();
    return;
  }
  if (t.dataset.sales && state.sales) {
    const v = t.type === 'number' ? (t.value === '' ? null : Number(t.value)) : t.value;
    setByPath(state.sales, t.dataset.sales, v);
    updateSalesComputed();
    return;
  }
  if (!t.dataset.file || !t.dataset.key) return;
  let value;
  if (t.type === 'checkbox') value = t.checked;
  else if (t.type === 'number') value = t.value === '' ? null : Number(t.value);
  else value = t.value;
  if (!state.files[t.dataset.file]) state.files[t.dataset.file] = {};
  setByPath(state.files[t.dataset.file], t.dataset.key, value);
  const toggleNote = t.type === 'checkbox' && POPUP_TOGGLE_NOTES[t.dataset.key] && $(`[data-toggle-note="${t.dataset.key}"]`);
  if (toggleNote) toggleNote.textContent = POPUP_TOGGLE_NOTES[t.dataset.key][value ? 1 : 0];
  recomputeDirty();
});

document.addEventListener('change', async (e) => {
  const t = e.target;
  if (t.classList?.contains('order-check')) { updateOrderButtons(); return; }
  // Popup promo: switching where the button points swaps which keys the row keeps,
  // so a leftover `url` can't quietly win over a newly-picked product (or vice versa).
  if (t.dataset.promoLink !== undefined) {
    const it = (getByPath(state.files[FILE.settings], 'spotlight.items') || [])[Number(t.dataset.promoLink)];
    if (it) {
      if (t.value === 'product') { delete it.url; it.workId ||= ''; }
      else { delete it.workId; delete it.category; it.url ||= ''; }
    }
    rerender();
    return;
  }
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

// The home "Selected Work" grid has its own order (`featuredOrder`), separate
// from the works list — reordering the showcase used to mean hopping a featured
// work over every non-featured one in between, and it scrambled the Work page
// order as a side effect.
function featuredSorted(works) {
  return works.filter(w => w.featured)
    .sort((a, b) => (a.featuredOrder ?? 1e9) - (b.featuredOrder ?? 1e9));
}
function moveFeatured(works, pos, delta) {
  const list = featuredSorted(works);
  const j = pos + delta;
  if (j < 0 || j >= list.length) return;
  [list[pos], list[j]] = [list[j], list[pos]];
  list.forEach((w, idx) => { w.featuredOrder = idx + 1; });
}

function renderWorks() {
  const root = $('[data-panel="works"]');
  const works = getByPath(state.files[FILE.works], 'works') || [];
  const featured = featuredSorted(works);
  root.innerHTML = `
    <div class="section">
      <button class="btn primary big-add" data-action="add-work">+ Add a new work</button>
      <p class="tab-hint" style="margin:.7rem 0 0">Click any work below to edit its details. Adding a work can also post it to Instagram and your Facebook page in the same step — and <strong>Share</strong> on any row posts an older piece whenever you like. Image sizes are generated automatically after publishing.</p>
    </div>
    ${featured.length > 1 ? `
    <div class="section">
      <h3 style="margin:0 0 .3rem">Home page showcase</h3>
      <p class="tab-hint" style="margin:0 0 .6rem">The order “Selected Work” shows in on the home page. These arrows only change the home page — the list below keeps its own order for the Work page. Tick “Featured” on a work to add it here.</p>
      ${featured.map((w, fi) => `
      <div class="feat-row">
        <span class="muted feat-num">${fi + 1}</span>
        <img class="row-thumb" src="${escapeAttr(thumbSrc(w.image, w.widths))}" alt="" loading="lazy" width="42" height="42">
        <span class="list-item-title">${escapeHtml(w.title || w.id)}</span>
        <span class="list-item-actions">
          <button data-action="move-feat-up" data-i="${fi}">↑</button>
          <button data-action="move-feat-down" data-i="${fi}">↓</button>
        </span>
      </div>`).join('')}
    </div>` : ''}
    ${works.map((w, i) => {
      const open = state.openRows.has(`works:${w.id}`);
      return `
      <details class="list-item" data-open-key="works:${escapeAttr(w.id)}" data-work-index="${i}" ${open ? 'open' : ''}>
        <summary class="list-item-header">
          <span class="summary-main">
            <span class="summary-caret">▶</span>
            <img class="row-thumb" src="${escapeAttr(thumbSrc(w.image, w.widths))}" alt="" loading="lazy" width="42" height="42">
            <span class="list-item-title">${escapeHtml(w.title || w.id || `Work ${i + 1}`)} <span class="muted">· ${escapeHtml(w.originalStatus || '')}</span></span>
          </span>
          <span class="list-item-actions">
            <button data-action="share-work" data-i="${i}" title="Post this photo to Instagram or Facebook">Share</button>
            <button data-action="move-work-up" data-i="${i}">↑</button>
            <button data-action="move-work-down" data-i="${i}">↓</button>
            <button data-action="del-work" data-i="${i}" class="danger">Delete</button>
          </span>
        </summary>
        <div class="work-fields"${open ? ' data-rendered="1"' : ''}>${open ? workFields(i) : ''}</div>
      </details>`;
    }).join('')}
  `;
}

function workFields(i) {
  const f = FILE.works;
  const p = `works.${i}`;
  return `
    ${imageField(f, `${p}.image`, 'Image')}
    <div class="field-row">
      ${input(f, `${p}.title`, 'Title')}
      ${input(f, `${p}.id`, 'ID (URL slug — keep unique)', { spellcheck: false })}
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
    <h4>Prints (optional)</h4>
    ${input(f, `${p}.printPrice`, 'Print price ($)', { type: 'number', hint: 'Selling prints of this piece? Enter a price. Leave blank if you’re not.' })}
    <div class="field-row">
      ${stockField(f, `${p}.printStock`, 'Stock')}
      ${input(f, `${p}.printDescription`, 'Print note', { placeholder: 'e.g. Giclée print' })}
    </div>
    ${gelatoFields(f, p, 'print')}
    <h4>Extra detail images (shown on this work’s own page)</h4>
    ${(getByPath(state.files[f], `${p}.detail_images`) || []).map((_, j) => `
      <div style="display:flex;gap:.5rem;align-items:flex-start">
        <div style="flex:1">${imageField(f, `${p}.detail_images.${j}`, `Detail image ${j + 1}`)}</div>
        <button data-action="del-detail-img" data-i="${i}" data-j="${j}" class="btn danger" style="margin-top:1.5rem">Remove</button>
      </div>`).join('')}
    <button class="add-btn" data-action="add-detail-img" data-i="${i}">+ Add detail image</button>
  `;
}

// Per-item print-on-demand settings. "Auto" only ever prepares a Gelato DRAFT —
// it never prints anything. Approving the draft in the Orders tab is what costs
// money, and that's always a deliberate click. Off = Kayla posts it herself and
// just gets an email with the address.
function gelatoFields(file, prefix, kind) {
  const on = !!getByPath(state.files[file], `${prefix}.gelatoAuto`);
  const fileHint = kind === 'craft'
    ? 'Required — the artwork Gelato prints onto the item (not the product photo).'
    : 'Leave blank to print the artwork photo above.';
  return `
    <h4>Print-on-demand (Gelato)</h4>
    <div class="gelato-box">
      ${checkbox(file, `${prefix}.gelatoAuto`, 'Auto-prepare a Gelato order when this sells')}
      <div class="field-hint" style="margin:.15rem 0 .7rem">
        ${on
          ? 'On: a <strong>draft</strong> is queued in your Orders tab the moment it sells. Nothing prints and nothing is charged until you press “Send to print”.'
          : 'Off: nothing is sent to Gelato. You get an email with the buyer’s address and ship it yourself.'}
      </div>
      <div class="field-row">
        ${input(file, `${prefix}.gelatoProductUid`, 'Gelato ID', {
          spellcheck: false,
          placeholder: 'Template ID or product ID',
          hint: 'Paste either — a template ID from Gelato, or a product ID. Only this one box is saved.',
        })}
        ${input(file, `${prefix}.gelatoPrintFile`, 'Print file (optional)', { spellcheck: false, hint: fileHint })}
      </div>
      <details class="calc-rates"${getByPath(state.files[file], `${prefix}.gelatoProductUid`) ? '' : ' open'}>
        <summary>Get the ID from a Gelato template</summary>
        <div class="tmpl-lookup" style="margin-top:.5rem">
          <input type="text" spellcheck="false" placeholder="Paste the template ID" data-tmpl-input="${escapeAttr(prefix)}">
          <button class="btn" data-action="lookup-template" data-prefix="${escapeAttr(prefix)}" data-file="${escapeAttr(file)}">Look up</button>
        </div>
        <div class="field-hint" data-tmpl-result="${escapeAttr(prefix)}">Pick the size you sell and it fills the box above. Nothing typed here is saved.</div>
      </details>
    </div>`;
}

// Resolve a Gelato template ID to the productUid(s) of its variants. Templates
// can't be ordered directly — the order API only takes a productUid — so this
// saves hunting for it in Gelato's dashboard.
async function lookupTemplate(file, prefix) {
  const input = $(`input[data-tmpl-input="${CSS.escape(prefix)}"]`);
  const box = $(`[data-tmpl-result="${CSS.escape(prefix)}"]`);
  const id = input?.value.trim();
  if (!id) { box.textContent = 'Paste a template ID first.'; return; }

  box.textContent = 'Looking up…';
  try {
    const r = await fetch(`${state.workerUrl}/api/gelato-template`, {
      method: 'POST',
      headers: { 'X-Admin-Secret': state.secret, 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateId: id }),
    });
    const data = await r.json();
    if (!r.ok || !data.ok) throw new Error(data.error || `Server error ${r.status}`);
    if (!data.variants?.length) { box.textContent = 'No product IDs found in that template.'; return; }

    box.innerHTML = `${data.title ? `<strong>${escapeHtml(data.title)}</strong> — ` : ''}pick the one you sell:` +
      data.variants.map(v => `<button class="btn tmpl-pick" data-action="pick-product-uid"
          data-key="${escapeAttr(`${prefix}.gelatoProductUid`)}" data-prefix="${escapeAttr(prefix)}"
          data-uid="${escapeAttr(v.productUid)}">${v.title ? `${escapeHtml(v.title)} — ` : ''}${escapeHtml(v.productUid)}</button>`).join('');
  } catch (err) {
    box.innerHTML = `<span class="error-text">${escapeHtml(err.message)}</span>`;
  }
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
        <div class="field"><label class="field-label">Title <span class="req">*</span></label><input type="text" id="aw-title" spellcheck="true"></div>
        <div class="field-row">
          <div class="field"><label class="field-label">Date</label><input type="date" id="aw-date" value="${today}"></div>
          <div class="field"><label class="field-label">Category</label>
            <select id="aw-category">${CATEGORY_OPTS.map(o => `<option value="${o.value}">${o.label}</option>`).join('')}</select>
          </div>
        </div>
        <div class="field-row">
          <div class="field"><label class="field-label">Medium</label><input type="text" id="aw-medium" placeholder="Oil on canvas" spellcheck="true"></div>
          <div class="field"><label class="field-label">Size</label><input type="text" id="aw-size" placeholder="16in x 20in"></div>
        </div>
        <div class="field"><label class="field-label">Description</label><textarea id="aw-description" rows="3" spellcheck="true"></textarea></div>
        <div class="field"><label class="field-label">Original status</label>
          <select id="aw-status">${STATUS_OPTS.map(o => `<option value="${o.value}">${o.label}</option>`).join('')}</select>
        </div>
        <h4>Prints (optional)</h4>
        <div class="field"><label class="field-label">Print price ($)</label><input type="number" id="aw-printprice">
          <div class="field-hint">Selling prints of this piece? Enter a price. Leave blank if you’re not offering prints.</div>
        </div>
        <details class="calc-rates"><summary>More print options</summary>
          <div class="field-row" style="margin-top:.6rem">
            <div class="field"><label class="field-label">Stock</label><input type="number" min="0" step="1" placeholder="Unlimited" id="aw-printstock" data-stock-warn><div class="field-hint">${STOCK_HINT} <span class="field-warn" hidden>${STOCK_WARN}</span></div></div>
            <div class="field"><label class="field-label">Print note</label><input type="text" id="aw-printdesc" placeholder="e.g. Giclée print" spellcheck="true"></div>
          </div>
        </details>
        <div style="margin-top:.6rem">
          <label class="field-checkbox"><input type="checkbox" id="aw-featured"> Featured on home</label>
          <label class="field-checkbox"><input type="checkbox" id="aw-hero"> Hero slideshow</label>
        </div>

        <h4>Share</h4>
        <div id="aw-networks"></div>
        <div class="field"><label class="field-label">Caption</label><textarea id="aw-caption" rows="3" spellcheck="true"></textarea></div>
        <div class="field-hint">Posts this photo once the work is published. Untick both to only add it to the site.</div>

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
        <div class="image-controls"><input type="file" accept="image/*" id="aw-file"><span class="image-path" id="aw-filename">JPG, PNG, etc. (JPG needed to auto-post to Instagram)</span></div>
      </div>
    </div>`;

  let picked = null; // { path, base64, contentType, dataUrl }
  const chosen = { instagram: true, facebook: true };
  // Repaint on every file pick: Instagram's JPG-only rule can only be judged
  // once there's a file, and the answer changes if she swaps the photo.
  const paintNetworks = () => {
    $('#aw-networks').innerHTML = networkChecks(chosen, picked ? isJpg(picked.path, picked.contentType) : true);
  };
  paintNetworks();
  $('#aw-networks').addEventListener('change', (e) => {
    if (e.target.dataset.network) chosen[e.target.dataset.network] = e.target.checked;
  });

  const syncCaption = () => {
    const cap = $('#aw-caption');
    if (!cap.dataset.touched) {
      cap.value = defaultCaption({ title: $('#aw-title').value.trim(), medium: $('#aw-medium').value.trim(), size: $('#aw-size').value.trim() });
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
    paintNetworks();
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

  const targets = readNetworkChecks($('#aw-networks'));
  state.pendingSocial = Object.keys(targets).length
    ? { imagePath: picked.path, caption: $('#aw-caption').value, targets }
    : null;
  recomputeDirty();

  const btn = $('#aw-publish');
  doSave(`Add work: ${title}`, btn);
}

function defaultCaption(w) {
  return [w.title, [w.medium, w.size].filter(Boolean).join(' · ')].filter(Boolean).join('\n');
}

// ---- Share modal: post a work that's already on the site ----
// Straight to Instagram / Facebook, no commit — the photo is already public, so
// the networks can fetch it as-is.
function showShareModal(i) {
  const w = (getByPath(state.files[FILE.works], 'works') || [])[i];
  if (!w) return;
  // A photo that's only in this browser session isn't on GitHub yet, so Meta
  // couldn't fetch it. Say so instead of letting the post fail obscurely.
  const unpublished = !w.image || state.pendingImages.some(p => p.path === w.image);
  const chosen = { instagram: true, facebook: true };
  const root = $('#modal-root');
  root.innerHTML = `
    <div class="modal-backdrop"><div class="modal">
      <button class="modal-close" id="sh-x" aria-label="Close">&times;</button>
      <h2>Share “${escapeHtml(w.title || w.id || 'this work')}”</h2>
      <div class="image-picker" style="margin:.5rem 0 1rem">
        <div class="image-preview">${w.image ? `<img src="${escapeAttr(thumbSrc(w.image, w.widths))}" alt="">` : 'No image'}</div>
        <div class="image-controls"><span class="image-path">${escapeHtml(w.image || '')}</span></div>
      </div>
      <div id="sh-networks">${networkChecks(chosen, isJpg(w.image))}</div>
      <div class="field" style="margin-top:.6rem"><label class="field-label">Caption</label><textarea id="sh-caption" rows="4" spellcheck="true">${escapeHtml(defaultCaption(w))}</textarea></div>
      <div class="field-hint">Posts right away — nothing is committed to the site.</div>
      ${unpublished ? '<p class="error-text">This photo isn’t published yet. Hit Publish first, then share it.</p>' : ''}
      <p id="sh-error" class="error-text" hidden></p>
      <div class="modal-actions">
        <button id="sh-cancel">Cancel</button>
        <button id="sh-post" class="primary"${unpublished ? ' disabled' : ''}>Post now</button>
      </div>
    </div></div>`;

  $('#sh-networks').addEventListener('change', (e) => {
    if (e.target.dataset.network) chosen[e.target.dataset.network] = e.target.checked;
  });
  $('#sh-cancel').onclick = () => { root.innerHTML = ''; };
  $('#sh-x').onclick = () => { root.innerHTML = ''; };
  $('#sh-post').onclick = () => shareWork(w);
}

async function shareWork(w) {
  const err = $('#sh-error');
  const btn = $('#sh-post');
  const targets = readNetworkChecks($('#sh-networks'));
  if (!Object.keys(targets).length) { err.textContent = 'Tick where you’d like it posted.'; err.hidden = false; return; }
  err.hidden = true;
  btn.disabled = true; btn.textContent = 'Posting…';
  try {
    const r = await fetch(`${state.workerUrl}/api/social-post`, {
      method: 'POST',
      headers: { 'X-Admin-Secret': state.secret, 'Content-Type': 'application/json' },
      body: JSON.stringify({ imagePath: w.image, caption: $('#sh-caption').value, targets }),
    });
    if (r.status === 404) throw new Error('Sharing needs the newer admin Worker — redeploy it (npx wrangler deploy).');
    const data = await r.json();
    if (!r.ok || !data.ok) throw new Error(data.error || `Server error ${r.status}`);
    $('#modal-root').innerHTML = '';
    toast(socialSummary(data.social) || 'Nothing was posted.', socialFailed(data.social) ? 'error' : '');
  } catch (e) {
    err.textContent = e.message; err.hidden = false;
    btn.disabled = false; btn.textContent = 'Post now';
  }
}

// =================== PANEL: BLOG ===================
function renderBlog() {
  const root = $('[data-panel="blog"]');
  const posts = getByPath(state.files[FILE.blog], 'posts') || [];
  const f = FILE.blog;
  root.innerHTML = `
    <div class="section"><button class="btn primary big-add" data-action="add-blog">+ Add a blog post</button></div>
    ${posts.map((post, i) => `
      <details class="list-item" data-open-key="blog:${escapeAttr(post.id)}" ${state.openRows.has(`blog:${post.id}`) ? 'open' : ''}>
        <summary class="list-item-header">
          <span class="summary-main">
            <span class="summary-caret">▶</span>
            ${post.images && post.images[0] ? `<img class="row-thumb" src="${escapeAttr(thumbSrc(post.images[0]))}" alt="" loading="lazy" width="42" height="42">` : ''}
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
          ${input(f, `posts.${i}.id`, 'ID (internal identifier)', { spellcheck: false })}
          ${input(f, `posts.${i}.date`, 'Date', { type: 'date' })}
        </div>
        ${textarea(f, `posts.${i}.content`, 'Content', { rows: 4 })}
        <h4>Images</h4>
        ${(post.images || []).map((_, j) => `
          <div style="display:flex;gap:.5rem;align-items:flex-start">
            <div style="flex:1">${imageField(f, `posts.${i}.images.${j}`, `Image ${j + 1}`)}</div>
            <button data-action="del-blog-img" data-i="${i}" data-j="${j}" class="btn danger" style="margin-top:1.5rem">Remove</button>
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
      <details class="list-item" data-open-key="shop:${escapeAttr(it.id)}" ${state.openRows.has(`shop:${it.id}`) ? 'open' : ''}>
        <summary class="list-item-header">
          <span class="summary-main">
            <span class="summary-caret">▶</span>
            ${it.image ? `<img class="row-thumb" src="${escapeAttr(thumbSrc(it.image))}" alt="" loading="lazy" width="42" height="42">` : ''}
            <span class="list-item-title">${escapeHtml(it.title || it.id || `Item ${i + 1}`)}</span>
          </span>
          <span class="list-item-actions">
            <button data-action="del-shop" data-i="${i}" class="danger">Delete</button>
          </span>
        </summary>
        ${imageField(f, `items.${i}.image`, 'Image')}
        <div class="field-row">
          ${input(f, `items.${i}.title`, 'Title')}
          ${input(f, `items.${i}.id`, 'ID (unique)', { spellcheck: false })}
        </div>
        <div class="field-row">
          ${input(f, `items.${i}.category`, 'Category', { placeholder: 'Crafts' })}
          ${input(f, `items.${i}.price`, 'Price ($)', { type: 'number' })}
        </div>
        ${input(f, `items.${i}.description`, 'Description')}
        <div class="field-row">
          ${stockField(f, `items.${i}.stock`, 'Stock')}
          ${input(f, `items.${i}.order`, 'Sort order', { type: 'number' })}
        </div>
        ${gelatoFields(f, `items.${i}`, 'craft')}
      </details>
    `).join('')}
  `;
}

// =================== PANEL: ORDERS ===================
// Every paid Stripe checkout, with where it is in the pipeline. Drafts are
// staged automatically but ONLY printing costs money, and only this tab can
// trigger it. Any field is hand-editable so Kayla always has the last word.

const ORDER_STATUS_OPTS = ['new', 'draft', 'printing', 'shipped', 'manual', 'cancelled'];
// Kept short on purpose: a native <select> can't wrap, so a long option just gets
// clipped. The tab hint carries the explanation instead.
const ORDER_STATUS_LABEL = {
  new: 'Not started',
  draft: 'Draft — needs OK',
  printing: 'Printing',
  shipped: 'Shipped',
  manual: 'Awaiting manual shipment',
  cancelled: 'Cancelled',
};

function renderOrders() {
  const root = $('[data-panel="orders"]');
  root.innerHTML = `
    <div class="sales-total-banner" id="orders-total-banner">💰 Total from orders: … 🤑</div>
    <div class="section">
      <h3>Orders <span class="muted" style="font-weight:400">— everything bought through the shop</span></h3>
      <p class="tab-hint" style="margin:0 0 .8rem">
        <strong>Gelato prints:</strong> Not started → <em>Prepare draft</em> → check it → <em>Send to print</em>.
        A draft costs nothing; only <em>Send to print</em> does.
        <strong>Shipping it yourself:</strong> once it's on its way, press <em>Tell buyer it shipped</em> — it asks
        for a tracking number, emails them, and marks the order shipped.
        <br>The <strong>Status</strong> column is a dropdown you can change at any time; edited rows turn yellow
        until you press <em>Save my changes</em>.
      </p>
      <p id="orders-email-warning" class="error-text" hidden>
        ⚠ Buyer emails are switched off — <code>ORDER_NOTIFY_URL</code> isn't set on the Worker,
        so nobody is being told their order is on the way. See admin-worker/README.md §5.
      </p>
      <details class="calc-rates" style="margin-bottom:.9rem">
        <summary>Send myself a test email</summary>
        <div class="orders-bar" style="margin-top:.5rem">
          <input type="email" id="test-email-to" placeholder="you@example.com" style="max-width:240px">
          <select id="test-email-kind" style="max-width:230px">
            <option value="processing">Buyer — "being made"</option>
            <option value="tracking">Buyer — "on its way" + tracking</option>
            <option value="alert-draft">Kayla — new order, draft ready</option>
            <option value="alert-manual">Kayla — new order, ship by hand</option>
          </select>
          <button class="btn" data-action="send-test-email">Send test</button>
          <span id="test-email-status" class="muted"></span>
        </div>
        <div class="field-hint">Sends the real template with made-up details. No order is touched and no customer is emailed.</div>
      </details>
      <div class="orders-filters" id="orders-filters"></div>
      <div class="orders-bar">
        <button class="btn" data-action="orders-stage" data-base="Prepare draft" disabled>Prepare draft</button>
        <button class="btn primary" data-action="orders-approve" data-base="Send to print" disabled>Send to print</button>
        <button class="btn" data-action="orders-email-tracking" data-base="Tell buyer it shipped" disabled>Tell buyer it shipped</button>
        <button class="btn danger" data-action="orders-cancel" data-base="Cancel draft" disabled>Cancel draft</button>
        <span class="topbar-spacer"></span>
        <button class="btn" data-action="refresh-orders">Refresh</button>
        <button class="btn primary" data-action="save-orders" data-base="Save my changes" disabled>Save my changes</button>
        <span id="orders-status" class="muted"></span>
      </div>
      <div id="orders-table" style="margin-top:.9rem">Loading…</div>
    </div>
  `;
  loadOrders();
}

async function loadOrders() {
  const table = $('#orders-table');
  try {
    const r = await fetch(`${state.workerUrl}/api/orders`, {
      method: 'POST', headers: { 'X-Admin-Secret': state.secret, 'Content-Type': 'application/json' }, body: '{}',
    });
    const data = await r.json();
    if (!r.ok || !data.ok) throw new Error(data.error || `Server error ${r.status}`);
    state.orders = data.orders || [];
    state.orderEdits = {};
    state.orderEmailConfigured = data.emailConfigured !== false;
    state.otherPayments = data.otherPayments || [];
    renderOrderFilters();
    renderOrdersTable();
  } catch (err) {
    if (table) table.innerHTML = `<p class="error-text">Couldn’t load orders: ${escapeHtml(err.message)}</p>`;
  }
}

function orderField(id, field, value, type = 'text') {
  return `<input class="cell-input" type="${type}" data-order="${escapeAttr(id)}" data-order-field="${escapeAttr(field)}" value="${escapeAttr(value ?? '')}" spellcheck="${type === 'text'}">`;
}

function renderOrdersTable() {
  const el = $('#orders-table');
  if (!el) return;
  const orders = visibleOrders();
  if (!orders.length) {
    el.innerHTML = `<p class="muted">${(state.orders || []).length ? 'Nothing at this stage.' : 'No orders yet.'}</p>`;
    updateOrdersBanner();
    updateOrderButtons();
    return;
  }
  el.innerHTML = `
    <div class="inq-scroll"><table class="sales-table"><thead><tr>
      <th><input type="checkbox" id="orders-check-all" title="Select all"></th>
      <th>Date</th><th>Item</th><th>Paid</th><th>Buyer</th><th>Ship to</th>
      <th>Status</th><th>Gelato</th><th>Tracking</th><th>Notes</th>
    </tr></thead><tbody>
    ${orders.map(o => {
      const blocked = (o.blockers || []).length > 0;
      const cls = [
        o.status === 'draft' ? 'order-draft' : '',
        state.orderEdits?.[o.id] ? 'order-edited' : '',
      ].filter(Boolean).join(' ');
      return `<tr class="${cls}">
        <td><input type="checkbox" class="order-check" value="${escapeAttr(o.id)}"></td>
        <td class="list-cell">${new Date(o.created * 1000).toISOString().slice(0, 10)}</td>
        <td class="list-cell" style="white-space:normal">${escapeHtml(o.itemTitle)}${o.autoConfigured ? '' : ' <span class="muted">(manual)</span>'}</td>
        <td class="list-cell">$${(o.amount || 0).toFixed(2)}</td>
        <td class="list-cell" style="white-space:normal">${escapeHtml(o.buyerName || '—')}<br><span class="muted">${escapeHtml(o.buyerEmail || '')}</span></td>
        <td style="white-space:pre-wrap" class="list-cell">${escapeHtml(o.address || '—')}</td>
        <td>
          <select class="cell-input" data-order="${escapeAttr(o.id)}" data-order-field="status">
            ${ORDER_STATUS_OPTS.map(s => `<option value="${s}" ${s === o.status ? 'selected' : ''}>${escapeHtml(ORDER_STATUS_LABEL[s])}</option>`).join('')}
          </select>
          ${blocked ? `<div class="field-warn" style="padding:0 .55rem .4rem">⚠ ${escapeHtml(o.blockers.join('; '))}</div>` : ''}
        </td>
        <td class="list-cell">${o.gelatoOrderId
          ? `${escapeHtml(o.gelatoOrderType === 'draft' ? 'draft' : (o.gelatoStatus || 'ordered'))}<br><span class="muted" style="font-size:.75rem">${escapeHtml(o.gelatoOrderId)}</span>`
          : '<span class="muted">—</span>'}</td>
        <td>${orderField(o.id, 'tracking', o.tracking)}${o.trackingEmailedAt ? `<div class="field-hint" style="padding:0 .55rem">buyer emailed ${escapeHtml(o.trackingEmailedAt.slice(0, 10))}</div>` : ''}</td>
        <td class="cell-notes"><textarea class="cell-input cell-textarea" data-order="${escapeAttr(o.id)}" data-order-field="notes" spellcheck="true">${escapeHtml(o.notes || '')}</textarea></td>
      </tr>`;
    }).join('')}
    </tbody></table></div>
  `;
  const all = $('#orders-check-all');
  if (all) all.addEventListener('change', () => {
    $$('.order-check').forEach(c => { c.checked = all.checked; });
    updateOrderButtons();
  });
  updateOrdersBanner();
  updateOrderButtons();
}

function updateOrdersBanner() {
  const el = $('#orders-total-banner');
  if (!el) return;
  const total = (state.orders || []).filter(o => o.paid && o.status !== 'cancelled').reduce((n, o) => n + (o.amount || 0), 0);
  el.textContent = `💰 Total from orders: ${money(total)} 🤑`;
}

function selectedOrderIds() {
  return $$('.order-check').filter(c => c.checked).map(c => c.value);
}

// Which actions make sense for a given row. Every button is driven off this, so
// what's clickable always matches what would actually happen — no button that
// silently no-ops, and no guessing which stage an order is at.
function orderCan(o, action) {
  switch (action) {
    // Never offer to print something already posted by hand or written off.
    // gelatoReady, not "no blockers": a hand-posted item has no Gelato product and
    // that's correct, not an error — it just can't be staged.
    case 'stage':          return !o.gelatoOrderId && o.gelatoReady && !['shipped', 'cancelled'].includes(o.status);
    case 'approve':        return !!o.gelatoOrderId && o.gelatoOrderType === 'draft';
    case 'cancel':         return !!o.gelatoOrderId && !['shipped', 'cancelled'].includes(o.status);
    case 'email-tracking': return !!o.buyerEmail && o.status !== 'cancelled';
    // "Awaiting manual shipment": nothing staged, no Gelato product configured.
    case 'manual':         return !o.gelatoOrderId && !o.autoConfigured;
    default: return false;
  }
}

const ORDER_ACTION_BTNS = ['stage', 'approve', 'email-tracking', 'cancel'];

// Enable each button only for a selection it can act on, and show how many rows
// that is — so a mixed selection says "Send to print (2)" rather than quietly
// skipping the other three.
function updateOrderButtons() {
  const ids = new Set(selectedOrderIds());
  const picked = (state.orders || []).filter(o => ids.has(o.id));
  for (const action of ORDER_ACTION_BTNS) {
    const btn = $(`[data-action="orders-${action}"]`);
    if (!btn) continue;
    const n = picked.filter(o => orderCan(o, action)).length;
    btn.disabled = n === 0;
    btn.textContent = n ? `${btn.dataset.base} (${n})` : btn.dataset.base;
  }
  const save = $('[data-action="save-orders"]');
  if (save) {
    const n = Object.keys(state.orderEdits || {}).length;
    save.disabled = n === 0;
    save.textContent = n ? `${save.dataset.base} (${n})` : save.dataset.base;
  }
}

// Stages of the pipeline, as filters. Narrowing the table to one stage is what
// makes a batch workable: pick "Not started", tick the header box, prepare every
// draft — no hunting for which rows are which.
const ORDER_FILTERS = [
  { key: 'all', label: 'All', match: () => true },
  { key: 'new', label: 'Not started', match: o => !o.gelatoOrderId && o.autoConfigured && !['shipped', 'cancelled'].includes(o.status) },
  { key: 'draft', label: 'Drafts', match: o => o.gelatoOrderType === 'draft' && o.status !== 'cancelled' },
  { key: 'printing', label: 'Printing', match: o => !!o.gelatoOrderId && o.gelatoOrderType !== 'draft' && !['shipped', 'cancelled'].includes(o.status) },
  { key: 'manual', label: 'Awaiting manual shipment', match: o => !o.gelatoOrderId && !o.autoConfigured && !['shipped', 'cancelled'].includes(o.status) },
  { key: 'shipped', label: 'Shipped', match: o => o.status === 'shipped' },
  { key: 'cancelled', label: 'Cancelled', match: o => o.status === 'cancelled' },
];

function visibleOrders() {
  const f = ORDER_FILTERS.find(x => x.key === (state.orderFilter || 'all')) || ORDER_FILTERS[0];
  return (state.orders || []).filter(f.match);
}

function renderOrderFilters() {
  const warn = $('#orders-email-warning');
  if (warn) warn.hidden = state.orderEmailConfigured !== false;
  const el = $('#orders-filters');
  if (!el) return;
  const active = state.orderFilter || 'all';
  const orders = state.orders || [];
  // Every stage is always shown, empty or not: the row of pills doubles as the map
  // of the pipeline, and one that rearranges itself as orders move is disorienting.
  el.innerHTML = ORDER_FILTERS.map(f => {
    const n = orders.filter(f.match).length;
    return `<button class="order-filter${f.key === active ? ' active' : ''}${n ? '' : ' empty'}" data-action="orders-filter" data-which="${f.key}">
        ${escapeHtml(f.label)} <span class="order-filter-count">${n}</span>
      </button>`;
  }).join('');
}

// Selections are cleared when the filter changes: acting on a row you can no
// longer see is exactly the kind of surprise this tab must not have.
function setOrderFilter(key) {
  state.orderFilter = key;
  renderOrderFilters();
  renderOrdersTable();
}


// A modal, not a status line in the corner: these actions spend money and take
// several round trips, and the old inline text left the page clickable — you could
// start a second batch on top of a running one without noticing.
function openProgressModal(title, total) {
  const root = $('#modal-root');
  root.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal progress-modal">
        <h2>${escapeHtml(title)}</h2>
        <div class="progress-track"><div class="progress-fill" id="pm-fill" style="width:0%"></div></div>
        <p class="progress-count" id="pm-count">Starting…</p>
        <div class="progress-log" id="pm-log"></div>
        <div class="modal-actions" hidden id="pm-actions">
          <button class="primary" id="pm-close">Close</button>
        </div>
      </div>
    </div>`;

  let done = 0;
  return {
    step(n, label) {
      done = n;
      const pct = total ? Math.round((done / total) * 100) : 0;
      $('#pm-fill').style.width = `${pct}%`;
      $('#pm-count').textContent = label || `${done} of ${total}`;
    },
    log(text, ok) {
      const line = document.createElement('div');
      line.className = `progress-line${ok === false ? ' bad' : ok === true ? ' good' : ''}`;
      line.textContent = `${ok === false ? '✖' : ok === true ? '✓' : '•'} ${text}`;
      const log = $('#pm-log');
      log.appendChild(line);
      log.scrollTop = log.scrollHeight;
    },
    // Only now is the modal dismissable — no accidental click-away mid-run.
    finish(summary, isError, onClose) {
      $('#pm-fill').style.width = '100%';
      if (isError) $('#pm-fill').classList.add('bad');
      $('#pm-count').textContent = summary;
      $('#pm-count').style.color = isError ? 'var(--danger)' : 'var(--ok)';
      $('#pm-actions').hidden = false;
      $('#pm-close').onclick = () => { root.innerHTML = ''; onClose?.(); };
      $('#pm-close').focus();
    },
  };
}

function setOrdersStatus(msg, color) {
  const e = $('#orders-status');
  if (e) { e.textContent = msg; e.style.color = color || ''; }
}

// The only path that can spend money. It names the pieces and the amount in the
// confirm, because "OK" on a vague prompt is how the wrong thing gets printed.
async function ordersAction(action) {
  const selected = selectedOrderIds();
  if (!selected.length) { setOrdersStatus('Tick the orders you want first.', 'var(--danger)'); return; }

  // Act only on rows this action applies to — the button's count already told her
  // how many that is, so a mixed selection does the obvious thing.
  const picked = (state.orders || []).filter(o => selected.includes(o.id) && orderCan(o, action));
  if (!picked.length) { setOrdersStatus('None of the ticked orders can do that.', 'var(--danger)'); return; }
  const ids = picked.map(o => o.id);
  let tracking = null;
  if (action === 'approve') {
    const lines = picked.map(o => `• ${o.itemTitle} → ${o.buyerName || o.buyerEmail || 'buyer'}`).join('\n');
    if (!confirm(`Send these ${ids.length} order(s) to print?\n\n${lines}\n\nThis places the real Gelato order and charges your Gelato account. It can't be undone once printing starts.`)) return;
  } else if (action === 'cancel') {
    if (!confirm(`Cancel ${ids.length} order(s) at Gelato?`)) return;
  } else if (action === 'email-tracking') {
    // One row at a time gets a tracking prompt — a hand-shipped parcel's number is
    // only known at this moment, and one number can't be right for several parcels.
    if (picked.length === 1) {
      const o = picked[0];
      const entered = prompt(
        `Tracking number for "${o.itemTitle}" → ${o.buyerName || o.buyerEmail}\n\nLeave blank to send without one.`,
        o.tracking || '');
      if (entered === null) return;
      tracking = entered.trim();
      o.tracking = tracking;
      state.orderEdits[o.id] = { status: o.status, tracking, notes: o.notes || '' };
      renderOrdersTable();
    }
    const already = picked.filter(o => o.trackingEmailedAt).length;
    const lines = picked.map(o => `• ${o.buyerEmail || o.buyerName || o.id} — tracking: ${o.tracking || '(none)'}`).join('\n');
    if (!confirm(`Email ${ids.length} buyer(s) to say their order has shipped?\n\n${lines}\n${already ? `\n${already} of these have been emailed once already.` : ''}`)) return;
  }

  const verb = { stage: 'Preparing drafts', approve: 'Sending to print', cancel: 'Cancelling', 'email-tracking': 'Emailing buyer' }[action];

  // A Cloudflare Worker gets a fixed budget of outbound requests per invocation,
  // and each order costs several. Sending in small chunks means each chunk is its
  // own invocation with a fresh budget, so a 40-order batch works the same as one.
  const CHUNK = 6;
  const results = [];
  const titleOf = Object.fromEntries(picked.map(o => [o.id, `${o.itemTitle} → ${o.buyerName || o.buyerEmail || '—'}`]));
  const pm = openProgressModal(`${verb} — ${ids.length} order${ids.length === 1 ? '' : 's'}`, ids.length);
  setOrdersStatus(`${verb}…`);

  try {
    for (let i = 0; i < ids.length; i += CHUNK) {
      const slice = ids.slice(i, i + CHUNK);
      pm.step(i, `${verb}… ${i + 1}–${Math.min(i + CHUNK, ids.length)} of ${ids.length}`);
      const r = await fetch(`${state.workerUrl}/api/orders-action`, {
        method: 'POST',
        headers: { 'X-Admin-Secret': state.secret, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, sessionIds: slice, tracking }),
      });
      const data = await r.json();
      if (!r.ok || !data.ok) throw new Error(data.error || `Server error ${r.status}`);
      for (const res of (data.results || [])) {
        pm.log(`${titleOf[res.id] || res.id} — ${res.message}`, res.ok);
      }
      results.push(...(data.results || []));
      pm.step(Math.min(i + CHUNK, ids.length));
    }
    const failed = results.filter(x => !x.ok);
    // Distinct messages only — 12 identical failures told you nothing 12 times.
    const reasons = [...new Set(failed.map(f => f.message))];
    const summary = failed.length
      ? `${results.length - failed.length} done, ${failed.length} failed`
      : `All ${results.length} done ✓`;
    pm.finish(summary, failed.length > 0, () => loadOrders());
    setOrdersStatus(failed.length ? `${summary}: ${reasons.join('; ')}` : summary, failed.length ? 'var(--danger)' : 'var(--ok)');
  } catch (err) {
    pm.log(err.message, false);
    pm.finish(`Stopped after ${results.length} of ${ids.length}`, true, () => loadOrders());
    setOrdersStatus(`Failed after ${results.length}: ${err.message}`, 'var(--danger)');
  }
}

// Shows the Apps Script's own reply on failure — "didn't return JSON" almost
// always means the `notify` branch isn't deployed, which is the usual culprit.
async function sendTestEmail() {
  const to = $('#test-email-to').value.trim();
  const kind = $('#test-email-kind').value;
  const status = $('#test-email-status');
  status.textContent = 'Sending…';
  status.style.color = '';
  try {
    const r = await fetch(`${state.workerUrl}/api/test-email`, {
      method: 'POST',
      headers: { 'X-Admin-Secret': state.secret, 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, kind }),
    });
    const data = await r.json();
    if (!r.ok || !data.ok) throw new Error(data.error || `Server error ${r.status}`);
    status.textContent = `Sent to ${data.sentTo} ✓`;
    status.style.color = 'var(--ok)';
  } catch (err) {
    status.textContent = err.message;
    status.style.color = 'var(--danger)';
  }
}

async function saveOrders() {
  const edits = state.orderEdits || {};
  if (!Object.keys(edits).length) { setOrdersStatus('Nothing changed.'); return; }
  setOrdersStatus('Saving…');
  try {
    const r = await fetch(`${state.workerUrl}/api/orders-save`, {
      method: 'POST',
      headers: { 'X-Admin-Secret': state.secret, 'Content-Type': 'application/json' },
      body: JSON.stringify({ edits }),
    });
    const data = await r.json();
    if (!r.ok || !data.ok) throw new Error(data.error || `Server error ${r.status}`);
    state.orderEdits = {};
    setOrdersStatus('Saved ✓', 'var(--ok)');
  } catch (err) {
    setOrdersStatus(`Failed: ${err.message}`, 'var(--danger)');
  }
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
  `;
}

// =================== PANEL: NEWSLETTER ===================
function renderNewsletter() {
  const root = $('[data-panel="newsletter"]');
  const f = FILE.settings;
  root.innerHTML = `
    <div class="section">
      <h3>Send a newsletter</h3>
      <p class="tab-hint" style="margin:0 0 .8rem">Emails everyone who has signed up. Sends from your Gmail; every message includes an unsubscribe link.</p>
      <div class="field"><label class="field-label">Subject</label><input type="text" id="nl-subject" spellcheck="true"></div>
      <div class="field"><label class="field-label">Message</label><textarea id="nl-body" rows="8" spellcheck="true" placeholder="Write your update…"></textarea></div>
      <button class="btn primary" data-action="send-newsletter" id="nl-send">Send to subscribers</button>
      <span id="nl-status" class="muted" style="margin-left:.7rem"></span>
    </div>
    <div class="section">
      <h3>Recipients <span id="nl-count" class="muted"></span></h3>
      <p class="tab-hint" style="margin:0 0 .6rem">Everyone currently subscribed — this is exactly who the message goes to.</p>
      <div id="nl-recipients" class="nl-recipients muted">Loading subscribers…</div>
      <button class="btn" data-action="refresh-subscribers" style="margin-top:.6rem">Refresh</button>
    </div>
    <div class="section">
      <h3>Signup popup</h3>
      <p class="tab-hint" style="margin:0 0 .8rem">The popup that invites visitors to join the mailing list.</p>
      ${checkbox(f, 'newsletter.enabled', 'Enabled')}
      ${input(f, 'newsletter.heading', 'Heading')}
      ${textarea(f, 'newsletter.message', 'Message', { rows: 2 })}
      ${input(f, 'newsletter.placeholder', 'Email placeholder')}
      ${input(f, 'newsletter.buttonText', 'Button text')}
      ${input(f, 'newsletter.successMessage', 'Success message')}
      ${input(f, 'newsletter.showAfterDays', 'Show popup again after N days', { type: 'number' })}
    </div>
  `;
  loadSubscribers();
}

// Pull the current subscriber list (via Worker → Apps Script) so Kayla sees who
// a newsletter will reach before sending.
async function loadSubscribers() {
  const box = $('#nl-recipients');
  const countEl = $('#nl-count');
  if (!box) return;
  box.textContent = 'Loading subscribers…';
  box.style.color = '';
  try {
    const r = await fetch(`${state.workerUrl}/api/subscribers`, {
      method: 'POST',
      headers: { 'X-Admin-Secret': state.secret, 'Content-Type': 'application/json' },
      body: '{}',
    });
    const data = await r.json();
    if (!r.ok || !data.ok) throw new Error(data.error || `Server error ${r.status}`);
    const emails = data.emails || [];
    if (countEl) countEl.textContent = `(${emails.length})`;
    box.style.color = '';
    box.innerHTML = emails.length
      ? emails.map(e => `<div class="nl-recipient">${escapeHtml(e)}</div>`).join('')
      : '<span class="muted">No subscribers yet.</span>';
  } catch (err) {
    box.textContent = `Couldn’t load subscribers: ${err.message}`;
    box.style.color = 'var(--danger)';
  }
}

// =================== PANEL: POPUPS ===================
// Home-page announcements: the full-screen popup (site-settings `spotlight`) and
// the countdown bar (`auctionBanner`). Switching either off leaves its wording,
// picture and rows in the JSON, so the next announcement starts from the last one
// instead of being rebuilt — that's the whole point of the on/off switch.

const PROMO_CATEGORY_OPTS = [
  { value: '', label: 'Whatever’s for sale' },
  { value: 'Prints', label: 'The print' },
  { value: 'Crafts', label: 'The craft / merch' },
];

// What each switch means, in plain words, updated the instant it's ticked — an
// on/off box whose caption still describes the old state reads as a broken save.
const POPUP_TOGGLE_NOTES = {
  'spotlight.enabled': [
    'Off — nothing pops up. Everything below is kept, so you can switch it back on whenever.',
    'On — visitors see it on their first look at the home page.',
  ],
  'auctionBanner.enabled': [
    'Off — hidden everywhere. The wording is kept for next time.',
    'On — it shows on every page until the end time below.',
  ],
};
function popupToggle(file, key, label, on) {
  return `${checkbox(file, key, label)}
    <div class="field-hint" data-toggle-note="${escapeAttr(key)}" style="margin:.3rem 0 1.1rem">${POPUP_TOGGLE_NOTES[key][on ? 1 : 0]}</div>`;
}

function renderPopups() {
  const root = $('[data-panel="popups"]');
  const f = FILE.settings;
  const sp = getByPath(state.files[f], 'spotlight') || {};
  const items = sp.items || [];
  const banner = getByPath(state.files[f], 'auctionBanner') || {};
  const works = getByPath(state.files[FILE.works], 'works') || [];

  root.innerHTML = `
    <div class="section">
      <h3>Announcement popup <span class="muted" style="font-weight:400">— home page</span></h3>
      <p class="tab-hint">Fades in over the home page a moment after it loads, and only once per visit. Each row below is one thing you’re announcing — a print, a tote, a show, an auction.</p>
      ${popupToggle(f, 'spotlight.enabled', 'Show this popup on the home page', sp.enabled)}
      ${input(f, 'spotlight.heading', 'Heading', { placeholder: 'Jimothy Takes Seattle' })}
      ${input(f, 'spotlight.subheading', 'Line under the heading')}
      ${imageField(f, 'spotlight.image', 'Main picture')}
      <h4>What you’re announcing</h4>
      ${items.length ? items.map((it, i) => promoRow(f, it, i, works)).join('')
        : '<p class="muted" style="margin:.2rem 0 .8rem">Nothing yet — add a row below.</p>'}
      <button class="add-btn" data-action="add-promo">+ Add something to announce</button>
    </div>

    <div class="section">
      <h3>Countdown bar <span class="muted" style="font-weight:400">— slim strip at the top of every page</span></h3>
      <p class="tab-hint">For something with a deadline, like an auction closing. It counts down and takes itself away the moment the time passes.</p>
      ${popupToggle(f, 'auctionBanner.enabled', 'Show the bar', banner.enabled)}
      ${input(f, 'auctionBanner.text', 'Text', { placeholder: 'Jimothy original — live auction' })}
      <div class="field-row">
        ${input(f, 'auctionBanner.cta', 'Button text', { placeholder: 'Bid now' })}
        ${input(f, 'auctionBanner.url', 'Links to', { spellcheck: false, placeholder: 'https://…' })}
      </div>
      ${datetimeField(f, 'auctionBanner.endsAt', 'Ends at (your time)')}
    </div>

    <div class="section">
      <h3>Mailing-list signup popup</h3>
      <p class="tab-hint" style="margin:0">That one lives in the <strong>Newsletter</strong> tab, next to the subscriber list. It never shows at the same time as the announcement popup above.</p>
    </div>
  `;
}

function promoRow(f, it, i, works) {
  const p = `spotlight.items.${i}`;
  const toProduct = !!it.workId;
  const workOpts = [{ value: '', label: '— Pick a work —' }, ...works.map(w => ({ value: w.id, label: w.title || w.id }))];
  // A workId that no longer matches a work would otherwise vanish behind the first
  // option while the JSON still held it — show it, flagged.
  if (it.workId && !works.some(w => w.id === it.workId)) workOpts.push({ value: it.workId, label: `${it.workId} (no longer exists)` });
  return `
    <details class="list-item" data-open-key="promo:${i}" ${state.openRows.has(`promo:${i}`) ? 'open' : ''}>
      <summary class="list-item-header">
        <span class="summary-main">
          <span class="summary-caret">▶</span>
          <span class="list-item-title">${escapeHtml(it.title || `Row ${i + 1}`)}${it.tag ? ` <span class="muted">· ${escapeHtml(it.tag)}</span>` : ''}</span>
        </span>
        <span class="list-item-actions">
          <button data-action="move-promo-up" data-i="${i}">↑</button>
          <button data-action="move-promo-down" data-i="${i}">↓</button>
          <button data-action="del-promo" data-i="${i}" class="danger">Delete</button>
        </span>
      </summary>
      <div class="field-row">
        ${input(f, `${p}.title`, 'Title')}
        ${input(f, `${p}.tag`, 'Little label', { placeholder: 'Print' })}
      </div>
      ${input(f, `${p}.description`, 'Line under the title')}
      <div class="field-row">
        ${input(f, `${p}.cta`, 'Button text', { placeholder: 'Buy print — $20' })}
        <div class="field">
          <label class="field-label">Button goes to</label>
          <select data-promo-link="${i}">
            <option value="product" ${toProduct ? 'selected' : ''}>Something in the shop</option>
            <option value="url" ${toProduct ? '' : 'selected'}>A web address</option>
          </select>
        </div>
      </div>
      ${toProduct ? `
        <div class="field-row">
          ${select(f, `${p}.workId`, 'Which work', workOpts)}
          ${select(f, `${p}.category`, 'Which version', PROMO_CATEGORY_OPTS)}
        </div>
        <div class="field-hint">Points at that item’s live checkout, so the link can’t go stale when prices change.</div>`
      : input(f, `${p}.url`, 'Web address', { spellcheck: false, placeholder: 'https://…' })}
    </details>`;
}

// =================== PANEL: INQUIRIES ===================
const money = (n) => '$' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const salesInput = (key, val, type = 'text') => `<input class="cell-input" type="${type}" data-sales="${escapeAttr(key)}" value="${escapeAttr(val ?? '')}" spellcheck="${type === 'text' ? 'true' : 'false'}">`;
const salesSelect = (key, val, opts) => `<select class="cell-input" data-sales="${escapeAttr(key)}">${opts.map(o => `<option ${o === val ? 'selected' : ''}>${o}</option>`).join('')}</select>`;
const salesTextarea = (key, val) => `<textarea class="cell-input cell-textarea" data-sales="${escapeAttr(key)}" spellcheck="true">${escapeHtml(val ?? '')}</textarea>`;

function renderSales() {
  const root = $('[data-panel="sales"]');
  root.innerHTML = `
    <div class="sales-total-banner" id="sales-total-banner">💰 Total made: … 🤑</div>
    <div class="section">
      <h3>Leads <span class="muted">— inquiries on originals</span></h3>
      <p class="tab-hint" style="margin:0 0 .6rem">New inquiry emails are added to your mailing list automatically (ones already on the list, including anyone who unsubscribed, are left alone).</p>
      <div id="inq-note" class="muted" style="margin-bottom:.7rem"></div>
      <div id="inq-table">Loading…</div>
      <button class="btn" data-action="refresh-inquiries" style="margin-top:.7rem">Refresh</button>
    </div>

    <div class="section">
      <h3>Fair-price calculator</h3>
      <p class="tab-hint" style="margin:0 0 .8rem">Suggests a target price = (size × base rate) + (hours × hourly rate) + materials. That's the Target Price; your markup below sets the List Price.</p>
      <div class="calc-grid">
        <div class="field"><label class="field-label">Width (in)</label><input type="number" id="calc-w"></div>
        <div class="field"><label class="field-label">Height (in)</label><input type="number" id="calc-h"></div>
        <div class="field"><label class="field-label">Hours spent</label><input type="number" id="calc-hours"></div>
        <div class="field"><label class="field-label">Material cost ($)</label><input type="number" id="calc-material"></div>
      </div>
      <details class="calc-rates">
        <summary>Rates &amp; material assumptions</summary>
        <div class="calc-grid" style="margin-top:.7rem">
          <div class="field"><label class="field-label">Base value ($/in²)</label><input type="number" id="calc-base" step="0.01"></div>
          <div class="field"><label class="field-label">Hourly rate ($/hr)</label><input type="number" id="calc-hourly"></div>
          <div class="field"><label class="field-label">Material est. ($/in²)</label><input type="number" id="calc-matrate" step="0.01"></div>
        </div>
        <p class="field-hint">Material cost is prefilled from size × the material rate. That ~$0.20/in² estimate assumes: canvas ~$0.08, stretcher bars ~$0.04, oil paint ~$0.06, gesso/medium ~$0.02 per in². Edit the rate or the dollar amount if you know the real cost.</p>
      </details>
      <div class="calc-result">
        <div>Suggested target price: <strong id="calc-target">—</strong></div>
        <div class="muted" id="calc-persqin"></div>
      </div>
    </div>

    <div class="section" id="price-section"><h3>Price list</h3><div class="muted">Loading…</div></div>
    <div class="section" id="sale-section"><h3>Sale record</h3><div class="muted">Loading…</div></div>
    <div class="section" id="other-pay-section" hidden></div>
  `;
  loadInquiries();
  wireCalculator();
  loadSales();
  loadOtherPayments();
}

// Commissions and one-off invoices: Stripe payments that aren't shop items. They
// have nothing to fulfil, so they're kept out of Orders — but they're still money
// earned, so they're offered here for the sale record.
async function loadOtherPayments() {
  if (state.otherPayments) { renderOtherPayments(); return; }
  try {
    const r = await fetch(`${state.workerUrl}/api/orders`, {
      method: 'POST', headers: { 'X-Admin-Secret': state.secret, 'Content-Type': 'application/json' }, body: '{}',
    });
    const data = await r.json();
    if (!r.ok || !data.ok) return; // Stripe not configured — just don't show the section
    state.otherPayments = data.otherPayments || [];
    renderOtherPayments();
  } catch { /* optional section; stay quiet */ }
}

function renderOtherPayments() {
  const sec = $('#other-pay-section');
  if (!sec || !state.sales) return;
  const imported = new Set(state.sales.importedPayments || []);
  const pending = (state.otherPayments || []).filter(p => !imported.has(p.id));
  sec.hidden = pending.length === 0;
  if (!pending.length) return;

  sec.innerHTML = `
    <h3>Commissions &amp; other payments <span class="muted" style="font-weight:400">— not shop items</span></h3>
    <p class="tab-hint" style="margin:0 0 .7rem">Payment links you made yourself. They're not in Orders because there's
      nothing to print or post automatically. Add them here to keep your sale record complete — each one only appears once.</p>
    <div class="inq-scroll"><table class="sales-table"><thead><tr>
      <th>Date</th><th>What</th><th>Amount</th><th>Buyer</th><th></th>
    </tr></thead><tbody>
    ${pending.map(p => `<tr>
      <td class="list-cell">${new Date(p.created * 1000).toISOString().slice(0, 10)}</td>
      <td class="list-cell" style="white-space:normal">${escapeHtml(p.description || 'Payment')}</td>
      <td class="list-cell">${money(p.amount)}</td>
      <td class="list-cell" style="white-space:normal">${escapeHtml(p.buyerName || '—')}<br><span class="muted">${escapeHtml(p.buyerEmail || '')}</span></td>
      <td><button class="btn" data-action="import-payment" data-pid="${escapeAttr(p.id)}">Add to sale record</button></td>
    </tr>`).join('')}
    </tbody></table></div>
  `;
}

function importPayment(id) {
  const p = (state.otherPayments || []).find(x => x.id === id);
  if (!p || !state.sales) return;
  state.sales.saleRecord.push({
    work: p.description || 'Commission',
    year: new Date(p.created * 1000).getFullYear(),
    size: '',
    sell: p.amount,
    sellDate: new Date(p.created * 1000).toISOString().slice(0, 10),
    buyerName: p.buyerName || '',
    buyerPhone: '',
    buyerEmail: p.buyerEmail || '',
    buyerNotes: p.address ? `Stripe payment\n${p.address}` : 'Stripe payment',
  });
  // Remember it so the same payment can't be added twice on a later visit.
  (state.sales.importedPayments ||= []).push(p.id);
  renderSaleTable();
  renderOtherPayments();
  saveSales();
}

function wireCalculator() {
  const g = id => document.getElementById(id);
  let rates;
  try { rates = JSON.parse(localStorage.getItem('kadmin_calc_rates')); } catch { rates = null; }
  rates = rates || { base: 0.50, hourly: 35, matrate: 0.20 };
  g('calc-base').value = rates.base;
  g('calc-hourly').value = rates.hourly;
  g('calc-matrate').value = rates.matrate;
  let materialTouched = false;
  const recompute = () => {
    const sqin = (Number(g('calc-w').value) || 0) * (Number(g('calc-h').value) || 0);
    const base = Number(g('calc-base').value) || 0, hourly = Number(g('calc-hourly').value) || 0, matrate = Number(g('calc-matrate').value) || 0;
    if (!materialTouched) g('calc-material').value = sqin ? round2(sqin * matrate) : '';
    const material = Number(g('calc-material').value) || 0;
    const hours = Number(g('calc-hours').value) || 0;
    const target = sqin * base + hours * hourly + material;
    g('calc-target').textContent = money(target);
    g('calc-persqin').textContent = sqin ? `${money(target / sqin)} / in²  ·  ${sqin.toLocaleString()} in²` : '';
    localStorage.setItem('kadmin_calc_rates', JSON.stringify({ base, hourly, matrate }));
  };
  ['calc-w', 'calc-h', 'calc-hours', 'calc-base', 'calc-hourly', 'calc-matrate'].forEach(id => g(id).addEventListener('input', recompute));
  g('calc-material').addEventListener('input', () => { materialTouched = true; recompute(); });
  recompute();
}

async function loadSales() {
  try {
    const r = await fetch(`${state.workerUrl}/api/sales`, {
      method: 'POST', headers: { 'X-Admin-Secret': state.secret, 'Content-Type': 'application/json' }, body: '{}',
    });
    const data = await r.json();
    if (!r.ok || !data.ok) throw new Error(data.error || `Server error ${r.status}`);
    state.sales = data.data || { markup: 135, priceList: [], saleRecord: [] };
    if (typeof state.sales.markup !== 'number') state.sales.markup = 135;
    if (!Array.isArray(state.sales.priceList)) state.sales.priceList = [];
    if (!Array.isArray(state.sales.saleRecord)) state.sales.saleRecord = [];
    if (!Array.isArray(state.sales.importedPayments)) state.sales.importedPayments = [];
    state.salesOriginal = JSON.parse(JSON.stringify(state.sales));
    renderPriceTable();
    renderSaleTable();
    renderOtherPayments();
    updateTotalBanner();
  } catch (err) {
    const p = $('#price-section');
    if (p) p.innerHTML = `<h3>Price list</h3><p class="error-text">Couldn’t load sales data: ${escapeHtml(err.message)}</p>`;
  }
}

function renderPriceTable() {
  const sec = $('#price-section');
  if (!sec || !state.sales) return;
  const s = state.sales;
  const markup = Number(s.markup) || 0;
  sec.innerHTML = `
    <h3>Price list</h3>
    <div class="field" style="max-width:240px"><label class="field-label">Markup % (List = Target × this)</label><input type="number" data-sales="markup" value="${escapeAttr(s.markup)}"></div>
    <div class="inq-scroll"><table class="sales-table"><thead><tr>
      <th>Work</th><th>Year</th><th>Size (in²)</th><th>Target</th><th>List</th><th>Floor</th><th>Status</th><th>Sell</th><th>Notes</th><th></th>
    </tr></thead><tbody>
    ${s.priceList.map((r, i) => `<tr>
      <td>${salesInput(`priceList.${i}.work`, r.work)}</td>
      <td>${salesInput(`priceList.${i}.year`, r.year, 'number')}</td>
      <td>${salesInput(`priceList.${i}.size`, r.size)}</td>
      <td>${salesInput(`priceList.${i}.target`, r.target, 'number')}</td>
      <td class="list-cell" data-list="${i}">${money(round2(r.target * markup / 100))}</td>
      <td>${salesInput(`priceList.${i}.floor`, r.floor, 'number')}</td>
      <td>${salesSelect(`priceList.${i}.status`, r.status || 'Available', ['Available', 'Sold', 'NFS'])}</td>
      <td>${salesInput(`priceList.${i}.sell`, r.sell, 'number')}</td>
      <td class="cell-notes">${salesTextarea(`priceList.${i}.notes`, r.notes)}</td>
      <td><button data-action="del-price" data-i="${i}" class="danger">✕</button></td>
    </tr>`).join('')}
    </tbody></table></div>
    <button class="add-btn" data-action="add-price">+ Add work</button>
    <div class="sales-save-bar"><button class="btn primary" data-action="save-sales" id="sales-save">Save sales data</button> <span id="sales-status" class="muted"></span></div>
  `;
}

function renderSaleTable() {
  const sec = $('#sale-section');
  if (!sec || !state.sales) return;
  const s = state.sales;
  const total = s.saleRecord.reduce((a, r) => a + (Number(r.sell) || 0), 0);
  sec.innerHTML = `
    <h3>Sale record <span class="muted" style="font-weight:400">— Total sold: <strong id="sale-total">${money(total)}</strong></span></h3>
    <div class="inq-scroll"><table class="sales-table"><thead><tr>
      <th>Work</th><th>Year</th><th>Size</th><th>Sell</th><th>Sell date</th><th>Buyer name</th><th>Phone</th><th>Email</th><th>Notes</th><th></th>
    </tr></thead><tbody>
    ${s.saleRecord.map((r, i) => `<tr>
      <td>${salesInput(`saleRecord.${i}.work`, r.work)}</td>
      <td>${salesInput(`saleRecord.${i}.year`, r.year, 'number')}</td>
      <td>${salesInput(`saleRecord.${i}.size`, r.size)}</td>
      <td>${salesInput(`saleRecord.${i}.sell`, r.sell, 'number')}</td>
      <td>${salesInput(`saleRecord.${i}.sellDate`, r.sellDate, 'date')}</td>
      <td>${salesInput(`saleRecord.${i}.buyerName`, r.buyerName)}</td>
      <td>${salesInput(`saleRecord.${i}.buyerPhone`, r.buyerPhone)}</td>
      <td>${salesInput(`saleRecord.${i}.buyerEmail`, r.buyerEmail, 'email')}</td>
      <td class="cell-notes">${salesTextarea(`saleRecord.${i}.buyerNotes`, r.buyerNotes)}</td>
      <td><button data-action="del-sale" data-i="${i}" class="danger">✕</button></td>
    </tr>`).join('')}
    </tbody></table></div>
    <button class="add-btn" data-action="add-sale">+ Add sale</button>
    <div class="sales-save-bar"><button class="btn primary" data-action="save-sales" id="sales-save2">Save sales data</button> <span id="sales-status2" class="muted"></span></div>
  `;
  updateTotalBanner();
}

// Recompute List Price cells + Total sold in place (no re-render → no focus loss).
function updateSalesComputed() {
  const s = state.sales;
  if (!s) return;
  const markup = Number(s.markup) || 0;
  document.querySelectorAll('#price-section .list-cell').forEach(cell => {
    const t = Number(s.priceList[Number(cell.dataset.list)]?.target) || 0;
    cell.textContent = money(round2(t * markup / 100));
  });
  const totalEl = document.getElementById('sale-total');
  if (totalEl) totalEl.textContent = money(s.saleRecord.reduce((a, r) => a + (Number(r.sell) || 0), 0));
  updateTotalBanner();
}

function updateTotalBanner() {
  const el = document.getElementById('sales-total-banner');
  if (!el || !state.sales) return;
  const total = (state.sales.saleRecord || []).reduce((a, r) => a + (Number(r.sell) || 0), 0);
  el.textContent = `💰 Total made: ${money(total)} 🤑`;
}

async function saveSales() {
  const setStatus = (msg, color) => ['sales-status', 'sales-status2'].forEach(id => { const e = document.getElementById(id); if (e) { e.textContent = msg; e.style.color = color || ''; } });
  ['sales-save', 'sales-save2'].forEach(id => { const b = document.getElementById(id); if (b) { b.disabled = true; b.textContent = 'Saving…'; } });
  try {
    const r = await fetch(`${state.workerUrl}/api/sales-save`, {
      method: 'POST', headers: { 'X-Admin-Secret': state.secret, 'Content-Type': 'application/json' }, body: JSON.stringify({ data: state.sales }),
    });
    const data = await r.json();
    if (!r.ok || !data.ok) throw new Error(data.error || `Server error ${r.status}`);
    state.salesOriginal = JSON.parse(JSON.stringify(state.sales));
    setStatus('Saved ✓', 'var(--ok)');
  } catch (err) {
    setStatus(`Failed: ${err.message}`, 'var(--danger)');
  } finally {
    ['sales-save', 'sales-save2'].forEach(id => { const b = document.getElementById(id); if (b) { b.disabled = false; b.textContent = 'Save sales data'; } });
  }
}

function renderInquiries() { renderSales(); } // legacy alias

// =================== PANEL: ANALYTICS ===================
function renderAnalytics() {
  const root = $('[data-panel="analytics"]');
  root.innerHTML = `
    <div class="section">
      <h3>Site analytics <span class="muted" id="an-range" style="font-weight:400;font-size:.85rem"></span></h3>
      <p class="tab-hint" style="margin:0 0 .8rem">Live from Cloudflare Web Analytics — the last 30 days on kaylacarabes.com.</p>
      <div id="an-body">Loading…</div>
      <button class="btn" data-action="refresh-analytics" style="margin-top:.8rem">Refresh</button>
    </div>
  `;
  loadAnalytics();
}

async function loadAnalytics() {
  const body = $('#an-body');
  const rangeEl = $('#an-range');
  if (!body) return;
  body.textContent = 'Loading…';
  body.style.color = '';
  try {
    const r = await fetch(`${state.workerUrl}/api/analytics`, {
      method: 'POST', headers: { 'X-Admin-Secret': state.secret, 'Content-Type': 'application/json' }, body: '{}',
    });
    const data = await r.json();
    if (!r.ok || !data.ok) throw new Error(data.error || `Server error ${r.status}`);
    if (rangeEl) rangeEl.textContent = `${data.range.from} → ${data.range.to}`;
    const maxDay = Math.max(1, ...(data.byDay || []).map(d => d.pageviews));
    const list = (rows, empty) => rows.length ? rows : null;
    body.innerHTML = `
      <div class="stat-row">
        <div class="stat"><div class="stat-num">${(data.pageviews || 0).toLocaleString()}</div><div class="stat-label">Pageviews</div></div>
        <div class="stat"><div class="stat-num">${(data.visits || 0).toLocaleString()}</div><div class="stat-label">Visits</div></div>
      </div>
      <h4>Pageviews by day</h4>
      <div class="an-bars">${(data.byDay || []).map(d => `<div class="an-bar" title="${d.date}: ${d.pageviews} views"><span style="height:${Math.round(d.pageviews / maxDay * 100)}%"></span></div>`).join('') || '<span class="muted">No data yet.</span>'}</div>
      <h4>Top pages</h4>
      <div class="an-list">${list(data.topPages || [])
        ? data.topPages.map(p => `<div class="an-list-row"><span>${escapeHtml(p.path || '/')}</span><b>${p.pageviews.toLocaleString()}</b></div>`).join('')
        : '<span class="muted">No data yet.</span>'}</div>
      <h4>Top referrers</h4>
      <div class="an-list">${(data.topReferers || []).filter(x => x.host).length
        ? data.topReferers.filter(x => x.host).map(p => `<div class="an-list-row"><span>${escapeHtml(p.host)}</span><b>${p.pageviews.toLocaleString()}</b></div>`).join('')
        : '<span class="muted">Mostly direct traffic.</span>'}</div>
    `;
  } catch (err) {
    body.innerHTML = `<p class="error-text">Couldn’t load analytics: ${escapeHtml(err.message)}</p>`;
  }
}

async function loadInquiries() {
  const table = $('#inq-table');
  const note = $('#inq-note');
  if (!table) return;
  table.textContent = 'Loading…';
  table.style.color = '';
  try {
    const r = await fetch(`${state.workerUrl}/api/inquiries`, {
      method: 'POST',
      headers: { 'X-Admin-Secret': state.secret, 'Content-Type': 'application/json' },
      body: '{}',
    });
    const data = await r.json();
    if (!r.ok || !data.ok) throw new Error(data.error || `Server error ${r.status}`);
    const rows = data.rows || [];
    if (note) note.textContent = data.added
      ? `Added ${data.added} new email${data.added === 1 ? '' : 's'} to the mailing list.`
      : 'No new emails to add.';
    if (rows.length < 2) { table.innerHTML = '<span class="muted">No inquiries yet.</span>'; return; }
    const header = rows[0];
    const body = rows.slice(1);
    table.innerHTML = `<div class="inq-scroll"><table class="inq-table">
      <thead><tr>${header.map(h => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead>
      <tbody>${body.map(row => `<tr>${header.map((_, c) => `<td>${escapeHtml(row[c] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody>
    </table></div>`;
  } catch (err) {
    table.textContent = `Couldn’t load inquiries: ${err.message}`;
    table.style.color = 'var(--danger)';
  }
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
            ${input(f, `links.${i}.url`, 'URL', { spellcheck: false })}
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
  const promos = () => ((state.files[FILE.settings].spotlight ||= {}).items ||= []);

  const handlers = {
    'discard-changes': () => {
      if (!confirm('Throw away all unpublished changes and go back to what’s live?')) return;
      state.files = JSON.parse(JSON.stringify(state.original));
      state.pendingImages = [];
      state.pendingSocial = null;
      clearDraft();
      rerender();
    },

    'add-work': () => { showAddWorkModal(); return; },
    // preventDefault: the button lives inside <summary>, and expanding the row
    // behind the modal is just noise.
    'share-work': () => { e.preventDefault(); showShareModal(i); },
    'del-work': () => { if (confirm('Delete this work?')) { works.splice(i, 1); rerender(); } },
    'move-work-up': () => { moveItem(works, i, -1); rerender(); },
    'move-work-down': () => { moveItem(works, i, 1); rerender(); },
    'move-feat-up': () => { moveFeatured(works, i, -1); rerender(); },
    'move-feat-down': () => { moveFeatured(works, i, 1); rerender(); },
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

    'add-promo': () => { promos().push({ title: '', tag: '', description: '', url: '', cta: 'Have a look' }); state.openRows.add(`promo:${promos().length - 1}`); rerender(); },
    'del-promo': () => { if (confirm('Delete this row from the popup?')) { promos().splice(i, 1); rerender(); } },
    'move-promo-up': () => { moveItem(promos(), i, -1); rerender(); },
    'move-promo-down': () => { moveItem(promos(), i, 1); rerender(); },

    'add-social': () => { socials().push({ name: '', url: '' }); rerender(); },
    'del-social': () => { state.files[FILE.settings].socialLinks.splice(i, 1); rerender(); },

    'lookup-template': () => lookupTemplate(btn.dataset.file, btn.dataset.prefix),
    'pick-product-uid': () => {
      const target = $(`input[data-key="${btn.dataset.key}"]`);
      if (target) { target.value = btn.dataset.uid; target.dispatchEvent(new Event('input', { bubbles: true })); }
      const box = $(`[data-tmpl-result="${CSS.escape(btn.dataset.prefix)}"]`);
      if (box) box.innerHTML = `<span style="color:var(--ok)">✓ Set to ${escapeHtml(btn.dataset.uid)}</span>`;
    },

    'refresh-orders': () => loadOrders(),
    'orders-stage': () => ordersAction('stage'),
    'orders-approve': () => ordersAction('approve'),
    'orders-cancel': () => ordersAction('cancel'),
    'orders-email-tracking': () => ordersAction('email-tracking'),
    'orders-filter': () => setOrderFilter(btn.dataset.which),
    'send-test-email': () => sendTestEmail(),
    'save-orders': () => saveOrders(),

    'send-newsletter': () => sendNewsletter(),
    'refresh-subscribers': () => loadSubscribers(),
    'refresh-inquiries': () => loadInquiries(),

    'add-price': () => { state.sales.priceList.push({ work: '', year: '', size: '', target: null, floor: null, status: 'Available', sell: null, notes: '' }); renderPriceTable(); },
    'del-price': () => { if (confirm('Delete this row?')) { state.sales.priceList.splice(i, 1); renderPriceTable(); } },
    'add-sale': () => { state.sales.saleRecord.push({ work: '', year: '', size: '', sell: null, sellDate: '', buyerName: '', buyerPhone: '', buyerEmail: '', buyerNotes: '' }); renderSaleTable(); },
    'del-sale': () => { if (confirm('Delete this sale?')) { state.sales.saleRecord.splice(i, 1); renderSaleTable(); } },
    'save-sales': () => saveSales(),
    'import-payment': () => importPayment(btn.dataset.pid),
    'refresh-analytics': () => loadAnalytics(),

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
  if (d.tagName !== 'DETAILS' || !d.dataset.openKey) return;
  if (d.open) state.openRows.add(d.dataset.openKey);
  else state.openRows.delete(d.dataset.openKey);
  // Lazy-render a work's edit fields the first time it's expanded (keeps the
  // Works list light — 36 collapsed rows instead of 36 full forms).
  if (d.open && d.dataset.workIndex !== undefined) {
    const box = d.querySelector('.work-fields');
    if (box && !box.dataset.rendered) {
      box.innerHTML = workFields(Number(d.dataset.workIndex));
      box.dataset.rendered = '1';
    }
  }
}, true);

function rerender() { renderActiveTab(); recomputeDirty(); }

// Compose + send a newsletter to all subscribers (via the Worker → Apps Script).
// This is a direct action — it does NOT go through the save/commit flow.
async function sendNewsletter() {
  const subject = $('#nl-subject').value.trim();
  const body = $('#nl-body').value.trim();
  const status = $('#nl-status');
  if (!subject || !body) { status.textContent = 'Add a subject and message first.'; status.style.color = 'var(--danger)'; return; }
  if (!confirm('Send this to ALL newsletter subscribers? This cannot be undone.')) return;

  const btn = $('#nl-send');
  btn.disabled = true; btn.textContent = 'Sending…';
  status.textContent = ''; status.style.color = '';
  try {
    const r = await fetch(`${state.workerUrl}/api/newsletter`, {
      method: 'POST',
      headers: { 'X-Admin-Secret': state.secret, 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject, body }),
    });
    const data = await r.json();
    if (!r.ok || !data.ok) throw new Error(data.error || `Server error ${r.status}`);
    status.textContent = `Sent to ${data.sent} subscriber${data.sent === 1 ? '' : 's'} ✓`;
    status.style.color = 'var(--ok)';
    $('#nl-subject').value = ''; $('#nl-body').value = '';
  } catch (err) {
    status.textContent = `Failed: ${err.message}`;
    status.style.color = 'var(--danger)';
  } finally {
    btn.disabled = false; btn.textContent = 'Send to subscribers';
  }
}
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

// ── Publish-time rebase ──────────────────────────────────────────────────────
// After every publish the optimize-images Action commits aspectRatio/widths back
// into works.json, so the blob SHA the admin loaded goes stale and a second
// publish used to demand a full page reload. Before saving we re-fetch the repo:
// files with no local edits silently adopt the latest copy, and an edited
// works.json absorbs the machine-managed fields when that's ALL that changed
// upstream. A real human/code edit underneath local changes keeps the stale SHA
// so the Worker still refuses instead of clobbering it.
const MACHINE_WORK_FIELDS = ['aspectRatio', 'widths'];

function stripMachineFields(path, doc) {
  if (path !== FILE.works || !doc) return doc;
  const clone = JSON.parse(JSON.stringify(doc));
  for (const w of clone.works || []) for (const k of MACHINE_WORK_FIELDS) delete w[k];
  return clone;
}
function adoptMachineFields(path, mine, theirs) {
  if (path !== FILE.works || !mine || !theirs) return;
  const latest = new Map((theirs.works || []).map(w => [w.id, w]));
  for (const w of mine.works || []) {
    const t = latest.get(w.id);
    if (!t) continue;
    for (const k of MACHINE_WORK_FIELDS) {
      if (t[k] !== undefined) w[k] = JSON.parse(JSON.stringify(t[k]));
    }
  }
}
async function rebaseOnLatest() {
  const r = await fetch(`${state.workerUrl}/api/load`, {
    method: 'POST',
    headers: { 'X-Admin-Secret': state.secret, 'Content-Type': 'application/json' },
  });
  if (!r.ok) return; // couldn't refresh — the save's own conflict check still guards
  const data = await r.json();
  for (const path of Object.keys(data.shas || {})) {
    if ((data.shas[path] ?? null) === (state.baseShas[path] ?? null)) continue;
    const fresh = data.files[path];
    if (!state.dirty.has(path)) {
      state.files[path] = JSON.parse(JSON.stringify(fresh));
    } else if (deepEqual(stripMachineFields(path, fresh), stripMachineFields(path, state.original[path]))) {
      adoptMachineFields(path, state.files[path], fresh);
    } else {
      continue; // upstream has real edits under hers — leave the SHA stale, Worker refuses
    }
    state.original[path] = JSON.parse(JSON.stringify(fresh));
    state.baseShas[path] = data.shas[path];
  }
  recomputeDirty();
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

  const buildPayload = () => {
    const files = [...state.dirty].map(path => ({ path, content: JSON.stringify(state.files[path], null, 2) + '\n' }));
    const images = state.pendingImages.map(img => ({ path: img.path, base64: img.base64 }));
    const payload = { message, files, images, baseShas: state.baseShas };
    if (state.pendingSocial) payload.social = state.pendingSocial;
    return payload;
  };
  const postSave = async () => {
    const r = await fetch(`${state.workerUrl}/api/save`, {
      method: 'POST',
      headers: { 'X-Admin-Secret': state.secret, 'Content-Type': 'application/json' },
      body: JSON.stringify(buildPayload()),
    });
    const data = await r.json();
    data._status = r.status;
    return data;
  };

  try {
    // Sync up with anything the GitHub Actions committed since (image sizes,
    // product sync) so publishing twice in a row just works.
    await rebaseOnLatest().catch(() => {});

    if (!state.dirty.size && !state.pendingImages.length) {
      // The refresh can reveal these changes are already live (e.g. published
      // from another tab) — nothing left to commit.
      $('#modal-root').innerHTML = '';
      renderActiveTab();
      toast('Already up to date — nothing left to publish.');
      return;
    }

    let data = await postSave();
    if (data.conflict) {
      // A workflow commit can still land in the moment between refresh and save —
      // sync once more and retry before bothering anyone.
      await rebaseOnLatest().catch(() => {});
      data = await postSave();
    }
    if (!data.ok) throw new Error(data.error || `Server error ${data._status}`);

    state.original = JSON.parse(JSON.stringify(state.files));
    if (data.newShas) state.baseShas = { ...state.baseShas, ...data.newShas };
    state.pendingImages = [];
    const wanted = state.pendingSocial;
    state.pendingSocial = null;
    clearDraft();
    recomputeDirty();
    $('#modal-root').innerHTML = '';
    renderActiveTab();

    let msg = 'Published.';
    let failed = false;
    if (wanted) {
      // A Worker deployed before this feature ignores `social` silently — the
      // commit still landed, so say what didn't happen rather than claiming it did.
      const posted = data.social || (data.instagram ? { instagram: data.instagram } : null);
      if (!posted) { msg += ' (Nothing was posted — redeploy the admin Worker.)'; failed = true; }
      else { msg += ` ${socialSummary(posted)}`; failed = socialFailed(posted); }
    }
    toast(`${msg} <a href="${escapeAttr(data.commitUrl)}" target="_blank" rel="noopener">View commit</a>`, failed ? 'error' : '');
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
