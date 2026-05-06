"""Factory Coordination Hub — multi-project AI dev session coordinator."""
from __future__ import annotations

import asyncio
import html
import json
import os
import platform
import re
import sqlite3
import subprocess
import sys
import time
import urllib.error
import urllib.request
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from textwrap import dedent
from typing import Any

import psutil
from fastapi import Body, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from sse_starlette.sse import EventSourceResponse

APP_DIR = Path(__file__).resolve().parent
DB_PATH = APP_DIR / "factory.db"
START_TS = time.time()
APP_VERSION = "0.3.0"
HISTORY_LIMIT = 100
VALID_STREAM_TYPES = ("dev", "generic")
VALID_TASK_STATUSES = ("queued", "in_progress", "blocked", "review", "done")
VALID_PROJECT_STATUSES = ("active", "paused", "done", "archived")
VALID_MISSION_STATUSES = ("active", "paused", "done", "archived")

# cost per 1M tokens (input/output blended estimate for display)
MODEL_COST_PER_M: dict[str, float] = {
    "sonnet":  9.0,   # ($3 in + $15 out) / 2
    "opus":    22.5,  # ($15 in + $30 out) / 2
    "haiku":   3.0,   # ($1 in + $5 out) / 2
    "flash":   1.4,   # ($0.30 in + $2.50 out) / 2
    "ollama":  0.0,
}

app = FastAPI(title="Factory Hub")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=False,
)


# ── DB ──────────────────────────────────────────────────────────────────────

@contextmanager
def db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db() -> None:
    with db() as c:
        c.executescript("""
            CREATE TABLE IF NOT EXISTS streams (
                stream_id  TEXT PRIMARY KEY,
                data       TEXT NOT NULL,
                status     TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS stream_history (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                stream_id   TEXT NOT NULL,
                data        TEXT NOT NULL,
                status      TEXT NOT NULL,
                recorded_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_hist_stream
                ON stream_history(stream_id, recorded_at DESC);
            CREATE TABLE IF NOT EXISTS inbox_messages (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                target_stream TEXT NOT NULL,
                from_stream   TEXT NOT NULL,
                code          TEXT NOT NULL,
                message       TEXT NOT NULL,
                status        TEXT NOT NULL,
                sent_at       TEXT NOT NULL,
                resolved_at   TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_inbox_target
                ON inbox_messages(target_stream, status, id);
            CREATE TABLE IF NOT EXISTS projects (
                id          TEXT PRIMARY KEY,
                name        TEXT NOT NULL,
                description TEXT DEFAULT '',
                tech_stack  TEXT DEFAULT '',
                status      TEXT DEFAULT 'active',
                created_at  TEXT NOT NULL,
                updated_at  TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS tasks (
                id           TEXT PRIMARY KEY,
                project_id   TEXT NOT NULL,
                title        TEXT NOT NULL,
                description  TEXT DEFAULT '',
                stream_id    TEXT,
                branch       TEXT,
                status       TEXT DEFAULT 'queued',
                priority     INTEGER DEFAULT 5,
                model_hint   TEXT,
                runner_type  TEXT DEFAULT 'claude_code',
                depends_on   TEXT DEFAULT '[]',
                cost_tokens  INTEGER DEFAULT 0,
                created_at   TEXT NOT NULL,
                updated_at   TEXT NOT NULL,
                started_at   TEXT,
                completed_at TEXT,
                notes        TEXT DEFAULT '',
                FOREIGN KEY(project_id) REFERENCES projects(id)
            );
            CREATE TABLE IF NOT EXISTS workers (
                id            TEXT PRIMARY KEY,
                project_id    TEXT NOT NULL,
                task_id       TEXT,
                stream_id     TEXT NOT NULL,
                status        TEXT DEFAULT 'pending',
                model         TEXT,
                worktree_path TEXT,
                branch        TEXT,
                git_root      TEXT,
                pid           INTEGER,
                spawned_by    TEXT DEFAULT 'user',
                runner_type   TEXT DEFAULT 'claude_code',
                created_at    TEXT NOT NULL,
                updated_at    TEXT NOT NULL,
                started_at    TEXT,
                completed_at  TEXT,
                notes         TEXT DEFAULT ''
            );
            CREATE TABLE IF NOT EXISTS logs (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp   TEXT NOT NULL,
                level       TEXT NOT NULL DEFAULT 'info',
                source      TEXT NOT NULL DEFAULT 'system',
                project_id  TEXT,
                task_id     TEXT,
                stream_id   TEXT,
                message     TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_logs_ts ON logs(id DESC);
            CREATE INDEX IF NOT EXISTS idx_logs_source ON logs(source, id DESC);
            CREATE TABLE IF NOT EXISTS config (
                key         TEXT PRIMARY KEY,
                value       TEXT NOT NULL DEFAULT '',
                description TEXT DEFAULT '',
                updated_at  TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS project_templates (
                id             TEXT PRIMARY KEY,
                name           TEXT NOT NULL,
                description    TEXT DEFAULT '',
                tech_stack     TEXT DEFAULT '',
                task_templates TEXT NOT NULL DEFAULT '[]',
                created_at     TEXT NOT NULL,
                used_count     INTEGER DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS missions (
                id               TEXT PRIMARY KEY,
                project_id       TEXT NOT NULL,
                name             TEXT NOT NULL,
                description      TEXT DEFAULT '',
                success_criteria TEXT DEFAULT '',
                tech_notes       TEXT DEFAULT '',
                worktree_base    TEXT DEFAULT '',
                branch_prefix    TEXT DEFAULT 'feature/',
                model_hint       TEXT DEFAULT '',
                git_enabled      INTEGER DEFAULT 1,
                status           TEXT DEFAULT 'active',
                stage            TEXT DEFAULT 'draft',
                plan_qa          TEXT DEFAULT NULL,
                final_prompt     TEXT DEFAULT NULL,
                created_at       TEXT NOT NULL,
                updated_at       TEXT NOT NULL,
                FOREIGN KEY(project_id) REFERENCES projects(id)
            );
            CREATE INDEX IF NOT EXISTS idx_missions_project ON missions(project_id, created_at DESC);
            CREATE TABLE IF NOT EXISTS bot_events (
                id                INTEGER PRIMARY KEY AUTOINCREMENT,
                worker_id         TEXT,
                task_id           TEXT,
                project_id        TEXT,
                mission_id        TEXT,
                event_type        TEXT NOT NULL,
                model             TEXT,
                prompt_tokens     INTEGER DEFAULT 0,
                completion_tokens INTEGER DEFAULT 0,
                content           TEXT DEFAULT '{}',
                created_at        TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_bot_events_task ON bot_events(task_id, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_bot_events_project ON bot_events(project_id, created_at DESC);
            CREATE TABLE IF NOT EXISTS reviews (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                task_id     TEXT NOT NULL,
                worker_id   TEXT,
                project_id  TEXT,
                mission_id  TEXT,
                model       TEXT,
                rating      INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
                notes       TEXT DEFAULT '',
                flags       TEXT DEFAULT '[]',
                reviewer    TEXT DEFAULT 'user',
                created_at  TEXT NOT NULL,
                updated_at  TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_reviews_task ON reviews(task_id);
            CREATE INDEX IF NOT EXISTS idx_reviews_project ON reviews(project_id, created_at DESC);
            CREATE TABLE IF NOT EXISTS objective_templates (
                id                TEXT PRIMARY KEY,
                title             TEXT NOT NULL,
                description       TEXT DEFAULT '',
                model_hint        TEXT DEFAULT '',
                tags              TEXT DEFAULT '[]',
                source_mission_id TEXT,
                source_task_id    TEXT,
                use_count         INTEGER DEFAULT 0,
                created_at        TEXT NOT NULL,
                updated_at        TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_obj_tmpl_use ON objective_templates(use_count DESC, created_at DESC);
            CREATE TABLE IF NOT EXISTS audit_log (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp   TEXT NOT NULL,
                event_type  TEXT NOT NULL,
                entity_type TEXT NOT NULL,
                entity_id   TEXT,
                actor       TEXT DEFAULT 'user',
                project_id  TEXT,
                mission_id  TEXT,
                details     TEXT DEFAULT '{}'
            );
            CREATE INDEX IF NOT EXISTS idx_audit_ts      ON audit_log(id DESC);
            CREATE INDEX IF NOT EXISTS idx_audit_project ON audit_log(project_id, id DESC);
            CREATE INDEX IF NOT EXISTS idx_audit_mission ON audit_log(mission_id, id DESC);
        """)
        _seed_config(c)


_BOT_BEHAVIOR_TEMPLATE = dedent("""\
    ══════════════════════════════════════════════════════════
    BOTMASTER SESSION PROTOCOL  —  read before doing any work
    ══════════════════════════════════════════════════════════

    ## 1. MANDATORY HUB REPORTING — CRITICAL
    ⚠️  If BotMaster sees no update from you for {stuck_threshold_minutes} minutes, your
        session will be flagged STUCK and may be auto-killed. Keep reporting.

    POST {hub_url}/api/streams/{stream_id}
    Body: {{ "status": "starting|active|idle", "notes": "what you are doing right now" }}

    POST A STATUS UPDATE:
    - Immediately on session start        →  status: starting,  notes: "reading brief"
    - After claiming a task               →  status: active,    notes: task title
    - After EVERY significant step        →  status: active,    notes: what changed
    - After each git commit               →  update notes with commit message
    - When blocked on anything            →  status: idle,      notes: explain blocker
    - On completion of each task          →  status: idle,      notes: summary of work
    - AT MINIMUM every 3 minutes          →  any update so watchdog knows you are alive

    You CANNOT post too often. Silence = assumed stuck = terminated.
    Even "still working on X" counts. 3 minutes maximum between any updates.

    ## 2. TASK LIFECYCLE
    Claim next task:   GET   {hub_url}/api/tasks/next?project_id={project_id}
    Start task:        PATCH {hub_url}/api/tasks/{{task_id}}  {{ "status": "in_progress" }}
    Complete task:     PATCH {hub_url}/api/tasks/{{task_id}}  {{ "status": "review", "notes": "summary" }}
    Block task:        PATCH {hub_url}/api/tasks/{{task_id}}  {{ "status": "blocked",  "notes": "reason" }}

    Status progression:
      queued → in_progress  (when you start — claim it immediately)
      in_progress → review  (when finished — human reviews before done)
      in_progress → blocked (dependency unmet or information needed)

    Mark "review" only when work is complete, committed, and tested.
    Include a completion summary in notes: what was built, decisions made,
    anything the reviewer should check, suggested follow-up tasks.

    ## 3. ASKING QUESTIONS
    Do NOT guess or invent requirements. If you are uncertain: ASK.

    Send a question:
      POST {hub_url}/api/streams/{stream_id}/inbox
      Body: {{ "from_stream": "{stream_id}", "code": "QUESTION", "message": "Specific question text" }}

    Check for replies:
      GET {hub_url}/api/streams/{stream_id}/inbox

    After sending a question:
    - Set your task status to "blocked" with the question as the notes
    - Post a hub status: idle, "Waiting for answer: <question>"
    - Poll for reply every 2-3 minutes — do not idle silently

    BotMaster monitors inbox continuously and will respond. If unanswered
    after 15 minutes, the governor escalates to a human.

    ## 4. POST-RUN DIAGNOSTICS
    When finishing a task or ending your session, write a structured summary:
      POST {hub_url}/api/streams/{stream_id}
      Body: {{
        "status": "idle",
        "notes": "COMPLETED: [task title]. Built: [what]. Committed: [branch/hash]. Tests: [pass/fail]. Issues: [any]. Recommend: [next steps]."
      }}
    This note is captured in the mission report and reviewed by the team.

    ## 5. CODE QUALITY
    - Commit frequently — one logical change per commit
    - Commit message format:  feat: / fix: / chore: / refactor:  (lowercase)
    - TypeScript: no implicit any, no @ts-ignore, strict mode
    - Run `npm run typecheck` after each significant change
    - Test what you build before marking for review
    - If something looks risky: ask first, do not ship broken code
    - Do not leave TODO comments — fix it or raise a question

    ## 6. COORDINATION RULES
    - Only modify files in your assigned worktree / branch
    - Do not change shared components without checking with other bots
    - If you discover a better approach: document in hub notes, ask before pivoting
    - If another bot messages your inbox: respond before continuing your own work
    - If your task depends on one that isn't done: set yourself blocked, wait, poll
    ══════════════════════════════════════════════════════════
""")


def _seed_config(c: sqlite3.Connection) -> None:
    defaults = [
        ("anthropic_api_key",  "",           "Anthropic API key for Claude"),
        ("default_runner",      "ollama",     "Default bot runner: claude_code|ollama|aider|codex"),
        ("default_model",      "sonnet",     "Default Claude model when runner is claude_code"),
        ("stuck_threshold",    "600",        "Seconds before a session is flagged stuck"),
        ("auto_restart_stuck", "false",      "Auto-restart stuck workers"),
        ("claude_cli_path",    "claude",     "Path to claude CLI binary"),
        ("git_user_name",      "Pete Gresty","Git commit author name"),
        ("git_user_email",     "peter.gresty@gmail.com", "Git commit author email"),
        ("openrouter_api_key", "",           "OpenRouter API key"),
        ("gemini_api_key",     "",           "Google Gemini API key"),
        ("worktree_base_dir",  str(Path(__file__).resolve().parents[2]), "Base dir for new worktrees"),
        ("projects_base_dir",  str(Path(__file__).resolve().parents[2] / "Projects"), "Base dir where project folders are created"),
        ("governor_interval",   "180",        "Governor poll interval in seconds"),
        ("default_project_status", "active", "Default initial mode for new missions: active|planning|paused"),
        ("git_server_url",   "http://localhost:3002", "Local git server base URL (Gitea/Gogs)"),
        ("git_server_user",  "pete",                  "Git server username for repo creation"),
        ("bot_behavior_template", _BOT_BEHAVIOR_TEMPLATE, "Default bot behaviour instructions prepended to every CLAUDE.md"),
        ("codex_cli_path",        "codex",                      "Path to OpenAI Codex CLI binary"),
        ("aider_cli_path",        "aider",                      "Path to aider CLI binary"),
        ("ollama_url",            "http://localhost:11434",      "Ollama API base URL"),
        ("ollama_default_model",  "qwen3-coder:latest",          "Default Ollama model name"),
        # Governor / triage
        ("google_api_key",        "",    "Google Gemini API key (used by governor triage)"),
        ("ntfy_topic",            "",    "ntfy.sh topic for push alerts (leave blank to disable)"),
        ("triage_model",          "gemini-flash", "Model used by governor to triage bot questions: gemini-flash|ollama"),
        ("triage_interval",       "60",  "Governor poll interval in seconds"),
        ("triage_auto_reply",     "true","Governor auto-replies to answerable questions (true/false)"),
        ("triage_alert_threshold","15",  "Minutes unanswered before governor raises alert"),
        ("stuck_threshold_minutes","10", "Minutes without a hub update before worker flagged stuck"),
    ]
    now = utcnow_boot()
    for key, value, desc in defaults:
        c.execute(
            "INSERT OR IGNORE INTO config (key, value, description, updated_at) VALUES (?,?,?,?)",
            (key, value, desc, now),
        )


def utcnow_boot() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _migrate_db() -> None:
    """Add columns/tables introduced after initial schema."""
    with db() as c:
        for ddl in [
            "ALTER TABLE projects ADD COLUMN project_path TEXT DEFAULT ''",
            "ALTER TABLE tasks ADD COLUMN mission_id TEXT",
            "ALTER TABLE workers ADD COLUMN mission_id TEXT",
            # New mission columns
            "ALTER TABLE missions ADD COLUMN success_criteria TEXT DEFAULT ''",
            "ALTER TABLE missions ADD COLUMN tech_notes TEXT DEFAULT ''",
            "ALTER TABLE missions ADD COLUMN worktree_base TEXT DEFAULT ''",
            "ALTER TABLE missions ADD COLUMN branch_prefix TEXT DEFAULT 'feature/'",
            "ALTER TABLE missions ADD COLUMN model_hint TEXT DEFAULT ''",
            "ALTER TABLE missions ADD COLUMN git_enabled INTEGER DEFAULT 1",
            "ALTER TABLE missions ADD COLUMN stage TEXT DEFAULT 'draft'",
            "ALTER TABLE missions ADD COLUMN plan_qa TEXT DEFAULT NULL",
            "ALTER TABLE missions ADD COLUMN final_prompt TEXT DEFAULT NULL",
            "ALTER TABLE workers ADD COLUMN runner_type TEXT DEFAULT 'claude_code'",
            "ALTER TABLE tasks ADD COLUMN runner_type TEXT DEFAULT 'claude_code'",
            # bot_events and reviews tables (safe if already exist via init_db)
            """CREATE TABLE IF NOT EXISTS bot_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT, worker_id TEXT, task_id TEXT,
                project_id TEXT, mission_id TEXT, event_type TEXT NOT NULL, model TEXT,
                prompt_tokens INTEGER DEFAULT 0, completion_tokens INTEGER DEFAULT 0,
                content TEXT DEFAULT '{}', created_at TEXT NOT NULL)""",
            "CREATE INDEX IF NOT EXISTS idx_bot_events_task ON bot_events(task_id, created_at DESC)",
            "CREATE INDEX IF NOT EXISTS idx_bot_events_project ON bot_events(project_id, created_at DESC)",
            """CREATE TABLE IF NOT EXISTS reviews (
                id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL, worker_id TEXT,
                project_id TEXT, mission_id TEXT, model TEXT,
                rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
                notes TEXT DEFAULT '', flags TEXT DEFAULT '[]', reviewer TEXT DEFAULT 'user',
                created_at TEXT NOT NULL, updated_at TEXT NOT NULL)""",
            "CREATE INDEX IF NOT EXISTS idx_reviews_task ON reviews(task_id)",
            "CREATE INDEX IF NOT EXISTS idx_reviews_project ON reviews(project_id, created_at DESC)",
            """CREATE TABLE IF NOT EXISTS objective_templates (
                id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT DEFAULT '',
                model_hint TEXT DEFAULT '', tags TEXT DEFAULT '[]',
                source_mission_id TEXT, source_task_id TEXT,
                use_count INTEGER DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)""",
            "CREATE INDEX IF NOT EXISTS idx_obj_tmpl_use ON objective_templates(use_count DESC, created_at DESC)",
            """CREATE TABLE IF NOT EXISTS audit_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL, event_type TEXT NOT NULL,
                entity_type TEXT NOT NULL, entity_id TEXT,
                actor TEXT DEFAULT 'user', project_id TEXT, mission_id TEXT,
                details TEXT DEFAULT '{}')""",
            "CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(id DESC)",
            "CREATE INDEX IF NOT EXISTS idx_audit_project ON audit_log(project_id, id DESC)",
            "CREATE INDEX IF NOT EXISTS idx_audit_mission ON audit_log(mission_id, id DESC)",
            "ALTER TABLE projects ADD COLUMN deleted_at TEXT DEFAULT NULL",
            "ALTER TABLE tasks ADD COLUMN working_dir TEXT DEFAULT ''",
            "ALTER TABLE tasks ADD COLUMN folder_mode TEXT DEFAULT 'inherit'",
            "ALTER TABLE workers ADD COLUMN transcript_path TEXT DEFAULT ''",
            "ALTER TABLE tasks ADD COLUMN git_repo TEXT DEFAULT ''",
            "ALTER TABLE workers ADD COLUMN transcript_text TEXT DEFAULT NULL",
        ]:
            try:
                c.execute(ddl)
            except Exception:
                pass  # already exists


