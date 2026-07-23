import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const svgPath = join(root, 'public', 'icon.svg');

if (!existsSync(svgPath)) {
  console.warn('generate-pwa-icons: icon.svg not found, skipping');
  process.exit(0);
}

const sizes = [
  { file: 'pwa-192x192.png', size: 192 },
  { file: 'pwa-512x512.png', size: 512 },
  { file: 'apple-touch-icon.png', size: 180 },
];

for (const { file, size } of sizes) {
  const out = join(root, 'public', file);
  execSync(`rsvg-convert -w ${size} -h ${size} "${svgPath}" -o "${out}"`, {
    stdio: 'inherit',
  });
  console.log(`Wrote ${file} (${size}x${size})`);
}
