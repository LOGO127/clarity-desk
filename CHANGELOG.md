# Changelog

All notable changes to Clarity Desk will be documented here.

## [Unreleased]

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
