import path from 'node:path';
import { program } from 'commander';
import React from 'react';
import { render } from 'ink';
import Dashboard from './dashboard.js';
import { LearnerEngine } from '../../../packages/core/src/index.js';
import { startDaemon } from '../../daemon/src/server.js';

async function withEngine<T>(fn: (engine: LearnerEngine) => Promise<T> | T): Promise<T> {
  const engine = new LearnerEngine();
  try {
    return await fn(engine);
  } finally {
    engine.close();
  }
}

program.name('learner').description('Local Korean Trainer CLI');

program
  .command('start')
  .description('Start or continue today\'s strict-gate session')
  .action(async () => {
    const engine = new LearnerEngine();
    const instance = render(React.createElement(Dashboard, { engine }));

    try {
      await instance.waitUntilExit();
    } finally {
      engine.close();
    }
  });

program
  .command('status')
  .description('Show today status: required, completed, debt, streak, rank')
  .action(async () => {
    await withEngine((engine) => {
      const status = engine.getTodayStatus();
      // eslint-disable-next-line no-console
      console.log([
        `Date: ${status.date}`,
        `Required: ${status.requiredSeconds}s`,
        `Completed: ${status.completedSeconds}s`,
        `Debt: ${status.debtSeconds}s`,
        `Streak: ${status.streak}`,
        `Rank: ${status.rank}`
      ].join('\n'));
    });
  });

program
  .command('daemon')
  .description('Run the local daemon API')
  .action(async () => {
    await startDaemon();
  });

program
  .command('export')
  .description('Export JSON mirror snapshot of local learner data')
  .action(async () => {
    await withEngine((engine) => {
      const file = engine.exportData();
      // eslint-disable-next-line no-console
      console.log(`Exported snapshot: ${file}`);
    });
  });

program
  .command('docs:sync')
  .description('Regenerate handbook markdown files')
  .action(async () => {
    await withEngine((engine) => {
      const result = engine.syncDocs({ trigger: 'manual_sync' });
      // eslint-disable-next-line no-console
      console.log(`Updated ${result.updatedFiles.length} handbook files.`);
      for (const file of result.updatedFiles) {
        // eslint-disable-next-line no-console
        console.log(`- ${file}`);
      }
    });
  });

program
  .command('import')
  .description('Import custom vocabulary from CSV: surface,meaning,exampleKo')
  .requiredOption('-f, --file <path>', 'Path to CSV file')
  .action(async (options: { file: string }) => {
    await withEngine((engine) => {
      const filePath = path.resolve(options.file);
      const result = engine.importCsv(filePath);
      // eslint-disable-next-line no-console
      console.log(`Import complete. Imported=${result.imported}, Skipped=${result.skipped}`);
    });
  });

program.parseAsync(process.argv).catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exitCode = 1;
});
