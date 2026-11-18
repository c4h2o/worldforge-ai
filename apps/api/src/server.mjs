// WorldForge AI — Phase 1 MVP 服务端骨架（零依赖 Node http）
// Tripo 风格异步任务 API：POST /api/generation/* → {task_id}；GET /api/tasks/:id 轮询。
// 资产库 + 世界画布(Three.js) + 场景导出。默认 Mock Provider（程序化资产）；可换 Tripo/TripoSR。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseBrief, DEFAULT_BRIEF, categoryColor, boxesForCategory } from '../../demo/src/semantic.mjs';
import { buildGLB } from '../../demo/src/glb.mjs';
import { conceptImage } from '../../demo/src/png.mjs';
import { createProvider, downloadModel, sleep } from './providers.mjs';
import { runAgent, TOOL_DEFS } from './agent.mjs';
import { createLLM } from './llm.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(process.cwd(), 'output');
const ASSETS_DIR = path.join(OUT, 'assets'), IMAGES_DIR = path.join(OUT, 'images'), SCENES_DIR = path.join(OUT, 'scenes');
const MIME = { '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript', '.json':'application/json', '.glb':'model/gltf-binary', '.png':'image/png', '.css':'text/css' };

// ── 存储（内存 + 文件持久化）─────────────────────────
// 轻量 .env 加载（零依赖）
function loadEnv(){ try { const f = path.join(process.cwd(), '.env'); const s = fs.readFileSync(f, 'utf8'); for (const line of s.split('\n')) { const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ''); } } catch {} }
loadEnv();

const tasks = new Map();   // id -> Task
const assets = new Map();  // id -> Asset
const scenes = new Map();  // id -> WorldScene
let taskSeq = 0, assetSeq = 0;
let activeProvider = createProvider('mock', process.env);
let providerError = null;

function ensureDirs(){ for (const d of [ASSETS_DIR, IMAGES_DIR, SCENES_DIR]) fs.mkdirSync(d, { recursive: true }); }

// ── 任务队列（Tripo 风格：提交返回 task_id，异步处理，轮询拿状态）──
function enqueue(type, params, provider = 'mock') {
  const id = 'task_' + (++taskSeq);
  const task = { id, type, status: 'queued', progress: 0, params: { provider, ...params }, result: null, createdAt: new Date().toISOString() };
  tasks.set(id, task);
  const done = processTask(id);
  return { task_id: id, done };
}

async function processTask(id) {
  const task = tasks.get(id);
  if (!task) return;
  task.status = 'running'; task.progress = 10;
  try {
    const p = task.params;
    if (activeProvider.name === 'mock') {
      // 程序化（零依赖，无凭据也可跑）
      let category = p.category || 'prop';
      if (!p.category && p.input) category = (String(p.input).match(/[a-z_]+/)?.[0]) || 'prop';
      const glb = buildGLB(boxesForCategory(category), category);
      const modelName = id + '.glb', thumbName = id + '.png';
      fs.writeFileSync(path.join(ASSETS_DIR, modelName), glb);
      fs.writeFileSync(path.join(IMAGES_DIR, thumbName), conceptImage(categoryColor(category), taskSeq));
      task.progress = 80;
      const asset = {
        id, name: id, category,
        local_path: '/assets/' + modelName, thumbnail: '/images/' + thumbName,
        mesh_stats: { faces: boxesForCategory(category).length * 12, verts: 24 * boxesForCategory(category).length, parts: 1 },
        materials: ['pbr'], animations: [],
        semantic_tags: [category], provenance: { spec_id: p.spec_id || null, image_ids: [], provider: p.provider, task_ids: [id] },
        version: 1, frozen: false,
      };
      assets.set(id, asset);
      task.status = 'success'; task.progress = 100;
      task.result = { model_url: asset.local_path, thumbnail: asset.thumbnail, asset_id: id, category };
    } else {
      // 真实 Provider（tripo | triposr）：提交 → 轮询 → 下载 → 入库
      const handle = await activeProvider.fromImage(p.input, { model: p.model, face_limit: p.face_limit, texture: p.texture });
      task.progress = 30; task.result = { upstream_task: handle.task_id };
      let st = await activeProvider.poll(handle.task_id);
      let guard = 0;
      while ((st.status === 'queued' || st.status === 'running') && guard++ < 600) { await sleep(1000); st = await activeProvider.poll(handle.task_id); }
      if (st.status !== 'success' || !st.output) throw new Error('上游生成失败: ' + JSON.stringify(st));
      const modelUrl = st.output.model_url || (Array.isArray(st.output.model_urls) ? st.output.model_urls[0] : null) || (st.output.output && st.output.output.model_url);
      const glb = await downloadModel(modelUrl);
      const modelName = id + '.glb';
      fs.writeFileSync(path.join(ASSETS_DIR, modelName), glb);
      task.progress = 90;
      const category = p.category || 'model';
      const asset = {
        id, name: id, category,
        local_path: '/assets/' + modelName, thumbnail: null,
        mesh_stats: { faces: 0, verts: 0, parts: 0 },
        materials: ['pbr'], animations: [],
        semantic_tags: [category], provenance: { spec_id: p.spec_id || null, image_ids: [p.input || ''], provider: activeProvider.name, task_ids: [handle.task_id] },
        version: 1, frozen: false,
      };
      assets.set(id, asset);
      task.status = 'success'; task.progress = 100;
      task.result = { model_url: asset.local_path, thumbnail: null, asset_id: id, category, upstream_task: handle.task_id };
    }
  } catch (e) {
    task.status = 'failed'; task.result = { error: String(e && e.message || e) };
  }
}

