import { optimizeRoute, baselineCost, tourCost } from '../js/optimization/engine.js';
function rnd(n, asym){ const pts=Array.from({length:n},()=>[Math.random()*100,Math.random()*100]);
  return pts.map((a,i)=>pts.map((b,j)=> i===j?0: Math.hypot(a[0]-b[0],a[1]-b[1])*(asym?(1+0.3*Math.random()):1))); }
function perms(a){ if(a.length<=1) return [a]; const r=[]; a.forEach((x,i)=>perms([...a.slice(0,i),...a.slice(i+1)]).forEach(p=>r.push([x,...p]))); return r;}
function brute(m,mode,endIdx){ const n=m.length; const mid=[]; for(let i=1;i<n;i++) if(!(mode==='fixed'&&i===endIdx)) mid.push(i);
  let best=Infinity; for(const p of perms(mid)){ const t=[0,...p]; if(mode==='fixed') t.push(endIdx); const c=tourCost(m,t,mode==='closed'); if(c<best)best=c;} return best;}
let worst=1, bad=0, cnt=0;
for(const mode of ['closed','open','fixed']) for(const asym of [false,true]) for(let it=0;it<60;it++){
  const n=4+Math.floor(Math.random()*5); const m=rnd(n,asym);
  const endIdx = mode==='fixed'? n-1 : (mode==='closed'?0:null);
  const r=optimizeRoute(m,{startIdx:0,endIdx,closed:mode==='closed'});
  const ord=r.order; const set=new Set(ord);
  if(set.size!==n||ord[0]!==0||(mode==='fixed'&&ord[n-1]!==endIdx)) {console.log('INVALID',mode,ord); bad++;}
  const opt=brute(m,mode,endIdx); const ratio=r.total_cost/opt; worst=Math.max(worst,ratio); cnt++;
  if(Math.abs(r.total_cost-tourCost(m,ord,mode==='closed'))>1e-6){console.log('COST MISMATCH');bad++}
  const base=baselineCost(m,{startIdx:0,endIdx,closed:mode==='closed'}); if(r.total_cost>base.cost+1e-6){console.log('worse than baseline',mode);bad++}
}
console.log({cnt,bad,worstRatio:worst.toFixed(3)});
// edge cases
console.log(optimizeRoute([[0]],{}).order, optimizeRoute([[0,5],[5,0]],{}).full_order, optimizeRoute([[0,5],[5,0]],{closed:false}).order);
// large
const big=rnd(300,false); let t=Date.now(); const rb=optimizeRoute(big,{closed:true}); console.log('n=300',Date.now()-t,'ms', rb.total_cost.toFixed(0), baselineCost(big,{closed:true}).cost.toFixed(0));
