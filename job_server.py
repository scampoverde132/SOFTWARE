#!/usr/bin/env python3
"""Additive disk-backed Job model for PlanTakeoff EST folders.

Installed into the existing ``server`` module by ``desktop_app.py``. The patch
wraps scan/create behavior and adds ``POST /api/job/update`` without changing
any existing folder, PDF, takeoff, or AI endpoints.
"""
from __future__ import annotations

import json
import os
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict
from urllib.parse import urlparse

JOB_FILE = "job.json"
ALLOWED_STATUSES = (
    "Lead",
    "Estimating",
    "Bid Sent",
    "Awarded",
    "In Progress",
    "Punch",
    "Complete",
    "Lost",
)


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _number(value: Any) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def _folder_created(folder: Path) -> str:
    try:
        return datetime.fromtimestamp(folder.stat().st_ctime).isoformat(timespec="seconds")
    except OSError:
        return _now()


def default_job(folder: Path, *, status: str = "Lead") -> Dict[str, Any]:
    bid_ref, project_name = _parse_folder_name(folder.name)
    return {
        "id": str(uuid.uuid5(uuid.NAMESPACE_URL, str(folder.resolve()).lower())),
        "name": project_name or bid_ref or folder.name,
        "path": str(folder),
        "status": status if status in ALLOWED_STATUSES else "Lead",
        "created": _folder_created(folder),
        "updated": _now(),
        "notes": "",
        "clientName": "",
        "address": "",
        "estimatedTotal": 0.0,
        "actualTotal": 0.0,
    }


def _parse_folder_name(name: str):
    # Mirrors server.parse_folder_name but keeps this module independently testable.
    import re

    match = re.match(r"^(EST\d+)\s*[-–]\s*(.+)$", (name or "").strip(), re.I)
    if match:
        return match.group(1).upper(), match.group(2).strip()
    return name, name


def normalize_job(folder: Path, data: Any = None, *, default_status: str = "Lead") -> Dict[str, Any]:
    base = default_job(folder, status=default_status)
    source = data if isinstance(data, dict) else {}
    job = {**source, **{key: source.get(key, value) for key, value in base.items()}}

    # Folder structure remains the source of truth for identity/location.
    _, project_name = _parse_folder_name(folder.name)
    job["id"] = str(source.get("id") or base["id"])
    job["name"] = project_name or folder.name
    job["path"] = str(folder)
    job["status"] = source.get("status") if source.get("status") in ALLOWED_STATUSES else base["status"]
    job["created"] = str(source.get("created") or base["created"])
    job["updated"] = str(source.get("updated") or base["updated"])
    job["notes"] = str(source.get("notes") or "")
    job["clientName"] = str(source.get("clientName") or "")
    job["address"] = str(source.get("address") or "")
    job["estimatedTotal"] = _number(source.get("estimatedTotal"))
    job["actualTotal"] = _number(source.get("actualTotal"))
    return job


def write_job(folder: Path, job: Dict[str, Any]) -> Dict[str, Any]:
    folder.mkdir(parents=True, exist_ok=True)
    target = folder / JOB_FILE
    temp = folder / f".{JOB_FILE}.{os.getpid()}.tmp"
    payload = json.dumps(job, indent=2, ensure_ascii=False) + "\n"
    temp.write_text(payload, encoding="utf-8")
    temp.replace(target)
    return job


def read_or_create_job(folder: Path, *, default_status: str = "Lead") -> Dict[str, Any]:
    target = folder / JOB_FILE
    raw: Any = None
    if target.is_file():
        try:
            raw = json.loads(target.read_text(encoding="utf-8-sig"))
        except (OSError, json.JSONDecodeError):
            raw = None
    job = normalize_job(folder, raw, default_status=default_status)

    # Scan is also the migration path: missing fields and invalid files are repaired.
    if raw != job:
        write_job(folder, job)
    return job


def update_job(server_module, payload: Dict[str, Any]) -> Dict[str, Any]:
    folder_value = str(payload.get("path") or payload.get("folder_path") or "").strip()
    if not folder_value:
        raise ValueError("Job folder path is required")
    folder = Path(folder_value)
    if not folder.is_dir() or not server_module.is_allowed(folder):
        raise ValueError("Job folder not found or not allowed")

    job = read_or_create_job(folder)
    if "status" in payload:
        status = str(payload.get("status") or "")
        if status not in ALLOWED_STATUSES:
            raise ValueError(f"Invalid job status: {status}")
        job["status"] = status
    if "notes" in payload:
        job["notes"] = str(payload.get("notes") or "")

    # These fields are part of the Job contract and may be updated by future UI.
    for field in ("clientName", "address"):
        if field in payload:
            job[field] = str(payload.get(field) or "")
    for field in ("estimatedTotal", "actualTotal"):
        if field in payload:
            job[field] = _number(payload.get(field))

    job["updated"] = _now()
    return write_job(folder, normalize_job(folder, job))


def install(server_module) -> None:
    """Install once into the imported PlanTakeoff ``server`` module."""
    if getattr(server_module, "_job_model_installed", False):
        return
    server_module._job_model_installed = True
    server_module.JOB_STATUSES = ALLOWED_STATUSES
    server_module.read_or_create_job = read_or_create_job
    server_module.update_job = lambda payload: update_job(server_module, payload)

    original_scan_project = server_module.scan_project

    def scan_project_with_job(folder: Path):
        result = original_scan_project(folder)
        try:
            result["job"] = read_or_create_job(folder)
        except Exception as exc:  # Never let additive metadata break folder scanning.
            result["job"] = default_job(folder)
            result["job_error"] = str(exc)
        return result

    server_module.scan_project = scan_project_with_job

    original_create_project_folder = server_module.create_project_folder

    def create_project_folder_with_job(*args, **kwargs):
        result = original_create_project_folder(*args, **kwargs)
        folder = Path(result["folder_path"])
        result["job"] = read_or_create_job(folder, default_status="Lead")
        return result

    server_module.create_project_folder = create_project_folder_with_job

    original_post = server_module.Handler.do_POST

    def do_post_with_job(self):
        if urlparse(self.path).path != "/api/job/update":
            return original_post(self)
        try:
            body = self._read_json()
            job = update_job(server_module, body)
            return self._send_json({"ok": True, "job": job})
        except ValueError as exc:
            return self._send_json({"ok": False, "error": str(exc)}, 400)
        except Exception as exc:
            return self._send_json({"ok": False, "error": str(exc)}, 500)

    server_module.Handler.do_POST = do_post_with_job
