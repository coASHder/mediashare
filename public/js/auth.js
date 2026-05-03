const AUTH_TOKEN_KEY = 'mediashare_token';

function getAuthToken() {
  return localStorage.getItem(AUTH_TOKEN_KEY);
}

function setAuthSession(token, user) {
  localStorage.setItem(AUTH_TOKEN_KEY, token);
  localStorage.setItem('mediashare_user', JSON.stringify(user));
}

function clearAuthSession() {
  localStorage.removeItem(AUTH_TOKEN_KEY);
  localStorage.removeItem('mediashare_user');
}

async function requestJson(url, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };
  const token = getAuthToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(url, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}

function getStoredUser() {
  try {
    return JSON.parse(localStorage.getItem('mediashare_user') || 'null');
  } catch {
    return null;
  }
}

async function refreshAuthUser() {
  if (!getAuthToken()) return null;
  try {
    const data = await requestJson('/api/me');
    localStorage.setItem('mediashare_user', JSON.stringify(data.user));
    return data.user;
  } catch {
    clearAuthSession();
    return null;
  }
}

function renderAuthNav() {
  const nav = document.querySelector('[data-auth-nav]');
  if (!nav) return;

  const user = getStoredUser();
  if (!getAuthToken() || !user) {
    nav.innerHTML = `
      <a class="btn btn-ghost" href="/login">Login</a>
      <a class="btn btn-primary" href="/upload">+ Upload</a>
    `;
    return;
  }

  nav.innerHTML = `
    <span class="nav-user">${escapeHtml(user.name)}</span>
    <button class="btn btn-ghost" type="button" data-logout>Logout</button>
    <a class="btn btn-primary" href="/upload">+ Upload</a>
  `;

  nav.querySelector('[data-logout]').addEventListener('click', async () => {
    try {
      await requestJson('/api/logout', { method: 'POST' });
    } catch {
      // A failed logout request should not leave a stale local session behind.
    }
    clearAuthSession();
    window.location.href = '/login';
  });
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

document.addEventListener('DOMContentLoaded', async () => {
  renderAuthNav();
  await refreshAuthUser();
  renderAuthNav();
});
