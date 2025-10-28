import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';

export default defineConfig(({ mode }) => ({
  base: mode === 'production' ? '/teaching-games/' : '/',
  plugins: [react(), tailwind()],
}));
