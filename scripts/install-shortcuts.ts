import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PATH_BLOCK_START = '# >>> language-learner path >>>';
const PATH_BLOCK_END = '# <<< language-learner path <<<';
const FUNCTION_BLOCK_START = '# >>> language-learner function >>>';
const FUNCTION_BLOCK_END = '# <<< language-learner function <<<';
const HANGUL_BLOCK_START = '# >>> language-learner hangul-hook >>>';
const HANGUL_BLOCK_END = '# <<< language-learner hangul-hook <<<';

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
  const runtimeRoot = path.join(os.homedir(), 'Library', 'Application Support', 'LanguageLearner', 'runtime');
  const nodeBin = process.execPath;
  const script = `#!/usr/bin/env bash
set -euo pipefail
RUNTIME_ROOT="${runtimeRoot}"
mkdir -p "$RUNTIME_ROOT/data/seed/ko"
if [[ ! -f "$RUNTIME_ROOT/data/seed/ko/starter_deck.json" ]]; then
  cp "${repoRoot}/data/seed/ko/starter_deck.json" "$RUNTIME_ROOT/data/seed/ko/starter_deck.json"
fi
export LEARNER_ROOT="$RUNTIME_ROOT"
cd "${repoRoot}"
exec "${nodeBin}" --import tsx apps/cli/src/index.ts start "$@"
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

  // Hangul command_not_found_handler: typing any Korean text and pressing Enter
  // auto-launches the language tutor instead of showing "command not found".
  const hangulBlock = [
    '# Typing Hangul in the terminal launches the Korean tutor automatically.',
    'command_not_found_handler() {',
    '  local _cmd="$1"',
    '  # Detect Korean Hangul syllables (U+AC00–U+D7A3) or jamo (U+1100–U+11FF, U+3130–U+318F)',
    '  if python3 - "$_cmd" <<\'PYEOF\' 2>/dev/null',
    'import sys',
    's = sys.argv[1]',
    'hangul = any(',
    '    0xAC00 <= ord(c) <= 0xD7A3 or',
    '    0x1100 <= ord(c) <= 0x11FF or',
    '    0x3130 <= ord(c) <= 0x318F',
    '    for c in s',
    ')',
    'sys.exit(0 if hangul else 1)',
    'PYEOF',
    '  then',
    '    language-learn',
    '    return 0',
    '  fi',
    '  printf "zsh: command not found: %s\\n" "$_cmd" >&2',
    '  return 127',
    '}'
  ].join('\n');

  let next = upsertBlock(existing, PATH_BLOCK_START, PATH_BLOCK_END, pathBlock);
  next = upsertBlock(next, FUNCTION_BLOCK_START, FUNCTION_BLOCK_END, functionBlock);
  next = upsertBlock(next, HANGUL_BLOCK_START, HANGUL_BLOCK_END, hangulBlock);

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
