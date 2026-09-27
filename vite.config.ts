import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  // 拡張機能ではページを chrome-extension://<id>/ から相対パスで読む
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome138',
    // 拡張機能のCSPはインラインスクリプトを許さないため、モジュールプリロードの注入を無効化
    modulePreload: false,
    rollupOptions: {
      input: {
        kose: resolve(import.meta.dirname, 'kose.html'),
        options: resolve(import.meta.dirname, 'options.html'),
        background: resolve(import.meta.dirname, 'src/background/index.ts'),
      },
      output: {
        // manifest から固定名で参照するため
        entryFileNames: (chunk) => (chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js'),
      },
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['tests/setup.ts'],
  },
});
