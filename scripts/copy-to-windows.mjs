// dist/ を Windows 側へコピーする（Windows版Chromeで Load unpacked するため）。
// コピー先: 環境変数 KOSE_WIN_DIR、未指定なら %USERPROFILE%\kose-dist
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

function windowsHomeDir() {
  // Windows の PATH を引き継がない WSL 設定でも動くよう、フルパスも試す
  for (const cmd of ['cmd.exe', '/mnt/c/Windows/System32/cmd.exe']) {
    try {
      const profile = execFileSync(cmd, ['/c', 'echo %USERPROFILE%'], {
        encoding: 'utf8',
        cwd: '/mnt/c',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      return execFileSync('wslpath', ['-u', profile], { encoding: 'utf8' }).trim();
    } catch {
      // 次の候補へ
    }
  }
  return null;
}

const src = resolve(import.meta.dirname, '..', 'dist');
if (!existsSync(join(src, 'manifest.json'))) {
  console.error('dist/manifest.json がありません。先に npm run build を実行してください。');
  process.exit(1);
}

const home = process.env.KOSE_WIN_DIR ? null : windowsHomeDir();
const dest = process.env.KOSE_WIN_DIR ?? (home && join(home, 'kose-dist'));
if (!dest) {
  console.error('Windows側のコピー先を決められませんでした。KOSE_WIN_DIR=/mnt/c/Users/<you>/kose-dist のように指定してください。');
  process.exit(1);
}

rmSync(dest, { recursive: true, force: true });
cpSync(src, dest, { recursive: true });
console.log(`copied: ${src} -> ${dest}`);
