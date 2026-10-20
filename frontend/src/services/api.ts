const getBaseUrl = (): string => {
  if (typeof window !== 'undefined' && window.location.port === '5173') {
    const host = window.location.hostname || 'localhost';
    return `http://${host}:5001/api`;
  }
  return '/api';
};

const API_BASE = getBaseUrl();

export const getAuthToken = (): string | null => {
  return localStorage.getItem('dcm_auth_token');
};

export const setAuthToken = (token: string | null) => {
  if (token) {
    localStorage.setItem('dcm_auth_token', token);
  } else {
    localStorage.removeItem('dcm_auth_token');
  }
};

export const getStoredPropertyId = (): string | null => {
  return localStorage.getItem('dcm_active_property_id');
};

export const setStoredPropertyId = (id: string | null) => {
  if (id) {
    localStorage.setItem('dcm_active_property_id', id);
  } else {
    localStorage.removeItem('dcm_active_property_id');
  }
};

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

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  if (activePropertyId) {
    headers['X-Property-Id'] = activePropertyId;
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers,
    });
  } catch (err) {
    // If connection to API_BASE fails, fallback to local loopback directly
    const fallbackBase = API_BASE.includes('localhost')
      ? 'http://127.0.0.1:5001/api'
      : 'http://localhost:5001/api';
    response = await fetch(`${fallbackBase}${endpoint}`, {
      ...options,
      headers,
    });
  }

  if (!response.ok) {
    let errorMessage = `Request failed (${response.status})`;
    try {
      const errorJson = await response.json();
      errorMessage = errorJson.error || errorMessage;
    } catch {
      // ignore
    }
    throw new Error(errorMessage);
  }

  return response.json();
}

// Download helper for Excel reports
export async function downloadFile(endpoint: string, filename: string) {
  const token = getAuthToken();
  const activePropertyId = getStoredPropertyId();

  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (activePropertyId) headers['X-Property-Id'] = activePropertyId;

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${endpoint}`, { headers });
  } catch {
    const fallbackBase = API_BASE.includes('localhost')
      ? 'http://127.0.0.1:5001/api'
      : 'http://localhost:5001/api';
    response = await fetch(`${fallbackBase}${endpoint}`, { headers });
  }

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
