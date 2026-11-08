"use strict";
const BASE="https://dati.venezia.it/sites/default/files/dataset/opendata/";
const URLS={liv:BASE+"livello.json",prev:BASE+"previsione.json",astro:BASE+"as2026min.json",astro27:BASE+"as2027min.json"};
const NOMI={liv:"Livelli misurati",prev:"Previsione",astro:"Marea astronomica 2026",astro27:"Marea astronomica 2027"};
const DST={liv:"liv",prev:"ext",astro:"a26",astro27:"a27"};
const SALUTE={lat:45.4311,lon:12.3364};
const PROXY0="https://maree-proxy.phoenix-tourer.workers.dev/?url={url}";
//#core
const solare=s=>Date.parse(String(s).replace(" ","T")+"+01:00");
const num=v=>parseFloat(String(v).replace(",","."));
function parseLiv(rows){return rows.map(r=>{const v=num(r.valore);return{id:r.ID_stazione,nome:r.stazione,lat:num(r.latDDN),lon:num(r.lonDDE),t:solare(r.data),cm:(isNaN(v)||v===-999)?null:v*100};});}
function parseExt(rows){const ts=rows.map(r=>solare(r.DATA_PREVISIONE)),last=Math.max.apply(null,ts);
 return rows.filter((r,i)=>ts[i]===last).map(r=>({t:solare(r.DATA_ESTREMALE),cm:num(r.VALORE)})).filter(e=>isFinite(e.cm)&&isFinite(e.t)).sort((a,b)=>a.t-b.t);}
function parseAstro(rows){const p=rows.map(r=>[solare(r.data),num(r.valore)]).filter(x=>isFinite(x[0])&&isFinite(x[1])).sort((a,b)=>a[0]-b[0]);
 return{t:Float64Array.from(p,x=>x[0]),c:Float32Array.from(p,x=>x[1])};}
function unisci(a,b){if(!a)return b||null;if(!b)return a;let k=0;const fine=a.t[a.t.length-1];while(k<b.t.length&&b.t[k]<=fine)k++;
 const t=new Float64Array(a.t.length+b.t.length-k),c=new Float32Array(t.length);t.set(a.t);t.set(b.t.subarray(k),a.t.length);c.set(a.c);c.set(b.c.subarray(k),a.c.length);return{t:t,c:c};}
function astroA(A,t){const n=A.t.length;if(!n||t<A.t[0]||t>A.t[n-1])return NaN;let lo=0,hi=n-1;
 while(hi-lo>1){const m=(lo+hi)>>1;if(A.t[m]<=t)lo=m;else hi=m;}
 const dt=A.t[hi]-A.t[lo];return dt===0?A.c[lo]:A.c[lo]+(A.c[hi]-A.c[lo])*(t-A.t[lo])/dt;}
// previsione = astronomica + scarto interpolato tra i picchi (e, se c'è, la misura recente a Punta Salute)
function mkForecast(ext,A,anchor){
 const pts=ext.map(e=>({t:e.t,s:e.cm-astroA(A,e.t)})).filter(p=>isFinite(p.s));
 if(anchor){const a=astroA(A,anchor.t);if(isFinite(a))pts.push({t:anchor.t,s:anchor.cm-a});}
 pts.sort((x,y)=>x.t-y.t);
 const f=t=>{for(let i=0;i<pts.length-1;i++){const a=pts[i],b=pts[i+1];
  if(t>=a.t&&t<=b.t){const base=astroA(A,t);if(!isFinite(base))return null;
   return b.t===a.t?base+a.s:base+a.s+(b.s-a.s)*(t-a.t)/(b.t-a.t);}}return null;};
 f.end=pts.length?pts[pts.length-1].t:0;return f;}
function dist(aLat,aLon,bLat,bLon){const R=6371000,r=Math.PI/180,dLa=(bLat-aLat)*r,dLo=(bLon-aLon)*r;
 const h=Math.sin(dLa/2)**2+Math.cos(aLat*r)*Math.cos(bLat*r)*Math.sin(dLo/2)**2;return 2*R*Math.asin(Math.sqrt(h));}
function stazione(liv,lat,lon){let best=null,bd=Infinity;for(const s of liv){if(s.cm===null||!isFinite(s.lat)||!isFinite(s.t))continue;
 const d=dist(lat,lon,s.lat,s.lon);if(d<bd){bd=d;best=s;}}return best;}
