import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Local agent worktrees are separate checkouts with their own lint state.
    ".claude/**",
    // Generated Serwist bundle (build artifact, gitignored but present after `npm run build`)
    "public/sw.js",
    // libass workers copied from @jellyfin/libass-wasm by prebuild/predev
    // (gitignored, but present on disk as minified vendor bundles)
    "public/libass/**",
  ]),
]);

export default eslintConfig;
