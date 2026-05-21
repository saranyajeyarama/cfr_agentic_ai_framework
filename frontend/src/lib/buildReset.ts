/**
 * Cache-bust the front-end's sessionStorage on a new deploy.
 *
 * `__APP_BUILD_ID__` is injected by Vite at build time via `define` in
 * vite.config.ts (we use $BUILD_ID from the docker build args if set,
 * otherwise a fresh timestamp per build). On every page load we compare
 * the bundle's build id to whatever was last seen in this browser tab.
 * When they differ, we clear every `tiger:*` key — agentEvals,
 * decisionLog, fulfillment incidents, fulfillment scenarios — so the
 * user gets a clean slate on a new deploy without having to close the
 * browser tab manually.
 *
 * Must be called BEFORE any other module reads sessionStorage (i.e.
 * before React mounts and the per-store `useState(() => sessionStorage…)`
 * initializers fire). It's invoked from main.tsx.
 */
declare const __APP_BUILD_ID__: string;

const BUILD_ID_KEY = 'tiger:build_id:v1';
const PREFIX = 'tiger:';

export function resetIfNewBuild(): { previous: string | null; current: string; cleared: number } {
  let previous: string | null = null;
  let cleared = 0;
  try {
    previous = sessionStorage.getItem(BUILD_ID_KEY);
    if (previous !== __APP_BUILD_ID__) {
      // Collect keys first (mutating during iteration is unreliable).
      const keysToDrop: string[] = [];
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i);
        if (k && k.startsWith(PREFIX) && k !== BUILD_ID_KEY) {
          keysToDrop.push(k);
        }
      }
      for (const k of keysToDrop) sessionStorage.removeItem(k);
      cleared = keysToDrop.length;
      sessionStorage.setItem(BUILD_ID_KEY, __APP_BUILD_ID__);
    }
  } catch {
    /* sessionStorage may be unavailable (privacy mode etc.); fail open */
  }
  return { previous, current: __APP_BUILD_ID__, cleared };
}
