# PlanTakeoff — Complete Tools Audit (Final Prototype)

**Date:** 2026-07-23  
**Product:** PlanTakeoff v1.0 — WL Painting digital quantity takeoff  
**Stack:** Python local server + pywebview desktop · HTML/CSS/JS canvas takeoff  
**Status:** Final prototype ready (`dist/PlanTakeoff/PlanTakeoff.exe` + source tree)

---

## 1. Architecture

| Layer | File(s) | Role |
|-------|---------|------|
| Desktop shell | `desktop_app.py` | pywebview window, free port, start HTTP server, health wait |
| API / files | `server.py` | Bids scan, project folders, plan scoring, file serve, create EST |
| Domain | `js/models.js` | Conditions, pages, takeoffs, scale, qty, angleSnap, units |
| Persistence | `js/store.js` | localStorage meta + IndexedDB plan images, JPEG compress |
| Canvas | `js/canvas-engine.js` | Pan/zoom, digitize, select/edit, calibrate, draw marks |
| App shell | `js/app.js` | UI, open job, import, scale, summary, estimate, history |
| Estimates API client | `js/estimates.js` | `/api/*` wrapper |
| PDF | `js/pdf-loader.js` + `vendor/pdfjs/` | Multi-page PDF → canvas data URLs |
| History | `js/history.js` | Undo/redo stack for takeoff objects |
| UI | `index.html`, `css/app.css` | Tabs, toolbars, modals |

---

## 2. Canvas tools (complete inventory)

| Tool | UI / hotkey | Behavior | Status |
|------|-------------|----------|--------|
| **Select** | Toolbar · `V` | Click mark → select; drag body → move; drag grips → reshape vertices; Shift+vertex = ortho; Delete removes | ✅ Working |
| **Pan** | Toolbar · `P` · Space (hold) · middle mouse · **right-drag when idle** | Hand pan plan | ✅ Working |
| **Linear** | Toolbar · `L` · condition style | Polyline or 2-click **Seg** mode; Shift/soft 45° snap; Space/RMB/Enter finish | ✅ Working |
| **Area** | Toolbar · `A` | Polygon; near-start close; Space/RMB/Enter/dblclick finish | ✅ Working |
| **Count** | Toolbar · `C` | One click = 1 EA under active count condition | ✅ Working |
| **Measure** | Advanced (`menu-adv`) · `M` | Temp 2-click distance; not saved | ✅ Working (hidden by default) |
| **Calibrate** | `Calibrate…` | 2 clicks → modal → known length → `feetPerPixel` on page · qty refresh | ✅ Working |
| **From mark…** | Button | Use selected/last linear mark as calibrate stick | ✅ Working |
| **Seg / Poly** | Toolbar | Linear segment (2-click) vs multi-point polyline | ✅ Working |
| **Fit** | `Fit` / menu | Fit plan image in view | ✅ Working |
| **Delete** | Button · `Delete` | Remove selected takeoff(s) | ✅ Working |
| **Load file…** | Advanced | Manual image/PDF load | ✅ Working (hidden) |

### Digitize workflow (PlanSwift-style)

1. Open job → Takeoff tab with first plan  
2. Click **condition** in list (or 1–9 / Tab)  
3. Tool auto-matches style (linear/area/count)  
4. Click plan to digitize; stay on same condition  
5. Double-click condition → properties (color, height, etc.)  
6. **Select** to move/reshape marks  

### Finish / cancel / edit keys

| Action | Keys / mouse |
|--------|----------------|
| Finish linear/area | **Space**, **right-click**, Enter, double-click, area near-start |
| Cancel draft | Esc · Space with 1 point only · RMB with incomplete draft |
| Pop last vertex | Backspace · Ctrl+Z mid-draft |
| Undo/redo object | Ctrl+Z / Ctrl+Y (when not drafting) |
| Ortho / 45° | Shift (force) or auto near 45° |
| Condition switch | 1–9 by number · Tab next |

### Mark rendering / properties

| Feature | Status |
|---------|--------|
| Stroke/fill uses **live condition color** | ✅ Fixed (white = selection halo only) |
| Color picker live preview on plan | ✅ |
| Cancel properties restores color | ✅ |
| Height → wall SF (linear secondary) | ✅ |
| Thickness → CF (area secondary) | ✅ |
| Dim inactive conditions while digitizing | ✅ |
| Layer visibility hides marks | ✅ |

### Scale

| Feature | Status |
|---------|--------|
| Preset scales (1/8 … 1:100) | ✅ — badge shows “verify” until calibrated |
| PDF import sets dpi ≈ 72 × render scale | ✅ |
| Calibrate / From mark updates all LF/SF on page | ✅ via `refreshQuantitiesAfterScaleChange` |
| Quantities recomputed from geometry × feetPerPixel | ✅ live (not frozen at draw time) |

---

## 3. Jobs / drawings tools

