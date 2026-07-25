/**
 * Evidence pack + logical WL Painting scope draft.
 * AI may refine language; numbers and line items come from real takeoff.
 */
(function () {
  const M = () => window.PTModels;

  function fmt(n, d = 2) {
    if (n == null || Number.isNaN(Number(n))) return '0';
    return M().formatQty ? M().formatQty(n, d) : String(Number(n).toFixed(d));
  }

  /**
   * Build structured evidence from the live project (no invention).
   */
  function buildEvidencePack(project, extras = {}) {
    if (!project) return { job: {}, facts: [], quantities: [], pages: [], drawings: [], gaps: [] };

    const facts = [];
    const gaps = [];

    // Job facts
    if (project.jobNumber) facts.push({ type: 'job', text: `Job number: ${project.jobNumber}` });
    if (project.name) facts.push({ type: 'job', text: `Project name: ${project.name}` });
    if (project.client) facts.push({ type: 'job', text: `Client: ${project.client}` });
    if (project.location) facts.push({ type: 'job', text: `Location: ${project.location}` });
    if (project.folderPath) facts.push({ type: 'folder', text: `Bid folder: ${project.folderPath}` });
    if (!project.client) gaps.push('Client not set on cover sheet.');
    if (!project.location) gaps.push('Location not set on cover sheet.');

    // Pages / drawings loaded into takeoff
    const pages = (project.pages || []).map((pg, i) => {
      const hasPlan = !!(pg.imageDataUrl || pg.hasImage || pg.sourcePath);
      const scaled = !!(pg.feetPerPixel && (pg.calibrated || pg.scaleId));
      if (hasPlan && !scaled) {
        gaps.push(`Page "${pg.name || i + 1}" has a plan image but scale is not calibrated/set.`);
      }
      if (!hasPlan) {
        gaps.push(`Page "${pg.name || i + 1}" has no plan image loaded.`);
      }
      return {
        name: pg.name || `Page ${i + 1}`,
        sourcePath: pg.sourcePath || '',
        hasPlan,
        scaleId: pg.scaleId || '',
        calibrated: !!pg.calibrated,
        pdfPage: pg.pdfPage ?? null,
      };
    });

    if (!pages.length) gaps.push('No pages in this takeoff job yet.');

    // External drawing file names from folder scan (if provided)
    const drawings = (extras.folderDrawings || []).map((d) => ({
      name: d.name || d,
      rel: d.rel || '',
    }));

    // Conditions + real net quantities
    const quantities = [];
    for (const c of project.conditions || []) {
      const q = M().aggregateConditionQuantities(project, c.id);
      const entry = {
        number: c.number,
        name: c.name,
        style: c.style,
        type: c.type,
        unit: c.unitPrimary || '',
        qty: q.primary || 0,
        secondary: q.secondary || 0,
        unit2: c.unitSecondary || '',
        objectCount: q.count || 0,
        deducted: q.deducted || 0,
        height: c.height || 0,
        roomRole: c.roomRole || null,
        hasAssembly: !!(c.assemblies && c.assemblies.length),
      };
      quantities.push(entry);
      if (entry.qty > 0) {
        facts.push({
          type: 'takeoff',
          text: `Measured: ${c.name} = ${fmt(entry.qty)} ${entry.unit}` +
            (entry.secondary > 0 && entry.unit2 ? ` (also ${fmt(entry.secondary)} ${entry.unit2})` : '') +
            ` from ${entry.objectCount} mark(s)` +
            (entry.deducted > 0 ? `; openings deducted ~${fmt(entry.deducted)}` : ''),
        });
      } else if (entry.objectCount === 0) {
        // condition exists but nothing digitized
        facts.push({
          type: 'setup',
          text: `Condition defined but not measured yet: ${c.number}. ${c.name} (${c.style}/${entry.unit})`,
        });
      }
    }

    const measured = quantities.filter((x) => x.qty > 0);
    if (!measured.length) {
      gaps.push('No positive takeoff quantities yet — sweep can only triage sheets/notes, not confirm areas/lengths.');
    }

    // Marks with multipliers / room packages
    let roomPackages = 0;
    let multNotes = [];
    for (const t of project.takeoffs || []) {
      if (t.roomPackageId) roomPackages += 1;
      if (t.multiplier && t.multiplier !== 1) {
        multNotes.push(`Mark on ${t.label || t.role || 'item'} uses typical multiplier ×${t.multiplier}`);
      }
      if (t.isDeduction && t.parentId) {
        facts.push({
          type: 'deduction',
          text: `Opening deduction linked to parent mark (${t.label || 'opening'})`,
        });
      }
    }
    if (roomPackages) {
      facts.push({ type: 'room', text: `${roomPackages} mark(s) came from room package generation` });
    }
    multNotes.slice(0, 8).forEach((t) => facts.push({ type: 'multiplier', text: t }));

    const notes = (extras.notes || project.scopeProposal?.notes || '').trim();
    if (notes) facts.push({ type: 'note', text: `Estimator notes: ${notes}` });
    else gaps.push('No estimator notes entered on Scope / AI tab.');

    return {
      job: {
        name: project.name || '',
        jobNumber: project.jobNumber || '',
        client: project.client || '',
        location: project.location || '',
        folderPath: project.folderPath || '',
        status: project.status || '',
      },
      facts,
      gaps,
      quantities,
      pages,
      drawings,
      notes,
      stats: {
        pageCount: pages.length,
        pagesWithPlan: pages.filter((p) => p.hasPlan).length,
        conditionCount: quantities.length,
        measuredCount: measured.length,
        takeoffMarks: (project.takeoffs || []).length,
      },
    };
  }

  /**
   * Deterministic WL Painting scope draft from real quantities only.
   * AI may polish wording; it must not invent extra work packages.
   */
  function buildWlScopeDraft(project, evidence, opts = {}) {
    const job = evidence?.job || {};
    const lines = [];
    lines.push(`Project: ${job.name || project.name || 'TBD'}`);
    if (job.jobNumber) lines.push(`Job #: ${job.jobNumber}`);
    if (job.client) lines.push(`Client: ${job.client}`);
    if (job.location) lines.push(`Location: ${job.location}`);
    lines.push('');
    lines.push('Scope of Work');

    let n = 1;
    const add = (s) => {
      lines.push(`${n}. ${s}`);
      n += 1;
    };

    add('Provide labor and materials to protect surrounding areas with plastic, tape, and drop cloths as required.');

    const qs = (evidence?.quantities || []).filter((q) => Number(q.qty) > 0.0001);
    if (!qs.length) {
      add(
        'Provide labor and materials to prepare and paint surfaces per finish schedule and elevations once quantities are confirmed by full takeoff (no measured quantities in file yet).'
      );
    } else {
      for (const q of qs) {
        const qtyStr = `${fmt(q.qty)} ${q.unit || ''}`.trim();
        const styleHint =
          q.style === 'linear'
            ? q.height > 0
              ? `linear work (approx. wall surface also ${fmt(q.secondary)} ${q.unit2 || 'SF'} at ${fmt(q.height, 1)} ft height)`
              : 'linear work'
            : q.style === 'count'
              ? 'count items'
              : 'area work';

        let verb = 'prepare and paint';
        const nameL = (q.name || '').toLowerCase();
        if (nameL.includes('wallcover') || nameL.includes('wc-')) verb = 'install wallcovering for';
        if (nameL.includes('base') || nameL.includes('crown') || nameL.includes('chair') || nameL.includes('trim')) {
          verb = 'prepare and paint';
        }

        add(
          `Provide labor and materials to ${verb} ${q.name} — ${qtyStr} (${styleHint}), strictly per finish plan/schedule and notes.`
        );
      }
    }

    add('Provide labor and materials to protect adjacent finishes and equipment; coordinate masking of devices; leave site broom-clean daily as practical.');

    lines.push('');
    lines.push('Clarifications');
    let c = 1;
    const clar = [];
    clar.push('Work during regular hours unless otherwise agreed in writing.');
    clar.push('Sequence coats as required by schedule (primer/first coat before flooring when applicable; final coat after).');
    clar.push('Scope is limited to items measured in this takeoff file and/or explicitly listed above; finish tags govern appearance.');
    clar.push('Products: Benjamin Moore or approved equal, applied per manufacturer data sheets.');
    if ((evidence?.gaps || []).some((g) => /exterior/i.test(g))) {
      /* noop */
    }
    const notes = (evidence?.notes || '').toLowerCase();
    if (notes.includes('exterior') && notes.includes('only')) {
      clar.push('Exterior-only bid per estimator notes; interior excluded unless added by change order.');
    } else if (notes.includes('no exterior') || notes.includes('interior only')) {
      clar.push('Interior only per estimator notes; exterior excluded.');
    }
    if (!qs.length) {
      clar.push('Quantities pending full on-screen takeoff; unit prices may be used for ROM until measurements complete.');
    }
    (evidence?.gaps || []).slice(0, 6).forEach((g) => {
      clar.push(`Open item: ${g}`);
    });
    clar.forEach((t) => {
      lines.push(`${c}. ${t}`);
      c += 1;
    });

    lines.push('');
    lines.push('Exclusions');
    const excl = [
      'Surfaces without finish tags or not measured/listed above.',
      'FRP install, skim coat / Level 5, drywall repairs beyond normal paint prep, concrete repairs.',
      'Ceiling grid and ACT tile paint/caulk unless specifically measured.',
      'Touch-up for damage by others after acceptance.',
      'Spray fireproofing (GCP) and non-paint trades.',
    ];
    if (notes.includes('no exterior') || notes.includes('interior only')) {
      excl.unshift('All exterior painting and coatings.');
    }
    if (!(qs.some((q) => /wallcover|wc-/i.test(q.name || '')))) {
      excl.push('Wallcovering install unless a wallcovering condition is measured above.');
    }
    excl.forEach((e) => lines.push(`- ${e}`));

    return lines.join('\n');
  }

  /**
   * Plain-text evidence block for the AI (ASCII only to avoid garbage characters).
   */
  function evidenceToPromptText(ev) {
    const lines = [];
    lines.push('JOB');
    lines.push(`- Name: ${ev.job.name || 'TBD'}`);
    lines.push(`- Number: ${ev.job.jobNumber || 'TBD'}`);
    lines.push(`- Client: ${ev.job.client || 'TBD'}`);
    lines.push(`- Location: ${ev.job.location || 'TBD'}`);
    lines.push(`- Folder: ${ev.job.folderPath || 'TBD'}`);
    lines.push('');
    lines.push('STATS');
    lines.push(
      `- Pages: ${ev.stats.pageCount} (with plan image: ${ev.stats.pagesWithPlan}); conditions: ${ev.stats.conditionCount}; measured: ${ev.stats.measuredCount}; marks: ${ev.stats.takeoffMarks}`
    );
    lines.push('');
    lines.push('HARD FACTS (only these are proven in the file)');
    if (!ev.facts.length) lines.push('- (none)');
    else ev.facts.forEach((f, i) => lines.push(`${i + 1}. [${f.type}] ${f.text}`));
    lines.push('');
    lines.push('PAGES LOADED IN PLANTAKEOFF');
    if (!ev.pages.length) lines.push('- (none)');
    else
      ev.pages.slice(0, 80).forEach((pg) => {
        lines.push(
          `- ${pg.name} | plan=${pg.hasPlan ? 'yes' : 'no'} | scale=${pg.calibrated ? 'calibrated' : pg.scaleId || 'unset'} | src=${pg.sourcePath || 'n/a'}`
        );
      });
    lines.push('');
    lines.push('FOLDER DRAWING FILES (from bid folder scan, if any)');
    if (!ev.drawings.length) lines.push('- (none provided)');
    else
      ev.drawings.slice(0, 100).forEach((d) => {
        lines.push(`- ${d.name}${d.rel ? ` (${d.rel})` : ''}`);
      });
    lines.push('');
    lines.push('TAKEOFF QUANTITIES (net)');
    if (!ev.quantities.length) lines.push('- (no conditions)');
    else
      ev.quantities.forEach((q) => {
        lines.push(
          `- #${q.number} ${q.name}: qty=${fmt(q.qty)} ${q.unit} | marks=${q.objectCount} | style=${q.style} | type=${q.type}` +
            (q.secondary > 0 ? ` | secondary=${fmt(q.secondary)} ${q.unit2}` : '')
        );
      });
    lines.push('');
    lines.push('GAPS / UNKNOWN (do not invent answers for these)');
    if (!ev.gaps.length) lines.push('- (none flagged)');
    else ev.gaps.forEach((g, i) => lines.push(`${i + 1}. ${g}`));
    lines.push('');
    lines.push('ESTIMATOR NOTES');
    lines.push(ev.notes || '(none)');
    return lines.join('\n');
  }

  window.PTScopeLogic = {
    buildEvidencePack,
    buildWlScopeDraft,
    evidenceToPromptText,
  };
})();
