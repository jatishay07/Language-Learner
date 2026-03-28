import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';

const LABEL = 'com.languagelearner.chrome-daemon-bridge';
const APP_SUPPORT_DIR = path.join(os.homedir(), 'Library', 'Application Support', 'LanguageLearner');
const RUNTIME_DIR = path.join(APP_SUPPORT_DIR, 'runtime');

function renderPlist(repoRoot: string, runtimeBridgeScript: string, nodeBin: string): string {
  const outLog = path.join(RUNTIME_DIR, 'chrome-bridge-launchd.out.log');
  const errLog = path.join(RUNTIME_DIR, 'chrome-bridge-launchd.err.log');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${runtimeBridgeScript}</string>
    <string>${repoRoot}</string>
    <string>${RUNTIME_DIR}</string>
    <string>${nodeBin}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${APP_SUPPORT_DIR}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${outLog}</string>
  <key>StandardErrorPath</key>
  <string>${errLog}</string>
</dict>
</plist>
`;
}

function installChromeAutostart(repoRoot: string): string {
  const nodeBin = process.execPath;
  fs.mkdirSync(APP_SUPPORT_DIR, { recursive: true });
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  fs.mkdirSync(path.join(RUNTIME_DIR, 'data', 'seed', 'ko'), { recursive: true });

  const sourceSeed = path.join(repoRoot, 'data', 'seed', 'ko', 'starter_deck.json');
  const runtimeSeed = path.join(RUNTIME_DIR, 'data', 'seed', 'ko', 'starter_deck.json');
  fs.copyFileSync(sourceSeed, runtimeSeed);

  const sourceBridgeScript = path.join(repoRoot, 'scripts', 'chrome-daemon-bridge.sh');
  const runtimeBridgeScript = path.join(APP_SUPPORT_DIR, 'chrome-daemon-bridge.sh');
  fs.copyFileSync(sourceBridgeScript, runtimeBridgeScript);
  fs.chmodSync(runtimeBridgeScript, 0o755);

  const launchAgentsDir = path.join(os.homedir(), 'Library', 'LaunchAgents');
  fs.mkdirSync(launchAgentsDir, { recursive: true });

  const plistPath = path.join(launchAgentsDir, `${LABEL}.plist`);
  fs.writeFileSync(plistPath, renderPlist(repoRoot, runtimeBridgeScript, nodeBin), 'utf8');

  try {
    execSync(`launchctl unload ${plistPath}`, { stdio: 'ignore' });
  } catch {
    // no-op
  }

  execSync(`launchctl load ${plistPath}`, { stdio: 'ignore' });
  return plistPath;
}

function main(): void {
  const repoRoot = process.cwd();
  const plistPath = installChromeAutostart(repoRoot);

  // eslint-disable-next-line no-console
  console.log('Installed Chrome-triggered daemon bridge:');
  // eslint-disable-next-line no-console
  console.log(`- ${plistPath}`);
  // eslint-disable-next-line no-console
  console.log('Behavior: daemon starts when Chrome is running and is stopped when Chrome closes.');
}

main();
