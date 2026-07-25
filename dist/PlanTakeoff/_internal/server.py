#!/usr/bin/env python3
"""
PlanTakeoff local server — serves the UI and provides filesystem APIs
for WL Painting Estimates folders (scan jobs + create project folders).
"""
from __future__ import annotations

import json
import mimetypes
import os
import re
import sys
import threading
import urllib.error
import urllib.request
import webbrowser
from datetime import datetime
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import parse_qs, unquote, urlparse

def _default_app_dir() -> Path:
    if getattr(sys, "frozen", False):
        meipass = getattr(sys, "_MEIPASS", None)
        if meipass and (Path(meipass) / "index.html").exists():
            return Path(meipass)
        base = Path(sys.executable).resolve().parent
        internal = base / "_internal"
        if (internal / "index.html").exists():
            return internal
        return base
    return Path(__file__).resolve().parent


APP_DIR = _default_app_dir()
DEFAULT_BIDS_ROOT = Path(r"C:\Users\samuc\OneDrive\Desktop\Samuel Bids")
PORT = 8765

SUBFOLDERS = ("01 Drawings", "02 Estimates", "03 Pictures", "04 Notes")
DRAWING_EXTS = {".pdf", ".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp"}
ESTIMATE_EXTS = {".pdf", ".docx", ".xlsx", ".xls", ".doc"}

FOLDER_NAME_RE = re.compile(r"^(EST\d+)\s*[-–]\s*(.+)$", re.I)
EST_CODE_RE = re.compile(r"^EST(\d{2})(\d{2})(\d{3,})$", re.I)

# Sheet numbers: A101, A-101, A1.01, S002, M-201, E101, G001, FP-01, 000–999
SHEET_NUM_RE = re.compile(
    r"(?i)(?:^|[\s_\-])("
    r"(?:[A-Z]{1,3}[\s\-]?)?\d{1,3}(?:\.\d{1,2})?"  # A101, A-1.01, 002
    r"|(?:[A-Z]{1,3})-\d{1,3}(?:\.\d{1,2})?"  # A-101
    r"|FP[\s\-]?\d{1,3}"
    r"|SHT[\s\-]?\d{1,3}"
    r")(?:$|[\s_\-\.])"
)
# Prefer leading sheet tokens like "A101 TITLE" or "000 COVER"
SHEET_LEAD_RE = re.compile(
    r"(?i)^(?P<sheet>"
    r"[A-Z]{1,3}[\s\-]?\d{1,3}(?:\.\d{1,2})?"
    r"|\d{2,4}"
    r"|FP[\s\-]?\d{1,3}"
    r")\b[\s_\-]*(?P<title>.*)$"
)

# Documents that are usually NOT floor plans for takeoff
DOC_NEG = re.compile(
    r"(?i)\b("
    r"addendum|addenda|rules?\s*&?\s*regs?|regulation|specification|spec\b|"
    r"narrative|scope\s+of\s+work|proposal|contract|insurance|coi\b|"
    r"general\s+notes?|project\s+info|meeting|minutes|rfi\b|bid\s+form|"
    r"vendor|hours?\s+of\s+operation|parking|property\s+manager|"
    r"requirements?|ansi|ada\b|occupancy\s+load|"
    r"cover\s+sheet|drawing\s+index|title\s+block|transmittal|"
    r"schedule\s+only|spec\s+book|project\s+manual"
    r")\b"
)
# Strong plan / sheet signals
PLAN_POS = re.compile(
    r"(?i)\b("
    r"floor\s*plan|demo\s*plan|finish\s*plan|new\s+work|shell|"
    r"reflected\s+ceiling|rcp\b|power\s+plan|lighting|"
    r"fixture\s+plan|furniture|life\s*safety|egress|"
    r"elevation|section|detail|site\s*plan|plan\b|"
    r"architectural|dimension|enlarged|tenant|suite|"
    r"existing|proposed|permit\s+set|construction\s+document|"
    r"\bA\d{2,3}\b|\bS\d{2,3}\b|\bM\d{2,3}\b|\bE\d{2,3}\b|\bP\d{2,3}\b"
    r")\b"
)


def _clean_title(s: str) -> str:
    s = re.sub(r"[_\-]+", " ", s or "")
    s = re.sub(r"\s+", " ", s).strip(" ._-")
    s = re.sub(r"(?i)\s*drawing\s*title\s*$", "", s).strip()
    return s[:80]


