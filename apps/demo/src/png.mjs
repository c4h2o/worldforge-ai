// Minimal PNG writer (RGB8, filter 0) — zero-dependency.
import zlib from 'node:zlib';

function crc32(buf){ let c,t=[]; for(let n=0;n<256;n++){ c=n; for(let k=0;k<8;k++) c=c&1?0xEDB88320^(c>>>1):c>>>1; t[n]=c; } let crc=0xFFFFFFFF; for(let i=0;i<buf.length;i++) crc=t[(crc^buf[i])&0xFF]^(crc>>>8); return (crc^0xFFFFFFFF)>>>0; }
function chunk(type,data){ const len=Buffer.alloc(4); len.writeUInt32BE(data.length); const t=Buffer.from(type,'ascii'); const crc=Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t,data]))); return Buffer.concat([len,t,data,crc]); }

/** rgbFn(x,y) -> [r,g,b] (0-255). Returns a PNG Buffer. */
export function encodePng(w, h, rgbFn) {
  const stride = w*3;
  const raw = Buffer.alloc((stride+1)*h);
  for (let y=0;y<h;y++){
    raw[y*(stride+1)] = 0;
    for (let x=0;x<w;x++){
      const [r,g,b] = rgbFn(x,y);
      const o = y*(stride+1)+1+x*3;
      raw[o]=Math.max(0,Math.min(255,r|0)); raw[o+1]=Math.max(0,Math.min(255,g|0)); raw[o+2]=Math.max(0,Math.min(255,b|0));
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w,0); ihdr.writeUInt32BE(h,4); ihdr[8]=8; ihdr[9]=2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR',ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/** 占位"概念图"：渐变背景 + 中央色块（语义驱动生图的占位实现）。 */
export function conceptImage(color=[1,0.4,0.2], seed=1){
  const w=256, h=256;
  return encodePng(w,h,(x,y)=>{
    const t=y/h;
    const bg=[20+t*40, 18+t*34, 26+t*40];
    const dx=(x-w/2)/(w/2), dy=(y-h/2)/(h/2);
    const inBox = Math.abs(dx)<0.5 && Math.abs(dy)<0.5;
    const [r,g,b]=color.map(c=>c*255);
    if(inBox){
      const shade=0.75+0.25*Math.sin((x+y+seed*37)*0.05);
      return [r*shade, g*shade, b*shade];
    }
    return bg;
  });
}
