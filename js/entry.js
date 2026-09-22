/* 入口模块：界面、画布交互、撤销重做、统计与导出，串联判定模块与版本存档模块。 */
(() => {
  const Judge = window.BrocadeJudge;
  const Archive = window.BrocadeArchive;
  const STORE_KEY = "brocadeStudio.v1";
  const LEGACY_KEY = "zfl31Pattern"; // 兼容旧版排版台存档
  const TILE_COPIES = 6; // 六乘六平铺预览：重复单元向经纬两个方向各复制 6 次

  const colors = ["#f7e7c4", "#a6322d", "#1f5f78", "#d6a437", "#355b38", "#713d7b", "#1e1b18", "#e98c52"];
  const $ = (q) => document.querySelector(q);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const escapeHtml = (s) => String(s).replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
  const fmtTime = (iso) => new Date(iso).toLocaleString("zh-CN", { hour12: false });

  const state = {
    cols: 18, rows: 14, cells: [],
    active: 1, block: "dot",
    unit: { x: 0, y: 0, w: 6, h: 6 },
    maker: "",
    undo: [], redo: []
  };
  let dragging = false;

  const judgeState = () => ({
    cols: state.cols, rows: state.rows, cells: state.cells,
    block: state.block, active: state.active, colors, unit: state.unit
  });
  const currentFingerprint = () => Judge.fingerprint(judgeState());

  /* ---------- 本地保存：画布、撤销重做、重复单元与存档重开后一致 ---------- */
  function persist() {
    localStorage.setItem(STORE_KEY, JSON.stringify({
      cols: state.cols, rows: state.rows, cells: state.cells,
      active: state.active, block: state.block, unit: state.unit,
      maker: state.maker, undo: state.undo, redo: state.redo
    }));
  }

  function restore() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(STORE_KEY) || "null"); } catch (e) { saved = null; }
    if (!saved) {
      try {
        const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) || "null");
        if (legacy) saved = { cols: legacy.cols, rows: legacy.rows, cells: legacy.cells };
      } catch (e) { saved = null; }
    }
    if (saved && Array.isArray(saved.cells) && saved.cells.length === saved.cols * saved.rows) {
      state.cols = saved.cols; state.rows = saved.rows; state.cells = saved.cells;
      state.active = Number.isInteger(saved.active) ? saved.active : 1;
      state.block = saved.block || "dot";
      state.unit = saved.unit && saved.unit.w >= 1 && saved.unit.h >= 1 ? saved.unit : { x: 0, y: 0, w: 6, h: 6 };
      state.maker = typeof saved.maker === "string" ? saved.maker : "";
      state.undo = Array.isArray(saved.undo) ? saved.undo : [];
      state.redo = Array.isArray(saved.redo) ? saved.redo : [];
    } else {
      state.cells = Array(state.cols * state.rows).fill(0);
    }
  }

  /* ---------- 渲染 ---------- */
  function render() {
    syncInputs();
    renderPalette();
    renderBlocks();
    renderGrid();
    renderStats();
    renderPreview();
    renderArchive();
    persist();
  }

  function syncInputs() {
    $("#cols").value = state.cols;
    $("#rows").value = state.rows;
    if (document.activeElement !== $("#maker")) $("#maker").value = state.maker;
    $("#unitX").value = state.unit.x;
    $("#unitY").value = state.unit.y;
    $("#unitW").value = state.unit.w;
    $("#unitH").value = state.unit.h;
    $("#unitX").max = state.cols - 1;
    $("#unitY").max = state.rows - 1;
    $("#unitW").max = state.cols;
    $("#unitH").max = state.rows;
  }

  function renderPalette() {
    $("#palette").innerHTML = colors.map((c, i) =>
      '<button class="swatch ' + (i === state.active ? "active" : "") + '" data-color="' + i + '" style="background:' + c + '"></button>'
    ).join("");
    $("#palette").querySelectorAll("[data-color]").forEach(el => {
      el.onclick = () => { state.active = Number(el.dataset.color); render(); };
    });
  }

  function renderBlocks() {
    document.querySelectorAll("[data-block]").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.block === state.block);
    });
  }

  function renderGrid() {
    const g = $("#grid");
    g.style.gridTemplateColumns = "repeat(" + state.cols + ", 1fr)";
    g.innerHTML = state.cells.map((v, i) =>
      '<div class="cell" data-i="' + i + '" style="background:' + colors[v] + '"></div>'
    ).join("");
    g.querySelectorAll(".cell").forEach(el => {
      el.onpointerdown = () => { dragging = true; paint(Number(el.dataset.i)); };
      el.onpointerenter = () => { if (dragging) paint(Number(el.dataset.i)); };
    });
  }

  function renderStats() {
    const counts = colors.map((_, i) => state.cells.filter(v => v === i).length);
    $("#stats").innerHTML = counts.map((n, i) =>
      '<div class="stat"><span><span style="display:inline-block;width:14px;height:14px;background:' + colors[i] + '"></span> 色线' + i + '</span><b>' + n + '</b></div>'
    ).join("") +
    '<div class="stat"><span>待复核接版</span><b>' + (Archive.pending ? 1 : 0) + '</b></div>' +
    '<div class="stat"><span>发布版</span><b>' + Archive.releases.length + '</b></div>';
    const riskRows = [];
    for (let y = 0; y < state.rows; y++) {
      let switches = 0;
      for (let x = 1; x < state.cols; x++) if (state.cells[y * state.cols + x] !== state.cells[y * state.cols + x - 1]) switches++;
      if (switches > state.cols * .62) riskRows.push(y + 1);
    }
    $("#risk").innerHTML = riskRows.length
      ? '<p class="warning">第' + riskRows.join("、") + '行换色过密，可能断线。</p>'
      : "<p>暂无明显断线风险。</p>";
  }

  // 六乘六平铺预览：重复单元复制 6×6 份，并实时给出接版判定
  function renderPreview() {
    const js = judgeState();
    const verdict = Judge.judge(js);
    const unit = Judge.extractUnit(js);
    const box = $("#tilePreview");
    if (!unit) {
      box.innerHTML = '<p class="warning">重复单元超出画布，无法平铺预览。</p>';
    } else {
      let html = '<div class="tiling" style="grid-template-columns:repeat(' + TILE_COPIES + ',1fr)">';
      for (let copy = 0; copy < TILE_COPIES * TILE_COPIES; copy++) {
        html += '<div class="copy" style="grid-template-columns:repeat(' + state.unit.w + ',1fr)">';
        for (let uy = 0; uy < state.unit.h; uy++) {
          for (let ux = 0; ux < state.unit.w; ux++) {
            html += '<div class="mini" style="background:' + colors[unit[uy][ux]] + '"></div>';
          }
        }
        html += "</div>";
      }
      box.innerHTML = html + "</div>";
    }
    const v = $("#verdict");
    if (verdict.ok) {
      v.className = "verdict ok";
      v.innerHTML = "<b>判定通过，可生成接版。</b>左右接缝错位 " + verdict.seams.horizontal.shift +
        " 格，上下接缝错位 " + verdict.seams.vertical.shift + " 格。";
    } else {
      v.className = "verdict fail";
      v.innerHTML = "<b>判定不通过，接版将整次拒绝并保留原画布。</b><ul>" +
        verdict.errors.map(e => "<li>" + e.text + "</li>").join("") + "</ul>";
    }
  }

  function renderArchive() {
    const fp = currentFingerprint();
    const p = Archive.pending;
    const box = $("#pending");
    if (!p) {
      box.innerHTML = '<p class="muted">暂无待复核接版。</p>';
    } else {
      const isStale = Archive.stale(p, fp);
      box.innerHTML =
        '<div class="card">' +
          "<div><b>" + p.id + "</b> " + '<span class="badge pending">待复核</span> ' +
            (isStale ? '<span class="badge stale">已失效，需重算</span>' : '<span class="badge valid">有效</span>') + "</div>" +
          '<div class="muted">制版人：' + escapeHtml(p.maker) + " ｜ " + fmtTime(p.createdAt) + "</div>" +
          '<div class="muted">单元 ' + p.snapshot.unit.w + "×" + p.snapshot.unit.h +
            " 起于 (" + p.snapshot.unit.x + "," + p.snapshot.unit.y + ") ｜ 错位：左右 " + p.seams.horizontal +
            " 格，上下 " + p.seams.vertical + " 格 ｜ 指纹 " + p.fingerprint + "</div>" +
          "<label>复核人（须与制版人不同）</label>" +
          '<input id="reviewer" type="text" placeholder="复核人姓名">' +
          '<div class="toolbar"><button id="approveBtn" class="ok">通过并冻结</button><button id="rejectBtn" class="secondary">驳回</button></div>' +
        "</div>";
      $("#approveBtn").disabled = isStale;
      $("#approveBtn").onclick = () => doReview(true);
      $("#rejectBtn").onclick = () => doReview(false);
    }
    $("#releases").innerHTML = Archive.releases.length ? Archive.releases.map(r =>
      '<div class="card">' +
        "<div><b>" + r.id + "</b> " + '<span class="badge frozen">已冻结</span> ' +
          (Archive.stale(r, fp) ? '<span class="badge stale">相对当前已失效</span>' : '<span class="badge valid">相对当前有效</span>') + "</div>" +
        '<div class="muted">制版 ' + escapeHtml(r.maker) + " → 复核 " + escapeHtml(r.reviewer) + " ｜ " + fmtTime(r.releasedAt) + "</div>" +
        '<div class="muted">画布 ' + r.snapshot.cols + "×" + r.snapshot.rows + " ｜ 单元 " + r.snapshot.unit.w + "×" + r.snapshot.unit.h +
          " ｜ 指纹 " + r.fingerprint + "</div>" +
      "</div>"
    ).join("") : '<p class="muted">暂无发布版。</p>';
  }

  function setMsg(text, ok) {
    const el = $("#msg");
    el.textContent = text;
    el.className = "msg " + (ok ? "" : "warning");
  }

  /* ---------- 画布编辑 ---------- */
  function snapshot() {
    state.undo.push([...state.cells]);
    state.redo = [];
    if (state.undo.length > 50) state.undo.shift();
  }

  function paint(i) {
    snapshot();
    patternTargets(i).forEach(t => { state.cells[t] = state.active; });
    render();
  }

  function patternTargets(i) {
    const x = i % state.cols, y = Math.floor(i / state.cols);
    const at = (xx, yy) => (xx < 0 || xx >= state.cols || yy < 0 || yy >= state.rows) ? null : yy * state.cols + xx;
    let list;
    if (state.block === "cross") list = [i, at(x - 1, y), at(x + 1, y), at(x, y - 1), at(x, y + 1)];
    else if (state.block === "diamond") list = [at(x, y - 1), at(x - 1, y), i, at(x + 1, y), at(x, y + 1)];
    else list = [i];
    return list.filter(v => v !== null);
  }

  /* ---------- 接版与复核 ---------- */
  function submitTiling() {
    const maker = state.maker.trim();
    if (!maker) { setMsg("请先填写制版人，再生成接版。", false); return; }
    const verdict = Judge.judge(judgeState());
    if (!verdict.ok) {
      // 整次拒绝：不写存档、不改画布，原画布保留
      setMsg("接版已整次拒绝：" + verdict.errors.map(e => e.text).join(" "), false);
      return;
    }
    const { record, replaced } = Archive.submit(judgeState(), verdict, maker);
    setMsg((replaced ? "已替换同版旧待复核接版。" : "") + "接版 " + record.id + " 判定通过，待复核。", true);
    render();
  }

  function doReview(approve) {
    const reviewer = ($("#reviewer") ? $("#reviewer").value : "").trim();
    const result = Archive.review(reviewer, approve, currentFingerprint());
    setMsg(result.message, result.ok);
    render();
  }

  /* ---------- 导出：内容只取自持久化状态，重开后一致 ---------- */
  function exportJson() {
    const data = {
      app: "brocade-studio",
      version: 1,
      cols: state.cols, rows: state.rows, cells: state.cells,
      block: state.block, active: state.active,
      unit: state.unit, maker: state.maker,
      usage: colors.map((color, i) => ({ color, count: state.cells.filter(v => v === i).length })),
      fingerprint: currentFingerprint(),
      pending: Archive.pending,
      releases: Archive.releases
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "brocade-pattern.json";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  /* ---------- 事件 ---------- */
  function bindEvents() {
    window.addEventListener("pointerup", () => { dragging = false; });
    document.querySelectorAll("[data-block]").forEach(btn => {
      btn.onclick = () => { state.block = btn.dataset.block; render(); };
    });
    $("#newBtn").onclick = () => {
      state.cols = clamp(Math.round(Number($("#cols").value)) || 18, 6, 36);
      state.rows = clamp(Math.round(Number($("#rows").value)) || 14, 6, 32);
      state.cells = Array(state.cols * state.rows).fill(0);
      state.undo = []; state.redo = [];
      render();
    };
    $("#maker").addEventListener("input", e => { state.maker = e.target.value; persist(); });
    [["#unitX", "x"], ["#unitY", "y"], ["#unitW", "w"], ["#unitH", "h"]].forEach(([id, key]) => {
      $(id).addEventListener("change", () => {
        const min = key === "w" || key === "h" ? 1 : 0;
        state.unit[key] = Math.max(min, Math.round(Number($(id).value) || min));
        render();
      });
    });
    $("#undoBtn").onclick = () => {
      if (!state.undo.length) return;
      state.redo.push([...state.cells]);
      state.cells = state.undo.pop();
      render();
    };
    $("#redoBtn").onclick = () => {
      if (!state.redo.length) return;
      state.undo.push([...state.cells]);
      state.cells = state.redo.pop();
      render();
    };
    $("#tileBtn").onclick = submitTiling;
    $("#saveBtn").onclick = () => { persist(); Archive.save(); setMsg("已保存到本地。", true); };
    $("#exportBtn").onclick = exportJson;
  }

  restore();
  Archive.load();
  bindEvents();
  render();
})();
