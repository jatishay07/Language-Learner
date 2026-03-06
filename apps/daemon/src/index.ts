import { startDaemon } from './server.js';

startDaemon().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exitCode = 1;
});
