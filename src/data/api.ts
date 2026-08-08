const REMOTE_API = 'http://45.146.4.98:8282';

/**
 * Base URL for bobo-api requests from the browser.
 * In dev/preview, default `/api` is proxied to the backend (vite.config.ts) to avoid CORS during dev.
 * Production builds use the remote URL unless VITE_BOBO_API_BASE is set.
 */
export const BOBO_API_BASE = (
  import.meta.env.VITE_BOBO_API_BASE as string | undefined
)?.replace(/\/$/, '') || (import.meta.env.DEV ? '/api' : REMOTE_API);

export function boboApiUrl(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${BOBO_API_BASE}${p}`;
}
