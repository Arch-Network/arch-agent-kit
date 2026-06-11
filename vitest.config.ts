import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Inline (empty) PostCSS config so Vite doesn't walk up past the repo and
  // pick up an unrelated postcss.config.js from the user's home directory.
  css: { postcss: {} },
  test: {
    include: ['test/**/*.test.ts'],
  },
});
