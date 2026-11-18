// WorldForge AI — Phase 0 Demo（零依赖，node 直接跑）
// 端到端：愿景 → 语义规范 → 概念图(占位) → 程序化 GLB 资产 → 资产库 → 世界画布 → 场景导出 + 预览
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildGLB } from './glb.mjs';
import { conceptImage } from './png.mjs';
import { parseBrief, DEFAULT_BRIEF, categoryColor, boxesForCategory } from './semantic.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

function main(){
  const args = process.argv.slice(2).join(' ').trim();
  const brief = (args && !/^[0-9.,\s]+$/.test(args)) ? args : DEFAULT_BRIEF;
  console.log('🌐 WorldForge AI — Phase 0 Demo');
  console.log('  愿景:', brief);

  // ① 语义解析（规则式；后续由 LLM 语义 Agent 替换）
  const spec = parseBrief(brief);
  console.log('  ① semantic.parse →', spec.entities.length, 'entities · style=' + spec.meta.style);

  // 输出目录
  const out = path.join(process.cwd(), 'output');
  const imgDir = path.join(out, 'images'), asDir = path.join(out, 'assets');
  fs.mkdirSync(imgDir, { recursive: true }); fs.mkdirSync(asDir, { recursive: true });

  // ② 生图（占位概念图） + ③ 图生 3D（程序化 GLB）+ ④ 入库
  const assets = [];
  spec.entities.forEach((ent, i) => {
    const color = categoryColor(ent.category);
    // 概念图占位
    const imgName = `${ent.id}.png`;
    fs.writeFileSync(path.join(imgDir, imgName), conceptImage(color, spec.meta.seed + i));
    // 程序化 3D（学 Tripo 的"代码生资产"思路）
    const glb = buildGLB(boxesForCategory(ent.category), ent.category);
    const glbName = `${ent.id}.glb`;
    fs.writeFileSync(path.join(asDir, glbName), glb);
    // 资产记录
    assets.push({
      id: ent.id, name: ent.id, category: ent.category,
      local_path: 'assets/' + glbName, thumbnail: 'images/' + imgName,
      mesh_stats: { faces: boxesForCategory(ent.category).length * 12, verts: 24 * boxesForCategory(ent.category).length, parts: ent.parts?.length ?? 1 },
      materials: ['pbr'], animations: ent.riggable ? ['preset:idle'] : [],
      semantic_tags: [ent.category, ...Object.keys(ent.attributes ?? {})],
      provenance: { brief, spec_id: spec.meta.id, image_ids: [imgName], provider: 'mock-procedural', task_ids: [] },
      version: 1, frozen: false,
    });
  });
  console.log('  ②③④ 生成', assets.length, '个资产 → output/assets/*.glb (程序化) + output/images/*.png (概念图占位)');

  // 资产库索引
  fs.writeFileSync(path.join(out, 'assets.json'), JSON.stringify({ generatedAt: new Date().toISOString(), spec, assets }, null, 2));

  // ⑤ 世界画布：AI 布局摆放（网格 + 分区）
  const entities = assets.map((a, i) => {
    const col = i % 3, row = Math.floor(i / 3) % 3;
    return {
      id: a.id, asset_id: a.id,
      transform: { position: [col * 3.2, 0, row * 3.2], rotation: [0, (i % 4) * Math.PI / 2, 0], scale: [1, 1, 1] },
      semantic_role: a.category, placed_by: 'ai', locked: false,
    };
  });
  const scene = {
    id: 'scene_001', name: spec.meta.name, brief, spec_id: spec.meta.id,
    style: spec.meta.style, seed: spec.meta.seed,
    scene_graph: {
      environment: { time: spec.world.atmosphere.time, weather: spec.world.atmosphere.weather, sky: '#0b1020', fog: 0.6 },
      lights: [
        { type: 'hemisphere', color: '#8899ff', intensity: 0.5, position: [0, 10, 0] },
        { type: 'directional', color: '#ff2a6d', intensity: 1.2, position: [5, 8, 4] },
      ],
      cameras: [{ id: 'cam_main', position: [6, 6, 9], target: [0, 1, 0] }],
      zones: [{ id: 'zone_dock', name: '码头区', bounds: [-2, 0, -2, 8, 6, 8] }],
      entities,
    },
    status: 'draft',
  };
  fs.writeFileSync(path.join(out, 'scene.json'), JSON.stringify(scene, null, 2));
  console.log('  ⑤ canvas.layout →', entities.length, '个实体摆放 → output/scene.json');

  // ⑥ 审美批评（占位评分）
  const score = entities.length >= 3 ? 82 : 55;
  console.log(`  ⑥ critic.review → score=${score} ${score>=70?'(通过)':'(未通过，进入再生成循环)'}`);

  // ⑦ 预览
  const html = previewHtml(scene, spec);
  fs.writeFileSync(path.join(out, 'world-preview.html'), html);

  fs.writeFileSync(path.join(out, 'README.md'), '# WorldForge AI — Demo 输出\n' +
    '- 愿景：' + brief + '\n' +
    '- 资产：' + assets.length + ' 个（程序化 GLB）\n' +
    '- 预览：运行 node apps/demo/src/serve.mjs，然后打开 http://localhost:8000/world-preview.html\n' +
    '- 结构：assets/*.glb · images/*.png · assets.json · scene.json\n');

  console.log('  ⑦ 导出完成 → output/ (assets.json, scene.json, world-preview.html)');
  console.log('\n✅ 预览：node apps/demo/src/serve.mjs  →  打开 http://localhost:8000/world-preview.html');
  console.log('   或直接用任意静态服务器打开 output/world-preview.html');
}

