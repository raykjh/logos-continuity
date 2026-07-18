# Devpost Submission Draft

## Project Name

LOGOS Continuity

## Tagline

Approval-gated, provenance-aware continuity for long-running AI work.

## Track

Work and Productivity

## Links

- Working project: <https://logos-continuity-judge.onrender.com/>
- Repository: <https://github.com/raykjh/logos-continuity>
- Public YouTube demo: `TBD_AFTER_RECORDING`
- Codex `/feedback` Session ID: `TBD_USER_ACTION`

## Suggested Gallery Images

1. `docs/assets/01-dashboard-gpt-live.png` — main dashboard and GPT-5.6 LIVE proof
2. `docs/assets/02-continuity-brief.png` — new-session recovery and verification boundaries
3. `docs/assets/03-conflict-resolution.png` — explicit conflict handling without silent overwrite

## Short Description

LOGOS Continuity helps people resume complex AI-assisted work across separate conversations without allowing uncertain memories, outdated state, or conflicting decisions to silently become canonical truth.

## Full Description

AI assistants are increasingly used for projects that span days, weeks, and many separate conversations. The problem is that ordinary conversational recall does not reliably distinguish current state from historical state, confirmed decisions from speculative ideas, or canonical facts from temporary exceptions. A new session can therefore resume confidently from the wrong version of reality.

LOGOS Continuity introduces an explicit continuity layer for long-running AI work. It identifies the intended project from natural language, assembles an authority-ordered Continuity Brief, and separates Project Truth, Current State, Next Actions, Exploration, and Active Checkpoint. GPT-5.6 performs structured project recognition and statement classification, but deterministic local rules prevent the model from directly changing canonical state.

When new information conflicts with existing truth, LOGOS does not silently overwrite it. The user chooses whether to keep the canonical decision, apply a temporary exception for the current work, or approve a new canonical decision. Every committed change records its before state, after state, reason, and provenance. Linked-project context remains reference-only until explicitly promoted, and provenance drift is detected if the original source later changes.

The public application includes a Continuity Command Center that ranks the most urgent risks across projects and a seven-step Judge Mode that demonstrates the entire workflow in under three minutes.

## Inspiration

LOGOS Continuity came from first-hand experience using AI as a serious work partner across software development, product planning, research, and operations. The most damaging failure was not forgetting a detail. It was remembering something with the wrong authority: treating an old state as current, a possibility as a decision, or an unverified claim as completed work.

## What It Does

- recognizes the intended project with High, Medium, or Low confidence;
- restores a Continuity Brief in a new session;
- keeps canonical truth separate from current state and exploration;
- requires approval before canonical changes;
- exposes conflicts as explicit human decisions;
- maintains interruption checkpoints without treating them as truth;
- records immutable history and provenance;
- ranks portfolio continuity risks;
- assembles a safe, authority-ordered handoff for the next session.

## How We Built It

The application uses React, TypeScript, Vite, Node.js 24, and the built-in SQLite engine. GPT-5.6 is called through the OpenAI Responses API for project recognition and safe structured classification. A deterministic domain service enforces approval gates, verification states, conflict handling, project structure, archive rules, provenance promotion, drift detection, and context authority.

The app is packaged with Docker and deployed on Render. A separate portable judge build runs without npm, pnpm, a build step, or an API key.

## How We Used Codex

Codex accelerated schema and state-machine design, API and UI implementation, GPT-5.6 integration, automated safety tests, browser QA, Docker deployment, portable packaging, and submission tooling. The collaboration was iterative: the human defined the product problem, safety principles, conflict semantics, track, priorities, and demo narrative; Codex implemented and validated those decisions, surfaced defects, and proposed focused fixes.

One concrete example occurred during the public Judge Mode rehearsal. Codex detected that the guide panel covered a modal action button at a common recording viewport, traced the issue to stacking order, implemented a minimal CSS fix, ran all tests and the production build, deployed it, and verified the corrected public UI.

## How We Used GPT-5.6

GPT-5.6 has a meaningful runtime role. It identifies the intended project from a natural-language request and classifies new statements into structured destinations such as Exploration, Truth proposal, Current State proposal, or Next Action proposal. The model also returns confidence and rationale. All outputs remain advisory: local deterministic rules and explicit human approval control canonical commits.

## Challenges

- designing a useful memory system without allowing uncertain model output to become truth;
- separating authority, verification, and operational state without overwhelming the user;
- handling conflicts without forcing an automatic winner;
- demonstrating a complex continuity model clearly in less than three minutes;
- providing a live GPT path and a reproducible safe fallback.

## Accomplishments

- built a complete public product experience rather than a static prototype;
- implemented approval-gated canonical transactions and three-way conflict resolution;
- created provenance-aware context promotion and drift monitoring;
- added a portfolio-level continuity risk Command Center;
- built a seven-step 2:50 Judge Mode;
- passed 54 automated tests and a full public browser rehearsal.

## What We Learned

Reliable AI continuity is not primarily a retrieval problem. It is an authority problem. The system must know which information is canonical, which information is current, which information is speculative, and which changes require a human decision. GPT-5.6 is most valuable when it helps interpret intent and structure information while deterministic rules protect the state boundary.

## What's Next

- durable multi-user storage and authentication;
- long-term history compression;
- deeper integration with AI workspaces and project tools;
- user studies measuring recovery accuracy and time saved;
- cross-model continuity while preserving the same authority rules.

## Testing Instructions

1. Open <https://logos-continuity-judge.onrender.com/>.
2. Wait for the free instance to wake if necessary.
3. Click **데모 초기화** to restore deterministic sample data.
4. Confirm the **GPT-5.6 LIVE** badge.
5. Click **심사 모드** and follow the seven guided steps.
6. In New Session, use `LOGOS 해커톤 작업 이어가자`.
7. Review the Continuity Brief, safe classification, Conflict Resolution Center, History, and Assembled Context.

No account, payment, or API key is required for judges.

## Built With

Codex, GPT-5.6, OpenAI Responses API, React, TypeScript, Vite, Node.js 24, SQLite, Docker, Render
