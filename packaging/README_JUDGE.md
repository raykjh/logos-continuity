# LOGOS Continuity — Judge Test Build

This package runs without npm, pnpm, a build step, or an OpenAI API key.

## Requirement

- Node.js 24 or newer: https://nodejs.org/

Node.js 24 is required because LOGOS uses the built-in `node:sqlite` state engine and native TypeScript execution.

## Start

### Windows

Double-click `start-windows.cmd`, or run:

```powershell
.\start-windows.ps1
```

### macOS or Linux

```bash
bash start.sh
```

The app opens at `http://127.0.0.1:4318`. The first launch creates local demo data in `data/logos.db`.

## Two-Minute-Fifty-Second Test Path

1. Click `심사 모드` (`Judge Mode`) in the top bar.
2. Follow the seven guided steps from Command Center to Assembled Context.
3. Use `데모 초기화` to restore the deterministic seeded state at any time.
4. Open `제출` to inspect the official requirement evidence and English submission copy.

The app defaults to `LOCAL SAFE MODE`, which demonstrates every approval and continuity invariant without network access. To test live GPT-5.6 classification, create `.env.local` beside this README:

```text
OPENAI_API_KEY=your_key_here
OPENAI_MODEL=gpt-5.6
```

## Data and Privacy

- All project state is stored locally in `data/logos.db`.
- API keys are read only from `.env.local` and are never written to SQLite or shown in the UI.
- Delete `data/logos.db` to return to a fresh local database.

## Stop

Close the launcher window or press `Ctrl+C`.

## Troubleshooting

- If port `4318` is occupied, set a different `PORT` environment variable before starting.
- If the browser does not open automatically, visit the URL printed by the launcher.
- If startup reports an old Node version, install Node.js 24 or newer and retry.