init_db()
_migrate_db()


# ── Helpers ──────────────────────────────────────────────────────────────────

def utcnow() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_iso(s: str) -> datetime:
    try:
        return datetime.strptime(s, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    except Exception:
        return datetime.now(timezone.utc)


def age_seconds(updated_at: str) -> int:
    return int((datetime.now(timezone.utc) - parse_iso(updated_at)).total_seconds())


def elapsed_seconds(started_at: str | None, ended_at: str | None = None) -> int | None:
    if not started_at:
        return None
    end = parse_iso(ended_at) if ended_at else datetime.now(timezone.utc)
    return int((end - parse_iso(started_at)).total_seconds())


def compute_status(data: dict[str, Any]) -> str:
    issues = data.get("active_issues") or []
    if any(i.get("severity") == "urgent" and not i.get("actioned") for i in issues):
        return "urgent"
    if any(i.get("severity") == "warning" and not i.get("actioned") for i in issues):
        return "warning"
    if data.get("engine_running") is False:
        return "stopped"
    return "ok"


def load_stream(stream_id: str) -> dict[str, Any] | None:
    with db() as c:
        row = c.execute(
            "SELECT stream_id, data, status, updated_at FROM streams WHERE stream_id = ?",
            (stream_id,),
        ).fetchone()
    if not row:
        return None
    data = json.loads(row["data"])
    data["status"] = row["status"]
    data["updated_at"] = row["updated_at"]
    data["age_seconds"] = age_seconds(row["updated_at"])
    if data["age_seconds"] > 86400:
        data["status"] = "stale"
    return data


def save_stream(stream_id: str, data: dict[str, Any], status: str, now: str) -> None:
    payload = json.dumps(data)
    with db() as c:
        c.execute(
            """INSERT INTO streams (stream_id, data, status, updated_at) VALUES (?, ?, ?, ?)
               ON CONFLICT(stream_id) DO UPDATE SET
                 data=excluded.data, status=excluded.status, updated_at=excluded.updated_at""",
            (stream_id, payload, status, now),
        )
        c.execute(
            "INSERT INTO stream_history (stream_id, data, status, recorded_at) VALUES (?,?,?,?)",
            (stream_id, payload, status, now),
        )
        c.execute(
            """DELETE FROM stream_history WHERE stream_id=?
               AND id NOT IN (SELECT id FROM stream_history WHERE stream_id=?
                              ORDER BY id DESC LIMIT ?)""",
            (stream_id, stream_id, HISTORY_LIMIT),
        )


def row_to_task(r: sqlite3.Row) -> dict[str, Any]:
    d = dict(r)
    d["depends_on"] = json.loads(d.get("depends_on") or "[]")
    return d


def row_to_project(r: sqlite3.Row) -> dict[str, Any]:
    return dict(r)


def task_elapsed_fmt(t: dict[str, Any]) -> str:
    secs = elapsed_seconds(t.get("started_at"), t.get("completed_at"))
    if secs is None:
        return "—"
    if secs < 60:
        return f"{secs}s"
    if secs < 3600:
        return f"{secs // 60}m"
    return f"{secs // 3600}h {(secs % 3600) // 60}m"


def est_cost(tokens: int, model: str | None) -> str:
    if not tokens or not model:
        return "—"
    rate = MODEL_COST_PER_M.get((model or "").lower(), None)
    if rate is None:
        return "—"
    cost = tokens * rate / 1_000_000
    return f"${cost:.4f}" if cost < 0.01 else f"${cost:.3f}"


def _unread_for(stream_id: str) -> list[dict[str, Any]]:
    with db() as c:
        rows = c.execute(
            "SELECT * FROM inbox_messages WHERE target_stream=? AND status!='resolved' ORDER BY id DESC",
            (stream_id,),
        ).fetchall()
    return [_row_to_msg(r) for r in rows]


def _row_to_msg(r: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": r["id"],
        "target_stream": r["target_stream"],
        "from_stream": r["from_stream"],
        "code": r["code"],
        "message": r["message"],
        "status": "resolved" if r["status"] == "resolved" else "unread",
        "sent_at": r["sent_at"],
        "resolved_at": r["resolved_at"],
    }


def _find_unresolved_msg(c: sqlite3.Connection, target: str, code: str) -> sqlite3.Row | None:
    return c.execute(
        "SELECT * FROM inbox_messages WHERE target_stream=? AND code=? AND status!='resolved' "
        "ORDER BY id DESC LIMIT 1",
        (target, code),
    ).fetchone()


# ── Stream API ───────────────────────────────────────────────────────────────

@app.get("/health")
def health() -> dict[str, Any]:
    with db() as c:
        ns = c.execute("SELECT COUNT(*) AS n FROM streams").fetchone()["n"]
        np = c.execute("SELECT COUNT(*) AS n FROM projects").fetchone()["n"]
        nt = c.execute("SELECT COUNT(*) AS n FROM tasks").fetchone()["n"]
    return {"status": "ok", "streams": ns, "projects": np, "tasks": nt,
            "uptime_seconds": int(time.time() - START_TS)}


@app.post("/api/streams/{stream_id}")
def upsert_stream(stream_id: str, body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    data = dict(body)
    data["stream_id"] = stream_id
    for key in ("status", "updated_at", "age_seconds"):
        data.pop(key, None)
    if "stream_type" in data and data["stream_type"] not in VALID_STREAM_TYPES:
        data["stream_type"] = "generic"
    if "stream_type" not in data:
        data["stream_type"] = "dev"
    # preserve existing issues if not explicitly sent
    if "active_issues" not in body:
        existing = load_stream(stream_id)
        if existing:
            data["active_issues"] = existing.get("active_issues", [])
    status = compute_status(data)
    now = utcnow()
    save_stream(stream_id, data, status, now)
    return {"stream_id": stream_id, "status": status, "updated_at": now}


@app.get("/api/streams")
def list_streams() -> list[dict[str, Any]]:
    with db() as c:
        rows = c.execute(
            "SELECT stream_id, data, status, updated_at FROM streams ORDER BY updated_at DESC"
        ).fetchall()
    out = []
    for row in rows:
        d = json.loads(row["data"])
        d["status"] = row["status"]
        d["updated_at"] = row["updated_at"]
        d["age_seconds"] = age_seconds(row["updated_at"])
        if d["age_seconds"] > 86400:
            d["status"] = "stale"
        out.append(d)
    return out


@app.get("/api/streams/{stream_id}")
def get_stream(stream_id: str) -> dict[str, Any]:
    s = load_stream(stream_id)
    if not s:
        raise HTTPException(status_code=404, detail=f"stream '{stream_id}' not found")
    return s


@app.get("/api/streams/{stream_id}/history")
def stream_history(stream_id: str, limit: int = 20) -> list[dict[str, Any]]:
    limit = max(1, min(limit, HISTORY_LIMIT))
    with db() as c:
        rows = c.execute(
            "SELECT data, status, recorded_at FROM stream_history WHERE stream_id=? "
            "ORDER BY id DESC LIMIT ?",
            (stream_id, limit),
        ).fetchall()
    return [{"recorded_at": r["recorded_at"], "status": r["status"],
             "data": json.loads(r["data"])} for r in rows]


@app.post("/api/streams/{stream_id}/issue")
def add_issue(stream_id: str, body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    severity = body.get("severity")
    code = body.get("code")
    message = body.get("message", "")
    if severity not in ("urgent", "warning", "info") or not code:
        raise HTTPException(status_code=400, detail="need severity in {urgent,warning,info} and code")
    data = load_stream(stream_id) or {"stream_id": stream_id, "stream_type": "dev", "active_issues": []}
    data.setdefault("active_issues", [])
    data["active_issues"] = [i for i in data["active_issues"] if i.get("code") != code]
    data["active_issues"].append({"severity": severity, "code": code, "message": message,
                                   "actioned": False, "raised_at": utcnow()})
    for key in ("status", "updated_at", "age_seconds"):
        data.pop(key, None)
    status = compute_status(data)
    now = utcnow()
    save_stream(stream_id, data, status, now)
    return {"stream_id": stream_id, "status": status, "updated_at": now}


@app.post("/api/streams/{stream_id}/resolve/{issue_code}")
def resolve_issue(stream_id: str, issue_code: str) -> dict[str, Any]:
    data = load_stream(stream_id)
    if not data:
        raise HTTPException(status_code=404, detail="stream not found")
    changed = False
    for i in data.get("active_issues", []):
        if i.get("code") == issue_code and not i.get("actioned"):
            i["actioned"] = True
            i["resolved_at"] = utcnow()
            changed = True
    if not changed:
        raise HTTPException(status_code=404, detail=f"no active issue '{issue_code}'")
    for key in ("status", "updated_at", "age_seconds"):
        data.pop(key, None)
    status = compute_status(data)
    now = utcnow()
    save_stream(stream_id, data, status, now)
    return {"stream_id": stream_id, "status": status, "updated_at": now}


@app.get("/api/urgent")
def urgent_streams() -> list[dict[str, Any]]:
    return [s for s in list_streams() if s.get("status") in ("urgent", "warning")]


# ── Inbox API ────────────────────────────────────────────────────────────────

@app.post("/api/streams/{target_id}/inbox")
def send_inbox(target_id: str, body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    from_stream = body.get("from_stream")
    code = body.get("code")
    message = body.get("message", "")
    if not from_stream or not code:
        raise HTTPException(status_code=400, detail="from_stream and code required")
    if from_stream == target_id:
        raise HTTPException(status_code=400, detail="cannot message yourself")
    now = utcnow()
    with db() as c:
        existing = _find_unresolved_msg(c, target_id, code)
        if existing:
            c.execute(
                "UPDATE inbox_messages SET from_stream=?, message=?, status='unread', "
                "sent_at=?, resolved_at=NULL WHERE id=?",
                (from_stream, message, now, existing["id"]),
            )
            row_id = existing["id"]
        else:
            cur = c.execute(
                "INSERT INTO inbox_messages (target_stream, from_stream, code, message, status, sent_at) "
                "VALUES (?, ?, ?, ?, 'unread', ?)",
                (target_id, from_stream, code, message, now),
            )
            row_id = cur.lastrowid
        row = c.execute("SELECT * FROM inbox_messages WHERE id=?", (row_id,)).fetchone()
    return _row_to_msg(row)


@app.get("/api/streams/{stream_id}/inbox")
def list_inbox(stream_id: str) -> list[dict[str, Any]]:
    return _unread_for(stream_id)


@app.post("/api/streams/{stream_id}/inbox/{code}/resolve")
def resolve_inbox(stream_id: str, code: str) -> dict[str, Any]:
    now = utcnow()
    with db() as c:
        row = _find_unresolved_msg(c, stream_id, code)
        if not row:
            raise HTTPException(status_code=404, detail=f"no unresolved message '{code}'")
        c.execute(
            "UPDATE inbox_messages SET status='resolved', resolved_at=? WHERE id=?",
            (now, row["id"]),
        )
        row = c.execute("SELECT * FROM inbox_messages WHERE id=?", (row["id"],)).fetchone()
    return _row_to_msg(row)


@app.post("/api/inbox/{msg_id}/resolve")
def resolve_inbox_by_id(msg_id: int) -> dict[str, Any]:
    """Resolve an inbox message by its numeric ID (used by governor auto-reply)."""
    now = utcnow()
    with db() as c:
        row = c.execute("SELECT * FROM inbox_messages WHERE id=?", (msg_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="message not found")
        c.execute(
            "UPDATE inbox_messages SET status='resolved', resolved_at=? WHERE id=?",
            (now, msg_id),
        )
        row = c.execute("SELECT * FROM inbox_messages WHERE id=?", (msg_id,)).fetchone()
    return _row_to_msg(row)


# ── Project scaffolding ───────────────────────────────────────────────────────

def _get_config_value(key: str, default: str = "") -> str:
    with db() as c:
        row = c.execute("SELECT value FROM config WHERE key=?", (key,)).fetchone()
    return row["value"] if row else default


def _slug(name: str) -> str:
    import re
    return re.sub(r"[^a-z0-9-]", "-", name.lower().strip()).strip("-") or "project"


def _git_init_project(folder: Path, pid: str) -> None:
    """Initialise a git repo in folder with an initial commit. Safe to call if .git already exists."""
    if (folder / ".git").exists():
        return
    git_name  = _get_config_value("git_user_name",  "BotMaster")
    git_email = _get_config_value("git_user_email", "bots@local")
    try:
        # git ≥ 2.28 supports -b; older versions don't
        r = subprocess.run(["git", "init", "-b", "main"], cwd=str(folder),
                           capture_output=True, text=True, timeout=30)
        if r.returncode != 0:
            subprocess.run(["git", "init"], cwd=str(folder),
                           capture_output=True, text=True, timeout=30)
            subprocess.run(["git", "checkout", "-b", "main"], cwd=str(folder),
                           capture_output=True, text=True, timeout=30)
        subprocess.run(["git", "config", "user.name",  git_name],  cwd=str(folder),
                       capture_output=True, text=True, timeout=10)
        subprocess.run(["git", "config", "user.email", git_email], cwd=str(folder),
                       capture_output=True, text=True, timeout=10)
        subprocess.run(["git", "add", "."], cwd=str(folder),
                       capture_output=True, text=True, timeout=30)
        subprocess.run(["git", "commit", "-m", "chore: initial project scaffold"],
                       cwd=str(folder), capture_output=True, text=True, timeout=30)
        _write_log("info", "system", f"Git repo initialised at {folder}", project_id=pid)
    except FileNotFoundError:
        _write_log("warn", "system", "git not found — skipping git init", project_id=pid)
    except Exception as exc:
        _write_log("warn", "system", f"git init failed: {exc}", project_id=pid)


def _scaffold_project(pid: str, name: str, description: str, tech_stack: str,
                      target_folder: Path | None = None) -> str:
    """Create project folder, memory dir, CLAUDE.md, memory files, and git repo. Returns project_path."""
    if target_folder is not None:
        folder = target_folder
    else:
        base = Path(_get_config_value("projects_base_dir",
                                       str(Path(__file__).resolve().parents[2] / "Projects")))
        folder = base / _slug(name)
    memory  = folder / "memory"
    folder.mkdir(parents=True, exist_ok=True)
    memory.mkdir(exist_ok=True)

    hub_url = f"http://localhost:{_get_config_value('hub_port', '9100')}"
    stuck_mins = _get_config_value("stuck_threshold_minutes", "10")

    # Always use the Python constant — the DB copy may predate the {{ }} escaping fix
    bot_protocol = _BOT_BEHAVIOR_TEMPLATE.format(
        hub_url=hub_url,
        stream_id=f"{_slug(name)}-001",
        project_id=pid,
        stuck_threshold_minutes=stuck_mins,
    )

    claude_md = dedent(f"""\
        # {name} — BotMaster Session Context

        ## Project
        **Name:** {name}
        **Tech Stack:** {tech_stack or 'not specified'}
        **Description:** {description or 'not specified'}
        **Project ID:** `{pid}`

        ## Hub Connection
        - Hub URL: {hub_url}
        - Your stream ID: `{_slug(name)}-001`  (change suffix if running multiple bots)
        - ⚠️  Post a status update every 3 minutes minimum or you will be flagged stuck after {stuck_mins} min

        ## Startup Checklist
        1. Read this file and `memory/workflow.md`
        2. POST to hub: `{hub_url}/api/streams/{_slug(name)}-001`  status=starting
        3. GET next task: `{hub_url}/api/tasks/next?project_id={pid}`
        4. PATCH task status to in_progress, start work
        5. Commit regularly, post hub status after each commit

        ## Done Criteria
        A task is complete when:
        - All specified functionality works and is tested
        - Task PATCHed to status=review with a completion note

        The project is complete when all tasks have status `done`.

        ## IMPORTANT — Hard Rules (follow without exception)
        1. **Do NOT use git** (no git add, git commit, git push, git checkout, etc.) unless the task description explicitly tells you to. Just write and edit files directly.
        2. **Stay in your working folder.** Only read and write files inside this project directory. Do not navigate to parent directories, other projects, or system folders.
        3. If you are unsure whether an action is in scope, do nothing and report your uncertainty in a hub status update.
    """)
    if bot_protocol:
        claude_md += "\n" + bot_protocol

    workflow_md = dedent(f"""\
        # BotMaster Workflow for {name}

        BotMaster coordinates multiple AI bots working on this project in parallel.

        ## Reporting Status
        POST status updates to: {hub_url}
        ⚠️  No update for {stuck_mins} minutes = flagged stuck = session may be killed.
        Post AT MINIMUM every 3 minutes. Even "still working on X" counts.

        ## Task Lifecycle
        queued → in_progress → review → done
        queued → blocked (if a dependency isn't done yet)

        ## Dependency Rules
        - Never start a task until all its `depends_on` tasks are `done`
        - `GET {hub_url}/api/tasks/next?project_id={pid}` only returns tasks with deps met

        ## Coordination Protocol
        1. Check which files/modules other bots own before editing
        2. Commit frequently — small commits, clear messages
        3. Post a hub status update after each commit
        4. If stuck: update status to `blocked` with a note explaining why

        ## Completion Signal
        When you complete a task, BotMaster sees the `done` status and may:
        - Assign you the next available task
        - Signal dependent tasks that they can now start
        - Notify you via hub inbox if human review is needed
    """)

    project_md = dedent(f"""\
        # {name} — Project Memory

        **Created:** {datetime.now().strftime('%Y-%m-%d')}
        **Tech Stack:** {tech_stack or 'not specified'}

        ## Description
        {description or 'No description provided.'}

        ## Key Decisions
        (Update as you make architectural decisions)

        ## Progress
        (Update as tasks are completed)
    """)

    (folder / "CLAUDE.md").write_text(claude_md, encoding="utf-8")
    (memory / "workflow.md").write_text(workflow_md, encoding="utf-8")
    (memory / "project.md").write_text(project_md, encoding="utf-8")

    _write_log("info", "system", f"Project scaffold created: {folder}", project_id=pid)
    _git_init_project(folder, pid)
    return str(folder)


# ── Project API ──────────────────────────────────────────────────────────────

def _clone_folder(src: Path, dst: Path, pid: str) -> None:
    """Recursively copy src to dst, skipping .git and .venv."""
    import shutil
    skip = {".git", ".venv", "node_modules", "__pycache__"}
    dst.mkdir(parents=True, exist_ok=True)
    for item in src.iterdir():
        if item.name in skip:
            continue
        target = dst / item.name
        if item.is_dir():
            shutil.copytree(str(item), str(target), ignore=shutil.ignore_patterns(*skip), dirs_exist_ok=True)
        else:
            shutil.copy2(str(item), str(target))
    _write_log("info", "system", f"Cloned {src} → {dst}", project_id=pid)


@app.post("/api/projects")
def create_project(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    """
    folder_mode controls how the project folder is handled:
      "new"      (default) — scaffold a fresh folder under projects_base_dir
      "existing" — point to an existing folder; read its CLAUDE.md / memory files
      "clone"    — copy an existing folder to a new location, then scaffold on top
    body params:
      project_path   — required for "existing"; source path for "clone"
      clone_dest     — destination for "clone" (defaults to projects_base_dir/{slug})
    """
    pid = body.get("id") or f"proj-{int(time.time())}"
    name = body.get("name")
    if not name:
        raise HTTPException(status_code=400, detail="name required")
    description  = body.get("description", "")
    tech_stack   = body.get("tech_stack", "")
    status       = body.get("status", "planning")
    folder_mode  = body.get("folder_mode", "new")   # new | existing | clone
    project_path = body.get("project_path", "").strip()
    clone_dest   = body.get("clone_dest", "").strip()
    now = utcnow()
    with db() as c:
        existing = c.execute("SELECT id FROM projects WHERE id=?", (pid,)).fetchone()
        if existing:
            raise HTTPException(status_code=409, detail=f"project '{pid}' already exists")
        c.execute(
            "INSERT INTO projects (id, name, description, tech_stack, status, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (pid, name, description, tech_stack, status, now, now),
        )
        row = c.execute("SELECT * FROM projects WHERE id=?", (pid,)).fetchone()

    # Scaffold project folder outside the DB transaction
    try:
        if folder_mode == "existing" and project_path:
            src = Path(project_path)
            if not src.exists():
                raise ValueError(f"Folder not found: {project_path}")
            # Just point to it; don't overwrite anything
            resolved_path = str(src)
            _write_log("info", "system", f"Project linked to existing folder: {resolved_path}", project_id=pid)
        elif folder_mode == "clone" and project_path:
            src = Path(project_path)
            if not src.exists():
                raise ValueError(f"Source folder not found: {project_path}")
            base = Path(_get_config_value("projects_base_dir",
                                           str(Path(__file__).resolve().parents[2] / "Projects")))
            dst = Path(clone_dest) if clone_dest else base / _slug(name)
            _clone_folder(src, dst, pid)
            # Scaffold CLAUDE.md on top with new project identity
            _scaffold_project(pid, name, description, tech_stack, target_folder=dst)
            resolved_path = str(dst)
        else:
            # Use the caller-supplied path if given; otherwise _scaffold_project
            # derives base_dir + slug(name) itself.
            target = Path(project_path) if project_path else None
            resolved_path = _scaffold_project(pid, name, description, tech_stack, target_folder=target)

        with db() as c:
            c.execute("UPDATE projects SET project_path=? WHERE id=?", (resolved_path, pid))
            row = c.execute("SELECT * FROM projects WHERE id=?", (pid,)).fetchone()
    except Exception as exc:
        _write_log("warn", "system", f"Project folder setup failed: {exc}", project_id=pid)

    _write_audit("project_created", "project", pid, project_id=pid,
                 details={"name": name, "folder_mode": folder_mode, "status": status})
    return row_to_project(row)


@app.get("/api/projects")
def list_projects(include_deleted: bool = False) -> list[dict[str, Any]]:
    with db() as c:
        if include_deleted:
            rows = c.execute("SELECT * FROM projects ORDER BY created_at DESC").fetchall()
        else:
            rows = c.execute("SELECT * FROM projects WHERE deleted_at IS NULL ORDER BY created_at DESC").fetchall()
    return [row_to_project(r) for r in rows]


@app.get("/api/projects/{project_id}")
def get_project(project_id: str) -> dict[str, Any]:
    with db() as c:
        row = c.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="project not found")
        tasks = c.execute(
            "SELECT * FROM tasks WHERE project_id=? ORDER BY priority, created_at",
            (project_id,),
        ).fetchall()
        missions = c.execute(
            "SELECT * FROM missions WHERE project_id=? ORDER BY created_at DESC",
            (project_id,),
        ).fetchall()
    p = row_to_project(row)
    p["tasks"] = [row_to_task(t) for t in tasks]
    p["missions"] = [dict(m) for m in missions]
    return p


@app.patch("/api/projects/{project_id}")
def update_project(project_id: str, body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    with db() as c:
        row = c.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="project not found")
        updates: dict[str, Any] = {}
        for field in ("name", "description", "tech_stack", "status", "project_path"):
            if field in body:
                updates[field] = body[field]
        if "status" in updates and updates["status"] not in VALID_PROJECT_STATUSES:
            raise HTTPException(status_code=400, detail=f"status must be one of {VALID_PROJECT_STATUSES}")
        if updates:
            updates["updated_at"] = utcnow()
            set_clause = ", ".join(f"{k}=?" for k in updates)
            c.execute(f"UPDATE projects SET {set_clause} WHERE id=?",
                      [*updates.values(), project_id])
        row = c.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone()
    return row_to_project(row)


@app.delete("/api/projects/{project_id}")
def delete_project(project_id: str) -> dict[str, Any]:
    """Soft-delete: sets deleted_at timestamp. Project data is never purged."""
    with db() as c:
        row = c.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="project not found")
        now = utcnow()
        c.execute(
            "UPDATE projects SET deleted_at=?, status='archived', updated_at=? WHERE id=?",
            (now, now, project_id),
        )
        row = c.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone()
    _write_log("info", "system", f"Project {project_id} moved to trash", project_id=project_id)
    return row_to_project(row)


@app.post("/api/projects/{project_id}/restore")
def restore_project(project_id: str) -> dict[str, Any]:
    """Restore a soft-deleted project back to active."""
    with db() as c:
        row = c.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="project not found")
        now = utcnow()
        c.execute(
            "UPDATE projects SET deleted_at=NULL, status='active', updated_at=? WHERE id=?",
            (now, project_id),
        )
        row = c.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone()
    _write_log("info", "system", f"Project {project_id} restored from trash", project_id=project_id)
    return row_to_project(row)


# ── Filesystem browser ────────────────────────────────────────────────────────

@app.get("/api/fs/check")
def fs_check(path: str) -> dict[str, Any]:
    """Return whether a path exists and is a directory."""
    target = Path(path)
    return {"path": str(target), "exists": target.exists(), "is_dir": target.is_dir() if target.exists() else False}


@app.post("/api/fs/mkdir")
def fs_mkdir(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    """Create a directory (including any missing parents). Returns the created path."""
    path = body.get("path", "").strip()
    if not path:
        raise HTTPException(status_code=400, detail="path required")
    target = Path(path)
    try:
        target.mkdir(parents=True, exist_ok=True)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    return {"path": str(target), "created": True}


@app.get("/api/fs/browse")
def fs_browse(path: str = "") -> dict[str, Any]:
    """List subdirectories at path. Returns {path, parent, dirs:[{name,path}]}."""
    if not path:
        path = _get_config_value(
            "projects_base_dir",
            str(Path(__file__).resolve().parents[2] / "Projects"),
        )
    target = Path(path)
    if not target.exists() or not target.is_dir():
        target = Path.home()
    try:
        dirs = sorted(
            [
                {"name": d.name, "path": str(d)}
                for d in target.iterdir()
                if d.is_dir() and not d.name.startswith(".")
            ],
            key=lambda x: x["name"].lower(),
        )
    except PermissionError:
        dirs = []
    parent = str(target.parent) if target.parent != target else None
    return {"path": str(target), "parent": parent, "dirs": dirs}


# ── Mission API ───────────────────────────────────────────────────────────────

@app.post("/api/missions")
def create_mission(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    project_id = body.get("project_id")
    name = body.get("name")
    if not project_id or not name:
        raise HTTPException(status_code=400, detail="project_id and name required")
    with db() as c:
        if not c.execute("SELECT id FROM projects WHERE id=?", (project_id,)).fetchone():
            raise HTTPException(status_code=404, detail="project not found")
        now = utcnow()
        mid = body.get("id") or f"m-{int(time.time() * 1000) % 1_000_000}"
        c.execute(
            """INSERT INTO missions
               (id, project_id, name, description, success_criteria, tech_notes,
                worktree_base, branch_prefix, model_hint, git_enabled, status, created_at, updated_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (mid, project_id, name,
             body.get("description", ""),
             body.get("success_criteria", ""),
             body.get("tech_notes", ""),
             body.get("worktree_base", ""),
             body.get("branch_prefix", "feature/"),
             body.get("model_hint", ""),
             1 if body.get("git_enabled", True) else 0,
             body.get("status", "active"), now, now)
        )
        row = c.execute("SELECT * FROM missions WHERE id=?", (mid,)).fetchone()
    _write_log("info", "system", f"Mission created: {name}", project_id=project_id)
    _write_audit("mission_created", "mission", mid, project_id=project_id, mission_id=mid, details={"name": name})
    return dict(row)


@app.get("/api/missions")
def list_missions(project_id: str | None = None) -> list[dict[str, Any]]:
    where = "WHERE project_id=?" if project_id else ""
    params = [project_id] if project_id else []
    with db() as c:
        rows = c.execute(f"SELECT * FROM missions {where} ORDER BY created_at DESC", params).fetchall()
    result = []
    for r in rows:
        m = dict(r)
        if m.get("plan_qa") and isinstance(m["plan_qa"], str):
            try:
                m["plan_qa"] = json.loads(m["plan_qa"])
            except Exception:
                m["plan_qa"] = None
        result.append(m)
    return result


@app.get("/api/missions/{mission_id}")
def get_mission(mission_id: str) -> dict[str, Any]:
    with db() as c:
        row = c.execute("SELECT * FROM missions WHERE id=?", (mission_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="mission not found")
        tasks = c.execute(
            "SELECT * FROM tasks WHERE mission_id=? ORDER BY priority, created_at", (mission_id,)
        ).fetchall()
    m = dict(row)
    m["tasks"] = [row_to_task(t) for t in tasks]
    if m.get("plan_qa") and isinstance(m["plan_qa"], str):
        try:
            m["plan_qa"] = json.loads(m["plan_qa"])
        except Exception:
            m["plan_qa"] = None
    return m


@app.patch("/api/missions/{mission_id}")
def update_mission(mission_id: str, body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    with db() as c:
        row = c.execute("SELECT * FROM missions WHERE id=?", (mission_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="mission not found")
        old = dict(row)
        updates: dict[str, Any] = {}
        for field in ("name", "description", "success_criteria", "tech_notes",
                      "worktree_base", "branch_prefix", "model_hint", "status", "stage", "final_prompt"):
            if field in body:
                updates[field] = body[field]
        if "git_enabled" in body:
            updates["git_enabled"] = 1 if body["git_enabled"] else 0
        if "plan_qa" in body:
            updates["plan_qa"] = json.dumps(body["plan_qa"]) if isinstance(body["plan_qa"], dict) else body["plan_qa"]
        if updates:
            updates["updated_at"] = utcnow()
            set_clause = ", ".join(f"{k}=?" for k in updates)
            c.execute(f"UPDATE missions SET {set_clause} WHERE id=?", [*updates.values(), mission_id])
        row = c.execute("SELECT * FROM missions WHERE id=?", (mission_id,)).fetchone()
    if "stage" in updates and updates["stage"] != old.get("stage"):
        _write_audit("stage_changed", "mission", mission_id,
                     project_id=old.get("project_id"), mission_id=mission_id,
                     details={"from": old.get("stage"), "to": updates["stage"]})
    return dict(row)


# ── Mission Questions API ─────────────────────────────────────────────────────

@app.get("/api/missions/{mission_id}/questions")
def mission_questions(mission_id: str) -> list[dict[str, Any]]:
    """Return all unresolved inbox messages from bots working on this mission."""
    with db() as c:
        workers = c.execute(
            "SELECT stream_id FROM workers WHERE mission_id=? AND status IN ('active','idle','starting')",
            (mission_id,),
        ).fetchall()
    results = []
    for w in workers:
        msgs = _unread_for(w["stream_id"])
        for m in msgs:
            m["stream_id"] = w["stream_id"]
            results.append(m)
    results.sort(key=lambda m: m["sent_at"], reverse=True)
    return results


@app.post("/api/missions/{mission_id}/start")
def start_mission_bot(mission_id: str, body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    """Quick-start: create a worker for this mission and optionally spawn it."""
    with db() as c:
        mission = c.execute("SELECT * FROM missions WHERE id=?", (mission_id,)).fetchone()
        if not mission:
            raise HTTPException(status_code=404, detail="mission not found")
        m = dict(mission)
    project_id = m["project_id"]
    suffix = body.get("suffix", "bot")
    stream_id = body.get("stream_id") or f"{mission_id.replace('mission-','')}-{suffix}"
    task_id = body.get("task_id") or None

    # Resolve runner_type and model: body → task row → mission hint → config defaults
    task_row: dict | None = None
    if task_id:
        with db() as c:
            r = c.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
            if r:
                task_row = dict(r)
    if not task_row and not body.get("runner_type"):
        # Pick the first queued task for the mission to inherit its runner config
        with db() as c:
            r = c.execute(
                "SELECT * FROM tasks WHERE mission_id=? AND status='queued' ORDER BY priority DESC LIMIT 1",
                (mission_id,),
            ).fetchone()
            if r:
                task_row = dict(r)

    runner_type = body.get("runner_type") or (task_row or {}).get("runner_type") or _get_config_value("default_runner", "ollama")
    _default_model = (
        _get_config_value("ollama_default_model", "qwen3-coder:latest")
        if runner_type in ("ollama", "aider")
        else _get_config_value("default_model", "sonnet")
    )
    model = body.get("model") or (task_row or {}).get("model_hint") or m.get("model_hint") or _default_model
    worktree = m.get("worktree_base") or ""
    branch = f"{m.get('branch_prefix', 'feature/')}{suffix}"
    notes = body.get("notes", "")
    now = utcnow()

    # If task_id given, use task's working_dir as worktree if mission has none
    if task_row and not worktree and task_row.get("working_dir"):
        worktree = task_row["working_dir"]
    with db() as c:
        worker_id = f"w-{stream_id}-{int(time.time())}"
        c.execute(
            """INSERT INTO workers
               (id, project_id, mission_id, task_id, stream_id, status, model, worktree_path,
                branch, git_root, spawned_by, runner_type, created_at, updated_at, notes)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (worker_id, project_id, mission_id, task_id, stream_id,
             "pending", model, worktree or None, branch, worktree or None,
             "user", runner_type, now, now, notes),
        )
        row = c.execute("SELECT * FROM workers WHERE id=?", (worker_id,)).fetchone()
    with db() as c:
        c.execute("UPDATE missions SET stage='running', updated_at=? WHERE id=? AND stage IN ('draft','review','approved')",
                  (now, mission_id))
    _write_log("info", "system", f"Bot {stream_id} created for mission {mission_id}",
               project_id=project_id)
    _write_audit("bot_started", "worker", worker_id,
                 project_id=project_id, mission_id=mission_id,
                 details={"stream_id": stream_id, "model": model})
    worker = _row_to_worker(row)
    if body.get("spawn", False):
        try:
            spawn_result = spawn_worker(worker_id)
            worker["spawn_result"] = spawn_result
        except Exception as exc:
            worker["spawn_error"] = str(exc)
    return worker


@app.post("/api/missions/{mission_id}/review-plan")
async def review_mission_plan(mission_id: str, body: dict[str, Any] = Body({})) -> dict[str, Any]:
    """AI reviews the mission plan. Accepts prior answers as context for re-runs.
    Saves result to mission.plan_qa and sets stage='review'."""
    with db() as c:
        mission = c.execute("SELECT * FROM missions WHERE id=?", (mission_id,)).fetchone()
        if not mission:
            raise HTTPException(status_code=404, detail="mission not found")
        tasks = c.execute(
            "SELECT title, description, status, depends_on FROM tasks WHERE mission_id=? ORDER BY priority DESC",
            (mission_id,),
        ).fetchall()
        project = c.execute("SELECT name, tech_stack FROM projects WHERE id=?", (mission["project_id"],)).fetchone()

    m = dict(mission)
    # Prior answers passed by the client for re-runs
    prior_answers: list[dict] = body.get("prior_answers", [])

    task_lines = "\n".join(
        f"  [{t['status']}] {t['title']}" + (f": {t['description'][:80]}" if t['description'] else "")
        for t in tasks
    ) or "  (no objectives added yet)"

    answered_context = ""
    if prior_answers:
        filled = [a for a in prior_answers if a.get("answer", "").strip()]
        if filled:
            answered_context = "\n\nAlready clarified by the user (do not ask these again):\n" + "\n".join(
                f"  Q: {a['question']}\n  A: {a['answer']}"
                for a in filled
            )

    def _save_and_return(data: dict) -> dict[str, Any]:
        # Merge new questions with any existing answers the user already provided
        qa_map = {a["question"]: a.get("answer", "") for a in prior_answers if a.get("answer", "").strip()}
        for q in data.get("questions", []):
            q["answer"] = qa_map.get(q["question"], "")
        data["reviewed_at"] = utcnow()
        now = utcnow()
        with db() as c:
            c.execute(
                "UPDATE missions SET plan_qa=?, stage='review', updated_at=? WHERE id=?",
                (json.dumps(data), now, mission_id),
            )
        _write_audit("plan_reviewed", "mission", mission_id,
                     project_id=m.get("project_id"), mission_id=mission_id,
                     details={"questions_count": len(data.get("questions", [])), "answered": len(qa_map)})
        return data

    api_key = _get_config_value("anthropic_api_key")
    if not api_key:
        data = {
            "analysis": "No Anthropic API key — AI analysis unavailable. Review the objectives below and answer any questions that apply. Add your key in Settings for full AI analysis.",
            "questions": [
                {"topic": "Success Criteria", "question": "What does a successful run look like — what files, outputs, or test results confirm it's done?", "context": "Gives the bot a concrete finish line to verify against.", "answer": ""},
                {"topic": "Error Handling", "question": "How should the bot handle unexpected errors or edge cases — fail fast, log and continue, or ask?", "context": "Determines whether the bot should stop and report, or push through.", "answer": ""},
                {"topic": "Existing Code", "question": "Is there existing code or structure the bot must integrate with or preserve?", "context": "Prevents the bot from overwriting existing work.", "answer": ""},
            ],
        }
        return _save_and_return(data)

    prompt = dedent(f"""\
        You are a senior software architect reviewing an AI bot's mission plan before it starts work.

        Project: {project["name"] if project else "unknown"}
        Tech stack: {project["tech_stack"] if project else m.get("tech_notes", "not specified")}
        Mission: {m["name"]}
        Goal: {m["description"] or "not specified"}
        Success criteria: {m["success_criteria"] or "not specified"}
        Bot notes: {m["tech_notes"] or "none"}

        Objectives ({len(tasks)}):
        {task_lines}{answered_context}

        Your job: identify gaps and ambiguities that will cause the bot to make wrong assumptions or ask questions mid-work. Do NOT repeat questions already answered above.

        Respond with ONLY valid JSON in exactly this format:
        {{
          "analysis": "2-3 sentence assessment: is the plan solid, what are the main risks or gaps?",
          "questions": [
            {{"topic": "short label (2-4 words)", "question": "the actual question", "context": "one sentence on why this matters", "answer": ""}}
          ]
        }}

        Generate 3-5 questions. Prioritise: ambiguous requirements, missing technical constraints, unclear success criteria, risky dependencies. Be concrete and specific to this mission.
    """)

    payload = json.dumps({
        "model": "claude-haiku-4-5-20251001",
        "max_tokens": 700,
        "messages": [{"role": "user", "content": prompt}],
    }).encode()

    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages",
        data=payload,
        headers={"x-api-key": api_key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read())
        text = result["content"][0]["text"].strip()
        if text.startswith("```"):
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
        data = json.loads(text)
        return _save_and_return(data)
    except json.JSONDecodeError:
        data = {"analysis": "AI returned an unreadable response — review the plan manually.", "questions": []}
        return _save_and_return(data)
    except urllib.error.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Anthropic API error {e.code}: {e.read().decode()[:200]}")
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Plan review failed: {exc}")


@app.post("/api/tasks/{task_id}/improve-prompt")
async def improve_task_prompt(task_id: str, body: dict[str, Any] = Body({})) -> dict[str, Any]:
    """Use AI to improve a single objective's prompt/description."""
    with db() as c:
        task = c.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
        if not task:
            raise HTTPException(status_code=404, detail="task not found")
        mission = None
        if task["mission_id"]:
            mission = c.execute("SELECT name, description, tech_notes FROM missions WHERE id=?", (task["mission_id"],)).fetchone()
        project = None
        if task["project_id"]:
            project = c.execute("SELECT name, tech_stack, project_path FROM projects WHERE id=?", (task["project_id"],)).fetchone()

    current = body.get("current_description", task["description"] or "")
    steer = body.get("steer", "")

    api_key = _get_config_value("anthropic_api_key")
    if not api_key:
        return {"improved": current or f"Implement: {task['title']}", "reasoning": "No Anthropic API key — returning as-is."}

    ctx: list[str] = []
    if project:
        ctx.append(f"Project: {project['name']}")
        if project.get("tech_stack"):
            ctx.append(f"Tech stack: {project['tech_stack']}")
        if project.get("project_path"):
            ctx.append(f"Project folder: {project['project_path']}")
    if mission:
        ctx.append(f"Mission: {mission['name']}")
        if mission.get("description"):
            ctx.append(f"Mission goal: {mission['description']}")
        if mission.get("tech_notes"):
            ctx.append(f"Tech notes: {mission['tech_notes']}")

    steer_line = f"\nUser guidance: {steer.strip()}" if steer.strip() else ""

    prompt = dedent(f"""\
        You are helping write a precise, actionable task prompt for an AI coding bot.

        Context:
        {chr(10).join(ctx) or "No additional context."}

        Objective title: {task['title']}

        Current description (may be empty or rough):
        {current or "(empty)"}
        {steer_line}

        Write an improved description for this objective. It should:
        - State exactly what to build, create, change, or fix — no vague verbs
        - Include relevant file paths, component names, or API names if they can be inferred
        - Mention acceptance criteria or "done" definition where obvious
        - Be 2-5 sentences, dense with specifics
        - NOT include instructions about reporting progress or updating status

        Respond with ONLY valid JSON:
        {{"improved": "the improved description", "reasoning": "one sentence: what you added or clarified"}}
    """)

    payload = json.dumps({
        "model": "claude-haiku-4-5-20251001",
        "max_tokens": 400,
        "messages": [{"role": "user", "content": prompt}],
    }).encode()

    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages",
        data=payload,
        headers={"x-api-key": api_key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            result = json.loads(resp.read())
        text = result["content"][0]["text"].strip()
        if text.startswith("```"):
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
        return json.loads(text)
    except (json.JSONDecodeError, KeyError):
        return {"improved": current, "reasoning": "AI returned an unreadable response."}
    except urllib.error.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Anthropic API error {e.code}")
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Improve prompt failed: {exc}")


@app.post("/api/tasks/{task_id}/review-objective")
async def review_objective(task_id: str, body: dict[str, Any] = Body({})) -> dict[str, Any]:
    """Generate AI questions specific to a single objective. Results are not stored — client manages state."""
    with db() as c:
        task = c.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
        if not task:
            raise HTTPException(status_code=404, detail="task not found")
        mission = None
        if task["mission_id"]:
            mission = c.execute("SELECT name, description, tech_notes FROM missions WHERE id=?", (task["mission_id"],)).fetchone()
        project = None
        if task["project_id"]:
            project = c.execute("SELECT name, tech_stack, project_path FROM projects WHERE id=?", (task["project_id"],)).fetchone()

    description = task["description"] or ""
    prior_answers: list[dict] = body.get("prior_answers", [])

    api_key = _get_config_value("anthropic_api_key")
    if not api_key:
        return {
            "analysis": "No Anthropic API key — add one in Settings for AI-generated questions. Generic prompts shown below.",
            "questions": [
                {"topic": "Output", "question": f"What specific files, functions, or outputs should '{task['title']}' produce?", "context": "Defines exactly what the bot must create or change.", "answer": ""},
                {"topic": "Done When", "question": "How will you verify this objective is complete — what test, check, or visual confirms it?", "context": "Gives the bot a concrete acceptance condition.", "answer": ""},
            ],
        }

    ctx: list[str] = []
    if project:
        ctx.append(f"Project: {project['name']}")
        if project.get("tech_stack"): ctx.append(f"Tech: {project['tech_stack']}")
        if project.get("project_path"): ctx.append(f"Folder: {project['project_path']}")
    if mission:
        ctx.append(f"Mission: {mission['name']}")
        if mission.get("description"): ctx.append(f"Goal: {mission['description']}")
        if mission.get("tech_notes"): ctx.append(f"Notes: {mission['tech_notes']}")

    prior_str = ""
    if prior_answers:
        filled = [a for a in prior_answers if a.get("answer", "").strip()]
        if filled:
            prior_str = "\n\nAlready answered — do not repeat these:\n" + "\n".join(
                f"  Q: {a['question']}\n  A: {a['answer']}" for a in filled
            )

    prompt = dedent(f"""\
        You are reviewing a single objective in an AI coding bot's mission plan.

        Context:
        {chr(10).join(ctx) or "Not specified."}

        Objective: {task['title']}
        Current description: {description or "(not written yet)"}
        {prior_str}

        Identify 2-4 questions that, if answered, would make this objective completely unambiguous for an AI coder.
        Focus on: unclear scope, missing file/component names, unspecified constraints, ambiguous acceptance criteria.
        Do NOT repeat questions already answered above.

        Respond with ONLY valid JSON:
        {{
          "analysis": "1-2 sentences: is this objective specific enough, and what is the main gap if any?",
          "questions": [
            {{"topic": "2-3 word label", "question": "the question", "context": "one sentence: why this matters", "answer": ""}}
          ]
        }}
    """)

    payload = json.dumps({
        "model": "claude-haiku-4-5-20251001",
        "max_tokens": 500,
        "messages": [{"role": "user", "content": prompt}],
    }).encode()

    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages",
        data=payload,
        headers={"x-api-key": api_key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            result = json.loads(resp.read())
        text = result["content"][0]["text"].strip()
        if text.startswith("```"):
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
        return json.loads(text)
    except (json.JSONDecodeError, KeyError):
        return {"analysis": "AI returned an unreadable response.", "questions": []}
    except urllib.error.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Anthropic API error {e.code}")
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Objective review failed: {exc}")


@app.get("/api/missions/{mission_id}/report")
def mission_report(mission_id: str) -> dict[str, Any]:
    """Generate a completion report for a mission."""
    with db() as c:
        mission = c.execute("SELECT * FROM missions WHERE id=?", (mission_id,)).fetchone()
        if not mission:
            raise HTTPException(status_code=404, detail="mission not found")
        tasks = c.execute(
            "SELECT * FROM tasks WHERE mission_id=? ORDER BY priority DESC",
            (mission_id,),
        ).fetchall()
        workers = c.execute(
            "SELECT * FROM workers WHERE mission_id=?", (mission_id,),
        ).fetchall()
        bot_events = c.execute(
            "SELECT * FROM bot_events WHERE mission_id=? ORDER BY created_at",
            (mission_id,),
        ).fetchall()
        reviews = c.execute(
            "SELECT * FROM reviews WHERE mission_id=?", (mission_id,),
        ).fetchall()
        project = c.execute(
            "SELECT name, tech_stack FROM projects WHERE id=?", (mission["project_id"],),
        ).fetchone()

    m = dict(mission)
    done_tasks  = [t for t in tasks if t["status"] == "done"]
    total_tokens = sum(t["cost_tokens"] or 0 for t in tasks)

    # Per-model breakdown from bot_events
    model_stats: dict[str, dict[str, Any]] = {}
    for ev in bot_events:
        mdl = ev["model"] or "unknown"
        if mdl not in model_stats:
            model_stats[mdl] = {"tasks_completed": 0, "prompt_tokens": 0, "completion_tokens": 0, "events": 0}
        model_stats[mdl]["events"] += 1
        model_stats[mdl]["prompt_tokens"] += ev["prompt_tokens"] or 0
        model_stats[mdl]["completion_tokens"] += ev["completion_tokens"] or 0
        if ev["event_type"] == "task_done":
            model_stats[mdl]["tasks_completed"] += 1

    avg_rating = None
    if reviews:
        avg_rating = round(sum(r["rating"] for r in reviews) / len(reviews), 2)

    all_flags: dict[str, int] = {}
    for r in reviews:
        flags = json.loads(r["flags"]) if isinstance(r["flags"], str) else (r["flags"] or [])
        for f in flags:
            all_flags[f] = all_flags.get(f, 0) + 1

    task_rows = []
    for t in tasks:
        deps = json.loads(t["depends_on"]) if isinstance(t["depends_on"], str) else (t["depends_on"] or [])
        task_rows.append({
            "id": t["id"], "title": t["title"], "status": t["status"],
            "model_hint": t["model_hint"], "cost_tokens": t["cost_tokens"] or 0,
            "started_at": t["started_at"], "completed_at": t["completed_at"],
            "notes": t["notes"] or "", "depends_on_count": len(deps),
        })

    return {
        "mission_id": mission_id,
        "mission_name": m["name"],
        "project_name": project["name"] if project else None,
        "tech_stack": project["tech_stack"] if project else None,
        "description": m["description"],
        "success_criteria": m["success_criteria"],
        "status": m["status"],
        "created_at": m["created_at"],
        "updated_at": m["updated_at"],
        "total_tasks": len(tasks),
        "done_tasks": len(done_tasks),
        "incomplete_tasks": len(tasks) - len(done_tasks),
        "total_tokens": total_tokens,
        "total_workers": len(workers),
        "bot_events_count": len(bot_events),
        "model_stats": model_stats,
        "avg_rating": avg_rating,
        "reviews_count": len(reviews),
        "quality_flags": all_flags,
        "tasks": task_rows,
    }


# ── AI Assist API ─────────────────────────────────────────────────────────────

@app.post("/api/ai/suggest-mission")
async def suggest_mission(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    """Call Claude to draft a bot briefing for a mission."""
    api_key = _get_config_value("anthropic_api_key")
    if not api_key:
        raise HTTPException(status_code=400, detail="anthropic_api_key not set in Settings")

    project_name  = body.get("project_name", "")
    tech_stack    = body.get("tech_stack", "")
    mission_name  = body.get("mission_name", "")
    description   = body.get("description", "")
    success_crit  = body.get("success_criteria", "")

    prompt = dedent(f"""\
        You are helping configure an AI coding bot for a software mission.
        Write a concise **Bot Briefing** the bot will read in its CLAUDE.md before starting work.

        Project: {project_name}
        Tech stack: {tech_stack or 'not specified'}
        Mission: {mission_name}
        Goal: {description or 'not specified'}
        Success criteria: {success_crit or 'not specified'}

        Respond with ONLY the bot briefing text — no preamble, no markdown headings, no explanation.
        Use short bullet lines. Cover:
        1. Stack & key libraries (1–3 bullets)
        2. Patterns/conventions to follow (1–3 bullets)
        3. Things to avoid (1–2 bullets)
        4. Gotchas or risks the bot should watch out for (1–2 bullets, or omit if none obvious)

        Be terse and specific. Use "- " prefix for each bullet.
    """)

    payload = json.dumps({
        "model": "claude-haiku-4-5-20251001",
        "max_tokens": 400,
        "messages": [{"role": "user", "content": prompt}],
    }).encode()

    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages",
        data=payload,
        headers={
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read())
        text = result["content"][0]["text"].strip()
        return {"briefing": text}
    except urllib.error.HTTPError as e:
        body_bytes = e.read()
        raise HTTPException(status_code=502, detail=f"Anthropic API error {e.code}: {body_bytes.decode()[:200]}")
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"AI suggestion failed: {exc}")


# ── Task API ─────────────────────────────────────────────────────────────────

@app.post("/api/tasks")
def create_task(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    project_id = body.get("project_id")
    title = body.get("title")
    if not project_id or not title:
        raise HTTPException(status_code=400, detail="project_id and title required")
    with db() as c:
        proj = c.execute("SELECT id FROM projects WHERE id=?", (project_id,)).fetchone()
        if not proj:
            raise HTTPException(status_code=404, detail=f"project '{project_id}' not found")
        now = utcnow()
        task_id = body.get("id") or f"{project_id}-{int(time.time() * 1000) % 100000}"
        existing = c.execute("SELECT id FROM tasks WHERE id=?", (task_id,)).fetchone()
        if existing:
            raise HTTPException(status_code=409, detail=f"task '{task_id}' already exists")
        depends_on = json.dumps(body.get("depends_on") or [])
        c.execute(
            """INSERT INTO tasks
               (id, project_id, mission_id, title, description, stream_id, branch, status,
                priority, model_hint, runner_type, depends_on, cost_tokens, created_at, updated_at,
                notes, working_dir, folder_mode, git_repo)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,?,?,?,?)""",
            (task_id, project_id, body.get("mission_id"), title, body.get("description", ""),
             body.get("stream_id"), body.get("branch"),
             body.get("status", "queued"), body.get("priority", 5),
             body.get("model_hint"), body.get("runner_type", "claude_code"),
             depends_on, now, now,
             body.get("notes", ""),
             body.get("working_dir", ""), body.get("folder_mode", "inherit"),
             body.get("git_repo", "")),
        )
        row = c.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
    result = row_to_task(row)
    _write_audit("task_created", "task", task_id,
                 project_id=project_id, mission_id=body.get("mission_id"),
                 details={"title": title})
    return result


@app.get("/api/tasks")
def list_tasks(project_id: str | None = None, status: str | None = None,
               stream_id: str | None = None, mission_id: str | None = None) -> list[dict[str, Any]]:
    clauses, params = [], []
    if project_id:
        clauses.append("project_id=?"); params.append(project_id)
    if status:
        clauses.append("status=?"); params.append(status)
    if stream_id:
        clauses.append("stream_id=?"); params.append(stream_id)
    if mission_id:
        clauses.append("mission_id=?"); params.append(mission_id)
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    with db() as c:
        rows = c.execute(
            f"SELECT * FROM tasks {where} ORDER BY priority, created_at", params
        ).fetchall()
    return [row_to_task(r) for r in rows]


@app.get("/api/tasks/next")
def next_task(project_id: str | None = None) -> dict[str, Any] | None:
    """Return highest-priority queued task whose dependencies are all done."""
    where = "WHERE t.status='queued' AND (t.stream_id IS NULL OR t.stream_id='')"
    params: list[Any] = []
    if project_id:
        where += " AND t.project_id=?"
        params.append(project_id)
    with db() as c:
        rows = c.execute(
            f"SELECT * FROM tasks t {where} ORDER BY t.priority, t.created_at", params
        ).fetchall()
        for row in rows:
            t = row_to_task(row)
            deps = t.get("depends_on") or []
            if not deps:
                return t
            done_ids = {
                r["id"] for r in c.execute(
                    f"SELECT id FROM tasks WHERE id IN ({','.join('?' * len(deps))}) AND status='done'",
                    deps,
                ).fetchall()
            }
            if set(deps) <= done_ids:
                return t
    return None


@app.get("/api/tasks/{task_id}")
def get_task(task_id: str) -> dict[str, Any]:
    with db() as c:
        row = c.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="task not found")
    return row_to_task(row)


@app.patch("/api/tasks/{task_id}")
def update_task(task_id: str, body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    with db() as c:
        row = c.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="task not found")
        old = row_to_task(row)
        updates: dict[str, Any] = {}
        for field in ("title", "description", "stream_id", "branch", "status",
                      "priority", "model_hint", "runner_type", "notes", "cost_tokens",
                      "working_dir", "folder_mode", "git_repo"):
            if field in body:
                updates[field] = body[field]
        if "depends_on" in body:
            updates["depends_on"] = json.dumps(body["depends_on"])
        if "status" in updates:
            new_status = updates["status"]
            if new_status not in VALID_TASK_STATUSES:
                raise HTTPException(status_code=400, detail=f"status must be one of {VALID_TASK_STATUSES}")
            if old["status"] != "in_progress" and new_status == "in_progress":
                updates.setdefault("started_at", utcnow())
            if new_status == "done" and old["status"] != "done":
                updates.setdefault("completed_at", utcnow())
        if updates:
            updates["updated_at"] = utcnow()
            set_clause = ", ".join(f"{k}=?" for k in updates)
            c.execute(f"UPDATE tasks SET {set_clause} WHERE id=?",
                      [*updates.values(), task_id])
        row = c.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
    task = row_to_task(row)
    # Auto-log status transition events
    if "status" in updates:
        new_status = updates["status"]
        if old.get("status") != new_status and new_status in ("in_progress", "review", "done", "blocked"):
            _log_bot_event(f"task_{new_status}", task)
            _write_audit("task_status_changed", "task", task_id,
                         project_id=task.get("project_id"), mission_id=task.get("mission_id"),
                         details={"from": old.get("status"), "to": new_status, "title": task.get("title")})
    return task


# ── Bot Events API ───────────────────────────────────────────────────────────

@app.post("/api/bot_events")
def record_bot_event(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    event_type = body.get("event_type")
    if not event_type:
        raise HTTPException(status_code=400, detail="event_type required")
    now = utcnow()
    with db() as c:
        cur = c.execute(
            """INSERT INTO bot_events
               (worker_id, task_id, project_id, mission_id, event_type, model,
                prompt_tokens, completion_tokens, content, created_at)
               VALUES (?,?,?,?,?,?,?,?,?,?)""",
            (body.get("worker_id"), body.get("task_id"), body.get("project_id"),
             body.get("mission_id"), event_type, body.get("model"),
             body.get("prompt_tokens", 0), body.get("completion_tokens", 0),
             json.dumps(body.get("content") or {}), now),
        )
        row = c.execute("SELECT * FROM bot_events WHERE id=?", (cur.lastrowid,)).fetchone()
    return dict(row)


@app.get("/api/bot_events")
def list_bot_events(
    task_id: str | None = None,
    worker_id: str | None = None,
    project_id: str | None = None,
    mission_id: str | None = None,
    model: str | None = None,
    limit: int = 100,
) -> list[dict[str, Any]]:
    clauses, params = [], []
    if task_id:    clauses.append("task_id=?");    params.append(task_id)
    if worker_id:  clauses.append("worker_id=?");  params.append(worker_id)
    if project_id: clauses.append("project_id=?"); params.append(project_id)
    if mission_id: clauses.append("mission_id=?"); params.append(mission_id)
    if model:      clauses.append("model=?");      params.append(model)
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    limit = min(max(1, limit), 1000)
    with db() as c:
        rows = c.execute(
            f"SELECT * FROM bot_events {where} ORDER BY id DESC LIMIT ?",
            [*params, limit],
        ).fetchall()
    return [dict(r) for r in rows]


# ── Reviews API ───────────────────────────────────────────────────────────────

def _row_to_review(r: sqlite3.Row) -> dict[str, Any]:
    d = dict(r)
    d["flags"] = json.loads(d.get("flags") or "[]")
    return d


@app.get("/api/reviews")
def list_reviews(
    task_id: str | None = None,
    project_id: str | None = None,
    mission_id: str | None = None,
) -> list[dict[str, Any]]:
    clauses, params = [], []
    if task_id:    clauses.append("task_id=?");    params.append(task_id)
    if project_id: clauses.append("project_id=?"); params.append(project_id)
    if mission_id: clauses.append("mission_id=?"); params.append(mission_id)
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    with db() as c:
        rows = c.execute(
            f"SELECT * FROM reviews {where} ORDER BY created_at DESC", params
        ).fetchall()
    return [_row_to_review(r) for r in rows]


@app.post("/api/reviews")
def create_review(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    task_id = body.get("task_id")
    rating = body.get("rating")
    if not task_id:
        raise HTTPException(status_code=400, detail="task_id required")
    if not isinstance(rating, int) or not (1 <= rating <= 5):
        raise HTTPException(status_code=400, detail="rating must be integer 1-5")
    # Pull task for denormalized fields
    with db() as c:
        task_row = c.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
    if not task_row:
        raise HTTPException(status_code=404, detail="task not found")
    task = row_to_task(task_row)
    now = utcnow()
    with db() as c:
        cur = c.execute(
            """INSERT INTO reviews
               (task_id, worker_id, project_id, mission_id, model, rating, notes, flags, reviewer,
                created_at, updated_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
            (task_id, body.get("worker_id") or task.get("stream_id"),
             body.get("project_id") or task.get("project_id"),
             body.get("mission_id") or task.get("mission_id"),
             body.get("model") or task.get("model_hint"),
             rating, body.get("notes", ""),
             json.dumps(body.get("flags") or []),
             body.get("reviewer", "user"), now, now),
        )
        row = c.execute("SELECT * FROM reviews WHERE id=?", (cur.lastrowid,)).fetchone()
    _write_log("info", "quality", f"Review submitted for task {task_id}: {rating}/5",
               project_id=task.get("project_id"), task_id=task_id)
    return _row_to_review(row)


@app.patch("/api/reviews/{review_id}")
def update_review(review_id: int, body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    with db() as c:
        row = c.execute("SELECT * FROM reviews WHERE id=?", (review_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="review not found")
        updates: dict[str, Any] = {}
        if "rating" in body:
            r = body["rating"]
            if not isinstance(r, int) or not (1 <= r <= 5):
                raise HTTPException(status_code=400, detail="rating must be integer 1-5")
            updates["rating"] = r
        for field in ("notes", "reviewer"):
            if field in body:
                updates[field] = body[field]
        if "flags" in body:
            updates["flags"] = json.dumps(body["flags"])
        if updates:
            updates["updated_at"] = utcnow()
            set_clause = ", ".join(f"{k}=?" for k in updates)
            c.execute(f"UPDATE reviews SET {set_clause} WHERE id=?",
                      [*updates.values(), review_id])
        row = c.execute("SELECT * FROM reviews WHERE id=?", (review_id,)).fetchone()
    return _row_to_review(row)


# ── Quality Summary API ───────────────────────────────────────────────────────

@app.get("/api/quality/summary")
def quality_summary(project_id: str | None = None) -> dict[str, Any]:
    clauses, params = [], []
    if project_id:
        clauses.append("project_id=?")
        params.append(project_id)
    where_proj = f"WHERE {' AND '.join(clauses)}" if clauses else ""

    with db() as c:
        # Tasks done/review that haven't been reviewed
        done_ids = {
            r["id"] for r in c.execute(
                f"SELECT id FROM tasks WHERE status IN ('done','review') {('AND ' + ' AND '.join(clauses)) if clauses else ''} ",
                params,
            ).fetchall()
        }
        reviewed_task_ids = {
            r["task_id"] for r in c.execute(
                f"SELECT DISTINCT task_id FROM reviews {where_proj}", params
            ).fetchall()
        }
        unreviewed_done = len(done_ids - reviewed_task_ids)

        reviews = c.execute(
            f"SELECT rating, model, flags FROM reviews {where_proj}", params
        ).fetchall()

    total_reviewed = len(reviews)
    avg_rating = round(sum(r["rating"] for r in reviews) / total_reviewed, 2) if reviews else None

    by_model: dict[str, Any] = {}
    for r in reviews:
        m = r["model"] or "unknown"
        if m not in by_model:
            by_model[m] = {"count": 0, "total_rating": 0, "flags": {}}
        by_model[m]["count"] += 1
        by_model[m]["total_rating"] += r["rating"]
        for flag in json.loads(r["flags"] or "[]"):
            by_model[m]["flags"][flag] = by_model[m]["flags"].get(flag, 0) + 1

    for m in by_model:
        cnt = by_model[m]["count"]
        by_model[m]["avg_rating"] = round(by_model[m]["total_rating"] / cnt, 2) if cnt else None
        del by_model[m]["total_rating"]

    return {
        "total_reviewed": total_reviewed,
        "unreviewed_done": unreviewed_done,
        "avg_rating": avg_rating,
        "by_model": by_model,
    }


# ── Objective Templates API ───────────────────────────────────────────────────

@app.get("/api/objective-templates")
def list_objective_templates(search: str | None = None) -> list[dict[str, Any]]:
    with db() as c:
        if search:
            rows = c.execute(
                "SELECT * FROM objective_templates WHERE title LIKE ? OR description LIKE ? "
                "ORDER BY use_count DESC, created_at DESC",
                (f"%{search}%", f"%{search}%"),
            ).fetchall()
        else:
            rows = c.execute(
                "SELECT * FROM objective_templates ORDER BY use_count DESC, created_at DESC"
            ).fetchall()
    result = []
    for r in rows:
        t = dict(r)
        t["tags"] = json.loads(t.get("tags") or "[]")
        result.append(t)
    return result


@app.post("/api/objective-templates")
def create_objective_template(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    title = body.get("title")
    if not title:
        raise HTTPException(status_code=400, detail="title required")
    now = utcnow()
    tid = f"tmpl-{int(time.time() * 1000) % 10_000_000}"
    with db() as c:
        c.execute(
            """INSERT INTO objective_templates
               (id, title, description, model_hint, tags, source_mission_id, source_task_id, use_count, created_at, updated_at)
               VALUES (?,?,?,?,?,?,?,0,?,?)""",
            (tid, title, body.get("description", ""), body.get("model_hint", ""),
             json.dumps(body.get("tags") or []),
             body.get("source_mission_id"), body.get("source_task_id"), now, now),
        )
        row = c.execute("SELECT * FROM objective_templates WHERE id=?", (tid,)).fetchone()
    t = dict(row)
    t["tags"] = json.loads(t.get("tags") or "[]")
    _write_audit("template_created", "objective_template", tid,
                 details={"title": title})
    return t


@app.post("/api/tasks/{task_id}/save-as-template")
def save_task_as_template(task_id: str, body: dict[str, Any] = Body({})) -> dict[str, Any]:
    with db() as c:
        row = c.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="task not found")
    task = row_to_task(row)
    tags = body.get("tags") or []
    now = utcnow()
    tid = f"tmpl-{int(time.time() * 1000) % 10_000_000}"
    with db() as c:
        c.execute(
            """INSERT INTO objective_templates
               (id, title, description, model_hint, tags, source_mission_id, source_task_id, use_count, created_at, updated_at)
               VALUES (?,?,?,?,?,?,?,0,?,?)""",
            (tid, task["title"], task.get("description", ""), task.get("model_hint", ""),
             json.dumps(tags), task.get("mission_id"), task_id, now, now),
        )
        row = c.execute("SELECT * FROM objective_templates WHERE id=?", (tid,)).fetchone()
    t = dict(row)
    t["tags"] = json.loads(t.get("tags") or "[]")
    _write_audit("template_saved", "objective_template", tid,
                 project_id=task.get("project_id"), mission_id=task.get("mission_id"),
                 details={"title": task["title"], "task_id": task_id})
    return t


@app.post("/api/objective-templates/{template_id}/use")
def record_template_use(template_id: str) -> dict[str, Any]:
    with db() as c:
        row = c.execute("SELECT * FROM objective_templates WHERE id=?", (template_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="template not found")
        c.execute("UPDATE objective_templates SET use_count=use_count+1, updated_at=? WHERE id=?",
                  (utcnow(), template_id))
        row = c.execute("SELECT * FROM objective_templates WHERE id=?", (template_id,)).fetchone()
    t = dict(row)
    t["tags"] = json.loads(t.get("tags") or "[]")
    return t


# ── Audit Log API ──────────────────────────────────────────────────────────────

@app.get("/api/audit-log")
def get_audit_log(
    project_id: str | None = None,
    mission_id: str | None = None,
    entity_type: str | None = None,
    limit: int = 100,
) -> list[dict[str, Any]]:
    clauses, params = [], []
    if project_id:  clauses.append("project_id=?");  params.append(project_id)
    if mission_id:  clauses.append("mission_id=?");  params.append(mission_id)
    if entity_type: clauses.append("entity_type=?"); params.append(entity_type)
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    limit = min(max(1, limit), 500)
    with db() as c:
        rows = c.execute(
            f"SELECT * FROM audit_log {where} ORDER BY id DESC LIMIT ?",
            [*params, limit],
        ).fetchall()
    result = []
    for r in rows:
        e = dict(r)
        e["details"] = json.loads(e.get("details") or "{}")
        result.append(e)
    return result


# ── Dashboard rendering ───────────────────────────────────────────────────────

STATUS_COLOR = {
    "ok":      "#1f8a3a",
    "warning": "#d49b00",
    "urgent":  "#c0392b",
    "stale":   "#e67e22",
    "stopped": "#6c757d",
    "unknown": "#8a8a8a",
}
TASK_STATUS_COLOR = {
    "queued":      ("#6c757d", "#f0f2f5"),
    "in_progress": ("#1f4fb8", "#d6e4ff"),
    "blocked":     ("#c0392b", "#fde6e3"),
    "review":      ("#7b3fb8", "#f0e6ff"),
    "done":        ("#1f8a3a", "#e6f5ea"),
}
SEVERITY_COLOR = {"urgent": "#c0392b", "warning": "#d49b00", "info": "#2b6cb0"}


def _esc(v: Any) -> str:
    return html.escape(str(v)) if v is not None else "—"


def _fmt_age(age: int | None) -> tuple[str, str]:
    if age is None:
        return "never", "#8a8a8a"
    if age < 60:
        txt = f"{age}s ago"
    elif age < 3600:
        txt = f"{age // 60}m ago"
    else:
        txt = f"{age // 3600}h {(age % 3600) // 60}m ago"
    color = "#555"
    if age > 3600:
        color = "#c0392b"
    elif age > 1800:
        color = "#e67e22"
    return txt, color


def _render_issues(s: dict[str, Any]) -> str:
    out = ""
    for i in s.get("active_issues") or []:
        if i.get("actioned"):
            continue
        sc = SEVERITY_COLOR.get(i.get("severity"), "#555")
        out += (f'<div class="issue" style="border-left:3px solid {sc};">'
                f'<b style="color:{sc};">{_esc((i.get("severity") or "").upper())}</b> '
                f'<code>{_esc(i.get("code"))}</code> — {_esc(i.get("message"))}</div>')
    return out or '<div class="issue-none">no active issues</div>'


def _render_inbox(s: dict[str, Any]) -> str:
    unread = s.get("_inbox") or []
    if not unread:
        return ""
    badge = (f'<div class="inbox-badges"><span class="inbox-badge inbox-unread">'
             f'✉ {len(unread)} unread</span></div>')
    items = "".join(
        f'<div class="inbox-msg"><div class="inbox-meta">from <code>{_esc(m["from_stream"])}</code>'
        f' · <code>{_esc(m["code"])}</code></div>'
        f'<div class="inbox-text">{_esc(m["message"])}</div></div>'
        for m in unread
    )
    return badge + f'<div class="inbox-list">{items}</div>'


def render_stream_card(s: dict[str, Any]) -> str:
    status = s.get("status", "unknown")
    color = STATUS_COLOR.get(status, "#8a8a8a")
    age_txt, age_color = _fmt_age(s.get("age_seconds"))
    stype = s.get("stream_type", "dev")
    meta = s.get("meta") or {}
    meta_html = ""
    if isinstance(meta, dict) and meta:
        rows = "".join(f"<div><b>{_esc(k)}:</b> {_esc(v)}</div>" for k, v in meta.items())
        meta_html = f'<div class="stats">{rows}</div>'
    return f"""
    <div class="card">
      <div class="card-head">
        <div class="stream-name">{_esc(s.get("stream_id"))}
          <span class="type-tag">{_esc(stype)}</span></div>
        <span class="badge" style="background:{color};">{_esc(status).upper()}</span>
      </div>
      <div class="meta">
        <div>{_esc(s.get("machine"))} · {_esc(s.get("branch"))} · v{_esc(s.get("version"))}</div>
      </div>
      {meta_html}
      <div class="age" style="color:{age_color};">updated {age_txt}</div>
      <div class="issues">{_render_issues(s)}</div>
      {_render_inbox(s)}
      <div class="notes">{_esc(s.get("notes", ""))}</div>
    </div>"""


def render_project_block(p: dict[str, Any], tasks: list[dict[str, Any]]) -> str:
    total = len(tasks)
    done = sum(1 for t in tasks if t["status"] == "done")
    in_prog = sum(1 for t in tasks if t["status"] == "in_progress")
    blocked = sum(1 for t in tasks if t["status"] == "blocked")
    proj_status = p.get("status", "active")
    pcolor = {"active": "#1f8a3a", "paused": "#e67e22", "done": "#2b6cb0",
              "archived": "#6c757d"}.get(proj_status, "#8a8a8a")
    total_tokens = sum(t.get("cost_tokens") or 0 for t in tasks)
    # pick cost from most expensive model used
    models_used = {t.get("model_hint") for t in tasks if t.get("model_hint")}
    total_cost = "—"
    if total_tokens and models_used:
        max_rate = max((MODEL_COST_PER_M.get(m, 0) for m in models_used), default=0)
        c = total_tokens * max_rate / 1_000_000
        total_cost = f"${c:.3f}" if c >= 0.001 else f"${c:.5f}"

    rows_html = ""
    for t in tasks:
        sc, bg = TASK_STATUS_COLOR.get(t["status"], ("#555", "#f5f5f5"))
        elapsed = task_elapsed_fmt(t)
        tokens = f"{t['cost_tokens']:,}" if t.get("cost_tokens") else "—"
        cost = est_cost(t.get("cost_tokens", 0), t.get("model_hint"))
        stream_cell = f'<code>{_esc(t["stream_id"])}</code>' if t.get("stream_id") else '<span style="color:#aaa">unassigned</span>'
        dep_flag = ""
        if t.get("depends_on"):
            deps_str = _esc(str(t["depends_on"]))
            dep_flag = f' <span title="depends on: {deps_str}" style="color:#888;font-size:10px;">⛓</span>'
        rows_html += f"""<tr>
          <td><code>{_esc(t["id"])}</code></td>
          <td>{_esc(t["title"])}{dep_flag}</td>
          <td>{stream_cell}</td>
          <td><span class="tbadge" style="color:{sc};background:{bg};">{_esc(t["status"].replace("_"," "))}</span></td>
          <td><code style="color:#666">{_esc(t.get("model_hint") or "—")}</code></td>
          <td style="color:#666">{elapsed}</td>
          <td style="color:#666">{tokens}</td>
          <td style="color:#666">{cost}</td>
        </tr>"""

    summary_parts = [f"{done}/{total} done"]
    if in_prog:
        summary_parts.append(f'<span style="color:#1f4fb8">{in_prog} working</span>')
    if blocked:
        summary_parts.append(f'<span style="color:#c0392b">{blocked} blocked</span>')
    if total_tokens:
        summary_parts.append(f"~{total_tokens:,} tokens · est {total_cost}")

    return f"""
    <div class="project-block">
      <div class="project-header">
        <div>
          <span class="project-name">{_esc(p["name"])}</span>
          <span class="project-stack">{_esc(p.get("tech_stack",""))}</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="font-size:12px;color:#555">{" · ".join(summary_parts)}</span>
          <span class="badge" style="background:{pcolor};">{_esc(proj_status).upper()}</span>
        </div>
      </div>
      <table class="task-table">
        <thead><tr>
          <th>ID</th><th>Task</th><th>Bot / Stream</th><th>Status</th>
          <th>Model</th><th>Elapsed</th><th>Tokens</th><th>Est cost</th>
        </tr></thead>
        <tbody>{rows_html}</tbody>
      </table>
      <div style="font-size:11px;color:#888;margin-top:4px;">{_esc(p.get("description",""))}</div>
    </div>"""


DASHBOARD_CSS = """
body{font-family:-apple-system,Helvetica,Arial,sans-serif;margin:20px;background:#f6f7f9;color:#222;}
h1{font-size:20px;margin:0 0 4px;}
.sub{color:#666;font-size:13px;margin-bottom:16px;}
h2{font-size:16px;margin:24px 0 8px;}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px;}
.card{background:#fff;border-radius:8px;padding:12px;box-shadow:0 1px 2px rgba(0,0,0,.06);font-size:13px;}
.card-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;}
.stream-name{font-weight:600;font-size:15px;}
.type-tag{display:inline-block;font-size:10px;font-weight:500;color:#555;background:#eef1f4;
  padding:1px 6px;border-radius:8px;margin-left:4px;vertical-align:middle;
  text-transform:uppercase;letter-spacing:.4px;}
.badge{color:#fff;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;letter-spacing:.5px;}
.meta,.stats{color:#444;line-height:1.45;margin-bottom:6px;}
.age{font-size:12px;margin:4px 0 8px;}
.issue{background:#fafafa;padding:4px 8px;margin:3px 0;font-size:12px;border-radius:3px;}
.issue-none{color:#888;font-size:12px;font-style:italic;}
.notes{color:#666;font-size:12px;border-top:1px dashed #e3e3e3;padding-top:6px;margin-top:6px;}
code{background:#eef1f4;padding:1px 5px;border-radius:3px;font-size:12px;}
.inbox-badges{margin:6px 0 4px;}
.inbox-badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;}
.inbox-unread{background:#d6e4ff;color:#1f4fb8;border:1px solid #6f97e6;}
.inbox-list{margin-top:4px;}
.inbox-msg{padding:6px 8px;margin:4px 0;border-radius:4px;font-size:12px;line-height:1.4;
  background:#e7efff;border-left:4px solid #2b6cb0;}
.inbox-meta{color:#1f4fb8;font-weight:600;font-size:11px;}
.inbox-text{margin-top:3px;}
.project-block{background:#fff;border-radius:8px;padding:14px;
  box-shadow:0 1px 2px rgba(0,0,0,.06);margin-bottom:12px;}
.project-header{display:flex;justify-content:space-between;align-items:center;
  margin-bottom:10px;border-bottom:1px solid #eee;padding-bottom:8px;}
.project-name{font-weight:700;font-size:16px;margin-right:8px;}
.project-stack{font-size:11px;color:#888;background:#f0f2f5;padding:2px 7px;border-radius:8px;}
.task-table{border-collapse:collapse;width:100%;font-size:12px;}
.task-table th{background:#f7f8fa;text-align:left;padding:5px 8px;
  border-bottom:2px solid #eee;font-size:11px;color:#555;font-weight:600;}
.task-table td{padding:5px 8px;border-bottom:1px solid #f0f0f0;vertical-align:middle;}
.task-table tr:last-child td{border-bottom:0;}
.task-table tr:hover td{background:#fafbff;}
.tbadge{display:inline-block;padding:1px 7px;border-radius:8px;font-size:11px;font-weight:600;}
.feed{list-style:none;padding:0;margin:0;background:#fff;border-radius:6px;
  box-shadow:0 1px 2px rgba(0,0,0,.06);}
.feed li{padding:8px 12px;border-bottom:1px solid #eee;font-size:13px;}
.feed li:last-child{border-bottom:0;}
"""


@app.get("/dashboard", response_class=HTMLResponse)
def dashboard() -> str:
    streams = list_streams()
    for s in streams:
        s["_inbox"] = _unread_for(s["stream_id"])

    stream_cards = "".join(render_stream_card(s) for s in streams)
    streams_section = (
        f'<h2>Active Streams</h2><div class="cards">{stream_cards}</div>'
        if streams else '<h2>Active Streams</h2><p style="color:#888;font-size:13px;">No streams registered yet.</p>'
    )

    with db() as c:
        projs = c.execute(
            "SELECT * FROM projects WHERE status!='archived' ORDER BY created_at DESC"
        ).fetchall()
    project_blocks = ""
    for proj in projs:
        with db() as c:
            tasks = c.execute(
                "SELECT * FROM tasks WHERE project_id=? ORDER BY priority, created_at",
                (proj["id"],),
            ).fetchall()
        project_blocks += render_project_block(row_to_project(proj), [row_to_task(t) for t in tasks])

    projects_section = (
        f'<h2>Projects</h2>{project_blocks}'
        if project_blocks else '<h2>Projects</h2><p style="color:#888;font-size:13px;">No active projects yet.</p>'
    )

    # issue feed
    feed_items = []
    now = datetime.now(timezone.utc)
    for s in streams:
        for i in s.get("active_issues") or []:
            if i.get("actioned"):
                continue
            raised = i.get("raised_at") or s.get("updated_at") or utcnow()
            mins = int((now - parse_iso(raised)).total_seconds() // 60)
            sev = (i.get("severity") or "info").upper()
            sc = SEVERITY_COLOR.get(i.get("severity"), "#555")
            tag = {"URGENT": "URGENT", "WARNING": "WARN"}.get(sev, "INFO")
            feed_items.append(
                (raised,
                 f'<li><b style="color:{sc};">[{tag}]</b> <code>{_esc(s["stream_id"])}</code>: '
                 f'{_esc(i.get("message",""))} ({mins}m ago)</li>')
            )
    feed_items.sort(key=lambda x: x[0], reverse=True)
    feed_html = (
        f'<ul class="feed">{"".join(li for _, li in feed_items[:20])}</ul>'
        if feed_items else '<p style="color:#888;font-size:13px;">No active issues.</p>'
    )

    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    return f"""<!doctype html>
<html><head>
<meta charset="utf-8">
<meta http-equiv="refresh" content="30">
<title>Factory Hub</title>
<style>{DASHBOARD_CSS}</style>
</head>
<body>
<h1>Factory Hub</h1>
<div class="sub">{ts} — refreshes every 30s · <a href="/docs">API docs</a> · <a href="/health">health</a></div>
{streams_section}
{projects_section}
<h2>Recent Issues</h2>
{feed_html}
</body></html>"""


@app.get("/", response_class=JSONResponse)
def root() -> dict[str, Any]:
    return {"app": "factory-hub", "dashboard": "/dashboard",
            "api_docs": "/docs", "health": "/health"}


# ═══════════════════════════════════════════════════════════════════════════════
# WORKERS API
# ═══════════════════════════════════════════════════════════════════════════════

VALID_WORKER_STATUSES = ("pending", "starting", "active", "idle", "stuck", "done", "failed", "killed")


def _row_to_worker(r: sqlite3.Row) -> dict[str, Any]:
    return dict(r)


def _get_config(key: str, default: str = "") -> str:
    with db() as c:
        row = c.execute("SELECT value FROM config WHERE key=?", (key,)).fetchone()
    return row["value"] if row else default


def _shell_quote(s: str) -> str:
    """Quote a string safely for use as a PowerShell argument."""
    escaped = s.replace("'", "''")
    return f"'{escaped}'"


def _write_log(level: str, source: str, message: str,
               project_id: str | None = None, task_id: str | None = None,
               stream_id: str | None = None) -> None:
    with db() as c:
        c.execute(
            "INSERT INTO logs (timestamp, level, source, project_id, task_id, stream_id, message) "
            "VALUES (?,?,?,?,?,?,?)",
            (utcnow(), level, source, project_id, task_id, stream_id, message),
        )


def _write_audit(event_type: str, entity_type: str, entity_id: str | None = None,
                 actor: str = "user", project_id: str | None = None,
                 mission_id: str | None = None, details: dict | None = None) -> None:
    with db() as c:
        c.execute(
            "INSERT INTO audit_log (timestamp, event_type, entity_type, entity_id, actor, project_id, mission_id, details) "
            "VALUES (?,?,?,?,?,?,?,?)",
            (utcnow(), event_type, entity_type, entity_id, actor, project_id, mission_id, json.dumps(details or {})),
        )


def _log_bot_event(event_type: str, task: dict[str, Any],
                   worker_id: str | None = None, content: dict | None = None) -> None:
    with db() as c:
        c.execute(
            """INSERT INTO bot_events
               (worker_id, task_id, project_id, mission_id, event_type, model, content, created_at)
               VALUES (?,?,?,?,?,?,?,?)""",
            (worker_id, task.get("id"), task.get("project_id"), task.get("mission_id"),
             event_type, task.get("model_hint"), json.dumps(content or {}), utcnow()),
        )


@app.post("/api/workers")
def create_worker(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    project_id = body.get("project_id")
    stream_id = body.get("stream_id")
    if not project_id or not stream_id:
        raise HTTPException(status_code=400, detail="project_id and stream_id required")
    with db() as c:
        if not c.execute("SELECT id FROM projects WHERE id=?", (project_id,)).fetchone():
            raise HTTPException(status_code=404, detail="project not found")
        now = utcnow()
        worker_id = body.get("id") or f"w-{stream_id}-{int(time.time())}"
        c.execute(
            """INSERT INTO workers
               (id, project_id, mission_id, task_id, stream_id, status, model, worktree_path,
                branch, git_root, spawned_by, runner_type, created_at, updated_at, notes)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (worker_id, project_id, body.get("mission_id"), body.get("task_id"), stream_id,
             body.get("status", "pending"), body.get("model", _get_config("default_model")),
             body.get("worktree_path"), body.get("branch"),
             body.get("git_root"), body.get("spawned_by", "user"),
             body.get("runner_type", "claude_code"),
             now, now, body.get("notes", "")),
        )
        row = c.execute("SELECT * FROM workers WHERE id=?", (worker_id,)).fetchone()
    _write_log("info", "system", f"Worker {worker_id} created for stream {stream_id}",
               project_id=project_id, stream_id=stream_id)
    return _row_to_worker(row)


@app.get("/api/workers")
def list_workers(project_id: str | None = None, status: str | None = None,
                 mission_id: str | None = None) -> list[dict[str, Any]]:
    clauses, params = [], []
    if project_id:
        clauses.append("project_id=?"); params.append(project_id)
    if status:
        clauses.append("status=?"); params.append(status)
    if mission_id:
        clauses.append("mission_id=?"); params.append(mission_id)
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    with db() as c:
        rows = c.execute(
            f"SELECT * FROM workers {where} ORDER BY created_at DESC", params
        ).fetchall()
    workers = [_row_to_worker(r) for r in rows]
    # Enrich with live stream data
    for w in workers:
        s = load_stream(w["stream_id"])
        if s:
            w["stream_status"] = s.get("status")
            w["stream_age"] = s.get("age_seconds")
            w["stream_notes"] = s.get("notes", "")
            meta = s.get("meta") or {}
            w["session_active"] = meta.get("session_active", False)
            w["current_task_meta"] = meta.get("current_task")
        else:
            w["stream_status"] = None
            w["stream_age"] = None
            w["stream_notes"] = ""
            w["session_active"] = False
            w["current_task_meta"] = None
    return workers


@app.get("/api/workers/{worker_id}")
def get_worker(worker_id: str) -> dict[str, Any]:
    with db() as c:
        row = c.execute("SELECT * FROM workers WHERE id=?", (worker_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="worker not found")
    w = _row_to_worker(row)
    s = load_stream(w["stream_id"])
    if s:
        w["stream"] = s
    return w


@app.patch("/api/workers/{worker_id}")
def update_worker(worker_id: str, body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    with db() as c:
        row = c.execute("SELECT * FROM workers WHERE id=?", (worker_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="worker not found")
        updates: dict[str, Any] = {}
        for field in ("task_id", "status", "model", "worktree_path", "branch",
                      "git_root", "pid", "notes"):
            if field in body:
                updates[field] = body[field]
        if "status" in updates:
            if updates["status"] not in VALID_WORKER_STATUSES:
                raise HTTPException(status_code=400, detail=f"invalid status")
            if updates["status"] == "active":
                updates.setdefault("started_at", utcnow())
            if updates["status"] in ("done", "failed", "killed"):
                updates.setdefault("completed_at", utcnow())
        if updates:
            updates["updated_at"] = utcnow()
            set_clause = ", ".join(f"{k}=?" for k in updates)
            c.execute(f"UPDATE workers SET {set_clause} WHERE id=?",
                      [*updates.values(), worker_id])
        row = c.execute("SELECT * FROM workers WHERE id=?", (worker_id,)).fetchone()
    return _row_to_worker(row)


def _generate_claude_md(worker: dict, project: dict, task: dict | None,
                        completed_deps: list[dict]) -> str:
    hub_url = "http://localhost:9100"
    role = task["title"] if task else "Worker"
    dep_section = ""
    if completed_deps:
        dep_section = "\n## Dependencies Completed\n"
        for d in completed_deps:
            dep_section += f"- **{d['id']}** {d['title']}: {d.get('notes','done')}\n"

    return dedent(f"""\
        # {project['name']} — {role} Session

        ## Your Role
        {task['description'] if task else 'See your task in the Factory Hub.'}

        ## Project
        **{project['name']}**: {project.get('description', '')}
        Stack: {project.get('tech_stack', '')}

        ## Your Worktree
        `{worker.get('worktree_path', '.')}` — branch: `{worker.get('branch', 'main')}`

        ## Factory Hub
        - URL: {hub_url}
        - Dashboard: {hub_url}/dashboard
        - Your stream ID: `{worker['stream_id']}`
        - Copy coord client: `{hub_url}/scripts/coord_client.py`
        {dep_section}
        ## Startup Checklist
        1. Check hub for urgent issues: `GET {hub_url}/api/urgent`
        2. Check your inbox: `GET {hub_url}/api/streams/{worker['stream_id']}/inbox`
        3. Claim your task: `PATCH {hub_url}/api/tasks/{task['id'] if task else 'TASK-ID'}` → `{{"status":"in_progress","stream_id":"{worker['stream_id']}"}}`
        4. Post status to hub: include `meta.session_active=true` and `meta.current_task="{task['id'] if task else ''}"` in your first update
        5. Do the work — post updates to hub at major checkpoints
        6. When done: mark task done, send inbox message to architect/coordinator if relevant

        ## Task: {task['id'] if task else '?'} — {task['title'] if task else '?'}
        {task.get('description','') if task else ''}

        ## Coordination Rules
        - Do NOT edit files owned by other workers — send inbox messages instead
        - Post to hub at startup, between major steps, and at session end
        - Stuck on something for >10 min? Set task to `blocked` and describe the blocker in notes
        - Check inbox every ~20 min for messages from other streams

        ## File Ownership
        Your branch: `{worker.get('branch', 'main')}` — only commit to this branch.
        Architect/main branch owns shared components. Ask before changing them.

        ## IMPORTANT — Hard Rules (follow without exception)
        1. **Do NOT use git** (no git add, git commit, git push, git checkout, etc.) unless the task description explicitly tells you to. Just write and edit files directly.
        2. **Stay in your working folder.** Only read and write files inside `{worker.get('worktree_path', '.')}`. Do not navigate to parent directories, other projects, or system folders.
        3. If you are unsure whether an action is in scope, do nothing and report your uncertainty in a hub status update.
    """)


@app.post("/api/workers/{worker_id}/spawn")
def spawn_worker(worker_id: str) -> dict[str, Any]:
    with db() as c:
        row = c.execute("SELECT * FROM workers WHERE id=?", (worker_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="worker not found")
        w = _row_to_worker(row)
        proj_row = c.execute("SELECT * FROM projects WHERE id=?", (w["project_id"],)).fetchone()
        if not proj_row:
            raise HTTPException(status_code=404, detail="project not found")
        proj = dict(proj_row)
        task = None
        if w.get("task_id"):
            t_row = c.execute("SELECT * FROM tasks WHERE id=?", (w["task_id"],)).fetchone()
            if t_row:
                task = row_to_task(t_row)
        # Get completed dependencies for context
        completed_deps: list[dict] = []
        if task and task.get("depends_on"):
            dep_rows = c.execute(
                f"SELECT * FROM tasks WHERE id IN ({','.join('?'*len(task['depends_on']))})",
                task["depends_on"],
            ).fetchall()
            completed_deps = [row_to_task(r) for r in dep_rows if r["status"] == "done"]
        # Load mission for success_criteria / tech_notes
        mission: dict = {}
        if w.get("mission_id"):
            m_row = c.execute("SELECT * FROM missions WHERE id=?", (w["mission_id"],)).fetchone()
            if m_row:
                mission = dict(m_row)

    worktree = w.get("worktree_path")
    git_root = w.get("git_root")
    branch = w.get("branch", "main")

    steps: list[str] = []
    errors: list[str] = []

    # 1. Create worktree if path given and doesn't exist
    if worktree and git_root and not Path(worktree).exists():
        try:
            result = subprocess.run(
                ["git", "worktree", "add", worktree, branch],
                cwd=git_root, capture_output=True, text=True, timeout=30,
            )
            if result.returncode == 0:
                steps.append(f"Created worktree at {worktree}")
            else:
                errors.append(f"worktree add failed: {result.stderr.strip()}")
        except Exception as e:
            errors.append(f"worktree error: {e}")
    elif worktree and Path(worktree).exists():
        steps.append(f"Worktree already exists at {worktree}")

    # 2. Write CLAUDE.md
    if worktree and Path(worktree).exists():
        try:
            claude_md = _generate_claude_md(w, proj, task, completed_deps)
            (Path(worktree) / "CLAUDE.md").write_text(claude_md, encoding="utf-8")
            steps.append("CLAUDE.md written")
        except Exception as e:
            errors.append(f"CLAUDE.md write failed: {e}")

    # 3. Copy coord_client.py to worktree/scripts/
    client_src = Path(__file__).parent / "scripts" / "coord_client.py"
    if worktree and client_src.exists() and Path(worktree).exists():
        scripts_dir = Path(worktree) / "scripts"
        scripts_dir.mkdir(exist_ok=True)
        try:
            (scripts_dir / "coord_client.py").write_text(
                client_src.read_text(encoding="utf-8"), encoding="utf-8"
            )
            steps.append("coord_client.py copied")
        except Exception as e:
            errors.append(f"coord_client copy failed: {e}")

    # 4. Open terminal window with runner-specific command
    target_dir = worktree or git_root or "."
    runner = w.get("runner_type", "claude_code")

    if runner == "claude_code":
        _claude_bin = _get_config("claude_cli_path") or "claude"
        launch_cmd = f"{_claude_bin} --dangerously-skip-permissions"
        steps.append(f"Runner: Claude Code ({_claude_bin})")
    elif runner == "codex":
        codex_path = _get_config("codex_cli_path") or "codex"
        model = w.get("model", "gpt-4o")
        launch_cmd = f'{codex_path} --model {model}'
        steps.append(f"Runner: Codex CLI, model={model}")
    elif runner == "ollama":
        aider_path = _get_config("aider_cli_path") or "aider"
        model = w.get("model") or _get_config("ollama_default_model") or "qwen3-coder:latest"
        # --no-git: prevent aider from initialising a git repo or committing files.
        # --message-file used instead of --message to avoid PS5.1 quoting issues.
        launch_cmd = f'& "{aider_path}" --model ollama/{model} --yes-always --no-git'
        steps.append(f"Runner: Ollama via aider, model={model}")
    elif runner == "aider":
        aider_path = _get_config("aider_cli_path") or "aider"
        model = w.get("model", "")
        _aider_base = f'& "{aider_path}" --yes-always --no-git'
        launch_cmd = f'{_aider_base} --model {model}' if model else _aider_base
        steps.append(f"Runner: Aider{', model=' + model if model else ''}")
    else:
        # custom — model field holds the full command
        launch_cmd = w.get("model") or _get_config("claude_cli_path") or "claude"
        steps.append(f"Runner: custom ({launch_cmd})")

    # Compute per-run transcript log path (timestamped so each run gets its own file)
    logs_dir = APP_DIR / "logs"
    logs_dir.mkdir(parents=True, exist_ok=True)
    safe_sid = "".join(c for c in w.get("stream_id", worker_id) if c.isalnum() or c in "-_")
    run_ts = int(time.time())
    transcript_path = str(logs_dir / f"{safe_sid}-{run_ts}.log")
    done_path = str(logs_dir / f"{safe_sid}-{run_ts}.done")

    # Resolve target directory: worktree → git_root → task.working_dir → project.project_path
    # APP_DIR is intentionally NOT a fallback — running a bot in the hub's own folder is
    # catastrophic (it can overwrite hub source files). Fail loudly instead.
    proj_path = proj.get("project_path") or ""
    task_dir = (task or {}).get("working_dir") or ""
    resolved = worktree or git_root or task_dir or proj_path
    if not resolved:
        raise ValueError(
            "No project path configured for this mission. "
            "Set the project folder on the Project page before launching a bot."
        )
    target_dir = str(Path(resolved).resolve())
    Path(target_dir).mkdir(parents=True, exist_ok=True)

    # Non-interactive runners (aider/ollama): add --no-pretty so output is plain text
    # that can be piped + captured. Interactive runners (claude_code) keep the raw terminal.
    is_interactive = runner == "claude_code"
    if runner in ("ollama", "aider") and "--no-pretty" not in launch_cmd:
        launch_cmd = launch_cmd.replace("--yes-always", "--yes-always --no-pretty", 1)

    spawned = False
    try:
        if platform.system() == "Windows":
            # Write PS commands to a .ps1 file to avoid `wt` splitting on semicolons.
            ollama_base = _get_config("ollama_api_base") or "http://localhost:11434"
            env_setup = f"$env:OLLAMA_API_BASE = '{ollama_base}'\n" if runner in ("ollama", "aider") else ""

            # Compute the actual prompt that will be sent before building the banner,
            # so the banner can show the real content (including fallback for mission-level bots).
            task_title = (task or {}).get("title", "—")
            if not is_interactive:
                parts: list[str] = []

                # Project + mission context
                parts += [
                    f"## Project: {proj.get('name', '')}",
                    proj.get("description", "").strip(),
                ]
                if proj.get("tech_stack"):
                    parts += [f"Stack: {proj['tech_stack']}"]
                if mission:
                    parts += ["", f"## Mission: {mission.get('name', '')}"]
                    if mission.get("description"):
                        parts.append(mission["description"].strip())
                    if mission.get("tech_notes"):
                        parts += ["", "## Tech Notes", mission["tech_notes"].strip()]
                    if mission.get("success_criteria"):
                        parts += ["", "## Success Criteria", mission["success_criteria"].strip()]

                # Task-specific section
                if task:
                    parts += [
                        "",
                        f"## Your Task: {task.get('title', '')}",
                        task.get("description", "").strip(),
                    ]
                elif w.get("notes") or w.get("stream_notes"):
                    parts += [
                        "",
                        "## Your Instructions",
                        (w.get("notes") or w.get("stream_notes", "")).strip(),
                    ]
                elif mission and (mission.get("success_criteria") or mission.get("description")):
                    # Mission-level bot with no explicit task — build from mission success criteria
                    parts += [
                        "",
                        "## Your Task",
                        "Implement the project described above so that all Success Criteria are met.",
                        "Write all necessary source files. Do not just summarise — write the actual code.",
                    ]
                else:
                    parts += [
                        "",
                        "## Your Instructions",
                        "Review the project folder structure and current state of all files.",
                        "Write a brief summary: file list, purpose of each file, tech stack detected.",
                    ]

                # For non-interactive runners (aider/ollama) skip the Hub API protocol.
                # Aider cannot make HTTP requests, and bare URLs in the prompt cause
                # aider to auto-scrape them, polluting the context window.
                # Instead give explicit file-output instructions for the whole-edit format.
                parts += [
                    "",
                    "## Output Instructions",
                    "Write ALL required files in full. For each file:",
                    "  1. State the filename on a line by itself",
                    "  2. Output the COMPLETE file content in a fenced code block",
                    "Do NOT just describe your plan — output the actual file content.",
                    "If tests are required, output them as a separate file (e.g. test_main.py).",
                    "",
                    "## When Done",
                    "After outputting all files, write a final summary line:",
                    "  COMPLETED: <what you built> | Files: <list> | Tests: <pass/fail/n/a>",
                    "Then stop.",
                ]

                msg_content = "\n".join(parts).strip()
                prompt_preview = msg_content
            else:
                msg_content = None
                prompt_preview = (task or {}).get("description", "")

            # Write launch banner to a .banner file using Python (avoids PS5.1 quoting
            # issues with arbitrary task description text). The PS script reads and
            # displays it via Get-Content so it appears in the terminal window AND
            # gets captured by Tee-Object into the transcript log.
            sep_line = "=" * 72
            banner_lines = [
                sep_line,
                f"  BOTMASTER SESSION  {safe_sid}",
                f"  Runner  : {runner}",
                f"  Model   : {w.get('model', '—')}",
                f"  Task    : {task_title}",
                f"  Folder  : {target_dir}",
                sep_line,
                "  PROMPT SENT TO BOT:",
                "",
            ]
            for line in prompt_preview.splitlines():
                banner_lines.append(f"  {line}")
            banner_lines.append(sep_line)
            banner_lines.append("")
            banner_text = "\n".join(banner_lines) + "\n"
            banner_path = str(logs_dir / f"{safe_sid}-{run_ts}.banner")
            Path(banner_path).write_text(banner_text, encoding="utf-8")
            # Pre-seed the transcript with the banner so the web viewer shows it immediately
            # Pre-seed as UTF-16 LE with BOM so PS5.1 Tee-Object (which writes UTF-16 LE)
            # appends cleanly — Python reader detects the BOM and decodes the whole file correctly.
            Path(transcript_path).write_bytes(b'\xff\xfe' + banner_text.encode('utf-16-le'))

            pid_path = str(logs_dir / f"{safe_sid}-{run_ts}.pid")
            # Write PS $PID so hub can taskkill the process tree on Windows
            pid_write = f"$PID | Out-File -FilePath '{pid_path}' -Encoding utf8 -Force\n"
            # Force UTF-8 in the pipeline so Tee-Object captures readable text
            encoding_setup = (
                "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8\n"
                "$OutputEncoding = [System.Text.Encoding]::UTF8\n"
            )

            if is_interactive:
                # Interactive (claude_code): keep window open, use Start-Transcript.
                ps_script = (
                    f"$ErrorActionPreference = 'Continue'\n"
                    f"{encoding_setup}"
                    f"{pid_write}"
                    f"{env_setup}"
                    f"Start-Transcript -Path '{transcript_path}' -Append -Force\n"
                    f"Get-Content '{banner_path}' -Encoding UTF8\n"
                    f"$_exitCode = 0\n"
                    f"try {{\n    {launch_cmd}\n    $_exitCode = $LASTEXITCODE\n}}"
                    f" catch {{ $_exitCode = 1 }}"
                    f" finally {{\n    Stop-Transcript\n}}\n"
                    f"$_exitCode | Out-File -FilePath '{done_path}' -Encoding utf8\n"
                )
                no_exit_flag = ["-NoExit"]
            else:
                # Non-interactive (aider/ollama): pipe output through Tee-Object.
                # msg_content was computed above (before banner) so the banner shows the real prompt.
                msg_path = logs_dir / f"{safe_sid}-{run_ts}.msg"
                msg_path.write_text(msg_content, encoding="utf-8")
                msg_flag = f" --message-file '{msg_path}'"
                ps_script = (
                    f"$ErrorActionPreference = 'Continue'\n"
                    f"{encoding_setup}"
                    f"{pid_write}"
                    f"{env_setup}"
                    f"Get-Content '{banner_path}' -Encoding UTF8\n"
                    f"$_exitCode = 0\n"
                    f"try {{\n"
                    f"    {launch_cmd}{msg_flag} 2>&1 | Tee-Object -FilePath '{transcript_path}' -Append\n"
                    f"    $_exitCode = $LASTEXITCODE\n"
                    f"}} catch {{ $_exitCode = 1 }}\n"
                    f"$_exitCode | Out-File -FilePath '{done_path}' -Encoding utf8\n"
                )
                no_exit_flag = []  # window closes when aider exits

            script_path = logs_dir / f"{safe_sid}-{run_ts}.ps1"
            script_path.write_text(ps_script, encoding="utf-8")
            try:
                proc = subprocess.Popen(
                    ["wt", "new-tab", "--startingDirectory", target_dir,
                     "powershell.exe"] + no_exit_flag + ["-ExecutionPolicy", "Bypass",
                     "-File", str(script_path)],
                    creationflags=subprocess.DETACHED_PROCESS,
                )
                spawned = True
                steps.append(f"Opened Windows Terminal tab (log → {transcript_path})")
            except FileNotFoundError:
                noexit_str = "-NoExit " if is_interactive else ""
                proc = subprocess.Popen(
                    f'start powershell.exe {noexit_str}-ExecutionPolicy Bypass -File "{script_path}"',
                    shell=True, creationflags=subprocess.DETACHED_PROCESS,
                )
                spawned = True
                steps.append(f"Opened PowerShell window (log → {transcript_path})")
        else:
            # Unix: use `script` to record the terminal session
            transcript_path = str(logs_dir / f"{safe_sid}.typescript")
            subprocess.Popen(
                ["bash", "-c", f"cd '{target_dir}' && script -q -a '{transcript_path}' -c '{launch_cmd}'"],
                start_new_session=True,
            )
            spawned = True
            steps.append(f"Opened terminal (typescript → {transcript_path})")
    except Exception as e:
        errors.append(f"Terminal spawn failed: {e}")
        transcript_path = ""

    # 5. Update worker status + transcript path + PID; mark task in_progress if spawned
    new_status = "active" if spawned else "failed"
    # On Windows wt.exe is a launcher that exits in ~1s — storing its PID causes the
    # watchdog to immediately mark the worker "failed". Completion is via .done file.
    spawned_pid = None if (platform.system() == "Windows" and spawned) else (getattr(proc, 'pid', None) if spawned else None)
    with db() as c:
        now = utcnow()
        c.execute(
            "UPDATE workers SET status=?, updated_at=?, transcript_path=?, started_at=?, pid=? WHERE id=?",
            (new_status, now, transcript_path, now if spawned else None, spawned_pid, worker_id),
        )
        if spawned and task:
            c.execute(
                "UPDATE tasks SET status='in_progress', started_at=?, updated_at=? WHERE id=? AND status='queued'",
                (now, now, task["id"]),
            )
        row = c.execute("SELECT * FROM workers WHERE id=?", (worker_id,)).fetchone()

    _write_log("info" if spawned else "error", "system",
               f"Worker {worker_id} spawn: {'; '.join(steps + errors)}",
               project_id=w["project_id"], stream_id=w["stream_id"])

    return {
        "worker_id": worker_id,
        "status": new_status,
        "steps": steps,
        "errors": errors,
        "target_dir": target_dir,
    }


@app.post("/api/workers/{worker_id}/kill")
def kill_worker(worker_id: str) -> dict[str, Any]:
    with db() as c:
        row = c.execute("SELECT * FROM workers WHERE id=?", (worker_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="worker not found")
        w = _row_to_worker(row)

    killed = False
    message = "no PID tracked"
    pid = w.get("pid")
    if pid:
        if platform.system() == "Windows":
            # Kill the PowerShell process tree (which includes the aider child process)
            result = subprocess.run(
                ["taskkill", "/F", "/T", "/PID", str(pid)],
                capture_output=True, text=True,
            )
            if result.returncode == 0:
                killed = True
                message = f"taskkill /T /PID {pid} succeeded"
            else:
                # Process may already be gone
                killed = True
                message = f"taskkill /PID {pid}: {result.stderr.strip() or 'done'}"
        else:
            try:
                proc = psutil.Process(pid)
                proc.terminate()
                killed = True
                message = f"Process {pid} terminated"
            except psutil.NoSuchProcess:
                message = f"Process {pid} already gone"
                killed = True
            except Exception as e:
                message = f"Kill failed: {e}"

    with db() as c:
        now = utcnow()
        c.execute(
            "UPDATE workers SET status='killed', completed_at=?, updated_at=? WHERE id=?",
            (now, now, worker_id),
        )

    _write_log("warn", "system", f"Worker {worker_id} killed: {message}",
               project_id=w["project_id"], stream_id=w["stream_id"])
    return {"worker_id": worker_id, "killed": killed, "message": message}


_ANSI_ESCAPE = re.compile(
    r"\x1b(?:"
    r"[@-Z\\-_]"                  # single-char ESC sequences  e.g. ESC M
    r"|\[[0-?]*[ -/]*[@-~]"       # CSI sequences  e.g. ESC[1;32m  ESC[2J
    r"|\][^\x07\x1b]*(?:\x07|\x1b\\)"  # OSC sequences  e.g. window title
    r"|[()][AB012]"               # charset designations
    r")"
)

def _strip_ansi(text: str) -> str:
    """Remove ANSI escape codes and stray control characters from terminal output."""
    text = _ANSI_ESCAPE.sub("", text)
    # Remove carriage returns left by \r\n line endings
    text = text.replace("\r", "")
    # Remove other non-printable control chars except tab
    text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", text)
    return text


def _save_transcript_to_db(worker_id: str, transcript_path: str) -> None:
    """Read transcript file and persist cleaned text to DB for long-term review."""
    if not transcript_path or not Path(transcript_path).exists():
        return
    try:
        raw_bytes = Path(transcript_path).read_bytes()
        if raw_bytes[:2] in (b'\xff\xfe', b'\xfe\xff'):
            raw = raw_bytes.decode("utf-16", errors="replace")
        elif raw_bytes[:3] == b'\xef\xbb\xbf':
            raw = raw_bytes.decode("utf-8-sig", errors="replace")
        else:
            raw = raw_bytes.decode("utf-8", errors="replace")
        cleaned = _strip_ansi(raw)
        with db() as c:
            c.execute("UPDATE workers SET transcript_text=? WHERE id=?", (cleaned, worker_id))
    except Exception:
        pass


@app.get("/api/workers/{worker_id}/transcript")
def get_worker_transcript(
    worker_id: str,
    tail: int = Query(default=500, description="Last N lines to return (0 = all)"),
) -> dict[str, Any]:
    """Return the terminal session transcript for a worker, ANSI-stripped and clean."""
    with db() as c:
        row = c.execute("SELECT transcript_path, stream_id, status FROM workers WHERE id=?",
                        (worker_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="worker not found")
        # transcript_text column added in a later migration — handle hubs not yet restarted
        try:
            db_row = c.execute("SELECT transcript_text FROM workers WHERE id=?", (worker_id,)).fetchone()
            db_text_raw = (db_row["transcript_text"] if db_row else None) or ""
        except Exception:
            db_text_raw = ""
    path = row["transcript_path"] or ""
    file_missing = not path or not Path(path).exists()
    # Fall back to DB-stored text when the log file is gone (historical review)
    if file_missing:
        db_text = db_text_raw
        if not db_text:
            return {
                "worker_id": worker_id,
                "stream_id": row["stream_id"],
                "status": row["status"],
                "transcript_path": path,
                "available": False,
                "lines": [],
                "total_lines": 0,
            }
        lines = [ln for ln in db_text.splitlines() if ln.strip() or ln == ""]
        total = len(lines)
        returned = lines[-tail:] if tail and len(lines) > tail else lines
        return {
            "worker_id": worker_id,
            "stream_id": row["stream_id"],
            "status": row["status"],
            "transcript_path": path,
            "available": True,
            "lines": returned,
            "total_lines": total,
            "from_db": True,
        }
    try:
        raw_bytes = Path(path).read_bytes()
        # Detect encoding: UTF-16 LE/BE BOM → utf-16, UTF-8 BOM → utf-8-sig, else utf-8
        if raw_bytes[:2] in (b'\xff\xfe', b'\xfe\xff'):
            raw = raw_bytes.decode("utf-16", errors="replace")
        elif raw_bytes[:3] == b'\xef\xbb\xbf':
            raw = raw_bytes.decode("utf-8-sig", errors="replace")
        else:
            raw = raw_bytes.decode("utf-8", errors="replace")
        cleaned = _strip_ansi(raw)
        # Drop blank lines that were only escape codes, keep meaningful empty lines
        lines = [ln for ln in cleaned.splitlines() if ln.strip() or ln == ""]
        # Collapse runs of more than 2 consecutive blank lines to 1
        deduped: list[str] = []
        blank_run = 0
        for ln in lines:
            if ln.strip() == "":
                blank_run += 1
                if blank_run <= 1:
                    deduped.append(ln)
            else:
                blank_run = 0
                deduped.append(ln)
        total = len(deduped)
        returned = deduped[-tail:] if tail and len(deduped) > tail else deduped
        return {
            "worker_id": worker_id,
            "stream_id": row["stream_id"],
            "status": row["status"],
            "transcript_path": path,
            "available": True,
            "lines": returned,
            "total_lines": total,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Could not read transcript: {e}")


@app.post("/api/workers/{worker_id}/session-log")
def append_session_log(worker_id: str, body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    """Append a structured log entry to the worker's session log. Called by bots to record output."""
    with db() as c:
        row = c.execute("SELECT transcript_path, stream_id, project_id FROM workers WHERE id=?",
                        (worker_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="worker not found")
    content = str(body.get("content", "")).strip()
    level   = body.get("level", "info")
    if not content:
        raise HTTPException(status_code=400, detail="content required")
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    entry = f"[{ts}] [{level.upper()}] {content}\n"
    # Write to transcript file if path is set, else create one
    path = row["transcript_path"] or ""
    if not path:
        logs_dir = APP_DIR / "logs"
        logs_dir.mkdir(exist_ok=True)
        safe = "".join(c for c in row["stream_id"] if c.isalnum() or c in "-_")
        path = str(logs_dir / f"{safe}.log")
        with db() as c:
            c.execute("UPDATE workers SET transcript_path=? WHERE id=?", (path, worker_id))
    try:
        with open(path, "a", encoding="utf-8") as f:
            f.write(entry)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Write failed: {e}")
    _write_log(level, row["stream_id"], content[:200], project_id=row["project_id"])
    return {"ok": True, "path": path}


# ═══════════════════════════════════════════════════════════════════════════════
# LOGS API
# ═══════════════════════════════════════════════════════════════════════════════

@app.post("/api/logs")
def write_log(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    level = body.get("level", "info")
    source = body.get("source", "unknown")
    message = body.get("message", "")
    if not message:
        raise HTTPException(status_code=400, detail="message required")
    _write_log(level, source, message,
               project_id=body.get("project_id"),
               task_id=body.get("task_id"),
               stream_id=body.get("stream_id"))
    with db() as c:
        last_id = c.execute("SELECT last_insert_rowid() AS id").fetchone()["id"]
    return {"id": last_id, "timestamp": utcnow(), "level": level, "source": source}


@app.get("/api/logs")
def query_logs(
    level: str | None = None,
    source: str | None = None,
    project_id: str | None = None,
    stream_id: str | None = None,
    since_id: int = 0,
    limit: int = 100,
) -> list[dict[str, Any]]:
    clauses = ["id > ?"]
    params: list[Any] = [since_id]
    if level:
        clauses.append("level=?"); params.append(level)
    if source:
        clauses.append("source=?"); params.append(source)
    if project_id:
        clauses.append("project_id=?"); params.append(project_id)
    if stream_id:
        clauses.append("stream_id=?"); params.append(stream_id)
    where = "WHERE " + " AND ".join(clauses)
    limit = min(max(1, limit), 1000)
    with db() as c:
        rows = c.execute(
            f"SELECT * FROM logs {where} ORDER BY id DESC LIMIT ?",
            [*params, limit],
        ).fetchall()
    return [dict(r) for r in reversed(rows)]


@app.get("/api/logs/stream")
async def stream_logs(
    level: str | None = None,
    project_id: str | None = None,
    stream_id: str | None = None,
    source: str | None = None,
) -> EventSourceResponse:
    async def generator():
        last_id: int = 0
        # Bootstrap: send last 50 entries immediately
        entries = query_logs(level=level, project_id=project_id,
                             stream_id=stream_id, source=source, limit=50, since_id=0)
        if entries:
            last_id = entries[-1]["id"]
            for e in entries:
                yield {"data": json.dumps(e)}
        while True:
            await asyncio.sleep(1)
            new = query_logs(level=level, project_id=project_id,
                             stream_id=stream_id, source=source,
                             since_id=last_id, limit=100)
            for e in new:
                last_id = e["id"]
                yield {"data": json.dumps(e)}
    return EventSourceResponse(generator())


@app.delete("/api/logs")
def clear_old_logs(days: int = 7) -> dict[str, Any]:
    cutoff = datetime.now(timezone.utc).replace(
        hour=0, minute=0, second=0
    ).strftime("%Y-%m-%dT%H:%M:%SZ")
    with db() as c:
        result = c.execute(
            "DELETE FROM logs WHERE timestamp < ?", (cutoff,)
        )
        deleted = result.rowcount
    return {"deleted": deleted}


# ═══════════════════════════════════════════════════════════════════════════════
# CONFIG API
# ═══════════════════════════════════════════════════════════════════════════════

@app.get("/api/config")
def get_config() -> dict[str, Any]:
    with db() as c:
        rows = c.execute("SELECT key, value, description, updated_at FROM config ORDER BY key").fetchall()
    return {r["key"]: {"value": r["value"], "description": r["description"],
                        "updated_at": r["updated_at"]} for r in rows}


@app.patch("/api/config")
def update_config(body: dict[str, str] = Body(...)) -> dict[str, Any]:
    now = utcnow()
    updated = []
    with db() as c:
        for key, value in body.items():
            c.execute(
                "INSERT INTO config (key, value, description, updated_at) VALUES (?,?,'',?) "
                "ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
                (key, str(value), now),
            )
            updated.append(key)
    _write_log("info", "system", f"Config updated: {', '.join(updated)}")
    return {"updated": updated}


# ═══════════════════════════════════════════════════════════════════════════════
# SYSTEM STATUS
# ═══════════════════════════════════════════════════════════════════════════════

@app.get("/api/schema")
def db_schema() -> dict[str, Any]:
    """Return the full SQLite schema — table definitions + row counts."""
    with db() as c:
        tables = c.execute(
            "SELECT name, sql FROM sqlite_master WHERE type='table' ORDER BY name"
        ).fetchall()
        result = []
        for t in tables:
            try:
                count = c.execute(f"SELECT COUNT(*) AS n FROM [{t['name']}]").fetchone()["n"]
            except Exception:
                count = 0
            cols = c.execute(f"PRAGMA table_info([{t['name']}])").fetchall()
            result.append({
                "name": t["name"],
                "sql": t["sql"],
                "row_count": count,
                "columns": [
                    {
                        "cid": col["cid"],
                        "name": col["name"],
                        "type": col["type"],
                        "notnull": bool(col["notnull"]),
                        "default": col["dflt_value"],
                        "pk": bool(col["pk"]),
                    }
                    for col in cols
                ],
            })
    return {"tables": result, "db_path": str(DB_PATH)}


@app.get("/api/status")
def system_status() -> dict[str, Any]:
    with db() as c:
        worker_counts = {
            row["status"]: row["n"]
            for row in c.execute(
                "SELECT status, COUNT(*) AS n FROM workers GROUP BY status"
            ).fetchall()
        }
        task_counts = {
            row["status"]: row["n"]
            for row in c.execute(
                "SELECT status, COUNT(*) AS n FROM tasks GROUP BY status"
            ).fetchall()
        }
        log_count = c.execute("SELECT COUNT(*) AS n FROM logs").fetchone()["n"]
        proj_count = c.execute("SELECT COUNT(*) AS n FROM projects WHERE status='active'").fetchone()["n"]
    return {
        "uptime_seconds": int(time.time() - START_TS),
        "active_projects": proj_count,
        "workers": worker_counts,
        "tasks": task_counts,
        "log_entries": log_count,
        "python_version": sys.version.split()[0],
        "platform": platform.system(),
        "hub_version": APP_VERSION,
    }


# ═══════════════════════════════════════════════════════════════════════════════
# WATCHDOG (background task)
# ═══════════════════════════════════════════════════════════════════════════════

async def _watchdog_loop() -> None:
    await asyncio.sleep(10)  # Let startup settle
    while True:
        try:
            await _check_workers()
        except Exception as e:  # noqa: BLE001
            _write_log("error", "watchdog", f"Watchdog error: {e}")
        await asyncio.sleep(5)  # Poll every 5s for fast done-file detection


async def _check_workers() -> None:
    loop = asyncio.get_event_loop()
    stuck_threshold = int(_get_config("stuck_threshold") or "600")
    with db() as c:
        rows = c.execute(
            "SELECT * FROM workers WHERE status IN ('starting','active','idle')"
        ).fetchall()
    workers = [_row_to_worker(r) for r in rows]

    # ── Done-file detection (written by PS script when bot exits cleanly) ──
    for w in workers:
        tp = w.get("transcript_path") or ""
        if not tp:
            continue
        done_file = Path(tp).with_suffix(".done")
        if not done_file.exists():
            continue
        try:
            raw = done_file.read_text(encoding="utf-8-sig").strip()
            exit_ok = raw == "0"
        except Exception:
            exit_ok = False
        new_wstatus = "done" if exit_ok else "failed"
        now = utcnow()
        completion_note = f"Exit code {raw} — {'completed successfully' if exit_ok else 'exited with error'}"
        # Persist transcript to DB before updating status so historical review works
        _save_transcript_to_db(w["id"], w.get("transcript_path", ""))
        with db() as c:
            c.execute(
                "UPDATE workers SET status=?, completed_at=?, updated_at=?, notes=? WHERE id=?",
                (new_wstatus, now, now, completion_note, w["id"]),
            )
            if exit_ok:
                if w.get("task_id"):
                    # Task-level bot: mark its specific task done
                    c.execute(
                        "UPDATE tasks SET status='done', completed_at=?, updated_at=? WHERE id=? AND status != 'done'",
                        (now, now, w["task_id"]),
                    )
                elif w.get("mission_id"):
                    # Mission-level bot: mark all queued/in-progress tasks in the mission done
                    c.execute(
                        "UPDATE tasks SET status='done', completed_at=?, updated_at=? "
                        "WHERE mission_id=? AND status NOT IN ('done', 'blocked')",
                        (now, now, w["mission_id"]),
                    )
        try:
            done_file.unlink()
        except Exception:
            pass
        _write_log("info" if exit_ok else "warn", "watchdog",
                   f"Worker {w['id']} finished (exit={raw}) — marked {new_wstatus}",
                   project_id=w["project_id"], stream_id=w["stream_id"])

    for w in workers:
        stream = load_stream(w["stream_id"])
        if not stream:
            continue
        age = stream.get("age_seconds", 0) or 0
        meta = stream.get("meta") or {}
        session_active = meta.get("session_active", False)
        # Detect stuck
        if session_active and age > stuck_threshold and w["status"] != "stuck":
            with db() as c:
                c.execute(
                    "UPDATE workers SET status='stuck', updated_at=? WHERE id=?",
                    (utcnow(), w["id"]),
                )
            _write_log("warn", "watchdog",
                       f"Worker {w['id']} ({w['stream_id']}) stuck — {age // 60}m no update",
                       project_id=w["project_id"], stream_id=w["stream_id"])
            # Post hub issue
            try:
                data = load_stream(w["stream_id"]) or {"stream_id": w["stream_id"],
                                                         "stream_type": "dev", "active_issues": []}
                data.setdefault("active_issues", [])
                data["active_issues"] = [i for i in data["active_issues"]
                                          if i.get("code") != "worker_stuck"]
                data["active_issues"].append({
                    "severity": "warning", "code": "worker_stuck",
                    "message": f"No hub update in {age // 60}m (session_active=true)",
                    "actioned": False, "raised_at": utcnow(),
                })
                for key in ("status", "updated_at", "age_seconds"):
                    data.pop(key, None)
                status = compute_status(data)
                save_stream(w["stream_id"], data, status, utcnow())
            except Exception:  # noqa: BLE001
                pass
        # Pick up the PowerShell PID written by the .pid file (Windows only).
        # wt.exe exits in ~1s so we can't use proc.pid; instead the PS script
        # writes $PID to a sidecar file which we read here and store on the worker.
        tp = w.get("transcript_path") or ""
        if tp and not w.get("pid") and platform.system() == "Windows":
            pid_file = Path(tp.replace(".log", ".pid"))
            if pid_file.exists():
                try:
                    ps_pid = int(pid_file.read_text(encoding="utf-8").strip())
                    with db() as c:
                        c.execute("UPDATE workers SET pid=? WHERE id=?", (ps_pid, w["id"]))
                    w = dict(w)
                    w["pid"] = ps_pid
                except Exception:
                    pass

        # Detect transcript hang: non-interactive worker whose log hasn't grown in
        # 3 minutes (aider launched but produced no output — usually a prompt-toolkit
        # "no console" hang or model connection failure).
        if tp and w.get("runner_type", "claude_code") != "claude_code":
            log_path = Path(tp)
            if log_path.exists():
                try:
                    stat = log_path.stat()
                    log_age_s = time.time() - stat.st_mtime
                    log_size  = stat.st_size
                    started_at = w.get("started_at") or w.get("created_at") or ""
                    if started_at:
                        run_age_s = (datetime.now(timezone.utc) - datetime.fromisoformat(
                            started_at.replace("Z", "+00:00"))).total_seconds()
                    else:
                        run_age_s = 0
                    # Flag if: running >3min total AND log not grown in last 3min
                    # and log is tiny (just the banner, no real model output)
                    if run_age_s > 180 and log_age_s > 180 and log_size < 4096 and w["status"] != "failed":
                        _save_transcript_to_db(w["id"], tp)
                        with db() as c:
                            c.execute(
                                "UPDATE workers SET status='failed', completed_at=?, updated_at=?, notes=? WHERE id=?",
                                (utcnow(), utcnow(),
                                 "Auto-killed: no output after 3 minutes — possible hang (prompt-toolkit / model connection failure)",
                                 w["id"]),
                            )
                        # Actually kill the process tree so the terminal closes
                        hang_pid = w.get("pid")
                        if hang_pid:
                            if platform.system() == "Windows":
                                subprocess.run(
                                    ["taskkill", "/F", "/T", "/PID", str(hang_pid)],
                                    capture_output=True,
                                )
                            else:
                                try:
                                    psutil.Process(hang_pid).terminate()
                                except Exception:
                                    pass
                        _write_log("warn", "watchdog",
                                   f"Worker {w['id']} hung (no transcript growth for 3min, {log_size}b) — marked failed, kill PID {hang_pid}",
                                   project_id=w["project_id"], stream_id=w["stream_id"])
                except Exception:
                    pass

        # Detect PID death
        pid = w.get("pid")
        if pid and w["status"] in ("starting", "active"):
            try:
                psutil.Process(pid)
            except psutil.NoSuchProcess:
                with db() as c:
                    c.execute(
                        "UPDATE workers SET status='failed', updated_at=?, completed_at=? WHERE id=?",
                        (utcnow(), utcnow(), w["id"]),
                    )
                _write_log("error", "watchdog",
                           f"Worker {w['id']} PID {pid} no longer exists — marked failed",
                           project_id=w["project_id"], stream_id=w["stream_id"])


@app.on_event("startup")
async def startup() -> None:
    asyncio.create_task(_watchdog_loop())
    _write_log("info", "system", "Factory Hub started")


# ═══════════════════════════════════════════════════════════════════════════════
# STATIC UI SERVING (production — serve built React app)
# ═══════════════════════════════════════════════════════════════════════════════

_ui_dist = APP_DIR.parent / "ui" / "dist"
if _ui_dist.exists():
    from fastapi.responses import FileResponse

    app.mount("/ui", StaticFiles(directory=str(_ui_dist), html=True), name="ui")

    @app.get("/app/{rest_of_path:path}")
    async def serve_ui(rest_of_path: str) -> FileResponse:
        return FileResponse(_ui_dist / "index.html")

# ── Serve coord_client.py for workers to download ────────────────────────────

@app.get("/scripts/coord_client.py", response_class=PlainTextResponse)
def serve_coord_client() -> str:
    client_path = APP_DIR / "scripts" / "coord_client.py"
    if not client_path.exists():
        raise HTTPException(status_code=404, detail="coord_client not found")
    return client_path.read_text(encoding="utf-8")
