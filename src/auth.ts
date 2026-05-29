export const AUTH_STORAGE_KEY = 'bobo-ui-auth';
export const AUTH_ACTIVITY_KEY = 'bobo-ui-auth-at';
/** Sign out after this many ms without user interaction. */
export const IDLE_TIMEOUT_MS = 10 * 60 * 1000;

export interface AuthUser {
  username: string;
  password: string;
}

let lastActivityWriteMs = 0;

function parseAuthUsersFromEnv(): AuthUser[] {
  const raw = import.meta.env.VITE_AUTH_USERS;
  if (typeof raw !== 'string' || !raw.trim()) return [];

  try {
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    const users: AuthUser[] = [];
    for (const row of data) {
      if (
        row &&
        typeof row === 'object' &&
        typeof (row as AuthUser).username === 'string' &&
        typeof (row as AuthUser).password === 'string'
      ) {
        users.push({
          username: (row as AuthUser).username,
          password: (row as AuthUser).password,
        });
      }
    }
    return users;
  } catch {
    return [];
  }
}

/** Parsed once at module load from `VITE_AUTH_USERS` (build-time env). */
const configuredUsers: AuthUser[] = parseAuthUsersFromEnv();

export function isAuthConfigured(): boolean {
  return configuredUsers.length > 0;
}

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

export function validateLogin(username: string, password: string): boolean {
  if (!isAuthConfigured()) {
    throw new Error('Auth not configured');
  }
  const u = username.trim();
  return configuredUsers.some((row) => row.username === u && row.password === password);
}
