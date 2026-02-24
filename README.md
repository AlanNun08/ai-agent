# Customer Log Monitor

A lightweight web dashboard for viewing customer logs stored in SQLite and quickly identifying follow-up opportunities.

## Why you may not have seen a preview

The app is not auto-started in this environment. You need to run the server first, then open the forwarded port URL.

## Run locally

```bash
python3 app.py
```

Then open:
- `http://localhost:8000`

You can also choose a custom port:

```bash
PORT=8080 python3 app.py
```

Then open:
- `http://localhost:8080`

## Quick checks

```bash
curl -s http://localhost:8000/api/health
curl -s "http://localhost:8000/api/logs?follow_up_only=true&severity=high"
```

## Features

- Search by customer, email, or message
- Filter by severity and follow-up-required logs
- Summary metric cards for operational visibility
- Seed data so the UI is useful immediately

## API

`GET /api/logs`

Query params:

- `search` (string)
- `severity` (`all|low|medium|high|critical`)
- `follow_up_only` (`true|false`)
