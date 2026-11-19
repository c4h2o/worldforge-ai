// 多视图 → 3D 体素雕刻重建（零依赖：node:zlib 解码 PNG）
// 输入：一张多视图正交参考图（front/top/side），输出：单 mesh 多材质 GLB。
import zlib from 'node:zlib';

export function decodePNG(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let off = 8, w = 0, h = 0, bd = 0, ct = 0, idat = [];
  while (off < buf.length) {
    const len = dv.getUint32(off); const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { w = dv.getUint32(off + 8); h = dv.getUint32(off + 12); bd = data[8]; ct = data[9]; }
    else if (type === 'IDAT') idat.push(Buffer.from(data));
    off += 12 + len; if (type === 'IEND') break;
  }
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ct];
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = ch * (bd / 8), stride = w * bpp;
  const out = Buffer.alloc(w * h * 4); let prev = Buffer.alloc(stride);
  const pae = (a, b, c) => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]; const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const cur = Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0, b = prev[x], c = x >= bpp ? prev[x - bpp] : 0; let v = line[x];
      if (f === 1) v = (v + a) & 255; else if (f === 2) v = (v + b) & 255; else if (f === 3) v = (v + ((a + b) >> 1)) & 255; else if (f === 4) v = (v + pae(a, b, c)) & 255;
      cur[x] = v;
    }
    for (let x = 0; x < w; x++) { const i = x * bpp; let r, g, bl, al = 255;
      if (ct === 2) { r = cur[i]; g = cur[i + 1]; bl = cur[i + 2]; } else if (ct === 6) { r = cur[i]; g = cur[i + 1]; bl = cur[i + 2]; al = cur[i + 3]; }
      else if (ct === 0 || ct === 4) { r = g = bl = cur[i]; if (ct === 4) al = cur[i + 1]; } else { r = g = bl = cur[i]; }
      const o = (y * w + x) * 4; out[o] = r; out[o + 1] = g; out[o + 2] = bl; out[o + 3] = al;
    }
    prev = cur;
  }
  return { w, h, rgba: out };
}

// 用行/列投影找内容带，再按格取内容包围盒（自动跳过中文标签等小带）
export function segmentViews(img) {
  const { w, h, rgba } = img;
  const content = (x, y) => { const o = (y * w + x) * 4; const r = rgba[o], g = rgba[o + 1], b = rgba[o + 2], a = rgba[o + 3]; return a > 10 && !(r > 245 && g > 245 && b > 245); };
  const col = new Uint8Array(w), row = new Uint8Array(h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (content(x, y)) { col[x] = 1; row[y] = 1; }
  const bands = (arr) => { const out = []; let s = -1; for (let i = 0; i < arr.length; i++) { if (arr[i] && s < 0) s = i; if (!arr[i] && s >= 0) { out.push([s, i - 1]); s = -1; } } if (s >= 0) out.push([s, arr.length - 1]); return out; };
  const rb = bands(row).filter(([a, b]) => b - a > 40), cb = bands(col).filter(([a, b]) => b - a > 40);
  const cells = [];
  for (const [y0, y1] of rb) for (const [x0, x1] of cb) {
    let minX = 1e9, minY = 1e9, maxX = -1, maxY = -1, cnt = 0;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (content(x, y)) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; cnt++; }
    if (cnt > 2000) cells.push({ bbox: [minX, minY, maxX, maxY] });
  }
  return cells;
}


// 依据内容包围盒位置，按行/列聚类，选出 主视图(左上)/右视图(右上)/俯视图(中右)
export function pickViews(cells) {
  const pts = cells.map(c => { const [x0, y0, x1, y1] = c.bbox; return { ...c, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 }; });
  const cluster = (arr, key, tol) => { const out = []; const s = [...arr].sort((a, b) => a[key] - b[key]); for (const p of s) { const g = out[out.length - 1]; if (g && Math.abs(p[key] - g.center) < tol) { g.members.push(p); g.center = (g.center * (g.members.length - 1) + p[key]) / g.members.length; } else out.push({ center: p[key], members: [p] }); } return out.sort((a, b) => a.center - b.center); };
  const rows = cluster(pts, 'cy', 40), cols = cluster(pts, 'cx', 40);
  const cell = (r, c) => rows[r] && cols[c] && rows[r].members.find(m => Math.abs(m.cx - cols[c].center) < 40);
  const front = cell(0, 0)?.bbox, side = cell(0, cols.length - 1)?.bbox;
  let top = cell(1, cols.length - 1)?.bbox;   // 俯视图常在中排右侧
  if (!top) top = cell(1, 0)?.bbox;           // 或中排左侧
  return { front, side, top };
}

