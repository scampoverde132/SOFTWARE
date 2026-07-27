#!/usr/bin/env python3
"""Additive disk-backed daily job-site logs for PlanTakeoff EST folders.

Installed after ``job_server`` by ``desktop_app.py``. The module adds
``POST /api/daily-logs/save`` and enriches existing scan/project responses
without replacing any current server, job, takeoff, finalization, or
change-order behavior.
"""
from __future__ import annotations

import json
import os
import uuid
from datetime import date, datetime
from pathlib import Path
from typing import Any, Dict, List
from urllib.parse import urlparse

import job_server

DAILY_LOGS_FILE = "daily-logs.json"


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _number(value: Any) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def _whole(value: Any) -> int:
    try:
        return max(0, int(float(value or 0)))
    except (TypeError, ValueError):
        return 0


def _percent(value: Any) -> float:
    return max(0.0, min(100.0, _number(value)))


def _iso_date(value: Any) -> str:
    text = str(value or "").strip()
    try:
        return date.fromisoformat(text).isoformat()
    except ValueError:
        return date.today().isoformat()


def _normalize_photo(photo: Any) -> Dict[str, Any] | None:
    if isinstance(photo, str):
        text = photo.strip()
        if not text:
            return None
        if text.startswith("data:image/"):
            return {"type": "thumbnail", "name": "Photo", "thumbnail": text}
        return {"type": "path", "path": text, "name": Path(text).name or text}
    if not isinstance(photo, dict):
        return None

    photo_type = "thumbnail" if photo.get("thumbnail") else "path"
    result: Dict[str, Any] = {
        "type": photo_type,
        "name": str(photo.get("name") or "Photo"),
    }
    if photo_type == "thumbnail":
        thumbnail = str(photo.get("thumbnail") or "")
        if not thumbnail.startswith("data:image/"):
            return None
        result["thumbnail"] = thumbnail
        if photo.get("mime"):
            result["mime"] = str(photo.get("mime"))
    else:
        path = str(photo.get("path") or "").strip()
        if not path:
            return None
        result["path"] = path
    return result


def _normalize_log(entry: Any, index: int = 0) -> Dict[str, Any]:
    source = entry if isinstance(entry, dict) else {}
    created = str(source.get("created") or _now())
    photos = []
    for photo in source.get("photos") if isinstance(source.get("photos"), list) else []:
        normalized = _normalize_photo(photo)
        if normalized:
            photos.append(normalized)

    mode = "manual" if source.get("percentMode") == "manual" else "auto"
    return {
        "id": str(source.get("id") or uuid.uuid4()),
        "date": _iso_date(source.get("date")),
        "weather": str(source.get("weather") or ""),
        "crewCount": _whole(source.get("crewCount")),
        "hours": max(0.0, _number(source.get("hours"))),
        "workPerformed": str(source.get("workPerformed") or ""),
        "percentComplete": _percent(source.get("percentComplete")),
        "percentMode": mode,
        "photos": photos,
        "issues": str(source.get("issues") or ""),
        "created": created,
        "updated": str(source.get("updated") or created),
    }


def _write_json_atomic(target: Path, data: Any) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    temp = target.parent / f".{target.name}.{os.getpid()}.tmp"
    temp.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    temp.replace(target)


def read_daily_logs(folder: Path) -> List[Dict[str, Any]]:
    target = folder / DAILY_LOGS_FILE
    if not target.is_file():
        return []
    try:
        raw = json.loads(target.read_text(encoding="utf-8-sig"))
    except (OSError, json.JSONDecodeError):
        return []
    if isinstance(raw, dict):
        raw = raw.get("dailyLogs")
    if not isinstance(raw, list):
        return []
    return [_normalize_log(entry, index) for index, entry in enumerate(raw)]


