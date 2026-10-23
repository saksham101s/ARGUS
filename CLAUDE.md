@AGENTS.md
@docs/MEMORY.md
@docs/ARCHITECTURE.md

## Working agreement

- `docs/MEMORY.md` (status, decisions, open questions, changelog) and
  `docs/ARCHITECTURE.md` (how the system works) are the source of truth —
  read them instead of re-exploring the codebase.
- At the end of every task, update both files if anything they describe
  changed: phase status, new modules/tables/routes, decisions, changelog entry.
- Before finishing: `npm run typecheck && npm run lint && npm test`.
