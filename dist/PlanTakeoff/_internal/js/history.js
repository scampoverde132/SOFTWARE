/**
 * Slim undo/redo for takeoff objects (add / delete).
 * Pattern from OpenTakeoff shapeCommands.recordCommand — no provenance layer.
 */
(function () {
  const CAP = 100;
  let undo = [];
  let redo = [];

  function clear() {
    undo = [];
    redo = [];
  }

  function push(entry) {
    if (!entry) return;
    undo.push(entry);
    if (undo.length > CAP) undo = undo.slice(undo.length - CAP);
    redo = [];
  }

  function canUndo() {
    return undo.length > 0;
  }
  function canRedo() {
    return redo.length > 0;
  }

  function undoOnce() {
    const entry = undo.pop();
    if (!entry) return null;
    redo.push(entry);
    return entry;
  }

  function redoOnce() {
    const entry = redo.pop();
    if (!entry) return null;
    undo.push(entry);
    if (undo.length > CAP) undo = undo.slice(undo.length - CAP);
    return entry;
  }

  window.PTHistory = {
    clear,
    push,
    canUndo,
    canRedo,
    undoOnce,
    redoOnce,
    CAP,
  };
})();
