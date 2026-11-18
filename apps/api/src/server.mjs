// WorldForge AI — Phase 1 MVP 服务端骨架（零依赖 Node http）
// 异步任务 API（自研：POST /api/generation/* → {task_id}；GET /api/tasks/:id 轮询）。
// 资产库 + 世界画布(Three.js) + 场景导出。默认 Mock Provider（程序化）；可换自研重建引擎 Local。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseBrief, DEFAULT_BRIEF, categoryColor, boxesForCategory } from '../../demo/src/semantic.mjs';
import { buildGLB } from '../../demo/src/glb.mjs';
import { conceptImage } from '../../demo/src/png.mjs';
import { createProvider, downloadModel, sleep } from './providers.mjs';
import { getUnits } from './units.mjs';
import { runAgent, TOOL_DEFS } from './agent.mjs';
import { renderScene } from './preview.mjs';
import { reviewScene, autofixScene } from './critic.mjs';
import { createLLM } from './llm.mjs';
import { createImageProvider } from './image-providers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '../../../output');
const WORLD_HTML = path.join(__dirname, '..', 'public', 'world.html');
const WORLD_JS = path.join(__dirname, '..', 'public', 'world.mjs');
const ASSETS_DIR = path.join(OUT, 'assets'), IMAGES_DIR = path.join(OUT, 'images'), SCENES_DIR = path.join(OUT, 'scenes');
const ASSETS_META = path.join(OUT, 'assets.json');
const FILM_HTML = path.join(__dirname, '..', 'public', 'film.html');
const FILM_JS = path.join(__dirname, '..', 'public', 'film.mjs');
const RENDERER_JS = path.join(__dirname, '..', 'public', 'renderer.mjs');
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
let activeImageProvider = createImageProvider('mock', process.env);
let imageProviderError = null;

function ensureDirs(){ for (const d of [ASSETS_DIR, IMAGES_DIR, SCENES_DIR]) fs.mkdirSync(d, { recursive: true }); }

// ── 任务队列（自研：提交返回 task_id，异步处理，轮询拿状态）──
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
      const realThumb = path.join(IMAGES_DIR, 'concept_' + category + '.png');
      const thumb = fs.existsSync(realThumb) ? '/images/concept_' + category + '.png' : '/images/' + thumbName;
      const asset = {
        id, name: id, category,
        local_path: '/assets/' + modelName, thumbnail: thumb,
        mesh_stats: { faces: boxesForCategory(category).length * 12, verts: 24 * boxesForCategory(category).length, parts: 1 },
        materials: ['pbr'], animations: [],
        semantic_tags: [category], provenance: { spec_id: p.spec_id || null, image_ids: [], provider: p.provider, task_ids: [id] },
        version: 1, frozen: false,
      };
      assets.set(id, asset); persistAssets();
      task.status = 'success'; task.progress = 100;
      task.result = { model_url: asset.local_path, thumbnail: asset.thumbnail, asset_id: id, category };
    } else {
      // 真实 Provider（local 自研重建引擎）：提交 → 轮询 → 下载 → 入库
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
      let thumb = null;
      if (p.input) { const m = String(p.input).match(/(images\/[^?#\s]+\.(?:png|jpg|jpeg|webp))/i); if (m) thumb = '/' + m[1]; }
      const asset = {
        id, name: id, category,
        local_path: '/assets/' + modelName, thumbnail: thumb,
        mesh_stats: { faces: 0, verts: 0, parts: 0 },
        materials: ['pbr'], animations: [],
        semantic_tags: [category], provenance: { spec_id: p.spec_id || null, image_ids: [p.input || ''], provider: activeProvider.name, task_ids: [handle.task_id] },
        version: 1, frozen: false,
      };
      assets.set(id, asset); persistAssets();
      task.status = 'success'; task.progress = 100;
      task.result = { model_url: asset.local_path, thumbnail: asset.thumbnail, asset_id: id, category, upstream_task: handle.task_id };
    }
  } catch (e) {
    task.status = 'failed'; task.result = { error: String(e && e.message || e) };
  }
}

// ── 世界画布：AI 布局摆放（网格 + 分区）───────────────
function promptFromSpec(spec) {
  const m = spec.meta, w = spec.world;
  const ents = spec.entities.map(e => e.count > 1 ? (e.category + '×' + e.count) : e.category).join('、');
  return '电影级概念图，' + m.style + ' 风格，' + w.atmosphere.time + (w.atmosphere.weather ? ('，' + w.atmosphere.weather) : '') + '，场景元素：' + ents + '，' + (spec.composition ? ('构图 ' + spec.composition.layout + '，景深 ' + spec.composition.depth) : '') + '，体积光，宽银幕构图，8K';
}

async function generateImage(prompt, size) {
  if (activeImageProvider.name === 'mock') return await activeImageProvider.generate(prompt, size);
  return await activeImageProvider.generate(prompt, size);
}

function persistScene(scene) { fs.writeFileSync(path.join(SCENES_DIR, scene.id + '.json'), JSON.stringify(scene, null, 2)); }

function autoShots(scene) {
  const ents = scene.scene_graph.entities || [];
  const shots = [];
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2;
    shots.push({ id: 'shot_orbit_' + i, name: '环绕 ' + (i + 1) + '/4', camera: { position: [Math.cos(a) * 9, 3.5, Math.sin(a) * 9], target: [0, 1, 0] }, duration: 3, move: { type: 'orbit', speed: 0.5 } });
  }
  for (let i = 0; i < Math.min(ents.length, 6); i++) {
    const e = ents[i], p = e.transform.position;
    shots.push({ id: 'shot_close_' + i, name: '特写 ' + (e.semantic_role || e.asset_id), camera: { position: [p[0] + 2.2, 2.2, p[2] + 2.2], target: [p[0], 1, p[2]] }, duration: 2.5 });
  }
  return shots;
}

function filmForScene(scene) {
  if (scene.film) return scene.film;
  const shots = autoShots(scene);
  const film = { id: 'film_' + scene.id, name: scene.name + ' — 成片', fps: 30, shots, duration: shots.reduce((a, s) => a + (s.duration || 3), 0), status: 'ready', created_at: new Date().toISOString() };
  scene.film = film; persistScene(scene); return film;
}


// ── 物理量纲 → 画布尺寸约束（SI，system.units 基础）──
const EXTENT_CACHE = new Map();
function assetExtent(aid) {
  if (EXTENT_CACHE.has(aid)) return EXTENT_CACHE.get(aid);
  const a = assets.get(aid);
  if (!a || !a.local_path) return [1, 1, 1];
  try {
    const file = path.join(ASSETS_DIR, path.basename(a.local_path));
    if (!fs.existsSync(file)) return [1, 1, 1];
    const buf = fs.readFileSync(file);
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    let off = 12, gltf = null;
    while (off < buf.byteLength) {
      const len = dv.getUint32(off, true), type = dv.getUint32(off + 4, true);
      if (type === 0x4E4F534A) gltf = JSON.parse(new TextDecoder().decode(new Uint8Array(buf.buffer, buf.byteOffset + off + 8, len)));
      off += 8 + len;
    }
    let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (const mesh of (gltf && gltf.meshes) || []) for (const pr of mesh.primitives || []) {
      const ac = gltf.accessors[pr.attributes && pr.attributes.POSITION];
      if (ac && ac.min && ac.max) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], ac.min[k]); mx[k] = Math.max(mx[k], ac.max[k]); }
    }
    const ext = mn[0] === Infinity ? [1, 1, 1] : [mx[0] - mn[0] || 1, mx[1] - mn[1] || 1, mx[2] - mn[2] || 1];
    EXTENT_CACHE.set(aid, ext); return ext;
  } catch { return [1, 1, 1]; }
}
// 预览：按资产 id 取 GLB 绝对路径
function assetPathFor(aid) { const a = assets.get(aid); return a && a.local_path ? path.join(ASSETS_DIR, path.basename(a.local_path)) : null; }
// 软光栅渲染场景预览（零依赖自研光栅器），落盘并返回图片 URL
function previewForScene(scene, w, h) {
  const out = renderScene(scene, { W: w || 1024, H: h || 576, assetFor: assetPathFor });
  if (!out.ok) throw new Error(out.error || '预览渲染失败');
  const name = 'scene_preview_' + scene.id + '.png';
  fs.writeFileSync(path.join(IMAGES_DIR, name), Buffer.from(out.png));
  return { url: '/images/' + name, width: out.width, height: out.height, shaded: out.shaded, ms: out.ms };
}

