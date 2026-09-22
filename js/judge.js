/* 判定模块：四方连续接版的指纹、平铺越界、接缝对色断点与错位判定。纯函数，不碰界面与存储。 */
window.BrocadeJudge = (() => {
  const ALLOW_SHIFT = 1; // 接缝允许错位一格以内
  const MAX_SHIFT = 3;   // 错位侦测范围，超过即判“错位超过一格”

  // 基础块、色线、行列数或重复单元任一变化都会改变指纹，让旧接版失效重算
  function fingerprint(s) {
    const raw = JSON.stringify({
      cols: s.cols, rows: s.rows, cells: s.cells,
      block: s.block, active: s.active, colors: s.colors,
      unit: s.unit
    });
    let h = 5381;
    for (let i = 0; i < raw.length; i++) h = ((h << 5) + h + raw.charCodeAt(i)) >>> 0;
    return h.toString(36);
  }

  function inBounds(s) {
    const u = s.unit;
    return !!u && u.w >= 1 && u.h >= 1 && u.x >= 0 && u.y >= 0 &&
      u.x + u.w <= s.cols && u.y + u.h <= s.rows;
  }

  // 取出重复单元（行优先的二维数组），越界返回 null
  function extractUnit(s) {
    if (!inBounds(s)) return null;
    const out = [];
    for (let uy = 0; uy < s.unit.h; uy++) {
      const row = [];
      for (let ux = 0; ux < s.unit.w; ux++) {
        row.push(s.cells[(s.unit.y + uy) * s.cols + (s.unit.x + ux)]);
      }
      out.push(row);
    }
    return out;
  }

  // 一条接缝：边缘 A 与相邻单元边缘 B 对色，允许整体错位 shift 格
  function checkSeam(len, getA, getB) {
    const fitting = [];
    let best = null;
    for (let shift = -MAX_SHIFT; shift <= MAX_SHIFT; shift++) {
      const breaks = [];
      let compared = 0;
      for (let i = 0; i < len; i++) {
        const j = i + shift;
        if (j < 0 || j >= len) continue;
        compared++;
        if (getA(i) !== getB(j)) breaks.push(i + 1); // 1 起始的断点位置
      }
      if (!compared) continue;
      if (!breaks.length) fitting.push(shift);
      if (!best || breaks.length < best.breaks.length) best = { shift, breaks };
    }
    if (fitting.length) {
      const shift = fitting.reduce((a, b) => (Math.abs(a) <= Math.abs(b) ? a : b));
      if (Math.abs(shift) > ALLOW_SHIFT) {
        return { ok: false, reason: "misalignment", shift, breaks: [] };
      }
      return { ok: true, shift, breaks: [] };
    }
    return { ok: false, reason: "seam-break", shift: best ? best.shift : 0, breaks: best ? best.breaks : [] };
  }

  function seamError(side, r) {
    if (r.reason === "misalignment") {
      return { type: "misalignment", text: side + "接缝需错位 " + r.shift + " 格才能对齐，超过一格，整次拒绝。" };
    }
    const shown = r.breaks.slice(0, 6).join("、");
    const more = r.breaks.length > 6 ? "等" : "";
    return { type: "seam-break", text: side + "接缝对色断点 " + r.breaks.length + " 处（第 " + shown + more + " 格），整次拒绝。" };
  }

  // 整次判定：任一不通过即整次拒绝，调用方保留原画布
  function judge(s) {
    const fp = fingerprint(s);
    if (!inBounds(s)) {
      return {
        ok: false, fingerprint: fp, seams: null,
        errors: [{ type: "bounds", text: "平铺越界：重复单元超出画布范围，整次拒绝。" }]
      };
    }
    const at = (ux, uy) => s.cells[(s.unit.y + uy) * s.cols + (s.unit.x + ux)];
    // 左右接缝：单元右缘与下一复制件左缘对色；上下接缝：单元下缘与下一复制件上缘对色
    const horizontal = checkSeam(s.unit.h, uy => at(s.unit.w - 1, uy), uy => at(0, uy));
    const vertical = checkSeam(s.unit.w, ux => at(ux, s.unit.h - 1), ux => at(ux, 0));
    const errors = [];
    if (!horizontal.ok) errors.push(seamError("左右", horizontal));
    if (!vertical.ok) errors.push(seamError("上下", vertical));
    return { ok: !errors.length, fingerprint: fp, errors, seams: { horizontal, vertical } };
  }

  return { ALLOW_SHIFT, MAX_SHIFT, fingerprint, inBounds, extractUnit, judge };
})();
