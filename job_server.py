#!/usr/bin/env python3
"""Additive disk-backed Job model for PlanTakeoff EST folders.

Installed into the existing ``server`` module by ``desktop_app.py``. The patch
wraps scan/create behavior and adds disk-backed job update/finalize endpoints
without changing existing folder, PDF, takeoff, or AI endpoints.
"""
from __future__ import annotations

import copy
import json
import os
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict
from urllib.parse import urlparse

JOB_FILE = "job.json"
SNAPSHOT_FILE = "takeoff-snapshot.json"
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


def _parse_folder_name(name: str):
    # Mirrors server.parse_folder_name but keeps this module independently testable.
    import re

    match = re.match(r"^(EST\d+)\s*[-–]\s*(.+)$", (name or "").strip(), re.I)
    if match:
        return match.group(1).upper(), match.group(2).strip()
    return name, name


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
        "baselineEstimate": None,
        "actualBudget": None,
        "baselineLocked": False,
    }


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
    job["baselineEstimate"] = source.get("baselineEstimate") if isinstance(source.get("baselineEstimate"), dict) else None
    job["actualBudget"] = source.get("actualBudget") if isinstance(source.get("actualBudget"), dict) else None
    job["baselineLocked"] = bool(source.get("baselineLocked", False))
    return job


def _write_json_atomic(target: Path, data: Dict[str, Any]) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    temp = target.parent / f".{target.name}.{os.getpid()}.tmp"
    payload = json.dumps(data, indent=2, ensure_ascii=False) + "\n"
    temp.write_text(payload, encoding="utf-8")
    temp.replace(target)


def write_job(folder: Path, job: Dict[str, Any]) -> Dict[str, Any]:
    folder.mkdir(parents=True, exist_ok=True)
    _write_json_atomic(folder / JOB_FILE, job)
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


def _validated_folder(server_module, payload: Dict[str, Any]) -> Path:
    folder_value = str(payload.get("path") or payload.get("folder_path") or "").strip()
    if not folder_value:
        raise ValueError("Job folder path is required")
    folder = Path(folder_value)
    if not folder.is_dir() or not server_module.is_allowed(folder):
        raise ValueError("Job folder not found or not allowed")
    return folder


def _baseline_total(baseline: Any) -> float:
    if not isinstance(baseline, dict):
        return 0.0
    totals = baseline.get("totals") if isinstance(baseline.get("totals"), dict) else {}
    return _number(totals.get("grand") or totals.get("total") or baseline.get("estimatedTotal"))


def update_job(server_module, payload: Dict[str, Any]) -> Dict[str, Any]:
    folder = _validated_folder(server_module, payload)
    job = read_or_create_job(folder)
    previous_status = job.get("status")

    if "status" in payload:
        status = str(payload.get("status") or "")
        if status not in ALLOWED_STATUSES:
            raise ValueError(f"Invalid job status: {status}")
        job["status"] = status
    if "notes" in payload:
        job["notes"] = str(payload.get("notes") or "")

    for field in ("clientName", "address"):
        if field in payload:
            job[field] = str(payload.get(field) or "")
    for field in ("estimatedTotal", "actualTotal"):
        if field in payload:
            job[field] = _number(payload.get(field))
    for field in ("baselineEstimate", "actualBudget"):
        if field in payload:
            value = payload.get(field)
            job[field] = copy.deepcopy(value) if isinstance(value, dict) else None

    # Awarding a finalized bid establishes the production budget from its locked baseline.
    if job.get("status") == "Awarded" and previous_status != "Awarded":
        baseline = job.get("baselineEstimate")
        if isinstance(baseline, dict):
            job["actualBudget"] = copy.deepcopy(baseline)
            job["actualTotal"] = _baseline_total(baseline)
            job["actualBudgetCreated"] = _now()

    if job.get("status") == "Estimating":
        job["baselineLocked"] = False
        job["reopenedForMeasuring"] = _now()
    elif isinstance(job.get("baselineEstimate"), dict):
        job["baselineLocked"] = True

    job["updated"] = _now()
    return write_job(folder, normalize_job(folder, job))


def finalize_job(server_module, payload: Dict[str, Any]) -> Dict[str, Any]:
    folder = _validated_folder(server_module, payload)
    baseline = payload.get("baselineEstimate")
    snapshot = payload.get("takeoffSnapshot")
    if not isinstance(baseline, dict):
        raise ValueError("baselineEstimate is required")
    if not isinstance(snapshot, dict):
        raise ValueError("takeoffSnapshot is required")

    finalized_at = _now()
    baseline = copy.deepcopy(baseline)
    baseline["finalizedAt"] = finalized_at
    snapshot = copy.deepcopy(snapshot)
    snapshot["createdAt"] = finalized_at
    snapshot["baselineEstimate"] = baseline

    job = read_or_create_job(folder)
    job["baselineEstimate"] = baseline
    job["estimatedTotal"] = _baseline_total(baseline)
    job["status"] = "Bid Sent"
    job["baselineLocked"] = True
    job["baselineFinalizedAt"] = finalized_at
    job["updated"] = finalized_at
    job = write_job(folder, normalize_job(folder, job))

    # Stable current snapshot plus a timestamped archive for audit/history.
    current_target = folder / SNAPSHOT_FILE
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    archive_target = folder / f"takeoff-snapshot-{stamp}.json"
    _write_json_atomic(current_target, snapshot)
    _write_json_atomic(archive_target, snapshot)

    return {
        "job": job,
        "snapshot": str(current_target),
        "archiveSnapshot": str(archive_target),
        "finalizedAt": finalized_at,
    }


def install(server_module) -> None:
    """Install once into the imported PlanTakeoff ``server`` module."""
    if getattr(server_module, "_job_model_installed", False):
        return
    server_module._job_model_installed = True
    server_module.JOB_STATUSES = ALLOWED_STATUSES
    server_module.read_or_create_job = read_or_create_job
    server_module.update_job = lambda payload: update_job(server_module, payload)
    server_module.finalize_job = lambda payload: finalize_job(server_module, payload)

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
        api_path = urlparse(self.path).path
        if api_path not in ("/api/job/update", "/api/job/finalize"):
            return original_post(self)
        try:
            body = self._read_json()
            if api_path == "/api/job/finalize":
                result = finalize_job(server_module, body)
                return self._send_json({"ok": True, **result})
            job = update_job(server_module, body)
            return self._send_json({"ok": True, "job": job})
        except ValueError as exc:
            return self._send_json({"ok": False, "error": str(exc)}, 400)
        except Exception as exc:
            return self._send_json({"ok": False, "error": str(exc)}, 500)

    server_module.Handler.do_POST = do_post_with_job
