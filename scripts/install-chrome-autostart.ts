import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';

const LABEL = 'com.languagelearner.chrome-daemon-bridge';

function renderPlist(repoRoot: string): string {
  const bridgeScript = path.join(repoRoot, 'scripts', 'chrome-daemon-bridge.sh');
  const outLog = path.join(repoRoot, 'data', 'chrome-bridge-launchd.out.log');
  const errLog = path.join(repoRoot, 'data', 'chrome-bridge-launchd.err.log');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>${bridgeScript}</string>
    <string>${repoRoot}</string>
  </array>
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
  const launchAgentsDir = path.join(os.homedir(), 'Library', 'LaunchAgents');
  fs.mkdirSync(launchAgentsDir, { recursive: true });
  fs.mkdirSync(path.join(repoRoot, 'data'), { recursive: true });

  const plistPath = path.join(launchAgentsDir, `${LABEL}.plist`);
  fs.writeFileSync(plistPath, renderPlist(repoRoot), 'utf8');

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
