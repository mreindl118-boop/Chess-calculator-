// Copies the Stockfish lite NNUE builds from node_modules into public/engine/.
// The multi-threaded build is used when the page is crossOriginIsolated;
// the single-threaded build is the fallback. Filenames are content-hashed by
// upstream, so src/lib/engine/engineFiles.ts must match what is copied here.
import { copyFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(root, 'node_modules', 'stockfish', 'src');
const outDir = join(root, 'public', 'engine');

if (!existsSync(srcDir)) {
  console.error('stockfish package not installed; run npm install first');
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });

const wanted = readdirSync(srcDir).filter((f) => f.includes('-lite'));
if (wanted.length === 0) {
  console.error('no lite stockfish builds found in ' + srcDir);
  process.exit(1);
}
for (const f of wanted) {
  copyFileSync(join(srcDir, f), join(outDir, f));
}
console.log(`copied ${wanted.length} engine files to public/engine/`);
