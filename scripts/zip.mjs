// Chrome ウェブストアに提出する zip を作る（npm run zip）。dist/ をビルドしてから release/kose-<version>.zip に固める。
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dist = resolve(root, 'dist');
const { version } = JSON.parse(readFileSync(resolve(dist, 'manifest.json'), 'utf8'));
const outDir = resolve(root, 'release');
const out = resolve(outDir, `kose-${version}.zip`);

mkdirSync(outDir, { recursive: true });
if (existsSync(out)) rmSync(out);
// -X: 余計なファイル属性を含めない。manifest.json が zip の最上位に来るよう dist/ の中から固める
execFileSync('zip', ['-r', '-X', '-q', out, '.'], { cwd: dist, stdio: 'inherit' });
console.log(`created ${out}`);
