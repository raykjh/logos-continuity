# Public Judge Deployment

## Current Deployment

- Application: <https://logos-continuity-judge.onrender.com/>
- Platform: Render free Docker web service
- Health check: `/api/health`
- Region: Singapore
- Runtime: Node.js 24
- Live model: `gpt-5.6`

## Judge Test Path

1. Open the public URL and wait for the free instance to wake if necessary.
2. Click **데모 초기화** (`Reset Demo`).
3. Confirm the **GPT-5.6 LIVE** badge.
4. Click **심사 모드** (`Judge Mode`).
5. Follow the seven-step guided route.
6. Open **제출** (`Submission`) to inspect requirement evidence and English submission copy.

## Blueprint Deployment

1. Push the repository to GitHub or GitLab.
2. In Render, choose **New → Blueprint**.
3. Connect the repository containing `render.yaml`.
4. Apply the `logos-continuity-judge` free web service.
5. Optionally add `OPENAI_API_KEY` from the service Environment page.
6. Wait for `/api/health` to pass.

The Blueprint intentionally omits the API key so the application can deploy in Local Safe Mode without secrets. Render injects the key only at runtime if it is added later.

## Free-Tier Behavior

- The free service may sleep after inactivity and require a wake-up delay.
- The filesystem is ephemeral.
- SQLite changes can disappear after restart or redeploy.
- The deployment is intentionally a disposable judge demo with deterministic seeded data.
- Durable production use requires persistent storage or an external database.

## Runtime Contract

- `HOST=0.0.0.0`
- Render-provided `PORT`
- `LOGOS_DB_PATH=/app/data/logos.db`
- `GET /api/health` returns HTTP 200
- `OPENAI_MODEL=gpt-5.6`
- `REPOSITORY_URL=https://github.com/raykjh/logos-continuity`

## Local Container

```bash
docker build -t logos-continuity .
docker run --rm -p 4318:10000 logos-continuity
```

Open <http://127.0.0.1:4318>.
