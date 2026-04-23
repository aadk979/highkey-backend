# HighKey Backend (Production Scaffold)

Production-ready backend-only scaffold for a decoupled commerce stack (Next.js frontend as API client).

## Stack

- Fastify + TypeScript
- PostgreSQL
- SQL-first migrations (Drizzle folder)
- Stripe integration scaffold (webhook verification path)
- Zod config validation
- Pino structured logging
- ESLint + strict TypeScript

## Project Structure

- `src/app.ts` app composition, plugin registration, route registration
- `src/server.ts` process bootstrap and graceful shutdown
- `src/config/` environment and logger configuration
- `src/db/` PostgreSQL pool and schema placeholder
- `src/plugins/` security, request context, docs
- `src/modules/` bounded backend modules (auth, catalog, checkout, orders, payments, admin, health, meta, internal-jobs)
- `drizzle/0000_initial_schema.sql` initial PostgreSQL schema migration

## Run

1. Copy `.env.example` to `.env` and set real values.
2. Start PostgreSQL.
3. Apply migration with your preferred DB workflow.
4. Start the API:

```bash
npm run dev
```

## Scripts

- `npm run dev` local development
- `npm run build` TypeScript compile
- `npm run start` run compiled output
- `npm run lint` static checks
- `npm run db:generate` Drizzle migration generation (optional)
- `npm run db:migrate` run migrations
- `npm run db:push` push schema changes

## Notes

- All date-time columns in schema use `timestamptz`.
- Email fields use `citext` where case-insensitive behavior is required.
- FKs include explicit `ON DELETE` behavior.
- Includes partial index for Stripe event processing queue and open-order queue.
- Frontend is intentionally not included.
