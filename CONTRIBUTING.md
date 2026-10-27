# Contributing

Thanks for helping! GradeStudio is a small, focused project.

## Setup

```bash
npm install
npm run dev        # dev server
npm run typecheck  # TypeScript
npm run build      # production build
```

## Guidelines

- Keep everything local-first: no network calls with user photos, no accounts, no telemetry.
- No features that need a paid or hosted AI service. On-device models with open licenses are fine.
- All UI text is English. Match the style of the surrounding code.
- Only contribute code you wrote yourself or that has a compatible license (GPL-3.0). Do not copy code, assets or presets from proprietary software.
- Run `npm run typecheck` and `npm run build` before opening a pull request.

## Reporting bugs

Open an issue with your browser/OS, steps to reproduce and, if possible, a non-private sample photo.
