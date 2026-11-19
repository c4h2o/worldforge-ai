// WorldForge AI — 审美/一致性批评器（系统域 critic）。零外部依赖。
// 审查世界画布场景：① 物理量纲/比例 ② 布局（重叠/出界/间距）③ 语义一致性 ④ 光照。
// 输出问题清单（含严重度 + 可执行修复建议），供编排智能体自动修正。

// 实体世界包围盒（中心 position，半宽 = extent*scale/2）
function worldBox(e, ext) {
  const [px, py, pz] = e.transform.position || [0, 0, 0];
  const [sx, sy, sz] = e.transform.scale || [1, 1, 1];
  const [ex, ey, ez] = ext;
  return { min: [px - ex * sx / 2, py - ey * sy / 2, pz - ez * sz / 2], max: [px + ex * sx / 2, py + ey * sy / 2, pz + ez * sz / 2] };
}
const inter = (a, b) => {
  const dx = Math.min(a.max[0], b.max[0]) - Math.max(a.min[0], b.min[0]);
  const dy = Math.min(a.max[1], b.max[1]) - Math.max(a.min[1], b.min[1]);
  const dz = Math.min(a.max[2], b.max[2]) - Math.max(a.min[2], b.min[2]);
  return dx > 0 && dy > 0 && dz > 0 ? dx * dy * dz : 0;
};