const FACES = [
  { n: [1, 0, 0], c: [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]] },
  { n: [-1, 0, 0], c: [[-1, -1, 1], [-1, 1, 1], [-1, 1, -1], [-1, -1, -1]] },
  { n: [0, 1, 0], c: [[-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1]] },
  { n: [0, -1, 0], c: [[-1, -1, 1], [-1, -1, -1], [1, -1, -1], [1, -1, 1]] },
  { n: [0, 0, 1], c: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]] },
  { n: [0, 0, -1], c: [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]] },
];
function boxGeo(bs) {
  const pos = [], nor = [], idx = []; let base = 0;
  for (const b of bs) { const [cx, cy, cz] = b.center, [sx, sy, sz] = b.size;
    for (const f of FACES) { for (const c of f.c) { pos.push(cx + c[0] * sx / 2, cy + c[1] * sy / 2, cz + c[2] * sz / 2); nor.push(f.n[0], f.n[1], f.n[2]); } idx.push(base, base + 1, base + 2, base, base + 2, base + 3); base += 4; } }
  return { pos: new Float32Array(pos), nor: new Float32Array(nor), idx: new Uint32Array(idx) };
}
function buildGLB(groups, name) {
  const geos = groups.map(g => boxGeo(g.boxes));
  const pbSum = geos.reduce((s, g) => s + g.pos.byteLength, 0), nbSum = geos.reduce((s, g) => s + g.nor.byteLength, 0), ibSum = geos.reduce((s, g) => s + g.idx.byteLength, 0);
  const bin = Buffer.alloc(pbSum + nbSum + ibSum); let po = 0, no = pbSum, io = pbSum + nbSum;
  const bufferViews = [], accessors = [], prims = []; let gi = 0;
  for (const g of geos) {
    Buffer.from(g.pos.buffer).copy(bin, po); Buffer.from(g.nor.buffer).copy(bin, no); Buffer.from(g.idx.buffer).copy(bin, io);
    let mn = [1 / 0, 1 / 0, 1 / 0], mx = [-1 / 0, -1 / 0, -1 / 0];
    for (let i = 0; i < g.pos.length; i += 3) for (let k = 0; k < 3; k++) { const vv = g.pos[i + k]; if (vv < mn[k]) mn[k] = vv; if (vv > mx[k]) mx[k] = vv; }
    bufferViews.push({ buffer: 0, byteOffset: po, byteLength: g.pos.byteLength, target: 34962 }, { buffer: 0, byteOffset: no, byteLength: g.nor.byteLength, target: 34962 }, { buffer: 0, byteOffset: io, byteLength: g.idx.byteLength, target: 34963 });
    accessors.push({ bufferView: gi * 3, componentType: 5126, count: g.pos.length / 3, type: 'VEC3', min: mn, max: mx }, { bufferView: gi * 3 + 1, componentType: 5126, count: g.nor.length / 3, type: 'VEC3' }, { bufferView: gi * 3 + 2, componentType: 5125, count: g.idx.length, type: 'SCALAR' });
    prims.push({ attributes: { POSITION: gi * 3, NORMAL: gi * 3 + 1 }, indices: gi * 3 + 2, material: gi }); gi++;
    po += g.pos.byteLength; no += g.nor.byteLength; io += g.idx.byteLength;
  }
  const gltf = { asset: { version: '2.0', generator: 'worldforge-voxel' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name }],
    meshes: [{ name, primitives: prims }],
    materials: groups.map((g, n) => ({ name: name + '-m' + n, pbrMetallicRoughness: { baseColorFactor: [...g.color, 1], metallicFactor: 0.0, roughnessFactor: 0.62 } })),
    buffers: [{ byteLength: bin.length }], bufferViews, accessors };
  const jb = Buffer.from(JSON.stringify(gltf), 'utf8'); const jp = (4 - (jb.length % 4)) % 4, jc = Buffer.concat([jb, Buffer.alloc(jp, 0x20)]);
  const bp = (4 - (bin.length % 4)) % 4, bc = Buffer.concat([bin, Buffer.alloc(bp)]);
  const total = 12 + 8 + jc.length + 8 + bc.length; const hd = Buffer.alloc(12); hd.writeUInt32LE(0x46546C67, 0); hd.writeUInt32LE(2, 4); hd.writeUInt32LE(total, 8);
  const jh = Buffer.alloc(8); jh.writeUInt32LE(jc.length, 0); jh.writeUInt32LE(0x4E4F534A, 4); const bh = Buffer.alloc(8); bh.writeUInt32LE(bc.length, 0); bh.writeUInt32LE(0x004E4942, 4);
  return Buffer.concat([hd, jh, jc, bh, bc]);
}