def write_daily_logs(folder: Path, logs: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    normalized = [_normalize_log(entry, index) for index, entry in enumerate(logs)]
    normalized.sort(key=lambda entry: (entry.get("date", ""), entry.get("created", "")))
    _write_json_atomic(
        folder / DAILY_LOGS_FILE,
        {"version": 1, "updated": _now(), "dailyLogs": normalized},
    )
    return normalized


def daily_log_summary(logs: List[Dict[str, Any]]) -> Dict[str, Any]:
    ordered = sorted(
        logs,
        key=lambda entry: (entry.get("date", ""), entry.get("created", "")),
        reverse=True,
    )
    latest = ordered[0] if ordered else None
    last_date = str(latest.get("date") or "") if latest else ""
    days_since = None
    if last_date:
        try:
            days_since = max(0, (date.today() - date.fromisoformat(last_date)).days)
        except ValueError:
            days_since = None

    return {
        "dailyLogCount": len(logs),
        "lastLogDate": last_date,
        "lastLogAt": str(latest.get("created") or "") if latest else "",
        "daysSinceLastLog": days_since,
        "percentComplete": _percent(latest.get("percentComplete")) if latest else 0.0,
        "totalLoggedCrewHours": sum(
            _whole(entry.get("crewCount")) * max(0.0, _number(entry.get("hours")))
            for entry in logs
        ),
        "logsWithIssues": sum(1 for entry in logs if str(entry.get("issues") or "").strip()),
    }


def apply_daily_log_summary(job: Dict[str, Any], logs: List[Dict[str, Any]]) -> Dict[str, Any]:
    summary = daily_log_summary(logs)
    # daysSinceLastLog is computed at read time and intentionally not persisted;
    # otherwise a routine scan would change job.updated and distort revenue dates.
    for key in (
        "dailyLogCount",
        "lastLogDate",
        "lastLogAt",
        "percentComplete",
        "totalLoggedCrewHours",
        "logsWithIssues",
    ):
        job[key] = summary[key]
    return summary


def save_daily_logs(server_module, payload: Dict[str, Any]) -> Dict[str, Any]:
    folder = job_server._validated_folder(server_module, payload)
    existing = read_daily_logs(folder)

    if isinstance(payload.get("log"), dict):
        candidate = _normalize_log(payload.get("log"), len(existing))
        replaced = False
        logs: List[Dict[str, Any]] = []
        for entry in existing:
            if entry.get("id") == candidate.get("id"):
                logs.append(candidate)
                replaced = True
            else:
                logs.append(entry)
        if not replaced:
            logs.append(candidate)
    elif isinstance(payload.get("dailyLogs"), list):
        incoming = [_normalize_log(entry, index) for index, entry in enumerate(payload.get("dailyLogs"))]
        incoming_by_id = {entry["id"]: entry for entry in incoming}
        logs = [incoming_by_id.pop(entry["id"], entry) for entry in existing]
        logs.extend(incoming_by_id.values())
    else:
        raise ValueError("Provide a daily log or dailyLogs array")

    logs = write_daily_logs(folder, logs)
    job = job_server.read_or_create_job(folder)
    summary = apply_daily_log_summary(job, logs)
    job["updated"] = _now()
    job = job_server.write_job(folder, job_server.normalize_job(folder, job))
    return {"dailyLogs": logs, "summary": summary, "job": job}


def install(server_module) -> None:
    """Install daily logs after the existing job server extension."""
    if getattr(server_module, "_daily_logs_installed", False):
        return
    server_module._daily_logs_installed = True
    server_module.read_daily_logs = read_daily_logs
    server_module.save_daily_logs = lambda payload: save_daily_logs(server_module, payload)

    original_scan_project = server_module.scan_project

    def scan_project_with_daily_logs(folder: Path):
        result = original_scan_project(folder)
        try:
            logs = read_daily_logs(folder)
            job = result.get("job") or job_server.read_or_create_job(folder)
            before = {
                key: job.get(key)
                for key in (
                    "dailyLogCount",
                    "lastLogDate",
                    "lastLogAt",
                    "percentComplete",
                    "totalLoggedCrewHours",
                    "logsWithIssues",
                )
            }
            summary = apply_daily_log_summary(job, logs)
            after = {key: job.get(key) for key in before}
            if before != after:
                job["updated"] = _now()
                job_server.write_job(folder, job_server.normalize_job(folder, job))
            result["job"] = job
            result["daily_logs"] = logs
            result["daily_log_summary"] = summary
        except Exception as exc:  # Daily logging must never break job scanning.
            result["daily_logs"] = []
            result["daily_log_summary"] = daily_log_summary([])
            result["daily_log_error"] = str(exc)
        return result

    server_module.scan_project = scan_project_with_daily_logs

    original_post = server_module.Handler.do_POST

    def do_post_with_daily_logs(self):
        if urlparse(self.path).path != "/api/daily-logs/save":
            return original_post(self)
        try:
            body = self._read_json()
            result = save_daily_logs(server_module, body)
            return self._send_json({"ok": True, **result})
        except ValueError as exc:
            return self._send_json({"ok": False, "error": str(exc)}, 400)
        except Exception as exc:
            return self._send_json({"ok": False, "error": str(exc)}, 500)

    server_module.Handler.do_POST = do_post_with_daily_logs
