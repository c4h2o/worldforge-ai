// WorldForge AI — SI 单位系统（系统基础）。零外部依赖。
// 7 个基本单位 + 22 个具名导出单位 + 常用组合导出单位。
// 量纲向量按 [m, kg, s, A, K, mol, cd] 幂次表示；rad/sr 量纲为 1（[0,0,0,0,0,0,0]）。

const D = {
  m:   [1, 0, 0, 0, 0, 0, 0],
  kg:  [0, 1, 0, 0, 0, 0, 0],
  s:   [0, 0, 1, 0, 0, 0, 0],
  A:   [0, 0, 0, 1, 0, 0, 0],
  K:   [0, 0, 0, 0, 1, 0, 0],
  mol: [0, 0, 0, 0, 0, 1, 0],
  cd:  [0, 0, 0, 0, 0, 0, 1],
  ZERO:[0, 0, 0, 0, 0, 0, 0],
};

// 7 个基本单位（含定义）
export const BASE_UNITS = [
  { symbol: 'm',   name: '米',     dimension: D.m,   base: [1,0,0,0,0,0,0], definition: '光在真空中 1/299792458 s 时间间隔内行进的路程长度' },
  { symbol: 'kg',  name: '千克',   dimension: D.kg,  base: [0,1,0,0,0,0,0], definition: '基于普朗克常数 h = 6.62607015e-34 J·s 定义（2019 年起，取代国际千克原器）' },
  { symbol: 's',   name: '秒',     dimension: D.s,   base: [0,0,1,0,0,0,0], definition: '铯-133 原子基态超精细能级跃迁辐射 9192631770 个周期的持续时间' },
  { symbol: 'A',   name: '安培',   dimension: D.A,   base: [0,0,0,1,0,0,0], definition: '通过基本电荷 e = 1.602176634e-19 C 定义（电磁学核心基准）' },
  { symbol: 'K',   name: '开尔文', dimension: D.K,   base: [0,0,0,0,1,0,0], definition: '以玻尔兹曼常数 k = 1.380649e-23 J/K 为基准；水三相点热力学温度精确为 273.16 K' },
  { symbol: 'mol', name: '摩尔',   dimension: D.mol, base: [0,0,0,0,0,1,0], definition: '1 mol 含阿伏伽德罗常数 N_A = 6.02214076e23 个指定基本单元（原子、分子等）' },
  { symbol: 'cd',  name: '坎德拉', dimension: D.cd,  base: [0,0,0,0,0,0,1], definition: '频率 540e12 Hz 单色光在指定方向上的辐射强度 1/683 W/sr' },
];

