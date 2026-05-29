/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** JSON array: [{"username":"…","password":"…"}, …] — set at build time (Render env vars). */
  readonly VITE_AUTH_USERS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
