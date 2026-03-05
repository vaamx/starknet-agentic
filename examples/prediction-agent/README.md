# HiveCaster Prediction Agent

## Production DB (Postgres + Prisma)

1. Set `DATABASE_URL` in `.env` (see `.env.example`).
2. Generate Prisma client:
```bash
npm run prisma:generate
```
3. Apply migrations:
```bash
npm run prisma:migrate:deploy
```

Migration files are in `prisma/migrations/`.

## Auth + RBAC

- Auth is session-cookie based (`hc_session`).
- Roles: `owner`, `admin`, `analyst`, `viewer`.
- New signups automatically get an organization + `owner` membership.

## Tenant-aware analytics

All forecast/research/execution/audit telemetry is stored org-scoped and powers:

- `GET /api/analytics/overview`
- `GET /api/ops/forecasts`
- `GET /api/ops/research`
- `GET /api/ops/executions`