function stato(p,cm,c){const m=p.i-cm-c.h-c.s;return{m:m,st:m<0?"non_passa":m<c.a?"attenzione":"ok"};}
function livelloA(t,p,X){
 if(Math.abs(t-X.now)<=600000){const s=stazione(X.liv,p.lat!=null?p.lat:SALUTE.lat,p.lon!=null?p.lon:SALUTE.lon);
  if(s&&X.now-s.t<=1200000)return{cm:s.cm,src:"misurato",s:s};}
 if(!X.fc)return null;const f=X.fc(t);return f==null?null:{cm:f+(p.off||0),src:"previsto"};}
function finestre(p,X,c){const w=[];let ini=null;const end=X.fc?X.fc.end:0;
 for(let t=X.now;t<=end;t+=300000){const L=livelloA(t,p,X);const bad=!!L&&stato(p,L.cm,c).st==="non_passa";
  if(bad&&ini===null)ini=t;if(!bad&&ini!==null){w.push({a:ini,b:t});ini=null;}}
 if(ini!==null)w.push({a:ini,b:null});return w;}
//#endcore

const $=id=>document.getElementById(id);
const ls={get(k,d){try{const v=localStorage.getItem(k);return v?JSON.parse(v):d;}catch(e){return d;}},
 set(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch(e){}}};
let cfg=Object.assign({h:185,s:20,a:10,proxy:"",ponti:[]},ls.get("mp.cfg",{}));
if(!cfg.proxy)cfg.proxy=PROXY0;
const save=()=>ls.set("mp.cfg",cfg);
const S={d:{},err:{},off:{},last:{},passoOk:true};
const hhmm=t=>new Date(t).toLocaleTimeString("it-IT",{hour:"2-digit",minute:"2-digit",timeZone:"Europe/Rome"});
const giorno=t=>new Date(t).toLocaleString("it-IT",{weekday:"short",hour:"2-digit",minute:"2-digit",timeZone:"Europe/Rome"});
const gg=n=>new Date(n).toLocaleDateString("it-IT",{timeZone:"Europe/Rome"});
const quando=t=>gg(t)===gg(Date.now())?hhmm(t):giorno(t);
function el(tag,cls,txt){const e=document.createElement(tag);if(cls)e.className=cls;if(txt!=null)e.textContent=txt;return e;}

async function getJson(key){
 const url=URLS[key];let err=null;
 let cache=null;try{cache=window.caches?await caches.open("dati-v1"):null;}catch(e){}
 const tries=[url];if(cfg.proxy&&cfg.proxy.indexOf("{url}")>=0)tries.unshift(cfg.proxy.replace("{url}",encodeURIComponent(url)));
 for(const u of tries){try{const r=await fetch(u,{cache:"no-store"});if(!r.ok)throw new Error("HTTP "+r.status);
  const data=await r.clone().json();if(cache){try{await cache.put(url,r);}catch(e){}}ls.set("mp.ts."+key,Date.now());return{data:data,off:false};}
  catch(e){err=e;}}
 if(cache){const m=await cache.match(url);if(m)return{data:await m.json(),off:true};}
 throw err;}
async function load(key,dst,parse,maxAge){
 if(S.d[dst]&&Date.now()-(S.last[key]||0)<maxAge)return;
 try{const r=await getJson(key);S.d[dst]=parse(r.data);S.last[key]=Date.now();if(r.off)S.off[key]=ls.get("mp.ts."+key,0);
  if(key.indexOf("astro")===0){const A=S.d[dst];if(!(A.t.length>1&&Math.abs(A.t[1]-A.t[0]-300000)<1000))S.passoOk=false;}}
 catch(e){S.err[key]=(e instanceof TypeError)?"non raggiungibile dall’app (rete, CORS o protezione antibot del portale): imposta il proxy nelle impostazioni":e.message;}}

