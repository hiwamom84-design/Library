const BOOK_TYPE_LABELS = {
  roman: '📖 ڕۆمان',
  chirok: '📘 چیرۆک',
  shi3r: '🪶 شیعر',
  wta: '💬 وتە و پەند',
  zanist: '🔬 زانست و مێژوو',
  ayini: '🕌 ئایینی',
  mindal: '🧸 منداڵان',
  other: '✨ گشتی'
};
function formatBookType(code) { return BOOK_TYPE_LABELS[code] || BOOK_TYPE_LABELS.other; }

/**
 * Community Library Management System - Frontend Controller
 * Direct PostgreSQL persistence, camera & gallery photo support, permanent deletion, and role management.
 */

const state = {
  currentView: 'home',
  user: window.api ? window.api.user : null,
  books: [],
  categories: [],
  selectedCategory: '',
  searchQuery: '',
  onlyAvailable: false,
  myActiveLoans: [],
  myPastLoans: [],
  adminStats: null,
  adminTab: 'books',
  adminMembers: [],
  adminAllLoans: [],
  selectedBook: null
};

let selectedBookPhotoBase64 = null;

document.addEventListener('DOMContentLoaded', () => {
  window.i18n.initLanguage();

  try {
    const savedTheme = localStorage.getItem('family_lib_theme_v2') || 'blue';
    const savedFont = localStorage.getItem('family_lib_font') || 'pencil';
    document.documentElement.setAttribute('data-theme', savedTheme);
    document.documentElement.setAttribute('data-font', savedFont);
  } catch (e) {}

  initAuthListener();
  initEventListeners();
  loadInitialData();
  loadPublicMembersDropdown();
});

function initAuthListener() {
  window.addEventListener('auth-changed', (e) => {
    state.user = e.detail.user;
    updateUserNavUI();
    if (state.currentView === 'catalog') {
      loadCatalog();
    } else if (state.currentView === 'inventory') {
      loadMyInventory();
    } else if (state.currentView === 'admin' && (!state.user || state.user.role !== 'admin')) {
      switchView('catalog');
    }
  });

  if (window.api && window.api.token) {
    window.api.getMe()
      .then(user => {
        state.user = user;
        updateUserNavUI();
      })
      .catch(() => {
        state.user = null;
        updateUserNavUI();
      });
  } else {
    updateUserNavUI();
  }
}

function initEventListeners() {
  document.getElementById('nav-home-btn')?.addEventListener('click', () => switchView('home'));
  document.getElementById('nav-books-btn')?.addEventListener('click', () => switchView('catalog'));
  init3DBook();
  document.getElementById('nav-races-btn')?.addEventListener('click', () => {
    if (!state.user) {
      openModal('signin-modal');
      return;
    }
    switchView('races');
  });
  document.getElementById('nav-inventory-btn')?.addEventListener('click', () => {
    if (!state.user) {
      openModal('signin-modal');
      return;
    }
    switchView('inventory');
  });
  document.getElementById('nav-rules-btn')?.addEventListener('click', () => switchView('rules'));
  document.getElementById('nav-admin-btn')?.addEventListener('click', () => {
    if (!state.user || state.user.role !== 'admin') {
      showToast('تەنها بەڕێوەبەر دەتوانێت بچێتە ئەم بەشە', 'error');
      openModal('signin-modal');
      return;
    }
    switchView('admin');
  });

  document.getElementById('brand-link')?.addEventListener('click', () => switchView('home'));

  document.getElementById('btn-open-settings')?.addEventListener('click', () => { if (!requireLogin('تکایە سەرەتا بچۆ ژوورەوە')) return; openModal('modal-settings'); });
  document.getElementById('btn-set-lang-ckb')?.addEventListener('click', () => { window.i18n.setLanguage('ckb'); renderApp(); });
  document.getElementById('btn-set-lang-en')?.addEventListener('click', () => { window.i18n.setLanguage('en'); renderApp(); });
  document.querySelectorAll('.theme-option-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const theme = btn.getAttribute('data-set-theme');
      document.documentElement.setAttribute('data-theme', theme);
      localStorage.setItem('family_lib_theme_v2', theme);
      showToast('ڕەنگی ماڵپەڕ گۆڕدرا 🎨', 'success');
    });
  });
  document.querySelectorAll('.font-option-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const fnt = btn.getAttribute('data-set-font');
      document.documentElement.setAttribute('data-font', fnt);
      localStorage.setItem('library_font', fnt);
      showToast('شێوازی فۆنت گۆڕدرا ✍️', 'success');
    });
  });
  const savedFont = localStorage.getItem('library_font') || 'pencil';
  document.documentElement.setAttribute('data-font', savedFont);
  const savedTheme = localStorage.getItem('family_lib_theme_v2') || 'blue';
  document.documentElement.setAttribute('data-theme', savedTheme);

  document.getElementById('signin-btn')?.addEventListener('click', () => openModal('signin-modal'));
  document.getElementById('signout-btn')?.addEventListener('click', () => {
    window.api.logout();
    showToast('بە سەرکەوتوویی دەرچوویت', 'info');
  });

  const searchInput = document.getElementById('catalog-search-input');
  if (searchInput) {
    let debounceTimer;
    searchInput.addEventListener('input', (e) => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        state.searchQuery = e.target.value;
        loadCatalog();
      }, 300);
    });
  }

  document.querySelectorAll('.book-type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.book-type-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.bookType = btn.getAttribute('data-book-type') || 'all';
      loadCatalog();
    });
  });

  document.getElementById('filter-available-toggle')?.addEventListener('change', (e) => {
    if (!state.user) { e.target.checked = false; requireLogin('تکایە سەرەتا بچۆ ژوورەوە'); return; }
    state.onlyAvailable = e.target.checked;
    loadCatalog();
  });

  document.getElementById('catalog-sort-select')?.addEventListener('change', (e) => { state.sortBy = e.target.value; loadCatalog(); });

  document.getElementById('filter-favorites-toggle')?.addEventListener('change', (e) => {
    if (!state.user) { e.target.checked = false; requireLogin('تکایە سەرەتا بچۆ ژوورەوە'); return; }
    state.favoritesOnly = e.target.checked;
    loadCatalog();
  });

  document.getElementById('suggest-book-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const title = document.getElementById('suggest-book-title')?.value.trim();
    const notes = document.getElementById('suggest-book-notes')?.value.trim() || '';
    if (!title) return;
    const list = JSON.parse(localStorage.getItem('family_lib_suggestions') || '[]');
    list.unshift({ id: Date.now(), title, notes, by: state.user?.fullName || 'ئەندام' });
    localStorage.setItem('family_lib_suggestions', JSON.stringify(list));
    renderAdminSuggestions();
    closeModal('suggest-book-modal');
    document.getElementById('suggest-book-form').reset();
    showToast('پێشنیازەکەت بە سەرکەوتوویی نێردرا بۆ بەڕێوەبەر ✅', 'success');
  });

  document.getElementById('announcement-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const msg = document.getElementById('announcement-input')?.value.trim() || '';
    if (msg) localStorage.setItem('family_lib_announcement', msg);
    else localStorage.removeItem('family_lib_announcement');
    renderAnnouncementBanner();
    closeModal('announcement-modal');
    showToast(msg ? 'ئاگاداری بڵاوکرایەوە 📢' : 'ئاگاداری سڕایەوە', 'success');
  });
  renderAnnouncementBanner();
  renderAdminSuggestions();

  document.getElementById('signin-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = document.getElementById('signin-password').value;
    const submitBtn = document.getElementById('signin-submit-btn');
    let loginPayload;
    if (currentSigninMode === 'request') {
      const fullName = document.getElementById('req-member-name')?.value.trim();
      const gradeLevel = document.getElementById('req-member-grade')?.value || 1;
      if (!fullName) { showToast('تکایە ناوی تەواوت بنووسە', 'error'); return; }
      try {
        submitBtn.disabled = true;
        const r = await window.api.requestMembership({ fullName, gradeLevel, password });
        closeModal('signin-modal');
        document.getElementById('signin-form').reset();
        window.setSigninMode('member');
        showToast(r.message || 'داواکاری نێردرا ✅', 'success');
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'چوونە ژوورەوە';
      }
      return;
    } else if (currentSigninMode === 'member') {
      const userId = document.getElementById('signin-member-select')?.value;
      if (!userId) { showToast('تکایە ناوی خۆت هەڵبژێرە', 'error'); return; }
      loginPayload = { userId: parseInt(userId, 10), password };
    } else {
      const adminName = document.getElementById('signin-email').value.trim();
      if (!adminName) { showToast('تکایە ناوی خۆت بنووسە', 'error'); return; }
      loginPayload = { adminName, password };
    }

    try {
      submitBtn.disabled = true;
      submitBtn.textContent = 'چاوەڕوانبە...';
      await window.api.login(loginPayload);
      closeModal('signin-modal');
      showToast('بە سەرکەوتوویی چوویتە ژوورەوە', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'چوونە ژوورەوە';
    }
  });

  // Camera & Gallery File Pickers
  const cameraInput = document.getElementById('input-camera-file');
  const galleryInput = document.getElementById('input-gallery-file');

  document.getElementById('btn-trigger-camera')?.addEventListener('click', () => {
    cameraInput?.click();
  });
  document.getElementById('btn-trigger-gallery')?.addEventListener('click', () => {
    galleryInput?.click();
  });

  cameraInput?.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) handleImageFile(e.target.files[0]);
  });
  galleryInput?.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) handleImageFile(e.target.files[0]);
  });

  document.getElementById('btn-remove-photo')?.addEventListener('click', () => {
    selectedBookPhotoBase64 = null;
    if (cameraInput) cameraInput.value = '';
    if (galleryInput) galleryInput.value = '';
    const box = document.getElementById('photo-preview-box');
    if (box) box.style.display = 'none';
    const thumb = document.getElementById('img-preview-thumb');
    if (thumb) thumb.src = '';
    showToast('وێنەکە لادرا', 'info');
  });

  document.querySelectorAll('.modal-close-trigger').forEach(btn => {
    btn.addEventListener('click', () => {
      const modal = btn.closest('.modal-overlay');
      if (modal) modal.classList.remove('active');
    });
  });

  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.classList.remove('active');
    });
  });
}

