# Port list: OpenTakeoff → PlanTakeoff

**Source clone:** `plan-takeoff/_refs/opentakeoff`  
**Upstream:** https://github.com/Kentucky-ai/opentakeoff (Apache-2.0)  
**Your targets:** `js/canvas-engine.js`, `js/models.js`, `js/app.js`, `index.html`

Reuse **patterns and pure math**. Do **not** paste React components wholesale. Keep PlanTakeoff’s object model (`takeoffs[]`, `geometry.points[{x,y}]`, conditions).

Coordinate note:
- OpenTakeoff often uses `[x, y]` tuples and sometimes `verts_norm` (0–1).
- PlanTakeoff uses `{ x, y }` in **image pixel** space.
- When porting, convert at the boundary: `[x,y]` ↔ `{x,y}`.

---

## Priority 0 — efficiency (do first)

### P0.1 Ortho / 45° angle lock

| | OpenTakeoff | PlanTakeoff |
|--|-------------|-------------|
| **Functions** | `angleSnap(last, cur, force)`, `ANGLE_TOL` | New helpers on `PlanCanvas` or `models.js` |
| **File** | `_refs/opentakeoff/web/src/lib/geometry.js` L152–162 | `js/canvas-engine.js` |
| **Call site OT** | `TakeoffCanvas.jsx` ~L2121–2136 (`moveCrosshair`): if drawing + anchor + (Shift or within 4°) → lock `cur` to ray | `_pointerMove` + `_pointerDown` when tool is `linear` / `area` / `calibrate` / `measure` |
| **Adapter** | OT: `last=[x,y]`, `cur=[x,y]`, returns `{ pt, deg }` | Wrap: `last={x,y}` → `[last.x,last.y]`; store locked world point before push |

**Behavior to match:**
- Soft lock within `ANGLE_TOL` (4°) of 0/45/90/…
- **Shift** = hard lock at any angle (`force=true`)
- Min segment length before lock (~12 / viewScale screen px) so tiny jitter doesn’t snap

**Also port visually (optional P0):** live angle + segment length chip near cursor (OT draws in status/crosshair; you can put on `#statusDim` first).

---

### P0.2 Undo last draft vertex + undo/redo takeoffs

| | OpenTakeoff | PlanTakeoff |
|--|-------------|-------------|
| **Draft pop** | Backspace / Delete / Ctrl+Z while `poly.length` → `poly.slice(0,-1)` | `canvas-engine.js` keydown: if `draftPoints.length`, pop last; **ignore** when focus is INPUT/TEXTAREA |
| **OT file** | `TakeoffCanvas.jsx` L1730–1760 | `_bind()` key handlers (~L47–60) |
| **Object undo** | Pure command stack: `applyShapeCommand`, `recordCommand`, `UNDO_CAP` | Simplified stack in `app.js` or small `js/history.js` |

**Port a slim version of** `_refs/.../shapeCommands.js`:

| OT command | PlanTakeoff equivalent event |
|------------|------------------------------|
| `{ type:'add', shapes:[...] }` | push takeoff object(s) |
| `{ type:'delete', ids:[...] }` | filter `project.takeoffs` |
| `{ type:'geom', id, verts_norm, prev }` | (P1) vertex edit — skip for P0 |
| `recordCommand(undo, {cmd, inverse}, cap)` | keep `undoStack` / `redoStack` arrays, cap 50–100 |

**Wire in `app.js` `onCanvasChange`:**
- On `add-takeoff` / `delete-takeoffs`: push inverse, clear redo
- Ctrl+Z / Ctrl+Y (or Ctrl+Shift+Z): apply inverse / redo
- Mid-draft: Ctrl+Z only pops vertex (OT rule: draft wins over stack)

**Do not port** OT provenance / `stampEdit` / MCP review for PlanTakeoff.

---

### P0.3 Right-click + pan conflict

| | OpenTakeoff | PlanTakeoff (fix) |
|--|-------------|---------------------|
| Pan | Space or middle button | `button === 1` or Space only — **not** `button === 2` |
| Finish | Enter / double-click | Keep Enter + dblclick; right-click = finish draft only |

