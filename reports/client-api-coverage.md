# TeamSync Client API Coverage

Generated: 2026-06-24T03:59:53.555Z
Status: `OK`
Client calls: `25`
Matched calls: `25`
Backend operations: `27`

## Gates

| Gate | Result | Detail |
|---|---|---|
| OpenAPI contract available | OK | 3.1.0 |
| client API calls discovered | OK | 25 call(s) |
| all client calls match OpenAPI | OK | 0 unmatched |
| analytics direct fetches covered | OK | client/src/components/dashboard/Analytics.tsx |
| auth flow covered | OK | POST /api/auth/login |

## Client Calls

| Method | Client Path | OpenAPI Match | Locations |
|---|---|---|---|
| GET | `/api/analytics/dashboard/{param}` | `/api/analytics/dashboard/{projectId}` | `client\src\components\dashboard\Analytics.tsx:47` |
| GET | `/api/analytics/project-insights/{param}` | `/api/analytics/project-insights/{projectId}` | `client\src\components\dashboard\Analytics.tsx:54` |
| POST | `/api/auth/login` | `/api/auth/login` | `client\src\lib\api.ts:60` |
| POST | `/api/auth/refresh` | `/api/auth/refresh` | `client\src\lib\api.ts:72` |
| POST | `/api/auth/register` | `/api/auth/register` | `client\src\lib\api.ts:69` |
| GET | `/api/chats/{param}/messages` | `/api/chats/{id}/messages` | `client\src\lib\api.ts:151` |
| POST | `/api/chats/{param}/messages` | `/api/chats/{id}/messages` | `client\src\lib\api.ts:156` |
| GET | `/api/chats/project/{param}` | `/api/chats/project/{projectId}` | `client\src\lib\api.ts:148` |
| GET | `/api/projects` | `/api/projects` | `client\src\lib\api.ts:76` |
| POST | `/api/projects` | `/api/projects` | `client\src\lib\api.ts:86` |
| DELETE | `/api/projects/{param}` | `/api/projects/{id}` | `client\src\lib\api.ts:91` |
| GET | `/api/projects/{param}` | `/api/projects/{id}` | `client\src\lib\api.ts:78` |
| PUT | `/api/projects/{param}` | `/api/projects/{id}` | `client\src\lib\api.ts:89` |
| POST | `/api/tasks` | `/api/tasks` | `client\src\lib\api.ts:115` |
| DELETE | `/api/tasks/{param}` | `/api/tasks/{id}` | `client\src\lib\api.ts:120` |
| GET | `/api/tasks/{param}` | `/api/tasks/{id}` | `client\src\lib\api.ts:106` |
| PUT | `/api/tasks/{param}` | `/api/tasks/{id}` | `client\src\lib\api.ts:118` |
| POST | `/api/tasks/{param}/comments` | `/api/tasks/{id}/comments` | `client\src\lib\api.ts:123` |
| GET | `/api/tasks/project/{param}` | `/api/tasks/project/{projectId}` | `client\src\lib\api.ts:103` |
| GET | `/api/users/me` | `/api/users/me` | `client\src\lib\api.ts:127` |
| PUT | `/api/users/me` | `/api/users/me` | `client\src\lib\api.ts:133` |
| GET | `/api/users/notifications` | `/api/users/notifications` | `client\src\lib\api.ts:137` |
| PUT | `/api/users/notifications/{param}/read` | `/api/users/notifications/{id}/read` | `client\src\lib\api.ts:140` |
| PUT | `/api/users/notifications/read-all` | `/api/users/notifications/read-all` | `client\src\lib\api.ts:143` |
| GET | `/api/users/search` | `/api/users/search` | `client\src\lib\api.ts:135` |

## Boundary

- This report checks frontend-to-OpenAPI path drift for statically discoverable calls.
- It does not require every backend route to be called by the frontend.
