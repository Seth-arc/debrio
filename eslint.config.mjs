import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import security from "eslint-plugin-security";

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  security.configs.recommended,
  globalIgnores([
    ".next/**",
    "next-env.d.ts",
    ".artifacts/**",
    "docs/**",
    "skills/**",
    "demo/**",
    "playwright-report/**",
    "test-results/**",
    "supabase/.temp/**",
  ]),
]);
