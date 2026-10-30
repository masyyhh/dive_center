// Build-time isolation: a testing tab always calls the testing API, even when
// live and testing tabs are open together at the same origin.
export const API_BASE = import.meta.env?.VITE_DEPLOYMENT_MODE === 'testing' ? '/__testing/api' : '/api';
const storagePrefix = import.meta.env?.VITE_DEPLOYMENT_MODE === 'testing' ? 'dcm_testing_' : 'dcm_';

export const getAuthToken = (): string | null => {
  return localStorage.getItem(`${storagePrefix}auth_token`);
};

export const setAuthToken = (token: string | null) => {
  if (token) {
    localStorage.setItem(`${storagePrefix}auth_token`, token);
  } else {
    localStorage.removeItem(`${storagePrefix}auth_token`);
  }
};

export const getStoredPropertyId = (): string | null => {
  return localStorage.getItem(`${storagePrefix}active_property_id`);
};

export const setStoredPropertyId = (id: string | null) => {
  if (id) {
    localStorage.setItem(`${storagePrefix}active_property_id`, id);
  } else {
    localStorage.removeItem(`${storagePrefix}active_property_id`);
  }
};

export class ApiError extends Error {
  constructor(message: string, public status: number, public requestId?: string) { super(message); }
}

export async function apiFetch<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getAuthToken();
  const activePropertyId = getStoredPropertyId();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (token && !headers.Authorization) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  if (activePropertyId) {
    headers['X-Property-Id'] = activePropertyId;
  }

  const response = await fetch(`${API_BASE}${endpoint}`, { ...options, headers });

  if (!response.ok) {
    let errorMessage = `Request failed (${response.status})`;
    let requestId: string | undefined;
    try {
      const errorJson = await response.json();
      if (errorJson.error) {
        if (Array.isArray(errorJson.details) && errorJson.details.length > 0) {
          const detailMessages = errorJson.details
            .map((d: any) => (d.path?.length ? `${d.path.join('.')}: ` : '') + (d.message || d.code))
            .filter(Boolean)
            .join('; ');
          errorMessage = detailMessages ? `${errorJson.error} (${detailMessages})` : errorJson.error;
        } else {
          errorMessage = errorJson.error;
        }
      }
      if (typeof errorJson.requestId === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(errorJson.requestId)) requestId = errorJson.requestId;
    } catch {
      // ignore
    }
    throw new ApiError(errorMessage, response.status, requestId);
  }

  return response.json();
}

// Only clear the local token after revocation succeeds, or the server says it is
// already invalid. Failed persistence/network requests must remain retryable.
export async function revokeSession(): Promise<void> {
  try {
    await apiFetch('/auth/logout', { method: 'POST' });
  } catch (error) {
    if (!(error instanceof ApiError && error.status === 401)) throw error;
  }
  setAuthToken(null);
}

// Download helper for Excel reports
export async function downloadFile(endpoint: string, filename: string) {
  const token = getAuthToken();
  const activePropertyId = getStoredPropertyId();

  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (activePropertyId) headers['X-Property-Id'] = activePropertyId;

  const response = await fetch(`${API_BASE}${endpoint}`, { headers });

  if (!response.ok) {
    throw new Error('Failed to download file');
  }

  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}

// Called only after the user explicitly chooses Connect live sign-in.
export async function connectTestingLiveSignIn() {
  if (import.meta.env?.VITE_DEPLOYMENT_MODE !== 'testing') throw new Error('Open the testing version first.');
  const liveToken = localStorage.getItem('dcm_auth_token');
  if (!liveToken) throw new Error('Sign in to the live version in another tab, then return here and connect.');
  return apiFetch<{ token: string; user: import('../types').User }>('/auth/live-session', {
    method: 'POST', body: JSON.stringify({ liveToken }),
  });
}