function previewHtml(scene, spec){
  const ents = scene.scene_graph.entities.map(e => JSON.stringify(e));
  const sky = scene.scene_graph.environment.sky;
  return `<!doctype html><html><head><meta charset="utf-8"><title>WorldForge — ${scene.name}</title>
<style>html,body{margin:0;height:100%;background:#0b1020;color:#cfe;font-family:monospace}#hud{position:fixed;top:8px;left:8px;font-size:12px;background:#0008;padding:6px 10px;border-radius:6px;z-index:10}#loading{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;color:#5df;z-index:20}</style>
<script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js","three/addons/":"https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/"}}</script>
</head><body><div id="hud">WorldForge AI · ${scene.name} · style=${spec.meta.style} · ${ents.length} entities</div><div id="loading">loading assets…</div>
<script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
const scene = new THREE.Scene();
scene.background = new THREE.Color('${sky}');
scene.fog = new THREE.Fog('${sky}', 20, 60);
const camera = new THREE.PerspectiveCamera(50, innerWidth/innerHeight, 0.1, 200);
camera.position.set(6,6,9);
const renderer = new THREE.WebGLRenderer({antialias:true}); renderer.setSize(innerWidth,innerHeight); document.body.appendChild(renderer.domElement);
const controls = new OrbitControls(camera, renderer.domElement);
scene.add(new THREE.HemisphereLight(0x8899ff,0x223,0.6));
const d=new THREE.DirectionalLight(0xff2a6d,1.2); d.position.set(5,8,4); scene.add(d);
const grid = new THREE.GridHelper(30,30,0x2af,0x145); scene.add(grid);
const loader = new GLTFLoader();
const sceneGraph = ${JSON.stringify(scene.scene_graph)};
let loaded=0;
const ents = ${JSON.stringify(scene.scene_graph.entities)};
for(const e of ents){
  loader.load('assets/'+e.asset_id+'.glb',(g)=>{
    const m=g.scene;
    m.position.set(...e.transform.position); m.rotation.set(...e.transform.rotation); m.scale.set(...e.transform.scale);
    scene.add(m);
    if(++loaded>=ents.length){ document.getElementById('loading').style.display='none'; }
  });
}
addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});
(function loop(){ requestAnimationFrame(loop); controls.update(); renderer.render(scene,camera); })();
</script></body></html>`;
}

main();
