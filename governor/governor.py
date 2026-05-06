"""
Factory Governor v2 — triage loop with free-model intelligence.

Changes from v1:
  - Polls open bot questions from hub; triages with Gemini Flash or Ollama
  - Auto-replies to answerable questions; alerts human for blockers
  - Push notifications via ntfy.sh (optional, free)
  - Config loaded from hub settings API
  - All triage actions logged to hub audit trail

Run: python governor.py [--hub URL] [--interval SECONDS] [--once]
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from typing import Any

# ── Defaults (overridden by hub config) ──────────────────────────────────────

DEFAULT_HUB            = "http://localhost:9100"
DEFAULT_INTERVAL       = 60      # seconds
STUCK_THRESHOLD        = 600     # 10 min without update
STALE_ISSUE_CODE       = "session_stale"

RED    = "\033[91m"
YELLOW = "\033[93m"
GREEN  = "\033[92m"
CYAN   = "\033[96m"
BOLD   = "\033[1m"
RESET  = "\033[0m"


# ── HTTP helpers ──────────────────────────────────────────────────────────────

def _get(url: str, timeout: int = 5) -> Any:
    try:
        req = urllib.request.Request(url, headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode())
    except Exception as e:
        return {"error": str(e)}


def _post(url: str, body: dict, timeout: int = 10) -> Any:
    try:
        data = json.dumps(body).encode()
        req = urllib.request.Request(
            url, data=data,
            headers={"Content-Type": "application/json", "Accept": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode())
    except Exception as e:
        return {"error": str(e)}


def _patch(url: str, body: dict, timeout: int = 5) -> Any:
    try:
        data = json.dumps(body).encode()
        req = urllib.request.Request(
            url, data=data,
            headers={"Content-Type": "application/json", "Accept": "application/json"},
            method="PATCH",
        )
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode())
    except Exception as e:
        return {"error": str(e)}


# ── Hub config ────────────────────────────────────────────────────────────────

def load_hub_config(hub: str) -> dict[str, str]:
    raw = _get(f"{hub}/api/config")
    if isinstance(raw, dict) and "error" not in raw:
        return {k: v.get("value", "") for k, v in raw.items() if isinstance(v, dict)}
    return {}


def cfg(config: dict, key: str, default: str = "") -> str:
    return config.get(key, default) or default


# ── Free model callers ────────────────────────────────────────────────────────

def call_gemini(api_key: str, prompt: str) -> str:
    url = (
        "https://generativelanguage.googleapis.com/v1beta/models/"
        f"gemini-2.0-flash:generateContent?key={api_key}"
    )
    body = {"contents": [{"parts": [{"text": prompt}]}]}
    req = urllib.request.Request(
        url, data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        data = json.loads(r.read())
    return data["candidates"][0]["content"]["parts"][0]["text"]


def call_ollama(model: str, prompt: str) -> str:
    body = {"model": model, "prompt": prompt, "stream": False}
    req = urllib.request.Request(
        "http://localhost:11434/api/generate",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=90) as r:
        data = json.loads(r.read())
    return data["response"]


def call_free_model(config: dict, prompt: str) -> str | None:
    model = cfg(config, "triage_model", "gemini-flash")
    try:
        if model == "gemini-flash":
            api_key = cfg(config, "google_api_key")
            if not api_key:
                return None
            return call_gemini(api_key, prompt)
        elif model.startswith("ollama:"):
            return call_ollama(model[7:], prompt)
        elif model == "ollama":
            return call_ollama("qwen2.5-coder:7b", prompt)
    except Exception as e:
        log(f"  [triage model error] {e}", YELLOW)
    return None


# ── Logging helpers ───────────────────────────────────────────────────────────

def ts() -> str:
    return datetime.now().strftime("%H:%M:%S")


def log(msg: str, colour: str = "") -> None:
    print(f"{colour}[{ts()}] {msg}{RESET}", flush=True)


def hub_log(hub: str, level: str, message: str, project_id: str | None = None) -> None:
    body: dict[str, Any] = {"level": level, "source": "governor", "message": message}
    if project_id:
        body["project_id"] = project_id
    _post(f"{hub}/api/logs", body)


def ntfy_alert(topic: str, title: str, message: str, priority: str = "default") -> None:
    if not topic:
        return
    try:
        req = urllib.request.Request(
            f"https://ntfy.sh/{topic}",
            data=message[:500].encode(),
            headers={"Title": title[:100], "Priority": priority},
            method="POST",
        )
        urllib.request.urlopen(req, timeout=5)
        log(f"  Push notification sent to ntfy.sh/{topic}", CYAN)
    except Exception as e:
        log(f"  ntfy.sh failed: {e}", YELLOW)


# ── Question triage ───────────────────────────────────────────────────────────

TRIAGE_PROMPT = """You are a technical assistant helping manage an AI coding agent.
The agent posted this message to its supervisor:

