// 愿景 → SemanticSpec（Phase 0 的规则式解析；后续由 LLM 语义 Agent 替换）
export const DEFAULT_BRIEF = '一座雨夜赛博朋克港口，起重机、集装箱堆场、巡逻机器人，蓝红霓虹';

const THEMES = {
  port: {
    match: (b)=> /港|port|码头/.test(b),
    style: 'cyberpunk-noir',
    time: 'night', weather: 'rain',
    colorScheme: ['#0b1020','#ff2a6d','#05d9e8'],
    entities: [
      { id:'crane_01', category:'crane', count:2, attributes:{height:'large',color:'rust',emissive:'cyan'}, relations:{sitsOn:'dock'}, parts:[{id:'arm',semantic:'mechanical-arm'}] },
      { id:'container_stack', category:'container', count:12, attributes:{color:['red','blue','rust']}, relations:{on:'dock',cluster:true} },
      { id:'robot_guard', category:'robot', count:1, attributes:{pose:'idle'}, riggable:true },
      { id:'warehouse', category:'building', count:1, attributes:{height:'mid',material:'metal'} },
      { id:'cargo_ship', category:'ship', count:1, attributes:{length:'large'} },
      { id:'neon_tower', category:'light', count:4, attributes:{emissive:'pink'} },
    ],
  },
  city: {
    match: (b)=> /城|city|都市/.test(b) && !/港|port/.test(b),
    style: 'neon-city', time:'night', weather:'clear',
    colorScheme: ['#0a0a12','#7b2ff7','#00e5ff'],
    entities: [
      { id:'tower_01', category:'building', count:8, attributes:{height:'tall',material:'glass'} },
      { id:'street_light', category:'light', count:16, attributes:{emissive:'warm'} },
      { id:'hover_car', category:'vehicle', count:3, attributes:{color:'cyan'} },
      { id:'billboard', category:'sign', count:4, attributes:{emissive:'pink'} },
    ],
  },
  default: {
    match: ()=>true,
    style: 'studio-clean', time:'day', weather:'clear',
    colorScheme: ['#e8e8ea','#ff8a3d','#3d8aff'],
    entities: [
      { id:'cube_01', category:'prop', count:4, attributes:{color:['red','blue']} },
      { id:'pedestal', category:'prop', count:1, attributes:{color:'white'} },
    ],
  },
};

export function parseBrief(brief = DEFAULT_BRIEF) {
  const theme = Object.values(THEMES).find(t => t.match(brief)) ?? THEMES.default;
  return {
    meta: { id: 'world_demo_001', name: '雨夜赛博港', style: theme.style, seed: 42 },
    world: { atmosphere: { time: theme.time, weather: theme.weather, fog: 0.6, colorScheme: theme.colorScheme }, terrain: { type: 'coastal', ground: 'wet-asphalt' } },
    entities: theme.entities.map((e,i)=>({ ...e, count: e.count ?? 1, id: e.id + '_' + (i+1) })),
    composition: { layout: 'grid-with-lanes', depth: 'multi-layer', hero: theme.entities[0]?.id, focal: theme.entities.find(e=>e.riggable)?.id },
  };
}

export const CATEGORY_COLOR = {
  crane: [0.72,0.35,0.16], container: [0.15,0.35,0.75], robot: [0.75,0.2,0.3],
  building: [0.45,0.5,0.58], ship: [0.3,0.32,0.4], light: [0.95,0.4,0.7],
  vehicle: [0.2,0.75,0.85], sign: [0.95,0.3,0.65], prop: [0.7,0.7,0.72],
};
export function categoryColor(cat){ return CATEGORY_COLOR[cat] ?? [0.6,0.6,0.6]; }

// 简单程序化几何：按类别拼盒子
export function boxesForCategory(cat){
  const C = (color)=>color;
  switch(cat){
    case 'crane': return [
      { center:[0,2.5,0], size:[0.4,5,0.4], color:C(categoryColor('crane')) },
      { center:[0,5.1,0.8], size:[0.3,0.3,3.2], color:C([0.5,0.25,0.12]) },
    ];
    case 'container': return [{ center:[0,1.4,0], size:[2,2.8,2], color:C(categoryColor('container')) }];
    case 'robot': return [
      { center:[0,0.8,0], size:[0.8,1.2,0.5], color:C(categoryColor('robot')) },
      { center:[0,1.7,0], size:[0.4,0.4,0.4], color:C([0.3,0.3,0.3]) },
    ];
    case 'building': return [{ center:[0,3,0], size:[2,6,2], color:C(categoryColor('building')) }];
    case 'ship': return [{ center:[0,1,0], size:[2,2,7], color:C(categoryColor('ship')) }];
    case 'light': return [{ center:[0,2.5,0], size:[0.2,5,0.2], color:C(categoryColor('light')) }];
    case 'vehicle': return [{ center:[0,0.6,0], size:[1,1,2.2], color:C(categoryColor('vehicle')) }];
    case 'sign': return [{ center:[0,2,0], size:[2.5,1.5,0.2], color:C(categoryColor('sign')) }];
    default: return [{ center:[0,0.6,0], size:[1.2,1.2,1.2], color:C(categoryColor('prop')) }];
  }
}
