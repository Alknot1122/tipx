/**
 * TipX Frontend Utilities and Authentication Guards.
 * Built with standard ES6/vanilla JS patterns.
 */

// ── Toast Notification System ──────────────────────────────────────────────────

let toastContainer = null;

/**
 * Show a sleek toast message at the bottom right.
 * @param {string} message The text to display.
 * @param {'success'|'error'|'info'} type The type of toast.
 * @param {number} duration Duration in milliseconds.
 */
function showToast(message, type = 'info', duration = 4000) {
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.className = 'toast-container';
    document.body.appendChild(toastContainer);
  }
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <div style="flex-grow:1; font-size:13.5px; font-weight:450; line-height:1.4">${message}</div>
    <button onclick="this.parentElement.remove()" style="background:none; border:none; color:var(--text-3); cursor:pointer; font-size:16px; line-height:1; padding:0; flex-shrink:0">&times;</button>
  `;
  toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(6px)';
    toast.style.transition = 'all 0.2s ease';
    setTimeout(() => toast.remove(), 200);
  }, duration);
}


// ── Formatting Utilities ───────────────────────────────────────────────────────

/**
 * Formats a currency amount in satang to a standard THB display string.
 * @param {number} satang Amount in satangs.
 * @returns {string} e.g. "฿1,250.00"
 */
function formatAmount(satang) {
  const baht = satang / 100;
  return baht.toLocaleString('th-TH', {
    style: 'currency',
    currency: 'THB',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Formats a timestamp into a relative "time ago" string.
 * @param {string|Date} dateVal The timestamp.
 * @returns {string} e.g. "3 minutes ago"
 */
function timeAgo(dateVal) {
  const now = new Date();
  const past = new Date(dateVal);
  const diffMs = now - past;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  if (diffDay === 1) return 'Yesterday';
  return `${diffDay}d ago`;
}

// ── Auth Guards & Session Management ──────────────────────────────────────────

/**
 * Verifies if a user is currently authenticated and returns their profile.
 * Automatically handles token refresh via apiFetch.
 * @returns {Promise<Object|null>} The user object or null.
 */
async function checkAuth() {
  try {
    const data = await apiFetch('/auth/me');
    if (data && data.user) {
      localStorage.setItem('tipx_user', JSON.stringify(data.user));
      return data.user;
    }
  } catch (err) {
    console.warn('[Auth] Check failed:', err.message);
  }
  localStorage.removeItem('tipx_user');
  return null;
}

/**
 * Protection guard for pages requiring any logged-in user.
 * Redirects to /login if not authenticated.
 * @returns {Promise<Object>} The authenticated user object.
 */
async function requireAuth() {
  const user = await checkAuth();
  if (!user) {
    showToast('Session expired. Please log in.', 'error');
    setTimeout(() => {
      window.location.href = `/login?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`;
    }, 1000);
    // Return a never-resolving promise to block page actions while redirecting
    return new Promise(() => {});
  }
  return user;
}

/**
 * Protection guard for admin-only pages.
 * Redirects if authenticated user is not an admin.
 * @returns {Promise<Object>} The authenticated admin user.
 */
async function requireAdmin() {
  const user = await requireAuth();
  if (user.role !== 'admin') {
    showToast('Unauthorized: Admin access required.', 'error');
    setTimeout(() => {
      // Streamers get redirected to their dashboard, others to login
      if (user.role === 'streamer' && user.slug) {
        window.location.href = `/dashboard/${user.slug}`;
      } else {
        window.location.href = '/login';
      }
    }, 1200);
    return new Promise(() => {});
  }
  return user;
}

/**
 * Logs the current user out and redirects to login.
 */
async function handleLogout() {
  try {
    // Use native fetch to bypass auth token rotation loops during logout
    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include'
    });
  } catch (err) {
    console.error('[Auth] Logout network error:', err.message);
  } finally {
    localStorage.removeItem('tipx_user');
    window.location.href = '/login';
  }
}
