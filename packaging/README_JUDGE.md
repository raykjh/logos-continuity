# LOGOS Continuity — Portable Judge Build

This package runs without npm, pnpm, a build step, or an OpenAI API key.

## Requirement

- Node.js 24 or newer: <https://nodejs.org/>

Node.js 24 is required for the built-in `node:sqlite` state engine and native TypeScript execution.

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

Open <http://127.0.0.1:4318>. The first launch creates deterministic local demo data in `data/logos.db`.

## Judge Path

1. Click **심사 모드** (`Judge Mode`).
2. Follow the seven guided steps from Command Center to Assembled Context.
3. Click **데모 초기화** (`Reset Demo`) at any time to restore the seeded state.
4. Open **제출** (`Submission`) to inspect requirement evidence and English submission copy.

The package defaults to **LOCAL SAFE MODE**, which demonstrates every approval and continuity invariant without network access.

To test live GPT-5.6 classification, create `.env.local` beside this README:

```text
OPENAI_API_KEY=your_key_here
OPENAI_MODEL=gpt-5.6
```

## Data and Privacy

- All project state is stored locally in `data/logos.db`.
- API keys are read only from `.env.local`.
- API keys are never written to SQLite or displayed in the UI.
- Delete `data/logos.db` to restore a fresh local database.

## Stop

Close the launcher window or press `Ctrl+C`.
