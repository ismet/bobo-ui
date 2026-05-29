export const AUTH_STORAGE_KEY = 'bobo-ui-auth';
export const AUTH_ACTIVITY_KEY = 'bobo-ui-auth-at';
/** Sign out after this many ms without user interaction. */
export const IDLE_TIMEOUT_MS = 10 * 60 * 1000;

export interface AuthUser {
  username: string;
  password: string;
}

let lastActivityWriteMs = 0;

export function touchActivity(): void {
  const now = Date.now();
  if (now - lastActivityWriteMs < 1000) return;
  lastActivityWriteMs = now;
  try {
    localStorage.setItem(AUTH_ACTIVITY_KEY, String(now));
  } catch {
    /* ignore */
  }
}

function getLastActivityMs(): number | null {
  try {
    const raw = localStorage.getItem(AUTH_ACTIVITY_KEY);
    if (raw == null) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export function isLoggedIn(): boolean {
  try {
    if (localStorage.getItem(AUTH_STORAGE_KEY) !== '1') return false;
    const last = getLastActivityMs();
    const now = Date.now();
    if (last == null) {
      touchActivity();
      return true;
    }
    if (now - last > IDLE_TIMEOUT_MS) {
      clearSession();
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function setLoggedIn(): void {
  localStorage.setItem(AUTH_STORAGE_KEY, '1');
  touchActivity();
}

export function clearSession(): void {
  lastActivityWriteMs = 0;
  localStorage.removeItem(AUTH_STORAGE_KEY);
  localStorage.removeItem(AUTH_ACTIVITY_KEY);
}

export async function loadUsers(): Promise<AuthUser[]> {
  const res = await fetch('/users.json', { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`Could not load user list (${res.status})`);
  }
  const data: unknown = await res.json();
  if (!Array.isArray(data)) {
    throw new Error('Invalid user list format');
  }
  return data as AuthUser[];
}

export async function validateLogin(username: string, password: string): Promise<boolean> {
  const users = await loadUsers();
  const u = username.trim();
  return users.some((row) => row.username === u && row.password === password);
}