// ── 世界画布：AI 布局摆放（网格 + 分区）───────────────
function placeEntities(assetIds) {
  return assetIds.map((aid, i) => {
    const col = i % 4, row = Math.floor(i / 4);
    return { id: aid, asset_id: aid,
      transform: { position: [col * 3.2, 0, row * 3.2], rotation: [0, (i % 4) * Math.PI / 2, 0], scale: [1, 1, 1] },
      semantic_role: assets.get(aid)?.category || 'prop', placed_by: 'ai', locked: false };
  });
}

async function createScene(brief) {
  const spec = parseBrief(brief);
  const ids = [];
  for (const ent of spec.entities) {
    const { task_id, done } = enqueue('image-to-model', { input: 'semantic:' + ent.category, category: ent.category, spec_id: spec.meta.id });
    await done;                       // mock 快；真实 Provider 由客户端轮询
    ids.push(task_id);
  }
  const sceneId = 'scene_' + (scenes.size + 1);
  const scene = {
    id: sceneId, name: spec.meta.name, brief, spec_id: spec.meta.id, style: spec.meta.style, seed: spec.meta.seed,
    scene_graph: {
      environment: { time: spec.world.atmosphere.time, weather: spec.world.atmosphere.weather, sky: '#0b1020', fog: 0.6 },
      lights: [
        { type: 'hemisphere', color: '#8899ff', intensity: 0.5, position: [0, 10, 0] },
        { type: 'directional', color: '#ff2a6d', intensity: 1.2, position: [5, 8, 4] },
      ],
      cameras: [{ id: 'cam_main', position: [7, 7, 10], target: [0, 1, 0] }],
      zones: [{ id: 'zone_main', name: '主区', bounds: [-2, 0, -2, 10, 8, 10] }],
      entities: placeEntities(ids),
    },
    status: 'draft',
  };
  scenes.set(sceneId, scene);
  fs.writeFileSync(path.join(SCENES_DIR, sceneId + '.json'), JSON.stringify(scene, null, 2));
  return scene;
}

// ── HTTP 路由 ─────────────────────────────────────
function json(res, code, data){ const body = JSON.stringify(data); res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }); res.end(body); }
async function readBody(req){ let b=''; for await (const c of req) b += c; try { return b ? JSON.parse(b) : {}; } catch { return {}; } }

