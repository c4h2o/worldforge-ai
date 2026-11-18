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