def parse_sheet_from_filename(filename: str) -> Dict[str, Any]:
    """
    Extract sheet number + short title from a drawing file name.
    Examples:
      'A101 EXISTING SHELL _ NEW WORK PLANS.pdf' → A101 / EXISTING SHELL NEW WORK PLANS
      '000 COVER SHEET _ PROJECT TEAM.pdf' → 000 / COVER SHEET PROJECT TEAM
      '002 EGRESS _ OCCUPANCY PLAN.pdf' → 002 / EGRESS OCCUPANCY PLAN
    """
    stem = Path(filename).stem
    stem = stem.replace("—", "-").replace("–", "-")
    sheet = ""
    title = stem

    m = SHEET_LEAD_RE.match(stem.strip())
    if m:
        sheet = re.sub(r"\s+", "", m.group("sheet").upper().replace("_", "-"))
        # normalize A 101 → A101, A-101 stays
        sheet = re.sub(r"^([A-Z]+)[\s\-]?(\d)", r"\1\2", sheet)
        title = _clean_title(m.group("title") or "")
    else:
        m2 = SHEET_NUM_RE.search(stem)
        if m2:
            raw = m2.group(1)
            sheet = re.sub(r"\s+", "", raw.upper().replace("_", "-"))
            sheet = re.sub(r"^([A-Z]+)[\s\-]?(\d)", r"\1\2", sheet)
            title = _clean_title(stem.replace(m2.group(0), " "))

    if not title:
        title = _clean_title(stem)

    # Display name: "A101 — New Work Plans" or fallback cleaned stem
    if sheet:
        label = f"{sheet} — {title}" if title and title.upper() != sheet else sheet
    else:
        label = title or stem

    return {
        "sheet_id": sheet,
        "sheet_title": title,
        "page_label": label[:100],
    }


def classify_drawing(name: str, size: int = 0) -> Dict[str, Any]:
    """Score file as floor-plan-like vs document; attach sheet metadata."""
    meta = parse_sheet_from_filename(name)
    name_l = name.lower()
    score = 0
    role = "drawing"

    if DOC_NEG.search(name):
        score -= 40
        role = "document"
    if PLAN_POS.search(name):
        score += 35
        if role == "document" and re.search(r"(?i)\bplan\b", name):
            score += 15  # e.g. EGRESS PLAN still useful
            role = "plan"
        elif role != "document":
            role = "plan"

    # Sheet number strongly suggests a CD sheet
    if meta["sheet_id"]:
        score += 25
        # A/S/M/E/P discipline letters → plan sheets
        if re.match(r"^[ASMEPGLCDI]\d", meta["sheet_id"], re.I):
            score += 20
            role = "plan"
        # Pure numbers 000–010 often cover/index/notes
        if re.match(r"^\d{2,4}$", meta["sheet_id"]):
            num = int(meta["sheet_id"])
            if num <= 10:
                score -= 10
                if role == "drawing":
                    role = "front-matter"
            else:
                score += 5

    if re.search(r"(?i)cover|index|title\s*sheet|general\s+notes?", name):
        score -= 25
        role = "front-matter"
    if re.search(r"(?i)addendum|rules|regs|spec\b", name):
        score -= 50
        role = "document"

    # Larger files tend to be real plan sheets (weak signal)
    if size >= 2_000_000:
        score += 8
    elif size >= 500_000:
        score += 3
    elif 0 < size < 80_000:
        score -= 8

    # Raster images in drawings folder are usually plans/photos of plans
    ext = Path(name).suffix.lower()
    if ext in {".tif", ".tiff", ".png", ".jpg", ".jpeg"}:
        score += 10
        if role == "drawing":
            role = "plan"

    return {
        **meta,
        "role": role,
        "plan_score": score,
        "is_plan_likely": score >= 10 and role in ("plan", "drawing"),
    }


def enrich_drawing_entry(entry: Dict[str, Any]) -> Dict[str, Any]:
    info = classify_drawing(entry.get("name") or "", int(entry.get("size") or 0))
    entry = {**entry, **info}
    return entry


