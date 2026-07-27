#!/usr/bin/env python3
"""Disk-backed professional client updates for PlanTakeoff EST folders.

Installed after job_server and daily_log_server. Adds a save endpoint, enriches
scan/project responses, tracks In Progress age, and preserves all existing
server handlers by delegation.
"""
from __future__ import annotations

import os
from datetime import date, datetime
from pathlib import Path
from typing import Any, Dict
from urllib.parse import urlparse

import job_server

CLIENT_UPDATE_PREFIX = "client-update-"
MAX_HTML_BYTES = 5 * 1024 * 1024


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _iso_date(value: Any) -> str:
    text = str(value or "").strip()
    try:
        return date.fromisoformat(text).isoformat()
    except ValueError:
        return date.today().isoformat()


def _days_since(value: Any):
    text = str(value or "").strip()
    if not text:
        return None
    try:
        day = date.fromisoformat(text[:10])
    except ValueError:
        return None
    return max(0, (date.today() - day).days)


def _write_text_atomic(target: Path, content: str) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    temp = target.parent / f".{target.name}.{os.getpid()}.tmp"
    temp.write_text(content, encoding="utf-8")
    temp.replace(target)


def ensure_in_progress_since(folder: Path, job: Dict[str, Any]) -> bool:
    if job.get("status") != "In Progress" or job.get("inProgressSince"):
        return False
    # Migration fallback for already-active jobs. Do not change job.updated.
    job["inProgressSince"] = str(job.get("updated") or _now())
    job_server.write_job(folder, job_server.normalize_job(folder, job))
    return True


def client_update_summary(job: Dict[str, Any]) -> Dict[str, Any]:
    last_update = str(job.get("lastClientUpdate") or "")
    in_progress_since = str(job.get("inProgressSince") or "")
    reference = last_update or in_progress_since
    days = _days_since(reference)
    overdue = job.get("status") == "In Progress" and days is not None and days >= 7
    return {
        "lastClientUpdate": last_update,
        "lastClientUpdateDate": str(job.get("lastClientUpdateDate") or (last_update[:10] if last_update else "")),
        "lastClientUpdateFile": str(job.get("lastClientUpdateFile") or ""),
        "inProgressSince": in_progress_since,
        "daysSinceClientUpdate": days,
        "clientUpdateOverdue": overdue,
    }


def save_client_update(server_module, payload: Dict[str, Any]) -> Dict[str, Any]:
    folder = job_server._validated_folder(server_module, payload)
    html = str(payload.get("html") or "")
    if not html.strip():
        raise ValueError("Generated client update HTML is required")
    if len(html.encode("utf-8")) > MAX_HTML_BYTES:
        raise ValueError("Client update HTML is too large")

    update_date = _iso_date(payload.get("date"))
    target = folder / f"{CLIENT_UPDATE_PREFIX}{update_date}.html"
    _write_text_atomic(target, html)

    created_at = _now()
    job = job_server.read_or_create_job(folder)
    if job.get("status") == "In Progress" and not job.get("inProgressSince"):
        job["inProgressSince"] = str(job.get("updated") or created_at)
    job["lastClientUpdate"] = created_at
    job["lastClientUpdateDate"] = update_date
    job["lastClientUpdateFile"] = str(target)
    job["updated"] = created_at
    job = job_server.write_job(folder, job_server.normalize_job(folder, job))

    return {
        "job": job,
        "summary": client_update_summary(job),
        "file": str(target),
        "createdAt": created_at,
    }


def update_job_with_client_tracking(server_module, payload: Dict[str, Any]) -> Dict[str, Any]:
    folder = job_server._validated_folder(server_module, payload)
    previous = job_server.read_or_create_job(folder)
    previous_status = previous.get("status")
    job = job_server.update_job(server_module, payload)

    if job.get("status") == "In Progress" and previous_status != "In Progress":
        job["inProgressSince"] = _now()
        job = job_server.write_job(folder, job_server.normalize_job(folder, job))
    elif job.get("status") == "In Progress" and not job.get("inProgressSince"):
        job["inProgressSince"] = str(job.get("updated") or _now())
        job = job_server.write_job(folder, job_server.normalize_job(folder, job))

    return job


def install(server_module) -> None:
    """Install after the existing job and daily-log server extensions."""
    if getattr(server_module, "_client_updates_installed", False):
        return
    server_module._client_updates_installed = True
    server_module.save_client_update = lambda payload: save_client_update(server_module, payload)

    original_scan_project = server_module.scan_project

    def scan_project_with_client_updates(folder: Path):
        result = original_scan_project(folder)
        try:
            job = result.get("job") or job_server.read_or_create_job(folder)
            ensure_in_progress_since(folder, job)
            result["job"] = job
            result["client_update_summary"] = client_update_summary(job)
        except Exception as exc:  # Client updates must never break EST scans.
            result["client_update_summary"] = client_update_summary(result.get("job") or {})
            result["client_update_error"] = str(exc)
        return result

    server_module.scan_project = scan_project_with_client_updates

    original_post = server_module.Handler.do_POST

    def do_post_with_client_updates(self):
        api_path = urlparse(self.path).path
        if api_path not in ("/api/client-update/save", "/api/job/update"):
            return original_post(self)
        try:
            body = self._read_json()
            if api_path == "/api/client-update/save":
                result = save_client_update(server_module, body)
                return self._send_json({"ok": True, **result})
            job = update_job_with_client_tracking(server_module, body)
            return self._send_json({"ok": True, "job": job})
        except ValueError as exc:
            return self._send_json({"ok": False, "error": str(exc)}, 400)
        except Exception as exc:
            return self._send_json({"ok": False, "error": str(exc)}, 500)

    server_module.Handler.do_POST = do_post_with_client_updates
