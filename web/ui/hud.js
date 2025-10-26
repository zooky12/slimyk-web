// ui/hud.js
export function setupHUD({
  onToggleBuildMode, onUndo, onReset,
  onToggleSolver, onRefreshLevels, onLoadLevel,
  onExport, onImport,
  onRunSolver, onStopSolver,
  onPlaySolution, onExportSolution
}) {
  document.getElementById('build-mode-btn').addEventListener('click', onToggleBuildMode);
  document.getElementById('undo-btn').addEventListener('click', onUndo);
  document.getElementById('reset-btn').addEventListener('click', onReset);

  document.getElementById('toggleSolver').addEventListener('click', onToggleSolver);
  document.getElementById('refresh-server').addEventListener('click', onRefreshLevels);
  document.getElementById('load-server').addEventListener('click', onLoadLevel);

  document.getElementById('export-btn').addEventListener('click', () => {
    const name = (document.getElementById('export-name')?.value || '').trim();
    onExport(name);
  });
  document.getElementById('import-btn').addEventListener('click', () => document.getElementById('import-file').click());
  document.getElementById('import-file').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    onImport(file);
    e.target.value = '';
  });

  const statusEl = document.getElementById('solverProgress');
  const solutionsEl = document.getElementById('solutionsList');

  document.getElementById('runSolver').addEventListener('click', async () => {
    const maxDepth = Number(document.getElementById('solverMaxDepth').value);
    const maxNodes = Number(document.getElementById('solverMaxNodes').value);
    const maxSolutions = Number(document.getElementById('solverMaxSolutions').value);

    const runBtn = document.getElementById('runSolver');
    const stopBtn = document.getElementById('stopSolver');
    runBtn.disabled = true;
    stopBtn.disabled = false;

    try {
      await onRunSolver({
        maxDepth,
        maxNodes,
        maxSolutions,
        onProgress: (text) => { statusEl.textContent = text; },
        onSolutions: (result = {}) => {
          const solutions = Array.isArray(result.solutions) ? result.solutions : [];
          const deadEnds = Array.isArray(result.deadEnds) ? result.deadEnds : [];
          const stats = result.stats || {};

          solutionsEl.innerHTML = '';

          if (solutions.length) {
            solutions.forEach((entry, idx) => {
              const row = document.createElement('div');
              row.className = 'solutionItem';

              const text = document.createElement('div');
              text.className = 'solutionText';
              text.innerHTML = `#${idx + 1} len:${entry.length} moves: <b>${entry.moves}</b>`;
              row.appendChild(text);

              const actions = document.createElement('div');
              actions.className = 'solutionActions';

              const playBtn = document.createElement('button');
              playBtn.textContent = 'Play';
              playBtn.addEventListener('click', () => onPlaySolution && onPlaySolution(entry.moves));
              actions.appendChild(playBtn);

              const exportBtn = document.createElement('button');
              exportBtn.textContent = 'Export';
              exportBtn.addEventListener('click', () => onExportSolution && onExportSolution(entry.moves));
              actions.appendChild(exportBtn);

              row.appendChild(actions);
              solutionsEl.appendChild(row);
            });
          }

          if (!solutions.length) {
            const empty = document.createElement('div');
            empty.className = 'solutionItem';
            const text = document.createElement('div');
            text.className = 'solutionText';
            text.textContent = 'No solutions found (within current limits).';
            empty.appendChild(text);
            solutionsEl.appendChild(empty);
          }

          if (deadEnds.length) {
            const header = document.createElement('div');
            header.className = 'solutionItem deadHeader';
            const title = document.createElement('div');
            title.className = 'solutionText';
            title.innerHTML = `Dead ends (filtered): <b>${deadEnds.length}</b>`;
            header.appendChild(title);
            solutionsEl.appendChild(header);

            deadEnds.forEach((entry, idx) => {
              const row = document.createElement('div');
              row.className = 'solutionItem deadItem';
              const text = document.createElement('div');
              text.className = 'solutionText';
              text.innerHTML = `#${idx + 1} len:${entry.length} moves: <b>${entry.moves}</b>`;
              row.appendChild(text);
              solutionsEl.appendChild(row);
            });
          }

          const parts = [`Done. solutions: ${solutions.length}`, `dead ends: ${deadEnds.length}`];
          if (Number.isFinite(stats.nodesExpanded)) parts.push(`nodes: ${stats.nodesExpanded}`);
          statusEl.textContent = parts.join(' | ');
        }
      });
    } catch (err) {
      statusEl.textContent = `Error: ${err && err.message ? err.message : err}`;
    } finally {
      runBtn.disabled = false;
      stopBtn.disabled = true;
    }
  });

  document.getElementById('stopSolver').addEventListener('click', () => {
    statusEl.textContent = 'Cancel requested...';
    onStopSolver();
    document.getElementById('stopSolver').disabled = true;
  });
}