**File:** `canvas-engine.js` `_pointerDown` (~L160) — remove `e.button === 2` from pan branch.

---

### P0.4 Tool hotkeys + input guard

| Key | OT (approx) | PlanTakeoff |
|-----|-------------|-------------|
| V | select | `setTool('select')` via `app.js` |
| L | linear | `setTool('linear')` |
| A | area | `setTool('area')` |
| C | count | `setTool('count')` |
| M | measure / voice | `setTool('measure')` |
| Esc | cancel draft | already clears `draftPoints` |
| Del | delete selection | already; add INPUT guard |
| Space | pan hold | already `spaceDown` |

**File:** `app.js` window keydown (near toolbar wiring ~L1478) **or** centralize in `canvas-engine` with `onToolRequest` callback.  
**Always:** `if (e.target.matches('input,textarea,select')) return;`

---

### P0.5 Scale badge + “unverified preset” warning

| | OpenTakeoff | PlanTakeoff |
|--|-------------|-------------|
| Per-sheet source | `scaleSources[key] = 'calibrated' \| 'standard' \| 'detected'` | `page.calibrated` already exists — extend with `page.scaleSource` |
| Guide bar | `showScaleGuide(key, upp, label)` L2477–2491 | After `applyCalibrate` / preset change: temporary overlay or status chip |
| Check tool | tool `check` + `checkVerdict` / `parseLenInput` in `units.ts` | New tool or button “Check scale…” |

**Port pure helpers from** `_refs/.../web/src/lib/units.ts`:
- `parseLenInput(raw, 'imperial')` — better calibrate/check input (`12'6"`, `12-6`)
- `ftIn(feet)` — nicer readouts
- `checkVerdict(errPct)` — green / amber / red

**PlanTakeoff files:**
- `models.js` — optional `formatFeetInches`
- `app.js` `applyCalibrate`, `onScaleChange`, fill scale UI in `index.html`
- PDF load path: set `page.dpi` from render scale × 72 so presets aren’t blindly wrong

---

## Priority 1 — pro feel

### P1.1 Endpoint snap (to existing takeoffs first)

| | OpenTakeoff | PlanTakeoff |
|--|-------------|-------------|
| **Functions** | `buildSnapGrid(points, cell)`, `nearestSnap(grid, x, y, maxDist)` | Same pure functions in `models.js` or `canvas-engine.js` |
| **File** | `geometry.js` L131–145 | Build grid from all `takeoffs` vertices on current page (+ draft points) |
| **OT usage** | L2110–2116; maxDist ~`11/scale` | In `_pointerMove` / before push on down |

Later (optional): feed PDF vector endpoints from `oneclick.ts` — heavy; skip until needed.

---

### P1.2 On-canvas live dimension label

| | OpenTakeoff | PlanTakeoff |
|--|-------------|-------------|
| Live LF on rubber band | Chip near cursor while locked/drawing | After draft length calc in `_emitStatus`, also `ctx.fillText` at midpoint of last segment in `draw()` |
| Finished qty chips | `shapeLabels.js` / canvas labels | In `_drawTakeoff`, if selected (or always for active condition), draw LF/SF/EA |

Math already exists: `polylineLengthPx` / `polygonAreaPx` × `feetPerPixel` in `models.js`.

---

### P1.3 Vertex edit (select + drag)

| | OpenTakeoff | PlanTakeoff |
|--|-------------|-------------|
| Edge grips, Shift-insert point | `TakeoffCanvas.jsx` select branch ~L1841+, L1956+ | `_hitSelect` + new drag state on vertex |
| Geom command | `applyShapeCommand` type `geom` | Update `takeoff.geometry.points[i]` + history snapshot |

---

### P1.4 Rectangle area tool

| | OpenTakeoff | PlanTakeoff |
|--|-------------|-------------|
| Tool | `rect` 2-corner | `data-tool="rect"` or area mode toggle |
| Commit | 4 corners polygon | `createTakeoffObject(..., 'polygon', { points: [tl,tr,br,bl] })` |

