# Master Plan

## Scope
- Local-only Korean trainer CLI with strict daily gate.
- Local daemon API shared by CLI and Chrome extension.
- Chrome extension for all-site Korean reading immersion with lookup/save.
- SQLite primary storage with JSON mirror exports.
- Auto-updated handbook to guide iteration.

## Locked Product Rules
- Daily target: 1800 active seconds.
- Debt carryover cap: 5400 seconds.
- Session mix: 70% review, 20% new, 10% sentence drills.
- Mixed progression: choice early, typed recall later.
- Korean-only content in v1; language-neutral internals for future expansion.

## Interfaces
- CLI: start, status, daemon, reminders install, export, docs sync, import.
- Daemon: health, status, session start/attempt, vocab save/lookup, sentence translation, docs sync.
