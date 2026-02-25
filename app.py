import hashlib
import json
import os
import secrets
import sqlite3
from datetime import datetime, timedelta, timezone
from http import cookies
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).parent
DB_PATH = ROOT / "logs.db"
WEB_DIR = ROOT / "web"
SESSION_TTL_HOURS = 12


def utc_now():
    return datetime.now(timezone.utc)


def get_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def hash_password(password: str, salt: str) -> str:
    password_hash = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), bytes.fromhex(salt), 120000
    )
    return password_hash.hex()


def create_password_record(password: str):
    salt = secrets.token_hex(16)
    return salt, hash_password(password, salt)


def verify_password(password: str, salt: str, password_hash: str) -> bool:
    calculated = hash_password(password, salt)
    return secrets.compare_digest(calculated, password_hash)


def parse_json_body(handler):
    content_length = int(handler.headers.get("Content-Length", "0"))
    if content_length <= 0:
        return {}
    raw = handler.rfile.read(content_length)
    try:
        return json.loads(raw.decode("utf-8"))
    except json.JSONDecodeError:
        return None


def init_db():
    with get_connection() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT NOT NULL UNIQUE,
                full_name TEXT NOT NULL,
                password_salt TEXT NOT NULL,
                password_hash TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                session_token TEXT NOT NULL UNIQUE,
                expires_at TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id)
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS customer_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                customer_name TEXT NOT NULL,
                customer_email TEXT NOT NULL,
                event_type TEXT NOT NULL,
                message TEXT NOT NULL,
                severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
                follow_up_required INTEGER NOT NULL DEFAULT 0,
                assigned_owner TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id)
            )
            """
        )

        columns = {
            row["name"] for row in conn.execute("PRAGMA table_info(customer_logs)").fetchall()
        }
        if "user_id" not in columns:
            conn.execute("ALTER TABLE customer_logs ADD COLUMN user_id INTEGER")

        default_user = conn.execute(
            "SELECT id FROM users WHERE email = ?", ("ops@example.com",)
        ).fetchone()
        if not default_user:
            salt, pw_hash = create_password_record("ChangeMe123!")
            conn.execute(
                """
                INSERT INTO users (email, full_name, password_salt, password_hash, created_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                ("ops@example.com", "Operations Demo", salt, pw_hash, utc_now().isoformat()),
            )
            default_user = conn.execute(
                "SELECT id FROM users WHERE email = ?", ("ops@example.com",)
            ).fetchone()

        conn.execute("UPDATE customer_logs SET user_id = ? WHERE user_id IS NULL", (default_user["id"],))

        count = conn.execute("SELECT COUNT(*) as c FROM customer_logs").fetchone()["c"]
        if count == 0:
            seed = [
                (default_user["id"], "Ava Johnson", "ava@northline.com", "Payment Failed", "Card declined on renewal plan", "high", 1, "Mia Chen", "2026-02-20T08:41:00"),
                (default_user["id"], "Noah Patel", "noah@westbay.io", "Feature Request", "Asked for CSV export in dashboard", "low", 0, "", "2026-02-21T11:15:00"),
                (default_user["id"], "Sophia Martinez", "sophia@suncrest.org", "Escalation", "Could not access account after SSO update", "critical", 1, "Liam Davis", "2026-02-22T09:33:00"),
                (default_user["id"], "Ethan Kim", "ethan@brookfield.app", "Support", "Needs invoice correction before audit", "medium", 1, "Amelia Ross", "2026-02-22T16:08:00"),
                (default_user["id"], "Olivia Brown", "olivia@hightide.dev", "Bug Report", "Intermittent timeout while generating reports", "medium", 0, "", "2026-02-23T13:05:00"),
            ]
            conn.executemany(
                """
                INSERT INTO customer_logs (
                    user_id, customer_name, customer_email, event_type, message, severity,
                    follow_up_required, assigned_owner, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                seed,
            )


def build_session_cookie(token: str):
    c = cookies.SimpleCookie()
    c["session_token"] = token
    c["session_token"]["path"] = "/"
    c["session_token"]["httponly"] = True
    c["session_token"]["samesite"] = "Strict"
    if os.getenv("COOKIE_SECURE", "false").lower() == "true":
        c["session_token"]["secure"] = True
    return c["session_token"].OutputString()


def build_clear_cookie():
    c = cookies.SimpleCookie()
    c["session_token"] = ""
    c["session_token"]["path"] = "/"
    c["session_token"]["expires"] = "Thu, 01 Jan 1970 00:00:00 GMT"
    c["session_token"]["httponly"] = True
    c["session_token"]["samesite"] = "Strict"
    return c["session_token"].OutputString()


class RequestHandler(BaseHTTPRequestHandler):
    def _send_json(self, data, status=200, cookie_header=None):
        payload = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cache-Control", "no-store")
        if cookie_header:
            self.send_header("Set-Cookie", cookie_header)
        self.end_headers()
        self.wfile.write(payload)

    def _send_file(self, file_path: Path, content_type: str):
        body = file_path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def _current_user(self):
        raw_cookie = self.headers.get("Cookie", "")
        jar = cookies.SimpleCookie()
        jar.load(raw_cookie)
        if "session_token" not in jar:
            return None
        session_token = jar["session_token"].value
        with get_connection() as conn:
            row = conn.execute(
                """
                SELECT u.id, u.email, u.full_name, s.expires_at, s.session_token
                FROM sessions s
                JOIN users u ON u.id = s.user_id
                WHERE s.session_token = ?
                """,
                (session_token,),
            ).fetchone()
            if not row:
                return None
            if datetime.fromisoformat(row["expires_at"]) < utc_now():
                conn.execute("DELETE FROM sessions WHERE session_token = ?", (session_token,))
                return None
            return row

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path
        body = parse_json_body(self)

        if body is None:
            self._send_json({"error": "Invalid JSON payload"}, status=400)
            return

        if path == "/api/signup":
            email = str(body.get("email", "")).strip().lower()
            full_name = str(body.get("full_name", "")).strip()
            password = str(body.get("password", ""))
            if not email or not full_name or len(password) < 10:
                self._send_json(
                    {"error": "Provide full_name, email, and a password with at least 10 chars."},
                    status=400,
                )
                return

            salt, pw_hash = create_password_record(password)
            try:
                with get_connection() as conn:
                    conn.execute(
                        """
                        INSERT INTO users (email, full_name, password_salt, password_hash, created_at)
                        VALUES (?, ?, ?, ?, ?)
                        """,
                        (email, full_name, salt, pw_hash, utc_now().isoformat()),
                    )
            except sqlite3.IntegrityError:
                self._send_json({"error": "Email already registered."}, status=409)
                return

            self._send_json({"message": "Account created. Please sign in."}, status=201)
            return

        if path == "/api/login":
            email = str(body.get("email", "")).strip().lower()
            password = str(body.get("password", ""))
            if not email or not password:
                self._send_json({"error": "Email and password are required."}, status=400)
                return

            with get_connection() as conn:
                user = conn.execute(
                    "SELECT id, email, full_name, password_salt, password_hash FROM users WHERE email = ?",
                    (email,),
                ).fetchone()
                if not user or not verify_password(
                    password, user["password_salt"], user["password_hash"]
                ):
                    self._send_json({"error": "Invalid credentials."}, status=401)
                    return

                token = secrets.token_urlsafe(32)
                expires_at = (utc_now() + timedelta(hours=SESSION_TTL_HOURS)).isoformat()
                conn.execute(
                    "INSERT INTO sessions (user_id, session_token, expires_at, created_at) VALUES (?, ?, ?, ?)",
                    (user["id"], token, expires_at, utc_now().isoformat()),
                )

            self._send_json(
                {
                    "message": "Login successful.",
                    "user": {
                        "id": user["id"],
                        "email": user["email"],
                        "full_name": user["full_name"],
                    },
                },
                cookie_header=build_session_cookie(token),
            )
            return

        if path == "/api/logout":
            user = self._current_user()
            if user:
                with get_connection() as conn:
                    conn.execute(
                        "DELETE FROM sessions WHERE session_token = ?", (user["session_token"],)
                    )
            self._send_json({"message": "Logged out."}, cookie_header=build_clear_cookie())
            return

        self._send_json({"error": "Not found"}, status=404)

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/api/health":
            self._send_json({"status": "ok"})
            return

        if path == "/api/me":
            user = self._current_user()
            if not user:
                self._send_json({"error": "Unauthorized"}, status=401)
                return
            self._send_json(
                {
                    "user": {
                        "id": user["id"],
                        "email": user["email"],
                        "full_name": user["full_name"],
                    }
                }
            )
            return

        if path == "/api/logs":
            user = self._current_user()
            if not user:
                self._send_json({"error": "Unauthorized"}, status=401)
                return

            params = parse_qs(parsed.query)
            search = params.get("search", [""])[0].strip().lower()
            follow_up_only = params.get("follow_up_only", ["false"])[0].lower() == "true"
            severity = params.get("severity", ["all"])[0].lower()

            query = "SELECT * FROM customer_logs WHERE user_id = ?"
            args = [user["id"]]

            if follow_up_only:
                query += " AND follow_up_required = 1"
            if severity in {"low", "medium", "high", "critical"}:
                query += " AND severity = ?"
                args.append(severity)
            if search:
                query += " AND (LOWER(customer_name) LIKE ? OR LOWER(customer_email) LIKE ? OR LOWER(message) LIKE ?)"
                like = f"%{search}%"
                args.extend([like, like, like])

            query += " ORDER BY datetime(created_at) DESC"

            with get_connection() as conn:
                rows = [dict(r) for r in conn.execute(query, args).fetchall()]

            self._send_json({"logs": rows, "generated_at": utc_now().isoformat()})
            return

        if path in {"/", "/index.html"}:
            self._send_file(WEB_DIR / "index.html", "text/html; charset=utf-8")
            return

        if path == "/styles.css":
            self._send_file(WEB_DIR / "styles.css", "text/css; charset=utf-8")
            return

        if path == "/app.js":
            self._send_file(WEB_DIR / "app.js", "application/javascript; charset=utf-8")
            return

        self.send_response(404)
        self.end_headers()


def run():
    init_db()
    port = int(os.getenv("PORT", "8000"))
    server = HTTPServer(("0.0.0.0", port), RequestHandler)
    print(f"Dashboard running on http://localhost:{port}")
    print("Demo login: ops@example.com / ChangeMe123!")
    server.serve_forever()


if __name__ == "__main__":
    run()
