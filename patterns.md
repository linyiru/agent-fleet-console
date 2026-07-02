# Implementation Patterns

Use these patterns when changing Fleet. The goal is a small, predictable operator tool that stays safe to publish as open source.

## General Rules

- Keep source files focused and under 250 lines.
- Prefer explicit inputs and small modules over broad shared helpers.
- Keep side effects at the edges: setup scripts, route handlers, services, and wrapper scripts.
- Use structured parsing and validation instead of ad hoc string handling when the repo has a helper for it.
- Do not commit runtime state, generated secrets, logs, local databases, or local Hermes checkouts.

## Frontend

- `src/views/` owns app-specific screens and panels.
- `src/controllers/` owns API helpers, formatting helpers, and state hooks.
- `src/models/` owns shared frontend types.
- `src/components/ui/` stays generic and must not import app models or API helpers.
- Use `useFleetConsole` for top-level fleet state. Add focused hooks for complex local workflows, as `useChatPanel` does.
- Keep UI controls explicit: loading states, disabled states, error messages, `aria-label`/`title` for icon-only buttons, and no hidden destructive actions.
- Split CSS by surface under `src/styles/`, then import those files from `src/styles.css`.
- Use `classNames` from `src/controllers/format.ts` or `cn` from `src/lib/utils.ts`; avoid inline class string conditionals when they become hard to scan.
- Lazy-load heavy or rarely used surfaces, especially modals, terminal code, and embedded remote-control views.
- Catch errors as `unknown` and convert them with `apiErrorMessage` before showing toast or inline copy.

## Settings Surfaces

- Keep tab routing in sync with the `settingsSection` query param so every settings state can be reviewed directly.
- Use compact onboarding strips for first-time or empty states, then let the working controls remain visible.
- Keep repeated validation in controllers or server validators; tabs should call helpers instead of duplicating string rules.
- Prefer one primary action per row or section. Use secondary actions for test, sync, restore, and remove flows.
- Preserve loading, disabled, success, failure, and empty states when distilling settings UI.

## Backend

- Routes should validate request params/body and delegate to services.
- Services should own filesystem, process, Docker, Hermes, database, and network side effects.
- Put environment and path resolution in `server/config.ts` or `server/lib/env-file.ts`.
- Use validators from `server/validation.ts` for names, paths, ports, URLs, and provider values.
- Use `run` from `server/lib/process.ts` for external commands so timeouts and output handling stay consistent.
- Use `createJob` for long-running operations such as create, lifecycle, sync, update, and chat actions. Request handlers should return job state quickly.
- API errors should be JSON with an `error` field. Do not leak command output that may contain credentials.
- Redact secrets before records, logs, API responses, or UI state.
- Convert unknown process failures through `jobErrorText` so queued job errors remain consistent.

## DRY Boundaries

- Deduplicate behavior, validation, response shapes, and durable copy.
- Avoid abstracting unrelated panels just because their JSX looks similar.
- Extract when it gives a clearer owner: a state hook, an API helper, a validator, or a presentational subsection.
- Large files are acceptable only while a workflow is actively being shaped. When revisiting them, leave them smaller and more navigable than you found them.

## Feature Checklist

When adding an API-backed UI feature:

1. Add or extend the model type in `src/models/fleet.ts`.
2. Add a route with validation and a small response shape.
3. Put side effects in a service instead of the route body.
4. Add a controller hook/action for frontend state.
5. Add a focused view component and CSS surface styles.
6. Cover loading, empty, success, and failure states.
7. Run release checks and browser-smoke the changed workflow.

## Release Checks

Run these before opening a pull request:

```bash
npm run release:check
```

For setup or onboarding changes, also run:

```bash
npm run init:baseline -- --json
```
