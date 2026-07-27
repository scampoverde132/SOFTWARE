#!/usr/bin/env python3
"""Additive disk-backed Job, baseline, and change-order services for PlanTakeoff.

Installed into the existing ``server`` module by ``desktop_app.py``. The patch
wraps scan/create behavior and adds disk-backed job/finalize/change-order
endpoints without changing existing folder, PDF, takeoff, or AI endpoints.
"""
from __future__ import annotations

import copy
import json
import os
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List
from urllib.parse import urlparse

JOB_FILE = "job.json"
SNAPSHOT_FILE = "takeoff-snapshot.json"
CHANGE_ORDERS_FILE = "change-orders.json"
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
CHANGE_ORDER_STATUSES = ("Pending", "Approved", "Rejected")


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
        "changeOrderTotal": 0.0,
        "pendingChangeOrderTotal": 0.0,
        "pendingChangeOrderCount": 0,
        "runningTotal": 0.0,
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
    job["changeOrderTotal"] = _number(source.get("changeOrderTotal"))
    job["pendingChangeOrderTotal"] = _number(source.get("pendingChangeOrderTotal"))
    try:
        job["pendingChangeOrderCount"] = max(0, int(source.get("pendingChangeOrderCount") or 0))
    except (TypeError, ValueError):
        job["pendingChangeOrderCount"] = 0
    job["runningTotal"] = _number(source.get("runningTotal"))
    return job


def _write_json_atomic(target: Path, data: Any) -> None:
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


def _co_item_id(order_id: str, index: int) -> str:
    return f"{order_id}-item-{index + 1}"


def _normalize_change_order_item(item: Any, order_id: str, index: int) -> Dict[str, Any]:
    source = item if isinstance(item, dict) else {}
    item_type = "linked" if source.get("type") == "linked" else "manual"
    item_id = str(source.get("id") or _co_item_id(order_id, index))
    quantity = _number(source.get("quantityDelta") if item_type == "linked" else source.get("qty"))
    unit_cost = _number(source.get("unitCost"))
    result: Dict[str, Any] = {
        "id": item_id,
        "type": item_type,
        "description": str(source.get("description") or ""),
        "unit": str(source.get("unit") or ""),
        "unitCost": unit_cost,
        "total": quantity * unit_cost,
    }
    generated = source.get("generatedTakeoffIds")
    result["generatedTakeoffIds"] = [
        str(value) for value in generated if value
    ] if isinstance(generated, list) else []
    generated_objects = source.get("generatedTakeoffObjects")
    result["generatedTakeoffObjects"] = [
        copy.deepcopy(value)
        for value in generated_objects
        if isinstance(value, dict)
    ] if isinstance(generated_objects, list) else []

    if item_type == "linked":
        result.update(
            {
                "linkedTakeoffId": str(source.get("linkedTakeoffId") or ""),
                "conditionId": str(source.get("conditionId") or ""),
                "pageId": str(source.get("pageId") or ""),
                "quantityDelta": quantity,
            }
        )
    else:
        result["qty"] = quantity
    return result


def _normalize_change_order(order: Any, index: int = 0) -> Dict[str, Any]:
    source = order if isinstance(order, dict) else {}
    order_id = str(source.get("id") or uuid.uuid4())
    status = source.get("status") if source.get("status") in CHANGE_ORDER_STATUSES else "Pending"
    items_raw = source.get("items") if isinstance(source.get("items"), list) else []
    items = [_normalize_change_order_item(item, order_id, i) for i, item in enumerate(items_raw)]
    created = str(source.get("created") or _now())
    result: Dict[str, Any] = {
        "id": order_id,
        "date": str(source.get("date") or datetime.now().date().isoformat()),
        "description": str(source.get("description") or f"Change Order {index + 1}"),
        "status": status,
        "items": items,
        "created": created,
        "updated": str(source.get("updated") or created),
        "totalImpact": sum(_number(item.get("total")) for item in items),
    }
    for field in ("approvedAt", "rejectedAt"):
        if source.get(field):
            result[field] = str(source.get(field))
    return result


