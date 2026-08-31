# Contributing

Thank you for helping improve Clarity Desk.

## Setup

```bash
npm ci
npm run dev
```

Before opening a pull request:

```bash
npm test
npm run typecheck
npm run build
```

## Pull requests

- Keep changes focused and explain the user-facing problem.
- Add tests for parser, storage, or transcript-merging behavior.
- Do not commit recordings, transcripts, API keys, tokens, `.env` files, or screenshots containing personal data.
- Preserve the non-overlay design: do not introduce always-on-top windows or meeting-screen overlays without prior discussion.
- New IPC handlers must validate inputs and must not expose a generic shell or arbitrary filesystem access.
- UI changes should work at the minimum supported window size (980 × 680) and with reduced-motion preferences.

## Commit style

Short imperative commits are preferred, for example:

```text
fix: recover interrupted audio fragments
feat: export renamed speaker labels
docs: clarify Feishu authentication
```

## Test data

Use synthetic audio and invented transcripts. Never upload a real interview recording to an issue or pull request.