function handleImageFile(file) {
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    showToast('تکایە تەنها وێنە هەڵبژێرە', 'error');
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    const rawUrl = e.target.result;
    const img = new Image();
    img.onload = () => {
      try {
        const maxDim = 800;
        let w = img.width, h = img.height;
        if (w > maxDim || h > maxDim) {
          if (w > h) { h = Math.round((h * maxDim) / w); w = maxDim; }
          else { w = Math.round((w * maxDim) / h); h = maxDim; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        selectedBookPhotoBase64 = canvas.toDataURL('image/jpeg', 0.82);
      } catch (_) {
        selectedBookPhotoBase64 = rawUrl;
      }
      const box = document.getElementById('photo-preview-box');
      const thumb = document.getElementById('img-preview-thumb');
      if (thumb) thumb.src = selectedBookPhotoBase64;
      if (box) box.style.display = 'flex';
      showToast('وێنەکە بە سەرکەوتوویی ئامادەکرا ✓', 'success');
    };
    img.onerror = () => {
      selectedBookPhotoBase64 = rawUrl;
      const box = document.getElementById('photo-preview-box');
      const thumb = document.getElementById('img-preview-thumb');
      if (thumb) thumb.src = selectedBookPhotoBase64;
      if (box) box.style.display = 'flex';
      showToast('وێنەکە بە سەرکەوتوویی ئامادەکرا ✓', 'success');
    };
    img.src = rawUrl;
  };
  reader.readAsDataURL(file);
}

async function loadInitialData() {
  try {
    const catsRes = await window.api.getCategories();
    state.categories = catsRes.categories || [];
    renderCategoryFilterTabs();
    loadCatalog();
  } catch (err) {
    console.error('Failed to load categories:', err);
  }
}

function requireLogin(msg) {
  if (state.user) return true;
  if (msg) showToast(msg, 'info');
  openModal('signin-modal');
  return false;
}

function switchView(view) {
  state.currentView = view;
  document.querySelectorAll('.nav-item-btn').forEach(btn => btn.classList.remove('active'));
  if (view === 'home') document.getElementById('nav-home-btn')?.classList.add('active');
  if (view === 'catalog') document.getElementById('nav-books-btn')?.classList.add('active');
  if (view === 'inventory') document.getElementById('nav-inventory-btn')?.classList.add('active');
  if (view === 'races') document.getElementById('nav-races-btn')?.classList.add('active');
  if (view === 'rules') document.getElementById('nav-rules-btn')?.classList.add('active');
  if (view === 'admin') document.getElementById('nav-admin-btn')?.classList.add('active');

  document.querySelectorAll('.view-section').forEach(sec => sec.style.display = 'none');
  const targetSec = document.getElementById(`view-${view}`);
  if (targetSec) targetSec.style.display = 'block';

  if (view === 'catalog') loadCatalog();
  if (view === 'inventory') loadMyInventory();
  if (view === 'races') loadRacesView();
  if (view === 'admin') loadAdminDashboard();
}

function updateUserNavUI() {
  const userMenu = document.getElementById('header-user-menu');
  const signInBtn = document.getElementById('signin-btn');
  const adminNav = document.getElementById('nav-admin-btn');
  const inventoryNav = document.getElementById('nav-inventory-btn');
  const racesNav = document.getElementById('nav-races-btn');
  const favWrap = document.getElementById('filter-favorites-wrap');
  const quotaBanner = document.getElementById('weekly-quota-banner');

  if (state.user) {
    if (signInBtn) signInBtn.style.display = 'none';
    if (userMenu) userMenu.style.display = 'flex';
    if (inventoryNav) inventoryNav.style.display = 'flex';

    document.getElementById('user-badge-name').textContent = state.user.fullName;
    document.getElementById('user-badge-grade').textContent = state.user.gradeLabel.ckb;

    const avatarEl = document.getElementById('user-badge-avatar');
    if (avatarEl) {
      if (state.user.photoUrl) {
        avatarEl.innerHTML = `<img src="${escapeHtml(state.user.photoUrl)}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`;
      } else {
        avatarEl.textContent = state.user.fullName.charAt(0);
      }
    }

    if (adminNav) {
      adminNav.style.display = state.user.role === 'admin' ? 'flex' : 'none';
    }
  } else {
    if (signInBtn) signInBtn.style.display = 'inline-flex';
    if (userMenu) userMenu.style.display = 'none';
    if (adminNav) adminNav.style.display = 'none';
    const mAdmin = document.getElementById('m-nav-admin'); if (mAdmin) mAdmin.style.display = 'none';
    const mInv = document.getElementById('m-nav-inventory'); if (mInv) mInv.style.display = 'none';
    const mRaces = document.getElementById('m-nav-races'); if (mRaces) mRaces.style.display = 'none';
    if (inventoryNav) inventoryNav.style.display = 'none';
    if (racesNav) racesNav.style.display = 'none';
    if (favWrap) favWrap.style.display = 'none';
    if (quotaBanner) quotaBanner.style.display = 'none';
  }
}

function renderCategoryFilterTabs() {
  const container = document.getElementById('category-filter-tabs');
  if (!container) return;

  const isEn = window.i18n.getCurrentLanguage() === 'en';
  let html = `
    <button class="category-tab-btn btn-all-primary ${state.selectedCategory === '' ? 'active' : ''}" data-cat="">
      ${isEn ? 'All Categories' : 'هەموو پۆلەکان'}
    </button>
  `;

  state.categories.forEach(cat => {
    const name = isEn ? cat.name_en : cat.name_ckb;
    const isActive = state.selectedCategory === cat.code ? 'active' : '';
    html += `
      <button class="category-tab-btn ${isActive}" data-cat="${escapeHtml(cat.code)}">
        ${escapeHtml(name)}
      </button>
    `;
  });

  container.innerHTML = html;

  container.querySelectorAll('.category-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.selectedCategory = btn.getAttribute('data-cat');
      container.querySelectorAll('.category-tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      loadCatalog();
    });
  });
}

