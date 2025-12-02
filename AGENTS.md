# Repository Guidelines

## Project Structure & Module Organization
The repo follows Next.js 14’s `app/` router. `app/page.tsx` hosts the Rive preview UI, while `app/layout.tsx` wires fonts, metadata, and shared providers. UI building blocks (buttons, tabs, cards, inputs) live under `components/`, with Radix-inspired primitives in `components/ui/`. Shared helpers belong in `lib/` (e.g., formatting, telemetry) and configuration lives at the root (`next.config.mjs`, `next-sitemap.config.*`). Global styles, Tailwind tokens, and fonts reside in `app/globals.css` and `app/fonts/`. Keep new assets in `public/` or `app/` subfolders so Next can bundle them correctly.

## Build, Test, and Development Commands
- `npm run dev`: Starts the Next.js dev server with live reload; use when iterating on UI or Rive runtime logic.
- `npm run build`: Produces the production bundle and runs Next’s type/ESLint checks; ensures CI parity.
- `npm run start`: Serves the production build locally for smoke-testing.
- `npm run lint`: Executes `next lint` using the repo’s ESLint config.
- `npm run export`: Generates a static export if you need to host the preview without Node.js.

## Coding Style & Naming Conventions
Write TypeScript (`.ts`/`.tsx`) with 2-space indentation and favor functional React components. Keep hooks grouped at the top of components, use descriptive camelCase state/setter names (`useState`, `useRef`), and prefer explicit types over `any`. Tailwind classes should be kept ordered roughly by layout → spacing → color for readability. For new UI elements, extend existing Radix wrappers in `components/ui/` before inventing bespoke controls. Run `npm run lint` before pushing to catch style drift.

## Testing Guidelines
Automated tests are not yet configured. For now, rely on manual verification:
1. Run `npm run dev`, upload representative `.riv` files, and exercise animation/state-machine controls.
2. Resize the preview and test theme toggles to ensure layout hooks respond correctly.
3. If you add logic-heavy utilities in `lib/`, consider colocated Vitest/Jest tests and document the required command when introduced.

## Commit & Pull Request Guidelines
Commits should be small, imperative, and scoped (e.g., `feat: add state machine selector`, `fix: debounce canvas resize`). Reference issue IDs in the subject or body when applicable. For PRs, include:
1. A concise summary of the change and rationale.
2. Testing evidence (commands run, screenshots/GIFs of the preview where relevant).
3. Any follow-up TODOs or limitations so reviewers can triage work quickly.

## Security & Configuration Notes
Do not commit `.riv` files that contain proprietary artwork unless cleared for public sharing. Environment-specific analytics keys should stay in `.env.local` and be documented in the PR description without pasting secrets. When integrating new Rive capabilities, validate buffers before loading to avoid runtime crashes.