def sort_drawings_for_takeoff(files: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Plans first (by sheet id), then other drawings, documents last."""
    enriched = [enrich_drawing_entry(dict(f)) for f in files]

    def sort_key(f: Dict[str, Any]):
        score = -int(f.get("plan_score") or 0)
        sheet = f.get("sheet_id") or "zzz"
        # Natural sheet order: A101 before A102, 001 before 010
        return (score, sheet, (f.get("name") or "").lower())

    enriched.sort(key=sort_key)
    return enriched


def bids_root() -> Path:
    env = os.environ.get("PLANTAKEOFF_BIDS_ROOT", "").strip()
    if env:
        return Path(env)
    return DEFAULT_BIDS_ROOT


def allowed_roots() -> List[Path]:
    roots = [bids_root().resolve(), APP_DIR.resolve()]
    # also allow year folders explicitly
    br = bids_root()
    if br.is_dir():
        for p in br.iterdir():
            if p.is_dir() and p.name.lower().startswith("estimates"):
                roots.append(p.resolve())
    return roots


def is_allowed(path: Path) -> bool:
    try:
        resolved = path.resolve()
    except Exception:
        return False
    for root in allowed_roots():
        try:
            resolved.relative_to(root)
            return True
        except ValueError:
            continue
    return False


def parse_folder_name(name: str) -> Tuple[str, str]:
    m = FOLDER_NAME_RE.match(name.strip())
    if m:
        return m.group(1).upper(), m.group(2).strip()
    return name, name


def estimates_dirs(root: Optional[Path] = None) -> List[Path]:
    root = root or bids_root()
    found = []
    if not root.is_dir():
        return found
    for p in sorted(root.iterdir()):
        if p.is_dir() and p.name.lower().startswith("estimates"):
            found.append(p)
    return found


def list_year_month_folders(est_dir: Path) -> List[Path]:
    """Return either EST* project folders or month subfolders then projects."""
    projects = []
    for entry in sorted(est_dir.iterdir()):
        if not entry.is_dir():
            continue
        if entry.name.upper().startswith("EST"):
            projects.append(entry)
        elif entry.name.isdigit() and len(entry.name) <= 2:
            # month folder
            for sub in sorted(entry.iterdir()):
                if sub.is_dir() and sub.name.upper().startswith("EST"):
                    projects.append(sub)
    return projects


def count_files(folder: Path, exts: set) -> int:
    n = 0
    try:
        for p in folder.rglob("*"):
            if p.is_file() and p.suffix.lower() in exts:
                n += 1
    except Exception:
        pass
    return n


def list_files(folder: Path, exts: set, limit: int = 50, *, for_takeoff: bool = False) -> List[Dict[str, Any]]:
    files = []
    try:
        for p in folder.rglob("*"):
            if not p.is_file():
                continue
            if p.suffix.lower() not in exts:
                continue
            try:
                st = p.stat()
                files.append(
                    {
                        "name": p.name,
                        "path": str(p),
                        "rel": str(p.relative_to(folder)),
                        "size": st.st_size,
                        "modified": datetime.fromtimestamp(st.st_mtime).isoformat(timespec="seconds"),
                        "ext": p.suffix.lower(),
                    }
                )
            except Exception:
                continue
    except Exception:
        return []
    if for_takeoff:
        return sort_drawings_for_takeoff(files)[:limit]
    files.sort(key=lambda x: x["name"].lower())
    return files[:limit]


def scan_project(folder: Path) -> Dict[str, Any]:
    bid_ref, project_name = parse_folder_name(folder.name)
    drawings_dir = folder / "01 Drawings"
    estimates_dir = folder / "02 Estimates"
    pictures_dir = folder / "03 Pictures"
    notes_dir = folder / "04 Notes"
    takeoff_dir = estimates_dir / "Take off"
    if not takeoff_dir.is_dir():
        takeoff_dir = estimates_dir / "Takeoff"

    drawings = list_files(
        drawings_dir if drawings_dir.is_dir() else folder,
        DRAWING_EXTS,
        80,
        for_takeoff=True,
    )
    estimates = list_files(estimates_dir if estimates_dir.is_dir() else folder, ESTIMATE_EXTS, 40)
    # Prefer drawings from 01 Drawings; if empty, any pdf in folder not in 02 Estimates
    if not drawings:
        all_draw = []
        for p in folder.rglob("*"):
            if not p.is_file() or p.suffix.lower() not in DRAWING_EXTS:
                continue
            if "02 Estimates" in p.parts or "02 Estimate" in str(p):
                continue
            all_draw.append(
                {
                    "name": p.name,
                    "path": str(p),
                    "rel": str(p.relative_to(folder)),
                    "size": p.stat().st_size,
                    "modified": datetime.fromtimestamp(p.stat().st_mtime).isoformat(timespec="seconds"),
                    "ext": p.suffix.lower(),
                }
            )
        drawings = sort_drawings_for_takeoff(all_draw)[:80]

    # Split for clients that want plans first / skip junk docs on first paint
    plan_drawings = [d for d in drawings if d.get("is_plan_likely")]
    other_drawings = [d for d in drawings if not d.get("is_plan_likely")]

    try:
        mtime = datetime.fromtimestamp(folder.stat().st_mtime).isoformat(timespec="seconds")
    except Exception:
        mtime = ""

    return {
        "bid_ref": bid_ref,
        "project_name": project_name,
        "folder_name": folder.name,
        "folder_path": str(folder),
        "parent": str(folder.parent),
        "year_folder": folder.parent.name if not folder.parent.name.isdigit() else folder.parent.parent.name,
        "has_drawings_folder": drawings_dir.is_dir(),
        "has_estimates_folder": estimates_dir.is_dir(),
        "has_takeoff_folder": takeoff_dir.is_dir() if takeoff_dir else False,
        "drawings": drawings,
        "plan_drawings": plan_drawings,
        "other_drawings": other_drawings,
        "estimates": estimates,
        "drawing_count": len(drawings),
        "plan_count": len(plan_drawings),
        "estimate_count": len(estimates),
        "picture_count": count_files(pictures_dir, {".jpg", ".jpeg", ".png", ".tif", ".tiff", ".bmp"})
        if pictures_dir.is_dir()
        else 0,
        "modified": mtime,
        "subfolders": [p.name for p in folder.iterdir() if p.is_dir()] if folder.is_dir() else [],
    }


def scan_all(root: Optional[Path] = None, year: Optional[str] = None) -> Dict[str, Any]:
    root = root or bids_root()
    years = estimates_dirs(root)
    if year:
        years = [y for y in years if year in y.name]
    projects = []
    for ydir in years:
        for proj in list_year_month_folders(ydir):
            try:
                projects.append(scan_project(proj))
            except Exception as exc:
                projects.append(
                    {
                        "bid_ref": proj.name,
                        "project_name": proj.name,
                        "folder_path": str(proj),
                        "error": str(exc),
                        "drawings": [],
                        "estimates": [],
                        "drawing_count": 0,
                        "estimate_count": 0,
                    }
                )
    projects.sort(key=lambda p: p.get("bid_ref") or "", reverse=True)
    return {
        "root": str(root),
        "year_folders": [str(y) for y in years],
        "count": len(projects),
        "projects": projects,
    }


def suggest_next_code(year: int, month: Optional[int] = None) -> str:
    """Suggest next ESTYYMM### based on existing folders."""
    yy = year % 100
    mm = month or datetime.now().month
    prefix = f"EST{yy:02d}{mm:02d}"
    max_seq = 0
    for ydir in estimates_dirs():
        for proj in list_year_month_folders(ydir):
            ref, _ = parse_folder_name(proj.name)
            m = EST_CODE_RE.match(ref)
            if not m:
                continue
            if int(m.group(1)) != yy:
                continue
            if month and int(m.group(2)) != mm:
                continue
            if ref.upper().startswith(prefix):
                try:
                    max_seq = max(max_seq, int(m.group(3)))
                except ValueError:
                    pass
    return f"{prefix}{max_seq + 1:03d}"


def create_project_folder(
    year: int,
    code: str,
    description: str,
    month: Optional[str] = None,
    takeoff: bool = True,
    base_override: Optional[str] = None,
) -> Dict[str, Any]:
    code = code.strip().upper().replace(" ", "")
    description = description.strip()
    if not code:
        raise ValueError("Project code required")
    if not description:
        raise ValueError("Description required")

    if base_override:
        base = Path(base_override)
    else:
        base = bids_root() / f"Estimates {year}"
        if month:
            month = str(month).zfill(2)
            base = base / month

    if not is_allowed(base) and not str(base).startswith(str(bids_root())):
        # allow creating under bids root even if folder doesn't exist yet
        if bids_root() not in base.parents and base != bids_root():
            try:
                base.resolve().relative_to(bids_root().resolve())
            except Exception:
                if not str(base).lower().startswith(str(bids_root()).lower()):
                    raise ValueError(f"Base path not allowed: {base}")

    base.mkdir(parents=True, exist_ok=True)
    folder_name = f"{code} - {description}"
    project = base / folder_name
    created = not project.exists()
    project.mkdir(parents=True, exist_ok=True)
    for sub in SUBFOLDERS:
        (project / sub).mkdir(exist_ok=True)
    if takeoff:
        (project / "02 Estimates" / "Take off").mkdir(parents=True, exist_ok=True)

    return {
        "ok": True,
        "created": created,
        "folder_path": str(project),
        "folder_name": folder_name,
        "bid_ref": code,
        "project_name": description,
        "subfolders": SUBFOLDERS + (("02 Estimates/Take off",) if takeoff else ()),
    }


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        # Always use current module APP_DIR (desktop shell may reassign it)
        kwargs["directory"] = str(APP_DIR)
        super().__init__(*args, **kwargs)

    def log_message(self, fmt, *args):
        # Windowed PyInstaller builds set sys.stderr to None — never crash on log.
        try:
            stream = sys.stderr or sys.stdout
            if stream is not None:
                stream.write("[PlanTakeoff] " + (fmt % args) + "\n")
        except Exception:
            pass

    def _send_json(self, data: Any, status: int = 200):
        body = json.dumps(data, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self) -> Dict:
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            return json.loads(raw.decode("utf-8") or "{}")
        except Exception:
            return {}

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        qs = parse_qs(parsed.query)

        if path == "/api/health":
            return self._send_json({"ok": True, "app": "PlanTakeoff"})

        if path == "/api/config":
            root = bids_root()
            years = [y.name for y in estimates_dirs(root)]
            return self._send_json(
                {
                    "bids_root": str(root),
                    "year_folders": years,
                    "subfolders": list(SUBFOLDERS),
                    "default_year": datetime.now().year,
                    "default_month": f"{datetime.now().month:02d}",
                    "suggest_code": suggest_next_code(datetime.now().year, datetime.now().month),
                    "ai": ai_status(),
                }
            )

        if path == "/api/scan":
            year = (qs.get("year") or [None])[0]
            root_q = (qs.get("root") or [None])[0]
            root = Path(root_q) if root_q else bids_root()
            if not is_allowed(root) and root != bids_root():
                # allow if under bids root once created
                if not str(root).lower().startswith(str(bids_root()).lower()):
                    return self._send_json({"error": "Path not allowed"}, 403)
            return self._send_json(scan_all(root, year))

        if path == "/api/project":
            folder = (qs.get("path") or [""])[0]
            folder = unquote(folder)
            p = Path(folder)
            if not p.is_dir() or not is_allowed(p):
                return self._send_json({"error": "Folder not found or not allowed"}, 404)
            return self._send_json(scan_project(p))

        if path == "/api/suggest-code":
            year = int((qs.get("year") or [datetime.now().year])[0])
            month = (qs.get("month") or [None])[0]
            month_i = int(month) if month else None
            return self._send_json({"code": suggest_next_code(year, month_i)})

        if path == "/api/file":
            fpath = unquote((qs.get("path") or [""])[0])
            p = Path(fpath)
            if not p.is_file() or not is_allowed(p):
                self.send_error(404, "File not found")
                return
            ctype = mimetypes.guess_type(str(p))[0] or "application/octet-stream"
            data = p.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Content-Disposition", f'inline; filename="{p.name}"')
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(data)
            return

        if path == "/api/open-folder":
            folder = unquote((qs.get("path") or [""])[0])
            p = Path(folder)
            if p.is_dir() and is_allowed(p):
                os.startfile(str(p))  # noqa: S606
                return self._send_json({"ok": True})
            return self._send_json({"error": "Not found"}, 404)

        return super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path
        body = self._read_json()

        if path == "/api/create-project":
            try:
                result = create_project_folder(
                    year=int(body.get("year") or datetime.now().year),
                    code=str(body.get("code") or ""),
                    description=str(body.get("description") or ""),
                    month=body.get("month") or None,
                    takeoff=bool(body.get("takeoff", True)),
                    base_override=body.get("base") or None,
                )
                return self._send_json(result)
            except Exception as exc:
                return self._send_json({"ok": False, "error": str(exc)}, 400)

        if path == "/api/create-batch":
            year = int(body.get("year") or datetime.now().year)
            month = body.get("month") or None
            takeoff = bool(body.get("takeoff", True))
            base = body.get("base") or None
            projects = body.get("projects") or []
            results = []
            for item in projects:
                try:
                    results.append(
                        create_project_folder(
                            year=year,
                            code=str(item.get("code") or ""),
                            description=str(item.get("description") or item.get("desc") or ""),
                            month=month,
                            takeoff=takeoff,
                            base_override=base,
                        )
                    )
                except Exception as exc:
                    results.append({"ok": False, "error": str(exc), "code": item.get("code")})
            return self._send_json({"ok": True, "results": results})

        if path == "/api/ai/scope":
            try:
                return self._send_json(run_scope_ai(body))
            except Exception as exc:
                return self._send_json({"ok": False, "error": str(exc)}, 400)

        if path == "/api/ai/plansweep":
            try:
                return self._send_json(run_plansweep_ai(body))
            except Exception as exc:
                return self._send_json({"ok": False, "error": str(exc)}, 400)

        return self._send_json({"error": "Not found"}, 404)


def _find_grok_exe() -> Optional[Path]:
    home = Path.home()
    for p in (
        home / ".grok" / "bin" / "grok.exe",
        Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "Grok" / "grok.exe",
    ):
        if p.is_file():
            return p
    return None


def _ps_extension_path() -> Path:
    return APP_DIR / "extensions" / "Invoke-PlanTakeoffAI.ps1"


def ai_status() -> Dict[str, Any]:
    """Prefer PowerShell + Grok CLI extension; fall back to XAI_API_KEY."""
    grok = _find_grok_exe()
    ext = _ps_extension_path()
    key = (os.environ.get("XAI_API_KEY") or "").strip()
    if grok and ext.is_file():
        return {
            "configured": True,
            "provider": "Grok CLI via PowerShell extension",
            "base_url": "local:extensions/Invoke-PlanTakeoffAI.ps1",
            "model": os.environ.get("XAI_MODEL") or os.environ.get("GROK_MODEL") or "grok (CLI default)",
            "grok_path": str(grok),
            "extension": str(ext),
            "hint": "Uses your Grok Build login — no separate API key needed.",
        }
    if key:
        return {
            "configured": True,
            "provider": "SpaceXAI / xAI REST",
            "base_url": "https://api.x.ai/v1",
            "model": os.environ.get("XAI_MODEL", "grok-4.5"),
            "hint": "Using XAI_API_KEY env var.",
        }
    return {
        "configured": False,
        "provider": "none",
        "base_url": "",
        "model": "",
        "hint": "Install Grok Build (grok.exe) or set XAI_API_KEY, then restart PlanTakeoff.",
    }


def _ai_work_dir() -> Path:
    d = APP_DIR / "data" / "ai_work"
    # When frozen, APP_DIR is _internal — write next to exe if possible
    if getattr(sys, "frozen", False):
        d = Path(sys.executable).resolve().parent / "data" / "ai_work"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _run_powershell_ai(mode: str, user_prompt: str, system: str = "") -> Dict[str, Any]:
    """
    Call extensions/Invoke-PlanTakeoffAI.ps1 which shells out to grok -p.
    This is the preferred path — uses the user's PowerShell / Grok session auth.
    """
    ext = _ps_extension_path()
    if not ext.is_file():
        # Dev: script next to source tree when frozen wrongly
        alt = Path(__file__).resolve().parent / "extensions" / "Invoke-PlanTakeoffAI.ps1"
        if alt.is_file():
            ext = alt
        else:
            raise RuntimeError(f"PowerShell AI extension not found: {ext}")

    work = _ai_work_dir()
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    prompt_path = work / f"{mode}_{stamp}_prompt.txt"
    out_path = work / f"{mode}_{stamp}_out.txt"
    prompt_path.write_text(user_prompt, encoding="utf-8")

    ps = os.environ.get("SystemRoot", r"C:\Windows") + r"\System32\WindowsPowerShell\v1.0\powershell.exe"
    if not Path(ps).is_file():
        ps = "powershell.exe"

    cmd = [
        ps,
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        str(ext),
        "-Mode",
        mode,
        "-PromptFile",
        str(prompt_path),
        "-OutFile",
        str(out_path),
        "-TimeoutSec",
        "180",
    ]
    if system:
        cmd.extend(["-SystemRules", system])

    import subprocess

    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=200,
            cwd=str(ext.parent),
        )
    except subprocess.TimeoutExpired as e:
        raise RuntimeError("PowerShell Grok extension timed out (200s).") from e
    except Exception as e:
        raise RuntimeError(f"Failed to start PowerShell extension: {e}") from e

    if proc.returncode != 0:
        err = (proc.stderr or proc.stdout or "").strip()
        raise RuntimeError(
            f"Grok PowerShell extension failed (exit {proc.returncode}). {err[:1200]}"
        )

    text = ""
    if out_path.is_file():
        text = out_path.read_text(encoding="utf-8-sig", errors="replace").strip()
    if not text:
        text = (proc.stdout or "").strip()
    if not text:
        raise RuntimeError("Grok extension returned empty output.")
    # Strip UTF-8 BOM if present
    if text.startswith("\ufeff"):
        text = text.lstrip("\ufeff")

    return {
        "ok": True,
        "model": "grok-cli",
        "provider": "powershell-extension",
        "text": text,
        "raw": {"stderr": (proc.stderr or "")[-500:]},
    }


