# PlanTakeoff — WL Painting Offline-First Hybrid Suite

PlanTakeoff is a Windows desktop application tailored to **WL Painting Inc.** It combines professional on-screen quantity takeoff with the complete estimating, bid, production, change-order, daily-log, and client-communication lifecycle.

The application runs locally. Plans, estimates, job metadata, change orders, daily logs, client updates, snapshots, and backups remain on the workstation and inside the existing EST project folders. No external database or email service is required.

## What PlanTakeoff includes

| Area | Production features |
|---|---|
| **Estimates Library** | Scans existing `Estimates YYYY` folders, searches jobs, filters by status, opens EST folders, and creates the standard WL Painting folder structure. |
| **Command Center** | Buildertrend-style Kanban pipeline, status drag-and-drop, job notes, KPI cards, pending change-order badge, daily-log age, percent complete, and overdue client-update warnings. |
| **Professional Takeoff** | Multi-page PDF loading, calibrated scale, Linear, Polyline, Area, Rectangle Area, Count, Room Package, Deduct, temporary measurement, snapping, angle tracking, vertex editing, mark properties, layers, and 80-command undo/redo. |
| **Painting Productivity** | Default painting assemblies, wall/ceiling coverage rates, gallon calculations, waste factors, material/labor/subcontract rates, quantity refresh, and estimate rollups. |
| **Estimate Finalization** | One-click **Finalize & Move to Bid Sent**, locked `baselineEstimate`, current and timestamped takeoff snapshots, read-only measurement lock, and warning-based Re-open for Measuring. |
| **Awarded Budget** | Moving a finalized bid to Awarded copies the locked baseline into `actualBudget` while the running total continues to include approved change orders. |
| **Change Orders** | Pending/Approved/Rejected workflow, linked takeoff quantity deltas, manual lines, additive/deduct visual plan objects, running contract totals, immutable approvals, history audit, and `change-orders.json`. |
| **Daily Logs** | Date, weather, crew, hours, work performed, issues, manual/automatic percent complete, local photo paths, compressed thumbnails, reverse-chronological history, and `daily-logs.json`. |
| **Client Updates** | One-click professional branded HTML using the latest three daily logs, newly approved change orders, current status, percent complete, current contract total, and remaining estimated value. Copy rich text, print/save PDF, or save dated HTML. |
| **Settings** | Gear panel for bids root override, default waste, coverage rates, material/labor rates, company name, and company logo. |
| **Reliability** | Timestamped job backups, disk-backed working takeoff snapshots, friendly JavaScript error toasts, clear API errors, standalone executable self-test, and package-file validation. |

## End-to-end hybrid workflow

### 1. Create or open an EST job

Use **Jobs (Estimates)** to scan the configured bids root and open an existing EST folder, or create a new WL Painting project folder:

```text
EST###### - Project Name/
  01 Drawings/
  02 Estimates/
  03 Pictures/
  04 Notes/
```

The default bids root can be changed from the gear icon without restarting PlanTakeoff.

### 2. Load plans and perform takeoff

Open plan files from `01 Drawings`, set or calibrate scale, create painting conditions, and measure using the professional takeoff tools.

Takeoff metadata and geometry are retained in the local application store. Plan images are stored in IndexedDB. A compact disk copy without embedded plan-image data is synchronized to:

```text
takeoff-working.json
```

Every meaningful takeoff save updates the disk-backed job timestamp so Command Center information remains current.

### 3. Apply painting defaults and build the estimate

Use painting templates or custom conditions. PlanTakeoff calculates quantities, surface area, gallons, waste, material, labor, subcontract, worksheet items, and the full estimated total.

Company-wide defaults are managed under the gear icon. Settings can also be applied immediately to the currently open job.

### 4. Finalize the bid

From the Estimate tab select:

```text
Finalize & Move to Bid Sent
```

PlanTakeoff then:

- Saves quantities and totals as `baselineEstimate` in `job.json`.
- Changes status to **Bid Sent**.
- Locks measurement tools to protect the submitted baseline.
- Writes `takeoff-snapshot.json`.
- Writes a timestamped snapshot archive.
- Returns to Command Center.

Use **Re-open for measuring** when revisions are required. The prior baseline remains until the revised job is finalized again.

### 5. Award and manage production

When a finalized job becomes **Awarded**, the baseline is copied into `actualBudget`. Moving the job to **In Progress** records the production start and prompts for the first Daily Log when none exists.

### 6. Record Daily Logs

Use the **Daily Logs** tab to record:

- Date and weather
- Crew count and hours per person
- Work performed
- Issues, delays, access, safety, RFI, or coordination notes
- Manual or automatically trended percent complete
- Compressed photo thumbnails or local/network photo paths

The latest completion percentage and the age of the latest log appear on the Command Center card.

