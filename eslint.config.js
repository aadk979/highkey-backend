import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
    rules: {
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/no-floating-promises": "error",
    },
  },
  {
    ignores: ["dist/**", "node_modules/**", "drizzle.config.ts"],
  },
];
