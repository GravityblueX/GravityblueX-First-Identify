# TeamSync API Surface

Generated: 2026-06-24T03:20:36.215Z
Status: `OK`
Routes: `27`
Public: `4`
Protected: `23`

## Gates

| Gate | Result | Detail |
|---|---|---|
| routes discovered | OK | 27 routes |
| health endpoint public | OK | /health |
| auth endpoints public | OK | /api/auth/login |
| project routes protected | OK | /api/projects/* |
| task routes protected | OK | /api/tasks/* |

## Routes

| Method | Path | Auth | Source |
|---|---|---|---|
| GET | `/api/analytics/dashboard/:projectId` | protected | `server/src/routes/analytics.ts` |
| GET | `/api/analytics/project-insights/:projectId` | protected | `server/src/routes/analytics.ts` |
| GET | `/api/analytics/team-performance` | protected | `server/src/routes/analytics.ts` |
| POST | `/api/auth/login` | public | `server/src/routes/auth.ts` |
| POST | `/api/auth/refresh` | public | `server/src/routes/auth.ts` |
| POST | `/api/auth/register` | public | `server/src/routes/auth.ts` |
| GET | `/api/chats/:id/messages` | protected | `server/src/routes/chats.ts` |
| POST | `/api/chats/:id/messages` | protected | `server/src/routes/chats.ts` |
| GET | `/api/chats/project/:projectId` | protected | `server/src/routes/chats.ts` |
| GET | `/api/projects` | protected | `server/src/routes/projects.ts` |
| POST | `/api/projects` | protected | `server/src/routes/projects.ts` |
| DELETE | `/api/projects/:id` | protected | `server/src/routes/projects.ts` |
| GET | `/api/projects/:id` | protected | `server/src/routes/projects.ts` |
| PUT | `/api/projects/:id` | protected | `server/src/routes/projects.ts` |
| POST | `/api/tasks` | protected | `server/src/routes/tasks.ts` |
| DELETE | `/api/tasks/:id` | protected | `server/src/routes/tasks.ts` |
| GET | `/api/tasks/:id` | protected | `server/src/routes/tasks.ts` |
| PUT | `/api/tasks/:id` | protected | `server/src/routes/tasks.ts` |
| POST | `/api/tasks/:id/comments` | protected | `server/src/routes/tasks.ts` |
| GET | `/api/tasks/project/:projectId` | protected | `server/src/routes/tasks.ts` |
| GET | `/api/users/me` | protected | `server/src/routes/users.ts` |
| PUT | `/api/users/me` | protected | `server/src/routes/users.ts` |
| GET | `/api/users/notifications` | protected | `server/src/routes/users.ts` |
| PUT | `/api/users/notifications/:id/read` | protected | `server/src/routes/users.ts` |
| PUT | `/api/users/notifications/read-all` | protected | `server/src/routes/users.ts` |
| GET | `/api/users/search` | protected | `server/src/routes/users.ts` |
| GET | `/health` | public | `server/src/index.ts` |

## Reference Basis

- OpenAPI-style API inventory
- Express mounted route contract
- Repository health gates should be backed by inspectable local artifacts