// 单资产预览：以原点放置资产，自动取景
function previewForAsset(aid, w, h) {
  if (!assets.has(aid)) throw new Error('资产不存在: ' + aid);
  const out = renderScene({ scene_graph: { entities: [{ id: 'asset', asset_id: aid, transform: { position: [0,0,0], rotation: [0,0,0], scale: [1,1,1] } }] } }, { W: w || 512, H: h || 512, assetFor: assetPathFor });
  if (!out.ok) throw new Error(out.error || '资产预览渲染失败');
  const name = 'asset_preview_' + aid + '.png';
  fs.writeFileSync(path.join(IMAGES_DIR, name), Buffer.from(out.png));
  return { url: '/images/' + name, width: out.width, height: out.height, shaded: out.shaded, ms: out.ms };
}

// entity.physics.dimensions = {length:{value,unit}, width:{...}, height:{...}} 或 {size:{value,unit}}（SI）
// 按资产自然包围盒等比/逐轴缩放，使实体世界尺寸符合指定的 SI 量纲。
function applyPhysicsScale(physics, extent) {
  const d = physics && physics.dimensions;
  if (!d || typeof d !== 'object') return [1, 1, 1];
  const AXIS = { length: 0, width: 0, x: 0, height: 1, y: 1, depth: 2, z: 2 };
  const axes = [null, null, null];
  for (const [k, v] of Object.entries(d)) {
    if (v && typeof v === 'object' && v.value !== undefined) {
      if (k === 'size') { const m = Math.max(extent[0], extent[1], extent[2]) || 1; const sc = Number(v.value) / m; axes[0] = axes[1] = axes[2] = sc; }
      else if (k in AXIS) { const a = AXIS[k]; axes[a] = Number(v.value) / (extent[a] || 1); }
    }
  }
  const vals = [axes[0], axes[1], axes[2]].filter(x => x != null);
  if (vals.length === 0) return [1, 1, 1];
  if (vals.length === 1) return [vals[0], vals[0], vals[0]];        // 单轴 → 等比保持比例
  return [axes[0] ?? vals[0], axes[1] ?? vals[0], axes[2] ?? vals[0]]; // 多轴 → 各自 + 补齐
}


// ── 资产库语义检索（AI 复用匹配）──
function searchAssets(query = {}) {
  let out = [...assets.values()];
  const { q, category, tags, physics } = query;
  if (category) out = out.filter(a => a.category === category);
  if (Array.isArray(tags) && tags.length) out = out.filter(a => tags.some(t => (a.semantic_tags || []).includes(t)));
  if (q) {
    const ql = String(q).toLowerCase();
    out = out.filter(a => [a.name, a.category, ...(a.semantic_tags || []), (a.provenance && a.provenance.image_ids || []).join(' ')]
      .join(' ').toLowerCase().includes(ql));
  }
  if (physics) {
    const dims = physics.dimensions || physics;
    out = out.filter(a => {
      const ext = assetExtent(a.id);
      for (const [k, v] of Object.entries(dims)) {
        if (!v || v.value === undefined) continue;
        const ax = /^length|^width|^x/.test(k) ? 0 : /^height|^y/.test(k) ? 1 : /^depth|^z/.test(k) ? 2 : -1;
        if (ax < 0) continue;
        const val = ext[ax];
        if (/Min$/.test(k)) { if (val < v.value) return false; }
        else if (/Max$/.test(k)) { if (val > v.value) return false; }
        else if (/^Eq|^Exact/.test(k)) { if (Math.abs(val - v.value) > 1e-6) return false; }
      }
      return true;
    });
  }
  return out.map(a => ({ id: a.id, name: a.name, category: a.category, local_path: a.local_path, thumbnail: a.thumbnail, tags: a.semantic_tags || [], extent: assetExtent(a.id), faces: a.mesh_stats && a.mesh_stats.faces, parts: a.mesh_stats && a.mesh_stats.parts }));
}