// 22 个具名导出单位（含量纲与组合形式）
export const NAMED_UNITS = [
  { symbol: 'rad', name: '弧度',   dimension: D.ZERO, compose: 'm/m',   domain: '空间与周期', note: '平面角；1995 年并入导出单位体系，量纲为 1' },
  { symbol: 'sr',  name: '球面度', dimension: D.ZERO, compose: 'm²/m²', domain: '空间与周期', note: '立体角；1995 年并入导出单位体系，量纲为 1' },
  { symbol: 'Hz',  name: '赫兹',   dimension: [0,0,-1,0,0,0,0], compose: 's⁻¹', domain: '空间与周期', note: '频率' },
  { symbol: 'N',   name: '牛顿',   dimension: [1,1,-2,0,0,0,0], compose: 'kg·m/s²', domain: '力学', note: '力' },
  { symbol: 'Pa',  name: '帕斯卡', dimension: [-1,1,-2,0,0,0,0], compose: 'N/m²', domain: '力学', note: '压强、应力' },
  { symbol: 'J',   name: '焦耳',   dimension: [2,1,-2,0,0,0,0], compose: 'N·m', domain: '力学', note: '能量、功、热量' },
  { symbol: 'W',   name: '瓦特',   dimension: [2,1,-3,0,0,0,0], compose: 'J/s', domain: '力学', note: '功率、辐射通量' },
  { symbol: 'C',   name: '库仑',   dimension: [0,0,1,1,0,0,0], compose: 'A·s', domain: '电磁学', note: '电荷量' },
  { symbol: 'V',   name: '伏特',   dimension: [2,1,-3,-1,0,0,0], compose: 'W/A', domain: '电磁学', note: '电势差、电动势' },
  { symbol: 'F',   name: '法拉',   dimension: [-2,-1,4,2,0,0,0], compose: 'C/V', domain: '电磁学', note: '电容' },
  { symbol: 'ohm', name: '欧姆',   symbol2: 'Ω', dimension: [2,1,-3,-2,0,0,0], compose: 'V/A', domain: '电磁学', note: '电阻、阻抗、电抗' },
  { symbol: 'S',   name: '西门子', dimension: [-2,-1,3,2,0,0,0], compose: 'A/V', domain: '电磁学', note: '电导' },
  { symbol: 'Wb',  name: '韦伯',   dimension: [2,1,-2,-1,0,0,0], compose: 'V·s', domain: '电磁学', note: '磁通量' },
  { symbol: 'T',   name: '特斯拉', dimension: [0,1,-2,-1,0,0,0], compose: 'Wb/m²', domain: '电磁学', note: '磁通密度、磁感应强度' },
  { symbol: 'H',   name: '亨利',   dimension: [2,1,-2,-2,0,0,0], compose: 'Wb/A', domain: '电磁学', note: '电感' },
  { symbol: 'degC',name: '摄氏度', symbol2: '℃', dimension: [0,0,0,0,1,0,0], compose: 'K（偏移 273.15）', domain: '热学', note: '摄氏温度；t/℃ = T/K − 273.15' },
  { symbol: 'lm',  name: '流明',   dimension: [0,0,0,0,0,0,1], compose: 'cd·sr', domain: '光学', note: '光通量' },
  { symbol: 'lx',  name: '勒克斯', dimension: [-2,0,0,0,0,0,1], compose: 'lm/m²', domain: '光学', note: '照度' },
  { symbol: 'Bq',  name: '贝可勒尔', dimension: [0,0,-1,0,0,0,0], compose: 's⁻¹', domain: '辐射与化学', note: '放射性活度' },
  { symbol: 'Gy',  name: '戈瑞',   dimension: [2,0,-2,0,0,0,0], compose: 'J/kg', domain: '辐射与化学', note: '吸收剂量' },
  { symbol: 'Sv',  name: '希沃特', dimension: [2,0,-2,0,0,0,0], compose: 'J/kg', domain: '辐射与化学', note: '剂量当量' },
  { symbol: 'kat', name: '卡塔尔', dimension: [0,0,-1,0,0,1,0], compose: 'mol/s', domain: '辐射与化学', note: '催化活性' },
];

// 常用组合导出单位（无专门名称）
export const COMBINED_UNITS = [
  { symbol: 'm²',    name: '平方米',       dimension: [2,0,0,0,0,0,0], compose: 'm·m',        domain: '几何' },
  { symbol: 'm³',    name: '立方米',       dimension: [3,0,0,0,0,0,0], compose: 'm·m·m',      domain: '几何' },
  { symbol: 'm/s',   name: '米每秒',       dimension: [1,0,-1,0,0,0,0], compose: 'm·s⁻¹',      domain: '运动学', note: '速度' },
  { symbol: 'm/s²',  name: '米每二次方秒', dimension: [1,0,-2,0,0,0,0], compose: 'm·s⁻²',      domain: '运动学', note: '加速度' },
  { symbol: 'm⁻¹',   name: '每米',         dimension: [-1,0,0,0,0,0,0], compose: '1/m',        domain: '波动', note: '波数' },
  { symbol: 'kg/m³', name: '千克每立方米', dimension: [-3,1,0,0,0,0,0], compose: 'kg·m⁻³',     domain: '力学', note: '密度' },
  { symbol: 'J/K',   name: '焦每开',       dimension: [2,1,-2,0,-1,0,0], compose: 'J·K⁻¹',      domain: '热学', note: '熵、热容' },
  { symbol: 'J/mol', name: '焦每摩',       dimension: [2,1,-2,0,0,-1,0], compose: 'J·mol⁻¹',    domain: '热学', note: '摩尔能' },
  { symbol: 'mol/m³',name: '摩尔每立方米', dimension: [-3,0,0,0,0,1,0], compose: 'mol·m⁻³',    domain: '化学', note: '浓度' },
  { symbol: 'cd/m²', name: '坎每平方米',   dimension: [-2,0,0,0,0,0,1], compose: 'cd·m⁻²',      domain: '光学', note: '亮度' },
  { symbol: 'A/m²',  name: '安每平方米',   dimension: [-2,0,0,1,0,0,0], compose: 'A·m⁻²',       domain: '电磁学', note: '电流密度' },
];

