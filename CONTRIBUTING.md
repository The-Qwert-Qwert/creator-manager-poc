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

Open a PR from the task branch into `poc-mvp-phase-1`, with the work item id
in the title:

```
[CREAT-8] Add adapter types and registry
```

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
