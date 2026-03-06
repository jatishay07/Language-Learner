# Language Learner

Local-only Korean trainer with a strict daily gate, browser immersion extension, and shared local daemon.

## Stack
- TypeScript + Node.js
- CLI dashboard: Ink
- Daemon API: Fastify (`http://127.0.0.1:4317`)
- Storage: SQLite (`better-sqlite3`) + JSON export mirror
- Extension: Chrome Manifest V3

## Install
```bash
corepack enable
corepack prepare pnpm@10.20.0 --activate
pnpm install
pnpm approve-builds
```
Select and approve `better-sqlite3` and `esbuild` when prompted.

## Commands
```bash
pnpm learner:start
pnpm learner:status
pnpm learner:daemon
pnpm learner:reminders:install
pnpm learner:export
pnpm learner:docs:sync
pnpm learner:import --file ./my_vocab.csv
```

## Chrome Extension (Local)
1. Start daemon: `pnpm learner:daemon`
2. Open Chrome `chrome://extensions`
3. Enable Developer Mode
4. Click **Load unpacked**
5. Select `/Users/Atishay/Documents/GitHub/LandingPage/Language-Learner/apps/extension-chrome`

The extension defaults to immersion mode enabled on all sites.

## Data + Docs
- DB: `data/learner.db`
- JSON snapshots: `data/exports/`
- Starter deck: `data/seed/ko/starter_deck.json` (300 items)
- Handbook: `docs/handbook/`

## Test
```bash
pnpm typecheck
pnpm test
```