// 完整注册表
export function getUnits() {
  return {
    system: 'SI（国际单位制）',
    note: '7 个基本单位本身不固定对应某个导出单位；所有导出单位都由这 7 个按量纲组合而成，其中 22 个被冠以专门名称，其余为组合形式。',
    base: BASE_UNITS,
    named: NAMED_UNITS,
    combined: COMBINED_UNITS,
    count: { base: BASE_UNITS.length, named: NAMED_UNITS.length, combined: COMBINED_UNITS.length },
  };
}

export const SI = getUnits();

// ── 量纲解析与语义规格物理量校验 ──
const DIM_INDEX = { m:0, kg:1, s:2, A:3, K:4, mol:5, cd:6 };
const SYM_DIM = new Map();
for (const u of BASE_UNITS) SYM_DIM.set(u.symbol, u.dimension);
for (const u of NAMED_UNITS) { SYM_DIM.set(u.symbol, u.dimension); if (u.symbol2) SYM_DIM.set(u.symbol2, u.dimension); }
for (const u of COMBINED_UNITS) SYM_DIM.set(u.symbol, u.dimension);

// 解析单位表达式 → 量纲向量 [m,kg,s,A,K,mol,cd]（如 'kg·m/s²'、'N'、'J/K'、'Ω'）
export function parseDimension(expr) {
  if (typeof expr !== 'string') throw new Error('单位表达式须为字符串: ' + expr);
  const dim = [0,0,0,0,0,0,0];
  const parts = expr.split('/');
  const SUP = {'\u2070':'0','\u00b9':'1','\u00b2':'2','\u00b3':'3','\u2074':'4','\u2075':'5','\u2076':'6','\u2077':'7','\u2078':'8','\u2079':'9','\u207b':'-','\u207a':'+'};
  const normSup = (str) => str.replace(/[\u2070\u00b9\u00b2\u00b3\u2074\u2075\u2076\u2077\u2078\u2079\u207b\u207a]/g, c => SUP[c]);
  const apply = (tok, sign) => {
    tok = tok.replace(/\s+/g, '');
    if (!tok) return;
    for (const raw of tok.split('·')) {
      const term = normSup(raw);
      if (!term) continue;
      const m = term.match(/^([A-Za-zΩ℃°]+)(?:\^?(-?\d+))?$/);
      if (!m) throw new Error('无法解析单位项: ' + term);
      const sym = m[1]; const exp = parseInt(m[2] || '1', 10) * sign;
      const d = SYM_DIM.get(sym);
      if (!d) throw new Error('未知单位: ' + sym);
      for (let k = 0; k < 7; k++) dim[k] += d[k] * exp;
    }
  };
  apply(parts[0], 1);
  for (let i = 1; i < parts.length; i++) apply(parts[i], -1);
  return dim;
}

// 校验语义规格中实体的物理属性量纲是否合法（SI）。
// entity.physics 形如 { force:{value:9.8, unit:'kg·m/s²'}, length:{value:12, unit:'m'}, energy:{value:1000, unit:'J'} }
// 可选 quantity: 期望物理量（N/J/W/Pa/lm/lx/...），用于交叉校验单位量纲。
export function validateUnits(spec) {
  const issues = [];
  const entities = (spec && spec.entities) || [];
  for (const e of entities) {
    const ph = e && e.physics;
    if (!ph || typeof ph !== 'object') continue;
    for (const [key, val] of Object.entries(ph)) {
      if (!val || typeof val !== 'object' || val.unit === undefined) continue;
      try {
        const dim = parseDimension(val.unit);
        if (val.quantity) {
          const want = SYM_DIM.get(val.quantity);
          if (want) {
            const same = want.every((x, k) => x === dim[k]);
            if (!same) issues.push(e.id + '.' + key + ': 单位 ' + val.unit + ' 量纲与 ' + val.quantity + ' 不符（应为 ' + val.quantity + '）');
          } else if (!val.quantity.includes('/') && !val.quantity.includes('·')) {
            issues.push(e.id + '.' + key + ': 期望量 ' + val.quantity + ' 非已知 SI 单位');
          }
        }
      } catch (err) { issues.push(e.id + '.' + key + ': ' + err.message); }
    }
  }
  return { ok: issues.length === 0, issues };
}