async function loadCatalog() {
  const grid = document.getElementById('books-catalog-grid');
  const countEl = document.getElementById('catalog-results-count');
  if (!grid) return;

  grid.innerHTML = `<div class="empty-state" style="grid-column: 1/-1;"><p>تکایە چاوەڕوانبە...</p></div>`;

  try {
    const res = await window.api.getBooks({
      q: state.searchQuery,
      category: state.selectedCategory,
      book_type: state.bookType || 'all',
      available_only: state.onlyAvailable,
      favorites_only: state.favoritesOnly
    });

    let fetchedBooks = res.books || [];
    if (state.sortBy === 'popular') fetchedBooks.sort((a, b) => (b.total_loans_count || 0) - (a.total_loans_count || 0));
    else if (state.sortBy === 'rating') fetchedBooks.sort((a, b) => (b.avg_rating || 0) - (a.avg_rating || 0));
    state.books = fetchedBooks;

    if (countEl) {
      countEl.textContent = `${state.books.length} کتێب لە بنکەدراوەیە`;
    }

    if (state.books.length === 0) {
      grid.innerHTML = `
        <div class="empty-state" style="grid-column: 1/-1;">
          <div class="empty-state-icon">📚</div>
          <h4>کتێبخانەکە لە ئێستادا بەتاڵە</h4>
          <p>هیچ کتێبێکی خەیاڵی لێرە نییە. دەتوانیت وەک بەڕێوەبەر بە کامێرا یان لە گەلەری وێنە بگریت و کتێبی ڕاستەقینە زیاد بکەیت!</p>
        </div>
      `;
      return;
    }

    renderBookCards(grid, state.books);
  } catch (err) {
    grid.innerHTML = `<div class="empty-state" style="grid-column: 1/-1;"><p style="color:var(--danger-red)">${err.message}</p></div>`;
  }
}