export function reviewScene(scene, opts = {}) {
  const extentFor = opts.extentFor || (() => [1, 1, 1]);
  const issues = [];
  const ents = (scene && scene.scene_graph && scene.scene_graph.entities) || [];
  const zones = (scene && scene.scene_graph && scene.scene_graph.zones) || [];
  const lights = (scene && scene.scene_graph && scene.scene_graph.lights) || [];
  const boxes = ents.map(e => worldBox(e, extentFor(e.asset_id || e.id)));

  // ① 物理量纲 / 比例
  const heights = ents.map(e => (e.transform.scale || [1, 1, 1])[1]);
  const avgH = heights.length ? heights.reduce((a, b) => a + b, 0) / heights.length : 1;
  for (let i = 0; i < ents.length; i++) {
    const e = ents[i]; const s = e.transform.scale || [1, 1, 1];
    if (s[1] > avgH * 5 + 0.5) issues.push({ level: 'medium', code: 'SCALE_TOO_TALL', id: e.id,
      msg: '实体 ' + e.id + ' 高度 ' + s[1].toFixed(2) + ' 远超平均 ' + avgH.toFixed(2) + '，比例失衡',
      fix: { id: e.id, scale: [s[0], Math.round(avgH * 1.5 * 100) / 100, s[2]] } });
    if (s[1] < 0.1) issues.push({ level: 'medium', code: 'SCALE_TOO_SMALL', id: e.id,
      msg: '实体 ' + e.id + ' 高度 ' + s[1].toFixed(2) + ' 过小，场景中几乎不可见',
      fix: { id: e.id, scale: [s[0], Math.max(0.5, avgH), s[2]] } });
    if (s[0] !== s[1] && s[1] !== s[2]) {
      const ratio = Math.max(s[0] / s[1], s[1] / s[0], s[2] / s[1]);
      if (ratio > 8) issues.push({ level: 'low', code: 'ANISOTROPIC', id: e.id,
        msg: '实体 ' + e.id + ' 逐轴缩放比 ' + ratio.toFixed(1) + ' 过大，形态可能失真',
        fix: { id: e.id, scale: [avgH, avgH, avgH] } });
    }
  }

  // ② 布局：重叠 + 出界
  for (let i = 0; i < ents.length; i++) for (let j = i + 1; j < ents.length; j++) {
    const bi = boxes[i], bj = boxes[j];
    const oi = (bi.max[0] - bi.min[0]) * (bi.max[2] - bi.min[2]);
    const oj = (bj.max[0] - bj.min[0]) * (bj.max[2] - bj.min[2]);
    const ox = Math.min(bi.max[0], bj.max[0]) - Math.max(bi.min[0], bj.min[0]);
    const oy = Math.min(bi.max[1], bj.max[1]) - Math.max(bi.min[1], bj.min[1]);
    const oz = Math.min(bi.max[2], bj.max[2]) - Math.max(bi.min[2], bj.min[2]);
    const share = (ox > 0 && oy > 0 && oz > 0) ? (ox * oz) / Math.max(0.001, Math.min(oi, oj)) : 0;
    if (share > 0.4) issues.push({ level: 'high', code: 'OVERLAP', ids: [ents[i].id, ents[j].id],
      msg: ents[i].id + ' 与 ' + ents[j].id + ' 占地重叠 ' + Math.round(share * 100) + '%',
      fix: { id: ents[j].id, shift: [0, 0, 1.2] } });
  }
  const zone = zones[0];
  if (zone && zone.bounds) {
    const [zx0, zy0, zz0, zx1, zy1, zz1] = zone.bounds;
    const zb = { min: [zx0, zy0, zz0], max: [zx1, zy1, zz1] };
    for (let i = 0; i < ents.length; i++) {
      const b = boxes[i];
      const hgt = b.max[1] - b.min[1];
      const inside = b.min[0] >= zb.min[0] - 0.01 && b.max[0] <= zb.max[0] + 0.01 &&
                     b.min[2] >= zb.min[2] - 0.01 && b.max[2] <= zb.max[2] + 0.01 &&
                     b.max[1] <= zb.max[1] + 0.01 && b.min[1] >= zb.min[1] - hgt - 0.01;
      if (!inside) issues.push({ level: 'high', code: 'OUT_OF_ZONE', id: ents[i].id, zone: zone.id,
        msg: '实体 ' + ents[i].id + ' 超出分区 ' + (zone.name || zone.id),
        fix: { id: ents[i].id, position: [(zb.min[0] + zb.max[0]) / 2, ents[i].transform.position[1], (zb.min[2] + zb.max[2]) / 2] } });
    }
  }

  // ③ 语义一致性
  const spec = opts.spec;
  if (spec && Array.isArray(spec.entities)) {
    const placed = new Set(ents.map(e => e.semantic_role || (e.asset_id || '').split('_')[0]));
    for (const se of spec.entities) {
      if (!placed.has(se.category)) issues.push({ level: 'medium', code: 'MISSING_ENTITY', id: se.id,
        msg: '语义规范要求的 ' + se.category + '（' + se.id + '）未在世界画布中摆放',
        fix: { action: 'img3d.fromImage', category: se.category } });
    }
    for (const e of ents) {
      const match = spec.entities.find(se => se.category === e.semantic_role);
      if (match && e.physics && match.physics && JSON.stringify(e.physics) !== JSON.stringify(match.physics))
        issues.push({ level: 'low', code: 'PHYSICS_DRIFT', id: e.id, msg: '实体 ' + e.id + ' 物理属性与语义规范不一致',
          fix: { id: e.id, physics: match.physics } });
    }
  }

  // ④ 光照
  if (lights.length === 0) issues.push({ level: 'medium', code: 'NO_LIGHTS', msg: '场景无灯光，画面会全黑',
    fix: { lights: [{ type: 'hemisphere', intensity: 0.6, color: '#ffffff' }] } });
  for (const l of lights) {
    if (l.intensity !== undefined && l.intensity <= 0) issues.push({ level: 'medium', code: 'LIGHT_OFF', id: l.id || l.type,
      msg: '灯光 ' + (l.id || l.type) + ' 强度 0，未生效', fix: { id: l.id || l.type, intensity: 1 } });
    if (l.intensity !== undefined && l.intensity > 3) issues.push({ level: 'low', code: 'LIGHT_TOO_STRONG', id: l.id || l.type,
      msg: '灯光强度 ' + l.intensity + ' 偏强，易过曝', fix: { id: l.id || l.type, intensity: 2.2 } });
  }

  // 评分：基础 100，按严重度扣分
  const PEN = { high: 18, medium: 8, low: 3 };
  const score = Math.max(0, 100 - issues.reduce((a, x) => a + (PEN[x.level] || 5), 0));
  const byCode = {};
  for (const i of issues) byCode[i.code] = (byCode[i.code] || 0) + 1;
  return { score, ok: score >= 70, issues, summary: byCode, suggestions: issues.slice(0, 5).map(i => i.fix) };
}


