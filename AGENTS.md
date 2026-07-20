# Repository Guidelines

## Project Structure & Module Organization

WorkOnIt is a local desktop application built with React, TypeScript, Tauri, Rust, and SQLite. Frontend code lives in `src/`: place reusable UI in `src/components/`, shared models and repositories in `src/lib/`, translations in `src/locales/`, and test setup in `src/test/`. Rust application code is under `src-tauri/src/`; each domain concern has a focused module such as `domain.rs`, `storage.rs`, or `scheduler.rs`. Rust integration tests live in `src-tauri/tests/`. Product specifications and UI guidance belong in `docs/`; exploratory mockups belong in `design-explorations/`.

## Build, Test, and Development Commands

- `npm install` installs JavaScript dependencies.
- `npm run dev` starts the Vite web UI on `http://localhost:1420`.
- `npm run tauri dev` launches the full desktop application.
- `npm run typecheck` validates TypeScript without emitting files.
- `npm test` runs the Vitest suite once; `npm run test:watch` supports local iteration.
- `npm run coverage` verifies frontend coverage thresholds.
- `cargo test --manifest-path src-tauri/Cargo.toml` runs Rust unit and integration tests.
- `npm run build` type-checks and builds the frontend; `npm run tauri build -- --debug --no-bundle` validates desktop compilation.

## Coding Style & Naming Conventions

Use TypeScript strict mode, ES modules, two-space indentation, and Prettier-compatible formatting. Name React components and component files in `PascalCase`; use `camelCase` for functions and variables. Keep utilities and domain modules narrowly scoped. Rust follows standard `rustfmt` conventions: four-space indentation, `snake_case` modules/functions, and `PascalCase` types. Keep user-facing text in both `src/locales/en.json` and `src/locales/fr.json` rather than inline.

## Testing Guidelines

Vitest, jsdom, and Testing Library cover frontend behavior. Name colocated tests `*.test.ts` or `*.test.tsx`; favor user-visible interactions over implementation details. Frontend coverage requires 100% for branches, functions, lines, and statements. Name Rust integration tests after the feature module, for example `src-tauri/tests/storage.rs`. Add regression tests with every behavior change.

## Commit & Pull Request Guidelines

History follows Conventional Commits, primarily `feat:` and `docs:`; use concise, imperative subjects such as `fix: preserve scheduled task state`. Keep commits focused. Pull requests should explain behavior and rationale, list verification commands, link relevant issues or specifications, and include screenshots for UI changes. Test changed UI flows through the running application before requesting review.

## Security & Configuration

Never commit credentials, keychain values, local databases, or generated build artifacts. Treat `.workonit` imports and shell automation as trust boundaries; validate external input and avoid weakening existing safeguards.