### 7. Process Change Orders

Use the **Change Orders** tab to create manual lines or link a signed quantity delta to an existing takeoff object.

When approved, linked items create additive or deduct visual takeoff objects, preserve the original baseline, update the running contract total, and write the durable record to `change-orders.json`.

### 8. Generate the client update

With a job open, select:

```text
Generate Client Update
```

PlanTakeoff automatically gathers:

- Job name and address
- Current status
- Latest three Daily Logs
- Work performed and percent complete
- Approved Change Orders since the last update
- Current contract total
- Remaining estimated value

The preview can be copied as rich text, printed or saved as PDF, and is automatically saved as:

```text
client-update-YYYY-MM-DD.html
```

`job.json` records the last update date. In Progress jobs without a client update for seven or more days receive a yellow Command Center warning.

## Settings and branding

Select the **gear icon** in the header to configure:

- Bids root path
- Default waste percentage
- Default coverage rates by painting category
- Default material and labor rates
- Company name
- Company logo used in client updates

Settings are stored locally under the Windows user profile, normally:

```text
%LOCALAPPDATA%\PlanTakeoff\settings.json
```

## Keyboard shortcuts

Press **?** anywhere outside a text field to open the global shortcut guide.

Common shortcuts include:

| Shortcut | Action |
|---|---|
| `V` | Select/edit marks |
| `L` | Linear takeoff |
| `A` | Area takeoff |
| `C` | Count takeoff |
| `R` | Rectangle area |
| `M` | Temporary measure |
| `Enter` | Finish polyline/polygon |
| `Backspace` | Remove last draft vertex |
| `Delete` | Delete selected marks |
| `Space` | Temporary pan |
| `Shift` | Hard-lock angle tracking |
| `Ctrl+Z` / `Ctrl+Y` | Undo / redo |
| `Esc` | Cancel active operation |
| `?` | Shortcut guide |

## Disk files inside each EST folder

PlanTakeoff adds operational files without changing the existing drawing and estimate folder structure:

```text
job.json
baselineEstimate                 (inside job.json)
actualBudget                     (inside job.json)
takeoff-working.json
takeoff-snapshot.json
takeoff-snapshot-YYYYMMDD_HHMMSS.json
change-orders.json
daily-logs.json
client-update-YYYY-MM-DD.html
backups/
```

## Automatic backups

A timestamped backup is created when:

- A job status changes.
- The active job is closed or switched.
- The application closes with a job open.

Backup folders are written under:

```text
<EST job folder>\backups\YYYYMMDD_HHMMSS_microseconds_reason\
```

Each backup includes, when available:

- `job.json`
- `takeoff-working.json` or the finalized takeoff snapshot
- `change-orders.json`
- `daily-logs.json`
- `backup-manifest.json`

## Friendly errors and data safety

Unexpected JavaScript errors and unhandled promises display a friendly toast while details remain available in the developer console. Local API failures return an operation-specific message and technical detail rather than an unexplained failure.

PlanTakeoff does not remove saved job data when an interface error occurs.

## Launch

### Compiled desktop application

Launch:

```text
dist\PlanTakeoff\PlanTakeoff.exe
```

Ship the entire `dist\PlanTakeoff\` folder. The `_internal` folder must remain beside the executable.

### Development mode

Run:

```bat
Launch PlanTakeoff.bat
```

The launcher uses the compiled application when available. Otherwise it runs `desktop_app.py` with Python and pywebview.

## Build and package

Run:

```bat
build_desktop.bat
```

The build process:

1. Installs requirements.
2. Compiles all Python server modules.
3. Verifies every required JavaScript module exists.
4. Runs JavaScript syntax checks when Node.js is available.
5. Builds the PyInstaller onedir application.
6. Confirms all required JavaScript files were packaged.
7. Runs `PlanTakeoff.exe --self-test` against the bundled local server and settings API.
8. Creates the desktop shortcut only after verification succeeds.

A package that fails the standalone self-test is explicitly marked as not ready to ship. Self-test details are written to:

```text
dist\PlanTakeoff\PlanTakeoff-self-test.log
```

## Source layout

```text
plan-takeoff/
  desktop_app.py
  server.py
  job_server.py
  daily_log_server.py
  client_update_server.py
  suite_server.py
  index.html
  css/
  js/
  vendor/pdfjs/
  extensions/
  plan_takeoff.spec
  build_desktop.bat
  Launch PlanTakeoff.bat
  dist/PlanTakeoff/
```

## Operational notes

- The system is offline-first, but AI scope tools may use the separately configured local Grok CLI or xAI API fallback.
- Client Updates are generated only; PlanTakeoff does not send email or text messages.
- Local/network photo paths remain references. Selected Daily Log images are saved only as compressed thumbnails.
- The existing EST folder remains the authoritative job container.