function placeEntities(assetIds, specEntities = []) {
  return assetIds.map((aid, i) => {
    const col = i % 4, row = Math.floor(i / 4);
    const se = specEntities.find(x => x.category === assets.get(aid)?.category);
    const scale = applyPhysicsScale(se && se.physics, assetExtent(aid));
    return { id: aid, asset_id: aid,
      transform: { position: [col * 3.2, 0, row * 3.2], rotation: [0, (i % 4) * Math.PI / 2, 0], scale },
      semantic_role: assets.get(aid)?.category || 'prop', placed_by: 'ai', locked: false };
  });
}

// 自动拟合主分区包围盒（实体世界包围盒 + 2 单位余量）
function autoZone(entities = []) {
  if (!entities.length) return [{ id: 'zone_main', name: '主区', bounds: [-6, 0, -6, 6, 8, 6] }];
  let mnx = Infinity, mny = Infinity, mnz = Infinity, mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
  for (const e of entities) {
    const ext = assetExtent(e.asset_id || e.id);
    const [px, py, pz] = e.transform.position || [0, 0, 0];
    const [sx, sy, sz] = e.transform.scale || [1, 1, 1];
    mnx = Math.min(mnx, px - ext[0] * sx / 2); mxx = Math.max(mxx, px + ext[0] * sx / 2);
    mny = Math.min(mny, py - ext[1] * sy / 2); mxy = Math.max(mxy, py + ext[1] * sy / 2);
    mnz = Math.min(mnz, pz - ext[2] * sz / 2); mxz = Math.max(mxz, pz + ext[2] * sz / 2);
  }
  const g = 2;
  return [{ id: 'zone_main', name: '主区', bounds: [mnx - g, Math.min(0, mny), mnz - g, mxx + g, Math.max(8, mxy + g), mxz + g] }];
}
async function createScene(brief, specOverride) {
  const spec = (specOverride && specOverride.entities) ? specOverride : parseBrief(brief);
  const ids = [];
  for (const ent of spec.entities) {
    const existing = [...assets.values()].find(a => a.category === ent.category);
    if (existing) { ids.push(existing.id); continue; }
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
      zones: autoZone(placeEntities(ids, spec.entities)),
      entities: placeEntities(ids, spec.entities),
    },
    status: 'draft',
    'semantic.validate': async (args, ctx) => { const spec = args.spec || (args.brief ? parseBrief(args.brief) : null); if (!spec) throw new Error('缺少 spec 或 brief'); const v = validateUnits(spec); return { result: { ok: v.ok, issues: v.issues, entities_checked: spec.entities.length, note: '物理属性量纲基于 SI（见 system.units）' } }; },
    'system.units': async (args) => { const u = getUnits(); const q = args && args.q; if (q) { const f = x => (x.symbol + ' ' + x.name + ' ' + x.compose + ' ' + (x.note||'')).toLowerCase(); const hit = [...u.base, ...u.named, ...u.combined].filter(x => f(x).includes(String(q).toLowerCase())); return { result: { q, count: hit.length, units: hit } }; } return { result: u }; },
  };
  scenes.set(sceneId, scene);
  fs.writeFileSync(path.join(SCENES_DIR, sceneId + '.json'), JSON.stringify(scene, null, 2));
  return scene;
}

// ── HTTP 路由 ─────────────────────────────────────
// ── 磁盘持久化（资产元数据 + 场景）──
function persistAssets(){ try { fs.writeFileSync(ASSETS_META, JSON.stringify([...assets.values()], null, 2)); } catch {} }
function loadPersisted(){
  try { if (fs.existsSync(ASSETS_META)) { for (const a of JSON.parse(fs.readFileSync(ASSETS_META, 'utf8'))) { assets.set(a.id, a); const n = Number(String(a.id).replace(/^\D+/, '')); if (n > assetSeq) assetSeq = n; if (n > taskSeq) taskSeq = n; } } } catch {}
  try { if (fs.existsSync(SCENES_DIR)) { for (const f of fs.readdirSync(SCENES_DIR)) { if (!f.endsWith('.json')) continue; const s = JSON.parse(fs.readFileSync(path.join(SCENES_DIR, f), 'utf8')); scenes.set(s.id || f.replace(/\.json$/, ''), s); const n = Number(String(s.id || '').replace(/^\D+/, '')); if (n > sceneSeq) sceneSeq = n; } } } catch {}
}
function json(res, code, data){ const body = JSON.stringify(data); res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }); res.end(body); }
async function readBody(req){ let b=''; for await (const c of req) b += c; try { return b ? JSON.parse(b) : {}; } catch { return {}; } }

