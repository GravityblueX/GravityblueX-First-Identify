# TeamSync Runtime Boundary

Generated: 2026-06-24T03:35:21.681Z
Entry: `server/src/index.ts`
Status: `OK`

## Summary

- Server source files: `33`
- Runtime modules: `10`
- Candidate modules: `23`
- Runtime import edges: `14`

## Gates

| Gate | Result | Detail |
|---|---|---|
| server entry exists | OK | server/src/index.ts |
| tsconfig compiles from entry | OK | ["src/index.ts"] |
| core API routes mounted | OK | /api/auth, /api/users, /api/projects, /api/tasks, /api/chats, /api/analytics |
| auth and error middleware imported | OK | server/src/index.ts |
| socket runtime wired | OK | server/src/index.ts |
| runtime graph has enough modules | OK | 10 modules |

## Mounted Routes

- `/api/auth`
- `/api/users`
- `/api/projects`
- `/api/tasks`
- `/api/chats`
- `/api/analytics`

## Runtime Areas

| Area | Modules |
|---|---:|
| (root) | 1 |
| middleware | 2 |
| routes | 6 |
| socket | 1 |

## Candidate Areas

| Area | Modules |
|---|---:|
| analytics | 2 |
| backup | 1 |
| compliance | 1 |
| events | 1 |
| graphql | 3 |
| integrations | 1 |
| middleware | 1 |
| ml | 1 |
| monitoring | 1 |
| performance | 1 |
| routes | 3 |
| security | 1 |
| services | 6 |

## Boundary Notes

- This report follows static local imports from server/src/index.ts.
- Candidate modules are present in source but not reached from the current server entry graph.
- A module should move from candidate to runtime only when it is mounted, tested, and documented.
