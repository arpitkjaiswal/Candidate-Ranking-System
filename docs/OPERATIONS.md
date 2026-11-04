# Operating a single TalentOS workspace

## Production scope

This release supports one trusted hiring workspace. The shared access key is an administrative credential; it is not a multi-tenant identity system. Terminate HTTPS at your platform ingress. Do not expose an unprotected development service or let a shared-key workspace accept anonymous public uploads.

## PostgreSQL deployment

`compose.yaml` provides PostgreSQL 17, the non-root API, and an unprivileged nginx gateway. Supply `TALENT_API_KEY` (at least 32 characters) and a long URL-safe `TALENT_DB_PASSWORD` through your secret manager or shell environment. Never commit these values. The Compose file intentionally refuses to start without them.

```bash
docker compose up --build -d --wait
```

The gateway binds only to loopback port 8080. Route your HTTPS ingress there; PostgreSQL and the API have no published host ports. The API root filesystem is read-only, writable temporary storage is bounded, Linux capabilities are dropped, and CPU/memory/process limits are set. PostgreSQL has a named persistent volume. Docker health checks verify PostgreSQL, API/database readiness, and the nginx-to-API path. In a managed cloud build, supply session CA BuildKit secrets described in README.md; do not disable TLS verification.

nginx limits request bodies to 52 MB and applies a per-client rate/burst budget. The application also counts streamed request bytes before multipart parsing and limits files to 5 MB. API requests, including failed access attempts, have a bounded per-process rate limiter (120/minute by default, configurable with `TALENT_RATE_LIMIT` from 1 to 10,000). Multi-instance deployments need shared ingress rate limiting and a reviewed database connection budget.

## Database upgrades

Startup runs Alembic migrations inside a database transaction, with a PostgreSQL advisory lock or SQLite writer lock. The original application's exact schema can be adopted only after checking its complete expected column sets. Unknown unversioned schemas fail safely. Existing profiles are retained, and optimistic version columns are added additively.

For an explicit pre-start migration:

```bash
python -m backend.manage migrate
```

Back up before upgrades. Destructive downgrades are intentionally disabled. Add a reviewed Alembic revision for later schema changes; do not replace migrations with `create_all` or reset a real database.

## Backups and restore

For local SQLite, this command uses SQLite's backup API so committed WAL contents are included, creates the destination exclusively with restrictive permissions, and checks integrity:

```bash
python -m backend.manage backup /secure/backups/talentos-2026-11-04.db
```

The destination directory must already exist. Store backups outside the public checkout. For PostgreSQL, use `pg_dump`/managed snapshots with encrypted storage and scheduled restore drills. Verify a restore in an isolated environment before replacing production data. Deleting a profile removes its active application record; backups/snapshots must follow your retention policy separately.

## Concurrent review and role changes

Candidate updates require the current `version` from the API. Stale writes return 409 and retain the UI's draft; the reviewer can inspect the newest saved notes before deliberately saving again. Role edits also require a version and recalculate all candidate reports atomically. Uploads use a role-level compare-and-swap to reject a batch if requirements changed during extraction. Candidate and role deletions require a current version and a user confirmation.

## Document extraction boundary

Each document is processed by a disposable Linux subprocess without inherited application credentials. Limits: 512 MiB address space, six CPU seconds, twelve wall-clock seconds, 50 PDF pages, 200,000 extracted characters, 20 MiB total expanded DOCX data, and 1,000 DOCX archive entries. Two extraction workers may run per API process. Saturation is reported explicitly. Oversized/malformed documents cannot monopolize the API's event loop.

These limits isolate resource usage; they are not a malware scanner or a complete security sandbox. Public untrusted document ingestion should use dedicated worker containers/accounts with network and filesystem isolation, malware scanning, and a patch-management policy. Scanned PDFs require OCR before uploading.

## Diagnose and recover

- `/api/health` queries the database. Readiness failures require investigation; a running process alone does not prove the service works.
- Unexpected API errors return a generic message and request ID. Application logs record the exception type and request ID, without logging resume contents, tokens, query strings, or SQL parameter values.
- A failed or timed-out write is not automatically retried. Refresh to verify the result before submitting again.
- An invalidated workspace key clears private UI state and returns to the unlock screen.
- Restarting the API preserves PostgreSQL/SQLite data. Replacing a container is not a database backup.

For browser tests only, use a disposable seeded database and `TALENT_RATE_LIMIT=1000`; the expanded desktop/mobile suite deliberately makes more requests than a typical session. Never point the browser test suite at a real hiring workspace.
