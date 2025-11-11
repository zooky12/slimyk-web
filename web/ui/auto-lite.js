// ui/auto-lite.js - cleaned and functional Auto Creator UI
import { drawToCanvas } from "./canvas.js";
export function setupAutoLiteUI(api) {
  try {
    /* console.log('[auto-lite] setup start') */
  } catch {}
  // Lightweight worker RPC for ALD (fallback to main-thread API if worker fails)
  function makeAldProxy(api) {
    try {
      const worker = new Worker(
        new URL("../workers/ald-worker.js", import.meta.url),
        { type: "module" }
      );
      let nextId = 1;
      const pending = new Map();
      worker.onmessage = (ev) => {
        const { id, ok, result, error } = ev.data || {};
        const f = pending.get(id);
        if (!f) return;
        pending.delete(id);
        if (ok) f.resolve(result);
        else f.reject(new Error(error || "worker_error"));
      };
      const call = (cmd, ...args) =>
        new Promise((resolve, reject) => {
          const id = nextId++;
          pending.set(id, { resolve, reject });
          worker.postMessage({ id, cmd, args });
        });
      // init runtime once
      call("init", { baseUrl: "../wasm/" }).catch(() => {});
      return {
        aldNewContext: (settings) => call("aldNewContext", settings),
        aldCloseContext: (ctxId) => call("aldCloseContext", ctxId),
        aldInsertCandidate: (ctxId, level, cfg) =>
          call("aldInsertCandidate", ctxId, level, cfg),
        aldGetBucketsSummary: (ctxId) => call("aldGetBucketsSummary", ctxId),
        aldSelectBaseCtx: (ctxId, topK, skew) =>
          call("aldSelectBaseCtx", ctxId, topK, skew),
        aldMutate: (ctxId, base, mutate) =>
          call("aldMutate", ctxId, base, mutate),
        aldPlaceOne: (level, opts) => call("aldPlaceOne", level, opts),
        aldRemoveOne: (level, opts) => call("aldRemoveOne", level, opts),
        __dispose: () => worker.terminate(),
      };
    } catch {
      return api; // fallback
    }
  }
  const ald = makeAldProxy(api);
  const tilesChips = document.getElementById("autoTilesChips");
  const entsChips = document.getElementById("autoEntitiesChips");
  const addBucketBtn = document.getElementById("addBucket");
  const bucketRows = document.getElementById("bucketRows");
  const runBtn = document.getElementById("runAuto");
  const stopBtn = document.getElementById("stopAuto");
  const restoreBtn = document.getElementById("autoRestore");
  const exportBtn = document.getElementById("autoExport");
  const importBtn = document.getElementById("autoImport");
  const importFile = document.getElementById("autoImportFile");
  const progressEl = document.getElementById("autoProgress");
  const toggleBtn = document.getElementById("toggleAuto");
  const panelEl = document.getElementById("autoPanel");
  // Preview UI elements
  const previewPanel = document.getElementById("autoPreview");
  const previewCanvas = document.getElementById("autoPreviewCanvas");
  const previewInfo = document.getElementById("autoPreviewInfo");
  // Preview config controls (interval + refresh-on-show)
  try {
    if (previewPanel && !previewPanel.dataset.previewControlsBound) {
      previewPanel.dataset.previewControlsBound = "1";
      const ctrl = document.createElement("div");
      ctrl.className = "levels-row";
      // Interval input
      const lblEvery = document.createElement("label");
      lblEvery.textContent = "Preview every";
      lblEvery.style.marginRight = "8px";
      const inpEvery = document.createElement("input");
      inpEvery.type = "number";
      inpEvery.min = "1";
      inpEvery.step = "1";
      inpEvery.id = "autoPreviewEvery";
      inpEvery.title = "Show preview after this many candidates";
      inpEvery.style.width = "72px";
      // Default of 10 to match previous behavior
      if (!inpEvery.value) inpEvery.value = "10";
      // Refresh checkbox
      const lblRefresh = document.createElement("label");
      lblRefresh.style.marginLeft = "16px";
      const cbRefresh = document.createElement("input");
      cbRefresh.type = "checkbox";
      cbRefresh.id = "autoPreviewRefreshAfter";
      cbRefresh.style.marginRight = "6px";
      lblRefresh.appendChild(cbRefresh);
      lblRefresh.appendChild(document.createTextNode("Refresh candidate after showing"));
      // Assemble
      ctrl.appendChild(lblEvery);
      ctrl.appendChild(inpEvery);
      ctrl.appendChild(lblRefresh);
      // Insert controls near top of preview panel
      try { previewPanel.insertBefore(ctrl, previewPanel.firstChild); } catch { previewPanel.appendChild(ctrl); }
    }
  } catch {}
  // Bind the Auto panel toggle ASAP so the button always works
  try {
    if (toggleBtn && panelEl && toggleBtn.dataset.bound !== "1") {
      toggleBtn.dataset.bound = "1";
      toggleBtn.addEventListener("click", () => {
        const expanded = toggleBtn.getAttribute("aria-pressed") === "true";
        const next = !expanded;
        dlog("[mask] auto toggle clicked", { next });
        try {
          window.__closePanelsExcept &&
            window.__closePanelsExcept(next ? "auto" : "");
        } catch {}
        toggleBtn.setAttribute("aria-pressed", next ? "true" : "false");
        toggleBtn.classList.toggle("active", next);
        // Keep both class and ARIA/state in sync; also set inline display for robustness
        panelEl.classList.toggle("hidden", !next);
        panelEl.setAttribute("aria-hidden", next ? "false" : "true");
        panelEl.style.display = next ? "" : "none";
        // If opening Auto panel, ensure mask is ready and draw once
        if (next) {
          try {
            ensureMaskFromCurrentLevel();
            renderMask();
            requestAnimationFrame(() => {
              try {
                renderMask();
              } catch {}
            });
          } catch {}
        }
        // Optional UX: reflect the state in the button label if it uses the stock text
        try {
          const txt = String(toggleBtn.textContent || "").toLowerCase();
          const isDefault = txt.includes("auto creator");
          if (isDefault)
            toggleBtn.textContent = next
              ? "Hide Auto Creator"
              : "Show Auto Creator";
        } catch {}
      });
      // Prevent game key handling while typing within panel
      panelEl.addEventListener("keydown", (e) => e.stopPropagation());
    }
  } catch {}
  // Mask UI elements
  const maskPanel = document.getElementById("autoMask");
  const maskCanvas = document.getElementById("autoMaskCanvas");
  const maskAllowBtn = document.getElementById("maskModeAllow");
  const maskBlockBtn = document.getElementById("maskModeBlock");
  const maskEntBtn = document.getElementById("maskModeEntities");
  const maskClearBtn = document.getElementById("maskClearBtn");
  // Bind collapsible sections (Tiles/Entities/Trace Filters, etc.)
  try {
    const bindOne = (btn) => {
      const targetId = btn.getAttribute("data-target");
      const panel = targetId ? document.getElementById(targetId) : null;
      if (!panel) return;
      // Ensure initial ARIA / display matches markup
      const initExpanded = btn.getAttribute("aria-expanded") === "true";
      panel.classList.toggle("hidden", !initExpanded);
      panel.setAttribute("aria-hidden", (!initExpanded).toString());
      if (!initExpanded) panel.style.display = "none";
      btn.addEventListener("click", (e) => {
        try {
          e.preventDefault();
          e.stopPropagation();
        } catch {}
        const expanded = btn.getAttribute("aria-expanded") === "true";
        const next = !expanded;
        btn.setAttribute("aria-expanded", next ? "true" : "false");
        panel.classList.toggle("hidden", !next);
        panel.setAttribute("aria-hidden", (!next).toString());
        // Also toggle inline display to be robust against CSS defaults
        panel.style.display = next ? "" : "none";
        // If opening mask panel, ensure we have a grid and draw once
        try {
          if (next && targetId === "autoMask") {
            dlog("[mask] mask section toggled open");
            ensureMaskFromCurrentLevel();
            renderMask();
            try {
              requestAnimationFrame(() => {
                try {
                  renderMask();
                } catch {}
              });
            } catch {}
          } else if (!next && targetId === "autoPreview" && previewCanvas) {
            // Clear preview when panel is closed
            try {
              const cx = previewCanvas.getContext("2d");
              cx &&
                cx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
            } catch {}
            try {
              if (previewInfo)
                previewInfo.textContent = "Best shortest steps: -";
            } catch {}
          }
        } catch {}
      });
    };
    document.querySelectorAll(".tile-toggle").forEach(bindOne);
    // Fallback: delegate clicks for late-loaded nodes
    document.addEventListener(
      "click",
      (ev) => {
        const btn =
          ev.target &&
          ev.target.closest &&
          ev.target.closest("button.tile-toggle");
        if (!btn) return;
        const tid = btn.getAttribute("data-target");
        const pnl = tid && document.getElementById(tid);
        if (!pnl) return;
        try {
          ev.preventDefault();
          ev.stopPropagation();
        } catch {}
        const expanded = btn.getAttribute("aria-expanded") === "true";
        const next = !expanded;
        btn.setAttribute("aria-expanded", next ? "true" : "false");
        pnl.classList.toggle("hidden", !next);
        pnl.setAttribute("aria-hidden", (!next).toString());
        pnl.style.display = next ? "" : "none";
        try {
          if (next && tid === "autoMask") {
            dlog("[mask] mask section toggled open (delegated)");
            ensureMaskFromCurrentLevel();
            renderMask();
            try {
              requestAnimationFrame(() => {
                try {
                  renderMask();
                } catch {}
              });
            } catch {}
          } else if (!next && tid === "autoPreview" && previewCanvas) {
            try {
              const cx = previewCanvas.getContext("2d");
              cx &&
                cx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
            } catch {}
            try {
              if (previewInfo)
                previewInfo.textContent = "Best shortest steps: -";
            } catch {}
          }
        } catch {}
      },
      true
    );
  } catch {}

  // --- helpers
  const nice = (name) =>
    String(name || "")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/_/g, " ")
      .replace(/^./, (c) => c.toUpperCase());

  // Debug logging helper (toggle at one place)
  const DEBUG = { mask: false };
  function dlog(...args) {
    try {
      if (!DEBUG.mask) return;
      const log = (console && console.log) || null;
      if (log) log.apply(console, args);
    } catch {}
  }
  function bindChipToggles(root) {
    if (!root) return;
    root.addEventListener("click", (e) => {
      const btn = e.target?.closest?.("button.tile-chip");
      if (!btn || !root.contains(btn)) return;
      const on = btn.classList.toggle("active");
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }
  // --- Mask state & helpers
  const maskState = { grid: null, w: 0, h: 0, paintMode: "all" };
  function ensureMaskFromCurrentLevel() {
    try {
      const draw = api.getState();
      const w = draw?.w | 0,
        h = draw?.h | 0;
      if (!w || !h) return;
      if (maskState.w !== w || maskState.h !== h || !maskState.grid) {
        maskState.w = w;
        maskState.h = h;
        maskState.grid = Array.from({ length: h }, () => Array(w).fill(2));
        dlog("[mask] ensure new grid", { w, h });
        try {
          if (maskCanvas) {
            maskCanvas.style.position = "relative";
            maskCanvas.style.zIndex = "10";
            maskCanvas.style.opacity = "1";
            maskCanvas.style.mixBlendMode = "normal";
            maskCanvas.style.filter = "none";
          }
        } catch {}
        renderMask();
      } else {
        dlog("[mask] ensure existing grid", { w, h });
      }
    } catch {}
  }
  function renderMask() {
    try {
      dlog("[mask] renderMask() start");
      if (!maskCanvas || !maskState.grid) {
        dlog("[mask] render skipped: missing canvas or grid");
        return;
      }
      const w = maskState.w,
        h = maskState.h;
      let ctx = null;
      try {
        ctx = maskCanvas.getContext("2d");
      } catch (e) {
        /* ignore */
      }
      dlog("[mask] ctx ok?", !!ctx);
      if (!ctx) {
        (console.warn || console.log) &&
          (console.warn || console.log)("[mask] 2D context not available");
        return;
      }
      const parent = maskCanvas.parentElement;
      const pw = parent?.clientWidth || 320;
      // Prefer copying from the main game canvas for perfect parity
      const gameCanvas = document.getElementById("game");
      const srcW = gameCanvas?.width | 0;
      const srcH = gameCanvas?.height | 0;
      if (gameCanvas && srcW > 0 && srcH > 0) {
        const aspect = srcH / Math.max(1, srcW);
        const destW = Math.max(10, Math.floor(pw));
        const destH = Math.max(10, Math.floor(destW * aspect));
        maskCanvas.width = destW;
        maskCanvas.height = destH;
      } else {
        const preCell = Math.max(10, Math.floor(pw / Math.max(1, w)));
        maskCanvas.width = w * preCell;
        maskCanvas.height = h * preCell;
      }
      try {
        maskCanvas.style.removeProperty("background");
        maskCanvas.style.removeProperty("z-index");
        maskCanvas.style.removeProperty("transform");
      } catch {}
      ctx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
      dlog("[mask] render begin", {
        w,
        h,
        pw,
        cw: maskCanvas.width,
        ch: maskCanvas.height,
      });

      // Draw snapshot tiles as base
      let draw = null;
      try {
        draw = api.getState ? api.getState() : null;
      } catch (e) {
        console.warn && console.warn("[mask] getState error", e);
      }
      // Build a local tileId->name map (avoid relying on external helper)
      let tileIdToName = {};
      try {
        const tiles =
          typeof api.getTiles === "function" ? api.getTiles() || [] : [];
        for (const t of tiles)
          if (t && Number.isInteger(t.id)) tileIdToName[String(t.id)] = t.name;
        // dlog('[mask] tileIdToName size', Object.keys(tileIdToName).length);
      } catch (e) {
        console.warn && console.warn("[mask] getTiles error", e);
        tileIdToName = {};
      }
      const isArrayLike = (v) =>
        Array.isArray(v) ||
        (typeof ArrayBuffer !== "undefined" &&
          ArrayBuffer.isView &&
          ArrayBuffer.isView(v)) ||
        (!!v && typeof v.length === "number");
      try {
        const tiles = draw?.tiles;
        const tlen = tiles?.length | 0;
        const typed =
          (typeof ArrayBuffer !== "undefined" &&
            ArrayBuffer.isView &&
            ArrayBuffer.isView(tiles)) ||
          false;
        const preview = tlen
          ? Array.from(tiles).slice(0, Math.min(24, tlen))
          : [];
        const catalogSize = tileIdToName ? Object.keys(tileIdToName).length : 0;
        dlog("[mask] draw dto", {
          w: draw?.w,
          h: draw?.h,
          tlen,
          typed,
          preview,
          catalogSize,
        });
        if (tlen) {
          const hist = {};
          for (let i = 0; i < tlen; i++) {
            const v = tiles[i] | 0;
            hist[v] = (hist[v] | 0) + 1;
            if (i > 4096) break;
          }
          const keys = Object.keys(hist).slice(0, 10);
          dlog(
            "[mask] tile histogram",
            keys.reduce((o, k) => {
              o[k] = hist[k];
              return o;
            }, {})
          );
        }
      } catch {}
      // Use colors close to the main renderer (ui/canvas.js)
      const colorForTile = (name) => {
        const n = String(name || "").toLowerCase();
        if (!n) return "#111826";
        if (n.includes("wall")) return "#707070";
        if (n.includes("hole")) return "#060606";
        if (n.includes("exit")) return "#54d39b";
        if (n.includes("spike")) return "#c0392b";
        if (n.includes("fragile")) return "#86796d";
        if (n.includes("ice")) return "#bfe8ff";
        if (n.includes("slimpath")) return "#d7d7d7";
        if (n.includes("buttonred")) return "#e74c3c";
        if (n.includes("buttongreen") || n.includes("button")) return "#54d39b";
        // default: floor-ish
        return "#fafafa";
      };
      function drawTileDetail(name, x, y, size) {
        try {
          const n = String(name || "").toLowerCase();
          const px = x,
            py = y,
            s = size;
          // Grill: thin grid lines
          if (n.includes("gril") || n.includes("grill")) {
            const lw = Math.max(1, Math.floor(s * 0.06));
            const step = Math.max(3, Math.floor(s / 4));
            const prev = ctx.lineWidth;
            const prevStyle = ctx.strokeStyle;
            ctx.lineWidth = lw;
            ctx.strokeStyle = "rgba(230,233,255,0.35)";
            for (let i = step; i < s; i += step) {
              ctx.beginPath();
              ctx.moveTo(px + i + 0.5, py);
              ctx.lineTo(px + i + 0.5, py + s);
              ctx.stroke();
              ctx.beginPath();
              ctx.moveTo(px, py + i + 0.5);
              ctx.lineTo(px + s, py + i + 0.5);
              ctx.stroke();
            }
            ctx.lineWidth = prev;
            ctx.strokeStyle = prevStyle;
          }
          // Spikes: draw an X pattern
          else if (n.includes("spike")) {
            const lw = Math.max(2, Math.floor(s * 0.1));
            const prev = ctx.lineWidth;
            const prevStyle = ctx.strokeStyle;
            ctx.lineWidth = lw;
            ctx.strokeStyle = "#c0392b";
            ctx.beginPath();
            ctx.moveTo(px + 2, py + 2);
            ctx.lineTo(px + s - 2, py + s - 2);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(px + s - 2, py + 2);
            ctx.lineTo(px + 2, py + s - 2);
            ctx.stroke();
            ctx.lineWidth = prev;
            ctx.strokeStyle = prevStyle;
          }
          // Buttons/plates: draw a centered circle
          else if (
            n.includes("button") ||
            n.includes("plate") ||
            n.includes("pressure")
          ) {
            const r = Math.max(3, Math.floor(s * 0.28));
            const cx = px + s / 2,
              cy = py + s / 2;
            const fill = n.includes("red") ? "#e74c3c" : "#54d39b";
            ctx.beginPath();
            ctx.fillStyle = fill;
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
            ctx.fill();
          }
        } catch {}
      }
      const fallbackColorForId = (id) => {
        switch (id | 0) {
          case 1:
            return "#707070"; // wall
          case 2:
            return "#060606"; // hole
          case 16:
            return "#54d39b"; // exit-ish
          case 0:
            return "#fafafa"; // floor-ish
          default:
            return "#cccccc"; // generic
        }
      };

      // Always paint a checkerboard background so something is visible
      // No checkerboard; use a subtle dark base to match app aesthetic
      try {
        ctx.fillStyle = "rgba(0,0,0,0.25)";
        ctx.fillRect(0, 0, maskCanvas.width, maskCanvas.height);
      } catch (e) {
        /* ignore */
      }

      if (
        draw &&
        isArrayLike(draw.tiles) &&
        Number.isInteger(draw.w) &&
        Number.isInteger(draw.h) &&
        (draw.w | 0) === (w | 0) &&
        (draw.h | 0) === (h | 0)
      ) {
        try {
          if (gameCanvas && srcW > 0 && srcH > 0) {
            // Copy the already-rendered main canvas into the mask canvas (scaled to fit)
            ctx.drawImage(
              gameCanvas,
              0,
              0,
              srcW,
              srcH,
              0,
              0,
              maskCanvas.width,
              maskCanvas.height
            );
          } else {
            // Fallback: render via the shared renderer
            drawToCanvas(maskCanvas, draw);
          }
        } catch (e) {
          /* ignore */
        }
      }

      // Derive actual tile cell size from what drawToCanvas chose
      const cell = maskCanvas.width / Math.max(1, w);

      // Overlay mask: 1 = entities-only (amber), 0 = blocked (red)
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const v = maskState.grid[y][x] | 0;
          if (v === 1) {
            ctx.fillStyle = "rgba(246, 181, 39, 0.32)";
            ctx.fillRect(x * cell, y * cell, cell, cell);
          } else if (v === 0) {
            ctx.fillStyle = "rgba(220, 62, 62, 0.36)";
            ctx.fillRect(x * cell, y * cell, cell, cell);
          }
        }
      }

      // No extra grid lines to match main aesthetic
      dlog("[mask] render done");
    } catch (e) {
      /* ignore */
    }
  }
  // Kick off the main Auto UI wiring block (defined below). Hoisted function call is safe.
  bindMaskPainting();

  function bindMaskPainting() {
    // Attach mouse/touch handlers for painting on the mask canvas
    function attachMaskCanvasEvents() {
      if (!maskCanvas) return;
      const cellFromEvent = (ev) => {
        const rect = maskCanvas.getBoundingClientRect();
        const px =
          (ev.touches ? ev.touches[0].clientX : ev.clientX) - rect.left;
        const py = (ev.touches ? ev.touches[0].clientY : ev.clientY) - rect.top;
        const cellW = maskCanvas.width / Math.max(1, maskState.w);
        const cellH = maskCanvas.height / Math.max(1, maskState.h);
        const x = Math.floor(px / cellW),
          y = Math.floor(py / cellH);
        return { x, y };
      };
      let painting = false;
      const paintAt = (x, y) => {
        if (!maskState.grid) return;
        if (x < 0 || y < 0 || x >= maskState.w || y >= maskState.h) return;
        maskState.grid[y][x] =
          maskState.paintMode === "all"
            ? 2
            : maskState.paintMode === "entities"
            ? 1
            : 0;
        renderMask();
      };
      const start = (ev) => {
        ensureMaskFromCurrentLevel();
        painting = true;
        const { x, y } = cellFromEvent(ev);
        dlog("[mask] paint start", { x, y, mode: maskState.paintMode });
        paintAt(x, y);
        ev.preventDefault();
      };
      const move = (ev) => {
        if (!painting) return;
        const { x, y } = cellFromEvent(ev);
        dlog("[mask] paint move", { x, y });
        paintAt(x, y);
        ev.preventDefault();
      };
      const end = () => {
        painting = false;
        dlog("[mask] paint end");
      };
      maskCanvas.addEventListener("mousedown", start);
      maskCanvas.addEventListener("mousemove", move);
      window.addEventListener("mouseup", end);
      maskCanvas.addEventListener("touchstart", start, { passive: false });
      maskCanvas.addEventListener("touchmove", move, { passive: false });
      maskCanvas.addEventListener("touchend", end);
      window.addEventListener("resize", renderMask);
    }
    if (maskAllowBtn)
      maskAllowBtn.addEventListener("click", () => {
        maskState.paintMode = "all";
        maskAllowBtn.classList.add("active");
        const ebtn = document.getElementById("maskModeEntities");
        if (ebtn) ebtn.classList.remove("active");
        if (maskBlockBtn) maskBlockBtn.classList.remove("active");
      });
    if (maskEntBtn)
      maskEntBtn.addEventListener("click", () => {
        maskState.paintMode = "entities";
        maskEntBtn.classList.add("active");
        if (maskAllowBtn) maskAllowBtn.classList.remove("active");
        if (maskBlockBtn) maskBlockBtn.classList.remove("active");
      });
    if (maskBlockBtn)
      maskBlockBtn.addEventListener("click", () => {
        maskState.paintMode = "block";
        maskBlockBtn.classList.add("active");
        const ebtn = document.getElementById("maskModeEntities");
        if (ebtn) ebtn.classList.remove("active");
        if (maskAllowBtn) maskAllowBtn.classList.remove("active");
      });
    if (maskClearBtn)
      maskClearBtn.addEventListener("click", () => {
        ensureMaskFromCurrentLevel();
        if (maskState.grid) {
          for (let y = 0; y < maskState.h; y++)
            for (let x = 0; x < maskState.w; x++) maskState.grid[y][x] = 2;
          renderMask();
        }
      });
    if (maskCanvas) {
      ensureMaskFromCurrentLevel();
      attachMaskCanvasEvents();
      renderMask();
    }
    // Expose simple debug helpers
    try {
      window.autoMaskDebug = {
        ensure: () => {
          try {
            ensureMaskFromCurrentLevel();
            console.log("[mask] ensure called");
          } catch (e) {
            console.warn("[mask] ensure error", e);
          }
        },
        render: () => {
          try {
            renderMask();
            console.log("[mask] render called");
          } catch (e) {
            console.warn("[mask] render error", e);
          }
        },
        info: () => ({
          w: maskState.w,
          h: maskState.h,
          canvas: { w: maskCanvas?.width, h: maskCanvas?.height },
        }),
      };
      console.log("[mask] debug helpers on window.autoMaskDebug");
    } catch {}
    function createChipRow(kind, name, label, defaults) {
      const row = document.createElement("div");
      row.className = "chip-row";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "tile-chip";
      if (kind === "tile") btn.dataset.tile = name;
      else btn.dataset.entity = name;
      btn.setAttribute("aria-pressed", "false");
      btn.textContent = label;
      const min = document.createElement("input");
      min.type = "number";
      min.placeholder = "min -1";
      min.title = "Min count (-1 = no limit)";
      min.className = "count-input min";
      min.dataset.kind = kind;
      min.dataset.name = name;
      min.style.width = "60px";
      const max = document.createElement("input");
      max.type = "number";
      max.placeholder = "max -1";
      max.title = "Max count (-1 = no limit)";
      max.className = "count-input max";
      max.dataset.kind = kind;
      max.dataset.name = name;
      max.style.width = "60px";
      // Defaults: -1 means unused; keep existing safe defaults for Exit/PlayerSpawn
      const dmin =
        defaults && Number.isFinite(defaults.min) ? Number(defaults.min) : -1;
      const dmax =
        defaults && Number.isFinite(defaults.max) ? Number(defaults.max) : -1;
      min.value = String(dmin);
      max.value = String(dmax);
      row.appendChild(btn);
      row.appendChild(min);
      row.appendChild(max);
      return row;
    }
    // (legacy scoring/helpers removed; C# context owns scoring and filtering)
    function unpackMovesPacked(bytes, length) {
      const dirToChar = ["w", "d", "s", "a"]; // N,E,S,W
      if (!bytes || length <= 0) return "";
      let arr;
      if (typeof bytes === "string") {
        try {
          const bin = atob(bytes);
          arr = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        } catch {
          arr = [];
        }
      } else if (Array.isArray(bytes)) arr = bytes;
      else if (bytes && typeof bytes.length === "number")
        arr = Array.from(bytes);
      else arr = [];
      const out = [];
      for (let i = 0; i < length; i++) {
        const byteIdx = i >> 2;
        const shift = (i & 3) * 2;
        const mv = ((arr[byteIdx] || 0) >> shift) & 0b11;
        out.push(dirToChar[mv] || "");
      }
      return out.join("");
    }

    // Fill walls and remove entities outside reachable region (simple passability: non-wall)
    function fillWallsOnLevel(lvl) {
      try {
        if (
          !lvl ||
          !Array.isArray(lvl.tileGrid) ||
          !Array.isArray(lvl.entities)
        )
          return lvl;
        const h = lvl.tileGrid.length | 0;
        const w = h > 0 ? lvl.tileGrid[0]?.length | 0 : 0;
        const grid = lvl.tileGrid;
        // find player
        const ps = (lvl.entities || []).find(
          (e) => e && e.type === "PlayerSpawn"
        );
        if (!ps) return lvl;
        const px = ps.x | 0,
          py = ps.y | 0;
        const passable = (x, y) => {
          const name = (grid[y]?.[x] || "Floor").toLowerCase();
          return name !== "wall";
        };
        const seen = Array.from({ length: h }, () => Array(w).fill(false));
        const q = [];
        if (px >= 0 && py >= 0 && px < w && py < h && passable(px, py)) {
          seen[py][px] = true;
          q.push({ x: px, y: py });
        }
        const dirs = [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ];
        while (q.length) {
          const { x, y } = q.shift();
          for (const [dx, dy] of dirs) {
            const nx = x + dx,
              ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            if (seen[ny][nx]) continue;
            if (!passable(nx, ny)) continue;
            seen[ny][nx] = true;
            q.push({ x: nx, y: ny });
          }
        }
        // fill walls
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            if (!seen[y][x]) grid[y][x] = "Wall";
          }
        }
        // remove entities outside
        lvl.entities = (lvl.entities || []).filter(
          (e) =>
            e && e.x >= 0 && e.y >= 0 && e.x < w && e.y < h && seen[e.y][e.x]
        );
        return lvl;
      } catch {
        return lvl;
      }
    }

    // Cache shortest-solution move strings per base level (keyed by JSON signature)
    const baseSolutionCache = new Map();

    function levelKey(dto) {
      try {
        // Stable-ish signature for caching; compact to reduce memory
        const ents = Array.from(dto.entities || [])
          .map(
            (e) =>
              `${e.type}@${e.x},${e.y}${
                e.orientation ? `:${e.orientation}` : ``
              }`
          )
          .sort();
        return JSON.stringify({
          w: dto.width | 0,
          h: dto.height | 0,
          t: dto.tileGrid,
          e: ents,
        });
      } catch {
        return JSON.stringify(dto || {});
      }
    }

    async function getShortestMovesForBase(baseDto, solverCfg) {
      const key = levelKey(baseDto);
      if (baseSolutionCache.has(key)) return baseSolutionCache.get(key);
      try {
        const rep = await api.solverAnalyze(baseDto, solverCfg);
        const top = rep && rep.topSolutions && rep.topSolutions[0];
        if (!top || !top.length || !top.movesPacked) {
          baseSolutionCache.set(key, null);
          return null;
        }
        const moves = unpackMovesPacked(top.movesPacked, top.length);
        baseSolutionCache.set(key, moves);
        return moves;
      } catch {
        baseSolutionCache.set(key, null);
        return null;
      }
    }

    async function sequenceSolvesLevel(levelDto, movesStr) {
      if (!movesStr || !movesStr.length) return false;
      try {
        // Create an isolated session for fast simulation
        const sid = api.initLevel(levelDto);
        const charToDir = { w: 0, d: 1, s: 2, a: 3 };
        for (let i = 0; i < movesStr.length; i++) {
          const c = movesStr[i];
          const dir = charToDir[c];
          if (dir == null) continue;
          const r = api.stepAndState(sid, dir);
          const step = r && r.step;
          if (step && step.win) return true; // solved by prefix of base solution
          if (step && step.lose) return false; // dead early => can't be same solution
        }
        return false;
      } catch {
        return false;
      }
    }

    // Compute visited cells for a move sequence on a given level (for path-biased edits)
    async function computeVisitedCellsFromMoves(levelDto, movesStr) {
      const w = (levelDto && levelDto.width) | 0;
      const h = (levelDto && levelDto.height) | 0;
      const visited = Array.from({ length: h }, () => Array(w).fill(false));
      if (!movesStr || !movesStr.length || !w || !h) return visited;
      try {
        const sid = api.initLevel(levelDto);
        // Try to record starting position if available
        try {
          const dto0 =
            typeof api.getState === "function" ? api.getState(sid) : null;
          const px0 = dto0?.player?.x,
            py0 = dto0?.player?.y;
          if (
            Number.isInteger(px0) &&
            Number.isInteger(py0) &&
            py0 >= 0 &&
            py0 < h &&
            px0 >= 0 &&
            px0 < w
          )
            visited[py0][px0] = true;
        } catch {}
        const charToDir = { w: 0, d: 1, s: 2, a: 3 };
        for (let i = 0; i < movesStr.length; i++) {
          const c = movesStr[i];
          const dir = charToDir[c];
          if (dir == null) continue;
          const r = api.stepAndState(sid, dir);
          const dto = r && (r.state || r.draw || r.dto);
          const px = dto?.player?.x,
            py = dto?.player?.y;
          if (
            Number.isInteger(px) &&
            Number.isInteger(py) &&
            py >= 0 &&
            py < h &&
            px >= 0 &&
            px < w
          )
            visited[py][px] = true;
          const step = r && r.step;
          if (step && (step.win || step.lose)) break;
        }
      } catch {}
      return visited;
    }

    // Edit-distance on small strings (moves similarity check)
    function editDistance(a, b) {
      a = String(a || "");
      b = String(b || "");
      const n = a.length,
        m = b.length;
      if (!n) return m;
      if (!m) return n;
      const dp = new Array(m + 1);
      for (let j = 0; j <= m; j++) dp[j] = j;
      for (let i = 1; i <= n; i++) {
        let prev = i - 1; // dp[i-1][j-1]
        dp[0] = i;
        for (let j = 1; j <= m; j++) {
          const t = dp[j];
          const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
          dp[j] = Math.min(
            dp[j] + 1, // delete
            dp[j - 1] + 1, // insert
            prev + cost // replace
          );
          prev = t;
        }
      }
      return dp[m];
    }
    function catalogs() {
      const tiles =
        (typeof api.getTiles === "function" ? api.getTiles() : []) || [];
      const ents =
        (typeof api.getEntities === "function" ? api.getEntities() : []) || [];
      const tileIdToName = Object.create(null);
      const entIdToName = Object.create(null);
      for (const t of tiles) if (t) tileIdToName[t.id] = t.name;
      for (const e of ents) if (e) entIdToName[e.id] = e.name;
      return { tiles, ents, tileIdToName, entIdToName };
    }
    function toDrawFromLevelDTO(level, nameToTileId, nameToEntId) {
      try {
        const w = level?.width | 0 || 0;
        const h = level?.height | 0 || 0;
        const tiles = new Array(Math.max(0, w * h)).fill(0);
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const name = String(level?.tileGrid?.[y]?.[x] || "Floor");
            const id = nameToTileId && nameToTileId[name];
            tiles[y * w + x] = Number.isInteger(id) ? id | 0 : 0;
          }
        }
        const entities = [];
        let player = null;
        // Build id->name map from provided name->id for entity detection (PlayerSpawn)
        const idToEntName = Object.create(null);
        try {
          for (const nm in nameToEntId || {}) {
            const id = nameToEntId[nm];
            if (Number.isInteger(id)) idToEntName[id | 0] = nm;
          }
        } catch {}
        for (const e of level?.entities || []) {
          if (!e) continue;
          const t = e.type;
          // Handle string or numeric entity types
          if (typeof t === "string") {
            if (t === "PlayerSpawn") {
              player = { x: e.x | 0, y: e.y | 0, attached: false };
              continue;
            }
            const id = nameToEntId && nameToEntId[t];
            if (!Number.isInteger(id)) continue;
            let rot = undefined;
            const o = (e.orientation || "").toUpperCase();
            if (o === "N") rot = 0;
            else if (o === "E") rot = 1;
            else if (o === "S") rot = 2;
            else if (o === "W") rot = 3;
            entities.push({ type: id | 0, x: e.x | 0, y: e.y | 0, rot });
          } else if (Number.isInteger(t)) {
            const id = t | 0;
            const name = idToEntName[id];
            if (name === "PlayerSpawn") {
              player = { x: e.x | 0, y: e.y | 0, attached: false };
              continue;
            }
            // Orientation might be numeric or string; pass through numeric rot when available
            let rot = undefined;
            if (Number.isInteger(e.rot)) rot = e.rot | 0;
            else {
              const o = (e.orientation || "").toUpperCase();
              if (o === "N") rot = 0;
              else if (o === "E") rot = 1;
              else if (o === "S") rot = 2;
              else if (o === "W") rot = 3;
            }
            entities.push({ type: id, x: e.x | 0, y: e.y | 0, rot });
          }
        }
        return { w, h, tiles, entities, player };
      } catch {
        return null;
      }
    }
    function toLevelDTOFromDraw(draw, idToTile, idToEnt) {
      const w = draw.w | 0;
      const h = draw.h | 0;
      const tileGrid = Array.from({ length: h }, (_, y) => new Array(w));
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++)
          tileGrid[y][x] = idToTile[draw.tiles[y * w + x]] || "Floor";
      const entities = [];
      if (
        draw.player &&
        Number.isInteger(draw.player.x) &&
        Number.isInteger(draw.player.y)
      )
        entities.push({
          type: "PlayerSpawn",
          x: draw.player.x,
          y: draw.player.y,
        });
      for (const e of draw.entities || []) {
        const name = idToEnt[e.type];
        if (!name || name === "PlayerSpawn") continue;
        const out = { type: name, x: e.x | 0, y: e.y | 0 };
        if (Number.isInteger(e.rot)) {
          const rotNames = ["N", "E", "S", "W"];
          out.orientation = rotNames[(e.rot | 0) & 3];
        }
        entities.push(out);
      }
      return { width: w, height: h, tileGrid, entities };
    }
    // Compute a stable content hash for a LevelDTO (tiles + non-player entities)
    function computeLevelHash(level) {
      try {
        let h = 0x811c9dc5n; // 32-bit FNV-1a
        const prime = 0x01000193n;
        const feedChar = (c) => {
          h ^= BigInt(c.charCodeAt(0) & 0xff);
          h = (h * prime) & 0xffffffffn;
        };
        const feedStr = (s) => {
          for (let i = 0; i < s.length; i++) feedChar(s[i]);
        };
        const feedNum = (n) => feedStr(String(n | 0));
        const H = level?.height | 0 || 0,
          W = level?.width | 0 || 0;
        feedNum(W);
        feedNum(H);
        for (let y = 0; y < H; y++)
          for (let x = 0; x < W; x++)
            feedStr(String(level?.tileGrid?.[y]?.[x] || ""));
        const ents = (level?.entities || [])
          .filter((e) => e)
          .map((e) => ({
            t: String(e.type || ""),
            x: e.x | 0,
            y: e.y | 0,
            o: String(e.orientation || ""),
          }))
          .sort((a, b) =>
            a.t < b.t
              ? -1
              : a.t > b.t
              ? 1
              : a.x - b.x || a.y - b.y || (a.o < b.o ? -1 : a.o > b.o ? 1 : 0)
          );
        for (const e of ents) {
          feedStr(e.t);
          feedNum(e.x);
          feedNum(e.y);
          feedStr(e.o);
        }
        return h.toString(16);
      } catch {
        return "0";
      }
    }
    function parseRules(text) {
      if (text == null) return {};
      if (typeof text === "object") return text;
      if (typeof text !== "string") return {};
      // allow // comment lines in textarea
      const noComments = text.replace(/^\s*\/\/.*$/gm, "");
      try {
        return JSON.parse(noComments);
      } catch {
        return {};
      }
    }
    function matchesBucket(rules, report) {
      try {
        const top = pickSolutionsArray(report);
        if (!top || top.length === 0) return false; // skip unsolvable
        const fastest = top.length
          ? Math.min(...top.map((s) => (s.length ?? s.Length) | 0))
          : Infinity;
        const deadCount =
          (report.deadEnds ?? report.DeadEnds ?? []).length || 0;
        if (rules.minSolutions && top.length < rules.minSolutions) return false;
        if (rules.maxSolutions && top.length > rules.maxSolutions) return false;
        if (rules.minFastest && !(fastest >= rules.minFastest)) return false;
        if (rules.maxFastest && !(fastest <= rules.maxFastest)) return false;
        if (rules.minDeadEnds && !(deadCount >= rules.minDeadEnds))
          return false;
        if (rules.maxDeadEnds && !(deadCount <= rules.maxDeadEnds))
          return false;
        return true;
      } catch {
        return false;
      }
    }
    function mutateLevel(level, tilesAllowed, entsAllowed) {
      // Extremely simple mutator as a fallback when C# ALD is not available
      const w = level.width | 0;
      const h = level.height | 0;
      const copy = JSON.parse(JSON.stringify(level));
      // mutate a random tile if any allowed tile
      if (tilesAllowed && tilesAllowed.length) {
        const x = (Math.random() * w) | 0;
        const y = (Math.random() * h) | 0;
        const name = tilesAllowed[(Math.random() * tilesAllowed.length) | 0];
        copy.tileGrid[y][x] = name;
      }
      // ensure PlayerSpawn uniqueness if selected
      if (entsAllowed?.includes("PlayerSpawn")) {
        copy.entities = (copy.entities || []).filter(
          (e) => e.type !== "PlayerSpawn"
        );
        copy.entities.push({
          type: "PlayerSpawn",
          x: (w / 2) | 0,
          y: (h / 2) | 0,
        });
      }
      return copy;
    }

    // --- populate chips from catalogs
    try {
      const tiles = api.getTiles?.() || [];
      if (tilesChips && Array.isArray(tiles)) {
        tilesChips.innerHTML = "";
        for (const t of tiles) {
          if (!t || typeof t.name !== "string") continue;
          const label = nice(t.name);
          // Default: Exit min=1 to keep solvable unless user overrides
          const defaults = t.name === "Exit" ? { min: 1, max: -1 } : undefined;
          tilesChips.appendChild(
            createChipRow("tile", t.name, label, defaults)
          );
        }
        bindChipToggles(tilesChips);
      }
    } catch {}
    try {
      const ents = api.getEntities?.() || [];
      if (entsChips && Array.isArray(ents)) {
        entsChips.innerHTML = "";
        for (const e of ents) {
          if (!e || typeof e.name !== "string") continue;
          const label = nice(e.name).replace("Box Basic", "Box");
          // Default: PlayerSpawn min=1 enforced unless overridden below for explicit PlayerSpawn row
          if (e.name === "PlayerSpawn") continue; // we'll add explicit one next
          entsChips.appendChild(createChipRow("entity", e.name, label));
        }
        // explicit PlayerSpawn chip (movable single-spawn)
        entsChips.appendChild(
          createChipRow("entity", "PlayerSpawn", "Player Spawn", {
            min: 1,
            max: -1,
          })
        );
        bindChipToggles(entsChips);
      }
    } catch {}

    // --- buckets
    const buckets = [];
    // Derived features pack injected into ContextSettings.derived
    // Uses only + - * / ( ) over existing feature ids.
    const DERIVED_DEFAULTS = [
      { id: "solUniqueness", expr: "1 / (solutionsFilteredCount)" },
      {
        id: "pruneRatio",
        expr: "1 - (solutionsFilteredCount / (solutionsTotalCount + 1))",
      },
      { id: "varietyRatio", expr: "dedupMovesLenTop1 / (solutionLength + 1)" },
      { id: "backtrackSlack", expr: "solutionLength - dedupMovesLenTop1" },
      {
        id: "backtrackRatio",
        expr: "(solutionLength - dedupMovesLenTop1) / (solutionLength + 1)",
      },
      { id: "explorePerStep", expr: "nodesExplored / (solutionLength + 1)" },
      {
        id: "exploreCompact",
        expr: "(solutionLength + 1) / (solutionLength + nodesExplored + 1)",
      },
      { id: "depthRatio", expr: "maxDepthReached / (solutionLength + 1)" },
      {
        id: "lureDensity",
        expr: "deadEndsNearTop1Count / (solutionLength + 1)",
      },
      { id: "deadEndDensity", expr: "deadEndsCount / (nodesExplored + 1)" },
      { id: "boxFocusRatio", expr: "stepsInBoxTop1 / (solutionLength + 1)" },
      { id: "freeFocusRatio", expr: "stepsFreeTop1 / (solutionLength + 1)" },
      {
        id: "pathDiversity",
        expr: "dedupMovesLenTop3Avg / (dedupMovesLenTop1 + 1)",
      },
      { id: "uncapped", expr: "1 - capped" },
      // Note: intentionally omitting { id:"exitOk", expr:"precheck.hasExitInComponent" }
    ];
    const BUCKET_PRESETS = {
      // Full C# BucketConfig JSON defaults
      Easy: JSON.stringify(
        {
          name: "Easy",
          maxLevels: 20,
          selectWeight: 1,
          features: [
            {
              id: "solutionLength",
              mode: "Band",
              bandMin: 15,
              bandMax: 30,
              weight: 1,
              hard: true,
            },
            {
              id: "solutionsFilteredCount",
              mode: "Band",
              bandMin: 1,
              bandMax: 3,
              weight: 1,
              hard: false,
            },
            {
              id: "deadEndsNearTop1Count",
              mode: "Infinite",
              bandMin: 0,
              bandMax: 0,
              weight: 0.3,
              hard: false,
            },
            {
              id: "deadEndsAverageDepth",
              mode: "Infinite",
              bandMin: 0,
              bandMax: 0,
              weight: 0.1,
              hard: false,
            },
          ],
        },
        null,
        2
      ),
      Medium: JSON.stringify(
        {
          name: "Medium",
          maxLevels: 20,
          selectWeight: 1,
          features: [
            {
              id: "solutionLength",
              mode: "Band",
              bandMin: 30,
              bandMax: 50,
              weight: 1,
              hard: true,
            },
            {
              id: "solutionsFilteredCount",
              mode: "Band",
              bandMin: 1,
              bandMax: 3,
              weight: 1,
              hard: false,
            },
            {
              id: "deadEndsNearTop1Count",
              mode: "Infinite",
              bandMin: 0,
              bandMax: 0,
              weight: 0.3,
              hard: false,
            },
            {
              id: "deadEndsAverageDepth",
              mode: "Infinite",
              bandMin: 0,
              bandMax: 0,
              weight: 0.1,
              hard: false,
            },
          ],
        },
        null,
        2
      ),
      Hard: JSON.stringify(
        {
          name: "Hard",
          maxLevels: 20,
          selectWeight: 1,
          features: [
            {
              id: "solutionLength",
              mode: "Band",
              bandMin: 50,
              bandMax: 70,
              weight: 1,
              hard: true,
            },
            {
              id: "solutionsFilteredCount",
              mode: "Band",
              bandMin: 1,
              bandMax: 3,
              weight: 1,
              hard: false,
            },
            {
              id: "deadEndsNearTop1Count",
              mode: "Infinite",
              bandMin: 0,
              bandMax: 0,
              weight: 0.3,
              hard: false,
            },
            {
              id: "deadEndsAverageDepth",
              mode: "Infinite",
              bandMin: 0,
              bandMax: 0,
              weight: 0.1,
              hard: false,
            },
          ],
        },
        null,
        2
      ),
      Hardest: JSON.stringify(
        {
          name: "Hardest",
          maxLevels: 0, // unlimited
          selectWeight: 1,
          features: [
            {
              id: "solutionLength",
              mode: "Band",
              bandMin: 70,
              bandMax: 99999,
              weight: 1,
              hard: true,
            },
            {
              id: "solutionsFilteredCount",
              mode: "Band",
              bandMin: 1,
              bandMax: 3,
              weight: 1,
              hard: false,
            },
            {
              id: "deadEndsNearTop1Count",
              mode: "Infinite",
              bandMin: 0,
              bandMax: 0,
              weight: 0.3,
              hard: false,
            },
            {
              id: "deadEndsAverageDepth",
              mode: "Infinite",
              bandMin: 0,
              bandMax: 0,
              weight: 0.1,
              hard: false,
            },
          ],
        },
        null,
        2
      ),
      "Tutorial / Flow": JSON.stringify(
        {
          name: "Tutorial / Flow",
          maxLevels: 20,
          selectWeight: 1,
          features: [
            {
              id: "precheck.hasExitInComponent",
              mode: "Band",
              bandMin: 1,
              bandMax: 1,
              weight: 0,
              hard: true,
            },
            {
              id: "solutionLength",
              mode: "Band",
              bandMin: 8,
              bandMax: 20,
              weight: 1,
              hard: true,
            },
            {
              id: "exploreCompact",
              mode: "Infinite",
              weight: 0.5,
              hard: false,
            },
            {
              id: "deadEndsCount",
              mode: "Band",
              bandMin: 0,
              bandMax: 3,
              weight: 0.4,
              hard: false,
            },
            {
              id: "lureDensity",
              mode: "Band",
              bandMin: 0,
              bandMax: 0.15,
              weight: 0.4,
              hard: false,
            },
            {
              id: "varietyRatio",
              mode: "Band",
              bandMin: 0.75,
              bandMax: 1,
              weight: 0.3,
              hard: false,
            },
            { id: "solUniqueness", mode: "Infinite", weight: 0.4, hard: false },
          ],
        },
        null,
        2
      ),
      "Aha / Search-Heavy": JSON.stringify(
        {
          name: "Aha / Search-Heavy",
          maxLevels: 20,
          selectWeight: 1,
          features: [
            {
              id: "solutionLength",
              mode: "Band",
              bandMin: 12,
              bandMax: 28,
              weight: 1,
              hard: true,
            },
            {
              id: "explorePerStep",
              mode: "Infinite",
              weight: 0.4,
              hard: false,
            },
            {
              id: "lureDensity",
              mode: "Band",
              bandMin: 0.2,
              bandMax: 0.6,
              weight: 0.6,
              hard: false,
            },
            {
              id: "backtrackRatio",
              mode: "Band",
              bandMin: 0,
              bandMax: 0.2,
              weight: 0.4,
              hard: false,
            },
            {
              id: "deadEndDensity",
              mode: "Band",
              bandMin: 0.05,
              bandMax: 0.3,
              weight: 0.2,
              hard: false,
            },
          ],
        },
        null,
        2
      ),
      "Maze / Spiky": JSON.stringify(
        {
          name: "Maze / Spiky",
          maxLevels: 20,
          selectWeight: 1,
          features: [
            {
              id: "solutionLength",
              mode: "Band",
              bandMin: 30,
              bandMax: 60,
              weight: 1,
              hard: true,
            },
            { id: "deadEndsCount", mode: "Infinite", weight: 0.3, hard: false },
            {
              id: "deadEndsAverageDepth",
              mode: "Infinite",
              weight: 0.5,
              hard: false,
            },
            {
              id: "deadEndDensity",
              mode: "Infinite",
              weight: 0.3,
              hard: false,
            },
            {
              id: "exploreCompact",
              mode: "Band",
              bandMin: 0.2,
              bandMax: 0.6,
              weight: 0.2,
              hard: false,
            },
          ],
        },
        null,
        2
      ),
      "Backtrack Gym": JSON.stringify(
        {
          name: "Backtrack Gym",
          maxLevels: 20,
          selectWeight: 1,
          features: [
            {
              id: "solutionLength",
              mode: "Band",
              bandMin: 25,
              bandMax: 60,
              weight: 1,
              hard: true,
            },
            {
              id: "backtrackRatio",
              mode: "Band",
              bandMin: 0.25,
              bandMax: 0.6,
              weight: 0.6,
              hard: false,
            },
            {
              id: "varietyRatio",
              mode: "Band",
              bandMin: 0.4,
              bandMax: 0.75,
              weight: 0.3,
              hard: false,
            },
            {
              id: "explorePerStep",
              mode: "Band",
              bandMin: 0.1,
              bandMax: 0.6,
              weight: 0.2,
              hard: false,
            },
          ],
        },
        null,
        2
      ),
      "Boxy / Sokoban-ish": JSON.stringify(
        {
          name: "Boxy / Sokoban-ish",
          maxLevels: 20,
          selectWeight: 1,
          features: [
            {
              id: "solutionLength",
              mode: "Band",
              bandMin: 30,
              bandMax: 70,
              weight: 1,
              hard: true,
            },
            {
              id: "boxFocusRatio",
              mode: "Band",
              bandMin: 0.5,
              bandMax: 0.8,
              weight: 0.8,
              hard: false,
            },
            {
              id: "freeFocusRatio",
              mode: "Band",
              bandMin: 0.1,
              bandMax: 0.4,
              weight: 0.3,
              hard: false,
            },
            { id: "solUniqueness", mode: "Infinite", weight: 0.2, hard: false },
            {
              id: "deadEndsNearTop1Count",
              mode: "Band",
              bandMin: 0,
              bandMax: 5,
              weight: 0.2,
              hard: false,
            },
          ],
        },
        null,
        2
      ),
      "Multi-Route / Sandbox": JSON.stringify(
        {
          name: "Multi-Route / Sandbox",
          maxLevels: 20,
          selectWeight: 1,
          features: [
            {
              id: "solutionLength",
              mode: "Band",
              bandMin: 25,
              bandMax: 60,
              weight: 1,
              hard: true,
            },
            {
              id: "solutionsFilteredCount",
              mode: "Band",
              bandMin: 2,
              bandMax: 5,
              weight: 1,
              hard: false,
            },
            {
              id: "pathDiversity",
              mode: "Band",
              bandMin: 0.9,
              bandMax: 1.2,
              weight: 0.4,
              hard: false,
            },
            {
              id: "deadEndDensity",
              mode: "Band",
              bandMin: 0,
              bandMax: 0.2,
              weight: 0.3,
              hard: false,
            },
            {
              id: "varietyRatio",
              mode: "Band",
              bandMin: 0.6,
              bandMax: 0.9,
              weight: 0.3,
              hard: false,
            },
          ],
        },
        null,
        2
      ),
      "Corridor / Linear": JSON.stringify(
        {
          name: "Corridor / Linear",
          maxLevels: 20,
          selectWeight: 1,
          features: [
            {
              id: "solutionLength",
              mode: "Band",
              bandMin: 40,
              bandMax: 80,
              weight: 1,
              hard: true,
            },
            {
              id: "deadEndsCount",
              mode: "Band",
              bandMin: 0,
              bandMax: 3,
              weight: 0.5,
              hard: false,
            },
            {
              id: "deadEndDensity",
              mode: "Band",
              bandMin: 0,
              bandMax: 0.05,
              weight: 0.8,
              hard: true,
            },
            {
              id: "exploreCompact",
              mode: "Infinite",
              weight: 0.5,
              hard: false,
            },
            { id: "solUniqueness", mode: "Infinite", weight: 0.4, hard: false },
          ],
        },
        null,
        2
      ),
      "Epic (Uncapped)": JSON.stringify(
        {
          name: "Epic (Uncapped)",
          maxLevels: 0,
          selectWeight: 1,
          features: [
            {
              id: "solutionLength",
              mode: "Band",
              bandMin: 70,
              bandMax: 99999,
              weight: 1,
              hard: true,
            },
            {
              id: "uncapped",
              mode: "Band",
              bandMin: 1,
              bandMax: 1,
              weight: 0,
              hard: true,
            },
            {
              id: "explorePerStep",
              mode: "Band",
              bandMin: 0.2,
              bandMax: 1,
              weight: 0.3,
              hard: false,
            },
            {
              id: "deadEndDensity",
              mode: "Band",
              bandMin: 0.05,
              bandMax: 0.2,
              weight: 0.3,
              hard: false,
            },
            {
              id: "varietyRatio",
              mode: "Band",
              bandMin: 0.5,
              bandMax: 0.8,
              weight: 0.4,
              hard: false,
            },
          ],
        },
        null,
        2
      ),
      EvolutionBase: JSON.stringify(
        {
          name: "EvolutionBase",
          maxLevels: 20,
          selectWeight: 10,
          features: [
            {
              id: "solutionsFilteredCount",
              mode: "Infinite",
              weight: 1.0,
              hard: false,
            },
            {
              id: "solutionLength",
              mode: "Infinite",
              weight: 0.6,
              hard: false,
            },
          ],
        },
        null,
        2
      ),
    };
    function renderBuckets() {
      if (!bucketRows) return;
      bucketRows.innerHTML = "";
      buckets.forEach((b, idx) => {
        const row = document.createElement("div");
        row.className = "levels-row";
        const label = document.createElement("div");
        // show weights summary for base buckets
        let weightsSummary = "";
        try {
          const br = parseRules(b.rules);
          const w = br && br.weights;
          if (w) {
            const f = (n) =>
              Object.prototype.hasOwnProperty.call(w, n)
                ? Number(w[n]).toFixed(2)
                : "-";
            weightsSummary = ` [w: fast:${f("fastest")}, sol:${f(
              "solutions"
            )}, dead:${f("deadEnds")}, nodes:${f("nodes")}]`;
          }
        } catch {}
        label.textContent = `${b.name} - ${b.preset}${weightsSummary}`;
        const rules = document.createElement("textarea");
        rules.rows = 2;
        rules.placeholder = "Bucket rules (JSON; comments allowed)";
        rules.value = b.rules || "";
        rules.addEventListener("input", () => (b.rules = rules.value));
        const del = document.createElement("button");
        del.textContent = "Remove";
        del.addEventListener("click", () => {
          buckets.splice(idx, 1);
          renderBuckets();
        });
        row.appendChild(label);
        row.appendChild(rules);
        row.appendChild(del);
        bucketRows.appendChild(row);
      });
    }
    function addDefaultBuckets() {
      const base = ["Easy", "Medium", "Hard", "Hardest", "EvolutionBase"];
      for (const p of base) {
        const presetText = BUCKET_PRESETS[p];
        const rulesText =
          typeof presetText === "string"
            ? presetText
            : JSON.stringify(presetText || {}, null, 2);
        buckets.push({ name: p, preset: p, rules: rulesText });
      }
      renderBuckets();
    }
    addDefaultBuckets();
    if (addBucketBtn) {
      addBucketBtn.addEventListener("click", () => {
        const nameEl = document.getElementById("bucketName");
        const presetEl = document.getElementById("bucketHeuristic");
        const name = (nameEl?.value || "").trim();
        const preset = presetEl?.value || "Easy";
        if (!name) return;
        let rulesText;
        const presetText = BUCKET_PRESETS[preset];
        if (typeof presetText === "string" && presetText.trim().length)
          rulesText = presetText;
        else if (presetText && typeof presetText === "object")
          rulesText = JSON.stringify(presetText || {}, null, 2);
        else rulesText = BUCKET_PRESETS.Easy; // safe default
        buckets.push({ name, preset, rules: rulesText });
        if (nameEl) nameEl.value = "";
        renderBuckets();
      });
    }
    // --- toggle Auto panel handled by early binding above (duplicates removed)

    // --- run/stop/restore
    let cancel = false;
    let snapshot = null;
    // Persist an ALD context across runs when using "Keep Running"
    let persistentCtxId = null;
    let persistentCtxSig = null; // signature of settings used to create the context
    // Hash cache of seen candidates (content-based). Cleared on fresh run; kept when Keep Running.
    let seenCandidateHashes = new Set();
    async function pickBaseForMutation(grouped, snapshot) {
      try {
        const topK = Math.max(
          1,
          Number(document.getElementById("autoSelectTopK")?.value) || 5
        );
        const skew = Math.max(
          0,
          Number(document.getElementById("autoSelectSkew")?.value) || 1
        );
        const pool = [];
        const names = Object.keys(grouped || {});
        for (const bname of names) {
          const arr = grouped[bname] || [];
          for (let i = 0; i < Math.min(topK, arr.length); i++) {
            const e = arr[i];
            pool.push({ score: e.score ?? 0, level: e.level });
          }
        }
        if (pool.length === 0) return snapshot;
        // Prefer C# selection when available
        if (api.aldSelectBase) {
          try {
            const res = await api.aldSelectBase(pool, topK, skew);
            if (res && res.ok && res.level) return res.level;
          } catch {}
        }
        // Fallback to JS weighting
        let min = Infinity;
        for (const e of pool) if (e.score < min) min = e.score;
        const eps = 1e-6;
        const weights = pool.map((e) =>
          Math.pow(e.score - min + eps, skew <= 0 ? 1 : skew)
        );
        let sum = 0;
        for (const w of weights) sum += w;
        let r = Math.random() * (sum > 0 ? sum : 1);
        for (let i = 0; i < pool.length; i++) {
          r -= weights[i];
          if (r <= 0) return pool[i].level;
        }
        return pool[pool.length - 1].level;
      } catch {
        return snapshot;
      }
    }

    async function runAuto({ keep = false } = {}) {
      try {
        cancel = false;
        if (!keep) {
          try {
            seenCandidateHashes.clear();
          } catch {}
        }
        if (runBtn) runBtn.disabled = true;
        if (stopBtn) stopBtn.disabled = false;
        if (progressEl) progressEl.textContent = "Running...";
        console.log("[auto] run start");
        const { tileIdToName, entIdToName } = catalogs();
        const baseDraw = api.getState();
        snapshot = toLevelDTOFromDraw(baseDraw, tileIdToName, entIdToName);
        // Build C# context settings from UI presets (buckets JSON)
        let ctxId = persistentCtxId;
        // Build settings preview once (no mid-run refresh). Block if allow-lists empty.
        let settingsPreview;
        try {
          settingsPreview = buildContextSettings();
        } catch (e) {
          if (String(e && e.message) === "empty_allow_lists") {
            if (progressEl)
              progressEl.textContent =
                "Select at least one tile or entity to place";
            if (runBtn) runBtn.disabled = false;
            if (stopBtn) stopBtn.disabled = true;
            return;
          }
          throw e;
        }
        const allowMovePlayerSetting = !!(
          settingsPreview &&
          settingsPreview.mutation &&
          settingsPreview.mutation.movePlayer
        );
        const needNewCtx = !keep || !ctxId;
        if (needNewCtx) {
          // Start fresh: optionally close previous
          if (ctxId) {
            try {
              await (ald.aldCloseContext
                ? ald.aldCloseContext(ctxId)
                : api.aldCloseContext(ctxId));
            } catch {}
          }
          try {
            const ctxRes = await (ald.aldNewContext
              ? ald.aldNewContext(settingsPreview)
              : api.aldNewContext(settingsPreview));
            if (ctxRes && ctxRes.ok) {
              ctxId = ctxRes.ctxId;
              persistentCtxId = ctxId;
            }
          } catch {}
        }
        // Freeze UI-dependent values for the whole run (no mid-run refresh)
        const tilesSel = Array.from(
          settingsPreview?.mutation?.tilesPlace || []
        );
        const entsSel = Array.from(
          settingsPreview?.mutation?.entitiesPlace || []
        );
        const cfg = {
          depthCap: settingsPreview?.solver?.DepthCap | 0 || 100,
          nodesCap: settingsPreview?.solver?.NodesCap | 0 || 200000,
          timeCapSeconds: 5.0,
          enforceTimeCap: false,
        };
        const bucketDefs =
          typeof buckets !== "undefined" && Array.isArray(buckets)
            ? buckets.slice()
            : [];
        const targetAccepted =
          Number(document.getElementById("autoAttemptsCount")?.value) || 20;
        const baseChanges = Math.max(
          1,
          Number(document.getElementById("autoBaseChanges")?.value) || 1
        );
        const evolveChanges = Math.max(
          1,
          Number(document.getElementById("autoEvolveChanges")?.value) || 1
        );
        const frozenSelectTopK = settingsPreview?.selection?.topK | 0 || 5;
        const frozenSelectSkew = Math.max(
          0,
          Number(settingsPreview?.selection?.skew) || 1
        );
        // Default to always using the original snapshot as base unless UI overrides it
        const frozenBaseUseRatio = Math.max(
          0,
          Math.min(
            1,
            Number(document.getElementById("autoBaseUseRatio")?.value ?? 1) || 1
          )
        );
        const frozenGreedyRatio = Math.max(
          0,
          Math.min(
            1,
            Number(document.getElementById("autoGreedyRatio")?.value) || 0
          )
        );
        const frozenRefreshEvery = Math.max(
          1,
          Number(document.getElementById("autoRefreshEvery")?.value) || 7
        );
        const frozenMask =
          maskState && maskState.grid && maskState.h > 0 && maskState.w > 0
            ? {
                w: maskState.w,
                h: maskState.h,
                grid: maskState.grid.map((r) => r.slice()),
              }
            : null;
        // Freeze preview controls
        const frozenPreviewEvery = Math.max(
          1,
          Number(document.getElementById("autoPreviewEvery")?.value) || 10
        );
        const frozenPreviewRefresh = !!document.getElementById(
          "autoPreviewRefreshAfter"
        )?.checked;
        let accum = { sel: 0, mut: 0, ins: 0, sum: 0, n: 0 };
        let acceptedCount = 0;
        let consecutiveMisses = 0;
        let forceSnapshotTries = 0;
        let tries = 0;
        // Track best candidate for preview: longest minimal solution (highest fastest)
        let bestPreviewLevel = null;
        let bestPreviewFastest = -1;
        function updateBestPreview(level, fastest) {
          try {
            if (
              level &&
              Number.isFinite(fastest) &&
              fastest > bestPreviewFastest
            ) {
              bestPreviewLevel = JSON.parse(JSON.stringify(level));
              bestPreviewFastest = fastest | 0;
            }
          } catch {}
        }
        while (acceptedCount < targetAccepted && !cancel) {
          const i = tries; // keep a stable index for logging cadence
          const tAttempt0 = performance.now();
          // Choose base via C# context; fallback to snapshot
          const tSel0 = performance.now();
          let base = snapshot;
          let evolve = false;
          // Probability to use the original snapshot as base instead of a bucket pick
          const baseUseRatio = frozenBaseUseRatio;
          const pickSnapshot =
            forceSnapshotTries > 0 || Math.random() < baseUseRatio;
          if (forceSnapshotTries > 0) forceSnapshotTries--;
          if (!pickSnapshot && ctxId) {
            try {
              const sel = await (ald.aldSelectBaseCtx
                ? ald.aldSelectBaseCtx(
                    ctxId,
                    frozenSelectTopK,
                    frozenSelectSkew
                  )
                : api.aldSelectBaseCtx(
                    ctxId,
                    frozenSelectTopK,
                    frozenSelectSkew
                  ));
              if (sel && sel.ok && sel.level) {
                base = sel.level;
                evolve = true;
              }
            } catch {}
          }
          const tSel1 = performance.now();
          const selMs = tSel1 - tSel0;
          const nChanges = evolve ? evolveChanges : baseChanges;
          const tMut0 = performance.now();
          const cand = await buildCandidate(
            base,
            settingsPreview,
            cfg,
            nChanges,
            frozenGreedyRatio,
            allowMovePlayerSetting
          );
          const tMut1 = performance.now();
          const mutMs = tMut1 - tMut0;
          if (cand && cand.rejected) {
            if (cand.reason === "base_solution_still_works") {
              console.log("[auto] discard: base solution still works");
              if (progressEl && i % 3 === 0)
                progressEl.textContent = `Discarded similar ${
                  i + 1
                }/${targetAccepted}`;
            } else if (cand.reason === "solution_not_similar") {
              console.log(
                "[auto] skip: solution not similar enough for replacement"
              );
              if (progressEl)
                progressEl.textContent = `Skip (solution differs) ${
                  i + 1
                }/${targetAccepted}`;
            }
            continue;
          }
          let lvl = cand.lvl;
          // Fast duplicate skip by content hash (per session)
          try {
            const key = computeLevelHash(lvl);
            if (seenCandidateHashes.has(key)) {
              consecutiveMisses++;
              if (progressEl && i % 3 === 0)
                progressEl.textContent = `Skip duplicate ${
                  i + 1
                }/${targetAccepted}`;
              continue;
            }
            seenCandidateHashes.add(key);
          } catch {}
          // Insert into C# buckets
          const tIns0 = performance.now();
          if (cancel) break;
          if (ctxId) {
            // Local hard band guard: only insert if candidate passes at least one bucket's hard solutionLength band
            try {
              const rep = await api.solverAnalyze(lvl, cfg);
              const top = (rep && (rep.topSolutions || rep.TopSolutions)) || [];
              let fastest = null;
              for (let i = 0; i < top.length; i++) {
                const len = (top[i] && (top[i].length || top[i].Length)) | 0;
                if (!Number.isFinite(len)) continue;
                if (fastest == null || len < fastest) fastest = len;
              }
              if (fastest != null) updateBestPreview(lvl, fastest);
              // Build bands from the current settings preview buckets
              const bands = [];
              try {
                const src = (settingsPreview && settingsPreview.buckets) || [];
                for (let bi = 0; bi < src.length; bi++) {
                  const b = src[bi];
                  const feats = (b && b.features) || [];
                  for (let fi = 0; fi < feats.length; fi++) {
                    const f = feats[fi];
                    if (!f || String(f.id) !== "solutionLength") continue;
                    if (String(f.mode) !== "Band") continue;
                    if (f.hard !== true) continue;
                    const min = Number(f.bandMin);
                    const max = Number(f.bandMax);
                    if (Number.isFinite(min) && Number.isFinite(max))
                      bands.push({ min, max });
                  }
                }
              } catch {}
              let okBand = true; // if no bands, don't block
              if (bands.length > 0 && fastest != null) {
                okBand = bands.some(
                  (b) => fastest >= b.min && fastest <= b.max
                );
              }
              if (!okBand) {
                // Skip inserting this candidate locally
                consecutiveMisses++;
                if (progressEl && i % 3 === 0)
                  progressEl.textContent = `Discarded (fails band) ${
                    i + 1
                  }/${targetAccepted}`;
                // proceed to summary/loop
              } else {
                const ins = await (ald.aldInsertCandidate
                  ? ald.aldInsertCandidate(ctxId, lvl, cfg)
                  : api.aldInsertCandidate(ctxId, lvl, cfg));
                if (
                  ins &&
                  ins.ok &&
                  Array.isArray(ins.accepted) &&
                  ins.accepted.length > 0
                ) {
                  acceptedCount++;
                  consecutiveMisses = 0;
                } else {
                  consecutiveMisses++;
                }
              }
            } catch {
              // Fallback to engine insert if local check fails unexpectedly
              try {
                const ins = await (ald.aldInsertCandidate
                  ? ald.aldInsertCandidate(ctxId, lvl, cfg)
                  : api.aldInsertCandidate(ctxId, lvl, cfg));
                if (
                  ins &&
                  ins.ok &&
                  Array.isArray(ins.accepted) &&
                  ins.accepted.length > 0
                ) {
                  acceptedCount++;
                  consecutiveMisses = 0;
                } else {
                  consecutiveMisses++;
                }
              } catch {}
            }
          }
          const tIns1 = performance.now();
          const insMs = tIns1 - tIns0;
          // Preview draw based on interval when panel is open
          try {
            if (
              tries % frozenPreviewEvery === 0 &&
              previewPanel &&
              previewPanel.getAttribute("aria-hidden") === "false" &&
              previewCanvas
            ) {
              const toShow = bestPreviewLevel || null;
              if (toShow) {
                const { tileIdToName, entIdToName } = catalogs();
                const nameToTileId = Object.create(null);
                for (const id in tileIdToName) {
                  nameToTileId[tileIdToName[id]] = id | 0;
                }
                const nameToEntId = Object.create(null);
                for (const id in entIdToName) {
                  nameToEntId[entIdToName[id]] = id | 0;
                }
                const drawDto = toDrawFromLevelDTO(
                  toShow,
                  nameToTileId,
                  nameToEntId
                );
                if (drawDto) drawToCanvas(previewCanvas, drawDto);
                if (previewInfo)
                  previewInfo.textContent = `Best shortest steps: ${
                    bestPreviewFastest >= 0 ? bestPreviewFastest : "-"
                  }`;
                // Optionally refresh preview candidate after showing
                if (frozenPreviewRefresh) {
                  bestPreviewLevel = null;
                  bestPreviewFastest = -1;
                }
              }
            }
          } catch {}
          // Refresh list from C# buckets
          let grouped = null;
          const tSum0 = performance.now();
          const refreshEvery = frozenRefreshEvery;
          if (
            ctxId &&
            (tries % refreshEvery === 0 || acceptedCount >= targetAccepted)
          ) {
            try {
              const sum = await (ald.aldGetBucketsSummary
                ? ald.aldGetBucketsSummary(ctxId)
                : api.aldGetBucketsSummary(ctxId));
              if (sum && sum.ok) grouped = sum.buckets;
            } catch {}
          }
          const tSum1 = performance.now();
          const sumMs = tSum1 - tSum0;
          accum.sel += selMs;
          accum.mut += mutMs;
          accum.ins += insMs;
          accum.sum += sumMs;
          accum.n++;
          if (tries % 5 === 0) {
            console.log(
              `[auto] tries ${
                tries + 1
              } accepted:${acceptedCount}/${targetAccepted} ms sel:${selMs.toFixed(
                1
              )} mut:${mutMs.toFixed(1)} ins:${insMs.toFixed(
                1
              )} sum:${sumMs.toFixed(1)} avg sel:${(
                accum.sel / accum.n
              ).toFixed(1)} mut:${(accum.mut / accum.n).toFixed(1)} ins:${(
                accum.ins / accum.n
              ).toFixed(1)} sum:${(accum.sum / accum.n).toFixed(1)}`
            );
          }
          if (tries % 3 === 0 && progressEl)
            progressEl.textContent = `Accepted ${acceptedCount}/${targetAccepted} — Attempts ${
              tries + 1
            }`;
          // If we stall for many misses in a row, bias towards snapshot base briefly
          if (consecutiveMisses >= 40) {
            forceSnapshotTries = Math.max(forceSnapshotTries, 5);
            consecutiveMisses = 0;
          }
          if (grouped) renderResultsFromSummary(grouped);
          await new Promise((r) => setTimeout(r, 0));
          tries++;
        }
        if (progressEl)
          progressEl.textContent = cancel
            ? "Canceled"
            : `Done (accepted ${acceptedCount}/${targetAccepted})`;
      } finally {
        if (runBtn) runBtn.disabled = false;
        if (stopBtn) stopBtn.disabled = true;
      }
    }
    function stopAuto() {
      cancel = true;
      if (progressEl) progressEl.textContent = "Canceling...";
    }
    function restoreSnapshot() {
      if (!snapshot) return;
      try {
        api.setState(snapshot);
        try {
          if (window.requestRedraw) window.requestRedraw();
        } catch {}
      } catch (e) {
        console.warn("[auto] restore failed", e);
      }
    }
    if (runBtn)
      runBtn.addEventListener("click", () => runAuto({ keep: false }));
    const keepBtn = document.getElementById("keepRunning");
    if (keepBtn)
      keepBtn.addEventListener("click", () => runAuto({ keep: true }));
    const genOneBtn = document.getElementById("autoGenerateOne");
    if (genOneBtn)
      genOneBtn.addEventListener("click", async () => {
        try {
          if (progressEl) progressEl.textContent = "Generating one...";
          // Use shared settings builder for parity with run loop
          let settings;
          try {
            settings = buildContextSettings();
          } catch (e) {
            if (String(e && e.message) === "empty_allow_lists") {
              if (progressEl)
                progressEl.textContent =
                  "Select at least one tile or entity to place";
              return;
            }
            throw e;
          }
          // Build a working LevelDTO from snapshot or current draw
          let lvl = null;
          try {
            if (snapshot) {
              lvl = JSON.parse(JSON.stringify(snapshot));
            } else {
              const drawNow = api.getState();
              const { tileIdToName, entIdToName } = catalogs();
              lvl = toLevelDTOFromDraw(drawNow, tileIdToName, entIdToName);
            }
          } catch {}
          if (!lvl || !lvl.tileGrid) {
            if (progressEl)
              progressEl.textContent = "Generate one: no base level available";
            return;
          }
          const frozenGreedyRatio = Math.max(
            0,
            Math.min(
              1,
              Number(document.getElementById("autoGreedyRatio")?.value) || 0
            )
          );
          const allowMovePlayerSetting = !!(
            settings &&
            settings.mutation &&
            settings.mutation.movePlayer
          );
          const baseChanges = Math.max(
            1,
            Number(document.getElementById("autoBaseChanges")?.value) || 1
          );
          const cfg = {
            depthCap: settings?.solver?.DepthCap | 0 || 100,
            nodesCap: settings?.solver?.NodesCap | 0 || 200000,
            timeCapSeconds: 5.0,
            enforceTimeCap: false,
          };
          const cand = await buildCandidate(
            lvl,
            settings,
            cfg,
            baseChanges,
            frozenGreedyRatio,
            allowMovePlayerSetting
          );
          if (cand && cand.rejected) {
            if (cand.reason === "base_solution_still_works") {
              if (progressEl)
                progressEl.textContent =
                  "Generate one: discarded (base solution still works)";
            } else if (cand.reason === "solution_not_similar") {
              if (progressEl)
                progressEl.textContent =
                  "Generate one: skipped (solution differs)";
            } else {
              if (progressEl)
                progressEl.textContent =
                  "Generate one: no change (constraints/masks)";
            }
            return;
          }
          const out = cand.lvl;
          api.setState(out);
          if (progressEl) progressEl.textContent = "Previewed one candidate";
          try {
            if (window.requestRedraw) window.requestRedraw();
          } catch {}
        } catch (e) {
          console.warn("[auto] generate one failed", e);
        }
      });
    if (stopBtn) stopBtn.addEventListener("click", stopAuto);
    if (restoreBtn) restoreBtn.addEventListener("click", restoreSnapshot);
    // Import/Export (mask excluded)
    function exportParams() {
      try {
        const tilesAllowed = Array.from(
          document.querySelectorAll("#autoTilesChips .tile-chip.active")
        ).map((b) => b.dataset.tile);
        const entsAllowed = Array.from(
          document.querySelectorAll("#autoEntitiesChips .tile-chip.active")
        ).map((b) => b.dataset.entity);
        function collectCounts(rootSelector, kind, specialNames) {
          const rows =
            document.querySelectorAll(`${rootSelector} .chip-row`) || [];
          const out = {};
          for (const row of rows) {
            const btn = row.querySelector("button.tile-chip");
            if (!btn) continue;
            const name =
              kind === "tile" ? btn.dataset.tile : btn.dataset.entity;
            if (!name) continue;
            const minEl = row.querySelector("input.count-input.min");
            const maxEl = row.querySelector("input.count-input.max");
            const vmin = Number(minEl?.value ?? -1);
            const vmax = Number(maxEl?.value ?? -1);
            const useNullToOverride = specialNames && specialNames.has(name);
            const minVal =
              vmin >= 0 ? vmin | 0 : useNullToOverride ? null : undefined;
            const maxVal =
              vmax >= 0 ? vmax | 0 : useNullToOverride ? null : undefined;
            if (minVal !== undefined || maxVal !== undefined) {
              out[name] = { min: minVal ?? null, max: maxVal ?? null };
            }
          }
          return out;
        }
        const tileCounts = collectCounts(
          "#autoTilesChips",
          "tile",
          new Set(["Exit"])
        );
        const entityCounts = collectCounts(
          "#autoEntitiesChips",
          "entity",
          new Set(["PlayerSpawn"])
        );
        const data = {
          version: 1,
          solver: {
            maxNodes:
              Number(document.getElementById("solverMaxNodes")?.value) ||
              200000,
            maxDepth:
              Number(document.getElementById("solverMaxDepth")?.value) || 100,
          },
          parameters: {
            attempts:
              Number(document.getElementById("autoAttemptsCount")?.value) || 20,
            baseChanges:
              Number(document.getElementById("autoBaseChanges")?.value) || 1,
            evolveChanges:
              Number(document.getElementById("autoEvolveChanges")?.value) || 1,
            selectTopK:
              Number(document.getElementById("autoSelectTopK")?.value) || 5,
            selectSkew:
              Number(document.getElementById("autoSelectSkew")?.value) || 1,
            baseUseRatio:
              Number(document.getElementById("autoBaseUseRatio")?.value) || 0,
            greedyRatio:
              Number(document.getElementById("autoGreedyRatio")?.value) || 0,
            refreshEvery:
              Number(document.getElementById("autoRefreshEvery")?.value) || 7,
            previewEvery:
              Number(document.getElementById("autoPreviewEvery")?.value) || 10,
            previewRefreshAfter:
              !!document.getElementById("autoPreviewRefreshAfter")?.checked,
          },
          tiles: { allowed: tilesAllowed, counts: tileCounts },
          entities: { allowed: entsAllowed, counts: entityCounts },
          traceRequire: Array.from(
            document.getElementById("autoTraceRequire")?.selectedOptions || []
          ).map((o) => o.value),
          buckets: buckets.map((b) => ({
            name: b.name,
            preset: b.preset,
            rules: b.rules,
          })),
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], {
          type: "application/json",
        });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "auto-creator-params.json";
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      } catch (e) {
        console.warn("[auto] export failed", e);
      }
    }
    function importParamsFromObj(obj) {
      try {
        document.querySelectorAll("#autoTilesChips .tile-chip").forEach((b) => {
          b.classList.remove("active");
          b.setAttribute("aria-pressed", "false");
        });
        (obj.tiles?.allowed || []).forEach((nRaw) => {
          const n = String(nRaw || "");
          let btn = document.querySelector(
            `#autoTilesChips .tile-chip[data-tile="${n}"]`
          );
          if (!btn) {
            const lower = n.toLowerCase();
            btn =
              Array.from(
                document.querySelectorAll("#autoTilesChips .tile-chip")
              ).find(
                (b) => String(b.dataset.tile || "").toLowerCase() === lower
              ) || null;
          }
          if (btn) {
            btn.classList.add("active");
            btn.setAttribute("aria-pressed", "true");
          }
        });
        document
          .querySelectorAll("#autoEntitiesChips .tile-chip")
          .forEach((b) => {
            b.classList.remove("active");
            b.setAttribute("aria-pressed", "false");
          });
        (obj.entities?.allowed || []).forEach((nRaw) => {
          const n = String(nRaw || "");
          let btn = document.querySelector(
            `#autoEntitiesChips .tile-chip[data-entity="${n}"]`
          );
          if (!btn) {
            const lower = n.toLowerCase();
            btn =
              Array.from(
                document.querySelectorAll("#autoEntitiesChips .tile-chip")
              ).find(
                (b) => String(b.dataset.entity || "").toLowerCase() === lower
              ) || null;
          }
          if (btn) {
            btn.classList.add("active");
            btn.setAttribute("aria-pressed", "true");
          }
        });
        function applyCounts(rootSel, counts) {
          if (!counts) return;
          for (const [name, mm] of Object.entries(counts)) {
            const btn =
              document.querySelector(
                `${rootSel} .chip-row button.tile-chip[data-tile="${name}"]`
              ) ||
              document.querySelector(
                `${rootSel} .chip-row button.tile-chip[data-entity="${name}"]`
              );
            const row = btn ? btn.parentElement : null;
            if (!row) continue;
            const minEl = row.querySelector("input.count-input.min");
            const maxEl = row.querySelector("input.count-input.max");
            if (minEl && mm && Object.prototype.hasOwnProperty.call(mm, "min"))
              minEl.value = mm.min == null ? -1 : Number(mm.min);
            if (maxEl && mm && Object.prototype.hasOwnProperty.call(mm, "max"))
              maxEl.value = mm.max == null ? -1 : Number(mm.max);
          }
        }
        applyCounts("#autoTilesChips", obj.tiles?.counts);
        applyCounts("#autoEntitiesChips", obj.entities?.counts);
        const setVal = (id, v) => {
          const el = document.getElementById(id);
          if (el != null && v != null) el.value = v;
        };
        setVal("solverMaxNodes", obj.solver?.maxNodes);
        setVal("solverMaxDepth", obj.solver?.maxDepth);
        setVal("autoAttemptsCount", obj.parameters?.attempts);
        setVal("autoBaseChanges", obj.parameters?.baseChanges);
        setVal("autoEvolveChanges", obj.parameters?.evolveChanges);
        setVal("autoSelectTopK", obj.parameters?.selectTopK);
        setVal("autoSelectSkew", obj.parameters?.selectSkew);
        setVal("autoBaseUseRatio", obj.parameters?.baseUseRatio);
        setVal("autoGreedyRatio", obj.parameters?.greedyRatio);
        setVal("autoRefreshEvery", obj.parameters?.refreshEvery);
        setVal("autoPreviewEvery", obj.parameters?.previewEvery);
        const cbPrev = document.getElementById("autoPreviewRefreshAfter");
        if (cbPrev) cbPrev.checked = !!obj.parameters?.previewRefreshAfter;
        const traceSel = document.getElementById("autoTraceRequire");
        if (traceSel) {
          const wanted = new Set(obj.traceRequire || []);
          for (const opt of Array.from(traceSel.options))
            opt.selected = wanted.has(opt.value);
        }
        buckets.splice(0, buckets.length);
        for (const b of obj.buckets || [])
          buckets.push({
            name: b.name || "Bucket",
            preset: b.preset || "Custom",
            rules:
              typeof b.rules === "string"
                ? b.rules
                : JSON.stringify(b.rules || {}, null, 2),
          });
        renderBuckets();
      } catch (e) {
        console.warn("[auto] import failed", e);
      }
    }
    function importParams() {
      if (!importFile) return;
      importFile.click();
    }
    if (exportBtn) exportBtn.addEventListener("click", exportParams);
    if (importBtn) importBtn.addEventListener("click", importParams);
    if (importFile)
      importFile.addEventListener("change", async (ev) => {
        const f = ev.target?.files?.[0];
        if (!f) return;
        try {
          const txt = await f.text();
          const obj = JSON.parse(txt);
          importParamsFromObj(obj);
        } catch (e) {
          console.warn("[auto] invalid import", e);
        }
        importFile.value = "";
      });

    // --- results UI
    function renderResults(grouped) {
      const resultsEl = document.getElementById("autoList");
      if (!resultsEl) return;
      resultsEl.innerHTML = "";
      const names = Object.values(grouped || {}).map((b) => b.name || "");
      (grouped || []).forEach((bucket) => {
        const bucketName = bucket.name || "Bucket";
        const entries = bucket.entries || [];
        const section = document.createElement("div");
        section.className = "bucketSection";
        const head = document.createElement("h4");
        head.textContent = `${bucketName} (${entries.length})`;
        section.appendChild(head);
        entries.forEach((entry, idx) => {
          const row = document.createElement("div");
          row.className = "levels-row";
          const label = document.createElement("div");
          label.className = "solutionText";
          const m = entry.metrics || {};
          const scoreStr =
            entry.score != null ? ` hv:${entry.score.toFixed(2)}` : "";
          const fastest = m.solutionLength ?? m.fastest ?? "-";
          const sols = m.solutionsFilteredCount ?? m.solutions ?? "-";
          label.textContent = `#${
            idx + 1
          } sols:${sols} fastest:${fastest}${scoreStr}`;
          const actions = document.createElement("div");
          actions.className = "solutionActions";
          const useBtn = document.createElement("button");
          useBtn.textContent = "Use";
          useBtn.addEventListener("click", () => api.setState(entry.level));
          actions.appendChild(useBtn);
          row.appendChild(label);
          row.appendChild(actions);
          section.appendChild(row);
        });
        resultsEl.appendChild(section);
      });
    }

    function renderResultsFromSummary(bucketsSummary) {
      const resultsEl = document.getElementById("autoList");
      if (!resultsEl) return;
      resultsEl.innerHTML = "";
      (bucketsSummary || []).forEach((bucket) => {
        const bucketName = bucket.name || "Bucket";
        const entries = bucket.entries || [];
        // Collapsible per-bucket panel
        const wrap = document.createElement("details");
        wrap.className = "info-panel";
        const summary = document.createElement("summary");
        summary.textContent = `${bucketName} (${entries.length})`;
        wrap.appendChild(summary);
        const container = document.createElement("div");
        container.className = "info-content";
        entries.forEach((entry, idx) => {
          const row = document.createElement("div");
          row.className = "levels-row";
          const label = document.createElement("div");
          label.className = "solutionText";
          const m = entry.metrics || {};
          const scoreStr =
            entry.score != null ? ` hv:${entry.score.toFixed(2)}` : "";
          const fastest = m.solutionLength ?? m.fastest ?? "-";
          const sols = m.solutionsFilteredCount ?? m.solutions ?? "-";
          label.textContent = `#${
            idx + 1
          } sols:${sols} fastest:${fastest}${scoreStr}`;
          const actions = document.createElement("div");
          actions.className = "solutionActions";
          const useBtn = document.createElement("button");
          useBtn.textContent = "Use";
          useBtn.addEventListener("click", () => {
            try {
              api.setState(entry.level);
              if (window.requestRedraw) window.requestRedraw();
            } catch {}
          });
          actions.appendChild(useBtn);
          row.appendChild(label);
          row.appendChild(actions);
          container.appendChild(row);
        });
        wrap.appendChild(container);
        resultsEl.appendChild(wrap);
      });
    }

    // end render helpers
  }
  // Shared: build context settings from UI (used by run loop and Generate One)
  function buildContextSettings() {
    try {
      console.log(
        "[auto] buildContextSettings: buckets typeof/len",
        typeof buckets,
        typeof buckets !== "undefined" && Array.isArray(buckets)
          ? buckets.length
          : "n/a"
      );
    } catch {}
    function toBucketConfig(name, rulesText, presetName) {
      // 1) If provided as an object, use it directly
      try {
        if (rulesText && typeof rulesText === "object") {
          const bc = JSON.parse(JSON.stringify(rulesText));
          if (!bc.name) bc.name = name;
          // Back-compat: map legacy per-bucket topK -> maxLevels if present
          try {
            if (bc.topK != null && bc.maxLevels == null)
              bc.maxLevels = bc.topK | 0;
            if (bc.topK != null) delete bc.topK;
          } catch {}
          if (Array.isArray(bc.features) && bc.features.length > 0) return bc;
          throw new Error("empty_features_obj");
        }
      } catch {}
      // 2) Parse string JSON (support // comments)
      const text =
        typeof rulesText === "string"
          ? rulesText.replace(/^\s*\/\/.*$/gm, "")
          : "";
      try {
        const bc = JSON.parse(text);
        if (!bc.name) bc.name = name;
        // Back-compat: map legacy per-bucket topK -> maxLevels if present
        try {
          if (bc.topK != null && bc.maxLevels == null)
            bc.maxLevels = bc.topK | 0;
          if (bc.topK != null) delete bc.topK;
        } catch {}
        if (!Array.isArray(bc.features) || bc.features.length === 0)
          throw new Error("empty_features");
        return bc;
      } catch {}

      // If parsing failed, try falling back to the preset JSON (so notes don't disable rules)
      try {
        if (
          presetName &&
          BUCKET_PRESETS &&
          Object.prototype.hasOwnProperty.call(BUCKET_PRESETS, presetName)
        ) {
          const presetText = BUCKET_PRESETS[presetName];
          if (typeof presetText === "string" && presetText.trim().length) {
            const bc = JSON.parse(presetText);
            if (!bc.name) bc.name = name;
            return bc;
          }
          if (presetText && typeof presetText === "object") {
            const bc = JSON.parse(JSON.stringify(presetText));
            if (!bc.name) bc.name = name;
            return bc;
          }
        }
      } catch {}

      // Last resort: keep a minimal but bounded bucket to avoid accepting everything
      return {
        name,
        maxLevels: name === "Hardest" ? 0 : 20,
        selectWeight: 1,
        features: [
          // Require at least solvable and a modest length band as a sanity gate
          {
            id: "precheck.hasExitInComponent",
            mode: "Band",
            bandMin: 1,
            bandMax: 1,
            weight: 0,
            hard: true,
          },
          {
            id: "solutionLength",
            mode: "Band",
            bandMin: 8,
            bandMax: 200,
            weight: 0,
            hard: true,
          },
        ],
      };
    }
    // Buckets may not be in scope if this helper is called from a different closure path.
    // Safely resolve buckets from local state; fallback to default presets when unavailable.
    // Helper: scrape bucket JSON directly from the DOM textareas when closure state is unavailable
    function readBucketsFromDom() {
      try {
        const out = [];
        const container = document.getElementById("bucketRows");
        if (!container) return out;
        const areas = container.querySelectorAll("textarea");
        areas.forEach((ta) => {
          const txt = String(ta.value || "").replace(/^\s*\/\/.*$/gm, "");
          try {
            const bc = JSON.parse(txt);
            if (bc && Array.isArray(bc.features) && bc.features.length > 0)
              out.push(bc);
          } catch {}
        });
        console.log("[auto] DOM buckets read", out.length);
        return out;
      } catch {
        return [];
      }
    }

    let bucketsCfg = [];
    const bucketsList =
      typeof buckets !== "undefined" && Array.isArray(buckets) ? buckets : [];
    if (bucketsList.length) {
      for (const b of bucketsList) {
        try {
          console.log("[auto] bucket raw", {
            name: b?.name,
            preset: b?.preset,
            rulesType: typeof b?.rules,
            rulesSample:
              typeof b?.rules === "string"
                ? String(b.rules).slice(0, 120)
                : b?.rules,
          });
        } catch {}
        try {
          const bc = toBucketConfig(b.name, b.rules, b.preset);
          // Defensive: ensure features is an array
          if (!Array.isArray(bc.features)) bc.features = [];
          bucketsCfg.push(bc);
          try {
            console.log("[auto] bucket parsed", {
              name: bc?.name,
              featuresCount: (bc?.features || []).length,
            });
          } catch {}
        } catch (e) {
          console.warn(
            "[auto] bucket parse failed; using preset/minimal",
            b?.name,
            e && e.message
          );
          // Try preset then minimal
          try {
            const bc2 = toBucketConfig(b.name, "", b.preset);
            if (!Array.isArray(bc2.features)) bc2.features = [];
            bucketsCfg.push(bc2);
            try {
              console.log("[auto] bucket preset used", {
                name: bc2?.name,
                featuresCount: (bc2?.features || []).length,
              });
            } catch {}
          } catch {
            bucketsCfg.push({
              name: b?.name || "Bucket",
              maxLevels: b?.name === "Hardest" ? 0 : 20,
              selectWeight: 1,
              features: [
                {
                  id: "precheck.hasExitInComponent",
                  mode: "Band",
                  bandMin: 1,
                  bandMax: 1,
                  weight: 0,
                  hard: true,
                },
                {
                  id: "solutionLength",
                  mode: "Band",
                  bandMin: 8,
                  bandMax: 200,
                  weight: 0,
                  hard: true,
                },
              ],
            });
            try {
              console.log("[auto] bucket minimal fallback used", b?.name);
            } catch {}
          }
        }
      }
    } else {
      console.warn("[auto] buckets empty/undefined; trying DOM, then presets");
      // Try reading directly from the DOM textareas first
      const domBuckets = readBucketsFromDom();
      if (domBuckets.length) {
        for (const db of domBuckets) {
          try {
            const bc = toBucketConfig(db.name || "Bucket", db, db.name || "");
            if (!Array.isArray(bc.features)) bc.features = [];
            bucketsCfg.push(bc);
          } catch {}
        }
      }
      // If still empty, use presets
      if (bucketsCfg.length === 0) {
        const baseNames = [
          "Easy",
          "Medium",
          "Hard",
          "Hardest",
          "EvolutionBase",
        ];
        bucketsCfg = baseNames.map((name) => {
          try {
            return toBucketConfig(name, "", name);
          } catch {
            return {
              name,
              maxLevels: name === "Hardest" ? 0 : 20,
              selectWeight: 1,
              features: [],
            };
          }
        });
      }
    }
    // Debug log: show parsed bucket heuristic parameters once they are read
    try {
      const logBuckets = (bucketsCfg || []).map((b) => ({
        name: b?.name,
        maxLevels: b?.maxLevels,
        selectWeight: b?.selectWeight,
        T_sol: b?.T_sol,
        T_layout: b?.T_layout,
        w_tiles: b?.w_tiles,
        w_entities: b?.w_entities,
        w_spatial: b?.w_spatial,
        features: Array.isArray(b?.features)
          ? b.features.map((f) => ({
              id: f?.id,
              mode: f?.mode,
              bandMin: f?.bandMin,
              bandMax: f?.bandMax,
              weight: f?.weight,
              hard: !!f?.hard,
            }))
          : [],
      }));
      console.log("[auto] Bucket params (parsed)", logBuckets);
    } catch {}
    const solver = {
      NodesCap:
        Number(document.getElementById("solverMaxNodes")?.value) || 200000,
      DepthCap:
        Number(document.getElementById("solverMaxDepth")?.value) || 10000,
      TimeCapSeconds: 10.0,
      EnforceTimeCap: false,
      MinSteps: Math.max(
        0,
        Number(document.getElementById("autoMinSteps")?.value) || 0
      ),
      RequireHarderThanBase:
        !!document.getElementById("autoRequireHarder")?.checked,
    };
    const selection = {
      topK: Math.max(
        1,
        Number(document.getElementById("autoSelectTopK")?.value) || 5
      ),
      skew: Math.max(
        0,
        Number(document.getElementById("autoSelectSkew")?.value) || 1
      ),
    };
    // Collect allowed tiles/entities from UI chips
    const tilesSel = Array.from(
      document.querySelectorAll("#autoTilesChips .tile-chip.active") || []
    )
      .map((b) => b.dataset.tile)
      .filter(Boolean);
    const entsSel = Array.from(
      document.querySelectorAll("#autoEntitiesChips .tile-chip.active") || []
    )
      .map((b) => b.dataset.entity)
      .filter(Boolean);
    // Require at least one non-empty allow-list
    if (
      (!tilesSel || tilesSel.length === 0) &&
      (!entsSel || entsSel.length === 0)
    ) {
      throw new Error("empty_allow_lists");
    }
    // Collect min/max counts
    function collectCounts(rootSelector, kind, specialNames) {
      const rows = document.querySelectorAll(`${rootSelector} .chip-row`) || [];
      const out = {};
      for (const row of rows) {
        const btn = row.querySelector("button.tile-chip");
        if (!btn) continue;
        const name = kind === "tile" ? btn.dataset.tile : btn.dataset.entity;
        if (!name) continue;
        const minEl = row.querySelector("input.count-input.min");
        const maxEl = row.querySelector("input.count-input.max");
        const vmin = Number(minEl?.value ?? -1);
        const vmax = Number(maxEl?.value ?? -1);
        const useNullToOverride = specialNames && specialNames.has(name);
        const minVal =
          vmin >= 0 ? vmin | 0 : useNullToOverride ? null : undefined;
        const maxVal =
          vmax >= 0 ? vmax | 0 : useNullToOverride ? null : undefined;
        if (minVal !== undefined || maxVal !== undefined) {
          out[name] = { min: minVal ?? null, max: maxVal ?? null };
        }
      }
      return out;
    }
    const tileCounts = collectCounts(
      "#autoTilesChips",
      "tile",
      new Set(["Exit"])
    );
    let entityCounts = collectCounts(
      "#autoEntitiesChips",
      "entity",
      new Set(["PlayerSpawn"])
    );
    // Prune counts to selected allow-lists so a min/max does not implicitly enable placement
    try {
      if (Array.isArray(tilesSel) && tilesSel.length && tileCounts) {
        const allow = new Set(tilesSel.map(String));
        for (const k of Object.keys(tileCounts))
          if (!allow.has(String(k))) delete tileCounts[k];
      }
      if (Array.isArray(entsSel) && entsSel.length && entityCounts) {
        const allow = new Set(entsSel.map(String));
        for (const k of Object.keys(entityCounts))
          if (!allow.has(String(k))) delete entityCounts[k];
      }
    } catch {}
    // Flip mask vertically to match engine coordinates (row 0 = top); reach intersection will be applied later per-candidate
    let editMaskTiles, editMaskEntities;
    try {
      if (maskState.grid && maskState.h > 0 && maskState.w > 0) {
        const g = maskState.grid.slice().reverse();
        const h = snapshot?.height | 0,
          w = snapshot?.width | 0;
        editMaskTiles = Array.from({ length: h }, (_, y) =>
          Array.from({ length: w }, (_, x) => (g[y]?.[x] | 0) === 2)
        );
        editMaskEntities = Array.from({ length: h }, (_, y) =>
          Array.from({ length: w }, (_, x) => (g[y]?.[x] | 0) >= 1)
        );
      }
    } catch {}
    const allowMovePlayer =
      Array.isArray(entsSel) && entsSel.includes("PlayerSpawn");
    const mutation = {
      stepsBase: Math.max(
        1,
        Number(document.getElementById("autoBaseChanges")?.value) || 5
      ),
      stepsEvolve: Math.max(
        1,
        Number(document.getElementById("autoEvolveChanges")?.value) || 1
      ),
      tilesPlace: tilesSel.length ? tilesSel : null,
      entitiesPlace: entsSel.length ? entsSel : null,
      greedyRatio: 0,
      tileCounts: Object.keys(tileCounts).length ? tileCounts : undefined,
      entityCounts: Object.keys(entityCounts).length ? entityCounts : undefined,
      editAllowMask: editMaskTiles,
      editAllowEntitiesMask: editMaskEntities,
      movePlayer: allowMovePlayer,
      operatorWeights: {
        replaceTile: 0.15,
        placeEntity: 0.1,
        removeEntity: 0.05,
        greedyPlaceOne: 0.05,
        greedyRemoveOne: 0.05,
      },
    };
    const dedupe = {
      T_sol: 0.12,
      T_layout: 0.25,
      w_tiles: 0.4,
      w_entities: 0.4,
      w_spatial: 0.2,
    };
    const derived =
      typeof DERIVED_DEFAULTS !== "undefined" && Array.isArray(DERIVED_DEFAULTS)
        ? DERIVED_DEFAULTS
        : [];
    const traceSel = Array.from(
      document.getElementById("autoTraceRequire")?.selectedOptions || []
    )
      .map((o) => o.value)
      .filter(Boolean);
    return {
      generator: {},
      buckets: bucketsCfg,
      solver,
      selection,
      mutation,
      dedupe,
      derived,
      traceRequire: traceSel,
    };
  }

  // Shared: core candidate builder used by run loop and Generate One
  async function buildCandidate(
    base,
    settingsPreview,
    cfg,
    nChanges,
    frozenGreedyRatio,
    allowMovePlayerSetting
  ) {
    // Always deep-clone the provided base so we never mutate the stored snapshot or pool entries
    const deepClone = (obj) => JSON.parse(JSON.stringify(obj));
    // Lazily compute baseMoves/pathMask only if needed (exploration/path-bias or gating)
    let baseMoves = null;
    let pathMask = null;
    let lvl = deepClone(base);
    // Derive effective masks by intersecting UI mask (from maskState when available) with reachability
    try {
      function computeReach(dto) {
        try {
          const h = dto.height | 0,
            w = dto.width | 0,
            grid = dto.tileGrid || [];
          const inB = (x, y) => x >= 0 && y >= 0 && x < w && y < h;
          const isWall = (n) =>
            String(n || "")
              .toLowerCase()
              .includes("wall");
          // Only walls delimit the perimeter for player reach; everything else is passable for reach
          const pass = (x, y) => {
            const n = String(grid[y]?.[x] || "").toLowerCase();
            return !isWall(n);
          };
          const seen = Array.from({ length: h }, () => Array(w).fill(false));
          const q = [];
          const ps = (dto.entities || []).find(
            (e) => e && e.type === "PlayerSpawn"
          );
          if (ps && inB(ps.x, ps.y) && pass(ps.x, ps.y)) {
            seen[ps.y][ps.x] = true;
            q.push({ x: ps.x, y: ps.y });
          }
          const dirs = [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ];
          while (q.length) {
            const { x, y } = q.shift();
            for (const [dx, dy] of dirs) {
              const nx = x + dx,
                ny = y + dy;
              if (!inB(nx, ny) || seen[ny][nx] || !pass(nx, ny)) continue;
              seen[ny][nx] = true;
              q.push({ x: nx, y: ny });
            }
          }
          const reachPlusWalls = Array.from({ length: h }, () =>
            Array(w).fill(false)
          );
          for (let y = 0; y < h; y++)
            for (let x = 0; x < w; x++) {
              if (seen[y][x]) {
                reachPlusWalls[y][x] = true;
                continue;
              }
              if (isWall(grid[y]?.[x])) {
                const adj = [
                  [1, 0],
                  [-1, 0],
                  [0, 1],
                  [0, -1],
                ].some(([dx, dy]) => {
                  const nx = x + dx,
                    ny = y + dy;
                  return inB(nx, ny) && seen[ny][nx];
                });
                if (adj) reachPlusWalls[y][x] = true;
              }
            }
          return { reach: seen, reachPlusWalls };
        } catch {
          return { reach: null, reachPlusWalls: null };
        }
      }
      const reachInfo = computeReach(lvl);
      const h = lvl?.height | 0 || 0,
        w = lvl?.width | 0 || 0;
      // Prefer live UI maskState if present; fall back to settingsPreview masks
      let uiTileMask = settingsPreview?.mutation?.editAllowMask;
      let uiEntMask = settingsPreview?.mutation?.editAllowEntitiesMask;
      try {
        if (maskState && maskState.grid && maskState.h > 0 && maskState.w > 0) {
          const g = maskState.grid.slice().reverse(); // flip to engine coords
          // Rebuild UI masks sized to current level
          uiTileMask = Array.from({ length: h }, (_, y) =>
            Array.from({ length: w }, (_, x) => (g[y]?.[x] | 0) === 2)
          );
          uiEntMask = Array.from({ length: h }, (_, y) =>
            Array.from({ length: w }, (_, x) => (g[y]?.[x] | 0) >= 1)
          );
        }
      } catch {}
      const effTile = Array.from({ length: h }, (_, y) =>
        Array.from({ length: w }, (_, x) => {
          const allowUI = uiTileMask ? !!uiTileMask[y]?.[x] : true;
          const allowReach = !!(
            reachInfo.reach?.[y]?.[x] || reachInfo.reachPlusWalls?.[y]?.[x]
          );
          return allowUI && allowReach;
        })
      );
      const effEnt = Array.from({ length: h }, (_, y) =>
        Array.from({ length: w }, (_, x) => {
          const allowUI = uiEntMask ? !!uiEntMask[y]?.[x] : true;
          const allowReach = !!reachInfo.reach?.[y]?.[x];
          return allowUI && allowReach;
        })
      );
      if (settingsPreview && settingsPreview.mutation) {
        settingsPreview.mutation.editAllowMask = effTile;
        settingsPreview.mutation.editAllowEntitiesMask = effEnt;
      }
    } catch {}
    // Counts-first helpers
    async function countLevel(dto) {
      const tm = Object.create(null),
        em = Object.create(null);
      const H = dto.height | 0,
        W = dto.width | 0;
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          const n = String(dto.tileGrid?.[y]?.[x] || "");
          if (n) tm[n] = (tm[n] | 0) + 1;
        }
      for (const e of dto.entities || [])
        if (e && e.type) {
          const n = String(e.type);
          em[n] = (em[n] | 0) + 1;
        }
      return { tm, em };
    }
    function deficitsAndExcess(cur, wantTiles, wantEnts) {
      const defT = [],
        defE = [],
        excT = [],
        excE = [];
      for (const [name, mm] of Object.entries(wantTiles || {})) {
        const curN = cur.tm[name] | 0;
        if (mm && mm.min != null && curN < mm.min)
          defT.push([name, mm.min - curN]);
        if (mm && mm.max != null && curN > mm.max)
          excT.push([name, curN - mm.max]);
      }
      for (const [name, mm] of Object.entries(wantEnts || {})) {
        const curN = cur.em[name] | 0;
        if (mm && mm.min != null && curN < mm.min)
          defE.push([name, mm.min - curN]);
        if (mm && mm.max != null && curN > mm.max)
          excE.push([name, curN - mm.max]);
      }
      return { defT, defE, excT, excE };
    }
    // Post-validate operations to ensure engine respected masks; if not, revert
    function findTileDiff(before, after) {
      try {
        const h = after.height | 0,
          w = after.width | 0;
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            if (
              (before.tileGrid?.[y]?.[x] || "") !==
              (after.tileGrid?.[y]?.[x] || "")
            )
              return { x, y };
          }
        }
      } catch {}
      return null;
    }
    function entityPosMultiset(dto, type) {
      const m = new Map();
      for (const e of dto.entities || []) {
        if (!e || e.type !== type) continue;
        const key = e.x + "," + e.y;
        m.set(key, (m.get(key) || 0) + 1);
      }
      return m;
    }
    function findEntityDelta(before, after, type) {
      const b = entityPosMultiset(before, type);
      const a = entityPosMultiset(after, type);
      // look for added
      for (const [k, av] of a) {
        const bv = b.get(k) || 0;
        if (av > bv) {
          const [xs, ys] = k.split(",");
          return { kind: "add", x: xs | 0, y: ys | 0 };
        }
      }
      // look for removed
      for (const [k, bv] of b) {
        const av = a.get(k) || 0;
        if (bv > av) {
          const [xs, ys] = k.split(",");
          return { kind: "del", x: xs | 0, y: ys | 0 };
        }
      }
      // look for moved (one add + one del with same count) — already caught above as add/del
      return null;
    }
    function isAllowedTileCell(y, x) {
      return !!settingsPreview?.mutation?.editAllowMask?.[y]?.[x];
    }
    function isAllowedEntCell(y, x) {
      return !!settingsPreview?.mutation?.editAllowEntitiesMask?.[y]?.[x];
    }
    async function placeOneTile(dto, name) {
      const opts = {
        tilesPlace: [name],
        entitiesPlace: [],
        movePlayer: !!settingsPreview?.mutation?.movePlayer,
        maxDepth: settingsPreview?.solver?.DepthCap || 100,
        maxNodes: settingsPreview?.solver?.NodesCap || 200000,
        minSteps: Math.max(0, Number(settingsPreview?.solver?.MinSteps) || 0),
        requireHarderThanBase: !!settingsPreview?.solver?.RequireHarderThanBase,
        editAllowMask: settingsPreview?.mutation?.editAllowMask || null,
        editAllowEntitiesMask:
          settingsPreview?.mutation?.editAllowEntitiesMask || null,
      };
      const r = await (ald.aldPlaceOne
        ? ald.aldPlaceOne(dto, opts)
        : api.aldPlaceOne(dto, opts));
      if (!(r && r.ok && r.level)) return dto;
      const diff = findTileDiff(dto, r.level);
      if (!diff) return dto;
      if (!isAllowedTileCell(diff.y, diff.x)) return dto; // revert if outside mask
      return r.level;
    }
    async function placeOneEntity(dto, name) {
      const opts = {
        tilesPlace: [],
        entitiesPlace: [name],
        movePlayer: !!settingsPreview?.mutation?.movePlayer,
        maxDepth: settingsPreview?.solver?.DepthCap || 100,
        maxNodes: settingsPreview?.solver?.NodesCap || 200000,
        minSteps: Math.max(0, Number(settingsPreview?.solver?.MinSteps) || 0),
        requireHarderThanBase: !!settingsPreview?.solver?.RequireHarderThanBase,
        editAllowMask: settingsPreview?.mutation?.editAllowMask || null,
        editAllowEntitiesMask:
          settingsPreview?.mutation?.editAllowEntitiesMask || null,
      };
      const r = await (ald.aldPlaceOne
        ? ald.aldPlaceOne(dto, opts)
        : api.aldPlaceOne(dto, opts));
      if (!(r && r.ok && r.level)) return dto;
      const delta = findEntityDelta(dto, r.level, name);
      if (!delta) return dto;
      if (delta.kind === "add" && !isAllowedEntCell(delta.y, delta.x))
        return dto;
      return r.level;
    }
    async function removeOneEntity(dto, name) {
      const opts = {
        entitiesRemove: [name],
        maxDepth: settingsPreview?.solver?.DepthCap || 100,
        maxNodes: settingsPreview?.solver?.NodesCap || 200000,
        editAllowMask: settingsPreview?.mutation?.editAllowMask || null,
        editAllowEntitiesMask:
          settingsPreview?.mutation?.editAllowEntitiesMask || null,
      };
      const r = await (ald.aldRemoveOne
        ? ald.aldRemoveOne(dto, opts)
        : api.aldRemoveOne(dto, opts));
      if (!(r && r.ok && r.level)) return dto;
      const delta = findEntityDelta(dto, r.level, name);
      if (!delta) return dto;
      if (delta.kind === "del" && !isAllowedEntCell(delta.y, delta.x))
        return dto;
      return r.level;
    }
    function replaceOneTileLocal(dto, overName, replNames) {
      try {
        const H = dto.height | 0,
          W = dto.width | 0;
        const mask = settingsPreview?.mutation?.editAllowMask;
        for (let y = 0; y < H; y++)
          for (let x = 0; x < W; x++) {
            if (
              dto.tileGrid?.[y]?.[x] === overName &&
              (!mask || mask[y]?.[x])
            ) {
              const nn = replNames.find((n) => n && n !== overName);
              if (!nn) return dto;
              dto.tileGrid[y][x] = nn;
              return dto;
            }
          }
      } catch {}
      return dto;
    }
    // Fast local tile setter to satisfy deficits without WASM calls
    function fastPlaceOneTileLocal(dto, name) {
      try {
        const H = dto.height | 0,
          W = dto.width | 0;
        const mask = settingsPreview?.mutation?.editAllowMask;
        // collect allowed cells not already of the target type
        const cells = [];
        for (let y = 0; y < H; y++)
          for (let x = 0; x < W; x++)
            if (!mask || mask[y]?.[x]) {
              if (String(dto.tileGrid?.[y]?.[x] || "") !== name)
                cells.push({ x, y });
            }
        if (!cells.length) return dto;
        // shuffle small
        for (let i = cells.length - 1; i > 0; i--) {
          const j = (Math.random() * (i + 1)) | 0;
          const t = cells[i];
          cells[i] = cells[j];
          cells[j] = t;
        }
        const c = cells[0];
        dto.tileGrid[c.y][c.x] = name;
        return dto;
      } catch {
        return dto;
      }
    }
    // counts-first
    const wantTiles = settingsPreview?.mutation?.tileCounts || {};
    const wantEnts = settingsPreview?.mutation?.entityCounts || {};
    const allowedTiles = Array.from(
      settingsPreview?.mutation?.tilesPlace || []
    );
    let usedCountEdits = 0;
    let safety = 40;
    while (safety-- > 0) {
      const cur = await countLevel(lvl);
      const { defT, defE, excT, excE } = deficitsAndExcess(
        cur,
        wantTiles,
        wantEnts
      );
      if (
        defT.length === 0 &&
        defE.length === 0 &&
        excT.length === 0 &&
        excE.length === 0
      )
        break;
      if (defT.length) {
        const [name] = defT[0];
        // Try fast local placement first (instant)
        const beforeGrid = JSON.stringify(lvl.tileGrid);
        lvl = fastPlaceOneTileLocal(lvl, name);
        if (JSON.stringify(lvl.tileGrid) !== beforeGrid) {
          usedCountEdits++;
          continue;
        }
        // Fallback to engine op
        const before = lvl;
        lvl = await placeOneTile(lvl, name);
        if (lvl !== before) usedCountEdits++;
        continue;
      }
      if (defE.length) {
        const [name] = defE[0];
        const before = lvl;
        lvl = await placeOneEntity(lvl, name);
        if (lvl !== before) usedCountEdits++;
        continue;
      }
      if (excE.length) {
        const [name] = excE[0];
        const before = lvl;
        lvl = await removeOneEntity(lvl, name);
        if (lvl !== before) usedCountEdits++;
        continue;
      }
      if (excT.length) {
        const [name] = excT[0];
        const cur2 = await countLevel(lvl);
        const { defT: dt } = deficitsAndExcess(cur2, wantTiles, wantEnts);
        const preferred = dt.length
          ? [dt[0][0]]
          : allowedTiles.filter((n) => n !== name);
        const before = JSON.stringify(lvl.tileGrid);
        lvl = replaceOneTileLocal(lvl, name, preferred);
        if (JSON.stringify(lvl.tileGrid) !== before) usedCountEdits++;
        continue;
      }
    }
    // exploration helpers
    function cellsFromMask(mask) {
      const out = [];
      const H = lvl.height | 0,
        W = lvl.width | 0;
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) if (mask?.[y]?.[x]) out.push({ x, y });
      for (let i = out.length - 1; i > 0; i--) {
        const j = (Math.random() * (i + 1)) | 0;
        const t = out[i];
        out[i] = out[j];
        out[j] = t;
      }
      return out;
    }
    function selectCellsWithPathBias(mask, pathMask) {
      const all = cellsFromMask(mask);
      if (!pathMask || !all.length) return all;
      const onPath = [];
      for (const c of all) {
        if (pathMask?.[c.y]?.[c.x]) onPath.push(c);
      }
      if (onPath.length && Math.random() < 0.8) return onPath;
      return all;
    }
    function okCountsTile(changeFrom, changeTo, tm, tCounts) {
      const mmFrom = tCounts && tCounts[changeFrom];
      const mmTo = tCounts && tCounts[changeTo];
      const curFrom = tm[changeFrom] | 0,
        curTo = tm[changeTo] | 0;
      if (mmFrom && mmFrom.min != null && curFrom - 1 < mmFrom.min)
        return false;
      if (mmTo && mmTo.max != null && curTo + 1 > mmTo.max) return false;
      return true;
    }
    function okCountsEntityAdd(name, em, eCounts) {
      const mm = eCounts && eCounts[name];
      const cur = em[name] | 0;
      if (mm && mm.max != null && cur + 1 > mm.max) return false;
      return true;
    }
    function okCountsEntityRemove(name, em, eCounts) {
      const mm = eCounts && eCounts[name];
      const cur = em[name] | 0;
      if (mm && mm.min != null && cur - 1 < mm.min) return false;
      return true;
    }
    function cellOccupied(dto, x, y) {
      return (
        Array.isArray(dto.entities) &&
        dto.entities.some((e) => e && e.x === x && e.y === y)
      );
    }
    async function exploreOnce() {
      const tList = Array.from(settingsPreview?.mutation?.tilesPlace || []);
      const eList = Array.from(settingsPreview?.mutation?.entitiesPlace || []);
      if (!tList.length && !eList.length) return false;
      const chooseTile = tList.length && (!eList.length || Math.random() < 0.7);
      const countsNow = await countLevel(lvl);
      const tryTile = async () => {
        const mask = settingsPreview?.mutation?.editAllowMask || [];
        const cells = selectCellsWithPathBias(mask, pathMask);
        let tries = 20;
        while (tries-- > 0) {
          const c = cells[(Math.random() * cells.length) | 0];
          if (!c) break;
          const old = String(lvl.tileGrid?.[c.y]?.[c.x] || "");
          const pick = tList[(Math.random() * tList.length) | 0];
          if (!pick || pick === old) continue;
          if (
            !okCountsTile(
              old,
              pick,
              countsNow.tm,
              settingsPreview?.mutation?.tileCounts
            )
          )
            continue;
          lvl.tileGrid[c.y][c.x] = pick;
          countsNow.tm[old] = (countsNow.tm[old] | 0) - 1;
          countsNow.tm[pick] = (countsNow.tm[pick] | 0) + 1;
          return true;
        }
        return false;
      };
      const tryEntity = async () => {
        const mask = settingsPreview?.mutation?.editAllowEntitiesMask || [];
        const cells = selectCellsWithPathBias(mask, pathMask);
        const eName = eList[(Math.random() * eList.length) | 0];
        if (!eName) return false;
        const op = ["delete", "place", "move"][(Math.random() * 3) | 0];
        if (op === "delete") {
          if (
            !okCountsEntityRemove(
              eName,
              countsNow.em,
              settingsPreview?.mutation?.entityCounts
            )
          )
            return false;
          const idx = (lvl.entities || []).findIndex(
            (e) => e && e.type === eName
          );
          if (idx < 0) return false;
          const e = lvl.entities[idx];
          if (!mask?.[e.y]?.[e.x]) return false;
          lvl.entities.splice(idx, 1);
          countsNow.em[eName] = (countsNow.em[eName] | 0) - 1;
          return true;
        }
        if (op === "place") {
          if (
            !okCountsEntityAdd(
              eName,
              countsNow.em,
              settingsPreview?.mutation?.entityCounts
            )
          )
            return false;
          let tries = 20;
          while (tries-- > 0) {
            const c = cells[(Math.random() * cells.length) | 0];
            if (!c) break;
            if (cellOccupied(lvl, c.x, c.y)) continue;
            if (
              eName === "PlayerSpawn" &&
              !settingsPreview?.mutation?.movePlayer
            )
              return false;
            (lvl.entities || (lvl.entities = [])).push({
              type: eName,
              x: c.x,
              y: c.y,
            });
            countsNow.em[eName] = (countsNow.em[eName] | 0) + 1;
            return true;
          }
          return false;
        }
        const idx = (lvl.entities || []).findIndex(
          (e) => e && e.type === eName
        );
        if (idx < 0) return false;
        if (eName === "PlayerSpawn" && !settingsPreview?.mutation?.movePlayer)
          return false;
        // Moving touches old (delete) and new (place); require both to be in allowed mask
        const e0 = lvl.entities[idx];
        if (!mask?.[e0.y]?.[e0.x]) return false;
        let tries = 20;
        while (tries-- > 0) {
          const c = cells[(Math.random() * cells.length) | 0];
          if (!c) break;
          if (cellOccupied(lvl, c.x, c.y)) continue;
          const e = lvl.entities[idx];
          e.x = c.x;
          e.y = c.y;
          return true;
        }
        return false;
      };
      if (chooseTile) {
        const ok = await tryTile();
        if (ok) return true;
        if (eList.length) return await tryEntity();
        return false;
      } else {
        const ok = await tryEntity();
        if (ok) return true;
        if (tList.length) return await tryTile();
        return false;
      }
    }
    // exploration steps
    const _maxSteps = Math.max(1, (nChanges | 0) - usedCountEdits);
    let exploreSteps = (Math.random() * (_maxSteps + 1)) | 0;
    if (exploreSteps > 0 && !pathMask) {
      // Need path-bias; compute baseMoves and visited mask now
      try {
        baseMoves = await getShortestMovesForBase(base, cfg);
      } catch {}
      try {
        if (baseMoves)
          pathMask = await computeVisitedCellsFromMoves(base, baseMoves);
      } catch {}
    }
    while (exploreSteps-- > 0) {
      const ok = await exploreOnce();
      if (!ok) break;
    }
    // Enforce PlayerSpawn immobility if not allowed
    try {
      if (!allowMovePlayerSetting && lvl && base) {
        const findPs = (d) =>
          Array.isArray(d.entities)
            ? d.entities.find((e) => e && e.type === "PlayerSpawn")
            : null;
        const psBase = findPs(base);
        if (psBase) {
          if (!Array.isArray(lvl.entities)) lvl.entities = [];
          const idx = lvl.entities.findIndex(
            (e) => e && e.type === "PlayerSpawn"
          );
          const fixed = {
            type: "PlayerSpawn",
            x: psBase.x | 0,
            y: psBase.y | 0,
          };
          if (idx >= 0) lvl.entities[idx] = fixed;
          else lvl.entities.push(fixed);
        }
      }
    } catch {}
    // Greedy last-op coin flip
    try {
      if (Math.random() < Math.max(0, Math.min(1, frozenGreedyRatio))) {
        const opts = {
          tilesPlace: settingsPreview?.mutation?.tilesPlace || [],
          entitiesPlace: settingsPreview?.mutation?.entitiesPlace || [],
          movePlayer: !!settingsPreview?.mutation?.movePlayer,
          maxDepth: settingsPreview?.solver?.DepthCap || 100,
          maxNodes: settingsPreview?.solver?.NodesCap || 200000,
          editAllowMask: settingsPreview?.mutation?.editAllowMask || null,
          editAllowEntitiesMask:
            settingsPreview?.mutation?.editAllowEntitiesMask || null,
        };
        const before = JSON.parse(JSON.stringify(lvl));
        const res = await (ald.aldPlaceOne
          ? ald.aldPlaceOne(lvl, opts)
          : api.aldPlaceOne(lvl, opts));
        if (res && res.ok && res.level) {
          // Post-validate change landed within mask
          const tdiff = findTileDiff(before, res.level);
          if (tdiff) {
            if (isAllowedTileCell(tdiff.y, tdiff.x)) {
              lvl = res.level;
            }
          } else {
            // Check any entity delta regardless of type
            const posCount = (dto) => {
              const m = new Map();
              for (const e of dto.entities || []) {
                if (!e) continue;
                const k = e.x + "," + e.y;
                m.set(k, (m.get(k) || 0) + 1);
              }
              return m;
            };
            const b = posCount(before),
              a = posCount(res.level);
            let ok = false;
            for (const [k, av] of a) {
              const bv = b.get(k) || 0;
              if (av > bv) {
                const [xs, ys] = k.split(",");
                if (isAllowedEntCell(ys | 0, xs | 0)) {
                  ok = true;
                  break;
                } else {
                  ok = false;
                  break;
                }
              }
            }
            if (!ok) {
              for (const [k, bv] of b) {
                const av = a.get(k) || 0;
                if (bv > av) {
                  const [xs, ys] = k.split(",");
                  if (isAllowedEntCell(ys | 0, xs | 0)) {
                    ok = true;
                    break;
                  } else {
                    ok = false;
                    break;
                  }
                }
              }
            }
            if (ok) lvl = res.level;
          }
        }
      }
    } catch {}
    // Solution-similarity gate for replacements (if evolving)
    if (!baseMoves) {
      try {
        baseMoves = await getShortestMovesForBase(base, cfg);
      } catch {}
    }
    if (baseMoves) {
      try {
        const repCand = await api.solverAnalyze(lvl, cfg);
        const topC = repCand && repCand.topSolutions && repCand.topSolutions[0];
        if (topC && topC.length && topC.movesPacked) {
          const candMoves = unpackMovesPacked(topC.movesPacked, topC.length);
          const dist = editDistance(baseMoves, candMoves);
          if (dist > 3)
            return { rejected: true, reason: "solution_not_similar" };
        }
      } catch {}
    }
    // Replay-discard using base solution
    try {
      if (!baseMoves) {
        try {
          baseMoves = await getShortestMovesForBase(base, cfg);
        } catch {}
      }
      if (baseMoves) {
        const works = await sequenceSolvesLevel(lvl, baseMoves);
        if (works)
          return { rejected: true, reason: "base_solution_still_works" };
      }
    } catch {}
    // Cleanup unreachable before insert/preview
    try {
      lvl = fillWallsOnLevel(lvl);
    } catch {}
    return { lvl, rejected: false };
  }
}
