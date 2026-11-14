/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** API base path or URL (default "/api"). */
  readonly VITE_API_BASE?: string;
  /** Backend origin used by the dev proxy and the "API docs" link (default http://localhost:8000). */
  readonly VITE_API_URL?: string;
  /** Explicit URL of the backend's OpenAPI docs. */
  readonly VITE_API_DOCS_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
