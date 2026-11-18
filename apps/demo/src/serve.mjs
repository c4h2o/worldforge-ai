// WorldForge AI — 轻量静态服务器（node 内置，零依赖）。预览 output/
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const out = path.join(process.cwd(), 'output');
const port = process.env.PORT || 8000;
const MIME = { '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript', '.json':'application/json', '.glb':'model/gltf-binary', '.png':'image/png', '.css':'text/css' };

http.createServer((req, res) => {
  let p = decodeURIComponent((req.url||'/').split('?')[0]);
  if (p === '/') p = '/world-preview.html';
  const file = path.normalize(path.join(out, p));
  if (!file.startsWith(out)) { res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found: ' + p); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(port, () => console.log('WorldForge preview → http://localhost:' + port + '/world-preview.html'));
