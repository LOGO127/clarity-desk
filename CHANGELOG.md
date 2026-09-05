# Changelog

All notable changes to Clarity Desk will be documented here.

## [Unreleased]

Planned v0.3.0. Not released: real Feishu API/button and exported-PDF acceptance passed on a synthetic document; browser visuals and user-pasted examples remain pending.

### Changed

- Open directly into a compact Feishu formula tool; simplified recording setup and 960 × 700 default window.
- Load Markdown/KaTeX, recording, session archive, and settings only when used; minify production renderer output.
- Remove duplicate renderer libraries from runtime dependencies; retain only Chinese and English Chromium locales.
- Require visible source checks before minimizing an active recording; report measured sound activity.
- Refresh maintenance documentation and issue/PR templates; group only minor/patch dependency updates so major upgrades remain independently reviewable.
- Update GitHub Actions to v7 and retain only synthetic desktop screenshots as short-lived CI artifacts.

### Fixed

- Block external renderer navigation and new windows; validate the owning top frame for every privileged IPC call.
- Drain all recording writes before cleanup, retain fatal failures during rotation/stop, and check required tracks for every segment.
- Preserve failed status during audio recovery and support retrying interrupted chunk finalization.
- Report partial Feishu changes with submitted and read-back counts after batch failures.
- Stop sending the invalid style-only `update_text` request for legacy Equation(16) blocks; report unsupported formulas explicitly instead of promising complete coverage.
- Require complete formula read-back confirmation and do not report a no-match document as successfully centered.
- Save transcription checkpoints after each completed chunk and retain all reusable progress on retries.
- Reject empty/malformed transcription responses; qualify speaker labels across independent audio chunks.
- Lock navigation before waiting for recording permissions and unlock after failed/cancelled startup.
- Acquire single-instance ownership before recovering recordings; repeated launches only show the existing window, preserving active partial files.
- Isolate packaged smoke startup recovery as well as configuration, preventing test launches from scanning real recordings.

### Verification

- Automated tests, TypeScript, source Electron smoke, and packaged Electron smoke are release checks.
- Local maintenance validation on 2026-09-05 passed 55 unit tests, TypeScript/build, source smoke, Windows packaging and packaged smoke; the official npm advisory endpoint reported 0 known vulnerabilities. These results do not replace untested hardware, installation/uninstallation, paid transcription or Feishu-browser acceptance.
- Source smoke uses synthetic audio in an isolated directory; no real interview recordings or paid transcription calls are used.
- Regression smoke covers delayed/cancelled microphone permission, a successful restart, and repeated app launch while a recording is active.
- Authorized synthetic Feishu docx live acceptance passed: 3 formula alignments changed, 1 retained, no content changes, and no updates on a second button click. Feishu-exported PDF layout passed; browser rendering remains pending login. See `docs/FEISHU-ACCEPTANCE-20260905.md`.
- Size measurements and their limits are documented in `docs/LIGHTWEIGHT.md`.

## [0.2.0] - 2026-09-05

### Added

- One-click centering for standalone formulas in existing Feishu docx/wiki documents.
- Style-only batch updates with a post-update read-back verification summary.
- Formula-block safeguards that skip paragraphs containing normal inline text.

### Changed

- Made existing-document formula centering the primary formula workflow.
- Kept Markdown-to-Feishu conversion as an optional secondary workflow.
- Reworked the product copy and README around the corrected formula-centering requirement.

### Fixed

- Corrected Windows `cmd` quoting so global `lark-cli` installations work when the user profile path contains spaces.

## [0.1.0] - 2026-08-31

### Added

- Feishu-oriented Markdown and formula conversion with live KaTeX preview.
- Optional `lark-cli` create, append, and overwrite workflows.
- Three-track Windows interview recording with automatic minimization.
- Append-to-disk audio fragments, ten-minute rotation, and interrupted-session recovery.
- Local session archive and OpenAI speaker-diarized transcription.
- Encrypted API-key storage, tray controls, and privacy-first defaults.
