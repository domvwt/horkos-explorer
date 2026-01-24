/**
 * GraphHistoryManager - Command pattern implementation for graph undo/redo.
 *
 * Each action stores only what's needed to reverse it, rather than full state snapshots.
 * Commands are objects with a 'type' and 'data' containing operation-specific details.
 */
export class GraphHistoryManager {
  constructor(maxHistory = 50, onChange = null) {
    this.undoStack = [];
    this.redoStack = [];
    this.maxHistory = maxHistory;
    this.onChange = onChange;
  }

  /**
   * Notify listener of state change.
   */
  _notifyChange() {
    if (this.onChange) {
      this.onChange();
    }
  }

  /**
   * Push a command onto the undo stack.
   * Clears the redo stack since new actions invalidate future history.
   * @param {Object} command - Command object with { type, data }
   */
  push(command) {
    this.undoStack.push(command);
    this.redoStack = []; // Clear redo on new action
    if (this.undoStack.length > this.maxHistory) {
      this.undoStack.shift();
    }
    this._notifyChange();
  }

  /**
   * Pop and return the most recent command for undoing.
   * Moves the command to the redo stack.
   * @returns {Object|null} The command to undo, or null if stack is empty
   */
  undo() {
    if (!this.canUndo()) return null;
    const command = this.undoStack.pop();
    this.redoStack.push(command);
    this._notifyChange();
    return command;
  }

  /**
   * Pop and return the most recent undone command for redoing.
   * Moves the command back to the undo stack.
   * @returns {Object|null} The command to redo, or null if stack is empty
   */
  redo() {
    if (!this.canRedo()) return null;
    const command = this.redoStack.pop();
    this.undoStack.push(command);
    this._notifyChange();
    return command;
  }

  /**
   * Check if undo is available.
   * @returns {boolean}
   */
  canUndo() {
    return this.undoStack.length > 0;
  }

  /**
   * Check if redo is available.
   * @returns {boolean}
   */
  canRedo() {
    return this.redoStack.length > 0;
  }

  /**
   * Clear both undo and redo stacks.
   * Called when starting a new query/graph.
   */
  clear() {
    this.undoStack = [];
    this.redoStack = [];
    this._notifyChange();
  }

  /**
   * Get the current undo stack depth.
   * @returns {number}
   */
  getUndoDepth() {
    return this.undoStack.length;
  }

  /**
   * Get the current redo stack depth.
   * @returns {number}
   */
  getRedoDepth() {
    return this.redoStack.length;
  }
}
