/* 版本存档模块：待复核接版的唯一性、复核冻结与发布版存档。
   不接触 DOM，状态可序列化交给入口模块持久化。 */
window.BrocadeArchive = (() => {
  let pending = null;  // 同版仅留一条待复核接版
  let releases = [];   // 复核通过后冻结的发布版

  // 生成接版：同版新接版会顶掉旧的待复核接版。
  function createJoin({ maker, fingerprint, validation }) {
    pending = {
      id: "J" + Date.now().toString(36),
      maker,
      fingerprint,
      status: "pending", // pending | invalid
      createdAt: Date.now(),
      errors: validation.errors,
    };
    return pending;
  }

  // 基础块、色线、行列数或重复单元变化后，指纹失配，旧接版失效需重算。
  function invalidateIf(fingerprint) {
    if (pending && pending.fingerprint !== fingerprint) pending.status = "invalid";
  }

  // 复核通过：复核人须与制版人不同，通过后冻结为发布版。
  function approve({ reviewer, fingerprint, snapshot }) {
    if (!pending) return { error: "当前没有待复核接版。" };
    invalidateIf(fingerprint);
    if (pending.status !== "pending") return { error: "接版已失效，请重新生成后再复核。" };
    if (!reviewer) return { error: "请填写复核人。" };
    if (reviewer === pending.maker) return { error: "复核人与制版人不能相同。" };
    const release = {
      id: "R" + (releases.length + 1),
      joinId: pending.id,
      maker: pending.maker,
      reviewer,
      frozenAt: Date.now(),
      snapshot,
    };
    releases.push(release);
    pending = null;
    return { release };
  }

  function rejectPending() {
    if (!pending) return { error: "当前没有待复核接版。" };
    const dropped = pending;
    pending = null;
    return { dropped };
  }

  function getPending() { return pending; }
  function getReleases() { return releases; }

  function toJSON() { return { pending, releases }; }
  function fromJSON(data) {
    pending = data && data.pending ? data.pending : null;
    releases = data && Array.isArray(data.releases) ? data.releases : [];
  }

  return { createJoin, invalidateIf, approve, rejectPending, getPending, getReleases, toJSON, fromJSON };
})();
