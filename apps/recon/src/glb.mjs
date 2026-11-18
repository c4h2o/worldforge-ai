// WorldForge AI 自研重建引擎 — 贴图 GLB 构造器（零依赖）
// 输入：概念图（PNG）→ 输出：以图像为 baseColorTexture 的语义感知 3D 网格（GLB）。
// 语义感知几何：按实体类别选择长宽高比例（②程序化增强）。

const FACES = [
  { n: [ 1,0,0], c: [[1,-1,-1],[1,1,-1],[1,1,1],[1,-1,1]] },
  { n: [-1,0,0], c: [[-1,-1,1],[-1,1,1],[-1,1,-1],[-1,-1,-1]] },
  { n: [0, 1,0], c: [[-1,1,-1],[-1,1,1],[1,1,1],[1,1,-1]] },
  { n: [0,-1,0], c: [[-1,-1,1],[-1,-1,-1],[1,-1,-1],[1,-1,1]] },
  { n: [0,0, 1], c: [[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]] },
  { n: [0,0,-1], c: [[1,-1,-1],[-1,-1,-1],[-1,1,-1],[1,1,-1]] },
];
const UVS = [[0,0],[1,0],[1,1],[0,1]];
// 语义感知：各类别的长宽高比例（x,y,z）
const RATIO = { container:[1.6,1.0,1.0], building:[1.0,1.7,1.0], robot:[0.6,1.9,0.6], crane:[0.5,2.1,0.5], ship:[2.2,0.6,0.6], light:[0.4,2.5,0.4], default:[1,1,1] };

export function buildTexturedGLB(category, imagePng, w, h, name) {
  const r = RATIO[category] || RATIO.default;
  const pos = [], nor = [], uv = [], idx = [];
  let base = 0;
  for (const f of FACES) {
    for (let i = 0; i < 4; i++) {
      const c = f.c[i];
      pos.push(c[0]*r[0]/2, c[1]*r[1]/2, c[2]*r[2]/2);
      nor.push(f.n[0], f.n[1], f.n[2]);
      uv.push(UVS[i][0], UVS[i][1]);
    }
    idx.push(base, base+1, base+2, base, base+2, base+3);
    base += 4;
  }
  const positions = new Float32Array(pos), normals = new Float32Array(nor), texcoords = new Float32Array(uv), indices = new Uint32Array(idx);
  let min=[Infinity,Infinity,Infinity], max=[-Infinity,-Infinity,-Infinity];
  for (let i=0;i<positions.length;i+=3){ for(let k=0;k<3;k++){ const v=positions[i+k]; if(v<min[k])min[k]=v; if(v>max[k])max[k]=v; } }
  const posB=positions.byteLength, norB=normals.byteLength, uvB=texcoords.byteLength, idxB=indices.byteLength, imgB=imagePng.length;
  const binLen = posB + norB + uvB + idxB + imgB;
  const gltf = {
    asset: { version: '2.0', generator: 'worldforge-recon' },
    scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name }],
    meshes: [{ name, primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: 3, material: 0 }] }],
    materials: [{ name: name + '-mat', pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0.0, roughnessFactor: 0.9 }, doubleSided: true }],
    images: [{ bufferView: 4, mimeType: 'image/png', name: 'concept' }],
    samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }],
    textures: [{ sampler: 0, source: 0 }],
    buffers: [{ byteLength: binLen }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: posB, target: 34962 },
      { buffer: 0, byteOffset: posB, byteLength: norB, target: 34962 },
      { buffer: 0, byteOffset: posB + norB, byteLength: uvB, target: 34962 },
      { buffer: 0, byteOffset: posB + norB + uvB, byteLength: idxB, target: 34963 },
      { buffer: 0, byteOffset: posB + norB + uvB + idxB, byteLength: imgB },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: positions.length/3, type: 'VEC3', min, max },
      { bufferView: 1, componentType: 5126, count: normals.length/3, type: 'VEC3' },
      { bufferView: 2, componentType: 5126, count: texcoords.length/2, type: 'VEC2' },
      { bufferView: 3, componentType: 5125, count: indices.length, type: 'SCALAR' },
    ],
  };
  const jsonBytes = Buffer.from(JSON.stringify(gltf), 'utf8');
  const bin = Buffer.alloc(binLen);
  Buffer.from(positions.buffer).copy(bin, 0);
  Buffer.from(normals.buffer).copy(bin, posB);
  Buffer.from(texcoords.buffer).copy(bin, posB + norB);
  Buffer.from(indices.buffer).copy(bin, posB + norB + uvB);
  imagePng.copy(bin, posB + norB + uvB + idxB);
  const jsonPad = (4 - (jsonBytes.length % 4)) % 4, binPad = (4 - (bin.length % 4)) % 4;
  const jsonChunk = Buffer.concat([jsonBytes, Buffer.alloc(jsonPad, 0x20)]);
  const binChunk = Buffer.concat([bin, Buffer.alloc(binPad)]);
  const total = 12 + 8 + jsonChunk.length + 8 + binChunk.length;
  const header = Buffer.alloc(12); header.writeUInt32LE(0x46546C67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(total, 8);
  const jh = Buffer.alloc(8); jh.writeUInt32LE(jsonChunk.length, 0); jh.writeUInt32LE(0x4E4F534A, 4);
  const bh = Buffer.alloc(8); bh.writeUInt32LE(binChunk.length, 0); bh.writeUInt32LE(0x004E4942, 4);
  return Buffer.concat([header, jh, jsonChunk, bh, binChunk]);
}