function renderBookCards(container, books) {
  const isEn = window.i18n.getCurrentLanguage() === 'en';

  container.innerHTML = books.map(book => {
    const categoryName = isEn ? book.category_name_en : book.category_name_ckb;
    const catBadgeClass = `cat-badge-${book.category_code}`;
    const hasAvailable = book.available_copies > 0;
    const availText = hasAvailable
      ? `✓ ${book.available_copies} بەردەستە`
      : (book.active_borrower_name ? `🔒 خوازراوە لەلایەن: ${escapeHtml(book.active_borrower_name)}` : `✕ خوازراوە`);
    const availClass = hasAvailable ? 'avail-green' : 'avail-red';

    let permBannerHtml = '';
    let borrowBtnHtml = '';

    if (!state.user) {
      permBannerHtml = `<div class="permission-banner restricted">🔒 میوان: بۆ خواستن سەرەتا بچۆ ژوورەوە</div>`;
      borrowBtnHtml = `<button class="btn btn-navy btn-sm" onclick="openModal('signin-modal')">چوونەژوورەوە بۆ خواستن</button>`;
    } else if (book.userHasActiveLoan) {
      permBannerHtml = `<div class="permission-banner in-hand">📖 لە لای خۆتە بۆ خوێندنەوە</div>`;
      borrowBtnHtml = `<button class="btn btn-disabled btn-sm">خوازراوە</button>`;
    } else if (book.canBorrow) {
      permBannerHtml = `<div class="permission-banner allowed">✓ گونجاوە بۆ پۆلەکەت</div>`;
      borrowBtnHtml = `<button class="btn btn-primary btn-sm" onclick="handleBorrowBook(${book.id}, '${escapeHtml(book.title)}')">خواستنی ئەم کتێبە</button>`;
    } else if (!hasAvailable) {
      const who = book.active_borrower_name ? ` (${escapeHtml(book.active_borrower_name)})` : '';
      permBannerHtml = `<div class="permission-banner restricted">🔒 خوازراوە لەلایەن${who ? ': ' + escapeHtml(book.active_borrower_name) : ' ئەندامێکی تر'}</div>`;
      borrowBtnHtml = `<button class="btn btn-disabled btn-sm">خوازراوە</button>`;
    } else {
      permBannerHtml = `<div class="permission-banner restricted">⚠️ ${book.permissionReasonCkb}</div>`;
      borrowBtnHtml = `<button class="btn btn-disabled btn-sm">ڕێگری پۆل</button>`;
    }

    let coverHtml = '';
    if (book.cover_url) {
      coverHtml = `<img src="${escapeHtml(book.cover_url)}" alt="${escapeHtml(book.title)}" class="book-cover-img" onerror="this.parentElement.innerHTML='<div class=\\'book-cover-placeholder\\'><div class=\\'placeholder-icon\\'>📖</div><div class=\\'placeholder-title\\'>${escapeHtml(book.title)}</div><div class=\\'placeholder-author\\'>${escapeHtml(book.author)}</div></div>'">`;
    } else {
      coverHtml = `
        <div class="book-cover-placeholder">
          <div class="placeholder-icon">📖</div>
          <div class="placeholder-title">${escapeHtml(book.title)}</div>
          <div class="placeholder-author">${escapeHtml(book.author)}</div>
        </div>
      `;
    }

    return `
      <div class="book-card">
        <div class="book-cover-container">
          ${coverHtml}
        </div>
        <div class="book-card-body">
          <div style="display:flex; gap:0.35rem; flex-wrap:wrap; margin-bottom:0.35rem;">
            <span class="book-category-tag ${catBadgeClass}">
              ${escapeHtml(categoryName)}
            </span>
            <span class="book-category-tag" style="background:var(--bg-subtle); color:var(--primary-navy);">
              ${formatBookType(book.book_type)}
            </span>
            ${book.page_count ? `<span class="book-category-tag" style="background:#f3f4f6; color:#374151;">📄 ${book.page_count} لاپەڕە</span>` : ''}
          </div>
          <h3 class="book-title">${escapeHtml(book.title)}</h3>
          <p class="book-author">${escapeHtml(book.author)}</p>

          <div class="book-availability-row">
            <span class="availability-pill ${availClass}">
              ${availText}
            </span>
            <span style="font-size:0.75rem; color:var(--text-muted);">
              خوێنەران: ${book.total_loans_count || 0} کەس
            </span>
          </div>

          ${permBannerHtml}

          <div class="book-card-actions">
            ${borrowBtnHtml}
            <button class="btn btn-outline btn-sm" onclick="openBookDetailsModal(${book.id})">
              وردەکاری
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

async function handleBorrowBook(bookId, bookTitle) {
  if (!state.user) {
    openModal('signin-modal');
    return;
  }

  if (!confirm(`ئایا دڵنیایت لە خواستنی کتێبی «${bookTitle}»؟`)) return;

  try {
    const res = await window.api.borrowBook(bookId);
    showToast(res.message, 'success');
    loadCatalog();
    if (state.currentView === 'inventory') loadMyInventory();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function handleReturnBook(loanId, bookTitle) {
  if (!confirm(`ئایا دڵنیایت لە گەڕاندنەوەی کتێبی «${bookTitle}» بۆ کتێبخانە؟`)) return;

  try {
    const res = await window.api.returnBook(loanId);
    showToast(res.message, 'success');
    loadMyInventory();
    loadCatalog();
    if (state.currentView === 'admin') loadAdminDashboard();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function loadMyInventory() {
  if (!state.user) return;

  const activeContainer = document.getElementById('my-active-loans-grid');
  const pastContainer = document.getElementById('my-past-loans-table-body');
  if (activeContainer) activeContainer.innerHTML = `<p>چاوەڕوانبە...</p>`;

  try {
    const [res, favRes] = await Promise.all([
      window.api.getMyLoans(),
      window.api.getBooks({ favorites_only: 'true' }).catch(() => ({ books: [] }))
    ]);
    state.myActiveLoans = res.currentInventory || [];
    state.myPastLoans = res.pastLoans || [];
    const myFavs = favRes.books || [];

    const pfName = document.getElementById('my-profile-fullname');
    const pfMeta = document.getElementById('my-profile-meta');
    if (pfName && state.user) pfName.textContent = '👤 ' + state.user.fullName;
    if (pfMeta && state.user) pfMeta.textContent = `${state.user.gradeLabel?.ckb || ''} • ${state.user.role === 'admin' ? 'بەڕێوەبەر' : 'خوێنەر'}`;
    const totalReadBooks = state.myPastLoans.filter(l => l.notes !== 'not_read').length;
    const totalReadPages = state.myPastLoans.filter(l => l.notes !== 'not_read').reduce((sum, l) => sum + (parseInt(l.page_count, 10) || 0), 0);
    const elReadB = document.getElementById('stat-my-read-books'); if (elReadB) elReadB.textContent = totalReadBooks;
    const elReadP = document.getElementById('stat-my-read-pages'); if (elReadP) elReadP.textContent = totalReadPages;
    const elActB = document.getElementById('stat-my-active-books'); if (elActB) elActB.textContent = state.myActiveLoans.length;
    const elFavB = document.getElementById('stat-my-fav-books'); if (elFavB) elFavB.textContent = myFavs.length;

    const favGrid = document.getElementById('my-favorites-grid');
    if (favGrid) {
      if (myFavs.length === 0) {
        favGrid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;"><p>هێشتا هیچ کتێبێکت نەخستووەتە لیستی دڵخوازەکان.</p></div>`;
      } else {
        favGrid.innerHTML = myFavs.map(b => `
          <div class="book-card" style="padding:1rem; cursor:pointer;" onclick="openBookDetailsModal(${b.id})">
            <div style="font-weight:800; font-size:1.05rem; margin-bottom:0.25rem;">${escapeHtml(b.title)}</div>
            <div style="color:var(--text-secondary); font-size:0.88rem; margin-bottom:0.5rem;">${escapeHtml(b.author)}</div>
            <div style="display:flex; gap:0.4rem; flex-wrap:wrap; font-size:0.78rem;">
              <span class="book-category-tag">${formatBookType(b.book_type)}</span>
              ${b.page_count ? `<span class="book-category-tag">📄 ${b.page_count} لاپەڕە</span>` : ''}
            </div>
          </div>
        `).join('');
      }
    }

    if (activeContainer) {
      if (state.myActiveLoans.length === 0) {
        activeContainer.innerHTML = `
          <div class="empty-state" style="grid-column: 1/-1;">
            <div class="empty-state-icon">📖</div>
            <h4>لە ئێستادا هیچ کتێبێکت نەخواستووە</h4>
          </div>
        `;
      } else {
        activeContainer.innerHTML = state.myActiveLoans.map(loan => {
          return `
            <div class="loan-card ${loan.is_overdue ? 'overdue' : ''}">
              <div class="loan-thumb" style="width:75px; height:105px; background:var(--primary-navy); color:#fff; display:flex; align-items:center; justify-content:center; border-radius:var(--radius-sm); font-size:1.8rem; flex-shrink:0;">📖</div>
              <div class="loan-info">
                <h4 class="loan-book-title">${escapeHtml(loan.title)}</h4>
                <p style="font-size:0.82rem; color:var(--text-secondary); margin-bottom:0.25rem;">${escapeHtml(loan.author)}</p>
                <div class="loan-dates-block">
                  <div><strong>کاتی گەڕاندنەوە:</strong> ${new Date(loan.due_at).toLocaleDateString()}</div>
                </div>
                <button class="btn btn-navy btn-sm" style="margin-top:auto;" onclick="handleReturnBook(${loan.loan_id}, '${escapeHtml(loan.title)}')">
                  گەڕاندنەوەی کتێب
                </button>
              </div>
            </div>
          `;
        }).join('');
      }
    }

    if (pastContainer) {
      if (state.myPastLoans.length === 0) {
        pastContainer.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:1.5rem;">هێشتا هیچ تۆمارێکی تەواوکراو نییە.</td></tr>`;
      } else {
        pastContainer.innerHTML = state.myPastLoans.map(p => `
          <tr>
            <td><strong>${escapeHtml(p.title)}</strong></td>
            <td>${escapeHtml(p.author)}</td>
            <td><code>${escapeHtml(p.copy_number)}</code></td>
            <td>${new Date(p.borrowed_at).toLocaleDateString()}</td>
            <td><span style="color:var(--success-green); font-weight:600;">✓ ${new Date(p.returned_at).toLocaleDateString()}</span></td>
          </tr>
        `).join('');
      }
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function openBookDetailsModal(bookId) {
  try {
    const res = await window.api.getBookById(bookId);
    const book = res.book;

    document.getElementById('modal-book-title').textContent = book.title;
    document.getElementById('modal-book-author').textContent = book.author;
    document.getElementById('modal-book-category').textContent = `${book.category_name_ckb} • ${formatBookType(book.book_type)}${book.page_count ? ' • 📄 ' + book.page_count + ' لاپەڕە' : ''}`;
    document.getElementById('modal-book-desc').textContent = book.description || 'هیچ کورتەیەک دابین نەکراوە.';
    document.getElementById('modal-book-total-loans').textContent = book.total_loans_count || 0;

    const coverEl = document.getElementById('modal-book-cover');
    if (coverEl) {
      if (book.cover_url) {
        coverEl.src = book.cover_url;
        coverEl.style.display = 'block';
      } else {
        coverEl.style.display = 'none';
      }
    }

    const historySection = document.getElementById('modal-admin-history-section');
    const historyTableBody = document.getElementById('modal-book-history-table-body');
    if (historySection) {
      if (state.user && state.user.role === 'admin' && book.borrowingHistory) {
        historySection.style.display = 'block';
        if (book.borrowingHistory.length === 0) {
          historyTableBody.innerHTML = `<tr><td colspan="5" style="text-align:center;">هیچ کەس ئەم کتێبەی نەخوێندووەتەوە تا ئێستا.</td></tr>`;
        } else {
          historyTableBody.innerHTML = book.borrowingHistory.map(h => `
            <tr>
              <td><strong>${escapeHtml(h.user_name)}</strong> (P${h.user_grade})</td>
              <td><code>${escapeHtml(h.copy_number)}</code></td>
              <td>${new Date(h.borrowed_at).toLocaleDateString()}</td>
              <td>${h.returned_at ? new Date(h.returned_at).toLocaleDateString() : '<span style="color:red">خوازراوە</span>'}</td>
              <td>${h.returned_at ? 'تەواوکراو' : 'چالاک'}</td>
            </tr>
          `).join('');
        }
      } else {
        historySection.style.display = 'none';
      }
    }

    openModal('book-details-modal');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function loadAdminDashboard() {
  if (!state.user || state.user.role !== 'admin') return;

  try {
    const statsRes = await window.api.getDashboardStats();
    state.adminStats = statsRes.stats;

    document.getElementById('stat-total-books').textContent = statsRes.stats.total_books || 0;
    const elTC = document.getElementById('stat-total-copies'); if (elTC) elTC.textContent = statsRes.stats.total_copies || 0;
    document.getElementById('stat-available-copies').textContent = statsRes.stats.available_copies || 0;
    document.getElementById('stat-borrowed-copies').textContent = statsRes.stats.borrowed_copies || 0;
    document.getElementById('stat-active-members').textContent = statsRes.stats.total_profiles_count || 0;
    document.getElementById('stat-active-loans').textContent = statsRes.stats.active_loans || 0;

    initAdminTabs();
    loadAdminTabContent(state.adminTab);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function initAdminTabs() {
  document.querySelectorAll('.admin-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.getAttribute('data-admin-tab');
      state.adminTab = tab;
      document.querySelectorAll('.admin-tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      ['books', 'members', 'loans', 'suggestions', 'requests'].forEach(t => {
        const p = document.getElementById(`admin-pane-${t}`);
        if (p) p.style.display = (t === tab) ? 'block' : 'none';
      });
      if (tab === 'suggestions') renderAdminSuggestions();

      loadAdminTabContent(tab);
    });
  });
}

async function loadAdminTabContent(tab) {
  if (tab === 'books') {
    const tableBody = document.getElementById('admin-books-table-body');
    if (!tableBody) return;
    tableBody.innerHTML = `<tr><td colspan="7" style="text-align:center;">چاوەڕوانبە...</td></tr>`;

    const res = await window.api.getBooks({ include_archived: 'true' });
    const books = res.books || [];

    if (books.length === 0) {
      tableBody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:2rem;">هیچ کتێبێک تۆمار نەکراوە. دوگمەی «زیادکردنی کتێب» دابگرە بۆ زیادکردنی کتێب بە وێنەی کامێرا یان گەلەری.</td></tr>`;
      return;
    }

    tableBody.innerHTML = books.map(b => `
      <tr>
        <td><strong>${escapeHtml(b.title)}</strong></td>
        <td>${escapeHtml(b.author)}</td>
        <td><span class="book-category-tag cat-badge-${b.category_code}">${escapeHtml(b.category_name_ckb)}</span></td>
        <td>
          <select class="form-control" style="padding:0.25rem 0.5rem; font-size:0.82rem; min-width:120px;" onchange="quickChangeBookType(${b.id}, this.value)">
            ${Object.entries(BOOK_TYPE_LABELS).map(([k, lbl]) => `<option value="${k}" ${(b.book_type || 'other') === k ? 'selected' : ''}>${lbl}</option>`).join('')}
          </select>
        </td>
        <td>${b.available_copies} / ${b.total_copies}</td>
        <td><strong>${b.total_loans_count || 0} کەس</strong></td>
        <td>
          <button class="btn btn-outline btn-sm" onclick="openBookDetailsModal(${b.id})">بینین</button>
          <button class="btn btn-primary btn-sm" onclick="openEditBookModal(${b.id})">✏️ دەستکاریکردن</button>
          <button class="btn btn-danger btn-sm" onclick="permanentDeleteBook(${b.id}, '${escapeHtml(b.title)}')">سڕینەوەی هەمیشەیی</button>
        </td>
      </tr>
    `).join('');
  } else if (tab === 'members') {
    const tableBody = document.getElementById('admin-members-table-body');
    if (!tableBody) return;
    tableBody.innerHTML = `<tr><td colspan="7" style="text-align:center;">چاوەڕوانبە...</td></tr>`;

    const res = await window.api.getMembers();
    state.adminMembers = res.members || [];

    tableBody.innerHTML = state.adminMembers.map(m => `
      <tr>
        <td>
          <strong>${escapeHtml(m.full_name)}</strong>
          ${m.role === 'admin' ? '<span style="color:var(--accent-amber); font-weight:700;">(بەڕێوەبەر)</span>' : ''}
        </td>
        <td>${escapeHtml(m.email)}</td>
        <td><span class="book-category-tag" style="background:#e0f2fe; color:#0369a1;">${m.gradeLabel.ckb}</span></td>
        <td>
          <span style="font-weight:700; color:${m.role === 'admin' ? 'var(--accent-amber)' : 'var(--forest-green)'};">
            ${m.role === 'admin' ? 'بەڕێوەبەر (Admin)' : 'خوێنەر (Member)'}
          </span>
        </td>
        <td><strong>${m.total_books_read_count || 0} کتێب</strong></td>
        <td>
          <button class="btn btn-outline btn-sm" onclick="openEditMemberModal(${m.id}, '${escapeHtml(m.full_name)}', ${m.grade_level})">✏️ گۆڕینی ناو</button>
          <button class="btn btn-outline btn-sm" onclick="toggleUserRole(${m.id}, '${m.role === 'admin' ? 'member' : 'admin'}', '${escapeHtml(m.full_name)}')">
            ${m.role === 'admin' ? 'بیکە بە ئەندام' : 'بیکە بە بەڕێوەبەر'}
          </button>
          <button class="btn btn-danger btn-sm" onclick="permanentDeleteMember(${m.id}, '${escapeHtml(m.full_name)}')">سڕینەوە</button>
        </td>
      </tr>
    `).join('');
  } else if (tab === 'requests') {
    const tableBody = document.getElementById('admin-requests-table-body');
    if (!tableBody) return;
    tableBody.innerHTML = '<tr><td colspan="4" style="text-align:center;">چاوەڕوانبە...</td></tr>';
    try {
      const r = await window.api.getPendingRequests();
      const list = r.requests || [];
      const cnt = document.getElementById('stat-requests-count');
      if (cnt) cnt.textContent = list.length;
      if (list.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:1.5rem;">هیچ داواکارییەکی نوێ نییە.</td></tr>';
        return;
      }
      tableBody.innerHTML = list.map(u => `<tr>
        <td><strong>${escapeHtml(u.full_name)}</strong></td>
        <td>${u.gradeLabel?.ckb || ('پۆلی ' + u.grade_level)}</td>
        <td>${new Date(u.created_at).toLocaleDateString('en-GB')}</td>
        <td style="display:flex; gap:0.4rem;">
          <button class="btn btn-primary btn-sm" onclick="approveMemberReq(${u.id})">✅ پەسەندکردن</button>
          <button class="btn btn-danger btn-sm" onclick="rejectMemberReq(${u.id})">❌ ڕەتکردنەوە</button>
        </td>
      </tr>`).join('');
    } catch (e) {
      tableBody.innerHTML = '<tr><td colspan="4" style="text-align:center;">هەڵە لە هێنانی داواکارییەکان</td></tr>';
    }
  } else if (tab === 'loans') {
    const tableBody = document.getElementById('admin-loans-table-body');
    if (!tableBody) return;
    tableBody.innerHTML = `<tr><td colspan="7" style="text-align:center;">چاوەڕوانبە...</td></tr>`;

    const res = await window.api.getAllLoans();
    state.adminAllLoans = res.loans || [];

    if (state.adminAllLoans.length === 0) {
      tableBody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:1.5rem;">هیچ خواستنێک تۆمار نەکراوە.</td></tr>`;
      return;
    }

    tableBody.innerHTML = state.adminAllLoans.map(l => `
      <tr>
        <td><strong>${escapeHtml(l.book_title)}</strong></td>
        <td><code>${escapeHtml(l.copy_number)}</code></td>
        <td>${escapeHtml(l.member_name)} (P${l.member_grade})</td>
        <td>${new Date(l.borrowed_at).toLocaleDateString()}</td>
        <td>${new Date(l.due_at).toLocaleDateString()}</td>
        <td>
          ${l.returned_at ? `<span style="color:var(--success-green)">گەڕێندراوەتەوە (${new Date(l.returned_at).toLocaleDateString()})</span>` : '<span style="color:var(--danger-red); font-weight:700;">خوازراوە</span>'}
        </td>
        <td>
          ${!l.returned_at ? `<button class="btn btn-navy btn-sm" onclick="handleReturnBook(${l.loan_id}, '${escapeHtml(l.book_title)}')">تۆماری گەڕاندنەوە</button>` : '—'}
        </td>
      </tr>
    `).join('');
  }
}

async function permanentDeleteBook(bookId, bookTitle) {
  if (!confirm(`ئایا دڵنیایت لە سڕینەوەی هەمیشەیی کتێبی «${bookTitle}» لە بنکەدراوە؟\nئەم کتێبە لە تەواوی ئامێرەکان دەسڕێتەوە.`)) {
    return;
  }

  try {
    const res = await window.api.deleteBook(bookId);
    showToast(res.message, 'success');
    loadAdminTabContent('books');
    loadCatalog();
  } catch (err) {
    showToast(err.message, 'error');
  }
}


function openEditMemberModal(id, fullName, gradeLevel) {
  document.getElementById('edit-member-id').value = id;
  document.getElementById('edit-member-name').value = fullName;
  document.getElementById('edit-member-grade').value = gradeLevel;
  openModal('edit-member-modal');
}

document.getElementById('admin-edit-member-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('edit-member-id').value;
  const fullName = document.getElementById('edit-member-name').value.trim();
  const gradeLevel = parseInt(document.getElementById('edit-member-grade').value, 10);
  try {
    const res = await window.api.updateMember(id, { fullName, gradeLevel });
    showToast(res.message, 'success');
    closeModal('edit-member-modal');
    loadAdminTabContent('members');
  } catch (err) {
    showToast(err.message, 'error');
  }
});

async function toggleUserRole(userId, newRole, userName) {
  const roleName = newRole === 'admin' ? 'بەڕێوەبەر' : 'ئەندامی ئاسایی';
  if (!confirm(`ئایا دڵنیایت لە گۆڕینی ڕۆڵی «${userName}» بۆ ${roleName}؟`)) return;

  try {
    const res = await window.api.updateMember(userId, { role: newRole });
    showToast(res.message, 'success');
    loadAdminTabContent('members');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function permanentDeleteMember(userId, userName) {
  if (!confirm(`ئایا دڵنیایت لە سڕینەوەی هەمیشەیی پڕۆفایلی «${userName}» لە بنکەدراوە؟`)) return;

  try {
    const res = await window.api.deleteMember(userId);
    showToast(res.message, 'success');
    loadAdminTabContent('members');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// Add Book Form Submission with Camera / Gallery Base64 Photo
document.getElementById('admin-add-book-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = document.getElementById('new-book-title').value.trim();
  const author = document.getElementById('new-book-author').value.trim();
  const categoryId = document.getElementById('new-book-category').value;
  const desc = document.getElementById('new-book-desc').value.trim();
  const bookType = document.getElementById('new-book-type')?.value || 'other';
  const pageCount = document.getElementById('new-book-pages')?.value || null;
  const submitBtn = document.getElementById('btn-save-book-submit');

  try {
    submitBtn.disabled = true;
    submitBtn.textContent = 'پاشەکەوت دەکرێت...';

    const res = await window.api.createBook({
      title,
      author,
      gradeCategoryId: parseInt(categoryId, 10),
      coverUrl: selectedBookPhotoBase64 || null,
      description: desc || null
    });

    showToast(res.message, 'success');
    closeModal('add-book-modal');
    e.target.reset();
    selectedBookPhotoBase64 = null;
    const box = document.getElementById('photo-preview-box');
    if (box) box.style.display = 'none';

    loadAdminDashboard();
    loadCatalog();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = '💾 پاشەکەوتکردن لە بنکەدراوە';
  }
});

document.getElementById('admin-add-member-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fullName = document.getElementById('new-member-name').value.trim();
  const email = document.getElementById('new-member-email').value.trim();
  const password = document.getElementById('new-member-pass').value.trim();
  const grade = document.getElementById('new-member-grade').value;
  const role = document.getElementById('new-member-role').value;

  try {
    const res = await window.api.registerMember({
      fullName,
      email,
      password,
      gradeLevel: parseInt(grade, 10),
      role
    });

    showToast(res.message, 'success');
    closeModal('add-member-modal');
    e.target.reset();
    loadAdminTabContent('members');
  } catch (err) {
    showToast(err.message, 'error');
  }
});

function openModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.add('active');
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.remove('active');
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function renderApp() {
  window.i18n.applyLanguageToDOM();
  renderCategoryFilterTabs();
  if (state.currentView === 'catalog') {
    renderBookCards(document.getElementById('books-catalog-grid'), state.books);
  } else if (state.currentView === 'inventory') {
    loadMyInventory();
  }
}

window.app = {
  state,
  switchView,
  loadCatalog,
  loadMyInventory,
  openBookDetailsModal,
  handleBorrowBook,
  handleReturnBook,
  permanentDeleteBook,
  openEditMemberModal,
  toggleUserRole,
  permanentDeleteMember,
  openModal,
  closeModal,
  showToast
};


let currentSigninMode = 'member';
let currentRaceTab = 'mostBooks';
let cachedRacesData = null;

window.setSigninMode = function(mode) {
  currentSigninMode = mode;
  const mBtn = document.getElementById('btn-signin-mode-member');
  const aBtn = document.getElementById('btn-signin-mode-admin');
  const rBtn = document.getElementById('btn-signin-mode-request');
  const mGrp = document.getElementById('signin-member-group');
  const eGrp = document.getElementById('signin-email-group');
  const rGrp = document.getElementById('signin-request-group');
  const subBtn = document.getElementById('signin-submit-btn');
  if (mBtn) mBtn.className = mode === 'member' ? 'btn btn-navy btn-sm' : 'btn btn-outline btn-sm';
  if (aBtn) aBtn.className = mode === 'admin' ? 'btn btn-navy btn-sm' : 'btn btn-outline btn-sm';
  if (rBtn) rBtn.className = mode === 'request' ? 'btn btn-navy btn-sm' : 'btn btn-outline btn-sm';
  if (mGrp) mGrp.style.display = mode === 'member' ? 'block' : 'none';
  if (eGrp) eGrp.style.display = mode === 'admin' ? 'block' : 'none';
  if (rGrp) rGrp.style.display = mode === 'request' ? 'block' : 'none';
  if (subBtn) subBtn.textContent = mode === 'request' ? 'ناردنی داواکاری' : 'چوونە ژوورەوە';
};

window.setRaceTab = function(tab, btn) {
  currentRaceTab = tab;
  document.querySelectorAll('#race-type-tabs .cat-tab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderLeaderboardRaces();
};

async function loadPublicMembersDropdown() {
  try {
    const res = await window.api.getPublicMembers();
    const sel = document.getElementById('signin-member-select');
    if (sel && res.members) {
      sel.innerHTML = '<option value="">-- ناو هەڵبژێرە --</option>' +
        res.members.map(m => `<option value="${m.id}">${escapeHtml(m.full_name)}</option>`).join('');
    }
  } catch (err) {
    console.warn('Could not load members dropdown:', err);
  }
}


function renderLeaderboardRaces() {
  const container = document.getElementById('leaderboard-container');
  if (!container) return;
  const races = cachedRacesData || {};
  let list = [];
  let unit = 'کتێب';
  if (currentRaceTab === 'mostBooks') { list = races.mostBooks || []; unit = 'کتێب'; }
  else if (currentRaceTab === 'onTimeReaders') { list = races.fastestReaders || []; unit = 'کتێبی گەڕێندراوە'; }
  else if (currentRaceTab === 'diverseReaders') { list = races.diverseReaders || races.mostBooks || []; unit = 'جۆری جیاواز'; }
  else if (currentRaceTab === 'monthlyLeaders') { list = races.monthlyLeaders || []; unit = 'کتێبی ئەم مانگە'; }

  if (!list || list.length === 0) {
    container.innerHTML = `<div class="empty-state"><h4>هێشتا پێشبڕکێی خوێندنەوە لەم بەشەدا دەستی پێ نەکردووە</h4></div>`;
    return;
  }
  container.innerHTML = list.map((u, idx) => {
    const score = currentRaceTab === 'diverseReaders' ? (u.diverse_types ?? u.books_read ?? 0) : currentRaceTab === 'onTimeReaders' ? (u.completed_books ?? 0) : currentRaceTab === 'monthlyLeaders' ? (u.monthly_books ?? 0) : (u.books_read ?? 0);
    return `
      <div class="leader-card">
        <div style="display:flex; align-items:center; gap:1rem;">
          <div class="leader-rank rank-${idx + 1}">${idx + 1}</div>
          <div>
            <div style="font-weight:700; color:var(--primary-navy);">${escapeHtml(u.full_name)}</div>
            <div style="font-size:0.8rem; color:var(--text-secondary);">پۆلی ${u.grade_level > 12 ? 'سەروو ١٢' : u.grade_level}</div>
          </div>
        </div>
        <div style="font-weight:800; color:var(--forest-green);">${score} ${unit}</div>
      </div>
    `;
  }).join('');
}


window.openSuggestModal = function() {
  if (!state.user) {
    requireLogin('تکایە سەرەتا بچۆ ژوورەوە بۆ پێشنیازکردنی کتێب');
    return;
  }
  openModal('suggest-book-modal');
};

async function loadRacesView() {
  try {
    const res = await window.api.getLeaderboard();
    cachedRacesData = res || {};
    renderLeaderboardRaces();
  } catch (err) {
    console.warn('Could not load leaderboard:', err);
    renderLeaderboardRaces();
  }
}


function renderAnnouncementBanner() {
  const banner = document.getElementById('family-announcement-banner');
  const txt = document.getElementById('family-announcement-text');
  const msg = localStorage.getItem('family_lib_announcement') || '';
  if (banner && txt) {
    if (msg) { txt.textContent = msg; banner.style.display = 'block'; }
    else { banner.style.display = 'none'; }
  }
}

function renderAdminSuggestions() {
  const list = JSON.parse(localStorage.getItem('family_lib_suggestions') || '[]');
  const cnt = document.getElementById('stat-suggestions-count');
  if (cnt) cnt.textContent = list.length;
  const tbody = document.getElementById('admin-suggestions-table-body');
  if (!tbody) return;
  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:1.5rem;">هیچ داواکارییەک نییە.</td></tr>';
    return;
  }
  tbody.innerHTML = list.map(s => `<tr>
    <td><strong>${escapeHtml(s.title)}</strong></td>
    <td>${escapeHtml(s.by)}</td>
    <td>${escapeHtml(s.notes || '—')}</td>
    <td><button class="btn btn-sm btn-outline" style="color:#dc2626;" onclick="deleteSuggestion(${s.id})">🗑️ سڕینەوە</button></td>
  </tr>`).join('');
}

window.deleteSuggestion = function(id) {
  const list = JSON.parse(localStorage.getItem('family_lib_suggestions') || '[]').filter(s => s.id !== id);
  localStorage.setItem('family_lib_suggestions', JSON.stringify(list));
  renderAdminSuggestions();
};


window.approveMemberReq = async function(id) {
  try {
    const r = await window.api.approveMemberRequest(id);
    showToast(r.message, 'success');
    loadAdminTabContent('requests');
    loadPublicMembersDropdown();
  } catch (e) { showToast(e.message, 'error'); }
};

window.rejectMemberReq = async function(id) {
  try {
    const r = await window.api.rejectMemberRequest(id);
    showToast(r.message, 'info');
    loadAdminTabContent('requests');
  } catch (e) { showToast(e.message, 'error'); }
};

function init3DBook() {
  const stage = document.getElementById('book3d-stage');
  const book = document.getElementById('book3d-el');
  if (!stage || !book) return;
  let rotX = 12, rotY = -24, dragging = false, sx = 0, sy = 0;
  const update = () => { book.style.transform = `rotateX(${rotX}deg) rotateY(${rotY}deg)`; };
  stage.addEventListener('pointerdown', (e) => { dragging = true; sx = e.clientX; sy = e.clientY; stage.setPointerCapture(e.pointerId); });
  stage.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    rotY += (e.clientX - sx) * 0.6;
    rotX -= (e.clientY - sy) * 0.6;
    rotX = Math.max(-55, Math.min(55, rotX));
    sx = e.clientX; sy = e.clientY;
    update();
  });
  stage.addEventListener('pointerup', () => { dragging = false; });
  stage.addEventListener('pointercancel', () => { dragging = false; });
}


window.handleReturnWithReadCheck = async function(loanId, title) {
  const didRead = confirm(`پێش گەڕاندنەوەی کتێبی «${title}»: \n\nئایا ئەم کتێبەت خوێندەوە؟\n• OK = بەڵێ، خوێندمەوە (بچێتە ناو ئامارەکانم)\n• Cancel = نەخێر، هێشتا نەمخوێندووەتەوە`);
  try {
    await window.api.request('/loans/return', { method: 'POST', body: JSON.stringify({ loanId, didRead }) });
    showToast(didRead ? 'کتێبەکە گەڕێندرایەوە و وەک خوێندراو تۆمارکرا ✅' : 'کتێبەکە گەڕێندرایەوە (وەک نەخوێندراو)', 'success');
    loadMyInventory();
    loadCatalog();
  } catch (e) {
    showToast(e.message, 'error');
  }
};


window.quickChangeBookType = async function(bookId, newType) {
  try {
    await window.api.request(`/books/${bookId}`, { method: 'PUT', body: JSON.stringify({ bookType: newType }) });
    showToast('جۆری کتێب نوێکرایەوە ✅', 'success');
    loadCatalog();
  } catch (e) {
    showToast(e.message, 'error');
  }
};


window.openEditBookModal = async function(bookId) {
  try {
    const res = await window.api.getBookById(bookId);
    const b = res.book;
    document.getElementById('edit-book-id').value = b.id;
    document.getElementById('edit-book-title').value = b.title || '';
    document.getElementById('edit-book-author').value = b.author || '';
    document.getElementById('edit-book-type').value = b.book_type || 'other';
    document.getElementById('edit-book-pages').value = b.page_count || '';
    document.getElementById('edit-book-desc').value = b.description || '';

    const catSel = document.getElementById('edit-book-category');
    const addCatSel = document.getElementById('new-book-category');
    if (catSel && addCatSel) {
      catSel.innerHTML = addCatSel.innerHTML;
      catSel.value = b.grade_category_id || '';
    }
    const fileInput = document.getElementById('edit-book-cover-file');
    if (fileInput) fileInput.value = '';
    openModal('edit-book-modal');
  } catch (e) {
    showToast(e.message, 'error');
  }
};

document.getElementById('admin-edit-book-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('edit-book-id').value;
  const btn = document.getElementById('btn-save-edit-book');
  const payload = {
    title: document.getElementById('edit-book-title').value.trim(),
    author: document.getElementById('edit-book-author').value.trim(),
    bookType: document.getElementById('edit-book-type').value,
    pageCount: document.getElementById('edit-book-pages').value ? parseInt(document.getElementById('edit-book-pages').value, 10) : null,
    gradeCategoryId: parseInt(document.getElementById('edit-book-category').value, 10),
    description: document.getElementById('edit-book-desc').value.trim()
  };

  const fileEl = document.getElementById('edit-book-cover-file');
  if (fileEl && fileEl.files && fileEl.files[0]) {
    payload.coverUrl = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const maxW = 800;
          const scale = img.width > maxW ? (maxW / img.width) : 1;
          canvas.width = img.width * scale;
          canvas.height = img.height * scale;
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', 0.82));
        };
        img.src = ev.target.result;
      };
      reader.readAsDataURL(fileEl.files[0]);
    });
  }

  try {
    btn.disabled = true;
    await window.api.request(`/books/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
    closeModal('edit-book-modal');
    showToast('زانیارییەکانی کتێب نوێکرانەوە ✅', 'success');
    loadAdminTabContent('books');
    loadCatalog();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
  }
});


// ==================== WEB AUDIO UI SOUNDS & CALM LIBRARY MUSIC ====================
(function() {
  let audioCtx = null;
  let uiSoundsEnabled = localStorage.getItem('family_lib_sounds') !== 'off';
  let musicPlaying = false;
  let musicTimer = null;

  function getCtx() {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) audioCtx = new AC();
    }
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    return audioCtx;
  }

  function playTone(freq, dur = 0.09, type = 'sine', vol = 0.06, delay = 0) {
    if (!uiSoundsEnabled) return;
    const ctx = getCtx();
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(vol, t + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  window.playClickSound = () => playTone(520, 0.07, 'sine', 0.045);
  window.playSuccessSound = () => {
    playTone(523.25, 0.12, 'triangle', 0.055, 0);
    playTone(659.25, 0.14, 'triangle', 0.055, 0.07);
    playTone(783.99, 0.22, 'triangle', 0.06, 0.14);
  };

  // Gentle soft click on interactive buttons & cards
  document.addEventListener('click', (e) => {
    if (e.target.closest('button, .home-quick-card, .book-card')) {
      window.playClickSound();
    }
  });

  // Calm ambient chord loop
  const chords = [
    [261.63, 329.63, 392.00], // Cmaj
    [220.00, 261.63, 329.63], // Am
    [174.61, 220.00, 261.63], // Fmaj
    [196.00, 246.94, 293.66]  // Gmaj
  ];
  let chordIdx = 0;

  function playAmbientChord() {
    if (!musicPlaying) return;
    const ctx = getCtx();
    if (!ctx) return;
    const notes = chords[chordIdx % chords.length];
    chordIdx++;
    notes.forEach((freq, i) => {
      const t = ctx.currentTime + i * 0.14;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.linearRampToValueAtTime(0.025, t + 0.6);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 3.1);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 3.2);
    });
  }

  function updateSoundButtons() {
    const mBtn = document.getElementById('btn-toggle-music');
    if (mBtn) mBtn.textContent = musicPlaying ? '🎵' : '🔇';
    const sBtn = document.getElementById('btn-settings-sound');
    if (sBtn) sBtn.textContent = uiSoundsEnabled ? '🔊 دەنگی کلیک: کارایە' : '🔇 دەنگی کلیک: ناچالاک';
    const msBtn = document.getElementById('btn-settings-music');
    if (msBtn) msBtn.textContent = musicPlaying ? '🎵 میوزیکی ئارام: کارایە' : '🎵 میوزیکی ئارام: ناچالاک';
  }

  window.toggleUiSounds = function() {
    uiSoundsEnabled = !uiSoundsEnabled;
    localStorage.setItem('family_lib_sounds', uiSoundsEnabled ? 'on' : 'off');
    if (uiSoundsEnabled) window.playSuccessSound();
    updateSoundButtons();
  };

  window.toggleLibraryMusic = function() {
    musicPlaying = !musicPlaying;
    if (musicPlaying) {
      getCtx();
      playAmbientChord();
      musicTimer = setInterval(playAmbientChord, 3200);
      showToast('میوزیکی ئارام کارا کرا 🎵', 'info');
    } else {
      if (musicTimer) clearInterval(musicTimer);
      musicTimer = null;
      showToast('میوزیک وەستێنرا 🔇', 'info');
    }
    updateSoundButtons();
  };

  document.addEventListener('DOMContentLoaded', updateSoundButtons);
})();
