// ui/hud.js
export function setupHUD({
  onToggleBuildMode, onUndo, onReset,
  onNextLevel,
  onToggleSolver, onRefreshLevels, onLoadLevel,
  onExport, onImport,
  onRunSolver, onStopSolver,
  onPlaySolution, onExportSolution
}) {
  try { console.debug && console.debug('[HUD] setup start'); } catch {}
  const have = (id) => !!document.getElementById(id);
  try { console.debug && console.debug('[HUD] elements', {
    buildModeBtn: have('build-mode-btn'), undoBtn: have('undo-btn'), resetBtn: have('reset-btn'),
    toggleSolver: have('toggleSolver'), refresh: have('refresh-server'), load: have('load-server'),
    runSolver: have('runSolver'), stopSolver: have('stopSolver'),
    solverProgress: have('solverProgress'), solutionsList: have('solutionsList')
  }); } catch {}
  document.getElementById('build-mode-btn').addEventListener('click', onToggleBuildMode);
  document.getElementById('undo-btn').addEventListener('click', onUndo);
  document.getElementById('reset-btn').addEventListener('click', onReset);
  const nextBtn = document.getElementById('next-level');
  if (nextBtn && typeof onNextLevel === 'function') nextBtn.addEventListener('click', onNextLevel);

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
  let lastReport = null;

  document.getElementById('runSolver').addEventListener('click', async () => {
    try { console.debug && console.debug('[HUD] Run Solver clicked'); } catch {}
    const maxDepth = Number(document.getElementById('solverMaxDepth').value);
    const maxNodes = Number(document.getElementById('solverMaxNodes').value);
    const maxSolutions = Number(document.getElementById('solverMaxSolutions').value);

    const runBtn = document.getElementById('runSolver');
    const stopBtn = document.getElementById('stopSolver');
    runBtn.disabled = true;
    stopBtn.disabled = false;
    if (statusEl) statusEl.textContent = 'Running...';
    if (solutionsEl) solutionsEl.innerHTML = '';

    try {
      await onRunSolver({
        maxDepth,
        maxNodes,
        maxSolutions,
        onProgress: (text) => { if (statusEl) statusEl.textContent = text; },
        onSolutions: (result = {}) => {
          try { console.debug && console.debug('[HUD] onSolutions', result); } catch {}
          const solutions = Array.isArray(result.solutions) ? result.solutions : [];
          const deadEnds = Array.isArray(result.deadEnds) ? result.deadEnds : [];
          const stats = result.stats || {};
          lastReport = result.reportRaw || null;

          if (solutionsEl) solutionsEl.innerHTML = '';

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
              exportBtn.textContent = 'Export Report';
              exportBtn.title = 'Export full solver JSON report';
              exportBtn.addEventListener('click', () => {
                if (!lastReport) return;
                try {
                  const blob = new Blob([JSON.stringify(lastReport, null, 2)], { type: 'application/json' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url; a.download = 'solver-report.json'; a.click();
                  URL.revokeObjectURL(url);
                } catch {}
              });
              actions.appendChild(exportBtn);

              row.appendChild(actions);
              if (solutionsEl) solutionsEl.appendChild(row);
            });
          }

          if (!solutions.length) {
            const empty = document.createElement('div');
            empty.className = 'solutionItem';
            const text = document.createElement('div');
            text.className = 'solutionText';
            text.textContent = 'No solutions found (within current limits).';
            empty.appendChild(text);
            if (solutionsEl) solutionsEl.appendChild(empty);
          }

          if (deadEnds.length) {
            const header = document.createElement('div');
            header.className = 'solutionItem deadHeader';
            const title = document.createElement('div');
            title.className = 'solutionText';
            title.innerHTML = `Dead ends (filtered): <b>${deadEnds.length}</b>`;
            header.appendChild(title);
            if (solutionsEl) solutionsEl.appendChild(header);

            deadEnds.forEach((entry, idx) => {
              const row = document.createElement('div');
              row.className = 'solutionItem deadItem';
              const text = document.createElement('div');
              text.className = 'solutionText';
              text.innerHTML = `#${idx + 1} len:${entry.length} moves: <b>${entry.moves}</b>`;
              row.appendChild(text);
              if (solutionsEl) solutionsEl.appendChild(row);
            });
          }

          const parts = [`Done. solutions: ${solutions.length}`, `dead ends: ${deadEnds.length}`];
          if (Number.isFinite(stats.nodesExpanded)) parts.push(`nodes: ${stats.nodesExpanded}`);
          if (statusEl) statusEl.textContent = parts.join(' | ');
        }
      });
    } catch (err) {
      try { console.error && console.error('[HUD] runSolver error', err); } catch {}
      if (statusEl) statusEl.textContent = `Error: ${err && err.message ? err.message : err}`;
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