// ── ③ 语义部件拆解：类别 → 多部件多材质网格 ──
// 每个部件是一个盒体；texture 部件贴概念图，color 部件用程序化材质色。
export const PARTS = {
  crane: [
    { c:[0,0.2,0],  s:[1.2,0.4,1.2], m:'tex' },
    { c:[0,1.5,0],  s:[0.5,2.2,0.5], m:'tex' },
    { c:[0.6,2.7,0],s:[2.8,0.2,0.2], m:'col', color:[0.5,0.55,0.6] },
    { c:[-1.0,2.7,0],s:[0.7,0.18,0.18], m:'col', color:[0.4,0.42,0.46] },
  ],
  robot: [
    { c:[0,0.9,0],  s:[0.7,1.2,0.5], m:'tex' },
    { c:[0,1.7,0],  s:[0.5,0.4,0.45], m:'col', color:[0.55,0.6,0.65] },
    { c:[-0.52,1.1,0], s:[0.18,1.0,0.18], m:'col', color:[0.35,0.38,0.42] },
    { c:[0.52,1.1,0], s:[0.18,1.0,0.18], m:'col', color:[0.35,0.38,0.42] },
  ],
  container: [
    { c:[0,0.45,0],  s:[1.8,0.9,0.9], m:'tex' },
    { c:[0,0.45,0.47], s:[1.5,0.75,0.05], m:'col', color:[0.5,0.4,0.3] },
  ],
  ship: [
    { c:[0,0.3,0],  s:[2.4,0.6,0.8], m:'tex' },
    { c:[0,0.95,0], s:[0.9,0.7,0.6], m:'col', color:[0.6,0.6,0.62] },
  ],
  building: [
    { c:[0,1.3,0],  s:[1.6,2.6,1.6], m:'tex' },
    { c:[0,3.0,0],  s:[0.08,1.0,0.08], m:'col', color:[0.8,0.3,0.3] },
  ],
  light: [
    { c:[0,1.4,0],  s:[0.2,2.8,0.2], m:'tex' },
    { c:[0,2.9,0],  s:[0.5,0.3,0.3], m:'col', color:[1.0,0.85,0.4] },
  ],
  default: [ { c:[0,0.5,0], s:[1,1,1], m:'tex' } ],
};

