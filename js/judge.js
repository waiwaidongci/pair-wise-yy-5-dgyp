/* 判定模块：接版合法性判定、重复单元平铺映射与版本指纹。
   纯函数，不接触 DOM 与存储。 */
window.BrocadeJudge = (() => {
  const UNIT = 6; // 重复单元固定 6×6

  function mod(n, m) { return ((n % m) + m) % m; }

  // 版本指纹：基础块、色线、行列数、重复单元或画布内容任一变化都会改变，
  // 用于让旧接版失效重算。
  function fingerprint(s) {
    const str = JSON.stringify({
      block: s.block, active: s.active,
      cols: s.cols, rows: s.rows,
      unit: s.unit, cells: s.cells,
    });
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0;
    return h.toString(36);
  }

  function unitInBounds(cols, rows, unit) {
    return unit.x >= 0 && unit.y >= 0 && unit.x + UNIT <= cols && unit.y + UNIT <= rows;
  }

  // 接版判定：平铺越界、错位超过一格、接缝对色断点，任一命中即整次拒绝。
  function validateJoin(s) {
    const { cols, rows, cells, unit, offset } = s;
    const errors = [];
    const inBounds = unitInBounds(cols, rows, unit);
    if (!inBounds) {
      errors.push("平铺越界：6×6 重复单元超出画布，整次拒绝。");
    }
    if (Math.abs(offset.dx) > 1 || Math.abs(offset.dy) > 1) {
      errors.push("错位超过一格：错位量须在 -1～1 之间，整次拒绝。");
    }
    if (inBounds) {
      const at = (ux, uy) => cells[(unit.y + uy) * cols + (unit.x + ux)];
      const breaks = [];
      for (let uy = 0; uy < UNIT; uy++) {
        if (at(UNIT - 1, uy) !== at(0, mod(uy - offset.dy, UNIT))) {
          breaks.push("横向接缝第 " + (uy + 1) + " 行对色断点");
        }
      }
      for (let ux = 0; ux < UNIT; ux++) {
        if (at(ux, UNIT - 1) !== at(mod(ux - offset.dx, UNIT), 0)) {
          breaks.push("纵向接缝第 " + (ux + 1) + " 列对色断点");
        }
      }
      if (breaks.length) errors.push("接缝对色断点：" + breaks.join("、") + "，整次拒绝。");
    }
    return { ok: errors.length === 0, errors };
  }

  // 平铺映射：画布格 (cx,cy) 落在重复单元的哪一格（含错位）。
  function tileAt(cx, cy, unit, offset) {
    const tx = Math.floor((cx - unit.x) / UNIT);
    const ty = Math.floor((cy - unit.y) / UNIT);
    return [
      mod(cx - unit.x - offset.dx * ty, UNIT),
      mod(cy - unit.y - offset.dy * tx, UNIT),
    ];
  }

  // 应用接版：把重复单元按错位四方连续铺满整张画布，返回新画布（不改原数组）。
  function applyJoin(s) {
    const { cols, rows, cells, unit, offset } = s;
    const next = new Array(cols * rows);
    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        const [ux, uy] = tileAt(cx, cy, unit, offset);
        next[cy * cols + cx] = cells[(unit.y + uy) * cols + (unit.x + ux)];
      }
    }
    return next;
  }

  return { UNIT, mod, fingerprint, unitInBounds, validateJoin, tileAt, applyJoin };
})();
