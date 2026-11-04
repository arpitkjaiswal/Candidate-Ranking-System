# Validation evidence

Validated in the cloud environment on 2026-11-04 with Python 3.12.14 and Node.js 24.22.1.

| Check | Observed result |
|---|---|
| `python -m pytest -q` | 42 tests passed |
| `ruff check backend migrations tests` | Passed |
| `ruff format --check backend migrations tests` | Passed |
| `npm run build --prefix frontend` | TypeScript and Vite production build passed |
| Playwright desktop + mobile | 14 tests passed in Chromium |
| Docker build | Multi-stage image built successfully with TLS verification |
| Production Compose | PostgreSQL migrations, nginx ingress, protected API, isolated extraction, version conflicts, persistence across API restart, and cascading deletion passed |
| Docker runtime | Database health, unauthenticated rejection, authenticated request, empty production workspace, frontend delivery, UID 10001 passed |

The Python test client emits an upstream deprecation warning for its httpx integration; all tests execute and pass. Chromium was supplied by the integrity-verified `@sparticuz/chromium` npm distribution because the base cloud image did not include a browser executable. The test configuration also supports a standard Playwright browser installation.

## Reproduce browser checks

Use a separate demo database so tests do not modify development or real applicant records:

```bash
# Terminal 1: activate the project virtual environment first.
TALENT_RATE_LIMIT=1000 TALENT_DATA_DIR=/tmp/talentos-e2e TALENT_DEMO=1 \
  python -m uvicorn backend.main:app --host 127.0.0.1 --port 8001

# Terminal 2
cd frontend
npx playwright install chromium
npm run test:e2e
```

The base URL can be changed through `TALENT_E2E_URL`. `PLAYWRIGHT_CHROMIUM_EXECUTABLE` selects an already installed Chromium executable. Tests create synthetic test roles and update demo notes; never target a real hiring workspace. No authenticated production workspace is used by this browser suite.

## Boundaries

These results verify the current cloud machine and a local container. They do not establish a published deployment, fresh-task restoration, load capacity, WCAG conformance, security certification, or accuracy/fairness on real applicant data. The backend suite uses temporary databases and includes controlled score invariance checks rather than a production model benchmark. See the model card and architecture document for limitations.