export function buildPartGLB(category, imagePng, name) {
  const parts = PARTS[category] || PARTS.default;
  const pos=[], nor=[], uv=[], idxRanges=[], mats=[];
  const texMatIdx = parts.some(p=>p.m==='tex') ? 0 : null;
  if (texMatIdx===0) mats.push({ name:name+'-tex', pbrMetallicRoughness:{ baseColorTexture:{index:0}, metallicFactor:0.0, roughnessFactor:0.9 }, doubleSided:true });
  let base=0, accessor=3;
  for (const p of parts) {
    let matIdx;
    if (p.m==='tex') matIdx = 0;
    else { matIdx = mats.length; mats.push({ name:name+'-part'+matIdx, pbrMetallicRoughness:{ baseColorFactor:[...p.color,1], metallicFactor:0.1, roughnessFactor:0.8 }, doubleSided:true }); }
    const idx=[];
    for (const fc of FACES) {
      for (let i=0;i<4;i++){ const c=fc.c[i]; pos.push(p.c[0]+c[0]*p.s[0]/2, p.c[1]+c[1]*p.s[1]/2, p.c[2]+c[2]*p.s[2]/2); nor.push(fc.n[0],fc.n[1],fc.n[2]); uv.push(UVS[i][0],UVS[i][1]); }
      idx.push(base,base+1,base+2,base,base+2,base+3); base+=4;
    }
    idxRanges.push({ idx, matIdx, accessor });
  }
  const positions=new Float32Array(pos), normals=new Float32Array(nor), texcoords=new Float32Array(uv);
  let min=[Infinity,Infinity,Infinity], max=[-Infinity,-Infinity,-Infinity];
  for(let i=0;i<positions.length;i+=3){for(let k=0;k<3;k++){const v=positions[i+k];if(v<min[k])min[k]=v;if(v>max[k])max[k]=v;}}
  const posB=positions.byteLength, norB=normals.byteLength, uvB=texcoords.byteLength, imgB=imagePng.length;
  const idxBuffers = idxRanges.map(r=>Buffer.from(new Uint32Array(r.idx)));
  const idxBs = idxBuffers.map(b=>b.length);
  const idxTotal = idxBs.reduce((a,b)=>a+b,0);
  const binLen = posB+norB+uvB+idxTotal+imgB;
  const gltf = {
    asset:{version:'2.0',generator:'worldforge-recon'}, scene:0, scenes:[{nodes:[0]}], nodes:[{mesh:0,name}],
    meshes:[{ name, primitives: idxRanges.map((r,i)=>({ attributes:{POSITION:0,NORMAL:1,TEXCOORD_0:2}, indices:r.accessor, material:r.matIdx })) }],
    materials: mats,
    images:[{ bufferView: 3+idxRanges.length, mimeType:'image/png', name:'concept' }],
    samplers:[{ magFilter:9729, minFilter:9987, wrapS:10497, wrapT:10497 }],
    textures:[{ sampler:0, source:0 }],
    buffers:[{ byteLength: binLen }],
    bufferViews:[
      { buffer:0, byteOffset:0, byteLength:posB, target:34962 },
      { buffer:0, byteOffset:posB, byteLength:norB, target:34962 },
      { buffer:0, byteOffset:posB+norB, byteLength:uvB, target:34962 },
      ...idxRanges.map((r,i)=>({ buffer:0, byteOffset:posB+norB+uvB+idxBs.slice(0,i).reduce((a,b)=>a+b,0), byteLength:idxBs[i], target:34963 })),
      { buffer:0, byteOffset:posB+norB+uvB+idxTotal, byteLength:imgB },
    ],
    accessors:[
      { bufferView:0, componentType:5126, count:positions.length/3, type:'VEC3', min, max },
      { bufferView:1, componentType:5126, count:normals.length/3, type:'VEC3' },
      { bufferView:2, componentType:5126, count:texcoords.length/2, type:'VEC2' },
      ...idxRanges.map((r,i)=>({ bufferView:3+i, componentType:5125, count:r.idx.length, type:'SCALAR' })),
    ],
  };
  const jsonBytes=Buffer.from(JSON.stringify(gltf),'utf8');
  const bin=Buffer.alloc(binLen);
  Buffer.from(positions.buffer).copy(bin,0); Buffer.from(normals.buffer).copy(bin,posB); Buffer.from(texcoords.buffer).copy(bin,posB+norB);
  let off=posB+norB+uvB; for(const b of idxBuffers){ b.copy(bin,off); off+=b.length; }
  imagePng.copy(bin, posB+norB+uvB+idxTotal);
  const jsonPad=(4-(jsonBytes.length%4))%4, binPad=(4-(bin.length%4))%4;
  const jsonChunk=Buffer.concat([jsonBytes,Buffer.alloc(jsonPad,0x20)]), binChunk=Buffer.concat([bin,Buffer.alloc(binPad)]);
  const total=12+8+jsonChunk.length+8+binChunk.length;
  const header=Buffer.alloc(12); header.writeUInt32LE(0x46546C67,0); header.writeUInt32LE(2,4); header.writeUInt32LE(total,8);
  const jh=Buffer.alloc(8); jh.writeUInt32LE(jsonChunk.length,0); jh.writeUInt32LE(0x4E4F534A,4);
  const bh=Buffer.alloc(8); bh.writeUInt32LE(binChunk.length,0); bh.writeUInt32LE(0x004E4942,4);
  return Buffer.concat([header,jh,jsonChunk,bh,binChunk]);
}
