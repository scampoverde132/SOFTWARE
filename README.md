# PlanTakeoff v1.0 — Desktop Software

Full Windows takeoff application for **WL Painting Inc.**

## Launch (compiled software)

Double-click either:

- **Desktop:** `PlanTakeoff` shortcut / `PlanTakeoff.bat`  
- **Or:**  
  `C:\Users\samuc\plan-takeoff\dist\PlanTakeoff\PlanTakeoff.exe`

No browser setup needed — opens as its own app window.

## What it includes

| Module | Features |
|--------|----------|
| **Estimates Library** | Scans `Samuel Bids\Estimates 2025/2026`, job names, drawings |
| **New Folders** | Creates EST project folders (same as FOLDERS.bat) |
| **Takeoff** | Scale, calibrate, Linear / Area / Count, layers |
| **PDF plans** | Load multi-page PDFs (page pick or ALL) |
| **Summary / Estimate** | Quantities + material/labor/sub unit costs |
| **Cover / Worksheet** | Bid info and manual lines |

## Rebuild after code changes

```bat
C:\Users\samuc\plan-takeoff\build_desktop.bat
```

## Dev mode (without rebuilding)

```bat
C:\Users\samuc\plan-takeoff\Launch PlanTakeoff.bat
```

Uses Python + `desktop_app.py` if the `.exe` is missing.

## Data

- Takeoff bids: browser/app localStorage (per Edge WebView profile)  
- Job folders: `C:\Users\samuc\OneDrive\Desktop\Samuel Bids\`  
- Override bids root: set env `PLANTAKEOFF_BIDS_ROOT`

## Files

```
plan-takeoff/
  desktop_app.py      ← native window shell
  server.py           ← estimates API + static UI
  index.html, js/, css/
  vendor/pdfjs/       ← offline PDF engine
  dist/PlanTakeoff/   ← compiled app (ship this folder)
  build_desktop.bat   ← rebuild exe
```

Ship the whole **`dist\PlanTakeoff\`** folder if copying to another PC (keep `_internal` next to the exe).