// 三向轮廓求交的体素雕刻。views:{front:[x0,y0,x1,y1],top:[...],side:[...]}
export function carveVisualHull(img, views, opts = {}) {
  const { w, h, rgba } = img;
  const pix = (x, y) => { x = Math.round(x); y = Math.round(y); if (x < 0 || y < 0 || x >= w || y >= h) return [255, 255, 255, 0]; const o = (y * w + x) * 4; return [rgba[o], rgba[o + 1], rgba[o + 2], rgba[o + 3]]; };
  const content = (x, y) => { const [r, g, b, a] = pix(x, y); return a > 10 && !(r > 245 && g > 245 && b > 245); };
  const F = views.front, T = views.top, S = views.side;
  const front = (nx, ny) => content(F[0] + nx * (F[2] - F[0]), F[3] - ny * (F[3] - F[1]));
  const side = (nz, ny) => content(S[0] + nz * (S[2] - S[0]), S[3] - ny * (S[3] - S[1]));
  const top = (nx, nz) => content(T[0] + nx * (T[2] - T[0]), T[1] + nz * (T[3] - T[1]));
  const frontColor = (nx, ny) => pix(F[0] + nx * (F[2] - F[0]), F[3] - ny * (F[3] - F[1]));
  const W = opts.W || 0.52, H = opts.H || 0.86, D = opts.D || 0.55, NY = opts.res || 64;
  const v = H / NY, NX = Math.round(W / v), NZ = Math.round(D / v);
  const occ = new Uint8Array(NX * NY * NZ);
  for (let ix = 0; ix < NX; ix++) for (let iy = 0; iy < NY; iy++) for (let iz = 0; iz < NZ; iz++) {
    const nx = (ix + 0.5) / NX, ny = (iy + 0.5) / NY, nz = (iz + 0.5) / NZ;
    if (front(nx, ny) && side(nz, ny) && top(nx, nz)) occ[(iy * NZ + iz) * NX + ix] = 1;
  }
  const runs = [];
  for (let iy = 0; iy < NY; iy++) for (let iz = 0; iz < NZ; iz++) { let s = -1; for (let ix = 0; ix <= NX; ix++) { const o = ix < NX && occ[(iy * NZ + iz) * NX + ix]; if (o && s < 0) s = ix; if (!o && s >= 0) { runs.push({ x0: s, x1: ix - 1, iy, iz }); s = -1; } } }
  runs.sort((a, b) => a.iy - b.iy || a.iz - b.iz || a.x0 - b.x0);
  const merged = [];
  for (const r of runs) { const last = merged[merged.length - 1]; if (last && last.x0 === r.x0 && last.x1 === r.x1 && last.iz === r.iz && last.iy + last.ly === r.iy) last.ly++; else merged.push({ x0: r.x0, x1: r.x1, iy: r.iy, ly: 1, iz: r.iz }); }
  const boxArr = (m) => m.map(b => ({ center: [+(((b.x0 + b.x1 + 1) / 2 - NX / 2) * v).toFixed(4), +(((b.iy + b.ly / 2) - NY / 2) * v).toFixed(4), +(((b.iz + 0.5) - NZ / 2) * v).toFixed(4)], size: [+(b.x1 - b.x0 + 1) * v, +b.ly * v, +v] }));
  const red = [], dark = [];
  for (const b of merged) { const nx = ((b.x0 + b.x1 + 1) / 2) / NX, ny = ((b.iy + b.ly / 2)) / NY; const [cr, cg, cb] = frontColor(nx, ny); (cr > cg * 1.2 && cr > cb * 1.2 ? red : dark).push(b); }
  const avg = (list) => { let r = 0, g = 0, bl = 0, n = 0; for (const b of list) { const nx = ((b.x0 + b.x1 + 1) / 2) / NX, ny = ((b.iy + b.ly / 2)) / NY; const [cr, cg, cb] = frontColor(nx, ny); if (!(cr > 245 && cg > 245 && cb > 245)) { r += cr; g += cg; bl += cb; n++; } } return n ? [r / n / 255, g / n / 255, bl / n / 255] : [0.4, 0.15, 0.14]; };
  return { glb: buildGLB([{ color: avg(red), boxes: boxArr(red) }, { color: [0.14, 0.14, 0.14], boxes: boxArr(dark) }], opts.name || 'voxel_model'), stats: { voxels: merged.length, faces: merged.length * 12, dims: [W, H, D] } };
}
