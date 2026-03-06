import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';

export interface ReminderSpec {
  label: string;
  hour: number;
  minute: number;
}

export const DEFAULT_REMINDERS: ReminderSpec[] = [
  { label: 'com.languagelearner.reminder.1900', hour: 19, minute: 0 },
  { label: 'com.languagelearner.reminder.2230', hour: 22, minute: 30 }
];

export function renderPlist(spec: ReminderSpec, rootDir: string): string {
  const message = 'Daily Korean gate pending. Run pnpm learner:start now.';
  const title = 'Language Learner';

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${spec.label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/osascript</string>
    <string>-e</string>
    <string>display notification "${message}" with title "${title}" subtitle "${rootDir}"</string>
  </array>
  <key>RunAtLoad</key>
  <false/>
  <key>StandardErrorPath</key>
  <string>${rootDir}/data/reminder-${spec.hour}${String(spec.minute).padStart(2, '0')}.err.log</string>
  <key>StandardOutPath</key>
  <string>${rootDir}/data/reminder-${spec.hour}${String(spec.minute).padStart(2, '0')}.out.log</string>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>${spec.hour}</integer>
    <key>Minute</key>
    <integer>${spec.minute}</integer>
  </dict>
</dict>
</plist>
`;
}

export function installReminders(rootDir = process.cwd()): string[] {
  const launchAgentsDir = path.join(os.homedir(), 'Library', 'LaunchAgents');
  fs.mkdirSync(launchAgentsDir, { recursive: true });

  const created: string[] = [];

  for (const spec of DEFAULT_REMINDERS) {
    const filePath = path.join(launchAgentsDir, `${spec.label}.plist`);
    const content = renderPlist(spec, rootDir);
    fs.writeFileSync(filePath, content, 'utf8');

    try {
      execSync(`launchctl unload ${filePath}`, { stdio: 'ignore' });
    } catch {
      // no-op: unload can fail if job is not loaded yet
    }

    execSync(`launchctl load ${filePath}`, { stdio: 'ignore' });
    created.push(filePath);
  }

  return created;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const files = installReminders(process.cwd());
  // eslint-disable-next-line no-console
  console.log('Installed reminder jobs:');
  for (const file of files) {
    // eslint-disable-next-line no-console
    console.log(`- ${file}`);
  }
}
