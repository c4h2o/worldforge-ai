// WorldForge AI 自研重建引擎（自托管 HTTP 服务，零依赖）
// 输入概念图 → 异步任务 → 语义感知贴图 GLB。Provider 端点：POST /infer、/infer-multiview、GET /tasks/:id。
// 部署：LOCAL_RECON_ENDPOINT=http://localhost:8080 指向本服务；IMG3D_PROVIDER=local 即启用。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTexturedGLB } from './glb.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', '..', '..', 'output', 'recon');
fs.mkdirSync(OUT, { recursive: true });

const tasks = new Map(); let seq = 0;

function pngSize(b) {
  if (b.readUInt32BE(0) !== 0x89504E47) throw new Error('输入非 PNG 图像');
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}
async function loadImage(src) {
  if (/^https?:/i.test(src)) { const r = await fetch(src); if (!r.ok) throw new Error('取图 ' + r.status); return Buffer.from(await r.arrayBuffer()); }
  if (src.startsWith('data:image/png;base64,')) return Buffer.from(src.split(',')[1], 'base64');
  return fs.readFileSync(src); // 本地绝对路径
}
function enqueue(payload, host) {
  const id = 'recon_' + (++seq);
  const task = { task_id: id, status: 'queued', progress: 0, payload, host };
  tasks.set(id, task);
  (async () => {
    try {
      task.status = 'running'; task.progress = 15;
      const img = await loadImage(payload.images[0]); task.progress = 40;
      const { w, h } = pngSize(img);
      const name = 'recon_' + id + '.glb';
      const glb = buildTexturedGLB(payload.category || 'default', img, w, h, name);
      fs.writeFileSync(path.join(OUT, name), glb); task.progress = 85;
      task.output = { model_url: 'http://' + host + '/recon/models/' + name, width: w, height: h, category: payload.category || 'default' };
      task.status = 'success'; task.progress = 100;
    } catch (e) { task.status = 'failed'; task.error = String(e && e.message || e); }
  })();
  return task;
}

export function createApp() {
  return http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    const json = (code, o) => { const b = Buffer.from(JSON.stringify(o)); res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(b); };
    const readBody = () => new Promise((resolve) => { let d = ''; req.on('data', c => d += c); req.on('end', () => { try { resolve(JSON.parse(d || '{}')); } catch { resolve({}); } }); });
    try {
      if (u.pathname === '/api/health') return json(200, { ok: true, engine: 'local', tasks: tasks.size });
      if (u.pathname === '/infer' && req.method === 'POST') { const b = await readBody(); const t = enqueue(b, req.headers.host); return json(200, { task_id: t.task_id, status: t.status }); }
      if (u.pathname === '/infer-multiview' && req.method === 'POST') { const b = await readBody(); const t = enqueue(b, req.headers.host); return json(200, { task_id: t.task_id, status: t.status }); }
      if (u.pathname.startsWith('/tasks/')) { const id = u.pathname.slice(7); const t = tasks.get(id); return t ? json(200, t) : json(404, { error: 'task not found' }); }
      if (u.pathname.startsWith('/recon/models/')) {
        const f = path.basename(u.pathname); const p = path.join(OUT, f);
        if (!fs.existsSync(p)) return json(404, { error: 'model not found' });
        res.writeHead(200, { 'Content-Type': 'model/gltf-binary' }); res.end(fs.readFileSync(p)); return;
      }
      return json(404, { error: 'not found' });
    } catch (e) { return json(500, { error: String(e && e.message || e) }); }
  });
}

const direct = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (direct) { const port = Number(process.env.PORT || 8080); createApp().listen(port, () => console.log('[recon] 自研重建引擎 http://localhost:' + port + '  (输出 ' + OUT + ')')); }