---

### P1.5 Deduct / negative takeoff

| | OpenTakeoff | PlanTakeoff |
|--|-------------|-------------|
| Tool | `deduct` / eraser role | Condition flag `isDeduct: true` or `kind` + qty engine subtracts primary |
| Math | `totals.js` role accumulation | `computeObjectQuantity` / `aggregateConditionQuantities` apply sign |

---

## Priority 2 — later / optional

| Feature | OT source | PlanTakeoff notes |
|---------|-----------|-------------------|
| One-Click Area | `web/src/lib/oneclick.ts` (~33k) | Large; only if you want flood-fill rooms |
| Scan mask | `rastermask.ts` | Scanned PDFs without vectors |
| Curve linear | `curve.js` | Curved walls |
| Mirror flip | `reflectVertsNorm` in `geometry.js` | Copy/mirror takeoffs |
| Marked set PDF | `markedset.js` | Export plans with takeoff burned in |
| Revisions | `revisions.js` | Bid addenda compare |
| MCP / voice | `mcp/`, `voice*.ts` | Out of scope for desktop painting tool |

---

## Function → file map (cheat sheet)

| Port | From OpenTakeoff | Into PlanTakeoff | Touch points |
|------|------------------|------------------|--------------|
| `angleSnap` | `geometry.js` | `canvas-engine.js` | `_pointerMove`, `_pointerDown` |
| `ANGLE_TOL` | `geometry.js` | same | constant |
| `buildSnapGrid` / `nearestSnap` | `geometry.js` | `models.js` or canvas | move/down before commit |
| `distToSeg` / `pointInPoly` | `geometry.js` | already have `distToSegment` / `pointInPolygon` | keep yours |
| `openLen` / `closedMetrics` | `geometry.js` | already `polylineLengthPx` / `polygonAreaPx` | keep yours |
| `recordCommand` + slim add/delete | `shapeCommands.js` | **new** `js/history.js` | `app.js` onCanvasChange, keys |
| Draft Backspace | `TakeoffCanvas.jsx` keys | `canvas-engine.js` | `_bind` |
| Input guard | same | `canvas-engine.js` + `app.js` | all global keys |
| `parseLenInput`, `ftIn`, `checkVerdict` | `units.ts` | `models.js` | calibrate modal + check tool |
| `showScaleGuide` idea | `TakeoffCanvas.jsx` | `app.js` + canvas overlay or status | after scale set |
| Right-click fix | (OT doesn’t pan on RMB) | `canvas-engine.js` | `_pointerDown` |
| Hotkeys L/A/C/M/V | OT toolbar | `app.js` | keydown |
| Live label draw | canvas UI | `canvas-engine.js` `draw()` | draft + selected |
| Deduct sign | `totals.js` | `models.js` | aggregate |

---

## Suggested implementation order (when you say “build”)

1. Right-click fix + input guard + hotkeys (1 hour)  
2. `angleSnap` on draft tools + Shift force (half day)  
3. Backspace last vertex + slim undo stack for add/delete (half day)  
4. Scale source badge + `parseLenInput` + optional check tool (half day)  
5. Endpoint snap to takeoff verts + on-canvas LF label (half day)  
6. Rectangle + deduct (next sprint)

---

## What not to port

- Entire `TakeoffCanvas.jsx` (monolithic React)
- Google Drive / cloud sync
- Flooring materials / coverage / grout calculator (unless you want later)
- MCP server, voice STT, contribute capture
- Normalized verts + multi-panel sheet layout (unless multi-sheet later)

---

## License note

OpenTakeoff is **Apache-2.0**. Ported code should keep a short notice (e.g. in `PORT_FROM_OPENTAKEOFF.md` or file header) if you copy substantial logic; reimplementation from this map is fine.

---

## Clone location

```
C:\Users\samuc\plan-takeoff\_refs\opentakeoff\
```

Update clone:
```bat
cd C:\Users\samuc\plan-takeoff\_refs\opentakeoff
git pull
```
