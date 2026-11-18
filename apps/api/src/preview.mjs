// WorldForge AI — 场景预览渲染器（零依赖软光栅器：GLB → PNG）。
// 用途：为 AI 视觉复查/批评器提供世界画布缩略图（无需浏览器/WebGL）。
// 零外部依赖：仅 node:fs / node:path / node:zlib（Node 内置）。
import fs from 'node:fs';
import path from 'node:path';
import { deflateSync, inflateSync } from 'node:zlib';

// ── PNG 编码 ─────────────────────────────────────
let CRC_TABLE = null;
function crcTable() {
  if (CRC_TABLE) return CRC_TABLE;
  CRC_TABLE = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    CRC_TABLE[n] = c;
  }
  return CRC_TABLE;
}
function crc32(buf) {
  const t = crcTable(); let c = -1;
  for (let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const body = Buffer.concat([t, data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
// rgba: Uint8Array(W*H*4)，每行前置 filter 字节 0
export function pngEncode(W, H, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const rows = Buffer.alloc((W * 4 + 1) * H);
  for (let y = 0; y < H; y++) { rows[y * (W * 4 + 1)] = 0; Buffer.from(rgba.buffer, rgba.byteOffset + y * W * 4, W * 4).copy(rows, y * (W * 4 + 1) + 1); }
  return Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', deflateSync(rows, { level: 6 })), pngChunk('IEND', Buffer.alloc(0))]);
}


// ── PNG 解码（纹理用；支持 8-bit 灰度/RGB/RGBA/调色板 + 16-bit 高字节）──
export function pngDecode(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (dv.getUint32(0) !== 0x89504e47) return null;
  let off = 8, w = 0, h = 0, bd = 0, ct = 0, interlace = 0;
  const idat = [], plte = [], trns = [];
  while (off + 8 <= buf.byteLength) {
    const len = dv.getUint32(off), type = String.fromCharCode(buf[off+4], buf[off+5], buf[off+6], buf[off+7]);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      w = dv.getUint32(off + 8); h = dv.getUint32(off + 12);
      bd = buf[off + 16]; ct = buf[off + 17]; interlace = buf[off + 20];
    } else if (type === 'PLTE') { plte.set(data); }
    else if (type === 'tRNS') { trns.set(data); }
    else if (type === 'IDAT') { idat.push(Buffer.from(data)); }
    off += 12 + len;
  }
  if (!w || !h || interlace !== 0) return null;
  const raw = inflateSync(Buffer.concat(idat));
  const ch = ct === 0 ? 1 : ct === 2 ? 3 : ct === 3 ? 1 : ct === 4 ? 2 : 4;
  const bpp = Math.max(1, Math.ceil(ch * bd / 8)), stride = w * bpp;
  const out = Buffer.alloc(w * h * 4);
  const pal = [];
  for (let i = 0; i + 3 < plte.length; i += 3) pal.push([plte[i], plte[i+1], plte[i+2]]);
  const prev = Buffer.alloc(stride);
  let pos = 0;
  for (let y = 0; y < h; y++) {
    const ft = raw[pos++]; const cur = Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0, b = prev[x], c = x >= bpp ? prev[x - bpp] : 0;
      let v = raw[pos++];
      if (ft === 1) v = (v + a) & 0xff;
      else if (ft === 2) v = (v + b) & 0xff;
      else if (ft === 3) v = (v + ((a + b) >> 1)) & 0xff;
      else if (ft === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
      }
      cur[x] = v;
    }
    for (let x = 0; x < w; x++) {
      const i = (y * w + x);
      let r = 255, g = 255, b2 = 255, al = 255;
      if (ct === 3) {
        const pi = cur[x * bpp], px = pi * 3;
        r = pal[pi][0]; g = pal[pi][1]; b2 = pal[pi][2];
        al = pi < trns.length / 2 ? trns[pi * 2 + 1] : 255;
      } else if (bd === 16) {
        const px = x * bpp;
        r = cur[px]; g = ct >= 2 ? cur[px + 2] : cur[px]; b2 = ct >= 2 ? cur[px + 4] : cur[px];
        if (ct === 4) al = cur[px + 2]; else if (ct === 6) al = cur[px + 6];
      } else if (ct === 0) {
        r = g = b2 = cur[x];
        if (ct === 4) {}
      } else if (ct === 4) {
        const px = x * 2; r = g = b2 = cur[px]; al = cur[px + 1];
      } else if (ct === 2) {
        const px = x * 3; r = cur[px]; g = cur[px + 1]; b2 = cur[px + 2];
      } else if (ct === 6) {
        const px = x * 4; r = cur[px]; g = cur[px + 1]; b2 = cur[px + 2]; al = cur[px + 3];
      }
      const o = i * 4;
      out[o] = r; out[o+1] = g; out[o+2] = b2; out[o+3] = al;
    }
    cur.copy(prev);
  }
  return { w, h, data: out };
}

// ── 线性代数 ──────────────────────────────────────
function ident(){return [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];}
function matmul(a,b){const o=new Array(16);for(let c=0;c<4;c++)for(let r=0;r<4;r++){let s=0;for(let k=0;k<4;k++)s+=a[k*4+r]*b[c*4+k];o[c*4+r]=s;}return o;}
function persp(fovy,aspect,near,far){const t=1/Math.tan(fovy/2),n=1/(near-far);return [t/aspect,0,0,0, 0,t,0,0, 0,0,(near+far)*n,-1, 0,0,2*near*far*n,0];}
function lookAt(eye,c,up){
  // OpenGL 标准：z 轴 = normalize(eye - target)，x = up × z，y = z × x；世界前方 → 视图 -z
  let z=[eye[0]-c[0],eye[1]-c[1],eye[2]-c[2]],zl=Math.hypot(...z);z=z.map(v=>v/zl);
  let x=[up[1]*z[2]-up[2]*z[1],up[2]*z[0]-up[0]*z[2],up[0]*z[1]-up[1]*z[0]],xl=Math.hypot(...x);
  if(xl<1e-6){x=[1,0,0];xl=1;} x=x.map(v=>v/xl);
  const y=[z[1]*x[2]-z[2]*x[1],z[2]*x[0]-z[0]*x[2],z[0]*x[1]-z[1]*x[0]];
  return [x[0],y[0],z[0],0, x[1],y[1],z[1],0, x[2],y[2],z[2],0,
    -(x[0]*eye[0]+x[1]*eye[1]+x[2]*eye[2]), -(y[0]*eye[0]+y[1]*eye[1]+y[2]*eye[2]), -(z[0]*eye[0]+z[1]*eye[1]+z[2]*eye[2]), 1];
}
function trs(t,r,s){
  const cy=Math.cos(r[1]),sy=Math.sin(r[1]),cx=Math.cos(r[0]),sx=Math.sin(r[0]),cz=Math.cos(r[2]),sz=Math.sin(r[2]);
  const rx=[1,0,0,0,0,cx,sx,0,0,-sx,cx,0,0,0,0,1],ry=[cy,0,-sy,0,0,1,0,0,sy,0,cy,0,0,0,0,1],rz=[cz,sz,0,0,-sz,cz,0,0,0,0,1,0,0,0,1];
  const m=matmul(matmul(rx,ry),rz);
  for(let c=0;c<3;c++)for(let r=0;r<3;r++)m[c*4+r]*=s[c];
  m[12]=t[0];m[13]=t[1];m[14]=t[2];return m;
}
const norm = v => { const l = Math.hypot(v[0],v[1],v[2]) || 1; return [v[0]/l,v[1]/l,v[2]/l]; };
const cross = (a,b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];

// ── GLB 读取 ──────────────────────────────────────
export function parseGLB(buf){
  const dv=new DataView(buf.buffer,buf.byteOffset,buf.byteLength);
  if(dv.getUint32(0,true)!==0x46546C67) throw new Error('not glb');
  let off=12,json=null,bin=null;
  while(off<buf.byteLength){
    const len=dv.getUint32(off,true),type=dv.getUint32(off+4,true);
    if(type===0x4E4F534A) json=JSON.parse(new TextDecoder().decode(new Uint8Array(buf.buffer,buf.byteOffset+off+8,len)));
    else if(type===0x004E4942) bin=new Uint8Array(buf.buffer,buf.byteOffset+off+8,len);
    off+=8+len;
  }
  return { gltf:json, bin };
}
function accessor(gltf,bin,idx){
  const acc=gltf.accessors[idx],bv=gltf.bufferViews[acc.bufferView];
  const comp={5126:Float32Array,5125:Uint32Array,5123:Uint16Array}[acc.componentType];
  const num={SCALAR:1,VEC2:2,VEC3:3}[acc.type];
  return new comp(bin.buffer,bin.byteOffset+(bv.byteOffset||0)+(acc.byteOffset||0),acc.count*num);
}
function loadGeometry(glbPath){
  const { gltf, bin } = parseGLB(fs.readFileSync(glbPath));
  const mesh=gltf.meshes[0],prims=[];
  for(const pr of mesh.primitives){
    const pos=accessor(gltf,bin,pr.attributes.POSITION),nor=accessor(gltf,bin,pr.attributes.NORMAL),uv=pr.attributes.TEXCOORD_0!=null?accessor(gltf,bin,pr.attributes.TEXCOORD_0):null,idx=accessor(gltf,bin,pr.indices);
    const mat=gltf.materials[pr.material]||{},pbr=mat.pbrMetallicRoughness||{};
    let tex=null,color=pbr.baseColorFactor?[...pbr.baseColorFactor].slice(0,3):[0.8,0.8,0.8];
    if(pbr.baseColorTexture){
      const img=gltf.images[pbr.baseColorTexture.index],bv=gltf.bufferViews[img.bufferView];
      const px=new Uint8Array(bin.buffer,bin.byteOffset+bv.byteOffset,bv.byteLength);
      const dec=pngDecode(px);
      tex=dec?{data:new Uint8Array(dec.data),w:dec.w,h:dec.h}:{data:null,w:0,h:0};
    }
    prims.push({ pos, nor, uv, idx, tex, color });
  }
  return { prims, parts:(gltf.asset&&gltf.asset.extras&&gltf.asset.extras.parts)||[], textures: prims.filter(p=>p.tex).length };
}

// ── 光栅化（三角形 + z-buffer）─────────────────────
function raster(color, depth, W, H, t) {
  // t: {ax,ay,az, bx,by,bz, cx,cy,cz} 屏幕坐标(x 向右,y 向下)+z；
  //     nax,nay,naz / nbx,.. / ncx,.. 世界法线；uav/uaw UV；tex/tw/th 纹理；c 基础色
  const minX = Math.max(0, Math.floor(Math.min(t.ax, t.bx, t.cx)));
  const minY = Math.max(0, Math.floor(Math.min(t.ay, t.by, t.cy)));
  const maxX = Math.min(W - 1, Math.ceil(Math.max(t.ax, t.bx, t.cx)));
  const maxY = Math.min(H - 1, Math.ceil(Math.max(t.ay, t.by, t.cy)));
  if (minX > maxX || minY > maxY) return;
  // 屏幕 y 翻转后计算（像素中心对齐）
  const A = t.ax, B = t.ay, C0 = t.bx, D = t.by, E = t.cx, F = t.cy;
  const area = (C0 - A) * (F - B) - (E - A) * (D - B);
  if (Math.abs(area) < 1e-9) return;
  const inv = 1 / area;
  for (let y = minY; y <= maxY; y++) {
    const py = y + 0.5;
    for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5;
      const w0 = ((C0 - px) * (F - py) - (E - px) * (D - py)) * inv;
      if (w0 < -1e-4) continue;
      const w2 = ((E - px) * (B - py) - (A - px) * (F - py)) * inv;
      if (w2 < -1e-4) continue;
      const w1 = 1 - w0 - w2;
      if (w1 < -1e-4) continue;
      const z = t.az * w1 + t.bz * w2 + t.cz * w0;
      const i = y * W + x;
      if (z >= depth[i]) continue;   // z 随距离增大，保留更小（更近）的深度
      depth[i] = z;
      const fnx = t.nax * w1 + t.nbx * w2 + t.ncx * w0;
      const fny = t.nay * w1 + t.nby * w2 + t.ncy * w0;
      const fnz = t.naz * w1 + t.nbz * w2 + t.ncz * w0;
      const o = i * 4;
      if (t.tex) {
        const u = t.ua * w1 + t.ub * w2 + t.uc * w0, v = t.va * w1 + t.vb * w2 + t.vc * w0;
        const tx = Math.min(t.tw - 1, Math.max(0, Math.floor(((u % 1) + 1) % 1 * t.tw)));
        const ty = Math.min(t.th - 1, Math.max(0, Math.floor(((v % 1) + 1) % 1 * t.th)));
        const q = (ty * t.tw + tx) * 4;

        color[o] = t.tex[q]; color[o + 1] = t.tex[q + 1]; color[o + 2] = t.tex[q + 2];
      } else {
        color[o] = t.c[0] * 255; color[o + 1] = t.c[1] * 255; color[o + 2] = t.c[2] * 255;
      }
      color[o + 3] = 255;
      const d = 0.45 + 0.55 * Math.max(0, fnx * -0.55 + fny * 0.72 + fnz * -0.42);
      const g = d * (t.gain || 1), k = t.tone || 3.0;
      color[o] = 255 * (1 - Math.exp(-k * color[o] * g / 255));
      color[o + 1] = 255 * (1 - Math.exp(-k * color[o + 1] * g / 255));
      color[o + 2] = 255 * (1 - Math.exp(-k * color[o + 2] * g / 255));
    }
  }
}

// ── 场景渲染主入口 ────────────────────────────────
// scene: {scene_graph:{entities:[{id,asset_id,transform}]}}
// assetsDir: output/assets；assetFor(assetId) → glb 绝对路径
export function renderScene(scene, { W = 960, H = 540, camera, assetsDir, assetFor, bg = [11, 16, 32], entities, exposure = 2.6, tone = 3.0, lightDir = [-0.55, 0.72, -0.42] } = {}) {
  const t0 = Date.now();
  const ents = entities || (scene.scene_graph && scene.scene_graph.entities) || [];
  const color = new Uint8Array(W * H * 4);
  const depth = new Float32Array(W * H).fill(Infinity);
  color.fill(bg[3] == null ? 255 : bg[3]);
  for (let i = 0; i < W * H; i++) { color[i*4] = bg[0]; color[i*4+1] = bg[1]; color[i*4+2] = bg[2]; color[i*4+3] = 255; }
  const aspect = W / H, fov = (camera && camera.fov) || 0.85;
  // 内容包围盒 → 自动相机
  let mnx=1e9,mny=1e9,mnz=1e9,mxx=-1e9,mxy=-1e9,mxz=-1e9;
  const loaded = [];
  for (const e of ents) {
    const p = assetFor ? assetFor(e.asset_id || e.id) : null;
    if (!p || !fs.existsSync(p)) continue;
    const g = loadGeometry(p);
    const [px,py,pz] = e.transform.position || [0,0,0];
    const [sx,sy,sz] = e.transform.scale || [1,1,1];
    for (const pr of g.prims) for (let k=0;k<pr.pos.length;k+=3){
      const x=px+pr.pos[k]*sx,y=py+pr.pos[k+1]*sy,z=pz+pr.pos[k+2]*sz;
      if(x<mnx)mnx=x;if(x>mxx)mxx=x;if(y<mny)mny=y;if(y>mxy)mxy=y;if(z<mnz)mnz=z;if(z>mxz)mxz=z;
    }
    loaded.push({ e, g });
  }
  if (!loaded.length) { return { ok:false, error:'无可渲染资产' }; }
  const size=[mxx-mnx,mxy-mny,mxz-mnz], maxDim=Math.max(...size)||1;
  const center=[(mnx+mxx)/2,(mny+mxy)/2,(mnz+mxz)/2];
  const target = camera && camera.target ? camera.target : center;
  const dist = camera && camera.dist ? camera.dist : maxDim*1.7/Math.tan(fov/2)*0.5;
  const eye = camera && camera.eye ? camera.eye : [center[0]+dist*0.55, center[1]+dist*0.45, center[2]+dist*0.7];
  const proj = persp(fov, aspect, 0.05, 600);
  const view = lookAt(eye, target, [0,1,0]);
  const pv = matmul(proj, view);
  const transform = v => {
    const cx=pv[0]*v[0]+pv[4]*v[1]+pv[8]*v[2]+pv[12];
    const cy=pv[1]*v[0]+pv[5]*v[1]+pv[9]*v[2]+pv[13];
    const cz=pv[2]*v[0]+pv[6]*v[1]+pv[10]*v[2]+pv[14];
    const cw=pv[3]*v[0]+pv[7]*v[1]+pv[11]*v[2]+pv[15] || 1;
    return [(cx/cw*0.5+0.5)*W, (1-(cy/cw*0.5+0.5))*H, cz/cw];
  };
  let trisIn = 0, trisAll = 0;
  // 背面剔除 + 光栅化
  const light = norm([-0.55,0.72,-0.42]);
  for (const { e, g } of loaded) {
    const M = trs(e.transform.position||[0,0,0], e.transform.rotation||[0,0,0], e.transform.scale||[1,1,1]);
    const N = [M[0]*M[0]+M[4]*M[4]+M[8]*M[8], M[1]*M[1]+M[5]*M[5]+M[9]*M[9], M[2]*M[2]+M[6]*M[6]+M[10]*M[10]];
    const Nn = norm(N);
    for (const pr of g.prims) {
      const vsp=[],vsn=[],vsu=[];
      for (let k=0;k<pr.pos.length;k+=3){
        const x=pr.pos[k],y=pr.pos[k+1],z=pr.pos[k+2];
        vsp.push(transform([M[0]*x+M[4]*y+M[8]*z+M[12], M[1]*x+M[5]*y+M[9]*z+M[13], M[2]*x+M[6]*y+M[10]*z+M[14]]));
        const nx=pr.nor[k],ny=pr.nor[k+1],nz=pr.nor[k+2];
        // 法线随模型矩阵线性部分变换（列主序：与位置变换同一约定）
        const mnx0 = M[0]*nx + M[4]*ny + M[8]*nz,
                mny0 = M[1]*nx + M[5]*ny + M[9]*nz,
                mnz0 = M[2]*nx + M[6]*ny + M[10]*nz;
        const nl = Math.hypot(mnx0, mny0, mnz0) || 1;
        vsn.push([mnx0/nl, mny0/nl, mnz0/nl]);
        vsu.push(pr.uv?[pr.uv[(k/3)*2],pr.uv[(k/3)*2+1]]:[0,0]);
      }
      for (let i=0;i<pr.idx.length;i+=3){
        const a=pr.idx[i],b=pr.idx[i+1],c=pr.idx[i+2];
        const pa=vsp[a],pb=vsp[b],pc=vsp[c];
        trisAll++;
        const s0=(pb[0]-pa[0])*(pc[1]-pa[1])-(pb[1]-pa[1])*(pc[0]-pa[0]);
        if (pa[0]<W+50&&pa[0]>-50&&pb[0]<W+50&&pb[0]>-50&&pc[0]<W+50&&pc[0]>-50&&pa[1]<H+50&&pa[1]>-50&&pb[1]<H+50&&pb[1]>-50&&pc[1]<H+50&&pc[1]>-50) trisIn++;
        raster(color, depth, W, H, {
          ax: pa[0], ay: pa[1], az: pa[2], bx: pb[0], by: pb[1], bz: pb[2], cx: pc[0], cy: pc[1], cz: pc[2],
          nax: vsn[a][0], nay: vsn[a][1], naz: vsn[a][2],
          nbx: vsn[b][0], nby: vsn[b][1], nbz: vsn[b][2],
          ncx: vsn[c][0], ncy: vsn[c][1], ncz: vsn[c][2],
          ua: vsu[a][0], va: vsu[a][1], ub: vsu[b][0], vb: vsu[b][1], uc: vsu[c][0], vc: vsu[c][1],
          tex: pr.tex ? pr.tex.data : null, tw: pr.tex ? pr.tex.w : 0, th: pr.tex ? pr.tex.h : 0, c: pr.color, gain: exposure, tone: tone
        });      }
    }
  }
  let shaded = 0;
  for (let i = 0; i < W * H; i++) { if (color[i*4] !== bg[0] || color[i*4+1] !== bg[1] || color[i*4+2] !== bg[2]) shaded++; }

  return { ok:true, shaded, trisIn, trisAll, ms: Date.now() - t0, png: pngEncode(W,H,color), width:W, height:H, bbox:[mnx,mny,mnz,mxx,mxy,mxz], camera:{eye,target,dist:Math.hypot(eye[0]-target[0],eye[1]-target[1],eye[2]-target[2])}, rendered: loaded.length };
}