function serveFile(res, filePath){ fs.readFile(filePath, (err, data) => { if (err) { res.writeHead(404); return res.end('not found'); } res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' }); res.end(data); }); }

export function createApp(options = {}) {
  ensureDirs();
  try { activeProvider = createProvider(options.provider || process.env.IMG3D_PROVIDER || 'mock', process.env); providerError = null; }
  catch (e) { activeProvider = createProvider('mock', process.env); providerError = String(e && e.message || e); }
  // AI 接口分发（编排智能体 → 真实管线）
  const dispatch = {
    'semantic.parse': async (args, ctx) => ({ result: parseBrief(args.brief || ctx.brief) }),
    'image.generateFromSpec': async (args, ctx) => ({ result: { note: '概念图生成（语义驱动）', entities: parseBrief(args.spec && args.spec.brief || ctx.brief).entities.length } }),
    'img3d.fromImage': async (args) => {
      const { task_id, done } = enqueue('image-to-model', { input: args.input || ('semantic:' + (args.category || 'prop')), category: args.category });
      await done;
      const a = assets.get(task_id);
      return { result: { task_id, asset_id: task_id, model_url: a && a.local_path, category: a && a.category } };
    },
    'asset.ingest': async (args) => {
      const a = assets.get(args.asset_id);
      if (a && Array.isArray(args.tags)) a.semantic_tags = [...new Set([...a.semantic_tags, ...args.tags])];
      return { result: { asset_id: args.asset_id, tags: a && a.semantic_tags } };
    },
    'canvas.layout': async (args, ctx) => { const scene = await createScene(args.brief || ctx.brief); return { result: { scene_id: scene.id, entities: scene.scene_graph.entities.length, style: scene.style } }; },
    'critic.review': async () => { const score = assets.size >= 3 ? 82 : 55; return { result: { score, ok: score >= 70, issues: score >= 70 ? [] : ['资产数量不足 3'] } }; },
    'export.game': async () => { const scene = [...scenes.values()][0]; if (scene) fs.writeFileSync(path.join(OUT, 'scene.json'), JSON.stringify(scene, null, 2)); return { result: { path: 'output/scene.json', scene_id: scene && scene.id } }; },
  };

  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url || '/', 'http://x');
    const p = u.pathname;
    try {
      // API
      if (p === '/api/health') return json(res, 200, { ok: true, provider: activeProvider.name, provider_error: providerError, tasks: tasks.size, assets: assets.size, scenes: scenes.size });

      if (p === '/api/generation/image-to-model' && req.method === 'POST') {
        const b = await readBody(req);
        const { task_id } = enqueue('image-to-model', { input: b.input || b.image, category: b.category, face_limit: b.face_limit });
        return json(res, 200, { task_id });
      }
      if (p === '/api/generation/multiview-to-model' && req.method === 'POST') {
        const b = await readBody(req);
        const { task_id } = enqueue('multiview-to-model', { inputs: b.inputs || [], category: b.category });
        return json(res, 200, { task_id });
      }
      if (p === '/api/tasks' && req.method === 'GET') return json(res, 200, { tasks: [...tasks.values()] });
      if (p.startsWith('/api/tasks/') && req.method === 'GET') {
        const t = tasks.get(p.slice('/api/tasks/'.length));
        return t ? json(res, 200, t) : json(res, 404, { error: 'task not found' });
      }

      if (p === '/api/assets' && req.method === 'GET') return json(res, 200, { assets: [...assets.values()] });

      if (p === '/api/scenes' && req.method === 'POST') {
        const b = await readBody(req);
        const scene = await createScene(b.brief || DEFAULT_BRIEF);
        return json(res, 200, scene);
      }
      if (p === '/api/scenes' && req.method === 'GET') return json(res, 200, { scenes: [...scenes.values()] });
      if (p.startsWith('/api/scenes/') && req.method === 'GET') {
        const s = scenes.get(p.slice('/api/scenes/'.length));
        return s ? json(res, 200, s) : json(res, 404, { error: 'scene not found' });
      }

      if (p === '/api/agent/tools' && req.method === 'GET') return json(res, 200, { tools: TOOL_DEFS });
      if (p === '/api/agent/run' && req.method === 'POST') {
        const b = await readBody(req);
        let llm;
        try { llm = createLLM({ provider: b.provider || process.env.AGENT_PROVIDER || 'mock', baseUrl: process.env.LLM_BASE_URL, apiKey: b.apiKey || process.env.LLM_API_KEY, model: b.model || process.env.LLM_MODEL, brief: b.brief }); }
        catch (e) { return json(res, 400, { error: String(e && e.message || e) }); }
        const out = await runAgent({ brief: b.brief || DEFAULT_BRIEF, llm, dispatch });
        return json(res, 200, out);
      }

      // 世界画布页
      if (p === '/') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(worldHtml()); }

      // 静态产物
      if (p.startsWith('/assets/') || p.startsWith('/images/') || p.startsWith('/scenes/')) {
        const safe = path.normalize(path.join(OUT, p)); if (!safe.startsWith(OUT)) return json(res, 403, { error: 'forbidden' });
        return serveFile(res, safe);
      }
      return json(res, 404, { error: 'not found: ' + p });
    } catch (e) { json(res, 500, { error: String(e && e.message || e) }); }
  });
  return server;
}

