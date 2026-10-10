import { defineConfig } from 'vite'

// Workaround: lightningcss minify crashes on the nested rules produced by
// UnoCSS's `--uno:` expansion inside @slidev/client/styles/code.css.
export default defineConfig({
  build: {
    cssMinify: false,
  },
})