Code: {code}
Stream: {stream_id}
Message: {message}
Waiting: {wait_mins} minutes unanswered

Respond with ONLY valid JSON (no markdown, no extra text):
{{
  "urgency": "high|medium|low",
  "can_auto_reply": true|false,
  "auto_reply": "your reply text or null",
  "reason": "one sentence explaining your decision"
}}

Rules:
- can_auto_reply=true ONLY when you can give a clear, unambiguous technical answer
- BLOCKER code → urgency always high
- Questions about code style, naming, safe defaults → can_auto_reply=true
- Questions needing business decisions, missing codebase context → can_auto_reply=false, urgency=medium
- Questions unanswered > 20 minutes → urgency=high regardless
- auto_reply must be a helpful, direct answer (not "I suggest you..."), or null
"""


def triage_question(hub: str, config: dict, q: dict) -> None:
    stream_id = q.get("stream_id") or q.get("target_stream", "unknown")
    msg_id    = q["id"]
    code      = q.get("code", "QUESTION").upper()
    message   = q.get("message", "")
    sent_at   = q.get("sent_at", "")
    project_id = q.get("project_id")

    try:
        sent_dt = datetime.fromisoformat(sent_at.replace("Z", "+00:00"))
        wait_secs = (datetime.now(timezone.utc) - sent_dt).total_seconds()
    except Exception:
        wait_secs = 0
    wait_mins = int(wait_secs / 60)

    alert_thresh = int(cfg(config, "triage_alert_threshold", "15"))
    auto_reply_enabled = cfg(config, "triage_auto_reply", "true").lower() == "true"

    prompt = TRIAGE_PROMPT.format(
        code=code, stream_id=stream_id, message=message, wait_mins=wait_mins
    )

    response = call_free_model(config, prompt)
    if not response:
        # No model configured — fall back to rule-based
        urgency = "high" if code == "BLOCKER" or wait_mins >= alert_thresh else "medium"
        if urgency == "high":
            hub_log(hub, "warn", f"[{stream_id}] {code}: {message[:120]} (no triage model — rule-based alert)", project_id)
            ntfy_alert(
                cfg(config, "ntfy_topic"), f"Bot needs help — {code}",
                f"{stream_id}: {message[:300]}", "high" if code == "BLOCKER" else "default"
            )
        return

    # Parse JSON from model response
    try:
        match = re.search(r"\{.*\}", response, re.DOTALL)
        if not match:
            raise ValueError("no JSON found in model response")
        result = json.loads(match.group())
    except Exception as e:
        log(f"  [triage parse error] {e}: {response[:100]}", YELLOW)
        return

    urgency    = result.get("urgency", "medium")
    can_reply  = result.get("can_auto_reply", False)
    auto_reply = result.get("auto_reply") or ""
    reason     = result.get("reason", "")

    colour = RED if urgency == "high" else YELLOW if urgency == "medium" else ""
    log(f"  Q [{stream_id}] {code} urgency={urgency}: {message[:70]}…", colour)
    if reason:
        log(f"    → {reason}")

    if can_reply and auto_reply and auto_reply_enabled:
        # Post reply to bot's inbox
        _post(f"{hub}/api/streams/{stream_id}/inbox", {
            "from_stream": "governor",
            "code": "REPLY",
            "message": f"[Governor] {auto_reply}",
        })
        # Mark original resolved
        _post(f"{hub}/api/inbox/{msg_id}/resolve", {})
        log(f"    → Auto-replied: {auto_reply[:80]}", GREEN)
        hub_log(hub, "info", f"Governor auto-replied to {stream_id}: {auto_reply[:120]}", project_id)
    elif urgency == "high" or wait_mins >= alert_thresh:
        hub_log(hub, "warn", f"NEEDS ATTENTION [{stream_id}] {code}: {message[:200]}", project_id)
        log(f"    → Alert posted to hub (UI will show toast)", YELLOW)
        ntfy_alert(
            cfg(config, "ntfy_topic"),
            f"Bot alert — {code} ({stream_id})",
            f"{message[:300]}\n\nWaiting {wait_mins}m",
            "high" if urgency == "high" else "default",
        )


# ── Worker stuck detection ────────────────────────────────────────────────────

def check_stuck_workers(hub: str, config: dict) -> None:
    workers = _get(f"{hub}/api/workers?status=active")
    if not isinstance(workers, list):
        return
    stuck_thresh = int(cfg(config, "stuck_threshold_minutes", "10")) * 60
    for w in workers:
        age = w.get("stream_age") or 0
        sid = w.get("stream_id", "?")
        wid = w.get("id", "?")
        if isinstance(age, (int, float)) and age > stuck_thresh:
            mins = int(age // 60)
            log(f"  STUCK: {sid} ({mins}m no update)", RED)
            _patch(f"{hub}/api/workers/{wid}", {"status": "stuck"})
            hub_log(hub, "warn", f"Worker {sid} marked stuck — {mins}m since last update",
                    w.get("project_id"))
            ntfy_alert(
                cfg(config, "ntfy_topic"),
                f"Bot stuck — {sid}",
                f"No hub update for {mins} minutes.",
                "high",
            )


# ── Project completion detection ──────────────────────────────────────────────

def check_project_completion(hub: str) -> None:
    projects = _get(f"{hub}/api/projects")
    if not isinstance(projects, list):
        return
    for proj in projects:
        pid   = proj.get("id", "?")
        pname = proj.get("name", pid)
        if proj.get("status") != "active":
            continue
        tasks = _get(f"{hub}/api/tasks?project_id={pid}")
        if not isinstance(tasks, list) or not tasks:
            continue
        total = len(tasks)
        done  = sum(1 for t in tasks if t.get("status") == "done")
        if total > 0 and done == total:
            log(f"  {GREEN}{BOLD}PROJECT COMPLETE: {pname} — all {total} tasks done!{RESET}", GREEN)
            _patch(f"{hub}/api/projects/{pid}", {"status": "done"})
            hub_log(hub, "info", f"Project {pname} complete — all {total} tasks done")


# ── Poll ──────────────────────────────────────────────────────────────────────

def poll(hub: str, config: dict) -> None:
    log(f"── Poll @ {datetime.now().strftime('%Y-%m-%d %H:%M:%S')} ──", BOLD)

    # 1. Stuck worker detection
    check_stuck_workers(hub, config)

    # 2. Question triage — scan all active missions
    missions = _get(f"{hub}/api/missions")
    if isinstance(missions, list):
        for mission in missions:
            if mission.get("status") not in ("active", "running"):
                continue
            mid = mission["id"]
            questions = _get(f"{hub}/api/missions/{mid}/questions")
            if not isinstance(questions, list) or not questions:
                continue
            log(f"  Mission {mission.get('name', mid)}: {len(questions)} open question(s)")
            for q in questions:
                triage_question(hub, config, q)

    # 3. Project completion
    check_project_completion(hub)

    # 4. Summary
    workers = _get(f"{hub}/api/workers")
    if isinstance(workers, list):
        by_status: dict[str, int] = {}
        for w in workers:
            s = w.get("status", "unknown")
            by_status[s] = by_status.get(s, 0) + 1
        parts = [f"{v} {k}" for k, v in sorted(by_status.items()) if v]
        log(f"  Workers: {', '.join(parts) or 'none'}")

    print()


# ── Main loop ─────────────────────────────────────────────────────────────────

def run(hub: str, interval: int) -> None:
    log(f"Factory Governor v2 starting — hub={hub}, interval={interval}s", BOLD)
    log(f"Dashboard: {hub}/dashboard", CYAN)
    print()

    while True:
        try:
            config = load_hub_config(hub)
            if not config:
                log("Hub unreachable — retrying…", YELLOW)
            else:
                # Allow hub config to override interval
                hub_interval = cfg(config, "triage_interval", "")
                if hub_interval.isdigit():
                    interval = int(hub_interval)
                poll(hub, config)
        except KeyboardInterrupt:
            log("Governor stopped.", YELLOW)
            sys.exit(0)
        except Exception as e:
            log(f"Poll error: {e}", RED)
        time.sleep(interval)


if __name__ == "__main__":
    p = argparse.ArgumentParser(description="Factory Governor v2")
    p.add_argument("--hub", default=DEFAULT_HUB)
    p.add_argument("--interval", type=int, default=DEFAULT_INTERVAL)
    p.add_argument("--once", action="store_true", help="Poll once and exit")
    args = p.parse_args()

    if args.once:
        config = load_hub_config(args.hub)
        poll(args.hub, config)
    else:
        run(args.hub, args.interval)