| Tool | Location | Behavior | Status |
|------|----------|----------|--------|
| **Scan Jobs** | Header / Library | Scan `Samuel Bids\Estimates YYYY` | ✅ |
| **Year filter** | Library | Year folder select | ✅ |
| **Filter** | Library | EST# / name text filter | ✅ |
| **Open Job** | Row click | Create/reopen bid, first plan on canvas, background import rest | ✅ |
| **Progressive import** | Background | Only **new** sheets (path + PDF page key); no re-measure wipe | ✅ |
| **Plan scoring** | server + client | Prefer floor plans; sheet IDs as page names | ✅ |
| **Sheet naming** | `parseSheetFromFilename` | e.g. `A101 — Floor Plan` | ✅ |
| **Re-open** | Same job | Hydrate images from IndexedDB; only add new files | ✅ |
| **Open Jobs** tab | List of opened bids | Resume, remove from list | ✅ |
| **New Folders** | Optional tab | FOLDERS.bat-equivalent EST tree | ✅ (optional) |
| **Suggest code** | Folders | Next EST###### | ✅ |
| **Batch create** | Folders | Multi-line create | ✅ |

### Server API

| Endpoint | Purpose |
|----------|---------|
| `GET /api/health` | Ready check |
| `GET /api/config` | Bids root, year folders |
| `GET /api/scan?year=` | List estimate projects |
| `GET /api/project?path=` | Full project + drawings scored |
| `GET /api/file?path=` | Serve drawing bytes |
| `GET /api/suggest-code` | Next EST code |
| `POST /api/create-project` | One folder |
| `POST /api/create-batch` | Many folders |
| `POST /api/open-folder` | Explorer open (optional) |

---

## 4. Estimating tabs

| Tab | Tools | Status |
|-----|-------|--------|
| **Summary** | Qty rollup, hide zeros, CSV export | ✅ |
| **Estimate** | Mat/Labor/Sub unit costs, totals, CSV | ✅ |
| **Cover Sheet** | Bid identity fields | ✅ optional |
| **Worksheet** | Manual lines | ✅ optional |
| **Budget** | Budget vs estimate | ✅ optional |
| **Notes** | Notes list | ✅ optional |
| **Help** | Workflow + shortcuts | ✅ optional |
| **Export / Import Backup** | Full state JSON | ✅ |

---

## 5. Storage & performance

| Item | Implementation | Status |
|------|----------------|--------|
| Meta + takeoffs | localStorage (`planTakeoff.v1.meta`) | ✅ |
| Plan images | IndexedDB `PlanTakeoffDB` | ✅ |
| Compress | JPEG ~0.82 quality, max edge ~3600–4500 | ✅ |
| Legacy migration | Fat localStorage → meta + IDB | ✅ |
| Quota recovery | Boot fallback if storage full | ✅ partial |

---

## 6. Known limits (prototype — not blockers for daily paint takeoff)

| Item | Notes |
|------|-------|
| Preset scale accuracy | Depends on correct DPI vs printed scale; **always calibrate** on a known dim for bids |
| Multi-PDF huge sets | Caps (~40 pages/file per pass, background multi-pass); very large sets are progressive |
| No cloud sync | Local machine only |
| No automatic room detect | Manual digitize only |
| Measure tool | Hidden advanced; temporary only |
| Layers UI | Hidden advanced block; still functional |
| Attachment style | Model allows; UI focuses linear/area/count |
| History | Object-level undo; not full project timeline |
| Color cancel | Restores color only (other fields not live-previewed) |

---

## 7. Bugs fixed in this prototype cycle

1. **Condition color not on plan** — selected/digitizing stroke used white; now condition color + white halo  
2. **Color cancel stuck** — live picker preview restored on Cancel  
3. **Scale qty stale** — change scale / calibrate refreshes condition list + summary  
4. **Open job one page only** — sheet keys per PDF page; background fills rest  
5. **Re-import wiping** — skip existing path+page; measure once  
6. **Marks unmovable** — Select tool move + vertex grips  
7. **RMB / Space finish** — finish when drafting; pan when idle  
8. **Storage full** — IDB + JPEG compress  
9. **Server health / port** — free port + health wait; safe logging  
10. **Open job stuck busy** — finally clears; 2 min retry  

---

## 8. Final prototype deliverable

### Run (recommended)

```
C:\Users\samuc\plan-takeoff\dist\PlanTakeoff\PlanTakeoff.exe
```

Or from source:

```
C:\Users\samuc\plan-takeoff\Launch PlanTakeoff.bat
```

### Daily workflow

1. **Scan Jobs** → pick year → click job  
2. First plan appears on **Takeoff**  
3. **Calibrate…** or **From mark…** on a known dimension  
4. Click condition (PT-1 Walls, Ceilings, …) → digitize  
5. **Summary** / **Estimate** for quantities and costs  
6. Re-open job later → only **new** drawings added  

### Source of truth

- Dev: `C:\Users\samuc\plan-takeoff\` (`js/`, `index.html`, `server.py`)  
- Packaged UI assets: `dist\PlanTakeoff\_internal\` (synced with source)  

---

## 9. Verdict

| Area | Grade |
|------|-------|
| Digitize tools (L/A/C + select/edit) | **Production-ready prototype** |
| Scale calibrate | **Production-ready** (user must calibrate) |
| Job open / multi-page / re-import | **Solid** |
| Color / property → plan | **Fixed** |
| Summary / estimate | **Solid for paint** |
| Advanced OST (AI rooms, stamps, RFI) | **Out of scope** |

**Final prototype: ready for WL Painting takeoff use.**  
Prefer calibrate on every sheet. Prefer desktop exe so the local server can read Estimates folders.