function serveFile(res, filePath){ fs.readFile(filePath, (err, data) => { if (err) { res.writeHead(404); return res.end('not found'); } res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' }); res.end(data); }); }

export function createApp(options = {}) {
  ensureDirs(); loadPersisted();
  try { activeProvider = createProvider(options.provider || process.env.IMG3D_PROVIDER || 'mock', process.env); providerError = null; }
  catch (e) { activeProvider = createProvider('mock', process.env); providerError = String(e && e.message || e); }
  try { activeImageProvider = createImageProvider(options.imageProvider || process.env.IMG_PROVIDER || 'mock', process.env); imageProviderError = null; }
  catch (e) { activeImageProvider = createImageProvider('mock', process.env); imageProviderError = String(e && e.message || e); }
  // AI 接口分发（编排智能体 → 真实管线）
  const dispatch = {
    'semantic.parse': async (args, ctx) => ({ result: parseBrief(args.brief || ctx.brief) }),
    'image.generateFromSpec': async (args, ctx) => {
      const spec = parseBrief(args.spec && args.spec.brief || ctx.brief);
      const prompt = args.prompt || promptFromSpec(spec);
      const buf = await generateImage(prompt, args.size);
      const name = 'concept_' + Date.now() + '.png';
      fs.writeFileSync(path.join(IMAGES_DIR, name), buf);
      return { result: { image_url: '/images/' + name, prompt, provider: activeImageProvider.name, entities: spec.entities.length } };
    },
    'img3d.fromImage': async (args) => {
    const { task_id, done } = enqueue('image-to-model', { input: args.input || ('semantic:' + (args.category || 'prop')), category: args.category });
      await done;
      const a = assets.get(task_id);
      return { result: { task_id, asset_id: task_id, model_url: a && a.local_path, category: a && a.category } };
    },
    'asset.preview': async (args) => {
        const list = [...assets.values()];
        const aid = args.asset_id || (list[0] && list[0].id);
        if (!aid) return { error: '无可用资产' };
        try { return { result: { asset_id: aid, ...previewForAsset(aid, args.w || 512, args.h || 512) } }; }
        catch (e) { return { error: e.message }; }
      },
      'asset.search': async (args) => ({ result: { query: args, count: searchAssets(args).length, assets: searchAssets(args) } }),
    'asset.ingest': async (args) => {
      const a = assets.get(args.asset_id);
      if (a && Array.isArray(args.tags)) a.semantic_tags = [...new Set([...a.semantic_tags, ...args.tags])];
      return { result: { asset_id: args.asset_id, tags: a && a.semantic_tags } };
    },
    'canvas.layout': async (args, ctx) => { const scene = await createScene(args.brief || ctx.brief, args.spec); return { result: { scene_id: scene.id, entities: scene.scene_graph.entities.length, style: scene.style, note: '实体物理尺寸已按 SI 约束缩放（见 system.units）' } }; },
    'critic.review': async (args) => { const scene = [...scenes.values()].at(-1); if (!scene) throw new Error('先创建场景'); const spec = args.spec || (scene.brief ? parseBrief(scene.brief) : null); const r = reviewScene(scene, { extentFor: assetExtent, spec }); return { result: { scene_id: scene.id, entities: scene.scene_graph.entities.length, ...r } }; },
    'critic.autofix': async (args) => {
      const scene = [...scenes.values()].at(-1);
      if (!scene) throw new Error('先创建场景');
      const spec = args.spec || (scene.brief ? parseBrief(scene.brief) : null);
      const r = autofixScene(scene, { extentFor: assetExtent, spec, searchAssets });
      fs.writeFileSync(path.join(SCENES_DIR, scene.id + '.json'), JSON.stringify(scene, null, 2));
      return { result: { scene_id: scene.id, ...r } };
    },
    'export.game': async () => { const scene = [...scenes.values()].at(-1); if (scene) fs.writeFileSync(path.join(OUT, 'scene.json'), JSON.stringify(scene, null, 2)); return { result: { path: 'output/scene.json', scene_id: scene && scene.id } }; },
    'scene.preview': async (args) => { const scene = (args.scene_id && scenes.get(args.scene_id)) || [...scenes.values()].at(-1); if (!scene) throw new Error('先创建场景'); const r = previewForScene(scene, args.w, args.h); return { result: { scene_id: scene.id, image_url: r.url, width: r.width, height: r.height, shaded: r.shaded } }; },
    'export.film': async () => { const scene = [...scenes.values()].at(-1); if (!scene) throw new Error('先创建场景'); const film = filmForScene(scene); return { result: { film_id: film.id, shots: film.shots.length, duration: film.duration, player: '/film.html?id=' + scene.id } }; },
  };

  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url || '/', 'http://x');
    const p = u.pathname;
    try {
      // API
      if (p === '/api/health') return json(res, 200, { ok: true, provider: activeProvider.name, provider_error: providerError, image_provider: activeImageProvider.name, image_provider_error: imageProviderError, tasks: tasks.size, assets: assets.size, scenes: scenes.size });

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
      if (p === '/api/assets/search' && req.method === 'GET') {
        const q = Object.fromEntries(u.searchParams);
        if (q.q || q.category || q.tags) q.tags = q.tags ? q.tags.split(',') : undefined;
        return json(res, 200, { query: q, count: searchAssets(q).length, assets: searchAssets(q) });
      }
      if (p === '/api/assets/search' && req.method === 'GET') { const q2 = Object.fromEntries(u.searchParams); return json(res, 200, { query: q2, count: searchAssets(q2).length, assets: searchAssets(q2) }); }
      const aMatch = p.match(/^\/api\/assets\/([^\/]+)\/preview$/);
      if (aMatch && req.method === 'GET') {
        try {
          const a = assets.get(decodeURIComponent(aMatch[1]));
          if (!a) return json(res, 404, { error: '资产不存在' });
          const info = previewForAsset(a.id, Number(u.searchParams.get('w')) || 0, Number(u.searchParams.get('h')) || 0);
          const buf2 = fs.readFileSync(path.join(IMAGES_DIR, path.basename(info.url)));
          res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-cache', 'Content-Length': buf2.length });
          res.end(buf2); return;
        } catch (e) { return json(res, 500, { error: e.message }); }
      }
      if (p === '/api/system/units' && req.method === 'GET') return json(res, 200, getUnits());

      if (p === '/api/scenes' && req.method === 'POST') {
        const b = await readBody(req);
        const scene = await createScene(b.brief || DEFAULT_BRIEF, b.spec);
        return json(res, 200, scene);
      }
      if (p === '/api/scenes' && req.method === 'GET') return json(res, 200, { scenes: [...scenes.values()] });
      // 场景变更（世界画布编辑 → 持久化）
      const entRe = p.match(/^\/api\/scenes\/([^/]+)\/entities\/([^/]+)$/);
      const entColRe = p.match(/^\/api\/scenes\/([^/]+)\/entities$/);
      const envRe = p.match(/^\/api\/scenes\/([^/]+)\/environment$/);
      if (envRe && req.method === 'PATCH') {
        const scene = scenes.get(envRe[1]); if (!scene) return json(res, 404, { error: 'scene not found' });
        const b = await readBody(req);
        if (b.environment) scene.scene_graph.environment = { ...scene.scene_graph.environment, ...b.environment };
        if (Array.isArray(b.lights)) scene.scene_graph.lights = b.lights;
        persistScene(scene); return json(res, 200, scene);
      }
      if (entColRe && req.method === 'POST') {
        const scene = scenes.get(entColRe[1]); if (!scene) return json(res, 404, { error: 'scene not found' });
        const b = await readBody(req);
        const aid = b.asset_id;
        if (!aid || !assets.has(aid)) return json(res, 400, { error: '未知 asset_id: ' + aid });
        const n = scene.scene_graph.entities.length;
        const phScale = (b.physics ? applyPhysicsScale(b.physics, assetExtent(aid)) : null);
        const entity = { id: aid + '_e' + n, asset_id: aid,
          transform: { position: b.position || [((n % 4) * 3.2) - 4, 0, (Math.floor(n / 4) * 3.2) - 4], rotation: b.rotation || [0, 0, 0], scale: b.scale || phScale || [1, 1, 1] },
          semantic_role: b.role || assets.get(aid).category, placed_by: b.placed_by || 'user', locked: !!b.locked, animation: b.animation || null };
        scene.scene_graph.entities.push(entity);
        persistScene(scene); return json(res, 200, entity);
      }
      if (entRe && req.method === 'PATCH') {
        const scene = scenes.get(entRe[1]); if (!scene) return json(res, 404, { error: 'scene not found' });
        const ent = scene.scene_graph.entities.find(x => x.id === entRe[2]);
        if (!ent) return json(res, 404, { error: 'entity not found' });
        const b = await readBody(req);
        if (b.transform) ent.transform = { ...ent.transform, ...b.transform };
        if (b.semantic_role) ent.semantic_role = b.semantic_role;
        if (b.locked !== undefined) ent.locked = !!b.locked;
        if (b.animation !== undefined) ent.animation = b.animation;
        persistScene(scene); return json(res, 200, ent);
      }
      if (entRe && req.method === 'DELETE') {
        const scene = scenes.get(entRe[1]); if (!scene) return json(res, 404, { error: 'scene not found' });
        scene.scene_graph.entities = scene.scene_graph.entities.filter(x => x.id !== entRe[2]);
        persistScene(scene); return json(res, 200, { deleted: entRe[2] });
      }

      const sceneGetRe = p.match(/^\/api\/scenes\/([^/]+)$/);
      if (sceneGetRe && req.method === 'GET') {
        const sc = scenes.get(sceneGetRe[1]);
        return sc ? json(res, 200, sc) : json(res, 404, { error: 'scene not found' });
      }

      if (p === '/api/images/generate' && req.method === 'POST') {
        const b = await readBody(req);
        const buf = await generateImage(b.prompt || 'concept', b.size || '1024x1024');
        const name = 'concept_' + Date.now() + '.png';
        fs.writeFileSync(path.join(IMAGES_DIR, name), buf);
        return json(res, 200, { image_url: '/images/' + name, provider: activeImageProvider.name, prompt: b.prompt || 'concept' });
      }
      if (p === '/film.html' && req.method === 'GET') { const data = fs.readFileSync(FILM_HTML); res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(data); }
      if (p === '/film.mjs') { const data = fs.readFileSync(FILM_JS); res.writeHead(200, { 'Content-Type': 'application/javascript' }); return res.end(data); }
      if (p === '/renderer.mjs') { const data = fs.readFileSync(RENDERER_JS); res.writeHead(200, { 'Content-Type': 'application/javascript' }); return res.end(data); }
      const fixRe = p.match(/^\/api\/scenes\/([^/]+)\/autofix$/);
      if (fixRe && req.method === 'POST') {
        const sc = scenes.get(fixRe[1]);
        if (!sc) return json(res, 404, { error: '场景不存在' });
        const spec = parseBrief(sc.brief || '');
        const r = autofixScene(sc, { extentFor: assetExtent, spec, searchAssets });
        fs.writeFileSync(path.join(SCENES_DIR, sc.id + '.json'), JSON.stringify(sc, null, 2));
        return json(res, 200, { scene_id: sc.id, ...r });
      }
      const criticRe = p.match(/^\/api\/scenes\/([^/]+)\/critic$/);
      if (criticRe && (req.method === 'GET' || req.method === 'POST')) {
        const sc = scenes.get(criticRe[1]);
        if (!sc) return json(res, 404, { error: '场景不存在' });
        const spec = parseBrief(sc.brief || '');
        const rv = reviewScene(sc, { extentFor: assetExtent, spec }); return json(res, 200, { scene_id: sc.id, entities: sc.scene_graph.entities.length, clean: rv.issues.length === 0, ...rv });
      }
      const previewRe = p.match(/^\/api\/scenes\/([^/]+)\/preview$/);
      if (previewRe && req.method === 'GET') {
        const sc = scenes.get(previewRe[1]);
        if (!sc) return json(res, 404, { error: 'scene not found' });
        const pw = parseInt(u.searchParams.get('w') || '1024', 10) || 1024;
        const ph = parseInt(u.searchParams.get('h') || '576', 10) || 576;
        const info = previewForScene(sc, pw, ph);
        const buf = fs.readFileSync(path.join(IMAGES_DIR, path.basename(info.url)));
        res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': buf.length, 'Cache-Control': 'no-cache' });
        return res.end(buf);
      }
      const filmRe = p.match(/^\/api\/scenes\/([^/]+)\/film$/);
      if (filmRe && (req.method === 'GET' || req.method === 'POST')) {
        const scene = scenes.get(filmRe[1]); if (!scene) return json(res, 404, { error: 'scene not found' });
        return json(res, 200, filmForScene(scene));
      }
      if (p === '/api/agent/tools' && req.method === 'GET') return json(res, 200, { tools: TOOL_DEFS });
      if (p === '/api/agent/run' && req.method === 'POST') {
        const b = await readBody(req);
        let llm;
        try { llm = createLLM({ provider: b.provider || process.env.AGENT_PROVIDER || 'mock', baseUrl: process.env.LLM_BASE_URL, apiKey: b.apiKey || process.env.LLM_API_KEY, model: b.model || process.env.LLM_MODEL, brief: b.brief, plan: b.plan }); }
        catch (e) { return json(res, 400, { error: String(e && e.message || e) }); }
        const out = await runAgent({ brief: b.brief || DEFAULT_BRIEF, llm, dispatch });
        return json(res, 200, out);
      }

      // 世界画布页
      if (p === '/') { const data = fs.readFileSync(WORLD_HTML); res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(data); }
      if (p === '/world.mjs') { const data = fs.readFileSync(WORLD_JS); res.writeHead(200, { 'Content-Type': 'application/javascript' }); return res.end(data); }

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
<style>
html,body{margin:0;height:100%;background:#0b1020;color:#cfe;font-family:monospace;overflow:hidden}
#hud{position:fixed;top:8px;left:8px;font-size:12px;background:#0009;padding:8px 12px;border-radius:8px;z-index:10;max-width:44ch;line-height:1.5}
#hud .t{color:#5df}#hud .k{color:#f5a}
#panel{position:fixed;top:8px;right:8px;width:250px;background:#0009;border-radius:8px;z-index:10;padding:10px;font-size:12px;max-height:92vh;overflow:auto}
#panel h3{color:#5df;margin:4px 0 8px;font-size:13px}
#panel .row{margin-bottom:8px}
#panel label{color:#8af;display:inline-block;width:70px}
#panel input[type=text],#panel select{width:150px;background:#123;color:#cfe;border:1px solid #345;border-radius:4px;padding:3px 5px}
#panel input[type=color]{width:40px;height:22px;border:none;background:none;padding:0;vertical-align:middle}
#panel input[type=range]{width:120px;vertical-align:middle}
#lib{max-height:300px;overflow:auto;border-top:1px solid #345;margin-top:8px;padding-top:8px}
#lib .item{display:flex;justify-content:space-between;align-items:center;padding:3px 4px;border-radius:4px;cursor:pointer}
#lib .item:hover{background:#1a2a44}
#lib .item button{background:#0a5;border:none;color:#000;border-radius:4px;padding:2px 6px;cursor:pointer;font-size:11px}
#lib .item button:hover{background:#2c8}
#loading{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;color:#5df;z-index:20;font-size:15px}
#hint{position:fixed;bottom:8px;left:8px;font-size:11px;color:#678;z-index:10}
</style>
<script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js","three/addons/":"https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/"}}</script></head>
<body><div id="hud"></div><div id="panel"></div><div id="hint">拖拽实体移动 · 滚轮缩放 · 右键平移 · 面板可编辑环境并复用资产库</div><div id="loading">loading world…</div>
<script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const scene = new THREE.Scene();
scene.background = new THREE.Color('#0b1020');
scene.fog = new THREE.Fog('#0b1020', 25, 80);
const camera = new THREE.PerspectiveCamera(50, innerWidth/innerHeight, 0.1, 300); camera.position.set(7,7,10);
const renderer = new THREE.WebGLRenderer({antialias:true}); renderer.setSize(innerWidth,innerHeight); document.body.appendChild(renderer.domElement);
const controls = new OrbitControls(camera, renderer.domElement); controls.target.set(0,1,0);
const hemi = new THREE.HemisphereLight(0x8899ff,0x223,0.6); scene.add(hemi);
const dir = new THREE.DirectionalLight(0xff2a6d,1.2); dir.position.set(5,8,4); scene.add(dir);
scene.add(new THREE.GridHelper(40,40,0x2af,0x145));
const loader = new GLTFLoader();

let world = null, assetLib = [], entityMeshes = new Map(), assetCache = new Map(), dragging = null;
const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2();
const groundPlane = new THREE.Plane(new THREE.Vector3(0,1,0), 0);
const entityRoot = new THREE.Group(); scene.add(entityRoot);

function el(tag, attrs, parent){ const e=document.createElement(tag); if(attrs) for(const k in attrs){ if(k==='text') e.textContent=attrs[k]; else if(k==='on'){ for(const ev in attrs[k]) e.addEventListener(ev, attrs[k][ev]); } else e[k]=attrs[k]; } if(parent) parent.appendChild(e); return e; }

async function jget(u){ return (await fetch(u)).json(); }
async function jsend(u, method, body){ const r=await fetch(u,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined}); return {code:r.status, body: await r.json()}; }

async function loadSceneData(){
  const list = await jget('/api/scenes');
  if(list.scenes && list.scenes[0]) return list.scenes[0];
  const created = await jsend('/api/scenes','POST',{brief:'一座雨夜赛博朋克港口，起重机、集装箱堆场、巡逻机器人，蓝红霓虹'});
  return created.body;
}

async function getMesh(aid){
  if(assetCache.has(aid)) return assetCache.get(aid);
  const g = await new Promise((ok,err)=>loader.load('/assets/'+aid+'.glb',ok,undefined,err));
  assetCache.set(aid, g); return g;
}

function clearEntities(){ while(entityRoot.children.length) entityRoot.remove(entityRoot.children[0]); entityMeshes.clear(); }

async function renderWorld(){
  clearEntities();
  for(const e of world.scene_graph.entities){
    try{
      const g = await getMesh(e.asset_id);
      const m = g.scene.clone();
      m.position.set(...e.transform.position); m.rotation.set(...e.transform.rotation); m.scale.set(...e.transform.scale);
      m.userData.entityId = e.id; entityRoot.add(m); entityMeshes.set(e.id, m);
    }catch(_){}
  }
  applyEnvironment();
  updateHud();
}

function applyEnvironment(){
  const env = world.scene_graph.environment || {};
  if(env.sky){ scene.background.set(env.sky); scene.fog.color.set(env.sky); }
  if(env.fog !== undefined) scene.fog.near = 10, scene.fog.far = 30 + (1-env.fog)*80;
  const lights = world.scene_graph.lights || [];
  for(const L of lights){ if(L.type==='hemisphere') hemi.intensity = L.intensity ?? hemi.intensity, hemi.color.set(L.color||'#8899ff'); if(L.type==='directional') dir.intensity = L.intensity ?? dir.intensity, dir.color.set(L.color||'#ff2a6d'); }
}

function updateHud(){
  const ents = world.scene_graph.entities.length;
  document.getElementById('hud').innerHTML = '<div class="t">WorldForge AI · World Canvas</div>场景: <span class="k">'+world.name+'</span> · 风格 <span class="k">'+world.style+'</span> · 实体 <span class="k">'+ents+'</span><br>拖拽实体移动 · 面板编辑环境/资产';
}

function buildPanel(){
  const p = document.getElementById('panel'); p.innerHTML = '';
  el('h3', {text:'环境 / 光照'}, p);
  const env = world.scene_graph.environment || {};
  const row = el('div',{className:'row'},p);
  el('label',{text:'天空'},row);
  const sky = el('input',{type:'color', value: env.sky||'#0b1020'},row);
  sky.oninput = ()=>{ world.scene_graph.environment.sky = sky.value; scene.background.set(sky.value); scene.fog.color.set(sky.value); };
  sky.onchange = ()=> jsend('/api/scenes/'+world.id+'/environment','PATCH',{environment:{sky:sky.value}});
  const row2 = el('div',{className:'row'},p);
  el('label',{text:'雾量'},row2);
  const fog = el('input',{type:'range',min:'0',max:'1',step:'0.05', value: env.fog!==undefined?env.fog:0.6},row2);
  fog.oninput = ()=>{ scene.fog.far = 30 + (1-Number(fog.value))*80; };
  fog.onchange = ()=> jsend('/api/scenes/'+world.id+'/environment','PATCH',{environment:{fog:Number(fog.value)}});
  const row3 = el('div',{className:'row'},p);
  el('label',{text:'光强'},row3);
  const li = el('input',{type:'range',min:'0',max:'3',step:'0.1', value: dir.intensity},row3);
  li.oninput = ()=>{ dir.intensity = Number(li.value); };
  li.onchange = ()=> jsend('/api/scenes/'+world.id+'/environment','PATCH',{lights:[{type:'directional',color:'#ff2a6d',intensity:Number(li.value),position:[5,8,4]},{type:'hemisphere',color:'#8899ff',intensity:hemi.intensity,position:[0,10,0]}]});

  // 资产库复用
  el('h3',{text:'资产库（复用）'},p);
  const search = el('input',{type:'text',placeholder:'搜索类别/标签…'},p); search.style.width='100%'; search.style.boxSizing='border-box';
  const lib = el('div',{id:'lib'},p);
  function renderLib(q){
    lib.innerHTML='';
    const items = assetLib.filter(a=>!q || (a.category+' '+(a.semantic_tags||[]).join(' ')).toLowerCase().includes(q.toLowerCase()));
    for(const a of items){
      const rowE = el('div',{className:'item'},lib);
      el('span',{text:a.category+'  ×'+((a.mesh_stats&&a.mesh_stats.faces)||0)},rowE);
      const b = el('button',{text:'放置'},rowE);
      b.onclick = async ()=>{ const r = await jsend('/api/scenes/'+world.id+'/entities','POST',{asset_id:a.id, role:a.category}); if(r.code===200){ world.scene_graph.entities.push(r.body); await renderWorld(); } };
    }
  }
  search.oninput = ()=> renderLib(search.value);
  renderLib('');
}

async function boot(){
  world = await loadSceneData();
  assetLib = (await jget('/api/assets')).assets || [];
  document.getElementById('loading').style.display='none';
  await renderWorld();
  buildPanel();
}

// 拖拽移动
renderer.domElement.addEventListener('pointerdown', (e)=>{ if(e.button!==0) return; pointer.set((e.clientX/innerWidth)*2-1, -(e.clientY/innerHeight)*2+1); raycaster.setFromCamera(pointer,camera); const hits=raycaster.intersectObjects(entityRoot.children,true); if(hits.length){ let o=hits[0].object; while(o && !entityMeshes.has(Object.keys(entityMeshes).find(k=>entityMeshes.get(k)===o))){ o=o.parent; if(o===entityRoot) break; } if(o && o!==entityRoot){ const eid=Object.keys(entityMeshes).find(k=>entityMeshes.get(k)===o)||Object.keys(entityMeshes).find(k=>entityMeshes.get(k)===hits[0].object); const mesh = entityMeshes.get(eid) || hits[0].object; dragging={eid, mesh, ent: world.scene_graph.entities.find(x=>x.id===eid)}; controls.enabled=false; } } });
addEventListener('pointermove', (e)=>{ if(!dragging) return; pointer.set((e.clientX/innerWidth)*2-1, -(e.clientY/innerHeight)*2+1); raycaster.setFromCamera(pointer,camera); const hit=new THREE.Vector3(); if(raycaster.ray.intersectPlane(groundPlane,hit)){ dragging.mesh.position.set(hit.x, 0, hit.z); dragging.ent.transform.position=[hit.x,0,hit.z]; } });
addEventListener('pointerup', async ()=>{ if(!dragging) return; const d=dragging; dragging=null; controls.enabled=true; if(d.ent) await jsend('/api/scenes/'+world.id+'/entities/'+d.ent.id,'PATCH',{transform:{position:d.ent.transform.position}}); });

boot();
addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});
(function loop(){ requestAnimationFrame(loop); controls.update(); renderer.render(scene,camera); })();
</script></body></html>`;
}

function filmHtml(){ return `<!doctype html><html><head><meta charset="utf-8"><title>WorldForge — Film Player</title>
<style>
html,body{margin:0;height:100%;background:#05070f;color:#cfe;font-family:monospace;overflow:hidden}
#hud{position:fixed;top:8px;left:8px;font-size:12px;background:#0009;padding:8px 12px;border-radius:8px;z-index:10;line-height:1.5}
#hud .t{color:#5df}#hud .k{color:#f5a}
#bar{position:fixed;bottom:0;left:0;right:0;height:64px;background:#000c;z-index:10;display:flex;align-items:center;gap:10px;padding:0 14px;font-size:13px}
#bar button{background:#1a2a44;color:#cfe;border:1px solid #345;border-radius:6px;padding:6px 12px;cursor:pointer;font-size:13px}
#bar button:hover{background:#2a3a54}
#bar button.rec{background:#a22;border-color:#c55}
#bar button.rec.on{background:#f33;animation:blink 1s infinite}
@keyframes blink{50%{opacity:.4}}
#prog{flex:1;height:6px;background:#123;border-radius:3px;overflow:hidden}
#prog i{display:block;height:100%;background:#5df;width:0}
#time{color:#8af;min-width:120px}
#dl{color:#5df;text-decoration:none}
#loading{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;color:#5df;z-index:20;font-size:15px}
</style>
<script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js","three/addons/":"https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/"}}</script></head>
<body><div id="hud"></div><div id="bar"><button id="play">播放</button><button id="rec" class="rec">● 录制</button><div id="prog"><i></i></div><span id="time">0.0s / 0.0s</span><a id="dl" download="worldforge_film.webm">下载成片</a></div><div id="loading">loading film…</div>
<script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const q = new URLSearchParams(location.search); const sceneId = q.get('id') || '';
const scene = new THREE.Scene(); scene.background = new THREE.Color('#05070f'); scene.fog = new THREE.Fog('#05070f', 20, 90);
const camera = new THREE.PerspectiveCamera(45, innerWidth/innerHeight, 0.1, 300);
const renderer = new THREE.WebGLRenderer({antialias:true, preserveDrawingBuffer:true}); renderer.setSize(innerWidth,innerHeight); renderer.setPixelRatio(1); document.body.appendChild(renderer.domElement);
scene.add(new THREE.HemisphereLight(0x8899ff,0x223,0.6));
const dir=new THREE.DirectionalLight(0xff2a6d,1.2); dir.position.set(5,8,4); scene.add(dir);
scene.add(new THREE.GridHelper(40,40,0x2af,0x145));
const loader = new GLTFLoader();

let world=null, film=null, assetCache=new Map(), curShot=-1, shotStartCam=new THREE.Vector3();
let playing=false, tGlobal=0, lastT=performance.now();
const state = { recording:false, rec:null, chunks:[] };

function el(tag, attrs, parent){ const e=document.createElement(tag); if(attrs) for(const k in attrs){ if(k==='text') e.textContent=attrs[k]; else if(k==='on'){ for(const ev in attrs[k]) e.addEventListener(ev, attrs[k][ev]); } else e[k]=attrs[k]; } if(parent) parent.appendChild(e); return e; }
async function jget(u){ return (await fetch(u)).json(); }

async function getMesh(aid){ if(assetCache.has(aid)) return assetCache.get(aid); const g = await new Promise((ok,err)=>loader.load('/assets/'+aid+'.glb',ok,undefined,err)); assetCache.set(aid,g); return g; }

async function boot(){
  world = await jget('/api/scenes/'+sceneId);
  film = await jget('/api/scenes/'+sceneId+'/film');
  document.getElementById('loading').style.display='none';
  const env = (world.scene_graph.environment||{});
  if(env.sky){ scene.background.set(env.sky); scene.fog.color.set(env.sky); }
  const lights = world.scene_graph.lights||[];
  for(const L of lights){ if(L.type==='hemisphere'){ scene.children[0].color.set(L.color||'#8899ff'); scene.children[0].intensity=L.intensity||0.6; } if(L.type==='directional'){ dir.color.set(L.color||'#ff2a6d'); dir.intensity=L.intensity||1.2; } }
  for(const e of world.scene_graph.entities){ try{ const m=(await getMesh(e.asset_id)).scene.clone(); m.position.set(...e.transform.position); m.rotation.set(...e.transform.rotation); m.scale.set(...e.transform.scale); scene.add(m); }catch(_){} }
  const hud = document.getElementById('hud');
  hud.innerHTML = '<div class="t">WorldForge AI · 成片</div>场景 <span class="k">'+world.name+'</span> · 镜头 <span class="k">'+film.shots.length+'</span> · 时长 <span class="k">'+film.duration.toFixed(1)+'s</span><br>'+film.shots.map(s=>s.name).join(' → ');
}

function updateCamera(){
  let acc=0, shot=film.shots[0], st=0, idx=0;
  for(let i=0;i<film.shots.length;i++){ if(tGlobal < acc+film.shots[i].duration){ shot=film.shots[i]; st=tGlobal-acc; idx=i; break; } acc+=film.shots[i].duration; }
  if(idx!==curShot){ curShot=idx; shotStartCam.copy(camera.position); }
  const pos=shot.camera.position, tgt=shot.camera.target, lead=0.8;
  let camPos;
  if(shot.move && shot.move.type==='orbit'){ const ang=st*(shot.move.speed||0.4); const r=Math.hypot(pos[0],pos[2]); camPos=new THREE.Vector3(Math.cos(ang)*r,pos[1],Math.sin(ang)*r); }
  else { camPos=new THREE.Vector3().lerpVectors(shotStartCam, new THREE.Vector3(pos[0],pos[1],pos[2]), Math.min(st/lead,1)); }
  camera.position.copy(camPos); camera.lookAt(tgt[0],tgt[1],tgt[2]);
  document.getElementById('hud').lastChild.textContent = '';
}

function tick(now){
  const dt=(now-lastT)/1000; lastT=now;
  if(playing){ tGlobal+=dt; if(tGlobal>film.duration){ tGlobal=film.duration; playing=false; document.getElementById('play').textContent='重播'; } }
  updateCamera();
  renderer.render(scene,camera);
  document.getElementById('prog').firstElementChild.style.width = (tGlobal/film.duration*100)+'%';
  document.getElementById('time').textContent = tGlobal.toFixed(1)+'s / '+film.duration.toFixed(1)+'s';
  requestAnimationFrame(tick);
}

document.getElementById('play').addEventListener('click', function(){ if(tGlobal>=film.duration){ tGlobal=0; curShot=-1; } playing=!playing; this.textContent = playing?'暂停':'播放'; lastT=performance.now(); });
const recBtn=document.getElementById('rec');
recBtn.addEventListener('click', function(){
  if(!state.recording){ state.chunks=[]; const stream=renderer.domElement.captureStream(30); state.rec=new MediaRecorder(stream,{mimeType:'video/webm'}); state.rec.ondataavailable=e=>{ if(e.data.size) state.chunks.push(e.data); }; state.rec.onstop=()=>{ const blob=new Blob(state.chunks,{type:'video/webm'}); document.getElementById('dl').href=URL.createObjectURL(blob); }; state.rec.start(); state.recording=true; this.classList.add('on'); this.textContent='■ 停止'; tGlobal=0; curShot=-1; playing=true; document.getElementById('play').textContent='暂停'; lastT=performance.now(); }
  else { state.rec.stop(); state.recording=false; this.classList.remove('on'); this.textContent='● 录制'; playing=false; }
});

boot();
addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});
requestAnimationFrame(tick);
</script></body></html>`;
}


// 直接运行
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 4321);
  createApp().listen(port, () => console.log('WorldForge MVP API → http://localhost:' + port + '  (world canvas: /)'));
}
