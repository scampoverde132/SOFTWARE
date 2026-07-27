#!/usr/bin/env python3
"""Release-hardening services for the PlanTakeoff offline-first desktop suite.

Installed last, after job_server, daily_log_server, and client_update_server.
Provides persistent suite settings, compact takeoff working snapshots, timestamped
job backups, status-change backups, and API-level exception boundaries while
preserving every existing handler through delegation.
"""
from __future__ import annotations

import copy
import json
import os
import re
import shutil
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List
from urllib.parse import urlparse

import client_update_server
import job_server

SETTINGS_VERSION = 1
SETTINGS_FILE = "settings.json"
WORKING_TAKEOFF_FILE = "takeoff-working.json"
BACKUPS_DIR = "backups"
MAX_LOGO_BYTES = 2 * 1024 * 1024
MAX_TAKEOFF_BYTES = 25 * 1024 * 1024
RATE_KEYS = ("walls", "ceilings", "doors", "base", "trim", "exterior")

DEFAULT_RATES: Dict[str, Dict[str, float]] = {
    "walls": {"material": 45.0, "labor": 0.85, "coverageRate": 350.0},
    "ceilings": {"material": 40.0, "labor": 0.70, "coverageRate": 300.0},
    "doors": {"material": 18.0, "labor": 85.0, "coverageRate": 350.0},
    "base": {"material": 45.0, "labor": 1.10, "coverageRate": 350.0},
    "trim": {"material": 45.0, "labor": 1.40, "coverageRate": 350.0},
    "exterior": {"material": 48.0, "labor": 1.10, "coverageRate": 350.0},
}

