# Codex Instruction — Apply Recommended Video Script V2

## Purpose

Preserve the existing recording materials as historical V1 references, then review and apply the recommended V2 script to the final recording assets.

## Source files

- Existing V1 guide: `docs/JUDGE_DEMO_SCRIPT.md`
- Existing V1 subtitles: `docs/DEMO_SUBTITLES_EN.srt`
- Recommended V2 guide: `docs/JUDGE_DEMO_SCRIPT_V2_RECOMMENDED.md`
- Recommended V2 subtitles: `docs/DEMO_SUBTITLES_EN_V2_RECOMMENDED.srt`

## Required approach

1. Do not delete the V1 files.
2. Compare V2 against the current Judge Mode interaction order and the live public app.
3. Preserve the actual click order if changing it would add recording risk.
4. Apply V2 wording and timing to the final active assets only after verifying each screen can be reached within the assigned interval.
5. Target approximately `02:35` of planned content and keep at least 20 seconds of safety margin below the three-minute limit.
6. Do not add new product features or extra demo stops.

## Intended improvements

- Open with the distinction between remembering a conversation and knowing the current confirmed truth.
- Reduce the early Codex feature list.
- Shorten Command Center narration.
- Reach New Session Recovery earlier.
- Preserve Safe GPT-5.6 Routing and Conflict Resolution as the two central proof points.
- Simplify History and Provenance narration.
- End with the concrete benefit: verified project state and the correct next action.

## Validation before replacement

Perform one complete no-recording rehearsal against the public deployment.

Verify:

- `GPT-5.6 LIVE` is visible.
- Demo reset works.
- Judge Mode order matches the script.
- Project recognition returns successfully.
- Statement classification returns successfully.
- Conflict choices are visible.
- History/provenance evidence is visible.
- Assembled Context opens correctly.
- Browser console has no warnings or errors.
- Total run remains comfortably below three minutes.

## Final file policy

If the rehearsal succeeds without timing or screen mismatch:

- replace the contents of `docs/JUDGE_DEMO_SCRIPT.md` with the approved V2 content;
- replace the contents of `docs/DEMO_SUBTITLES_EN.srt` with the retimed V2 subtitle content;
- retain the two `*_V2_RECOMMENDED*` source files for evidence;
- update `docs/DEMO_RECORDING_CHECKLIST.md` so it points to the approved final script and subtitles;
- update README references only if filenames or instructions become inaccurate.

If the rehearsal reveals a mismatch, do not force V2. Report the exact screen, timing, or wording conflict and make the smallest safe adjustment.

## Required Codex report

Before editing, report:

1. Whether the current Judge Mode click order supports V2 unchanged.
2. Any timing risk by section.
3. Exact files to modify.

After editing, report:

1. Files changed.
2. Final planned runtime.
3. Rehearsal runtime.
4. Public deployment checks.
5. Test/build results if source files were changed.
6. Whether the recording package is ready.
