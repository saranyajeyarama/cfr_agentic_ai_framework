/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Backend base URL — e.g. https://cfr-tiger-foods-xxx.run.app
   *  When unset the client falls back to '/api' (Docker proxy / Vite dev). */
  readonly VITE_API_BASE_URL?: string;
  /** Optional build identifier baked into the bundle. */
  readonly BUILD_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
