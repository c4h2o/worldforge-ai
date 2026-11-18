import{createRenderer,persp,lookAt}from'/renderer.mjs';
const canvas=document.getElementById('gl'),hud=document.getElementById('info'),err=document.getElementById('err');
const fail=m=>{err.style.display='block';err.textContent=m;};
const rd=createRenderer(canvas);if(!rd.ok){fail(rd.error);throw new Error(rd.error);}
let yaw=0.7,pitch=0.35,dist=16,cx=0,cy=1,cz=-2;
function eyeFrom(){const x=cx+dist*Math.cos(pitch)*Math.sin(yaw),y=cy+dist*Math.sin(pitch),z=cz+dist*Math.cos(pitch)*Math.cos(yaw);return[x,y,z];}
let drag=null,lx=0,ly=0;
canvas.addEventListener('mousedown',e=>{drag=e.button===2?'pan':e.button===0?'rot':null;lx=e.clientX;ly=e.clientY;e.preventDefault();});
window.addEventListener('mouseup',()=>drag=null);
canvas.addEventListener('contextmenu',e=>e.preventDefault());
canvas.addEventListener('mousemove',e=>{if(!drag)return;const dx=e.clientX-lx,dy=e.clientY-ly;lx=e.clientX;ly=e.clientY;if(drag==='rot'){yaw+=dx*0.01;pitch=Math.max(-1.5,Math.min(1.5,pitch+dy*0.01));}else{const s=dist*0.0016;cx-=Math.sin(yaw)*dx*s;cz-=Math.cos(yaw)*dx*s;cy+=dy*s;}});
canvas.addEventListener('wheel',e=>{dist=Math.max(3,Math.min(60,dist*(1+e.deltaY*0.001)));e.preventDefault();},{passive:false});
const items=[];let sceneName='无场景';
try{const sc=await(await fetch('/api/scenes')).json();const list=sc.scenes||sc;const scene=list.at(-1);if(scene){sceneName=scene.name||scene.id;const ares=await(await fetch('/api/assets')).json();const lib=ares.assets||ares;const map=Array.isArray(lib)?Object.fromEntries(lib.map(a=>[a.id,a])):lib;for(const e of scene.scene_graph.entities){const a=map[e.asset_id];if(!a)continue;const la=await rd.loadAsset(a.local_path);items.push({prims:la.prims,parts:la.parts,pos:e.transform.position||[0,0,0],rot:e.transform.rotation||[0,0,0],scale:e.transform.scale||[1,1,1]});}hud.textContent=sceneName+' · '+items.length+' 资产 · '+items.reduce((n,it)=>n+it.prims.length,0)+' 部件';}}catch(e){hud.textContent='加载失败: '+e.message;}
function frame(){const w=canvas.clientWidth,h=canvas.clientHeight;const proj=persp(0.9,w/h,0.1,200);const view=lookAt(eyeFrom(),[cx,cy,cz],[0,1,0]);rd.drawAll(items,proj,view,performance.now()/1000);requestAnimationFrame(frame);}
frame();