import json
import os
import sqlite3
from datetime import datetime
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).parent
DB_PATH = ROOT / "logs.db"
WEB_DIR = ROOT / "web"


def get_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with get_connection() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS customer_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                customer_name TEXT NOT NULL,
                customer_email TEXT NOT NULL,
                event_type TEXT NOT NULL,
                message TEXT NOT NULL,
                severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
                follow_up_required INTEGER NOT NULL DEFAULT 0,
                assigned_owner TEXT,
                created_at TEXT NOT NULL
            )
            """
        )
        count = conn.execute("SELECT COUNT(*) as c FROM customer_logs").fetchone()["c"]
        if count == 0:
            seed = [
                ("Ava Johnson", "ava@northline.com", "Payment Failed", "Card declined on renewal plan", "high", 1, "Mia Chen", "2026-02-20T08:41:00"),
                ("Noah Patel", "noah@westbay.io", "Feature Request", "Asked for CSV export in dashboard", "low", 0, "", "2026-02-21T11:15:00"),
                ("Sophia Martinez", "sophia@suncrest.org", "Escalation", "Could not access account after SSO update", "critical", 1, "Liam Davis", "2026-02-22T09:33:00"),
                ("Ethan Kim", "ethan@brookfield.app", "Support", "Needs invoice correction before audit", "medium", 1, "Amelia Ross", "2026-02-22T16:08:00"),
                ("Olivia Brown", "olivia@hightide.dev", "Bug Report", "Intermittent timeout while generating reports", "medium", 0, "", "2026-02-23T13:05:00"),
            ]
            conn.executemany(
                """
                INSERT INTO customer_logs (
                    customer_name, customer_email, event_type, message, severity,
                    follow_up_required, assigned_owner, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                seed,
            )


class RequestHandler(BaseHTTPRequestHandler):
    def _send_json(self, data, status=200):
        payload = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def _send_file(self, file_path: Path, content_type: str):
        body = file_path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/api/health":
            self._send_json({"status": "ok"})
            return

        if path == "/api/logs":
            params = parse_qs(parsed.query)
            search = params.get("search", [""])[0].strip().lower()
            follow_up_only = params.get("follow_up_only", ["false"])[0].lower() == "true"
            severity = params.get("severity", ["all"])[0].lower()

            query = "SELECT * FROM customer_logs WHERE 1 = 1"
            args = []

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

            self._send_json({"logs": rows, "generated_at": datetime.utcnow().isoformat() + "Z"})
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
    server.serve_forever()


if __name__ == "__main__":
    run()
