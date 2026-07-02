# Release Checklist

Use this checklist before publishing the repository publicly.

## Required Checks

```bash
npm run release:check
git status --short
```

## Manual Review

- no tracked `.env`, `data/`, `logs/`, `runtime/`, or `secrets/`
- no personal paths in committed configuration
- no API keys, OAuth tokens, private keys, or credential pool files
- `.env.example` contains only placeholders
- console defaults bind to localhost unless exposure is intentional
- exposed deployments set `HERMES_CONSOLE_TOKEN` and `HERMES_CONSOLE_REQUIRE_AUTH=1`
- setup instructions work from a fresh clone
- Docker and Hermes prerequisites are documented
- `LICENSE`, `SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SUPPORT.md`, and GitHub release checks are present
- GitHub issue templates route bugs, feature requests, and private vulnerability reports clearly
- `knip.json` explains non-import graph entrypoints such as Docker sidecar scripts

## Runtime State

The app creates local runtime state on first setup. These paths are intentionally ignored:

- `data/`
- `logs/`
- `runtime/`
- `secrets/`
- `vendor/hermes-agent/`
