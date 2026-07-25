/**
 * WL Painting — preloaded contractor suites (assemblies + conditions + gear).
 * Built around real estimator workflow: digitize → assemblies on Estimate → WL scope.
 */
(function () {
  const M = () => window.PTModels;

  function A(desc, opts = {}) {
    return M().createAssemblyLine({
      description: desc,
      qtyMode: opts.qtyMode || 'same',
      factor: opts.factor != null ? opts.factor : 1,
      unit: opts.unit || '',
      materialUnitCost: opts.mat != null ? opts.mat : 0,
      laborUnitCost: opts.lab != null ? opts.lab : 0,
    });
  }

  function cond(style, name, opts = {}) {
    return M().createCondition(style, {
      name,
      type: opts.type || 'Finishes',
      color: opts.color || '#3498db',
      height: opts.height != null ? opts.height : style === 'linear' ? 8 : 0,
      fillPattern: opts.fillPattern || (style === 'area' ? 'solid' : 'solid'),
      fillOpacity: opts.fillOpacity != null ? opts.fillOpacity : 0.2,
      materialUnitCost: opts.mat || 0,
      laborUnitCost: opts.lab || 0,
      notes: opts.notes || '',
      roomRole: opts.roomRole || null,
      assemblies: opts.assemblies || [],
      ...opts.extra,
    });
  }

  function ws(code, description, qty, unit, costs = {}) {
    return M().createWorksheetLine({
      code,
      description,
      quantity: qty,
      unit,
      material: costs.mat || 0,
      labor: costs.lab || 0,
      equipment: costs.eq || 0,
      other: costs.other || 0,
    });
  }

  function layer(name, color) {
    return M().createLayer({ name, color, visible: true });
  }

  /**
   * Suite definitions — complete painting contractor kits.
   */
  const SUITES = {
    office_upgrade: {
      id: 'office_upgrade',
      name: 'Office upgrade / TI',
      short: 'Office / TI',
      blurb:
        'Commercial interior fit-out: field walls, accent walls, ceilings, doors/frames, base, wallcovering, wet-area specialty coatings. Primer + 2 finish coats on paint systems.',
      icon: '🏢',
      layers: [
        layer('Paint - Field', '#e74c3c'),
        layer('Paint - Accents', '#9b59b6'),
        layer('Ceilings', '#3498db'),
        layer('Doors & Frames', '#f39c12'),
        layer('Trim / Base', '#8e44ad'),
        layer('Wallcovering', '#1abc9c'),
        layer('Specialty coatings', '#e67e22'),
        layer('Openings / Deductions', '#95a5a6'),
      ],
      roomPackage: {
        wallHeight: 9,
        ceiling: true,
        floor: false,
        walls: true,
        base: true,
        crown: false,
        chairRail: false,
        wainscot: false,
        wainscotHeight: 3.5,
        doorOpenings: true,
        windowOpenings: true,
      },
      conditions: (L) => [
        cond('linear', 'P-1 Field walls (eggshell)', {
          type: 'Finishes',
          color: '#e74c3c',
          height: 9,
          layerId: L[0].id,
          roomRole: 'walls',
          notes: 'GWB field walls per finish plan; eggshell typical office.',
          assemblies: [
            A('Surface prep / patch / sand (paint-grade)', { qtyMode: 'surface', mat: 0.05, lab: 0.35 }),
            A('PVA / primer (1 coat)', { qtyMode: 'surface', mat: 0.18, lab: 0.28 }),
            A('Finish eggshell (2 coats)', { qtyMode: 'surface', factor: 2, mat: 0.32, lab: 0.4 }),
            A('Cut-in / detail labor', { qtyMode: 'length', mat: 0, lab: 0.15 }),
          ],
        }),
        cond('linear', 'P-Accent feature walls', {
          type: 'Finishes',
          color: '#9b59b6',
          height: 9,
          layerId: L[1].id,
          notes: 'Brand/accent walls — different sheen or color; often 1–2 walls per room.',
          assemblies: [
            A('Prep for accent (mask + cut edges)', { qtyMode: 'surface', mat: 0.04, lab: 0.45 }),
            A('Primer / sealer if color change', { qtyMode: 'surface', mat: 0.2, lab: 0.3 }),
            A('Accent finish (2 coats)', { qtyMode: 'surface', factor: 2, mat: 0.38, lab: 0.45 }),
          ],
        }),
        cond('area', 'P-2 Ceilings (flat)', {
          type: 'Finishes',
          color: '#3498db',
          layerId: L[2].id,
          roomRole: 'ceiling',
          notes: 'GWB ceilings + bulkhead faces when scheduled flat.',
          assemblies: [
            A('Ceiling prep', { qtyMode: 'same', mat: 0.04, lab: 0.25 }),
            A('Primer', { qtyMode: 'same', mat: 0.16, lab: 0.22 }),
            A('Flat finish (2 coats)', { qtyMode: 'same', factor: 2, mat: 0.28, lab: 0.35 }),
          ],
        }),
        cond('area', 'P-3 Open / exposed structure (flat)', {
          type: 'Finishes',
          color: '#2980b9',
          layerId: L[2].id,
          notes: 'Open ceiling / deck / structure where no GWB ceiling (per RCP).',
          fillPattern: 'hatch',
          assemblies: [
            A('Mask & protect below', { qtyMode: 'same', mat: 0.08, lab: 0.4 }),
            A('Primer / sealer on structure', { qtyMode: 'same', mat: 0.22, lab: 0.35 }),
            A('Flat finish spray/roll (2 coats)', { qtyMode: 'same', factor: 2, mat: 0.3, lab: 0.5 }),
          ],
        }),
        cond('count', 'Doors & HM frames (semi-gloss)', {
          type: 'Doors & Windows',
          color: '#f39c12',
          layerId: L[3].id,
          notes: 'Each = one leaf + frame typical; adjust if frame-only.',
          assemblies: [
            A('Sand / degloss / prep', { qtyMode: 'same', mat: 1.5, lab: 18 }),
            A('Primer (bare metal / stain-block)', { qtyMode: 'same', mat: 4, lab: 12 }),
            A('Semi-gloss enamel (2 coats)', { qtyMode: 'same', factor: 2, mat: 6, lab: 22 }),
          ],
        }),
        cond('linear', 'Base / shoe (semi-gloss)', {
          type: 'Finishes',
          color: '#8e44ad',
          height: 0.33,
          layerId: L[4].id,
          roomRole: 'base',
          assemblies: [
            A('Caulk & prep base', { qtyMode: 'same', mat: 0.08, lab: 0.55 }),
            A('Semi-gloss (2 coats)', { qtyMode: 'same', factor: 2, mat: 0.12, lab: 0.65 }),
          ],
        }),
        cond('area', 'WC-1 Wallcovering', {
          type: 'Finishes',
          color: '#1abc9c',
          layerId: L[5].id,
          notes: 'Install WC per finish schedule; exclude vinyl base unless noted.',
          fillPattern: 'diamond',
          assemblies: [
            A('Wall prep for WC (size / skim as allowed)', { qtyMode: 'same', mat: 0.15, lab: 0.55 }),
            A('Adhesive + install wallcovering', { qtyMode: 'same', mat: 2.75, lab: 2.1 }),
            A('Trim / seams / clean-up', { qtyMode: 'same', mat: 0.1, lab: 0.35 }),
          ],
        }),
        cond('area', 'Specialty coating — wet/restroom (satin/epoxy)', {
          type: 'Finishes',
          color: '#e67e22',
          layerId: L[6].id,
          notes: 'Restrooms / wet walls above tile or scheduled specialty system.',
          fillPattern: 'crosshatch',
          assemblies: [
            A('Degrease / prep wet area', { qtyMode: 'same', mat: 0.12, lab: 0.55 }),
            A('Specialty primer / bonding', { qtyMode: 'same', mat: 0.45, lab: 0.4 }),
            A('Satin or epoxy finish (2 coats)', { qtyMode: 'same', factor: 2, mat: 0.65, lab: 0.55 }),
          ],
        }),
        cond('area', 'Opening deduction (doors/windows)', {
          type: 'Doors & Windows',
          color: '#95a5a6',
          layerId: L[7].id,
          roomRole: 'opening',
          fillPattern: 'hatch',
          notes: 'Use Deduct tool — subtracts from parent wall/area SF.',
          assemblies: [],
        }),
        cond('count', 'Columns / FCU / misc metal (paint)', {
          type: 'Specialties',
          color: '#c0392b',
          layerId: L[6].id,
          notes: 'Exposed columns, fan coils, misc metals called to paint.',
          assemblies: [
            A('Prep metal / mask', { qtyMode: 'same', mat: 2, lab: 25 }),
            A('Primer + 2 finish coats', { qtyMode: 'same', mat: 12, lab: 45 }),
          ],
        }),
      ],
      worksheet: [
        ws('01-100', 'Mobilization / site setup (office TI)', 1, 'LS', { lab: 450, eq: 150, other: 75 }),
        ws('01-200', 'Protection stock (plastic, tape, paper, ram board)', 1, 'LS', { mat: 275, lab: 180 }),
        ws('01-300', 'Daily clean-up / trash haul allowance', 1, 'LS', { lab: 350, other: 120 }),
        ws('01-400', 'Lift / baker / scaffold (if open lobby or high walls)', 1, 'LS', { eq: 650, lab: 200 }),
      ],
      scopeNotes:
        'Office / TI interior. Field walls eggshell, ceilings flat, doors/frames semi-gloss, base semi-gloss. Accent walls per elevations. Wallcovering only where scheduled. Specialty wet-area coating in restrooms if tagged. Regular hours; coordinate with flooring sequence.',
    },

    residential_exterior: {
      id: 'residential_exterior',
      name: 'Residential exterior painting',
      short: 'Res. exterior',
      blurb:
        'Full house exterior: body, trim, doors, soffit/fascia, railings, prep/caulk, power wash, and all gear/supplies (ladders, sprayer, containment, PPE).',
      icon: '🏠',
      layers: [
        layer('Body / siding', '#e67e22'),
        layer('Trim / fascia', '#ffffff'),
        layer('Doors', '#c0392b'),
        layer('Soffit / porch', '#3498db'),
        layer('Metal / rail', '#7f8c8d'),
        layer('Masonry / stucco', '#d35400'),
        layer('Site / misc', '#27ae60'),
      ],
      roomPackage: null, // not interior room-based
      conditions: (L) => [
        cond('area', 'Siding / body field', {
          type: 'Finishes',
          color: '#e67e22',
          layerId: L[0].id,
          notes: 'Main field — clapboard, Hardie, wood, etc. Measure elevations.',
          assemblies: [
            A('Power wash / dry time', { qtyMode: 'same', mat: 0.05, lab: 0.22 }),
            A('Scrape / sand / spot prime bare wood', { qtyMode: 'same', mat: 0.12, lab: 0.55 }),
            A('Caulk gaps (allowance in labor)', { qtyMode: 'same', mat: 0.08, lab: 0.18 }),
            A('Body finish (2 coats) brush/roll/spray', { qtyMode: 'same', factor: 2, mat: 0.42, lab: 0.65 }),
          ],
        }),
        cond('linear', 'Trim / fascia / corner boards', {
          type: 'Finishes',
          color: '#ecf0f1',
          height: 0.5,
          layerId: L[1].id,
          notes: 'Fascia, corner boards, window/door casing, frieze.',
          assemblies: [
            A('Prep / caulk trim', { qtyMode: 'same', mat: 0.1, lab: 0.7 }),
            A('Spot prime bare spots', { qtyMode: 'same', mat: 0.08, lab: 0.25 }),
            A('Trim enamel (2 coats)', { qtyMode: 'same', factor: 2, mat: 0.22, lab: 0.85 }),
          ],
        }),
        cond('count', 'Entry / exterior doors', {
          type: 'Doors & Windows',
          color: '#c0392b',
          layerId: L[2].id,
          assemblies: [
            A('Mask glass / hardware', { qtyMode: 'same', mat: 3, lab: 15 }),
            A('Sand / prime as needed', { qtyMode: 'same', mat: 6, lab: 35 }),
            A('Door finish (2 coats both faces as scoped)', { qtyMode: 'same', factor: 2, mat: 12, lab: 55 }),
          ],
        }),
        cond('area', 'Soffit / porch ceiling', {
          type: 'Finishes',
          color: '#3498db',
          layerId: L[3].id,
          assemblies: [
            A('Prep / wash / spot prime', { qtyMode: 'same', mat: 0.1, lab: 0.4 }),
            A('Finish (2 coats)', { qtyMode: 'same', factor: 2, mat: 0.35, lab: 0.55 }),
          ],
        }),
        cond('linear', 'Railings / metal handrails', {
          type: 'Metals',
          color: '#7f8c8d',
          height: 0,
          layerId: L[4].id,
          assemblies: [
            A('Wire brush / rust prep', { qtyMode: 'same', mat: 0.15, lab: 1.2 }),
            A('Metal primer', { qtyMode: 'same', mat: 0.35, lab: 0.6 }),
            A('Metal enamel (2 coats)', { qtyMode: 'same', factor: 2, mat: 0.4, lab: 0.9 }),
          ],
        }),
        cond('area', 'Stucco / masonry body', {
          type: 'Masonry',
          color: '#d35400',
          layerId: L[5].id,
          fillPattern: 'hatch',
          assemblies: [
            A('Wash / efflorescence treat as needed', { qtyMode: 'same', mat: 0.08, lab: 0.3 }),
            A('Masonry primer / conditioner', { qtyMode: 'same', mat: 0.28, lab: 0.35 }),
            A('Elastomeric or masonry finish (2 coats)', { qtyMode: 'same', factor: 2, mat: 0.55, lab: 0.6 }),
          ],
        }),
        cond('count', 'Shutters / misc units', {
          type: 'Specialties',
          color: '#27ae60',
          layerId: L[6].id,
          assemblies: [
            A('Remove/reinstall or paint in place', { qtyMode: 'same', mat: 2, lab: 28 }),
            A('Prime + 2 coats', { qtyMode: 'same', mat: 8, lab: 22 }),
          ],
        }),
        cond('linear', 'Foundation / water table band', {
          type: 'Finishes',
          color: '#95a5a6',
          height: 2,
          layerId: L[5].id,
          assemblies: [
            A('Prep foundation band', { qtyMode: 'surface', mat: 0.06, lab: 0.35 }),
            A('Foundation coating (2 coats)', { qtyMode: 'surface', factor: 2, mat: 0.28, lab: 0.4 }),
          ],
        }),
      ],
      worksheet: [
        ws('EX-100', 'Mobilization / demob (residential exterior)', 1, 'LS', { lab: 650, eq: 200, other: 100 }),
        ws('EX-110', 'Power washer + fuel / tips / hoses', 1, 'LS', { eq: 185, mat: 40, lab: 75 }),
        ws('EX-120', 'Extension ladders / hop-ups / planks', 1, 'LS', { eq: 220, lab: 50 }),
        ws('EX-130', 'Pump sprayer / airless sprayer package (tips, hose, gun)', 1, 'LS', { eq: 375, mat: 85, lab: 120 }),
        ws('EX-140', 'Containment & ground cloths / plastic / tape', 1, 'LS', { mat: 320, lab: 200 }),
        ws('EX-150', 'Caulk, putty, sandpaper, scrapers, brushes, covers', 1, 'LS', { mat: 275, lab: 0 }),
        ws('EX-160', 'PPE (respirators, suits, gloves, eyewear)', 1, 'LS', { mat: 95, other: 0 }),
        ws('EX-170', 'Masking paper / film / frog tape (windows, roofs, hardscape)', 1, 'LS', { mat: 180, lab: 250 }),
        ws('EX-180', 'Plant / hardscape protection & reset', 1, 'LS', { mat: 60, lab: 180 }),
        ws('EX-190', 'Waste disposal / leftover paint handling', 1, 'LS', { other: 125, lab: 80 }),
        ws('EX-200', 'Contingency weather / second setup (allowance)', 1, 'LS', { other: 300, lab: 150 }),
      ],
      scopeNotes:
        'Residential exterior only. Includes wash, prep, caulk, body, trim, doors, soffits as measured. Owner to clear furniture/decor from work zones; water/electric access required. Weather delays may extend schedule. Products exterior-grade acrylic/latex or enamel per substrate; Benjamin Moore or equal unless specified.',
    },

    cabinet_refinish: {
      id: 'cabinet_refinish',
      name: 'Interior cabinet refinish (spray)',
      short: 'Cabinets',
      blurb:
        'Kitchen/bath cabinet refinish: full dust containment, degrease, degloss, prime, spray enamel, hardware handling, and spray equipment package.',
      icon: '🗄️',
      layers: [
        layer('Cabinet boxes', '#8e44ad'),
        layer('Doors / drawers', '#9b59b6'),
        layer('Interior shelves', '#a569bd'),
        layer('Trim / scribe', '#bb8fce'),
        layer('Protection', '#95a5a6'),
      ],
      roomPackage: null,
      conditions: (L) => [
        cond('count', 'Cabinet doors (each leaf)', {
          type: 'Finishes',
          color: '#9b59b6',
          layerId: L[1].id,
          notes: 'Count each door leaf. Both faces typical unless noted.',
          assemblies: [
            A('Remove, label, hardware bag', { qtyMode: 'same', mat: 0.5, lab: 8 }),
            A('Clean / degrease / degloss', { qtyMode: 'same', mat: 1.25, lab: 12 }),
            A('Sand & tack', { qtyMode: 'same', mat: 0.75, lab: 10 }),
            A('Bonding primer (spray)', { qtyMode: 'same', mat: 3.5, lab: 9 }),
            A('Conversion varnish / enamel (2–3 coats spray)', { qtyMode: 'same', factor: 2.5, mat: 6.5, lab: 14 }),
            A('Rehang, adjust, hardware reinstall', { qtyMode: 'same', mat: 0.25, lab: 12 }),
          ],
        }),
        cond('count', 'Drawer fronts', {
          type: 'Finishes',
          color: '#a569bd',
          layerId: L[1].id,
          assemblies: [
            A('Remove/label/clean/degloss', { qtyMode: 'same', mat: 1.5, lab: 14 }),
            A('Prime + spray finish system', { qtyMode: 'same', factor: 2.5, mat: 8, lab: 18 }),
            A('Reinstall / align', { qtyMode: 'same', mat: 0.2, lab: 8 }),
          ],
        }),
        cond('area', 'Cabinet boxes / face frames (in place)', {
          type: 'Finishes',
          color: '#8e44ad',
          layerId: L[0].id,
          notes: 'Visible exterior of boxes + face frames; interiors optional.',
          assemblies: [
            A('Mask interiors / appliances / counters', { qtyMode: 'same', mat: 0.35, lab: 0.55 }),
            A('Degrease / sand boxes', { qtyMode: 'same', mat: 0.2, lab: 0.65 }),
            A('Prime (brush/roll/spray)', { qtyMode: 'same', mat: 0.45, lab: 0.5 }),
            A('Finish coats (2)', { qtyMode: 'same', factor: 2, mat: 0.55, lab: 0.7 }),
          ],
        }),
        cond('area', 'Cabinet interiors (if scoped)', {
          type: 'Finishes',
          color: '#d2b4de',
          layerId: L[2].id,
          fillPattern: 'lines-h',
          notes: 'Only if contract includes interiors/shelves.',
          assemblies: [
            A('Empty/clean/sand interior', { qtyMode: 'same', mat: 0.15, lab: 0.75 }),
            A('Prime + 2 finish coats', { qtyMode: 'same', factor: 2, mat: 0.5, lab: 0.85 }),
          ],
        }),
        cond('linear', 'Scribe / end panels / fillers', {
          type: 'Finishes',
          color: '#bb8fce',
          height: 2.5,
          layerId: L[3].id,
          assemblies: [
            A('Prep fillers/end panels', { qtyMode: 'surface', mat: 0.15, lab: 0.55 }),
            A('Prime + 2 coats', { qtyMode: 'surface', factor: 2, mat: 0.4, lab: 0.6 }),
          ],
        }),
        cond('count', 'Soft-close / hinge upgrade (optional)', {
          type: 'Specialties',
          color: '#1abc9c',
          layerId: L[1].id,
          notes: 'Optional allowance — not paint; track if selling upgrade.',
          assemblies: [
            A('Hardware package + install labor', { qtyMode: 'same', mat: 18, lab: 22 }),
          ],
        }),
        cond('area', 'Island / pantry specialty units', {
          type: 'Finishes',
          color: '#6c3483',
          layerId: L[0].id,
          notes: 'Measure visible painted SF if complex millwork.',
          assemblies: [
            A('Detail prep + full refinish system', { qtyMode: 'same', mat: 0.9, lab: 1.4 }),
          ],
        }),
      ],
      worksheet: [
        ws('CB-100', 'Mobilization / site protection setup', 1, 'LS', { lab: 550, mat: 120, eq: 80 }),
        ws('CB-110', 'Full dust barrier / zipper wall / poly containment', 1, 'LS', { mat: 285, lab: 420 }),
        ws('CB-120', 'Floor / counter / appliance protection (ram board, rosin, film)', 1, 'LS', { mat: 195, lab: 220 }),
        ws('CB-130', 'HVAC / vent masking & negative air if required', 1, 'LS', { mat: 75, lab: 160, eq: 125 }),
        ws('CB-140', 'HVLP / airless spray system (gun, hose, tips, cups)', 1, 'LS', { eq: 450, mat: 95, lab: 100 }),
        ws('CB-150', 'Spray booth / door rack / drying racks', 1, 'LS', { eq: 275, lab: 90 }),
        ws('CB-160', 'Spray filters, tack cloths, strainers, thinners', 1, 'LS', { mat: 165 }),
        ws('CB-170', 'Degreaser, deglosser, bonding primer, enamel system materials bulk', 1, 'LS', {
          mat: 480,
        }),
        ws('CB-180', 'Sandpaper / sanding sponges / sanders (wear)', 1, 'LS', { mat: 90, eq: 60 }),
        ws('CB-190', 'PPE (organic vapor respirators, suits, gloves, eyewear)', 1, 'LS', { mat: 140 }),
        ws('CB-200', 'Hardware bags, labels, bins, shop vacuum', 1, 'LS', { mat: 55, eq: 40, lab: 60 }),
        ws('CB-210', 'Final clean, detail, punch, demobilize', 1, 'LS', { lab: 380, mat: 40, other: 50 }),
      ],
      scopeNotes:
        'Interior cabinet refinish only. Includes dust barriers, degrease, degloss, prime, spray enamel system on doors/drawers/boxes as measured. Owner empties cabinets; pets/kids restricted during spray. Strong odor/VOC period — ventilation plan required. Hardware reinstall; new hardware optional upgrade. Counters, appliances, floors protected but not refinished.',
    },
  };

  /**
   * Apply a suite to a project.
   * @param {object} project
   * @param {string} suiteId
   * @param {{ mode?: 'replace'|'merge' }} opts
   */
  function applySuite(project, suiteId, opts = {}) {
    const suite = SUITES[suiteId];
    if (!suite || !project) throw new Error('Unknown suite or project');
    const mode = opts.mode || 'replace';

    const layers = suite.layers.map((l) => ({ ...l, id: M().uid() }));
    // remap condition layer indexes from suite template
    const templateLayers = suite.layers;
    const conditions = suite.conditions(templateLayers).map((c, idx) => {
      // conditions were created with template layer ids — remap by index of original layerId
      const tplLayerIdx = templateLayers.findIndex((tl) => tl.id === c.layerId);
      const layerId = tplLayerIdx >= 0 ? layers[tplLayerIdx].id : layers[0]?.id;
      const freshAssemblies = (c.assemblies || []).map((a) =>
        M().createAssemblyLine({
          description: a.description,
          qtyMode: a.qtyMode,
          factor: a.factor,
          unit: a.unit,
          materialUnitCost: a.materialUnitCost,
          laborUnitCost: a.laborUnitCost,
        })
      );
      return M().createCondition(c.style, {
        number: idx + 1,
        name: c.name,
        type: c.type,
        color: c.color,
        height: c.height,
        thickness: c.thickness,
        fillPattern: c.fillPattern,
        fillOpacity: c.fillOpacity,
        layerId,
        notes: c.notes,
        roomRole: c.roomRole,
        materialUnitCost: c.materialUnitCost,
        laborUnitCost: c.laborUnitCost,
        assemblies: freshAssemblies,
      });
    });

    const worksheet = (suite.worksheet || []).map((w) =>
      M().createWorksheetLine({
        code: w.code,
        description: w.description,
        quantity: w.quantity,
        unit: w.unit,
        material: w.material,
        labor: w.labor,
        equipment: w.equipment,
        other: w.other,
      })
    );

    if (mode === 'replace' || !(project.conditions && project.conditions.length)) {
      project.layers = layers;
      project.conditions = conditions;
      project.worksheet = worksheet;
    } else {
      // merge: append conditions with new numbers
      const base = M().nextConditionNumber(project);
      project.layers = [...(project.layers || []), ...layers];
      conditions.forEach((c, i) => {
        c.number = base + i;
        project.conditions.push(c);
      });
      project.worksheet = [...(project.worksheet || []), ...worksheet];
    }

    if (suite.roomPackage) {
      project.roomPackage = { ...M().defaultRoomPackage(), ...suite.roomPackage };
    }

    project.suiteId = suite.id;
    project.suiteName = suite.name;
    project.activeConditionId = project.conditions[0]?.id || null;

    // Seed scope notes for AI / proposal
    project.scopeProposal = {
      ...(project.scopeProposal || {}),
      notes: [suite.scopeNotes, project.scopeProposal?.notes || ''].filter(Boolean).join('\n\n'),
    };

    // Cover defaults
    if (!project.cover) project.cover = {};
    project.cover.company = project.cover.company || 'WL Painting Inc.';
    project.cover.bidType = suite.short;

    return {
      suiteId: suite.id,
      conditionCount: conditions.length,
      worksheetCount: worksheet.length,
      layerCount: layers.length,
    };
  }

  function listSuites() {
    return Object.values(SUITES).map((s) => ({
      id: s.id,
      name: s.name,
      short: s.short,
      blurb: s.blurb,
      icon: s.icon,
      conditionCount: s.conditions(s.layers).length,
      worksheetCount: (s.worksheet || []).length,
    }));
  }

  function getSuite(id) {
    return SUITES[id] || null;
  }

  window.PTPaintingSuites = {
    SUITES,
    listSuites,
    getSuite,
    applySuite,
  };
})();
