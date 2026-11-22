/**
 * Client API Client
 * Manages HTTP communication with the backend, token storage, and error formatting.
 */

const API_BASE = '/api';

class ApiClient {
  constructor() {
    this.token = localStorage.getItem('library_token') || null;
    this.user = JSON.parse(localStorage.getItem('library_user') || 'null');
  }

  setToken(token, user) {
    this.token = token;
    this.user = user;
    if (token) {
      localStorage.setItem('library_token', token);
      localStorage.setItem('library_user', JSON.stringify(user));
    } else {
      localStorage.removeItem('library_token');
      localStorage.removeItem('library_user');
    }
  }

  getHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
    return headers;
  }

  async request(endpoint, options = {}) {
    const url = `${API_BASE}${endpoint}`;
    const config = {
      ...options,
      headers: { ...this.getHeaders(), ...(options.headers || {}) }
    };

    try {
      const response = await fetch(url, config);
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        if (response.status === 401 && this.token) {
          this.setToken(null, null);
          window.dispatchEvent(new CustomEvent('auth-changed', { detail: { user: null } }));
        }

        const errorMsg = (window.i18n && window.i18n.getCurrentLanguage() === 'en')
          ? (data.errorEn || data.error || 'Request failed.')
          : (data.error || data.errorEn || 'کردارەکە سەرکەوتوو نەبوو.');

        const err = new Error(errorMsg);
        err.status = response.status;
        err.data = data;
        throw err;
      }

      return data;
    } catch (err) {
      console.error(`API Error [${endpoint}]:`, err.message);
      throw err;
    }
  }

  async login(payload, password) {
    const bodyData = (payload && typeof payload === 'object') ? payload : { email: payload, password };
    const res = await this.request('/auth/login', {
      method: 'POST',
      body: JSON.stringify(bodyData)
    });
    this.setToken(res.token, res.user);
    window.dispatchEvent(new CustomEvent('auth-changed', { detail: { user: res.user } }));
    return res;
  }

  logout() {
    this.setToken(null, null);
    window.dispatchEvent(new CustomEvent('auth-changed', { detail: { user: null } }));
  }

  async requestMembership(data) {
    return this.request('/auth/register-request', { method: 'POST', body: JSON.stringify(data) });
  }
  async getPendingRequests() { return this.request('/admin/requests'); }
  async approveMemberRequest(id) { return this.request(`/admin/requests/${id}/approve`, { method: 'POST' }); }
  async rejectMemberRequest(id) { return this.request(`/admin/requests/${id}`, { method: 'DELETE' }); }
  async getPublicMembers() {
    return this.request('/auth/members');
  }

  async getMe() {
    const res = await this.request('/auth/me');
    this.user = res.user;
    localStorage.setItem('library_user', JSON.stringify(res.user));
    return res.user;
  }

  async updateProfile(profileData) {
    const res = await this.request('/auth/profile', {
      method: 'PUT',
      body: JSON.stringify(profileData)
    });
    this.user = res.user;
    localStorage.setItem('library_user', JSON.stringify(res.user));
    return res;
  }

  async getBooks(params = {}) {
    const query = new URLSearchParams();
    if (params.q) query.append('q', params.q);
    if (params.category) query.append('category', params.category);
    if (params.book_type && params.book_type !== 'all') query.append('book_type', params.book_type);
    if (params.available_only) query.append('available_only', 'true');
    if (params.favorites_only) query.append('favorites_only', 'true');
    if (params.include_archived) query.append('include_archived', 'true');

    const qs = query.toString() ? `?${query.toString()}` : '';
    return this.request(`/books${qs}`);
  }

  async getBookById(id) { return this.request(`/books/${id}`); }
  async addReview(bookId, rating, comment) {
    return this.request(`/books/${bookId}/reviews`, {
      method: 'POST',
      body: JSON.stringify({ rating, comment })
    });
  }
  async toggleFavorite(bookId) {
    return this.request(`/books/${bookId}/favorite`, { method: 'POST' });
  }
  async getLeaderboard() { return this.request('/leaderboard'); }

  async createBook(bookData) {
    return this.request('/books', { method: 'POST', body: JSON.stringify(bookData) });
  }
  async updateBook(id, bookData) {
    return this.request(`/books/${id}`, { method: 'PUT', body: JSON.stringify(bookData) });
  }
  async deleteBook(id) {
    return this.request(`/books/${id}`, { method: 'DELETE' });
  }
  async addCopy(bookId, copyData) {
    return this.request(`/books/${bookId}/copies`, { method: 'POST', body: JSON.stringify(copyData) });
  }

  async borrowBook(bookId, notes = '') {
    return this.request('/loans/borrow', { method: 'POST', body: JSON.stringify({ bookId, notes }) });
  }
  async returnBook(loanId, notes = '') {
    return this.request('/loans/return', { method: 'POST', body: JSON.stringify({ loanId, notes }) });
  }
  async getMyLoans() { return this.request('/loans/my-inventory'); }
  async getAllLoans(params = {}) {
    const query = new URLSearchParams();
    if (params.status) query.append('status', params.status);
    if (params.q) query.append('q', params.q);
    if (params.user_id) query.append('user_id', params.user_id);
    if (params.book_id) query.append('book_id', params.book_id);
    const qs = query.toString() ? `?${query.toString()}` : '';
    return this.request(`/loans/all${qs}`);
  }
  async getMemberHistory(userId) { return this.request(`/loans/member/${userId}`); }

  async getDashboardStats() { return this.request('/admin/dashboard'); }
  async getMembers(params = {}) {
    const query = new URLSearchParams();
    if (params.q) query.append('q', params.q);
    if (params.grade) query.append('grade', params.grade);
    if (params.role) query.append('role', params.role);
    if (params.active !== undefined) query.append('active', params.active);
    const qs = query.toString() ? `?${query.toString()}` : '';
    return this.request(`/admin/members${qs}`);
  }
  async registerMember(memberData) {
    return this.request('/auth/members', { method: 'POST', body: JSON.stringify(memberData) });
  }
  async updateMember(id, memberData) {
    return this.request(`/admin/members/${id}`, { method: 'PUT', body: JSON.stringify(memberData) });
  }
  async deleteMember(id) {
    return this.request(`/admin/members/${id}`, { method: 'DELETE' });
  }
  async getCategories() { return this.request('/categories'); }
  async checkHealth() { return this.request('/health'); }
}

window.api = new ApiClient();
