# Customer Log Monitor

A lightweight web dashboard for viewing customer logs stored in SQLite and quickly identifying follow-up opportunities.

## Security + multi-user setup

This version includes authentication and per-user data isolation:

- `POST /api/signup` creates a user account
- `POST /api/login` issues an HttpOnly, SameSite=Strict session cookie
- `GET /api/me` validates the active session
- `POST /api/logout` revokes the current session
- `GET /api/logs` requires auth and only returns logs for the signed-in user's `user_id`
- Passwords are stored with PBKDF2-SHA256 + random salt

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

Optional secure cookie mode (recommended behind HTTPS):

```bash
COOKIE_SECURE=true python3 app.py
```

Demo account:
- email: `ops@example.com`
- password: `ChangeMe123!`

## Quick checks

```bash
curl -s http://localhost:8000/api/health
```

Authenticated API sample:

```bash
# Login and store cookie
curl -i -c cookie.txt -X POST http://localhost:8000/api/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"ops@example.com","password":"ChangeMe123!"}'

# Query logs for that user session
curl -s -b cookie.txt "http://localhost:8000/api/logs?follow_up_only=true&severity=high"
```

## Features

- Secure login and sign-up UI
- Per-user customer log isolation by `user_id`
- Search by customer, email, or message
- Filter by severity and follow-up-required logs
- Summary metric cards for operational visibility

## API

- `GET /api/health`
- `POST /api/signup`
- `POST /api/login`
- `GET /api/me`
- `POST /api/logout`
- `GET /api/logs`