// ── 生成 → 批评 → 自动修正 闭环 ─────────────────────────
// 迭代应用修复建议直到 reviewScene.ok === true（或达上限/无可改项）。
export function autofixScene(scene, opts = {}) {
  const extentFor = opts.extentFor || (() => [1, 1, 1]);
  const spec = opts.spec || null;
  const applied = [], unresolved = [];
  const unresolvedKey = new Set();
  const markUnresolved = (u) => { const k = u.code + ':' + (u.id || (u.ids || []).join('/')); if (unresolvedKey.has(k)) return; unresolvedKey.add(k); unresolved.push(u); };
  const ents = () => (scene && scene.scene_graph && scene.scene_graph.entities) || [];
  let review = reviewScene(scene, { extentFor, spec });
  const before = review.score;
  let rounds = 0; const MAX = 8;
  while (review.issues.length > 0 && rounds < MAX) {
    rounds++;
    let changed = false;
    for (const iss of review.issues) {
      const e = ents().find(x => x.id === iss.id);
      const note = code => code + (iss.id ? ':' + iss.id : '');
      if (!e) {
        // 光照类问题（id 为灯）
        if (iss.code === 'LIGHT_OFF' || iss.code === 'LIGHT_TOO_STRONG') {
          const l = ((scene.scene_graph && scene.scene_graph.lights) || []).find(x => (x.id || x.type) === iss.id);
          if (l) { l.intensity = iss.fix.intensity; applied.push({ code: iss.code, id: l.id || l.type, intensity: l.intensity }); changed = true; }
          else markUnresolved({ code: iss.code, id: iss.id, msg: iss.msg, note: '灯光未找到' });
        } else if (iss.code === 'MISSING_ENTITY') {
          const hit = opts.searchAssets ? opts.searchAssets({ category: iss.fix.category }) : [];
          if (hit.length) {
            const ai = hit[0];
            const cand = { id: 'x', asset_id: ai.id, transform: { position: [0, 0, 0], scale: [1, 1, 1] } };
            const zone0 = ((scene && scene.scene_graph && scene.scene_graph.zones) || [])[0];
            const pos = freeSpot(ents(), cand, extentFor, zone0);
            if (pos) {
              ents().push({ id: ai.id + '_auto' + ents().length, asset_id: ai.id, semantic_role: iss.fix.category,
                transform: { position: pos, rotation: [0, 0, 0], scale: [1, 1, 1] }, placed_by: 'critic', locked: false });
              applied.push({ code: iss.code, id: ai.id, category: iss.fix.category, position: pos, note: '复用资产库同类别资产' });
              changed = true;
            } else markUnresolved({ code: iss.code, id: iss.id, msg: iss.msg, note: '分区内无空位，需扩大分区' });
          } else markUnresolved({ code: iss.code, id: iss.id, msg: iss.msg, note: '资产库无同类别资产，需 img3d.fromImage 生成' });
        } else if (iss.code === 'OVERLAP') {
          const ea = ents().find(x => x.id === (iss.ids || [])[0]);
          const eb = ents().find(x => x.id === (iss.ids || [])[1]);
          if (ea && eb) {
            const wa = worldBox(ea, extentFor(ea.asset_id || ea.id)), wb = worldBox(eb, extentFor(eb.asset_id || eb.id));
            const half = (b, k) => (b.max[k] - b.min[k]) / 2;
            const cen = (b, k) => (b.min[k] + b.max[k]) / 2;
            const pick = [0, 2].map(ax => ({ ax, gap: half(wa, ax) + half(wb, ax) + 0.4 - Math.abs(cen(wa, ax) - cen(wb, ax)) })).sort((p, q) => p.gap - q.gap)[0];
            const zone0 = ((scene && scene.scene_graph && scene.scene_graph.zones) || [])[0];
            const others = ents().filter(x => x.id !== eb.id);
            // 分区内无空位时绝不"最小位移"：挪开必然越界，制造新的 OUT_OF_ZONE，
            // 再被 OUT_OF_ZONE 夹回 → 无限震荡。改为等比缩小后重试寻位；仍不行则如实上报。
            const base = [ ...(eb.transform.scale || [1, 1, 1]) ];
            let spot = freeSpot(others, eb, extentFor, zone0), k = 0;
            while (!spot && k < 2) {
              k++;
              const f = 1 / (1 + 0.5 * k);
              eb.transform.scale = base.map(v => Math.round(v * f * 100) / 100);
              spot = freeSpot(others, eb, extentFor, zone0);
            }
            if (!spot) eb.transform.scale = base;
            if (spot) {
              eb.transform.position = spot;
              applied.push({ code: iss.code, id: eb.id, position: spot,
                scale: k ? eb.transform.scale : null,
                note: k ? '分区内无空位，缩小 ' + Math.round(100 * (1 - 1 / (1 + 0.5 * k))) + '% 后重新摆放' : '在分区内重新寻找空位' });
              changed = true;
            } else if (pick.gap <= 0) {
              markUnresolved({ code: iss.code, ids: iss.ids, msg: iss.msg, note: '已无需分离' });
            } else markUnresolved({ code: iss.code, ids: iss.ids, msg: iss.msg,
              note: '分区内无空位且缩小后仍放不下，需扩大分区或移除实体' });
          } else markUnresolved({ code: iss.code, ids: iss.ids, msg: iss.msg, note: '重叠实体未找到' });
        } else if (iss.code === 'NO_LIGHTS') {
          scene.scene_graph.lights.push(iss.fix.lights[0]);
          applied.push({ code: iss.code, note: '补半球光 ' + iss.fix.lights[0].intensity }); changed = true;
        } else markUnresolved({ code: iss.code, id: iss.id, msg: iss.msg, note: '实体未找到' });
        continue;
      }
      switch (iss.code) {
        case 'OUT_OF_ZONE': {
          const z = (scene.scene_graph.zones || [])[0];
          if (!z || !z.bounds) { markUnresolved({ code: iss.code, id: iss.id, msg: iss.msg, note: '无分区' }); break; }
          const [zx0, zy0, zz0, zx1, zy1, zz1] = z.bounds;
          const ext = extentFor(e.asset_id || e.id);
          const pos = [...(e.transform.position || [0, 0, 0])];
          const scl = [...(e.transform.scale || [1, 1, 1])];
          let moved = false;
          const hw = ext[0] * scl[0] / 2, hd = ext[2] * scl[2] / 2;
          const cx = Math.min(Math.max(pos[0], zx0 + hw), Math.max(zx0 + hw, zx1 - hw));
          const cz = Math.min(Math.max(pos[2], zz0 + hd), Math.max(zz0 + hd, zz1 - hd));
          if (Math.abs(cx - pos[0]) > 1e-6) { pos[0] = cx; moved = true; }
          if (Math.abs(cz - pos[2]) > 1e-6) { pos[2] = cz; moved = true; }
          const spanY = zy1 - zy0, hgt = ext[1] * scl[1];
          if (spanY > 0 && hgt > spanY) { scl[1] *= spanY / hgt; moved = true; }   // 超高 → 压缩 y 使整体入界
          if (pos[1] < zy0) { pos[1] = zy0; moved = true; }
          if (pos[1] + ext[1] * scl[1] > zy1) { pos[1] = Math.max(zy0, zy1 - ext[1] * scl[1]); moved = true; }   // 顶到天花板 → 下沉入界
          if (moved) { e.transform.position = pos; e.transform.scale = scl; applied.push({ code: iss.code, id: e.id, position: pos, scale: scl }); changed = true; }
          else markUnresolved({ code: iss.code, id: e.id, msg: iss.msg, note: '分区容不下该尺寸，需扩大分区或移除实体' });
          break;
        }
        case 'SCALE_TOO_TALL':
        case 'SCALE_TOO_SMALL':
        case 'ANISOTROPIC':
        case 'PHYSICS_DRIFT':
          if (iss.fix && iss.fix.scale) { e.transform.scale = iss.fix.scale; applied.push({ code: iss.code, id: iss.id, scale: iss.fix.scale }); changed = true; }
          else if (iss.fix && iss.fix.physics) { e.physics = iss.fix.physics; applied.push({ code: iss.code, id: iss.id, physics: iss.fix.physics }); changed = true; }
          else markUnresolved({ code: iss.code, id: iss.id, msg: iss.msg, note: '无修复建议' });
          break;
        default:
          markUnresolved({ code: iss.code, id: iss.id, msg: iss.msg, note: '暂无自动修正' });
      }
    }
    review = reviewScene(scene, { extentFor, spec });
    if (!changed) break;
  }
  return { rounds, before, after: review.score, ok: review.ok, clean: review.issues.length === 0, applied, unresolved, issues: review.issues };
}

