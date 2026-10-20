import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/", ".test-build/", "node_modules/"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts", "tests/**/*.ts"],
    languageOptions: {
      globals: { ...globals.browser },
    },
    rules: {
      // Foundry's runtime is consumed through hand-written ambient declarations
      // (src/types/foundry.d.ts). Documents are intentionally typed loosely.
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": "error",
      eqeqeq: ["error", "always", { null: "ignore" }],
    },
  },
  {
    files: ["tests/**/*.ts", "tools/**/*.mjs", "vite.config.ts"],
    languageOptions: { globals: { ...globals.node } },
  },
);
