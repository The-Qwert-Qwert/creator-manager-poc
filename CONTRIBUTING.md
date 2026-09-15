# Contributing

PoC repo. Branching, commits and PRs follow the conventions below so that
work stays traceable to Plane work items.

## Target branch

`poc-mvp-phase-1` is the PoC playground and the branch everything merges into.
`main` is never committed to or pushed to directly.

## Branches

One branch per task. Never commit directly to the target branch.

```
<type>/<WORK-ID>-<short-description>
```

- `<type>` — `feat` | `fix` | `chore` | `docs` | `refactor` | `test`
- `<WORK-ID>` — the Plane work item identifier, uppercase, exactly as Plane shows it
- `<short-description>` — lowercase kebab-case, 2–5 words, describing the change

Examples:

```
feat/CREAT-8-adapter-types-registry
fix/CREAT-25-cron-bearer-auth
docs/CREAT-31-env-var-names
```

For repo chores with no work item, drop the id:

```
docs/branch-and-pr-conventions
```

Branch off the target branch, not off another task branch, unless the work
genuinely depends on the other branch landing first.

## Commits

- Reference the work item id in the message body (`CREAT-8`).
- No co-author trailers.

## Pull requests

Open a PR from the task branch into `poc-mvp-phase-1`, and reference the work
item in the PR title:

```
[CREAT-8] Add adapter types and registry
```

- `[CREAT-8]` — with brackets: links the work item **and** drives automatic
  state updates (requires PR state mapping to be configured in Plane).
- `CREAT-8` — without brackets: links only, no state automation.

The documented trigger for linking is the **pull request title or
description**, not the branch name. Keep the id in the branch name anyway for
local traceability.

## Linking to Plane

The GitHub integration in Plane syncs PRs and work item state. Before it can
work:

- Workspace role must be Admin or Owner.
- Plane → Settings → Integrations → GitHub → connect the account that owns the
  repository.
- Configure PR state mapping per project, or PRs will link but not move states.

Issue syncing (GitHub issues ↔ Plane work items) is separate from PR linking
and needs the `plane` label on the GitHub issue and the `github` label on the
Plane work item.

## Before committing

Run, and make sure all three are clean:

```bash
npm run lint
npm run typecheck
npm test
```

Scaffold/tooling changes should also survive `npm run build`. Note that
`next build` rewrites `next-env.d.ts` (pointing at `.next/types` instead of
`.next/dev/types`); revert that file rather than committing the churn.