function render(){
 const now=Date.now(),c={h:+cfg.h,s:+cfg.s,a:+cfg.a},liv=S.d.liv||[];
 const sal=stazione(liv,SALUTE.lat,SALUTE.lon),fresh=!!sal&&now-sal.t<=1200000;
 const fc=S.d.ext&&S.d.astro?mkForecast(S.d.ext,S.d.astro,fresh?{t:sal.t,cm:sal.cm}:null):null;
 const X={now:now,liv:liv,fc:fc};
 $("stato").textContent=sal?"Punta Salute "+Math.round(sal.cm)+" cm alle "+hhmm(sal.t)+(fresh?"":" (dato non aggiornato)"):"Nessuna misura disponibile";
 const av=$("avvisi");av.textContent="";
 const add=t=>av.appendChild(el("p","avviso",t));
 for(const k in S.err)add(NOMI[k]+": "+S.err[k]+(S.d[DST[k]]?". Uso l’ultimo dato scaricato.":"."));
 for(const k in S.off)add(NOMI[k]+": uso i dati salvati alle "+hhmm(S.off[k])+" (senza connessione).");
 if(!S.passoOk)add("Il file della marea astronomica non sembra a passo di 5 minuti: controlla che sia quello giusto.");
 if(!fc&&!fresh)add("Né misura recente né previsione: nessun giudizio possibile.");
 const box=$("ponti");box.textContent="";
 if(!cfg.ponti.length){box.appendChild(el("p","vuoto","Nessun ponte inserito. Aggiungili dalle impostazioni, in fondo alla pagina: senza le quote reali l’app non dà nessun “passa”."));}
 const ord={non_passa:0,attenzione:1,nd:2,ok:3};
 const righe=cfg.ponti.map(p=>{const L=livelloA(now,p,X);const r=L?stato(p,L.cm,c):null;return{p:p,L:L,r:r,w:L?finestre(p,X,c):[]};})
  .sort((x,y)=>ord[x.r?x.r.st:"nd"]-ord[y.r?y.r.st:"nd"]);
 const LAB={ok:"Passa",attenzione:"Attenzione",non_passa:"Non passa",nd:"Nessun dato"};
 for(const x of righe){const st=x.r?x.r.st:"nd";const card=el("div","bridge "+st);card.appendChild(el("div","bar"));
  const mid=el("div");mid.appendChild(el("div","name",x.p.n));
  mid.appendChild(el("div","win",x.L?"Livello "+Math.round(x.L.cm)+" cm ("+(x.L.src==="misurato"?"misurato alle "+hhmm(x.L.s.t)+", "+x.L.s.nome:"previsto")+")":"Nessun dato per questo ponte"));
  if(x.L){if(x.w.length)x.w.slice(0,3).forEach(w=>mid.appendChild(el("div","win crit","Non passabile dalle "+quando(w.a)+(w.b?" alle "+quando(w.b):" (oltre la previsione)"))));
   else if(fc)mid.appendChild(el("div","win","Nessuna finestra non passabile fino a "+quando(fc.end)));}
  card.appendChild(mid);const b=el("div","badge",LAB[st]);if(x.r)b.appendChild(el("small",null,"margine "+Math.round(x.r.m)+" cm"));card.appendChild(b);box.appendChild(card);}
 $("agg").textContent="Aggiornato alle "+hhmm(now);
}
function renderPonti(){const ul=$("lista");ul.textContent="";
 cfg.ponti.forEach((p,i)=>{const li=el("li");li.appendChild(el("span",null,p.n+" · intradosso "+p.i+" cm"+(p.lat!=null?" · "+p.lat+", "+p.lon:"")+(p.off?" · offset "+p.off:"")));
  const b=el("button","pic","Elimina");b.addEventListener("click",()=>{cfg.ponti.splice(i,1);save();renderPonti();render();});li.appendChild(b);ul.appendChild(li);});}
async function aggiorna(){const b=$("btn");b.disabled=true;S.err={};S.off={};
 const serve27=Date.now()>=Date.parse("2026-12-01T00:00:00+01:00");
 await Promise.all([load("liv","liv",parseLiv,0),load("prev","ext",parseExt,1800000),load("astro","a26",parseAstro,21600000),
  serve27?load("astro27","a27",parseAstro,21600000):null]);
 S.d.astro=unisci(S.d.a26,S.d.a27);
 render();b.disabled=false;}
function init(){
 ["h","s","a"].forEach(k=>{$(k).value=cfg[k];$(k).addEventListener("input",()=>{cfg[k]=+$(k).value;save();render();});});
 $("proxy").value=cfg.proxy;$("proxy").addEventListener("change",()=>{cfg.proxy=$("proxy").value.trim();save();});
 $("btn").addEventListener("click",aggiorna);
 $("nuovo").addEventListener("submit",ev=>{ev.preventDefault();const n=$("pn").value.trim(),i=num($("pi").value);
  if(!n||!isFinite(i)){$("err").textContent="Servono nome e quota dell’intradosso.";return;}$("err").textContent="";
  const p={n:n,i:i},la=num($("pla").value),lo=num($("plo").value),of=num($("pof").value);
  if(isFinite(la)&&isFinite(lo)){p.lat=la;p.lon=lo;}if(isFinite(of))p.off=of;
  cfg.ponti.push(p);save();ev.target.reset();renderPonti();render();});
 renderPonti();aggiorna();setInterval(aggiorna,300000);
 document.addEventListener("visibilitychange",()=>{if(!document.hidden)aggiorna();});
 if("serviceWorker" in navigator)navigator.serviceWorker.register("sw.js").catch(()=>{});}
if(typeof document!=="undefined")document.addEventListener("DOMContentLoaded",init);
