"""Factory Hub client — stdlib only, copy into any project."""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from typing import Any

DEFAULT_URL = "http://localhost:9100"
TIMEOUT = 5


class FactoryClient:
    def __init__(self, base_url: str | None = None, stream_id: str | None = None) -> None:
        self.base_url = (base_url or os.environ.get("FACTORY_HUB_URL") or DEFAULT_URL).rstrip("/")
        self.stream_id = stream_id or os.environ.get("FACTORY_STREAM_ID")
        self._cache: dict[str, Any] = {}

    def _request(self, method: str, path: str, body: dict | None = None) -> Any:
        url = f"{self.base_url}{path}"
        data = None
        headers = {"Accept": "application/json"}
        if body is not None:
            data = json.dumps(body).encode()
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            raw = r.read().decode()
        return json.loads(raw) if raw else {}

    def _safe(self, method: str, path: str, body: dict | None = None) -> Any:
        try:
            return self._request(method, path, body)
        except urllib.error.HTTPError as e:
            try:
                err = e.read().decode()
            except Exception:
                err = e.reason
            return {"error": f"HTTP {e.code}: {err}"}
        except Exception as e:  # noqa: BLE001
            return {"error": f"{type(e).__name__}: {e}"}

    def _sid(self, stream_id: str | None = None) -> str:
        sid = stream_id or self.stream_id
        if not sid:
            raise ValueError("stream_id not set")
        return sid

    # ── Stream ────────────────────────────────────────────────────────────────

    def update(self, **kwargs: Any) -> dict:
        """Post current status. Merges kwargs into local cache, sends full state."""
        sid = self._sid(kwargs.pop("stream_id", None))
        self._cache.update(kwargs)
        payload = dict(self._cache)
        payload["stream_id"] = sid
        result = self._safe("POST", f"/api/streams/{sid}", body=payload)
        if isinstance(result, dict) and "error" not in result:
            print(f"[hub] {sid}: {result.get('status')} @ {result.get('updated_at')}")
        else:
            print(f"[hub] {sid}: {result}", file=sys.stderr)
        return result if isinstance(result, dict) else {"error": "unexpected"}

    def get_stream(self, stream_id: str | None = None) -> dict:
        return self._safe("GET", f"/api/streams/{self._sid(stream_id)}")

    def get_all_streams(self) -> list[dict]:
        r = self._safe("GET", "/api/streams")
        return r if isinstance(r, list) else []

    def get_urgent(self) -> list[dict]:
        r = self._safe("GET", "/api/urgent")
        return r if isinstance(r, list) else []

    def add_issue(self, severity: str, code: str, message: str,
                  stream_id: str | None = None) -> dict:
        sid = self._sid(stream_id)
        r = self._safe("POST", f"/api/streams/{sid}/issue",
                       {"severity": severity, "code": code, "message": message})
        print(f"[hub] issue {code} → {sid}: {r.get('status') if isinstance(r, dict) else r}")
        return r if isinstance(r, dict) else {"error": "unexpected"}

    def resolve_issue(self, code: str, stream_id: str | None = None) -> dict:
        sid = self._sid(stream_id)
        r = self._safe("POST", f"/api/streams/{sid}/resolve/{code}")
        print(f"[hub] resolved {code} on {sid}")
        return r if isinstance(r, dict) else {"error": "unexpected"}

    # ── Inbox ─────────────────────────────────────────────────────────────────

    def send_message(self, to_stream: str, code: str, message: str) -> dict:
        sid = self._sid()
        r = self._safe("POST", f"/api/streams/{to_stream}/inbox",
                       {"from_stream": sid, "code": code, "message": message})
        if isinstance(r, dict) and "error" not in r:
            print(f"[hub] ✉ → {to_stream} [{code}]")
        else:
            print(f"[hub] inbox error → {to_stream}: {r}", file=sys.stderr)
        return r if isinstance(r, dict) else {"error": "unexpected"}

    def get_messages(self, stream_id: str | None = None) -> list[dict]:
        sid = self._sid(stream_id)
        r = self._safe("GET", f"/api/streams/{sid}/inbox")
        return r if isinstance(r, list) else []

    def resolve_message(self, code: str, stream_id: str | None = None) -> dict:
        sid = self._sid(stream_id)
        r = self._safe("POST", f"/api/streams/{sid}/inbox/{code}/resolve")
        print(f"[hub] ✓ resolved message {code} on {sid}")
        return r if isinstance(r, dict) else {"error": "unexpected"}

    # ── Tasks ─────────────────────────────────────────────────────────────────

    def get_my_task(self, stream_id: str | None = None) -> dict | None:
        """Get the in_progress task currently assigned to this stream."""
        sid = self._sid(stream_id)
        r = self._safe("GET", f"/api/tasks?stream_id={sid}&status=in_progress")
        tasks = r if isinstance(r, list) else []
        return tasks[0] if tasks else None

    def claim_task(self, task_id: str, stream_id: str | None = None) -> dict:
        """Mark a task in_progress and assign to this stream."""
        sid = self._sid(stream_id)
        return self._safe("PATCH", f"/api/tasks/{task_id}",
                          {"status": "in_progress", "stream_id": sid})

    def complete_task(self, task_id: str, notes: str = "", cost_tokens: int = 0) -> dict:
        payload: dict[str, Any] = {"status": "done"}
        if notes:
            payload["notes"] = notes
        if cost_tokens:
            payload["cost_tokens"] = cost_tokens
        r = self._safe("PATCH", f"/api/tasks/{task_id}", payload)
        print(f"[hub] task {task_id} → done")
        return r if isinstance(r, dict) else {"error": "unexpected"}

    def block_task(self, task_id: str, reason: str) -> dict:
        return self._safe("PATCH", f"/api/tasks/{task_id}",
                          {"status": "blocked", "notes": reason})

    def next_task(self, project_id: str | None = None) -> dict | None:
        path = "/api/tasks/next"
        if project_id:
            path += f"?project_id={project_id}"
        r = self._safe("GET", path)
        return r if isinstance(r, dict) and "id" in r else None

    # ── Projects ──────────────────────────────────────────────────────────────

    def get_project(self, project_id: str) -> dict:
        return self._safe("GET", f"/api/projects/{project_id}")

    def list_projects(self) -> list[dict]:
        r = self._safe("GET", "/api/projects")
        return r if isinstance(r, list) else []


if __name__ == "__main__":
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("cmd", choices=["urgent", "streams", "projects", "next"])
    p.add_argument("--project", default=None)
    args = p.parse_args()
    c = FactoryClient()
    if args.cmd == "urgent":
        print(json.dumps(c.get_urgent(), indent=2))
    elif args.cmd == "streams":
        print(json.dumps(c.get_all_streams(), indent=2))
    elif args.cmd == "projects":
        print(json.dumps(c.list_projects(), indent=2))
    elif args.cmd == "next":
        print(json.dumps(c.next_task(args.project), indent=2))
