/**
 * BuilderTrend + OST Hybrid Suites
 * Multi-phase project templates for full residential/commercial construction workflows
 * 
 * Each suite includes:
 * - 6 phases (Foundation → MEP Final)
 * - Conditions per phase
 * - Tasks with dependencies
 * - Worksheet lines (equipment, supplies, mobilization)
 * - Budget templates
 */

const M = () => window.PTModels;
const E = () => window.PTModelsExtended;
const uid = () => M().uid ? M().uid() : `id_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

// Shorthand constructors
const cond = (style, name, opts) => M().createCondition(style, { name, ...opts });
const layer = (name, color) => ({ id: uid(), name, visible: true, color });
const A = (desc, opts) => M().createAssemblyLine({ description: desc, ...opts });
const ws = (code, desc, qty, unit, costs) => M().createWorksheetLine({ code, description: desc, quantity: qty, unit, ...costs });
const task = (title, opts) => ({ title, durationDays: 1, priority: 'Medium', status: 'Open', ...opts });
const phase = (num, name, short, desc, days, budget, opts) => ({
  number: num,
  name,
  short,
  description: desc,
  durationDays: days,
  budget,
  ...opts,
});

const HYBRID_SUITES = {
  residential_full_build: {
    id: 'residential_full_build',
    name: 'Residential Full Build (Multi-Phase)',
    short: 'Res. Build',
    blurb: 'Complete residential construction: excavation → framing → exterior → MEP → finishes. 6 phases, task tracking, budget alerts, client portal ready.',
    icon: '🏗️',
    isMultiPhase: true,

    phases: [
      phase(1, 'Excavation & Foundation', 'Foundation', 'Site prep, excavation, foundation concrete, backfill.', 10, {
        material: 18000,
        labor: 12000,
        equipment: 6000,
        other: 2000,
        contingencyPct: 0.08,
      }, {
        id: 'ph_foundation',
        layers: [
          layer('Excavation', '#d35400'),
          layer('Foundation', '#8b7355'),
          layer('Backfill', '#795548'),
        ],
        conditions: (L) => [
          cond('count', 'Demolition / site prep', {
            type: 'Earthwork',
            color: '#d35400',
            layerId: L[0].id,
            notes: 'Remove existing structures, clear site.',
            assemblies: [
              A('Demolition labor + hauling', { qtyMode: 'fixed', laborUnitCost: 2500 }),
              A('Site clearing & grubbing', { qtyMode: 'fixed', laborUnitCost: 1200 }),
            ],
          }),
          cond('count', 'Excavation (CY)', {
            type: 'Earthwork',
            color: '#d35400',
            layerId: L[0].id,
            notes: 'Total excavation volume; measured per site survey.',
            assemblies: [
              A('Excavator daily rental + operator', { qtyMode: 'count', laborUnitCost: 850 }),
              A('Site haul/dump (per CY)', { qtyMode: 'count', materialUnitCost: 8, laborUnitCost: 12 }),
            ],
          }),
          cond('area', 'Foundation concrete (SF)', {
            type: 'Concrete',
            color: '#8b7355',
            layerId: L[1].id,
            notes: '4" slab or strip footing per plan.',
            assemblies: [
              A('Prep & forming', { qtyMode: 'same', materialUnitCost: 0.5, laborUnitCost: 0.8 }),
              A('Concrete (4")', { qtyMode: 'same', materialUnitCost: 3.2, laborUnitCost: 0.6 }),
              A('Finish / broom', { qtyMode: 'same', laborUnitCost: 0.25 }),
            ],
          }),
          cond('count', 'Backfill (CY)', {
            type: 'Earthwork',
            color: '#795548',
            layerId: L[2].id,
            assemblies: [
              A('Backfill material (per CY)', { qtyMode: 'count', materialUnitCost: 12, laborUnitCost: 18 }),
              A('Compact / grade', { qtyMode: 'count', laborUnitCost: 8 }),
            ],
          }),
        ],
        worksheet: [
          ws('EX-100', 'Excavator rental (per day)', 4, 'day', { equipment: 950 }),
          ws('EX-110', 'Site haul truck (per load)', 8, 'load', { material: 45, labor: 60 }),
          ws('EX-120', 'Concrete pump (if needed)', 1, 'LS', { equipment: 1200, labor: 300 }),
          ws('EX-130', 'Survey & staking', 1, 'LS', { labor: 850 }),
        ],
        tasks: [
          task('Obtain permits', { priority: 'High', durationDays: 3 }),
          task('Site survey & staking', { priority: 'High', durationDays: 1 }),
          task('Call 811 (utility locate)', { priority: 'High', durationDays: 1 }),
          task('Excavation & grading', { priority: 'High', durationDays: 3, sequenceAfter: 'Site survey & staking' }),
          task('Foundation inspection', { priority: 'Medium', durationDays: 1, sequenceAfter: 'Excavation & grading' }),
          task('Concrete pour', { priority: 'High', durationDays: 1, sequenceAfter: 'Foundation inspection' }),
          task('Cure time (7 days min)', { priority: 'Medium', durationDays: 7, sequenceAfter: 'Concrete pour' }),
          task('Backfill & grade', { priority: 'Medium', durationDays: 1, sequenceAfter: 'Cure time (7 days min)' }),
        ],
      }),

      phase(2, 'Framing', 'Framing', 'Floor joists, walls, roof trusses, sheathing.', 14, {
        material: 28000,
        labor: 18000,
        equipment: 3000,
        other: 1500,
        contingencyPct: 0.1,
      }, {
        id: 'ph_framing',
        layers: [
          layer('Floor system', '#d2691e'),
          layer('Wall framing', '#8b4513'),
          layer('Roof structure', '#654321'),
          layer('Sheathing', '#a0522d'),
        ],
        conditions: (L) => [
          cond('area', 'Floor sheathing (SF)', {
            type: 'Wood',
            color: '#d2691e',
            layerId: L[0].id,
            assemblies: [
              A('Joists + headers (structural)', { qtyMode: 'same', materialUnitCost: 0.8, laborUnitCost: 0.4 }),
              A('Bridging / blocking', { qtyMode: 'same', materialUnitCost: 0.2, laborUnitCost: 0.25 }),
              A('Subfloor sheathing (3/4")', { qtyMode: 'same', materialUnitCost: 0.6, laborUnitCost: 0.3 }),
            ],
          }),
          cond('linear', 'Wall framing (LF)', {
            type: 'Wood',
            color: '#8b4513',
            height: 8,
            layerId: L[1].id,
            notes: '2×4 @ 16" on center, standard framing.',
            assemblies: [
              A('Stud + plates (per LF)', { qtyMode: 'length', materialUnitCost: 0.85, laborUnitCost: 0.5 }),
              A('Bracing / blocking', { qtyMode: 'same', materialUnitCost: 0.15, laborUnitCost: 0.2 }),
              A('Sheathing (1/2" OSB)', { qtyMode: 'surface', materialUnitCost: 0.35, laborUnitCost: 0.25 }),
            ],
          }),
          cond('count', 'Roof trusses (EA)', {
            type: 'Wood',
            color: '#654321',
            layerId: L[2].id,
            assemblies: [
              A('Truss + fasteners per ea', { qtyMode: 'same', materialUnitCost: 180, laborUnitCost: 120 }),
            ],
          }),
          cond('area', 'Roof sheathing (SF)', {
            type: 'Wood',
            color: '#a0522d',
            layerId: L[3].id,
            assemblies: [
              A('CDX plywood (1/2")', { qtyMode: 'same', materialUnitCost: 0.55, laborUnitCost: 0.3 }),
              A('Fasteners & felt', { qtyMode: 'same', materialUnitCost: 0.1, laborUnitCost: 0.15 }),
            ],
          }),
        ],
        worksheet: [
          ws('FR-100', 'Lumber package (frame + blocking)', 1, 'LS', { material: 14000 }),
          ws('FR-110', 'Sheathing (OSB, plywood)', 1, 'LS', { material: 5500 }),
          ws('FR-120', 'Fasteners (nails, screws, joist hangers)', 1, 'LS', { material: 1200 }),
          ws('FR-130', 'Framing crew (labor)', 14, 'day', { labor: 2400 }),
          ws('FR-140', 'Scaffold / lift rental', 1, 'LS', { equipment: 2800, labor: 400 }),
        ],
        tasks: [
          task('Foundation inspection sign-off', { priority: 'High', durationDays: 1 }),
          task('Lumber delivery', { priority: 'High', durationDays: 1 }),
          task('Floor framing', { priority: 'High', durationDays: 3, sequenceAfter: 'Lumber delivery' }),
          task('Wall framing & bracing', { priority: 'High', durationDays: 4, sequenceAfter: 'Floor framing' }),
          task('Roof truss installation', { priority: 'High', durationDays: 2, sequenceAfter: 'Wall framing & bracing' }),
          task('Sheathing (walls, roof)', { priority: 'High', durationDays: 3, sequenceAfter: 'Roof truss installation' }),
          task('Framing inspection', { priority: 'Medium', durationDays: 1, sequenceAfter: 'Sheathing (walls, roof)' }),
        ],
      }),

      phase(3, 'Exterior Envelope', 'Exterior', 'Roofing, siding, doors, windows, exterior trim.', 18, {
        material: 35000,
        labor: 15000,
        equipment: 2000,
        other: 1000,
        contingencyPct: 0.08,
      }, {
        id: 'ph_exterior',
        layers: [
          layer('Roofing', '#2c2c2c'),
          layer('Siding', '#8b8b7a'),
          layer('Doors / Windows', '#d4a574'),
          layer('Trim / Flashing', '#a9a9a9'),
        ],
        conditions: (L) => [
          cond('area', 'Roofing (SF)', {
            type: 'Finishes',
            color: '#2c2c2c',
            layerId: L[0].id,
            notes: 'Asphalt shingles or equivalent; measured SF of roof plane.',
            assemblies: [
              A('Underlayment / ice & water', { qtyMode: 'same', materialUnitCost: 0.15, laborUnitCost: 0.15 }),
              A('Shingles (asphalt 30-yr)', { qtyMode: 'same', materialUnitCost: 0.28, laborUnitCost: 0.35 }),
              A('Ridge, flashing, fasteners', { qtyMode: 'same', materialUnitCost: 0.08, laborUnitCost: 0.2 }),
            ],
          }),
          cond('area', 'Siding (SF)', {
            type: 'Finishes',
            color: '#8b8b7a',
            layerId: L[1].id,
            notes: 'Fiber cement or vinyl siding; includes flashing & trim around openings.',
            assemblies: [
              A('House wrap / WRB', { qtyMode: 'same', materialUnitCost: 0.12, laborUnitCost: 0.15 }),
              A('Siding material', { qtyMode: 'same', materialUnitCost: 1.2, laborUnitCost: 0.4 }),
              A('Trim, J-channel, closure', { qtyMode: 'same', materialUnitCost: 0.35, laborUnitCost: 0.25 }),
            ],
          }),
          cond('count', 'Doors & windows (EA)', {
            type: 'Doors & Windows',
            color: '#d4a574',
            layerId: L[2].id,
            notes: 'Each = one opening installed (frame, flashing, caulk).',
            assemblies: [
              A('Unit + frame + trim', { qtyMode: 'same', materialUnitCost: 450, laborUnitCost: 180 }),
              A('Flashing, caulk, weatherseal', { qtyMode: 'same', materialUnitCost: 45, laborUnitCost: 60 }),
            ],
          }),
          cond('linear', 'Fascia / soffit (LF)', {
            type: 'Finishes',
            color: '#a9a9a9',
            height: 1,
            layerId: L[3].id,
            assemblies: [
              A('Fascia board + gutter (per LF)', { qtyMode: 'length', materialUnitCost: 8, laborUnitCost: 12 }),
              A('Soffit vents (per LF)', { qtyMode: 'length', materialUnitCost: 3.5, laborUnitCost: 8 }),
            ],
          }),
        ],
        worksheet: [
          ws('EX-100', 'Roofing material package', 1, 'LS', { material: 12500 }),
          ws('EX-110', 'Siding material package', 1, 'LS', { material: 14000 }),
          ws('EX-120', 'Windows & doors (supply)', 8, 'unit', { material: 3600 }),
          ws('EX-130', 'Scaffolding rental', 1, 'LS', { equipment: 1800, labor: 300 }),
          ws('EX-140', 'Exterior labor (roofing, siding, trim)', 18, 'day', { labor: 12600 }),
        ],
        tasks: [
          task('Framing inspection sign-off', { priority: 'High', durationDays: 1 }),
          task('Roof decking inspection', { priority: 'Medium', durationDays: 1 }),
          task('Roofing installation', { priority: 'High', durationDays: 4, sequenceAfter: 'Roof decking inspection' }),
          task('House wrap & weatherization', { priority: 'High', durationDays: 2, sequenceAfter: 'Roofing installation' }),
          task('Windows & doors (supply & install)', { priority: 'High', durationDays: 3, sequenceAfter: 'House wrap & weatherization' }),
          task('Siding installation', { priority: 'High', durationDays: 5, sequenceAfter: 'Windows & doors (supply & install)' }),
          task('Fascia, soffit, gutter', { priority: 'Medium', durationDays: 2, sequenceAfter: 'Siding installation' }),
          task('Weathertight inspection', { priority: 'Medium', durationDays: 1, sequenceAfter: 'Fascia, soffit, gutter' }),
        ],
      }),

      phase(4, 'MEP Rough-In', 'MEP Rough', 'Electrical, plumbing, HVAC rough-in before walls close.', 12, {
        material: 22000,
        labor: 16000,
        equipment: 1500,
        other: 800,
        contingencyPct: 0.12,
      }, {
        id: 'ph_mep_rough',
        layers: [
          layer('Electrical', '#ffff00'),
          layer('Plumbing', '#0099ff'),
          layer('HVAC', '#ff6600'),
        ],
        conditions: (L) => [
          cond('count', 'Electrical circuits (EA)', {
            type: 'Electrical',
            color: '#ffff00',
            layerId: L[0].id,
            notes: 'Each circuit = breaker + wiring to outlets/switches.',
            assemblies: [
              A('Romex cable per circuit', { qtyMode: 'count', materialUnitCost: 35, laborUnitCost: 45 }),
              A('Outlets, switches, trim', { qtyMode: 'count', materialUnitCost: 25, laborUnitCost: 30 }),
            ],
          }),
          cond('count', 'Plumbing fixtures (EA)', {
            type: 'Plumbing',
            color: '#0099ff',
            layerId: L[1].id,
            notes: 'Sink, toilet, shower/tub, water heater connection.',
            assemblies: [
              A('Supply lines (hot/cold)', { qtyMode: 'count', materialUnitCost: 45, laborUnitCost: 60 }),
              A('Drain rough-in', { qtyMode: 'count', materialUnitCost: 55, laborUnitCost: 75 }),
              A('Vent stack', { qtyMode: 'count', materialUnitCost: 30, laborUnitCost: 40 }),
            ],
          }),
          cond('linear', 'HVAC ductwork (LF)', {
            type: 'HVAC',
            color: '#ff6600',
            height: 0,
            layerId: L[2].id,
            notes: 'Return/supply ducts to all rooms.',
            assemblies: [
              A('Ductwork (sheet metal or flex per LF)', { qtyMode: 'length', materialUnitCost: 12, laborUnitCost: 18 }),
              A('Registers & grilles (per 100 LF)', { qtyMode: 'count', materialUnitCost: 75, laborUnitCost: 50 }),
            ],
          }),
        ],
        worksheet: [
          ws('ME-100', 'Electrical panel + breakers', 1, 'LS', { material: 1500, labor: 400 }),
          ws('ME-110', 'Water heater + install', 1, 'LS', { material: 1800, labor: 500 }),
          ws('ME-120', 'HVAC unit (furnace/AC)', 1, 'LS', { material: 3200, labor: 600 }),
          ws('ME-130', 'Gas line (if applicable)', 1, 'LS', { material: 800, labor: 300 }),
          ws('ME-140', 'Inspections (electrical, plumbing, HVAC)', 3, 'EA', { labor: 300 }),
        ],
        tasks: [
          task('Weathertight inspection sign-off', { priority: 'High', durationDays: 1 }),
          task('Electrical rough layout review', { priority: 'High', durationDays: 1 }),
          task('Electrical rough-in (wiring, outlets)', { priority: 'High', durationDays: 3, sequenceAfter: 'Electrical rough layout review' }),
          task('Plumbing rough-in (supply, drain)', { priority: 'High', durationDays: 3, sequenceAfter: 'Electrical rough-in' }),
          task('HVAC ductwork & unit install', { priority: 'High', durationDays: 3, sequenceAfter: 'Plumbing rough-in' }),
          task('Rough-in inspections (all 3 trades)', { priority: 'High', durationDays: 1, sequenceAfter: 'HVAC ductwork & unit install' }),
          task('Gas line (if needed)', { priority: 'Medium', durationDays: 1 }),
        ],
      }),

      phase(5, 'Interior Finishes', 'Finishes', 'Drywall, insulation, flooring, paint, trim, cabinetry.', 28, {
        material: 38000,
        labor: 22000,
        equipment: 2000,
        other: 1200,
        contingencyPct: 0.1,
      }, {
        id: 'ph_finishes',
        layers: [
          layer('Drywall', '#e8e8e8'),
          layer('Insulation', '#ffffcc'),
          layer('Painting', '#f0f0f0'),
          layer('Flooring', '#8b6914'),
          layer('Cabinetry', '#8b4513'),
          layer('Trim', '#d2b48c'),
        ],
        conditions: (L) => [
          cond('area', 'Drywall (SF)', {
            type: 'Finishes',
            color: '#e8e8e8',
            layerId: L[0].id,
            notes: '5/8" fire-rated or standard; includes tape & joint compound.',
            assemblies: [
              A('Drywall sheets', { qtyMode: 'same', materialUnitCost: 0.12, laborUnitCost: 0.2 }),
              A('Taping, mudding, sanding (finish)', { qtyMode: 'same', materialUnitCost: 0.08, laborUnitCost: 0.8 }),
            ],
          }),
          cond('area', 'Insulation (SF)', {
            type: 'Thermal & Moisture',
            color: '#ffffcc',
            layerId: L[1].id,
            notes: 'R-19 or R-21 fiberglass batt; walls & ceilings.',
            assemblies: [
              A('Insulation batts (R-19/21)', { qtyMode: 'same', materialUnitCost: 0.22, laborUnitCost: 0.18 }),
            ],
          }),
          cond('area', 'Interior paint (SF)', {
            type: 'Finishes',
            color: '#f0f0f0',
            layerId: L[2].id,
            notes: 'Primer + 2 coats interior latex.',
            assemblies: [
              A('Prep & primer', { qtyMode: 'same', materialUnitCost: 0.15, laborUnitCost: 0.25 }),
              A('Finish paint (2 coats)', { qtyMode: 'same', factor: 2, materialUnitCost: 0.2, laborUnitCost: 0.4 }),
            ],
          }),
          cond('area', 'Flooring (SF)', {
            type: 'Finishes',
            color: '#8b6914',
            layerId: L[3].id,
            notes: 'Hardwood, laminate, or vinyl plank; installed.',
            assemblies: [
              A('Subfloor prep', { qtyMode: 'same', materialUnitCost: 0.1, laborUnitCost: 0.15 }),
              A('Flooring material & install', { qtyMode: 'same', materialUnitCost: 2.5, laborUnitCost: 0.6 }),
              A('Trim / transition molding', { qtyMode: 'same', materialUnitCost: 0.3, laborUnitCost: 0.25 }),
            ],
          }),
          cond('linear', 'Cabinetry (LF)', {
            type: 'Furnishings',
            color: '#8b4513',
            height: 0,
            layerId: L[4].id,
            notes: 'Kitchen or bathroom cabinets, including countertop.',
            assemblies: [
              A('Cabinet boxes & doors', { qtyMode: 'length', materialUnitCost: 75, laborUnitCost: 40 }),
              A('Countertop (per LF)', { qtyMode: 'length', materialUnitCost: 45, laborUnitCost: 30 }),
              A('Hardware, backsplash', { qtyMode: 'length', materialUnitCost: 15, laborUnitCost: 15 }),
            ],
          }),
          cond('linear', 'Finish trim & molding (LF)', {
            type: 'Finishes',
            color: '#d2b48c',
            height: 0,
            layerId: L[5].id,
            notes: 'Baseboards, door casings, crown (where specified).',
            assemblies: [
              A('Trim lumber + fasteners', { qtyMode: 'length', materialUnitCost: 0.85, laborUnitCost: 0.4 }),
              A('Caulk & finish paint', { qtyMode: 'length', materialUnitCost: 0.15, laborUnitCost: 0.3 }),
            ],
          }),
        ],
        worksheet: [
          ws('FI-100', 'Drywall package (sheets, compound, tape)', 1, 'LS', { material: 8000 }),
          ws('FI-110', 'Insulation batts', 1, 'LS', { material: 3500 }),
          ws('FI-120', 'Paint (interior)', 1, 'LS', { material: 2000 }),
          ws('FI-130', 'Flooring material (per SF basis)', 1, 'LS', { material: 12000 }),
          ws('FI-140', 'Cabinetry package', 1, 'LS', { material: 9000 }),
          ws('FI-150', 'Trim & molding lumber', 1, 'LS', { material: 2000 }),
          ws('FI-160', 'Interior labor (drywall, paint, install)', 28, 'day', { labor: 18200 }),
          ws('FI-170', 'Equipment (scaffolds, lifts)', 1, 'LS', { equipment: 2000 }),
        ],
        tasks: [
          task('MEP rough inspections sign-off', { priority: 'High', durationDays: 1 }),
          task('Insulation & air sealing', { priority: 'High', durationDays: 3 }),
          task('Drywall hanging', { priority: 'High', durationDays: 4, sequenceAfter: 'Insulation & air sealing' }),
          task('Drywall finishing (taping/mudding)', { priority: 'High', durationDays: 5, sequenceAfter: 'Drywall hanging' }),
          task('Interior paint', { priority: 'High', durationDays: 4, sequenceAfter: 'Drywall finishing' }),
          task('Flooring installation', { priority: 'High', durationDays: 5, sequenceAfter: 'Interior paint' }),
          task('Cabinetry & countertops', { priority: 'High', durationDays: 3, sequenceAfter: 'Flooring installation' }),
          task('Trim & molding installation', { priority: 'Medium', durationDays: 3, sequenceAfter: 'Cabinetry & countertops' }),
          task('Lighting & outlets (MEP final)', { priority: 'Medium', durationDays: 2 }),
        ],
      }),

      phase(6, 'MEP Final & Systems', 'MEP Final', 'Electrical fixtures, plumbing fixtures, HVAC testing, final inspections.', 7, {
        material: 5000,
        labor: 6000,
        equipment: 500,
        other: 300,
        contingencyPct: 0.1,
      }, {
        id: 'ph_mep_final',
        layers: [
          layer('Electrical final', '#ffff00'),
          layer('Plumbing final', '#0099ff'),
          layer('HVAC final', '#ff6600'),
        ],
        conditions: (L) => [
          cond('count', 'Electrical fixtures & final (EA)', {
            type: 'Electrical',
            color: '#ffff00',
            layerId: L[0].id,
            notes: 'Light fixtures, ceiling fans, final connections.',
            assemblies: [
              A('Fixtures & install', { qtyMode: 'count', materialUnitCost: 35, laborUnitCost: 45 }),
              A('Final testing & trim', { qtyMode: 'count', laborUnitCost: 20 }),
            ],
          }),
          cond('count', 'Plumbing fixtures & final (EA)', {
            type: 'Plumbing',
            color: '#0099ff',
            layerId: L[1].id,
            notes: 'Faucets, toilet, showerhead, final connections.',
            assemblies: [
              A('Fixture trim & install', { qtyMode: 'count', materialUnitCost: 65, laborUnitCost: 50 }),
              A('Pressure test & final', { qtyMode: 'count', laborUnitCost: 30 }),
            ],
          }),
          cond('count', 'HVAC system test & final (EA)', {
            type: 'HVAC',
            color: '#ff6600',
            layerId: L[2].id,
            notes: 'System startup, duct sealing, filter install, training.',
            assemblies: [
              A('System startup & commissioning', { qtyMode: 'fixed', materialUnitCost: 200, laborUnitCost: 500 }),
              A('Duct sealing & filter install', { qtyMode: 'fixed', materialUnitCost: 150, laborUnitCost: 200 }),
            ],
          }),
        ],
        worksheet: [
          ws('MF-100', 'Final inspections (all 3 trades)', 3, 'EA', { labor: 450 }),
          ws('MF-110', 'Utilities final (meter/service connection)', 1, 'LS', { labor: 800 }),
          ws('MF-120', 'Certificate of occupancy / final walk', 1, 'LS', { labor: 500 }),
        ],
        tasks: [
          task('Trim finishes inspection', { priority: 'High', durationDays: 1 }),
          task('Electrical final fixtures & testing', { priority: 'High', durationDays: 2 }),
          task('Plumbing fixtures & testing', { priority: 'High', durationDays: 2 }),
          task('HVAC startup & commissioning', { priority: 'High', durationDays: 1 }),
          task('Final inspections (all trades + building dept)', { priority: 'High', durationDays: 1, sequenceAfter: 'HVAC startup & commissioning' }),
          task('Certificate of occupancy', { priority: 'High', durationDays: 1, sequenceAfter: 'Final inspections (all trades + building dept)' }),
          task('Homeowner walk-through & training', { priority: 'Medium', durationDays: 1, sequenceAfter: 'Certificate of occupancy' }),
        ],
      }),
    ],

    phaseDependencies: [
      { from: 'ph_foundation', to: 'ph_framing', minDays: 7, description: 'Concrete cure minimum' },
      { from: 'ph_framing', to: 'ph_exterior', minDays: 0, description: 'Exterior after framing sheathed' },
      { from: 'ph_exterior', to: 'ph_mep_rough', minDays: 0, description: 'MEP rough after weathertight' },
      { from: 'ph_mep_rough', to: 'ph_finishes', minDays: 0, description: 'Finishes after rough inspections' },
      { from: 'ph_finishes', to: 'ph_mep_final', minDays: 0, description: 'MEP final after drywall/paint' },
    ],
  },
};

/**
 * Apply multi-phase suite to a project
 */
function applyMultiPhaseSuite(project, suiteId, opts = {}) {
  const suite = HYBRID_SUITES[suiteId];
  if (!suite || !suite.isMultiPhase) throw new Error('Not a multi-phase suite: ' + suiteId);

  project.isMultiPhase = true;
  project.phases = [];
  project.phaseConditionMap = {};
  project.phaseTasks = {};
  project.phaseDependencies = suite.phaseDependencies || [];

  for (const phaseDef of suite.phases) {
    // Create layers for this phase
    const layers = phaseDef.layers.map((l) => ({ ...l, id: uid() }));

    // Create conditions
    const conditions = (phaseDef.conditions || []).map((c, idx) => ({
      ...c,
      number: (phaseDef.number * 100) + idx + 1,
      layerId: c.layerId ? layers.find(l => l.name === phaseDef.layers.find(pl => pl.id === c.layerId)?.name)?.id : layers[0]?.id,
      phaseId: phaseDef.id,
    }));

    // Create worksheet
    const worksheet = (phaseDef.worksheet || []).map(w => ({
      ...M().createWorksheetLine(w),
      phaseId: phaseDef.id,
    }));

    // Create phase object
    const phaseObj = E().createPhase({
      id: phaseDef.id,
      number: phaseDef.number,
      name: phaseDef.name,
      short: phaseDef.short,
      description: phaseDef.description,
      durationDays: phaseDef.durationDays,
      budget: phaseDef.budget,
      conditionIds: conditions.map(c => c.id),
      worksheetIds: worksheet.map(w => w.id),
      layerIds: layers.map(l => l.id),
    });

    // Create tasks
    const tasks = (phaseDef.tasks || []).map(t => E().createTask({
      ...t,
      phaseId: phaseDef.id,
    }));

    phaseObj.taskIds = tasks.map(t => t.id);

    // Add to project
    project.phases.push(phaseObj);
    project.phaseConditionMap[phaseDef.id] = conditions.map(c => c.id);
    project.phaseTasks[phaseDef.id] = tasks;
    project.conditions.push(...conditions);
    project.worksheet.push(...worksheet);
    project.layers.push(...layers);
  }

  project.cover.company = project.cover.company || 'WL Painting Inc.';
  project.cover.bidType = 'Multi-Phase Build';

  return {
    suiteId: suite.id,
    phaseCount: project.phases.length,
    conditionCount: project.conditions.length,
    worksheetCount: project.worksheet.length,
  };
}

/**
 * List available multi-phase suites
 */
function listMultiPhaseSuites() {
  return Object.values(HYBRID_SUITES).map(s => ({
    id: s.id,
    name: s.name,
    short: s.short,
    blurb: s.blurb,
    icon: s.icon,
    isMultiPhase: true,
    phaseCount: s.phases.length,
  }));
}

// Export to window
window.PTHybridSuites = {
  HYBRID_SUITES,
  applyMultiPhaseSuite,
  listMultiPhaseSuites,
};
