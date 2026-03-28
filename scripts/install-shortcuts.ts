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

function installHangulScript(repoRoot: string): string {
  const binDir = path.join(os.homedir(), '.local', 'bin');
  fs.mkdirSync(binDir, { recursive: true });

  const target = path.join(binDir, 'hangul');
  const runtimeRoot = path.join(os.homedir(), 'Library', 'Application Support', 'LanguageLearner', 'runtime');
  const nodeBin = process.execPath;

  const script = `#!/usr/bin/env bash
# Launched by typing (hangul) in the terminal.
# Always restarts the daemon so the latest code is used, then opens the browser.
set -euo pipefail

DAEMON_PORT=4317
RUNTIME_ROOT="${runtimeRoot}"
REPO_ROOT="${repoRoot}"
NODE_BIN="${nodeBin}"

# Kill any existing process on the daemon port (ensures fresh code on every launch)
EXISTING_PID=$(lsof -nP -iTCP:\${DAEMON_PORT} -sTCP:LISTEN 2>/dev/null | awk 'NR>1 {print $2}' | head -1)
if [[ -n "\${EXISTING_PID:-}" ]]; then
  kill "\$EXISTING_PID" 2>/dev/null || true
  sleep 1
fi

# Seed data
mkdir -p "$RUNTIME_ROOT/data/seed/ko"
if [[ ! -f "$RUNTIME_ROOT/data/seed/ko/starter_deck.json" ]]; then
  cp "$REPO_ROOT/data/seed/ko/starter_deck.json" "$RUNTIME_ROOT/data/seed/ko/starter_deck.json"
fi

# Start daemon fresh
export LEARNER_ROOT="$RUNTIME_ROOT"
cd "$REPO_ROOT"
nohup "$NODE_BIN" --import tsx apps/daemon/src/index.ts \\
  > "$RUNTIME_ROOT/daemon.log" 2>&1 &

echo "⏳  Starting Korean tutor…"
for i in 1 2 3 4 5; do
  sleep 1
  lsof -nP -iTCP:\${DAEMON_PORT} -sTCP:LISTEN >/dev/null 2>&1 && break
done

echo "🇰🇷  Opening http://127.0.0.1:\${DAEMON_PORT}"
open "http://127.0.0.1:\${DAEMON_PORT}"
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
  const learnScript = installLanguageLearnScript(repoRoot);
  const hangulScript = installHangulScript(repoRoot);
  const zshrcPath = updateZshRc(repoRoot);

  // eslint-disable-next-line no-console
  console.log('Installed shortcuts:');
  // eslint-disable-next-line no-console
  console.log(`- ${learnScript}  (language learn → Ink terminal tutor)`);
  // eslint-disable-next-line no-console
  console.log(`- ${hangulScript}  (hangul / (hangul) → web UI in browser)`);
  // eslint-disable-next-line no-console
  console.log(`- Updated ${zshrcPath}`);
  // eslint-disable-next-line no-console
  console.log('');
  // eslint-disable-next-line no-console
  console.log('Run: source ~/.zshrc');
  // eslint-disable-next-line no-console
  console.log('Then type (hangul) in any terminal to open the Korean tutor.');
}

main();
