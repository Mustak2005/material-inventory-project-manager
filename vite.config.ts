import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

const sourceDirectory = fileURLToPath(new URL('./src', import.meta.url));

export default defineConfig({
  base: '/',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': sourceDirectory,
    },
  },
  server: {
    host: 'localhost',
    port: 5173,
    strictPort: false,
  },
  preview: {
    host: 'localhost',
    port: 4173,
    strictPort: false,
  },
});