def _xai_chat(system: str, user: str, *, temperature: float = 0.3) -> Dict[str, Any]:
    """Fall back: xAI OpenAI-compatible chat completions via XAI_API_KEY."""
    key = (os.environ.get("XAI_API_KEY") or "").strip()
    if not key:
        raise RuntimeError(
            "No AI backend. Install Grok CLI or set XAI_API_KEY, then restart PlanTakeoff."
        )
    model = os.environ.get("XAI_MODEL", "grok-4.5")
    payload = {
        "model": model,
        "temperature": temperature,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
    }
    req = urllib.request.Request(
        "https://api.x.ai/v1/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="replace")[:800]
        raise RuntimeError(f"xAI API HTTP {e.code}: {err_body}") from e
    except Exception as e:
        raise RuntimeError(f"xAI request failed: {e}") from e

    text = ""
    try:
        text = data["choices"][0]["message"]["content"] or ""
    except Exception:
        text = json.dumps(data)[:2000]
    return {"ok": True, "model": model, "provider": "xai-rest", "text": text, "raw": data}


def _ai_chat(system: str, user: str, *, mode: str = "raw") -> Dict[str, Any]:
    """Prefer PowerShell Grok extension; fall back to REST API key."""
    # Prefer extension when Grok CLI is present
    if _find_grok_exe() and (
        _ps_extension_path().is_file()
        or (Path(__file__).resolve().parent / "extensions" / "Invoke-PlanTakeoffAI.ps1").is_file()
    ):
        try:
            return _run_powershell_ai(mode if mode in ("scope", "plansweep", "raw") else "raw", user, system)
        except Exception as ext_err:
            # Fall through to REST if key exists
            if not (os.environ.get("XAI_API_KEY") or "").strip():
                raise
            try:
                result = _xai_chat(system, user)
                result["extension_error"] = str(ext_err)
                return result
            except Exception:
                raise ext_err
    return _xai_chat(system, user)



def _ascii_clean(s: str) -> str:
    """Remove mojibake / non-printable junk from model output."""
    if not s:
        return ""
    s = s.lstrip("\ufeff")
    for bad, good in (
        ("\u2014", "-"),
        ("\u2013", "-"),
        ("\u2018", "'"),
        ("\u2019", "'"),
        ("\u201c", '"'),
        ("\u201d", '"'),
        ("\u2022", "-"),
        ("\u00a0", " "),
    ):
        s = s.replace(bad, good)
    return "".join(ch if (ord(ch) >= 32 and ord(ch) < 127) or ch in "\n\r\t" else "" for ch in s)


def run_scope_ai(body: Dict[str, Any]) -> Dict[str, Any]:
    """
    Step 2 - WL Painting proposal.
    Prefer polishing a LOGIC DRAFT built from real takeoff quantities.
    Only add clarifications from evidence-based plan-sweep findings.
    """
    notes = body.get("notes") or ""
    company = body.get("company") or "WL Painting Inc."
    sweep_text = (body.get("sweep_text") or body.get("plansweep") or "").strip()
    draft_scope = (body.get("draft_scope") or "").strip()
    evidence_text = (body.get("evidence_text") or "").strip()

    system = (
        "You edit bid documents for WL Painting Inc. "
        "NO tools. Final document only. "
        "Keep every Scope of Work line from the LOGIC DRAFT that has a quantity. "
        "You may clarify wording, but MUST NOT invent paint areas, rooms, or systems "
        "unsupported by EVIDENCE or the LOGIC DRAFT. ASCII only."
    )
    user = f"""Polish into the final WL Painting proposal.

COMPANY: {company}

===== LOGIC DRAFT (source of truth for scope lines + numbers) =====
{draft_scope or '(no draft - do not invent quantities; say takeoff pending in Clarifications)'}

===== EVIDENCE PACK =====
{evidence_text[:10000] or '(none)'}

===== PLAN-SWEEP (use ONLY findings that cite Evidence; ignore generic guesses) =====
{sweep_text[:10000] or '(none)'}

===== ESTIMATOR NOTES =====
{notes or '(none)'}

OUTPUT RULES:
1) Structure:
Project: ...
Scope of Work
1. Provide labor and materials to ...
Clarifications
1. ...
Exclusions
- ...

2) Keep draft quantity numbers exact (rephrase verbs only).
3) From sweep: only add clarification/exclusion if finding has Evidence cited.
4) No checkbox dumps. ASCII only. Start with Project:
"""

    result = _ai_chat(system, user, mode="scope")
    result["mode"] = "scope"
    if result.get("text"):
        result["text"] = _ascii_clean(result["text"])
    if not (result.get("text") or "").strip() and draft_scope:
        result["text"] = draft_scope
        result["ok"] = True
        result["fallback"] = "draft_scope"
    return result


def run_plansweep_ai(body: Dict[str, Any]) -> Dict[str, Any]:
    """
    Step 1 - Evidence-based plan-sweep only.
    No generic amenity checklists unless tied to a hard fact.
    """
    notes = body.get("notes") or ""
    evidence_text = (body.get("evidence_text") or "").strip()
    job = body.get("job") or {}
    project_name = job.get("name", "") or "Project"

    if not evidence_text:
        drawings = body.get("drawings") or []
        quantities = body.get("quantities") or []
        draw_lines = [f"- {d.get('name') or d}" for d in drawings[:100]] or ["- (none)"]
        qty_lines = [
            f"- {q.get('name', '')}: {q.get('qty', 0)} {q.get('unit', '')}"
            for q in quantities[:50]
        ] or ["- (none)"]
        evidence_text = (
            f"JOB\n- Name: {project_name}\n- Number: {job.get('jobNumber', '')}\n"
            f"PAGES/DRAWINGS\n" + "\n".join(draw_lines) + "\nQUANTITIES\n" + "\n".join(qty_lines)
            + f"\nNOTES\n{notes or '(none)'}\n"
        )

    system = (
        "You are a painting estimator auditor. "
        "Report ONLY findings supported by the evidence pack. "
        "NO tools. Final markdown only. ASCII only. "
        "If evidence is thin, say so - never invent finish schedules or amenity lists."
    )
    user = f"""EVIDENCE-BASED PLAN-SWEEP for WL Painting.

ONLY write findings grounded in the EVIDENCE PACK.
Every finding needs: Evidence | Why it matters | Action.

FORBIDDEN:
- Generic Planet Fitness / gym amenity laundry lists without a cited page, qty, or note
- Invented finish tags (P-1, P-2) unless those strings appear in evidence/notes
- Planning sentences
- Non-ASCII or garbage characters

===== EVIDENCE PACK =====
{evidence_text[:16000]}

===== OUTPUT FORMAT =====
## Evidence-based plan-sweep - {project_name}

### A. What we know (from file)
- Restate hard facts only (job, measured qtys, pages loaded, notes). Max 12 bullets.

### B. Real findings
For each finding (quality over quantity, typically 3-10):
#### Finding N - short title
- Evidence: <point to page/qty/note fact>
- Why it matters: <painting logic, 1-2 sentences>
- Action: <measure or verify next>

### C. Cannot determine yet
- Genuine unknowns only (no speculation).

### D. Scope logic for proposal
Numbered rules Step 2 must follow, e.g. only measured qty>0 becomes paid scope lines.

### E. Suggested next measures
- Only what evidence implies (existing zero-qty conditions, page names, notes).

If measured quantities exist, discuss those numbers. Do not invent unrelated rooms.
"""

    result = _ai_chat(system, user, mode="plansweep")
    result["mode"] = "plansweep"
    if result.get("text"):
        result["text"] = _ascii_clean(result["text"])
    return result



def main():
    os.chdir(APP_DIR)
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    url = f"http://127.0.0.1:{PORT}/index.html"
    print(f"PlanTakeoff running at {url}")
    print(f"Bids root: {bids_root()}")
    print("Press Ctrl+C to stop.")
    threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
        server.shutdown()


if __name__ == "__main__":
    main()
