import { defineConfig } from "vite-plus";

export default defineConfig({
  fmt: {},
  lint: {
    ignorePatterns: ["demos/pikafish-agent/.next/**", "demos/pikafish-agent/out/**"],
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
    overrides: [
      {
        // Next.js files do not use Vite imports.
        files: ["demos/pikafish-agent/**"],
        rules: { "vite-plus/prefer-vite-plus-imports": "off" },
      },
    ],
  },
  run: {
    cache: true,
  },
});
