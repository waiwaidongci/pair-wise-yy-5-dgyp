/* 版本存档模块：待复核接版、复核冻结、发布版存档与本地持久化。 */
window.BrocadeArchive = (() => {
  const KEY = "brocadeArchive.v1";
  let data = { pending: null, releases: [], seq: 1 };

  // 发布版冻结：快照与记录本身都不再可改
  function freezeRecord(r) {
    if (r && r.snapshot) {
      Object.freeze(r.snapshot.cells);
      Object.freeze(r.snapshot.unit);
      Object.freeze(r.snapshot);
    }
    return Object.freeze(r);
  }

  function load() {
    try {
      const parsed = JSON.parse(localStorage.getItem(KEY) || "null");
      if (parsed && Array.isArray(parsed.releases)) {
        data = { pending: null, releases: [], seq: 1, ...parsed };
      }
    } catch (e) { /* 存档损坏时从空存档开始 */ }
    data.releases.forEach(freezeRecord);
    return data;
  }

  function save() {
    localStorage.setItem(KEY, JSON.stringify(data));
  }

  function snapshotOf(s) {
    return { cols: s.cols, rows: s.rows, cells: [...s.cells], unit: { ...s.unit } };
  }

  // 提交接版（判定已通过才允许进入）：同版仅留一条待复核接版，新提交即替换旧件
  function submit(s, verdict, maker) {
    const replaced = !!data.pending;
    data.pending = {
      id: "JB" + String(data.seq++).padStart(3, "0"),
      status: "pending",
      fingerprint: verdict.fingerprint,
      maker,
      createdAt: new Date().toISOString(),
      seams: { horizontal: verdict.seams.horizontal.shift, vertical: verdict.seams.vertical.shift },
      snapshot: snapshotOf(s)
    };
    save();
    return { record: data.pending, replaced };
  }

  // 复核：复核人须与制版人不同，且接版未失效；通过后冻结为发布版
  function review(reviewer, approve, currentFingerprint) {
    const p = data.pending;
    if (!p) return { ok: false, message: "当前没有待复核接版。" };
    const who = (reviewer || "").trim();
    if (!who) return { ok: false, message: "请填写复核人。" };
    if (who === p.maker) return { ok: false, message: "复核人与制版人不得相同。" };
    if (p.fingerprint !== currentFingerprint) {
      return { ok: false, message: "基础块、色线、行列数或重复单元已变化，接版失效，请重算后再复核。" };
    }
    if (approve) {
      data.releases.push(freezeRecord({
        id: "RL" + String(data.seq++).padStart(3, "0"),
        from: p.id,
        fingerprint: p.fingerprint,
        maker: p.maker,
        reviewer: who,
        createdAt: p.createdAt,
        releasedAt: new Date().toISOString(),
        seams: p.seams,
        snapshot: snapshotOf(p.snapshot),
        frozen: true
      }));
    }
    data.pending = null;
    save();
    return { ok: true, message: approve ? "已通过复核，冻结为发布版。" : "已驳回该接版。" };
  }

  // 旧接版是否因基础块、色线、行列数或重复单元变化而失效
  const stale = (record, currentFingerprint) => !!record && record.fingerprint !== currentFingerprint;

  return {
    load, save, submit, review, stale,
    get pending() { return data.pending; },
    get releases() { return data.releases; }
  };
})();
