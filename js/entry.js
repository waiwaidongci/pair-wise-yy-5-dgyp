/* 入口模块：画布交互、渲染、撤销重做、本地保存与导出。
   判定逻辑走 BrocadeJudge，接版与发布版走 BrocadeArchive。 */
(() => {
  const Judge = window.BrocadeJudge;
  const Archive = window.BrocadeArchive;
  const STORE_KEY = "zfl31Pattern";

  const colors = ["#f7e7c4", "#a6322d", "#1f5f78", "#d6a437", "#355b38", "#713d7b", "#1e1b18", "#e98c52"];
  const $ = (id) => document.getElementById(id);
  const els = {
    grid: $("grid"), palette: $("palette"), stats: $("stats"), risk: $("risk"),
    tileview: $("tileview"), pending: $("pending"), releases: $("releases"),
    cols: $("cols"), rows: $("rows"),
    unitX: $("unitX"), unitY: $("unitY"), offX: $("offX"), offY: $("offY"),
    maker: $("maker"), reviewer: $("reviewer"),
    joinMsg: $("joinMsg"), reviewMsg: $("reviewMsg"),
  };

  const state = {
    cols: 18, rows: 14, cells: [],
    block: "dot", active: 1,
    unit: { x: 0, y: 0 },     // 6×6 重复单元左上角
    offset: { dx: 0, dy: 0 }, // 四方连续错位量
    maker: "甲",
    undo: [], redo: [],
  };
  let dragging = false;

  /* ---------- 本地Storage 持久化（重开后撤销/统计/导出一致） ---------- */
  function save() {
    localStorage.setItem(STORE_KEY, JSON.stringify({
      version: 2,
      cols: state.cols, rows: state.rows, cells: state.cells,
      block: state.block, active: state.active,
      unit: state.unit, offset: state.offset, maker: state.maker,
      undo: state.undo, redo: state.redo,
      archive: Archive.toJSON(),
    }));
  }

  function load() {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
    if (!raw) return false;
    state.cols = raw.cols; state.rows = raw.rows; state.cells = raw.cells;
    if (raw.version === 2) {
      state.block = raw.block; state.active = raw.active;
      state.unit = raw.unit; state.offset = raw.offset; state.maker = raw.maker;
      state.undo = raw.undo || []; state.redo = raw.redo || [];
      Archive.fromJSON(raw.archive);
    } // version 1 仅有 cols/rows/cells，其余用默认值
    return true;
  }

  function syncInputs() {
    els.cols.value = state.cols; els.rows.value = state.rows;
    els.unitX.value = state.unit.x; els.unitY.value = state.unit.y;
    els.offX.value = state.offset.dx; els.offY.value = state.offset.dy;
    els.maker.value = state.maker;
  }

  /* ---------- 画布绘制 ---------- */
  function idx(x, y) {
    return x < 0 || x >= state.cols || y < 0 || y >= state.rows ? null : y * state.cols + x;
  }

  function pattern(i) {
    const x = i % state.cols, y = Math.floor(i / state.cols);
    if (state.block === "cross") return [i, idx(x - 1, y), idx(x + 1, y), idx(x, y - 1), idx(x, y + 1)].filter(v => v !== null);
    if (state.block === "diamond") return [idx(x, y - 1), idx(x - 1, y), i, idx(x + 1, y), idx(x, y + 1)].filter(v => v !== null);
    return [i];
  }

  function snapshot() {
    state.undo.push([...state.cells]);
    state.redo = [];
    if (state.undo.length > 50) state.undo.shift();
  }

  function paint(i) {
    snapshot();
    pattern(i).forEach(t => { state.cells[t] = state.active; });
    save();
    render();
  }

  /* ---------- 接版：判定不过则整次拒绝，保留原画布 ---------- */
  function join() {
    const validation = Judge.validateJoin(state);
    if (!validation.ok) {
      els.joinMsg.innerHTML = validation.errors.map(e => '<p class="warning">' + e + '</p>').join("");
      return; // 原画布不动
    }
    snapshot();
    state.cells = Judge.applyJoin(state);
    Archive.createJoin({
      maker: state.maker || "未署名",
      fingerprint: Judge.fingerprint(state), // 应用后再取指纹，新接版即当前版
      validation,
    });
    els.joinMsg.innerHTML = '<p class="ok">接版通过，已生成一条待复核接版。</p>';
    save();
    render();
  }

  function approve() {
    const result = Archive.approve({
      reviewer: els.reviewer.value.trim(),
      fingerprint: Judge.fingerprint(state),
      snapshot: {
        cols: state.cols, rows: state.rows, cells: [...state.cells],
        block: state.block, unit: { ...state.unit }, offset: { ...state.offset },
      },
    });
    els.reviewMsg.innerHTML = result.error
      ? '<p class="warning">' + result.error + '</p>'
      : '<p class="ok">已冻结为发布版 ' + result.release.id + '。</p>';
    save();
    render();
  }

  function rejectJoin() {
    const result = Archive.rejectPending();
    els.reviewMsg.innerHTML = result.error
      ? '<p class="warning">' + result.error + '</p>'
      : '<p class="ok">已驳回该待复核接版。</p>';
    save();
    render();
  }

  /* ---------- 渲染 ---------- */
  function render() {
    Archive.invalidateIf(Judge.fingerprint(state));
    renderPalette();
    renderGrid();
    renderStats();
    renderTilePreview();
    renderPending();
    renderReleases();
  }

  function renderPalette() {
    els.palette.innerHTML = colors.map((c, i) =>
      '<button class="swatch ' + (i === state.active ? 'active' : '') + '" data-color="' + i + '" style="background:' + c + '"></button>'
    ).join("");
    els.palette.querySelectorAll("[data-color]").forEach(el => {
      el.onclick = () => { state.active = Number(el.dataset.color); save(); render(); };
    });
  }

  function renderGrid() {
    const inUnit = (i) => {
      const x = i % state.cols, y = Math.floor(i / state.cols);
      return x >= state.unit.x && x < state.unit.x + Judge.UNIT && y >= state.unit.y && y < state.unit.y + Judge.UNIT;
    };
    els.grid.style.gridTemplateColumns = "repeat(" + state.cols + ", 1fr)";
    els.grid.innerHTML = state.cells.map((v, i) =>
      '<div class="cell' + (inUnit(i) ? ' in-unit' : '') + '" data-i="' + i + '" style="background:' + colors[v] + '"></div>'
    ).join("");
    els.grid.querySelectorAll(".cell").forEach(el => {
      el.onpointerdown = () => { dragging = true; paint(Number(el.dataset.i)); };
      el.onpointerenter = () => { if (dragging) paint(Number(el.dataset.i)); };
    });
    window.onpointerup = () => { dragging = false; };
  }

  function renderStats() {
    const counts = colors.map((_, i) => state.cells.filter(v => v === i).length);
    els.stats.innerHTML = counts.map((n, i) =>
      '<div class="stat"><span><span style="display:inline-block;width:14px;height:14px;background:' + colors[i] + '"></span> 色线' + i + '</span><b>' + n + '</b></div>'
    ).join("");
    const riskRows = [];
    for (let y = 0; y < state.rows; y++) {
      let switches = 0;
      for (let x = 1; x < state.cols; x++) if (state.cells[y * state.cols + x] !== state.cells[y * state.cols + x - 1]) switches++;
      if (switches > state.cols * .62) riskRows.push(y + 1);
    }
    els.risk.innerHTML = riskRows.length
      ? '<p class="warning">第' + riskRows.join("、") + '行换色过密，可能断线。</p>'
      : '<p>暂无明显断线风险。</p>';
  }

  // 六乘六重复单元按错位平铺 3×3 份预览
  function renderTilePreview() {
    if (!Judge.unitInBounds(state.cols, state.rows, state.unit)) {
      els.tileview.innerHTML = '<p class="warning">重复单元越界，无法平铺预览。</p>';
      return;
    }
    const N = Judge.UNIT * 3;
    let html = "";
    for (let py = 0; py < N; py++) {
      for (let px = 0; px < N; px++) {
        const [ux, uy] = Judge.tileAt(px, py, { x: 0, y: 0 }, state.offset);
        const v = state.cells[(state.unit.y + uy) * state.cols + (state.unit.x + ux)];
        html += '<div class="mini" style="background:' + colors[v] + '"></div>';
      }
    }
    els.tileview.innerHTML = html;
  }

  function renderPending() {
    const p = Archive.getPending();
    if (!p) {
      els.pending.innerHTML = '<p>暂无待复核接版。</p>';
      return;
    }
    const status = p.status === "pending"
      ? '<b class="ok">待复核</b>'
      : '<b class="warning">已失效，需重新生成接版</b>';
    els.pending.innerHTML =
      '<div class="stat"><span>接版号</span><b>' + p.id + '</b></div>' +
      '<div class="stat"><span>制版人</span><b>' + p.maker + '</b></div>' +
      '<div class="stat"><span>状态</span>' + status + '</div>' +
      '<div class="stat"><span>生成时间</span><b>' + new Date(p.createdAt).toLocaleString() + '</b></div>';
  }

  function renderReleases() {
    const list = Archive.getReleases();
    els.releases.innerHTML = list.length
      ? list.map(r =>
          '<div class="stat"><span>' + r.id + ' · 制版 ' + r.maker + ' / 复核 ' + r.reviewer + '</span><b>' + new Date(r.frozenAt).toLocaleString() + '</b></div>'
        ).join("")
      : '<p>尚无发布版。</p>';
  }

  /* ---------- 事件 ---------- */
  document.querySelectorAll("[data-block]").forEach(btn => {
    btn.onclick = () => { state.block = btn.dataset.block; save(); render(); };
  });

  function bindNumber(el, apply) {
    el.onchange = () => { apply(Number(el.value)); save(); render(); };
  }
  bindNumber(els.unitX, v => { state.unit.x = v; });
  bindNumber(els.unitY, v => { state.unit.y = v; });
  bindNumber(els.offX, v => { state.offset.dx = v; });
  bindNumber(els.offY, v => { state.offset.dy = v; });
  els.maker.onchange = () => { state.maker = els.maker.value.trim(); save(); render(); };

  $("newBtn").onclick = () => {
    state.cols = Number(els.cols.value);
    state.rows = Number(els.rows.value);
    state.cells = Array(state.cols * state.rows).fill(0);
    state.undo = []; state.redo = [];
    save();
    render();
  };
  $("undoBtn").onclick = () => {
    if (!state.undo.length) return;
    state.redo.push([...state.cells]);
    state.cells = state.undo.pop();
    save();
    render();
  };
  $("redoBtn").onclick = () => {
    if (!state.redo.length) return;
    state.undo.push([...state.cells]);
    state.cells = state.redo.pop();
    save();
    render();
  };
  $("joinBtn").onclick = join;
  $("approveBtn").onclick = approve;
  $("rejectBtn").onclick = rejectJoin;
  $("saveBtn").onclick = () => { save(); els.joinMsg.innerHTML = '<p class="ok">已保存到本地。</p>'; };
  $("exportBtn").onclick = () => {
    const data = {
      cols: state.cols, rows: state.rows, cells: state.cells,
      block: state.block, active: state.active,
      unit: state.unit, offset: state.offset,
      usage: colors.map((color, i) => ({ color, count: state.cells.filter(v => v === i).length })),
      pendingJoin: Archive.getPending(),
      releases: Archive.getReleases(),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "brocade-pattern.json";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  /* ---------- 启动 ---------- */
  if (!load()) state.cells = Array(state.cols * state.rows).fill(0);
  syncInputs();
  render();
})();
