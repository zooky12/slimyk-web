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
  function levelDtoFromReport(rep){
    try {
      const snap = rep && rep.levelSnapshot;
      if (snap && Array.isArray(snap.tileGrid)){
        const w = snap.width || (snap.tileGrid[0]?.length|0) || 0;
        const h = snap.height || (snap.tileGrid.length|0) || 0;
        const entities = Array.isArray(snap.entities) ? snap.entities.map(e=>({ type: e.type, x: e.x|0, y: e.y|0, orientation: e.orientation })) : [];
        return { width: w, height: h, tileGrid: snap.tileGrid, entities };
      }
    } catch {}
    return null;
  }

  document.getElementById('runSolver').addEventListener('click', async () => {
    try { console.debug && console.debug('[HUD] Run Solver clicked'); } catch {}
    const maxDepth = Number(document.getElementById('solverMaxDepth').value);
    const maxNodes = Number(document.getElementById('solverMaxNodes').value);
    const maxSolutions = Number(document.getElementById('solverMaxSolutions').value);
    const disableVisited = !!document.getElementById('solverDisableVisited')?.checked;
    const useBfs = !!document.getElementById('solverUseBfs')?.checked;

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
        useBfs,
        disableVisited,
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

          // Replay (trace) controls: allow user to paste moves and get a debug trace
          (function addReplayControls(){
            try {
              const row = document.createElement('div');
              row.className = 'solutionItem';
              const text = document.createElement('div');
              text.className = 'solutionText';
              text.textContent = 'Replay moves with trace:';
              row.appendChild(text);

              const actions = document.createElement('div');
              actions.className = 'solutionActions';
              const input = document.createElement('input');
              input.type = 'text';
              input.placeholder = 'enter moves (w d s a)';
              input.style.minWidth = '260px';
              actions.appendChild(input);

              const btn = document.createElement('button');
              btn.textContent = 'Replay (trace)';
              btn.addEventListener('click', async () => {
                const moves = (input.value || '').trim();
                if (!moves) return;
                const lvl = levelDtoFromReport(lastReport);
                if (!lvl) { alert('No level snapshot available in last report. Run solver again first.'); return; }
                try {
                  const rep = await window.api.engineReplayMoves(lvl, moves);
                  console.debug('[ReplayTrace]', rep);
                  const summary = document.createElement('div');
                  summary.className = 'solutionText';
                  const msg = rep && rep.ok ? (rep.win ? `Win at step ${rep.at}` : 'OK') : (rep && rep.blocked ? `Blocked at step ${rep.at} on ${rep.dir}` : `Stopped: ${rep?.reason||'unknown'}`);
                  summary.textContent = `Trace: ${msg}`;

                  const dlBtn = document.createElement('button');
                  dlBtn.textContent = 'Download Trace';
                  dlBtn.addEventListener('click', () => {
                    try {
                      const blob = new Blob([JSON.stringify(rep, null, 2)], { type: 'application/json' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url; a.download = 'replay-trace.json'; a.click();
                      URL.revokeObjectURL(url);
                    } catch {}
                  });

                  const out = document.createElement('div');
                  out.className = 'solutionItem';
                  const wrap = document.createElement('div');
                  wrap.className = 'solutionActions';
                  wrap.appendChild(summary);
                  wrap.appendChild(dlBtn);
                  out.appendChild(wrap);
                  solutionsEl && solutionsEl.appendChild(out);
                } catch(e) {
                  alert('Replay failed: ' + (e?.message || e));
                }
              });
              actions.appendChild(btn);

              row.appendChild(actions);
              solutionsEl && solutionsEl.appendChild(row);
              // Trace Align controls
              const row2 = document.createElement('div');
              row2.className = 'solutionItem';
              const text2 = document.createElement('div');
              text2.className = 'solutionText';
              text2.textContent = 'Trace align (moves ? visited depth):';
              row2.appendChild(text2);
              const actions2 = document.createElement('div');
              actions2.className = 'solutionActions';
              const input2 = document.createElement('input');
              input2.type = 'text'; input2.placeholder = 'enter moves (w d s a)'; input2.style.minWidth = '260px';
              actions2.appendChild(input2);
              const btn2 = document.createElement('button'); btn2.textContent = 'Trace Align'; actions2.appendChild(btn2);
              const dlBtn2 = document.createElement('button'); dlBtn2.textContent = 'Download Align JSON'; dlBtn2.disabled = true; actions2.appendChild(dlBtn2);
              row2.appendChild(actions2);
              solutionsEl && solutionsEl.appendChild(row2);
              let lastAlign = null;
              btn2.addEventListener('click', async () => {
                const moves = (input2.value || '').trim(); if (!moves) return;
                const lvl = levelDtoFromReport(lastReport);
                if (!lvl) { alert('No level snapshot available in last report. Run solver again first.'); return; }
                try {
                  const cfg = { nodesCap: Number(document.getElementById('solverMaxNodes')?.value) || 200000, depthCap: Number(document.getElementById('solverMaxDepth')?.value) || 100, timeCapSeconds: 10.0, enforceTimeCap: false };
                  const res = await window.api.solverTraceAlign(lvl, moves, cfg);
                  lastAlign = res;
                  dlBtn2.disabled = !(lastAlign && lastAlign.ok);
                  const info = document.createElement('div'); info.className = 'solutionText';
                  info.textContent = (lastAlign && lastAlign.ok) ? `firstMissing: ${lastAlign.firstMissing} (prefixes: ${(lastAlign.prefixes||[]).length})` : `TraceAlign failed: ${lastAlign?.err || 'unknown'}`;
                  const out2 = document.createElement('div'); out2.className = 'solutionItem'; const wrap2 = document.createElement('div'); wrap2.className = 'solutionActions';
                  wrap2.appendChild(info); out2.appendChild(wrap2); solutionsEl && solutionsEl.appendChild(out2);

                  // If a merge (same key at a different depth) exists, surface both paths
                  const prefixes = Array.isArray(lastAlign?.prefixes) ? lastAlign.prefixes : [];
                  let merge = null;
                  for (const p of prefixes) { if (p && typeof p.seenDepth === 'number' && p.seenDepth >= 0 && p.seenDepth !== p.idx) { merge = p; break; } }
                  if (merge) {
                    const row3 = document.createElement('div'); row3.className = 'solutionItem';
                    const text3 = document.createElement('div'); text3.className = 'solutionText';
                    text3.textContent = `Merge at idx ${merge.idx} (visited depth ${merge.seenDepth}) key: ${merge.keyA}:${merge.keyB}`;
                    const actions3 = document.createElement('div'); actions3.className = 'solutionActions';
                    const getBtn = document.createElement('button'); getBtn.textContent = 'Get Both Paths';
                    const playTraceBtn = document.createElement('button'); playTraceBtn.textContent = 'Play Trace Prefix'; playTraceBtn.disabled = true;
                    const playBfsBtn = document.createElement('button'); playBfsBtn.textContent = 'Play BFS Minimal'; playBfsBtn.disabled = true;
                    const dlPairBtn = document.createElement('button'); dlPairBtn.textContent = 'Download Pair'; dlPairBtn.disabled = true;
                    actions3.appendChild(getBtn); actions3.appendChild(playTraceBtn); actions3.appendChild(playBfsBtn); actions3.appendChild(dlPairBtn);
                    row3.appendChild(text3); row3.appendChild(actions3); solutionsEl && solutionsEl.appendChild(row3);

                    let pair = null;
                    getBtn.addEventListener('click', async () => {
                      try {
                        const traceMoves = moves.slice(0, Math.max(0, merge.idx));
                        const bfsRes = await window.api.solverFindPathToKey(lvl, merge.keyA, merge.keyB, cfg);
                        const bfsMoves = (bfsRes && bfsRes.ok && typeof bfsRes.moves === 'string') ? bfsRes.moves : '';
                        pair = { keyA: merge.keyA, keyB: merge.keyB, idx: merge.idx, visitedDepth: merge.seenDepth, traceMoves, bfsMoves, bfs: bfsRes };
                        playTraceBtn.disabled = !traceMoves;
                        playBfsBtn.disabled = !bfsMoves;
                        dlPairBtn.disabled = !pair;
                        const info3 = document.createElement('div'); info3.className = 'solutionText';
                        info3.innerHTML = `trace len: ${traceMoves.length} | bfs len: ${bfsMoves.length}`;
                        const out3 = document.createElement('div'); out3.className = 'solutionItem'; const wrap3 = document.createElement('div'); wrap3.className = 'solutionActions';
                        wrap3.appendChild(info3); out3.appendChild(wrap3); solutionsEl && solutionsEl.appendChild(out3);
                      } catch (e) { alert('Get Both Paths failed: ' + (e?.message || e)); }
                    });
                    playTraceBtn.addEventListener('click', () => { try { if (pair?.traceMoves) onPlaySolution && onPlaySolution(pair.traceMoves); } catch {} });
                    playBfsBtn.addEventListener('click', () => { try { if (pair?.bfsMoves) onPlaySolution && onPlaySolution(pair.bfsMoves); } catch {} });
                    dlPairBtn.addEventListener('click', () => {
                      try { if (!pair) return; const blob = new Blob([JSON.stringify(pair, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'collision-paths.json'; a.click(); URL.revokeObjectURL(url); } catch {}
                    });
                  }
                } catch(e) { alert('TraceAlign failed: ' + (e?.message || e)); }
              });
              dlBtn2.addEventListener('click', () => {
                if (!lastAlign) return; try { const blob = new Blob([JSON.stringify(lastAlign, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'trace-align.json'; a.click(); URL.revokeObjectURL(url); } catch {}
              });
              // Find Path to StateKey (render once on the first solution)
              if (idx === 0) {
                const row3 = document.createElement('div');
                row3.className = 'solutionItem';
                const text3 = document.createElement('div');
                text3.className = 'solutionText';
                text3.textContent = 'Find path to StateKey (hex keyA, keyB):';
                row3.appendChild(text3);
                const actions3 = document.createElement('div');
                actions3.className = 'solutionActions';
                const kA = document.createElement('input');
                kA.type = 'text'; kA.placeholder = 'keyA (hex)'; kA.style.width = '150px'; kA.style.marginRight = '6px';
                const kB = document.createElement('input');
                kB.type = 'text'; kB.placeholder = 'keyB (hex)'; kB.style.width = '150px'; kB.style.marginRight = '6px';
                const findBtn = document.createElement('button'); findBtn.textContent = 'Find Path';
                const playBtn2 = document.createElement('button'); playBtn2.textContent = 'Play'; playBtn2.disabled = true;
                const dlBtn3 = document.createElement('button'); dlBtn3.textContent = 'Download JSON'; dlBtn3.disabled = true;
                actions3.appendChild(kA); actions3.appendChild(kB); actions3.appendChild(findBtn); actions3.appendChild(playBtn2); actions3.appendChild(dlBtn3);
                row3.appendChild(actions3);
                solutionsEl && solutionsEl.appendChild(row3);
                let lastFind = null; let lastMoves = '';
                findBtn.addEventListener('click', async () => {
                  const keyA = (kA.value || '').trim();
                  const keyB = (kB.value || '').trim();
                  if (!keyA || !keyB) { alert('Enter both keyA and keyB in hex'); return; }
                    const lvl = levelDtoFromReport(lastReport);
                    if (!lvl) { alert('No level snapshot available in last report. Run solver again first.'); return; }
                  try {
                    const cfg = { nodesCap: Number(document.getElementById('solverMaxNodes')?.value) || 200000, depthCap: Number(document.getElementById('solverMaxDepth')?.value) || 100, timeCapSeconds: 10.0, enforceTimeCap: false };
                    const res = await window.api.solverFindPathToKey(lvl, keyA, keyB, cfg);
                    lastFind = res;
                    lastMoves = (res && res.ok && typeof res.moves === 'string') ? res.moves : '';
                    playBtn2.disabled = !lastMoves;
                    dlBtn3.disabled = !res;
                    const info3 = document.createElement('div'); info3.className = 'solutionText';
                    info3.innerHTML = (res && res.ok) ? `len: ${res.length} moves: <b>${lastMoves}</b>` : `Not found (nodes: ${res?.nodesExplored ?? 'n/a'})`;
                    const out3 = document.createElement('div'); out3.className = 'solutionItem'; const wrap3 = document.createElement('div'); wrap3.className = 'solutionActions';
                    wrap3.appendChild(info3); out3.appendChild(wrap3); solutionsEl && solutionsEl.appendChild(out3);
                  } catch (e) { alert('FindPath failed: ' + (e?.message || e)); }
                });
                playBtn2.addEventListener('click', () => { if (!lastMoves) return; try { onPlaySolution && onPlaySolution(lastMoves); } catch {} });
                dlBtn3.addEventListener('click', () => { if (!lastFind) return; try { const blob = new Blob([JSON.stringify(lastFind, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'path-to-key.json'; a.click(); URL.revokeObjectURL(url); } catch {} });
              }
            } catch {}
          })();

          if (!solutions.length) {
            const empty = document.createElement('div');
            empty.className = 'solutionItem';
            const text = document.createElement('div');
            text.className = 'solutionText';
            text.textContent = 'No solutions found (within current limits).';
            empty.appendChild(text);

            // Add a Download Report button so failures can be exported
            const actions = document.createElement('div');
            actions.className = 'solutionActions';
            const exportBtn = document.createElement('button');
            exportBtn.textContent = 'Download Fail Report';
            exportBtn.title = 'Export full solver JSON report for this run';
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

            // DFS Fallback button
            const dfsBtn = document.createElement('button');
            dfsBtn.textContent = 'Run DFS Fallback';
            dfsBtn.title = 'Try depth-first search (slower, different pruning)';
              dfsBtn.addEventListener('click', async () => {
                try {
                  const maxDepth = Number(document.getElementById('solverMaxDepth').value);
                  const maxNodes = Number(document.getElementById('solverMaxNodes').value);
                  await onRunSolver({
                    maxDepth,
                    maxNodes,
                  useBfs: false,
                  disableVisited: true,
                  onProgress: (t) => { if (statusEl) statusEl.textContent = t; },
                  onSolutions: (result = {}) => {
                    try { console.debug && console.debug('[HUD] DFS fallback result', result); } catch {}
                    // Replace the current rendering with DFS results by simulating a run click
                    lastReport = result.reportRaw || lastReport;
                    const evt = new Event('click');
                    document.getElementById('runSolver').dispatchEvent(evt);
                  }
                });
              } catch (e) {
                alert('DFS fallback failed: ' + (e?.message || e));
              }
            });
            actions.appendChild(dfsBtn);
            empty.appendChild(actions);

            if (solutionsEl) solutionsEl.appendChild(empty);
          }

          // Also surface the Find Path to StateKey controls when there are no solutions (or always after a run)
          (function addFindPathUI() {
            try {
              const row = document.createElement('div');
              row.className = 'solutionItem';
              const text = document.createElement('div');
              text.className = 'solutionText';
              text.textContent = 'Find path to StateKey (hex keyA, keyB):';
              row.appendChild(text);
              const actions = document.createElement('div');
              actions.className = 'solutionActions';
              const kA = document.createElement('input');
              kA.type = 'text'; kA.placeholder = 'keyA (hex)'; kA.style.width = '150px'; kA.style.marginRight = '6px';
              const kB = document.createElement('input');
              kB.type = 'text'; kB.placeholder = 'keyB (hex)'; kB.style.width = '150px'; kB.style.marginRight = '6px';
              const findBtn = document.createElement('button'); findBtn.textContent = 'Find Path';
              const playBtn = document.createElement('button'); playBtn.textContent = 'Play'; playBtn.disabled = true;
              const dlBtn = document.createElement('button'); dlBtn.textContent = 'Download JSON'; dlBtn.disabled = true;
              actions.appendChild(kA); actions.appendChild(kB); actions.appendChild(findBtn); actions.appendChild(playBtn); actions.appendChild(dlBtn);
              row.appendChild(actions);
              solutionsEl && solutionsEl.appendChild(row);
              let lastFind = null; let lastMoves = '';
              findBtn.addEventListener('click', async () => {
                const keyA = (kA.value || '').trim();
                const keyB = (kB.value || '').trim();
                if (!keyA || !keyB) { alert('Enter both keyA and keyB in hex'); return; }
                const lvl = levelDtoFromReport(lastReport);
                if (!lvl) { alert('No level snapshot available in last report. Run solver again first.'); return; }
                try {
                  const cfg = { nodesCap: Number(document.getElementById('solverMaxNodes')?.value) || 200000, depthCap: Number(document.getElementById('solverMaxDepth')?.value) || 100, timeCapSeconds: 10.0, enforceTimeCap: false };
                  const res = await window.api.solverFindPathToKey(lvl, keyA, keyB, cfg);
                  lastFind = res;
                  lastMoves = (res && res.ok && typeof res.moves === 'string') ? res.moves : '';
                  playBtn.disabled = !lastMoves;
                  dlBtn.disabled = !res;
                  const info = document.createElement('div'); info.className = 'solutionText';
                  info.innerHTML = (res && res.ok) ? `len: ${res.length} moves: <b>${lastMoves}</b>` : `Not found (nodes: ${res?.nodesExplored ?? 'n/a'})`;
                  const out = document.createElement('div'); out.className = 'solutionItem'; const wrap = document.createElement('div'); wrap.className = 'solutionActions';
                  wrap.appendChild(info); out.appendChild(wrap); solutionsEl && solutionsEl.appendChild(out);
                } catch (e) { alert('FindPath failed: ' + (e?.message || e)); }
              });
              playBtn.addEventListener('click', () => { if (!lastMoves) return; try { onPlaySolution && onPlaySolution(lastMoves); } catch {} });
              dlBtn.addEventListener('click', () => { if (!lastFind) return; try { const blob = new Blob([JSON.stringify(lastFind, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'path-to-key.json'; a.click(); URL.revokeObjectURL(url); } catch {} });
            } catch {}
          })();

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


