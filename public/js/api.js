/**
 * TipX API client fetch wrapper.
 * Automatically handles JSON parsing, credentials (cookies), and seamless silent token refresh.
 */

const API_BASE = '/api';

async function apiFetch(endpoint, options = {}) {
  // Ensure we include credentials (cookies) for all requests
  options.credentials = options.credentials || 'include';
  options.headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  if (options.body instanceof FormData) {
    delete options.headers['Content-Type'];
  }

  const url = endpoint.startsWith('/') ? `${API_BASE}${endpoint}` : `${API_BASE}/${endpoint}`;

  try {
    let response = await fetch(url, options);

    // If 401 Unauthorized, try to refresh tokens and retry once
    if (response.status === 401 && !options._isRetry && !url.includes('/auth/refresh') && !url.includes('/auth/login')) {
      console.warn('[API] Access token expired. Attempting token refresh...');
      
      const refreshSuccess = await refreshAccessToken();
      if (refreshSuccess) {
        // Retry the original request
        options._isRetry = true;
        response = await fetch(url, options);
      } else {
        // Refresh failed, clear session and redirect to login
        console.error('[API] Refresh failed. Redirecting to login.');
        handleAuthFailure();
      }
    }

    // Handle non-OK status codes gracefully
    if (!response.ok) {
      let errorMessage = 'An error occurred';
      try {
        const errorData = await response.json();
        errorMessage = errorData.error || errorMessage;
      } catch (e) {
        // Fallback to text status if JSON parsing fails
        errorMessage = response.statusText || errorMessage;
      }
      throw new Error(errorMessage);
    }

    // Parse JSON response
    return await response.json();
  } catch (err) {
    console.error(`[API] Error on ${url}:`, err.message);
    throw err;
  }
}

/**
 * Sends a refresh request to obtain a new access_token and refresh_token cookie.
 * @returns {Promise<boolean>} True if refresh succeeded, false otherwise.
 */
async function refreshAccessToken() {
  try {
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
    });
    return res.ok;
  } catch (err) {
    console.error('[API] Refresh request failed:', err.message);
    return false;
  }
}

/**
 * Handle authentication failure by cleaning up local storage and redirecting to login.
 */
function handleAuthFailure() {
  localStorage.removeItem('tipx_user');
  // Avoid infinite redirect loops if we are already on the login page
  if (!window.location.pathname.includes('/login') && !window.location.pathname.includes('/donate') && window.location.pathname !== '/') {
    window.location.href = `/login?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`;
  }
}