// 候选位是否被占用（3D 相交判定）
function spotFree(entities, candidate, pos, extentFor) {
  const ext = extentFor(candidate.asset_id || candidate.id);
  const bc = worldBox({ ...candidate, transform: { ...candidate.transform, position: pos } }, ext);
  return entities.every(e => {
    const be = worldBox(e, extentFor(e.asset_id || e.id));
    const ox = Math.min(bc.max[0], be.max[0]) - Math.max(bc.min[0], be.min[0]);
    const oz = Math.min(bc.max[2], be.max[2]) - Math.max(bc.min[2], be.min[2]);
    const oy = Math.min(bc.max[1], be.max[1]) - Math.max(bc.min[1], be.min[1]);
    return !(ox > 0 && oy > 0 && oz > 0);
  });
}
// 为实体找不重叠的空位（网格扫描）：有分区时严格限制在分区内，找不到返回 null
function freeSpot(entities, candidate, extentFor, zone) {
  const ext = extentFor(candidate.asset_id || candidate.id);
  const b = (zone && zone.bounds) ? zone.bounds : null;
  const [x0, y0, z0, x1, , z1] = b || [-6, 0, -6, 6, 0, 6];
  const hx = ext[0] / 2 + 0.3, hz = ext[2] / 2 + 0.3;
  // 分区内：网格步长按实体占地的一半走，保证相邻候选位必然分离
  const step = Math.max(0.6, Math.min(ext[0], ext[2]) / 2 + 0.15);
  for (let gx = x0 + hx; gx <= x1 - hx + 1e-6; gx += step)
    for (let gz = z0 + hz; gz <= z1 - hz + 1e-6; gz += step) {
      const p = [Math.round(gx * 100) / 100, y0, Math.round(gz * 100) / 100];
      if (spotFree(entities, candidate, p, extentFor)) return p;
    }
  return null;
}
