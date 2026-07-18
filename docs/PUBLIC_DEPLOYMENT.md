# Public Judge Deployment

LOGOS Continuity includes a Render Blueprint that creates a free public Docker web service.

## Deploy

1. Push the repository to GitHub or GitLab.
2. Sign in to Render and choose **New → Blueprint**.
3. Connect the repository containing `render.yaml`.
4. Review the `logos-continuity-judge` free web service and apply the Blueprint.
5. Optionally set the `OPENAI_API_KEY` secret to enable the `GPT-5.6 LIVE` path.
6. Wait for `/api/health` to pass, then open the generated `onrender.com` URL.
7. Add the public URL to the Build Week testing instructions and Submission Evidence.

The Docker image never receives the API key during its build. Render injects the secret only at runtime.

## Judge Test Path

1. Open the public URL and wait for the free instance to wake if necessary.
2. Click `데모 초기화` to restore the deterministic seeded project.
3. Click `심사 모드` and follow the seven-step 2:50 flow.
4. Open `제출` to review English copy and requirement evidence.

## Free-Tier Behavior

- Render free web services spin down after 15 minutes without inbound traffic and can take about one minute to wake.
- The free filesystem is ephemeral. SQLite changes disappear after a restart, redeploy, or spin-down.
- This deployment is intentionally a disposable judge demo: LOGOS recreates the seeded demo project on a fresh database.
- Do not present the free deployment as durable production storage.
- Long-term production use requires persistent storage, such as a paid disk or an external database migration.

## Required Runtime Contract

- Node.js 24
- `HOST=0.0.0.0`
- Render-provided `PORT`
- `GET /api/health` returns HTTP 200
- `LOGOS_DB_PATH=/app/data/logos.db`

## Local Container Commands

```bash
docker build -t logos-continuity .
docker run --rm -p 4318:10000 logos-continuity
```

Open `http://127.0.0.1:4318` and verify `/api/health` before deploying.

## Official Platform References

- https://render.com/docs/free
- https://render.com/docs/web-services
- https://render.com/docs/blueprint-spec
- https://render.com/docs/health-checks