function worldHtml(){ return `<!doctype html><html><head><meta charset="utf-8"><title>WorldForge — World Canvas</title>
<style>html,body{margin:0;height:100%;background:#0b1020;color:#cfe;font-family:monospace;overflow:hidden}#hud{position:fixed;top:8px;left:8px;font-size:12px;background:#0009;padding:8px 12px;border-radius:8px;z-index:10;max-width:40ch}#hud .t{color:#5df}#hud .k{color:#f5a}#loading{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;color:#5df;z-index:20;font-size:15px}</style>
<script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js","three/addons/":"https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/"}}</script></head>
<body><div id="hud"></div><div id="loading">loading world…</div>
<script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
const scene = new THREE.Scene(); scene.background = new THREE.Color('#0b1020'); scene.fog = new THREE.Fog('#0b1020', 25, 80);
const camera = new THREE.PerspectiveCamera(50, innerWidth/innerHeight, 0.1, 300); camera.position.set(7,7,10);
const renderer = new THREE.WebGLRenderer({antialias:true}); renderer.setSize(innerWidth,innerHeight); document.body.appendChild(renderer.domElement);
const controls = new OrbitControls(camera, renderer.domElement); controls.target.set(0,1,0);
scene.add(new THREE.HemisphereLight(0x8899ff,0x223,0.6));
const d=new THREE.DirectionalLight(0xff2a6d,1.2); d.position.set(5,8,4); scene.add(d);
scene.add(new THREE.GridHelper(40,40,0x2af,0x145));
const loader = new GLTFLoader();
async function boot(){
  let sceneData = (await (await fetch('/api/scenes')).json()).scenes[0];
  if(!sceneData){ sceneData = await (await fetch('/api/scenes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({brief: prompt('世界愿景')||'一座雨夜赛博朋克港口'})})).json(); }
  const ents = sceneData.scene_graph.entities;
  let loaded=0;
  for(const e of ents){
    try{
      const g = await new Promise((ok,err)=>loader.load('/assets/'+e.asset_id+'.glb',ok,undefined,err));
      const m=g.scene; m.position.set(...e.transform.position); m.rotation.set(...e.transform.rotation); m.scale.set(...e.transform.scale); scene.add(m);
    }catch(_){}
    if(++loaded>=ents.length){ document.getElementById('loading').style.display='none'; }
  }
  document.getElementById('hud').innerHTML = '<div class="t">WorldForge AI · World Canvas</div>场景: <span class="k">'+sceneData.name+'</span> · 风格 <span class="k">'+sceneData.style+'</span> · 实体 <span class="k">'+ents.length+'</span><br>拖拽旋转 · 滚轮缩放 · 右键平移';
}
boot();
addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});
(function loop(){ requestAnimationFrame(loop); controls.update(); renderer.render(scene,camera); })();
</script></body></html>`;
}

// 直接运行
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  createApp().listen(port, () => console.log('WorldForge MVP API → http://localhost:' + port + '  (world canvas: /)'));
}
