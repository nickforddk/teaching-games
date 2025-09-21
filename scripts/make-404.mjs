import { copyFileSync, existsSync } from 'fs';

if (!existsSync('dist/index.html')) {
  console.error('dist/index.html not found (build may have failed)');
  process.exit(1);
}

try {
  copyFileSync('dist/index.html', 'dist/404.html');
  console.log('Created dist/404.html for SPA fallback.');
} catch (e) {
  console.error('Failed to create 404.html:', e);
  process.exit(1);
}