def read_change_orders(folder: Path) -> List[Dict[str, Any]]:
    target = folder / CHANGE_ORDERS_FILE
    if not target.is_file():
        return []
    try:
        raw = json.loads(target.read_text(encoding="utf-8-sig"))
    except (OSError, json.JSONDecodeError):
        return []
    if isinstance(raw, dict):
        raw = raw.get("changeOrders")
    if not isinstance(raw, list):
        return []
    return [_normalize_change_order(order, i) for i, order in enumerate(raw)]


def write_change_orders(folder: Path, orders: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    normalized = [_normalize_change_order(order, i) for i, order in enumerate(orders)]
    _write_json_atomic(
        folder / CHANGE_ORDERS_FILE,
        {"version": 1, "updated": _now(), "changeOrders": normalized},
    )
    return normalized


def _change_order_summary(job: Dict[str, Any], orders: List[Dict[str, Any]]) -> Dict[str, Any]:
    approved_total = sum(
        _number(order.get("totalImpact"))
        for order in orders
        if order.get("status") == "Approved"
    )
    pending_orders = [order for order in orders if order.get("status") == "Pending"]
    pending_total = sum(_number(order.get("totalImpact")) for order in pending_orders)
    baseline_total = _baseline_total(job.get("baselineEstimate"))
    base_total = baseline_total if isinstance(job.get("baselineEstimate"), dict) else _number(job.get("estimatedTotal"))
    return {
        "changeOrderTotal": approved_total,
        "pendingChangeOrderTotal": pending_total,
        "pendingChangeOrderCount": len(pending_orders),
        "runningTotal": base_total + approved_total,
    }


def _apply_change_order_summary(job: Dict[str, Any], orders: List[Dict[str, Any]]) -> Dict[str, Any]:
    summary = _change_order_summary(job, orders)
    job.update(summary)
    if isinstance(job.get("actualBudget"), dict) and job.get("status") in (
        "Awarded",
        "In Progress",
        "Punch",
        "Complete",
    ):
        job["actualTotal"] = summary["runningTotal"]
    return summary


def _merge_change_orders(existing: List[Dict[str, Any]], incoming: List[Any]) -> List[Dict[str, Any]]:
    existing_by_id = {order["id"]: order for order in existing}
    merged: List[Dict[str, Any]] = []
    seen = set()

    for index, raw in enumerate(incoming):
        candidate = _normalize_change_order(raw, index)
        order_id = candidate["id"]
        previous = existing_by_id.get(order_id)
        seen.add(order_id)

        if previous and previous.get("status") in ("Approved", "Rejected"):
            # Final decisions are immutable. The disk record remains authoritative.
            merged.append(previous)
            continue

        if previous:
            next_status = candidate.get("status", "Pending")
            if next_status not in CHANGE_ORDER_STATUSES:
                next_status = "Pending"
            # Preserve the originally submitted scope/costs. Approval may only attach
            # generated plan object IDs and geometry to the corresponding linked item.
            previous_items = copy.deepcopy(previous.get("items") or [])
            incoming_items = {
                item.get("id"): item
                for item in candidate.get("items") or []
                if isinstance(item, dict)
            }
            for item in previous_items:
                incoming_item = incoming_items.get(item.get("id"))
                if incoming_item and isinstance(incoming_item.get("generatedTakeoffIds"), list):
                    item["generatedTakeoffIds"] = [
                        str(value)
                        for value in incoming_item.get("generatedTakeoffIds")
                        if value
                    ]
                if incoming_item and isinstance(incoming_item.get("generatedTakeoffObjects"), list):
                    item["generatedTakeoffObjects"] = [
                        copy.deepcopy(value)
                        for value in incoming_item.get("generatedTakeoffObjects")
                        if isinstance(value, dict)
                    ]
            candidate = {
                **previous,
                "status": next_status,
                "items": previous_items,
                "updated": _now(),
            }
            candidate["totalImpact"] = sum(_number(item.get("total")) for item in previous_items)
            if next_status == "Approved" and previous.get("status") != "Approved":
                candidate["approvedAt"] = _now()
            if next_status == "Rejected" and previous.get("status") != "Rejected":
                candidate["rejectedAt"] = _now()
            merged.append(_normalize_change_order(candidate, index))
            continue

        if candidate.get("status") != "Pending":
            raise ValueError("New change orders must start as Pending")
        if not candidate.get("description").strip():
            raise ValueError("Change order description is required")
        if not candidate.get("items"):
            raise ValueError("Change order requires at least one item")
        merged.append(candidate)

    # Finalized records cannot disappear from a replacement payload.
    for previous in existing:
        if previous["id"] not in seen and previous.get("status") in ("Approved", "Rejected"):
            merged.append(previous)
    return merged


def save_change_orders(server_module, payload: Dict[str, Any]) -> Dict[str, Any]:
    folder = _validated_folder(server_module, payload)
    incoming = payload.get("changeOrders")
    if not isinstance(incoming, list):
        raise ValueError("changeOrders must be an array")
    existing = read_change_orders(folder)
    orders = _merge_change_orders(existing, incoming)
    orders = write_change_orders(folder, orders)

    job = read_or_create_job(folder)
    summary = _apply_change_order_summary(job, orders)
    job["updated"] = _now()
    job = write_job(folder, normalize_job(folder, job))
    return {"changeOrders": orders, "job": job, "summary": summary}


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

    orders = read_change_orders(folder)
    summary = _apply_change_order_summary(job, orders)

    # Awarding a finalized bid establishes the production budget from its locked baseline.
    if job.get("status") == "Awarded" and previous_status != "Awarded":
        baseline = job.get("baselineEstimate")
        if isinstance(baseline, dict):
            job["actualBudget"] = copy.deepcopy(baseline)
            job["actualTotal"] = summary["runningTotal"]
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
    _apply_change_order_summary(job, read_change_orders(folder))
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
    server_module.CHANGE_ORDER_STATUSES = CHANGE_ORDER_STATUSES
    server_module.read_or_create_job = read_or_create_job
    server_module.read_change_orders = read_change_orders
    server_module.update_job = lambda payload: update_job(server_module, payload)
    server_module.finalize_job = lambda payload: finalize_job(server_module, payload)
    server_module.save_change_orders = lambda payload: save_change_orders(server_module, payload)

    original_scan_project = server_module.scan_project

    def scan_project_with_job(folder: Path):
        result = original_scan_project(folder)
        try:
            job = read_or_create_job(folder)
            orders = read_change_orders(folder)
            before = {
                key: job.get(key)
                for key in (
                    "changeOrderTotal",
                    "pendingChangeOrderTotal",
                    "pendingChangeOrderCount",
                    "runningTotal",
                    "actualTotal",
                )
            }
            summary = _apply_change_order_summary(job, orders)
            after = {key: job.get(key) for key in before}
            if before != after:
                job["updated"] = _now()
                write_job(folder, normalize_job(folder, job))
            result["job"] = job
            result["change_orders"] = orders
            result["change_order_summary"] = summary
        except Exception as exc:  # Never let additive metadata break folder scanning.
            result["job"] = default_job(folder)
            result["change_orders"] = []
            result["change_order_summary"] = _change_order_summary(result["job"], [])
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
        if api_path not in (
            "/api/job/update",
            "/api/job/finalize",
            "/api/change-orders/save",
        ):
            return original_post(self)
        try:
            body = self._read_json()
            if api_path == "/api/job/finalize":
                result = finalize_job(server_module, body)
                return self._send_json({"ok": True, **result})
            if api_path == "/api/change-orders/save":
                result = save_change_orders(server_module, body)
                return self._send_json({"ok": True, **result})
            job = update_job(server_module, body)
            return self._send_json({"ok": True, "job": job})
        except ValueError as exc:
            return self._send_json({"ok": False, "error": str(exc)}, 400)
        except Exception as exc:
            return self._send_json({"ok": False, "error": str(exc)}, 500)

    server_module.Handler.do_POST = do_post_with_job
