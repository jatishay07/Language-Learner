import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PATH_BLOCK_START = '# >>> language-learner path >>>';
const PATH_BLOCK_END = '# <<< language-learner path <<<';
const FUNCTION_BLOCK_START = '# >>> language-learner function >>>';
const FUNCTION_BLOCK_END = '# <<< language-learner function <<<';

function upsertBlock(content: string, startMarker: string, endMarker: string, blockBody: string): string {
  const block = `${startMarker}\n${blockBody}\n${endMarker}`;
  const regex = new RegExp(`${escapeRegex(startMarker)}[\\s\\S]*?${escapeRegex(endMarker)}`, 'm');

  if (regex.test(content)) {
    return content.replace(regex, block);
  }

  const suffix = content.endsWith('\n') ? '' : '\n';
  return `${content}${suffix}\n${block}\n`;
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function ensureExecutable(filePath: string): void {
  fs.chmodSync(filePath, 0o755);
}

function installLanguageLearnScript(repoRoot: string): string {
  const binDir = path.join(os.homedir(), '.local', 'bin');
  fs.mkdirSync(binDir, { recursive: true });

  const target = path.join(binDir, 'language-learn');
  const script = `#!/usr/bin/env bash
set -euo pipefail
cd "${repoRoot}"
exec pnpm run learner:start "$@"
`;

  fs.writeFileSync(target, script, 'utf8');
  ensureExecutable(target);
  return target;
}

function updateZshRc(repoRoot: string): string {
  const zshrcPath = path.join(os.homedir(), '.zshrc');
  const existing = fs.existsSync(zshrcPath) ? fs.readFileSync(zshrcPath, 'utf8') : '';

  const pathBlock = 'export PATH="$HOME/.local/bin:$PATH"';
  const functionBlock = [
    'language() {',
    '  if [[ "${1:-}" == "learn" ]]; then',
    '    shift',
    '    language-learn "$@"',
    '    return $?',
    '  fi',
    '  echo "Usage: language learn" >&2',
    '  return 1',
    '}'
  ].join('\n');

  let next = upsertBlock(existing, PATH_BLOCK_START, PATH_BLOCK_END, pathBlock);
  next = upsertBlock(next, FUNCTION_BLOCK_START, FUNCTION_BLOCK_END, functionBlock);

  fs.writeFileSync(zshrcPath, next, 'utf8');
  return zshrcPath;
}

function main(): void {
  const repoRoot = process.cwd();
  const scriptPath = installLanguageLearnScript(repoRoot);
  const zshrcPath = updateZshRc(repoRoot);

  // eslint-disable-next-line no-console
  console.log('Installed shortcuts:');
  // eslint-disable-next-line no-console
  console.log(`- ${scriptPath}`);
  // eslint-disable-next-line no-console
  console.log(`- Updated ${zshrcPath} with language learn function and PATH export`);
  // eslint-disable-next-line no-console
  console.log('Open a new terminal tab or run: source ~/.zshrc');
}

main();
