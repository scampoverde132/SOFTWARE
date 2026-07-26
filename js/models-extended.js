/**
 * Extended Models for BuilderTrend + OST Hybrid Suites
 * Adds phase-based project management to PlanTakeoff
 */

const uid = () =>
  crypto.randomUUID ? crypto.randomUUID() : `id_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

/**
 * Phase object: discrete work packages in a project
 * Examples: Foundation, Framing, Exterior, MEP Rough, Finishes, MEP Final
 */
function createPhase(overrides = {}) {
  return {
    id: overrides.id || uid(),
    number: overrides.number || 1,
    name: overrides.name || 'New Phase',
    short: overrides.short || overrides.name || 'Phase',
    description: overrides.description || '',
    status: overrides.status || 'Pending', // Pending | Active | Complete | On Hold
    startDate: overrides.startDate || null,
    dueDate: overrides.dueDate || null,
    budget: overrides.budget || {
      material: 0,
      labor: 0,
      equipment: 0,
      other: 0,
      contingencyPct: 5,
    },
    // References to conditions, tasks, worksheet items in this phase
    conditionIds: overrides.conditionIds || [],
    taskIds: overrides.taskIds || [],
    worksheetIds: overrides.worksheetIds || [],
    layerIds: overrides.layerIds || [],
    // PM metadata
    crew: overrides.crew || [],
    notes: overrides.notes || '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Task object: checkpoints or work items within a phase
 * Can be sequential or parallel; tracked by assignee/priority/status
 */
function createTask(overrides = {}) {
  return {
    id: overrides.id || uid(),
    title: overrides.title || 'New Task',
    description: overrides.description || '',
    phaseId: overrides.phaseId || null,
    assignedTo: overrides.assignedTo || '',
    dueDate: overrides.dueDate || null,
    status: overrides.status || 'Open', // Open | In Progress | Done | Blocked
    priority: overrides.priority || 'Medium', // High | Medium | Low
    durationDays: overrides.durationDays || 1,
    // Task dependencies (name of task this depends on, or null if parallel)
    sequenceAfter: overrides.sequenceAfter || null,
    // Tracking
    checklist: overrides.checklist || [], // array of { text, done }
    notes: overrides.notes || '',
    createdAt: new Date().toISOString(),
    completedAt: overrides.completedAt || null,
    ...overrides,
  };
}

/**
 * Budget Alert: tracks phase vs. takeoff cost variance
 */
function createBudgetAlert(phaseId, conditionId, budgeted, takeoffCost) {
  const variance = takeoffCost - budgeted;
  const variancePct = budgeted > 0 ? (variance / budgeted) * 100 : 0;
  return {
    id: uid(),
    phaseId,
    conditionId,
    budgeted,
    takeoffCost,
    variance,
    variancePct,
    status: Math.abs(variancePct) <= 5 ? 'on track' : variancePct > 5 ? 'over' : 'under',
    createdAt: new Date().toISOString(),
  };
}

/**
 * Aggregate phase costs from conditions and worksheet items
 */
function aggregatePhaseQuantities(project, phaseId) {
  const phase = project.phases?.find((p) => p.id === phaseId);
  if (!phase) return { material: 0, labor: 0, equipment: 0, other: 0, total: 0 };

  let material = 0,
    labor = 0,
    equipment = 0,
    other = 0;

  // Sum from conditions in this phase
  for (const condId of phase.conditionIds || []) {
    const cond = project.conditions?.find((c) => c.id === condId);
    if (!cond) continue;
    // Get aggregated qty for this condition
    const M = window.PTModels;
    const q = M?.aggregateConditionQuantities(project, condId) || {};
    material += (q.primary || 0) * (cond.materialUnitCost || 0);
    labor += (q.primary || 0) * (cond.laborUnitCost || 0);
  }

  // Sum from worksheet items in this phase
  for (const wsId of phase.worksheetIds || []) {
    const ws = project.worksheet?.find((w) => w.id === wsId);
    if (!ws) continue;
    const qty = Number(ws.quantity) || 0;
    material += qty * (Number(ws.material) || 0);
    labor += qty * (Number(ws.labor) || 0);
    equipment += qty * (Number(ws.equipment) || 0);
    other += qty * (Number(ws.other) || 0);
  }

  return {
    material,
    labor,
    equipment,
    other,
    total: material + labor + equipment + other,
  };
}

/**
 * Calculate phase variance against budget
 */
function calculatePhaseVariance(project, phaseId) {
  const phase = project.phases?.find((p) => p.id === phaseId);
  if (!phase) return { budgeted: 0, takeoff: 0, variance: 0, variancePct: 0, status: 'on track' };

  const budgeted = (phase.budget?.material || 0) + (phase.budget?.labor || 0) +
    (phase.budget?.equipment || 0) + (phase.budget?.other || 0);
  const takeoff = aggregatePhaseQuantities(project, phaseId).total;
  const variance = takeoff - budgeted;
  const variancePct = budgeted > 0 ? (variance / budgeted) * 100 : 0;

  return {
    budgeted,
    takeoff,
    variance,
    variancePct,
    status: Math.abs(variancePct) <= 5 ? 'on track' : variancePct > 5 ? 'over' : 'under',
  };
}

/**
 * Get next phase number in project
 */
function nextPhaseNumber(project) {
  const nums = (project.phases || []).map((p) => p.number || 0);
  return (nums.length ? Math.max(...nums) : 0) + 1;
}

/**
 * Extend createProject to support phases
 */
const originalCreateProject = window.PTModels?.createProject;
function createProjectWithPhases(overrides = {}) {
  const project = originalCreateProject ? originalCreateProject(overrides) : {
    id: uid(),
    name: 'Untitled Bid',
    jobNumber: '',
    status: 'Bidding',
    layers: [],
    conditions: [],
    pages: [],
    takeoffs: [],
    worksheet: [],
  };

  // Add multi-phase support
  project.isMultiPhase = overrides.isMultiPhase || false;
  project.phases = overrides.phases || [];
  project.phaseDependencies = overrides.phaseDependencies || [];
  project.phaseConditionMap = overrides.phaseConditionMap || {}; // phaseId → [conditionIds]
  project.phaseTasks = overrides.phaseTasks || {}; // phaseId → [tasks]

  return project;
}

// Export helpers
window.PTModelsExtended = {
  createPhase,
  createTask,
  createBudgetAlert,
  aggregatePhaseQuantities,
  calculatePhaseVariance,
  nextPhaseNumber,
  createProjectWithPhases,
};
