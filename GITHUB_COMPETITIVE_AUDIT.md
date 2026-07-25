# PlanTakeoff vs GitHub — Competitive Audit

**Date:** 2026-07-24  
**Your product:** PlanTakeoff (WL Painting desktop prototype)  
**Question:** How does our code stack up against something *better* on GitHub?

---

## Contenders (best open takeoff / estimating on GitHub)

| Project | Stars* | License | Fit vs you | Verdict |
|---------|--------|---------|------------|---------|
| **[Kentucky-ai/opentakeoff](https://github.com/Kentucky-ai/opentakeoff)** | ~30 | Apache-2.0 | **Same problem:** PDF canvas takeoff | **Primary benchmark** — best peer |
| **[braedonsaunders/bidwright](https://github.com/braedonsaunders/bidwright)** | ~32 | AGPL-3.0 | Full estimating *platform* + AI | Different weight class |
| **[datadrivenconstruction/OpenConstructionERP](https://github.com/datadrivenconstruction/OpenConstructionERP)** | ~548 | AGPL-ish | ERP + BOQ + BIM/CAD | Too big to “port”; different product |

\*Stars as of 2026-07 (order of magnitude; not quality scores).

You already clone OpenTakeoff at `_refs/opentakeoff` and track ports in `PORT_FROM_OPENTAKEOFF.md`.

---

## 1. Head-to-head: PlanTakeoff vs OpenTakeoff

OpenTakeoff is the open project closest to what you built: browser canvas, pdf.js, conditions, linear/area/count, scale, local storage. It was carved from a commercial flooring estimator. PlanTakeoff is a **desktop painting workflow** tool wired to Samuel Bids / EST folders.

### Size & engineering maturity

| | PlanTakeoff | OpenTakeoff |
|--|-------------|-------------|
| Core canvas UI | ~1k LOC `canvas-engine.js` + ~3k `app.js` | **~428kB** `TakeoffCanvas.jsx` alone + 60 lib modules |
| Tests | None automated | **65+** web tests + MCP e2e |
| Stack | Vanilla JS + Python server + pywebview | React 18 + Vite + TypeScript geometry |
| Packaging | Windows `.exe` (PyInstaller) | Static web / Netlify |
| Architecture | Monolithic app.js (works, hard to test) | Lib-first pure math + huge canvas component |

**Honest grade:** OpenTakeoff is **more mature as a measuring engine**. PlanTakeoff is **more mature as a WL Painting ops shell** (disk jobs, EST folders, desktop).

### Feature scorecard (takeoff engine)

| Capability | PlanTakeoff | OpenTakeoff | Winner |
|------------|:-----------:|:-----------:|:------:|
| Linear / Area / Count | ✅ | ✅ | Tie |
| Segment vs polyline | ✅ | ✅ | Tie |
| 45° / Shift ortho | ✅ (ported) | ✅ | Tie |
| Move / vertex edit | ✅ | ✅ | Tie |
| Undo / redo | ✅ slim | ✅ command stack | OT slight |
| Scale calibrate / From mark | ✅ | ✅ | Tie |
| Scale **auto-detect from title block** | ❌ | ✅ | **OT** |
| Scale **check tool (K)** + % error | Partial (prompt) | ✅ full | **OT** |
| Pack-downscale → fpp fix | ✅ (you fixed) | N/A (different render path) | You (for your path) |
| **One-Click Area** (flood-fill rooms) | ❌ | ✅ flagship | **OT** |
| Hatch-robust / scan masks | ❌ | ✅ | **OT** |
| Rectangle tool | ❌ | ✅ | **OT** |
| Deduct / eraser | ❌ | ✅ | **OT** |
| Curved linear | ❌ | ✅ | **OT** |
| Endpoint snap to geometry | ❌ | ✅ beta | **OT** |
| HD vector re-render at zoom | ❌ (static bitmap) | ✅ | **OT** |
| Multi-sheet side-by-side | ❌ (page list) | ✅ 4 panels | **OT** |
| CAD hatches on conditions | ❌ solid color | ✅ | **OT** |
| Waste % / materials buy list | ❌ | ✅ flooring-deep | **OT** (wrong trade) |
| Marked Set PDF export | ❌ | ✅ | **OT** |
| Excel multi-tab export | ❌ CSV only | ✅ | **OT** |
| Revisions / addenda diff | ❌ | ✅ | **OT** |
| Voice / command box | ❌ | ✅ | **OT** |
| MCP / AI agent drive | ❌ | ✅ | **OT** |
| Automated tests | ❌ | ✅ | **OT** |

### Feature scorecard (your business shell — where you win)

| Capability | PlanTakeoff | OpenTakeoff | Winner |
|------------|:-----------:|:-----------:|:------:|
| **EST###### job folders on disk** | ✅ Scan + Open | ❌ | **You** |
| Progressive multi-PDF import | ✅ | Zip/PDF in browser | **You** (for network shares) |
| Sheet scoring / plan-first sort | ✅ | Gallery only | **You** |
| Measure-once, refresh adds only new sheets | ✅ | Re-open model different | **You** |
| Native Windows desktop window | ✅ pywebview | Browser | **You** |
| Painting starter conditions (walls/ceilings/doors/base) | ✅ | Flooring finishes | **You** (trade) |
| Mat/Labor/Sub unit-cost estimate tab | ✅ simple | Materials/coverage deep | Depends |
| Cover / worksheet / budget tabs | ✅ optional | Different report model | You for OST-like layout |
| Offline local server for bids root | ✅ | Optional only | **You** |

### Bottom line vs OpenTakeoff

```
Measuring engine maturity:     OpenTakeoff  ████████░░  8/10
                               PlanTakeoff  █████░░░░░  5/10

WL Painting job workflow:      PlanTakeoff  ████████░░  8/10
                               OpenTakeoff  ██░░░░░░░░  2/10

Ship as daily paint takeoff:   PlanTakeoff wins *if* scale is trusted
                               OpenTakeoff wins *if* you need one-click rooms
```

**You are not “behind on GitHub” as a product for WL Painting.**  
You **are** behind OpenTakeoff as a **pure measurement library**.

---

## 2. Bidwright — different sport

[Bidwright](https://github.com/braedonsaunders/bidwright) (~32★, AGPL): full bid platform — intake, knowledge, assemblies, 2D+3D takeoff, pricing burdens, agent review, Postgres, Docker monorepo.

| | PlanTakeoff | Bidwright |
|--|-------------|-----------|
| Goal | Fast paint takeoff on EST jobs | Run the whole bid |
| Install | One `.exe` | Docker + multi-service |
| License | Yours / internal | AGPL (viral if you ship SaaS) |
| 2D takeoff | Core | Present, not the whole story |
| AI agents | None | Central |

**Do not try to “catch Bidwright.”** Steal *ideas* (assemblies later, review checklist), not the stack. AGPL also makes casual code copy risky for a commercial company product.

---

## 3. OpenConstructionERP — ERP, not a peer

[OpenConstructionERP](https://github.com/datadrivenconstruction/OpenConstructionERP) (~548★): BOQ, multi-language catalogs, BIM/CAD, 4D/5D. Impressive, enormous, wrong shape for a painting estimator’s daily click-on-plan tool.

**Use for:** market awareness that “open construction software” is real.  
**Not for:** porting into PlanTakeoff.

---

## 4. What OpenTakeoff does *better* that you should steal next

Ranked for **painting value / effort** (from `_refs` + FEATURES.md):

### Tier A — high value, portable (1–3 days each)

| # | Feature | Why paint care | Source in OT |
|---|---------|----------------|--------------|
| A1 | **Endpoint snap** to existing mark vertices (and later PDF vectors) | Walls meet; fewer sloppy joins | `geometry.js` `buildSnapGrid` / `nearestSnap` |
| A2 | **Scale check tool** (measure dim, show % error, one-tap recalibrate) | Stops 6.42 vs 8.00 forever | `units.ts` + check flow |
| A3 | **On-canvas qty chips** on finished marks (LF/SF always visible) | Estimator eyes, not sidebar only | shape labels pattern |
| A4 | **Rectangle area** (2-click room) | Fast ceilings | `rect` tool |
| A5 | **Deduct / opening** (negative area or hole) | Windows/doors in walls or floor holes | totals role / eraser |
| A6 | **Automated tests** for scale, angleSnap, qty math | Prevents regressions like pack/DPI | `web/test/*` pattern |

### Tier B — differentiates product (1–2 weeks)

| # | Feature | Notes |
|---|---------|-------|
| B1 | **One-Click Area** | Huge for ceilings/floors; `oneclick.ts` is large — port pure TS→JS carefully; Apache-2.0 OK with attribution |
| B2 | **HD zoom re-render** from PDF | Your bitmaps blur at 300%; OT re-renders vectors |
| B3 | **Marked Set PDF** | Send GC a marked plan — big sales/estimating win |
| B4 | **Waste % + paint coverage** (gal = SF / coverage) | Your “materials buy list” for paint, not flooring |

### Tier C — skip for now (OT flex, not paint daily)

- MCP server / voice dictation  
- Google Drive cloud  
- Flooring hatch patterns / grout calculator  
- Multi-panel 4-sheet layout (nice; your page list is enough)

---

## 5. What *you* do better (keep and double down)

1. **Jobs = EST folders on OneDrive/Desktop** — OpenTakeoff never sees your Bids tree.  
2. **Open Job → first plan now, rest in background** — estimator time-to-first-click.  
3. **Re-open only adds new drawings** — don’t re-digitize.  
4. **Desktop shell** — no “open Chrome and hope for the right port.”  
5. **Painting condition defaults** — walls LF + height → wall SF, ceilings SF, doors EA, base LF.  
6. **Simple Mat/Labor/Sub estimate grid** — OST-ish, not flooring assembly science.

These are your moat. Don’t dilute them by becoming a generic web takeoff clone.

---

## 6. Recommended strategy (not a rewrite)

```
┌─────────────────────────────────────────────────────────┐
│  PlanTakeoff shell (keep)                               │
│  EST scan · desktop · IDB · estimate tabs · painting UI  │
└───────────────────────┬─────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│  Measuring core — level-up toward OpenTakeoff quality   │
│  snap · check-scale · rect · deduct · tests · (later)   │
│  one-click area · HD PDF zoom · marked PDF              │
└─────────────────────────────────────────────────────────┘
```

**Do not** replace PlanTakeoff with OpenTakeoff wholesale: you lose EST folder workflow and desktop packaging, and OT is flooring-first UI.

**Do** treat OpenTakeoff as an **Apache-2.0 geometry lab**: port pure functions + tests, keep your data model (`conditions`, `takeoffs[].geometry.points`, `feetPerPixel`).

---

## 7. 30-day “beat the peer where it matters” plan

| Week | Goal | Success metric |
|------|------|----------------|
| 1 | A2 check-scale + A3 qty chips + A6 unit tests for `feetPerPixel` / pack ratio | Mark on 8'-0" shows 8.00 ±1% after calibrate; tests green |
| 2 | A1 endpoint snap + A4 rectangle | Corners click together; ceiling rooms faster |
| 3 | A5 deduct openings | Wall SF can subtract windows |
| 4 | B4 paint gallons (coverage) on Estimate | Buy list: gal primer / finish from SF |

Optional month 2: B1 one-click area for ceiling SF on clean plans.

---

## 8. License / legal

| Project | License | Porting pure math into PlanTakeoff |
|---------|---------|--------------------------------------|
| OpenTakeoff | Apache-2.0 | ✅ OK with attribution (you already document ports) |
| Bidwright | AGPL-3.0 | ⚠️ Copying code can force AGPL on derivative — prefer ideas only |
| OpenConstructionERP | Check repo | Treat as inspiration only |

---

## 9. Final score

| Dimension | Score (you vs best peer) |
|-----------|--------------------------|
| Daily paint takeoff on EST jobs | **You lead** |
| Canvas measuring depth | **OpenTakeoff leads hard** |
| Estimating platform breadth | **Bidwright leads hard** (ignore for now) |
| Overall “is our prototype good?” | **Yes for ops; middling for engine** |

**One sentence:**  
PlanTakeoff is the right *product shape* for WL Painting; OpenTakeoff is the better *measuring codebase* — win by porting their engine quality into your shell, not by abandoning your shell.

---

## Links

- OpenTakeoff: https://github.com/Kentucky-ai/opentakeoff · demo https://opentakeoff.netlify.app  
- Bidwright: https://github.com/braedonsaunders/bidwright  
- OpenConstructionERP: https://github.com/datadrivenconstruction/OpenConstructionERP  
- Your port map: `PORT_FROM_OPENTAKEOFF.md`  
- Your tools audit: `TOOLS_AUDIT.md`  
- Local OT clone: `_refs/opentakeoff/`