_STARTUP_BIDS_ROOT: Path | None = None


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _number(value: Any, fallback: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return fallback


def _safe_segment(value: Any) -> str:
    text = re.sub(r"[^A-Za-z0-9._-]+", "-", str(value or "backup").strip())
    return text.strip("-._")[:64] or "backup"


def settings_dir() -> Path:
    local = os.environ.get("LOCALAPPDATA", "").strip()
    if local:
        root = Path(local) / "PlanTakeoff"
    else:
        root = Path.home() / ".plantakeoff"
    root.mkdir(parents=True, exist_ok=True)
    return root


def settings_path() -> Path:
    return settings_dir() / SETTINGS_FILE


def default_settings() -> Dict[str, Any]:
    return {
        "version": SETTINGS_VERSION,
        "bidsRoot": str(_STARTUP_BIDS_ROOT or ""),
        "companyName": "WL Painting Inc.",
        "companyLogo": "",
        "defaultWastePct": 10.0,
        "rates": copy.deepcopy(DEFAULT_RATES),
    }


def normalize_settings(data: Any) -> Dict[str, Any]:
    base = default_settings()
    source = data if isinstance(data, dict) else {}
    result = {
        "version": SETTINGS_VERSION,
        "bidsRoot": str(source.get("bidsRoot") or base["bidsRoot"]).strip(),
        "companyName": str(source.get("companyName") or base["companyName"]).strip() or base["companyName"],
        "companyLogo": str(source.get("companyLogo") or "").strip(),
        "defaultWastePct": max(0.0, min(100.0, _number(source.get("defaultWastePct"), 10.0))),
        "rates": {},
    }
    source_rates = source.get("rates") if isinstance(source.get("rates"), dict) else {}
    for key in RATE_KEYS:
        defaults = DEFAULT_RATES[key]
        incoming = source_rates.get(key) if isinstance(source_rates.get(key), dict) else {}
        result["rates"][key] = {
            "material": max(0.0, _number(incoming.get("material"), defaults["material"])),
            "labor": max(0.0, _number(incoming.get("labor"), defaults["labor"])),
            "coverageRate": max(1.0, _number(incoming.get("coverageRate"), defaults["coverageRate"])),
        }
    return result


def read_settings() -> Dict[str, Any]:
    target = settings_path()
    raw: Any = None
    if target.is_file():
        try:
            raw = json.loads(target.read_text(encoding="utf-8-sig"))
        except (OSError, json.JSONDecodeError):
            raw = None
    settings = normalize_settings(raw)
    if raw != settings:
        write_settings(settings)
    return settings


def _write_json_atomic(target: Path, data: Any) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    temp = target.parent / f".{target.name}.{os.getpid()}.tmp"
    temp.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    temp.replace(target)


def write_settings(settings: Dict[str, Any]) -> Dict[str, Any]:
    normalized = normalize_settings(settings)
    _write_json_atomic(settings_path(), normalized)
    return normalized


def configured_bids_root() -> Path:
    settings = read_settings()
    configured = str(settings.get("bidsRoot") or "").strip()
    return Path(configured) if configured else Path(_STARTUP_BIDS_ROOT or Path.home())


def save_settings(payload: Dict[str, Any]) -> Dict[str, Any]:
    current = read_settings()
    incoming = payload.get("settings") if isinstance(payload.get("settings"), dict) else payload
    merged = {**current, **{k: incoming[k] for k in incoming if k in current}}
    if isinstance(incoming.get("rates"), dict):
        merged["rates"] = incoming["rates"]
    normalized = normalize_settings(merged)

    root_text = str(normalized.get("bidsRoot") or "").strip()
    if root_text:
        expanded = Path(os.path.expandvars(os.path.expanduser(root_text)))
        if not expanded.is_dir():
            raise ValueError(f"Bids root folder does not exist: {expanded}")
        normalized["bidsRoot"] = str(expanded.resolve())

    logo = str(normalized.get("companyLogo") or "")
    if logo:
        if not logo.startswith(("data:image/png", "data:image/jpeg", "data:image/webp")):
            raise ValueError("Company logo must be a PNG, JPEG, or WebP image")
        if len(logo.encode("utf-8")) > MAX_LOGO_BYTES:
            raise ValueError("Company logo is too large; choose a smaller image")

    saved = write_settings(normalized)
    return {
        "settings": saved,
        "settingsFile": str(settings_path()),
        "bidsRoot": str(configured_bids_root()),
    }


def _validated_takeoff_data(value: Any) -> Dict[str, Any] | None:
    if not isinstance(value, dict):
        return None
    encoded = json.dumps(value, ensure_ascii=False).encode("utf-8")
    if len(encoded) > MAX_TAKEOFF_BYTES:
        raise ValueError("Takeoff working data is too large to save safely")
    return copy.deepcopy(value)


def touch_job(server_module, payload: Dict[str, Any]) -> Dict[str, Any]:
    folder = job_server._validated_folder(server_module, payload)
    takeoff_data = _validated_takeoff_data(payload.get("takeoffData"))
    touched_at = _now()
    touch_timestamp = payload.get("touchTimestamp", True) is not False
    working_path = folder / WORKING_TAKEOFF_FILE
    if takeoff_data is not None:
        _write_json_atomic(
            working_path,
            {"version": 1, "savedAt": touched_at, "project": takeoff_data},
        )

    job = job_server.read_or_create_job(folder)
    if touch_timestamp:
        job["updated"] = touched_at
        job["lastTakeoffEdit"] = touched_at
    if takeoff_data is not None:
        job["takeoffWorkingFile"] = str(working_path)
    job = job_server.write_job(folder, job_server.normalize_job(folder, job))
    return {"job": job, "workingTakeoff": str(working_path) if working_path.is_file() else ""}


def _copy_if_exists(source: Path, target: Path, copied: List[str]) -> None:
    if source.is_file():
        shutil.copy2(source, target / source.name)
        copied.append(source.name)


def create_backup(server_module, payload: Dict[str, Any], *, reason: str | None = None) -> Dict[str, Any]:
    folder = job_server._validated_folder(server_module, payload)
    takeoff_data = _validated_takeoff_data(payload.get("takeoffData"))
    backup_reason = _safe_segment(reason or payload.get("reason") or "manual")
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
    target = folder / BACKUPS_DIR / f"{stamp}_{backup_reason}"
    target.mkdir(parents=True, exist_ok=False)
    copied: List[str] = []

    _copy_if_exists(folder / job_server.JOB_FILE, target, copied)
    _copy_if_exists(folder / job_server.CHANGE_ORDERS_FILE, target, copied)
    _copy_if_exists(folder / "daily-logs.json", target, copied)

    if takeoff_data is not None:
        takeoff_target = target / WORKING_TAKEOFF_FILE
        _write_json_atomic(takeoff_target, {"version": 1, "savedAt": _now(), "project": takeoff_data})
        copied.append(WORKING_TAKEOFF_FILE)
    elif (folder / WORKING_TAKEOFF_FILE).is_file():
        _copy_if_exists(folder / WORKING_TAKEOFF_FILE, target, copied)
    else:
        _copy_if_exists(folder / job_server.SNAPSHOT_FILE, target, copied)

    # Preserve the finalized snapshot too when it is separate from the active working takeoff.
    if (folder / job_server.SNAPSHOT_FILE).is_file() and job_server.SNAPSHOT_FILE not in copied:
        _copy_if_exists(folder / job_server.SNAPSHOT_FILE, target, copied)

    manifest = {
        "version": 1,
        "createdAt": _now(),
        "reason": backup_reason,
        "jobFolder": str(folder),
        "files": copied,
        "missing": [
            name
            for name in (job_server.JOB_FILE, WORKING_TAKEOFF_FILE, job_server.CHANGE_ORDERS_FILE, "daily-logs.json")
            if name not in copied
        ],
    }
    _write_json_atomic(target / "backup-manifest.json", manifest)
    return {"backupFolder": str(target), "manifest": manifest}


def update_job_and_backup(server_module, payload: Dict[str, Any]) -> Dict[str, Any]:
    folder = job_server._validated_folder(server_module, payload)
    before = job_server.read_or_create_job(folder)
    previous_status = str(before.get("status") or "")
    job = client_update_server.update_job_with_client_tracking(server_module, payload)
    backup = None
    next_status = str(job.get("status") or "")
    if "status" in payload and previous_status != next_status:
        backup = create_backup(
            server_module,
            {"path": str(folder), "reason": f"status-{previous_status}-to-{next_status}"},
        )
    return {"job": job, "backup": backup}


def finalize_job_and_backup(server_module, payload: Dict[str, Any]) -> Dict[str, Any]:
    folder = job_server._validated_folder(server_module, payload)
    before = job_server.read_or_create_job(folder)
    previous_status = str(before.get("status") or "")
    result = job_server.finalize_job(server_module, payload)
    job = result.get("job") if isinstance(result, dict) else None
    next_status = str((job or {}).get("status") or "Bid Sent")
    backup = None
    if previous_status != next_status:
        backup = create_backup(
            server_module,
            {"path": str(folder), "reason": f"status-{previous_status}-to-{next_status}"},
        )
    return {**result, "backup": backup}


def _api_error(operation: str, exc: Exception) -> Dict[str, Any]:
    detail = str(exc).strip() or exc.__class__.__name__
    return {
        "ok": False,
        "error": f"PlanTakeoff could not complete {operation}.",
        "detail": detail[:1200],
    }


def install(server_module) -> None:
    """Install once as the final server compatibility and safety layer."""
    global _STARTUP_BIDS_ROOT
    if getattr(server_module, "_suite_server_installed", False):
        return
    server_module._suite_server_installed = True

    original_bids_root = server_module.bids_root
    _STARTUP_BIDS_ROOT = Path(original_bids_root())
    server_module.bids_root = configured_bids_root
    server_module.suite_settings = read_settings
    server_module.create_job_backup = lambda payload: create_backup(server_module, payload)
    server_module.touch_job = lambda payload: touch_job(server_module, payload)

    original_get = server_module.Handler.do_GET
    original_post = server_module.Handler.do_POST

    def do_get_with_suite_safety(self):
        api_path = urlparse(self.path).path
        try:
            if api_path == "/api/suite/settings":
                return self._send_json(
                    {
                        "ok": True,
                        "settings": read_settings(),
                        "settingsFile": str(settings_path()),
                        "bidsRoot": str(configured_bids_root()),
                    }
                )
            return original_get(self)
        except Exception as exc:
            if api_path.startswith("/api/"):
                return self._send_json(_api_error(f"GET {api_path}", exc), 500)
            raise

    def do_post_with_suite_safety(self):
        api_path = urlparse(self.path).path
        try:
            if api_path not in (
                "/api/suite/settings/save",
                "/api/job/touch",
                "/api/backup/create",
                "/api/job/update",
                "/api/job/finalize",
            ):
                return original_post(self)

            body = self._read_json()
            if api_path == "/api/suite/settings/save":
                return self._send_json({"ok": True, **save_settings(body)})
            if api_path == "/api/job/touch":
                return self._send_json({"ok": True, **touch_job(server_module, body)})
            if api_path == "/api/backup/create":
                return self._send_json({"ok": True, **create_backup(server_module, body)})
            if api_path == "/api/job/finalize":
                return self._send_json({"ok": True, **finalize_job_and_backup(server_module, body)})
            result = update_job_and_backup(server_module, body)
            return self._send_json({"ok": True, **result})
        except ValueError as exc:
            return self._send_json(_api_error(api_path or "the request", exc), 400)
        except Exception as exc:
            return self._send_json(_api_error(api_path or "the request", exc), 500)

    server_module.Handler.do_GET = do_get_with_suite_safety
    server_module.Handler.do_POST = do_post_with_suite_safety
