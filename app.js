
'use strict';

const G = 'https://graph.instagram.com/v23.0';
const TT_API = 'https://open.tiktokapis.com/v2';
const TT_USER_FIELDS = 'display_name,follower_count,following_count,likes_count,video_count';
const TT_VIDEO_FIELDS = 'id,title,cover_image_url,share_url,create_time,duration,view_count,like_count,comment_count,share_count';
const MAX = 30;                       // media pulled per refresh
const STALE_MS = 10*60*1000;          // cached insights count as stale after 10 min
const LS = {
  tok:'aura_ig_token', tt:'aura_tt_token', ttUser:'aura_tt_user',
  gr:'aura_groq_key', grm:'aura_groq_model',
  theme:'aura_theme', cache:'aura_insights', hist:'aura_history',
  texp:'aura_ig_exp', tref:'aura_ig_reftime', ai:'aura_ai_report',
  plat:'aura_stats_plat',
  lk:'aura_hist_lk',
  packUrl:'aura_pack_url',
  ghTok:'aura_gh_token', ghRepo:'aura_gh_repo', ghBranch:'aura_gh_branch',
  ghPath:'aura_gh_path', ghAuto:'aura_gh_auto',
};
const DEFAULT_LK=(function(){try{return atob('ODAzMA==')}catch(e){return''}})();
const PACK_SALT = 'aura-studio-pack-v1';
const PACK_ITERS = 120000;
const GH_DEFAULTS = {
  repo: 'banched12/ai-bright-studio',
  branch: 'gh-pages',
  path: 'data/pack.v1.enc',
};


const $  = s => document.querySelector(s);
const cfg = (k,v)=> v===undefined ? localStorage.getItem(k) : (v===null?localStorage.removeItem(k):localStorage.setItem(k,v));
const jset = (k,o)=> localStorage.setItem(k, JSON.stringify(o));
const jget = (k,d)=> { try{ return JSON.parse(localStorage.getItem(k)) ?? d; }catch{ return d; } };


let statsPlat = cfg(LS.plat) || 'tiktok';   // 'instagram' | 'tiktok'
let insTab = 'overview';                       // overview | timing
let lastInsights = null;                       // last rendered payload
let insightsLoaded = { instagram:false, tiktok:false };

const CHANGES_RANGES = [
  { id:'15m', label:'15m', ms: 15*60*1000 },
  { id:'1h',  label:'1h',  ms: 1*3600*1000 },
  { id:'3h',  label:'3h',  ms: 3*3600*1000 },
  { id:'6h',  label:'6h',  ms: 6*3600*1000 },
  { id:'12h', label:'12h', ms: 12*3600*1000 },
  { id:'1d',  label:'1d',  ms: 24*3600*1000 },
  { id:'3d',  label:'3d',  ms: 3*24*3600*1000 },
  { id:'7d',  label:'7d',  ms: 7*24*3600*1000 },
  { id:'15d', label:'15d', ms: 15*24*3600*1000 },
  { id:'30d', label:'30d', ms: 30*24*3600*1000 },
  { id:'all', label:'All', ms: null },
];
let changesRange = cfg('aura_changes_range') || 'all';
// Prefer full log if a short window was stuck from an older session
if(['15m','1h','3h','6h','12h'].includes(changesRange) && !cfg('aura_changes_range_ok')){
  changesRange = 'all';
}
const cacheKey = p => LS.cache + '_' + (p||statsPlat);
const histKey  = p => LS.hist  + '_' + (p||statsPlat);
const mhKey    = p => 'aura_mh_' + (p||statsPlat);
const CURVE_COLORS = ['#df4996','#3ddc84','#fdc468','#25f4ee','#8a3ab9','#fe2c55','#3b82f6','#f97316','#14b8a6','#eab308'];
/** Per-post curve UI state */
let postCurveMode = 'total'; // total | top | pick
let postCurvePick = [];     // selected media ids
let postCurveMetric = 'views'; // views | likes
/** Changes tab: single metric curve (views | likes) */
let chgMetric = cfg('aura_chg_metric') === 'likes' ? 'likes' : 'views';
/** Posts table sort — same as React: click column headers */
let chgPostSort = 'timestamp'; // timestamp | views | likes
let chgPostSortDir = 'desc'; // asc | desc

function fmt(n){
  n = +n||0; const a=Math.abs(n);
  if(a>=1e6) return (n/1e6).toFixed(a>=1e7?0:1).replace(/\.0$/,'')+'M';
  if(a>=1e3) return (n/1e3).toFixed(a>=1e4?0:1).replace(/\.0$/,'')+'K';
  return String(Math.round(n));
}
const pct = n => (Math.round(n*10)/10)+'%';
function ago(ts){ const s=(Date.now()-ts)/1e3; if(s<60)return'just now'; if(s<3600)return Math.floor(s/60)+'m ago';
  if(s<86400)return Math.floor(s/3600)+'h ago'; return Math.floor(s/86400)+'d ago'; }
function esc(s){ return (s||'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

let toastT;
function toast(msg,kind=''){ const t=$('#toast'); t.textContent=msg; t.className='show '+kind;
  clearTimeout(toastT); toastT=setTimeout(()=>t.className='',2600); }


function show(v){
  // Post removed — pack-only portal
  if(v !== 'insights') v = 'insights';
  document.querySelectorAll('.view').forEach(x=>x.classList.add('hide'));
  const el = $('#view-'+v);
  if(!el) return;
  el.classList.remove('hide');
  document.querySelectorAll('nav button').forEach(b=>b.classList.toggle('on', b.dataset.nav===v));
  window.scrollTo(0,0);
  if(v==='insights' && !insightsLoaded[statsPlat]) loadInsights(false);
}


function lkOk(){ return /^\d{4}$/.test(cfg(LS.lk)||''); }
function getLk(){ return cfg(LS.lk) || ''; }
function clrLk(){
  cfg(LS.lk, null);
  renderAcct();
  toast('Locked');
}
function askLk(force){
  if(!force && lkOk()) return Promise.resolve(true);
  return new Promise((resolve)=>{
    window._lkR = resolve;
    $('#lkGate').classList.remove('hide');
    ['lk0','lk1','lk2','lk3'].forEach((id,i)=>{
      const el=$('#'+id); if(!el) return;
      el.value='';
      el.oninput = ()=>{
        el.value = (el.value||'').replace(/\D/g,'').slice(0,1);
        if(el.value && i<3) $('#'+['lk0','lk1','lk2','lk3'][i+1])?.focus();
        if(i===3 && el.value) goLk();
      };
      el.onkeydown = (e)=>{
        if(e.key==='Backspace' && !el.value && i>0) $('#'+['lk0','lk1','lk2','lk3'][i-1])?.focus();
      };
    });
    $('#lkErr').textContent='';
    setTimeout(()=>$('#lk0')?.focus(), 50);
  });
}
async function goLk(){
  const dig = [0,1,2,3].map(i=>($('#lk'+i)?.value||'')).join('');
  if(!/^\d{4}$/.test(dig)){
    $('#lkErr').textContent='Required';
    return;
  }

  let ok = dig === DEFAULT_LK || dig === getLk();
  if(!ok && dig.length===4){

    try{
      const blob = await fetchPackBlob();
      if(blob){ await dx(blob, dig); ok = true; }
      else ok = true; // no pack yet — allow any 4-digit as new lock
    }catch{ ok = dig === DEFAULT_LK; }
  }
  if(!ok){
    $('#lkErr').textContent='Invalid';
    return;
  }
  cfg(LS.lk, dig);
  $('#lkGate').classList.add('hide');
  renderAcct();
  toast('OK','ok');
  const r = window._lkR; window._lkR=null;
  r?.(true);
  loadInsights(false);
}

function b64urlToBytes(s){
  s = (s||'').replace(/-/g,'+').replace(/_/g,'/');
  while(s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) out[i]=bin.charCodeAt(i);
  return out;
}
function bytesToB64url(buf){
  let s=''; const a=buf instanceof Uint8Array?buf:new Uint8Array(buf);
  for(let i=0;i<a.length;i++) s+=String.fromCharCode(a[i]);
  return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
async function dk(k){
  const enc = new TextEncoder();
  const base = await crypto.subtle.importKey('raw', enc.encode(k), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    {name:'PBKDF2', salt:enc.encode(PACK_SALT), iterations:PACK_ITERS, hash:'SHA-256'},
    base, 256
  );
  return new Uint8Array(bits);
}
async function packKeystream(key, iv, n){
  const out = new Uint8Array(n);
  let off=0, ctr=0;
  while(off < n){
    const block = new Uint8Array(key.length + iv.length + 4);
    block.set(key,0); block.set(iv, key.length);
    block[key.length+iv.length] = (ctr>>>24)&255;
    block[key.length+iv.length+1] = (ctr>>>16)&255;
    block[key.length+iv.length+2] = (ctr>>>8)&255;
    block[key.length+iv.length+3] = ctr&255;
    const dig = new Uint8Array(await crypto.subtle.digest('SHA-256', block));
    out.set(dig.subarray(0, Math.min(32, n-off)), off);
    off += 32; ctr++;
  }
  return out;
}
async function hmacSha256(keyBytes, dataBytes){
  const k = await crypto.subtle.importKey('raw', keyBytes, {name:'HMAC', hash:'SHA-256'}, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, dataBytes));
}
async function dx(blob,k){
  k = k || getLk() || DEFAULT_LK;
  if(!blob || !blob.c || !blob.i || !blob.m) throw new Error('invalid pack');
  const key = await dk(k);
  const iv = b64urlToBytes(blob.i);
  const ct = b64urlToBytes(blob.c);
  const mac = b64urlToBytes(blob.m);
  const macIn = new Uint8Array(iv.length + ct.length);
  macIn.set(iv,0); macIn.set(ct, iv.length);
  const expect = await hmacSha256(key, macIn);
  if(expect.length !== mac.length || !expect.every((b,i)=>b===mac[i]))
    throw new Error('denied');
  const ks = await packKeystream(key, iv, ct.length);
  const plain = new Uint8Array(ct.length);
  for(let i=0;i<ct.length;i++) plain[i]=ct[i]^ks[i];
  return JSON.parse(new TextDecoder().decode(plain));
}

function expandMediaHist(ph){
  ph = ph || {};
  const labels = Object.assign({}, ph.L || {});
  const series = {};
  Object.keys(ph.S || {}).forEach(mid => {
    const pts = (ph.S[mid] || []).map(row => ({
      ts: +row[0]||0, views: +row[1]||0, likes: +row[2]||0,
    })).filter(p => p.ts > 0);
    if(pts.length) series[String(mid)] = pts;
  });
  return { labels, series };
}

function expandPlatBlock(block, plat){
  block = block || {};
  const acc = block.a || {};
  const account = {
    username: acc.u||'', followers_count:+acc.f||0, follows_count:+acc.o||0,
    media_count:+acc.n||0, likes_count:+acc.k||0,
  };
  const history = (block.h||[]).map(row=>({
    ts:+row[0]||0, followers:+row[1]||0, views:+row[2]||0, likes:+row[3]||0,
    interactions:+row[4]||0, posts:+row[5]||0,
    reach:0, comments:0, shares:0, saved:+row[6]||0, watch:0, eng:0,
  }));
  const media = (block.m||[]).map(m=>{
    let ts = +m.x||0;
    if(ts && ts < 1e12) ts = ts*1000;
    return {
      id:m.d||'', caption:m.c||'', views:+m.v||0, likes:+m.l||0, shares:+m.s||0,
      comments:+m.r||0, eng:+m.e||0, permalink:m.p||'', ts, timestamp:m.x||0,
      reach:0, saved:+m.f||0, interactions:0, watch:0, thumb:'',
    };
  });
  let fetched = block.w || (history.length?history[history.length-1].ts:Date.now()/1000);
  if(fetched < 1e12) fetched *= 1000;
  const media_history = expandMediaHist(block.ph);
  return {
    fetched, account, media, blocked:'', media_moves:[],
    media_history,
    history: history.map(h => ({...h, ts:h.ts})),
    source:'pack', platform:plat,
  };
}

function ghRepo(){ return (cfg(LS.ghRepo)||GH_DEFAULTS.repo).trim(); }
function ghBranch(){ return (cfg(LS.ghBranch)||GH_DEFAULTS.branch).trim(); }
function ghPath(){ return (cfg(LS.ghPath)||GH_DEFAULTS.path).trim().replace(/^\/+/,''); }
function ghToken(){ return (cfg(LS.ghTok)||'').trim(); }
function ghAutoOn(){ return cfg(LS.ghAuto)==='1'; }

function packPublicUrls(){
  // Prefer raw.githubusercontent (tracks latest commit). Cache-bust always.
  // GH Pages / jsDelivr can lag; put them later.
  const bust = 't=' + Date.now();
  const withBust = (u) => u + (u.includes('?') ? '&' : '?') + bust;
  const urls = [];
  const custom = cfg(LS.packUrl);
  if(custom) urls.push(withBust(custom));

  const [owner, repo] = ghRepo().split('/');
  if(owner && repo){
    const branch = ghBranch();
    const path = ghPath();
    urls.push(withBust(`https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`));
    urls.push(withBust(`https://${owner}.github.io/${repo}/${path}`));
    urls.push(withBust(`https://cdn.jsdelivr.net/gh/${owner}/${repo}@${branch}/${path}`));
  }
  // last resort: pack next to portal HTML (can be a stale Pages copy)
  try{
    const rel = new URL('data/pack.v1.enc', location.href).href;
    urls.push(withBust(rel));
  }catch{}
  return [...new Set(urls.filter(Boolean))];
}

async function fetchPackBlob(){
  // 1) Token API first when available (always latest commit content)
  if(ghToken()){
    try{
      const meta = await ghGetFileMeta();
      if(meta?.content){
        const raw = atob(meta.content.replace(/\n/g,''));
        const j = JSON.parse(raw);
        if(j?.c && j?.i) return j;
      }
    }catch{}
  }
  // 2) Public URLs with cache bust
  for(const u of packPublicUrls()){
    try{
      const r = await fetch(u, {
        cache:'no-store',
        headers:{ 'Cache-Control':'no-cache', 'Pragma':'no-cache' },
        signal:AbortSignal.timeout?.(15000),
      });
      if(!r.ok) continue;
      const j = await r.json();
      if(j && j.c && j.i) return j;
    }catch{}
  }
  return null;
}

async function ex(plainObj,k){
  k = k || getLk() || DEFAULT_LK;
  const plain = new TextEncoder().encode(JSON.stringify(plainObj));
  const key = await dk(k);
  const iv = crypto.getRandomValues(new Uint8Array(16));
  const ks = await packKeystream(key, iv, plain.length);
  const ct = new Uint8Array(plain.length);
  for(let i=0;i<plain.length;i++) ct[i] = plain[i] ^ ks[i];
  const macIn = new Uint8Array(iv.length + ct.length);
  macIn.set(iv,0); macIn.set(ct, iv.length);
  const mac = await hmacSha256(key, macIn);
  return { v:1, alg:'xor-hmac-v1', i:bytesToB64url(iv), c:bytesToB64url(ct), m:bytesToB64url(mac) };
}

function compactMediaHist(plat){
  const mh = jget(mhKey(plat), null) || {labels:{}, series:{}};
  const labels = mh.labels || {};
  const series = mh.series || {};
  const ids = Object.keys(series).sort((a,b)=>{
    const pa = series[a]||[], pb = series[b]||[];
    const va = pa.length ? (+pa[pa.length-1].views||0) : 0;
    const vb = pb.length ? (+pb[pb.length-1].views||0) : 0;
    return vb - va;
  });
  const L = {}, S = {};
  ids.forEach(id => {
    L[id] = (labels[id] || id.slice(0,10)).slice(0,48);
    S[id] = (series[id]||[]).map(p => [toSec(p.ts), +p.views||0, +p.likes||0]);
  });
  return { L, S };
}

function compactSideFromCache(plat){
  const d = jget(cacheKey(plat), null) || {};
  const a = d.account || {};
  const hist = d.history?.length ? d.history : jget(histKey(plat), []);
  const media = d.media || [];
  // full account log (no artificial 10-cap)
  return {
    w: d.fetched ? (d.fetched>1e12?d.fetched/1000:d.fetched) : Date.now()/1000,
    a: {
      u: a.username||'', f:+a.followers_count||0, o:+a.follows_count||0,
      n:+a.media_count||0, k:+a.likes_count||0,
    },
    h: hist.map(h=>[
      toSec(h.ts), +h.followers||0, +h.views||0, +h.likes||0,
      +h.interactions||0, +h.posts||0,
    ]),
    m: media.slice(0,50).map(m=>({
      d:String(m.id||''), c:(m.caption||'').slice(0,120),
      v:+m.views||0, l:+m.likes||0, s:+m.shares||0, r:+m.comments||0,
      e:+m.eng||0, p:m.permalink||'',
      x: m.ts ? toSec(m.ts) : 0,
    })),
    ph: compactMediaHist(plat),
  };
}

function appendMediaHistory(plat, media, ts){
  ts = toSec(ts || Date.now());
  const store = jget(mhKey(plat), {labels:{}, series:{}}) || {labels:{}, series:{}};
  store.labels = store.labels || {};
  store.series = store.series || {};
  const priorTs = Math.max(0, ...Object.values(store.series).map(arr=>{
    const last = (arr||[])[(arr||[]).length-1];
    return last ? toSec(last.ts) : 0;
  }));
  (media||[]).forEach(m => {
    const id = String(m.id||'');
    if(!id) return;
    const lab = ((m.caption||'').split('\n')[0]||'').trim().slice(0,48) || id.slice(0,8);
    store.labels[id] = lab;
    const arr = store.series[id] = store.series[id] || [];
    const isNew = !arr.length;
    if(isNew && priorTs && priorTs < ts){
      arr.push({ ts:priorTs, views:0, likes:0 });
    }
    const last = arr[arr.length-1];
    if(last && !isNew && Math.abs(toSec(last.ts) - ts) < 3600){
      last.views = +m.views||0; last.likes = +m.likes||0; last.ts = ts;
    } else {
      arr.push({ ts, views:+m.views||0, likes:+m.likes||0 });
    }
  });
  jset(mhKey(plat), store);
  return store;
}

function mergeMediaHist(a, b){
  const out = { labels:{}, series:{} };
  [a,b].forEach(src => {
    if(!src) return;
    Object.assign(out.labels, src.labels||{});
    Object.keys(src.series||{}).forEach(id => {
      const map = new Map();
      [...(out.series[id]||[]), ...(src.series[id]||[])].forEach(p=>{
        if(!p || !p.ts) return;
        map.set(String(Math.round(toSec(p.ts))), {
          ts: toSec(p.ts), views:+p.views||0, likes:+p.likes||0,
        });
      });
      out.series[id] = [...map.values()].sort((x,y)=>x.ts-y.ts);
    });
  });
  return out;
}

async function buildLocalPackPlain(){
  return {
    v:1, w: Date.now()/1000,
    ig: compactSideFromCache('instagram'),
    tt: compactSideFromCache('tiktok'),
  };
}

async function ghGetFileMeta(){
  const tok = ghToken(); if(!tok) return null;
  const url = `https://api.github.com/repos/${ghRepo()}/contents/${ghPath()}?ref=${encodeURIComponent(ghBranch())}`;
  const r = await fetch(url, {
    headers:{ Authorization:'Bearer '+tok, Accept:'application/vnd.github+json' },
  });
  if(r.status===404) return null;
  if(!r.ok) throw new Error((await r.json().catch(()=>({}))).message || ('GitHub '+r.status));
  return r.json();
}

async function publishPackNow(){
  try{
    toast('…');
    await publishPackToGitHub();
    toast('synced','ok');
    renderAcct();
  }catch(e){ toast(e.message||'Upload failed','err'); }
}

function saveGitHub(){
  const t = ($('#ghToken')?.value||'').trim();
  if(t) cfg(LS.ghTok, t);
  else if(($('#ghToken')?.value||'') === '') {
    // leave existing token unless user clears explicitly via empty save of field with space? keep
  }
  // Allow clearing token: if field was focused empty and user saved after typing blank once
  const repo = ($('#ghRepo')?.value||'').trim() || GH_DEFAULTS.repo;
  const branch = ($('#ghBranch')?.value||'').trim() || GH_DEFAULTS.branch;
  const path = ($('#ghPath')?.value||'').trim() || GH_DEFAULTS.path;
  cfg(LS.ghRepo, repo);
  cfg(LS.ghBranch, branch);
  cfg(LS.ghPath, path);
  if($('#ghToken')) $('#ghToken').value='';
  renderAcct();
  toast('saved','ok');
}
async function testGitHub(){
  try{
    if(!lkOk()) await askLk(true);
    const res = await tryLoadPack({force:true});
    if(!res.ok) return toast(res.reason==='missing'?'empty pack':'pull fail: '+(res.reason||''),'err');
    const igN = res.counts?.ig||0, ttN = res.counts?.tt||0;
    const igH = (jget(histKey('instagram'),[])||[]).length;
    const ttH = (jget(histKey('tiktok'),[])||[]).length;
    toast('pull IG '+igN+'/'+igH+' · TT '+ttN+'/'+ttH,'ok');
    renderAcct();
    // Show merged React-style Overview on the full recovered range.
    changesRange = 'all';
    cfg('aura_changes_range','all');
    cfg('aura_changes_range_ok','1');
    insTab = 'overview';
    if(statsPlat) loadInsights(false);
  }catch(e){ toast(e.message||'Pull failed','err'); }
}
function fillSetupForms(){
  if($('#ghRepo') && !cfg(LS.ghRepo)) $('#ghRepo').value = GH_DEFAULTS.repo;
  else if($('#ghRepo')) $('#ghRepo').value = cfg(LS.ghRepo)||GH_DEFAULTS.repo;
  if($('#ghBranch')) $('#ghBranch').value = cfg(LS.ghBranch)||GH_DEFAULTS.branch;
  if($('#ghPath')) $('#ghPath').value = cfg(LS.ghPath)||GH_DEFAULTS.path;
  if($('#ghAuto')) $('#ghAuto').checked = ghAutoOn();
}


function applyPackPlain(plain, opts){
  opts = opts || {};
  // force=true (explicit Pull): pack overwrites local cache — no sticky 20:20 browser leftovers
  const force = !!opts.force;
  if(!plain) return {ig:0, tt:0, yt:0, packW:0};
  const counts = {ig:0, tt:0, yt:0, packW: toSec(plain.w||0)};
  for(const [key, plat] of [['ig','instagram'],['tt','tiktok'],['yt','youtube']]){
    const block = plain[key];
    if(!block) continue;
    const data = expandPlatBlock(block, plat);
    if(force){
      // Trust pack history/media as source of truth after fresh pull
      data.history = normalizeHist(data.history||[]);
      jset(histKey(plat), data.history);
      const mhPack = data.media_history || {labels:{},series:{}};
      jset(mhKey(plat), mhPack);
      data.media_history = mhPack;
      data.platform = plat;
      jset(cacheKey(plat), data);
    } else {
      data.history = mergeHistLists(jget(histKey(plat), []), data.history||[]);
      jset(histKey(plat), data.history);
      const mhLocal = jget(mhKey(plat), {labels:{},series:{}});
      const mhPack = data.media_history || {labels:{},series:{}};
      const mh = mergeMediaHist(mhLocal, mhPack);
      jset(mhKey(plat), mh);
      data.media_history = mh;
      const cur = jget(cacheKey(plat), null);
      const curFetched = toSec(cur?.fetched||0);
      const newFetched = toSec(data.fetched||0);
      if(data.media?.length || newFetched >= curFetched || !cur?.media?.length){
        data.platform = plat;
        jset(cacheKey(plat), data);
      } else {
        cur.history = data.history;
        cur.media_history = mh;
        jset(cacheKey(plat), cur);
      }
    }
    counts[key] = (jget(histKey(plat), [])||[]).length;
  }
  insightsLoaded.instagram = false;
  insightsLoaded.tiktok = false;
  return counts;
}

function _legacyKeys(){
  const out = [];
  try{ out.push(atob('ODAzMA==')); }catch{}
  try{ out.push(atob('MTc2Mg==')); }catch{}
  try{ out.push(atob('MjIwMA==')); }catch{}
  return out;
}

async function tryLoadPack(opts){
  opts = opts || {};
  if(!lkOk() && !opts.skipLk) return {ok:false, reason:'locked'};
  try{
    const blob = await fetchPackBlob();
    if(!blob) return {ok:false, reason:'missing'};
    const tryKeys = [];
    const cur = getLk() || DEFAULT_LK;
    if(cur) tryKeys.push(cur);
    _legacyKeys().forEach(k => { if(k && !tryKeys.includes(k)) tryKeys.push(k); });
    let plain = null, lastErr = null;
    for(const k of tryKeys){
      try{ plain = await dx(blob, k); break; }
      catch(e){ lastErr = e; }
    }
    if(!plain) throw lastErr || new Error('denied');
    // Explicit pull always force-applies pack over sticky localStorage
    const counts = applyPackPlain(plain, {force: opts.force !== false});
    return {ok:true, plain, counts, packW: counts.packW || toSec(plain.w||0)};
  }catch(e){
    return {ok:false, reason:e.message||'decrypt'};
  }
}


async function publishPackToGitHub(){
  const tok = ghToken();
  if(!tok) throw new Error('Missing token');
  if(!lkOk()) throw new Error('Locked');
  const k = getLk()||DEFAULT_LK;

  // Always merge remote first so per-post curves (ph) are not wiped by a thin local pack
  try{
    const remote = await fetchPackBlob();
    if(remote){
      let plain = null;
      const keys = [k, ..._legacyKeys()];
      for(const kk of keys){
        try{ plain = await dx(remote, kk); break; }catch{}
      }
      if(plain) applyPackPlain(plain);
    }
  }catch{}

  // Prefer richest media history when building
  for(const plat of ['instagram','tiktok']){
    const cur = jget(cacheKey(plat), null);
    if(cur?.media?.length) appendMediaHistory(plat, cur.media, cur.fetched);
  }

  const plain = await buildLocalPackPlain();
  // Never publish empty ph if we still have none — keep structure but ok
  const blob = await ex(plain, k);
  const bodyStr = JSON.stringify(blob);
  const b64 = btoa(unescape(encodeURIComponent(bodyStr)));
  let sha = null;
  try{ const meta = await ghGetFileMeta(); sha = meta?.sha || null; }catch{}
  const url = `https://api.github.com/repos/${ghRepo()}/contents/${ghPath()}`;
  const payload = {
    message: 'chore: update stats pack',
    content: b64,
    branch: ghBranch(),
  };
  if(sha) payload.sha = sha;
  const r = await fetch(url, {
    method:'PUT',
    headers:{
      Authorization:'Bearer '+tok,
      Accept:'application/vnd.github+json',
      'Content-Type':'application/json',
    },
    body: JSON.stringify(payload),
  });
  const j = await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(j.message || ('GitHub upload failed '+r.status));
  return j;
}

async function maybeAutoPublishPack(){
  // Portal is read-only: never push to GitHub (PC / phone-sync write packs).
  return;
}


function setTheme(t){
  cfg(LS.theme,t);
  const dark = t==='dark' || (t==='auto' && matchMedia('(prefers-color-scheme:dark)').matches);
  document.documentElement.setAttribute('data-theme', dark?'dark':'light');
  document.querySelectorAll('[data-theme-btn]').forEach(b=>b.classList.toggle('on', b.dataset.themeBtn===t));
}


async function getJSON(url){
  const r = await fetch(url);
  const j = await r.json().catch(()=>({}));
  return j;
}
async function post(url, body){
  const r = await fetch(url,{method:'POST',body});
  return r.json().catch(()=>({}));
}


function igToken(){ return cfg(LS.tok)||''; }
function ttToken(){ return cfg(LS.tt)||''; }

async function linkIG(){
  const t = $('#igToken').value.trim();
  if(!t) return toast('Paste a token first','err');
  toast('Linking…');
  const j = await getJSON(`${G}/me?fields=user_id,username&access_token=${encodeURIComponent(t)}`);
  if(!j.username){ return toast(j.error?.message || 'Invalid token','err'); }
  cfg(LS.tok,t); cfg('aura_user', j.username);
  $('#igToken').value=''; renderAcct(); toast('Linked as @'+j.username,'ok');
  insightsLoaded.instagram=false;
}
function unlinkIG(){ cfg(LS.tok,null); cfg('aura_user',null); cfg(LS.texp,null); cfg(LS.tref,null); renderAcct(); toast('Unlinked'); }

async function linkTT(){
  const t = ($('#ttToken')?.value||'').trim();
  if(!t) return toast('Paste a TikTok user access_token first','err');
  toast('Verifying TikTok…');
  try{
    const acct = await ttFetchAccount(t);
    if(!acct.username && !acct.followers_count){
      throw new Error('Token valid response empty — need user.info.basic + user.info.stats');
    }
    cfg(LS.tt, t);
    cfg(LS.ttUser, acct.username || 'tiktok');
    if($('#ttToken')) $('#ttToken').value='';
    insightsLoaded.tiktok=false;
    renderAcct();
    toast('Linked TikTok as @'+(acct.username||'user'),'ok');
  }catch(e){
    const msg = e.message||String(e);
    if(/Failed to fetch|NetworkError|CORS|Load failed/i.test(msg)){
      toast('Blocked','err');

      cfg(LS.tt, t);
      if($('#ttToken')) $('#ttToken').value='';
      renderAcct();
    } else {
      toast(msg,'err');
    }
  }
}
function unlinkTT(){
  cfg(LS.tt, null); cfg(LS.ttUser, null);
  renderAcct();
  toast('TikTok token cleared');
}


async function ttFetchAccount(token){
  token = token || ttToken();
  const url = `${TT_API}/user/info/?fields=${encodeURIComponent(TT_USER_FIELDS)}`;
  const r = await fetch(url, {
    headers:{ Authorization:'Bearer '+token },
  });
  const j = await r.json().catch(()=>({}));
  const err = j.error || {};
  if(err.code && err.code !== 'ok'){
    throw new Error(err.message || err.code || 'TikTok user.info failed');
  }
  if(!r.ok && !j.data){
    throw new Error(err.message || ('TikTok HTTP '+r.status));
  }
  const u = (j.data||{}).user || {};
  return {
    username: u.display_name || '',
    followers_count: u.follower_count || 0,
    follows_count: u.following_count || 0,
    media_count: u.video_count || 0,
    likes_count: u.likes_count || 0,
  };
}

async function ttFetchVideos(token, onProgress){
  token = token || ttToken();
  const out = [];
  let cursor = null;
  while(out.length < MAX){
    onProgress?.(`videos ${out.length}…`, 0.2 + 0.6*(out.length/MAX));
    const body = { max_count: 20 };
    if(cursor) body.cursor = cursor;
    const r = await fetch(
      `${TT_API}/video/list/?fields=${encodeURIComponent(TT_VIDEO_FIELDS)}`,
      {
        method:'POST',
        headers:{
          Authorization:'Bearer '+token,
          'Content-Type':'application/json',
        },
        body: JSON.stringify(body),
      }
    );
    const j = await r.json().catch(()=>({}));
    const err = j.error || {};
    if(err.code && err.code !== 'ok'){
      throw new Error(err.message || err.code || 'video.list failed — need video.list scope');
    }
    const d = j.data || {};
    const vids = d.videos || [];
    out.push(...vids);
    if(!d.has_more || !vids.length) break;
    cursor = d.cursor;
  }
  return out.slice(0, MAX);
}

function shapeTTVideo(v){
  const views = v.view_count||0, likes = v.like_count||0;
  const comments = v.comment_count||0, shares = v.share_count||0;
  const inter = likes+comments+shares;
  const ct = v.create_time||0;
  const ts = ct ? ct*1000 : 0;
  return {
    id:String(v.id||''), caption:v.title||'',
    permalink:v.share_url||'', thumb:v.cover_image_url||'',
    ts, type:'VIDEO', product:'',
    views, reach:0, likes, comments, shares, saved:0,
    interactions:inter, watch:0,
    eng: views ? Math.round(inter/views*1000)/10 : 0,
  };
}

async function fetchTikTokInsights(onProgress){
  const t = ttToken();
  if(!t) throw new Error('Link TikTok in Setup (user access_token with video.list + user.info.stats).');
  onProgress?.('TikTok account…', 0.1);
  let acct;
  try{
    acct = await ttFetchAccount(t);
  }catch(e){
    const msg = e.message||String(e);
    if(/Failed to fetch|NetworkError|CORS|Load failed/i.test(msg)){
      throw new Error('Blocked');
    }
    throw e;
  }
  cfg(LS.ttUser, acct.username||cfg(LS.ttUser)||'');
  onProgress?.('TikTok videos…', 0.25);
  const raw = await ttFetchVideos(t, onProgress);
  const media = raw.map(shapeTTVideo);
  const out = {
    fetched: Date.now(), account: acct, media,
    blocked:'', media_moves:[], source:'tiktok', platform:'tiktok',
  };
  jset(cacheKey('tiktok'), out);
  pushHistory(out, 'tiktok');
  onProgress?.('done',1);
  return out;
}


async function refreshToken(){
  const t = igToken(); if(!t) return;
  if(Date.now()-(+cfg(LS.tref)||0) < 20*60*60*1000) return;   // at most once per ~20h
  cfg(LS.tref, Date.now());                                    // record attempt regardless
  try{
    const j = await getJSON(`https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(t)}`);
    if(j.access_token){
      cfg(LS.tok, j.access_token);
      if(j.expires_in) cfg(LS.texp, Date.now()+j.expires_in*1000);
      renderAcct();
    }
  }catch{}
}

function renderAcct(){
  const lkOn = lkOk();
  if($('#acct')){
    $('#acct').innerHTML = `<span class="dot ${lkOn?'on':'off'}"></span>${lkOn?'unlocked':'locked'}`;
  }
  const lkPill = $('#lkPill');
  if(lkPill){
    lkPill.textContent = lkOn ? 'unlocked' : 'locked';
    lkPill.className = 'pill '+(lkOn?'ok':'warn');
  }
  const homeLk = $('#homePinPill');
  if(homeLk){
    homeLk.textContent = lkOn ? 'unlocked' : 'locked';
    homeLk.className = 'pill '+(lkOn?'ok':'warn');
  }
  // Optional token only for private repos; public raw works without it
  const ghOn = !!ghToken();
  const ghPill = $('#ghPill');
  if(ghPill){
    ghPill.textContent = ghOn ? 'token ok' : 'public';
    ghPill.className = 'pill '+(ghOn?'ok':'');
  }
  const homeGh = $('#homeGhPill');
  if(homeGh){
    homeGh.textContent = 'gh-pages';
    homeGh.className = 'pill ok';
  }
  // leftover elements from removed IG/TT/Groq UI
  ['#igPill','#ttPill','#grPill'].forEach(sel=>{
    const el = $(sel); if(el) el.className = 'pill hide';
  });
}


async function fetchInsights(onProgress){
  const t = igToken();
  if(!t) throw new Error('Link your Instagram account first (Setup).');
  onProgress?.('account…',0.05);
  const acct = await getJSON(`${G}/me?fields=username,followers_count,follows_count,media_count&access_token=${t}`);
  if(acct.error) throw new Error(acct.error.message);

  const flds='id,caption,media_type,media_product_type,permalink,timestamp,thumbnail_url,media_url,like_count,comments_count';
  const metrics='views,reach,likes,comments,shares,saved,total_interactions,ig_reels_avg_watch_time';
  onProgress?.('media + metrics…',0.2);
  let media=[], blocked='';
  let j = await getJSON(`${G}/me/media?fields=${flds},insights.metric(${metrics})&limit=${MAX}&access_token=${t}`);
  if(!j.error && j.data){
    media = j.data.map(m=>flatten(m, m.insights?.data));
  } else {

    onProgress?.('media list…',0.25);
    j = await getJSON(`${G}/me/media?fields=${flds}&limit=${MAX}&access_token=${t}`);
    if(j.error) throw new Error(j.error.message);
    media = (j.data||[]).map(m=>flatten(m,null));
    for(let i=0;i<media.length;i++){
      onProgress?.(`insights ${i+1}/${media.length}…`, 0.25+0.7*(i/media.length));
      if(blocked) break;
      try{ Object.assign(media[i], await mediaInsights(media[i].id, t)); }
      catch(e){ if(e.blocked){ blocked=e.message; } }

      media[i].eng = media[i].reach ? round1(media[i].interactions/media[i].reach*100) : 0;
    }
  }
  const out = { fetched:Date.now(), account:acct, media, blocked, source:'graph', platform:'instagram' };
  jset(cacheKey('instagram'), out);
  pushHistory(out, 'instagram');
  onProgress?.('done',1);
  return out;
}

function flatten(m, ins){
  const g=(name)=>{ const d=(ins||[]).find(x=>x.name===name); return (d?.values?.[0]?.value)||0; };
  const o={
    id:m.id, caption:m.caption||'', type:m.media_type, product:m.media_product_type,
    permalink:m.permalink, thumb:m.thumbnail_url||m.media_url||'', ts:Date.parse(m.timestamp),
    views:g('views'), reach:g('reach'),
    likes:g('likes')||m.like_count||0, comments:g('comments')||m.comments_count||0,
    shares:g('shares'), saved:g('saved'), interactions:g('total_interactions'),
    watch:round1((g('ig_reels_avg_watch_time')||0)/1000),
  };
  o.eng = o.reach ? round1(o.interactions/o.reach*100) : 0;
  return o;
}
const round1 = n => Math.round((+n||0)*10)/10;

async function mediaInsights(id, t){
  let metrics=['views','reach','likes','comments','shares','saved','total_interactions','ig_reels_avg_watch_time'];
  while(metrics.length){
    const j = await getJSON(`${G}/${id}/insights?metric=${metrics.join(',')}&access_token=${t}`);
    if(j.data){
      const v={}; j.data.forEach(d=>v[d.name]=(d.values?.[0]?.value)||0);
      return { views:v.views||0, reach:v.reach||0, likes:v.likes||0, comments:v.comments||0,
               shares:v.shares||0, saved:v.saved||0, interactions:v.total_interactions||0,
               watch:round1((v.ig_reels_avg_watch_time||0)/1000) };
    }
    const msg=j.error?.message||'';
    if(j.error?.code===10 || /permission/i.test(msg)){ const e=new Error(msg); e.blocked=true; throw e; }
    const drop = metrics.filter(m=>msg.includes(m));
    if(!drop.length) return {};
    metrics = metrics.filter(m=>!drop.includes(m));
  }
  return {};
}


function toSec(ts){
  ts = +ts||0;
  return ts > 1e12 ? ts/1000 : ts;
}


function pushHistory(out, plat){
  plat = plat || statsPlat;
  const a=out.account||{}, m=out.media||[], sum=(k)=>m.reduce((s,x)=>s+(x[k]||0),0);
  const w=m.filter(x=>x.watch).map(x=>x.watch);
  const reach=sum('reach'), inter=sum('interactions'), N=Math.max(1,m.length);
  const snap={ ts:toSec(out.fetched||Date.now()), followers:a.followers_count||0, posts:a.media_count||m.length||0, n:m.length,
    views:sum('views'), reach, likes:sum('likes'), comments:sum('comments'),
    shares:sum('shares'), saved:sum('saved'), interactions:inter,
    avgViews:round1(sum('views')/N), avgReach:round1(reach/N),
    avgViral:round1((sum('saved')+sum('shares'))/N),
    watch: w.length?round1(w.reduce((s,x)=>s+x,0)/w.length):0,
    eng: reach?round1(inter/reach*100):(sum('views')?round1(inter/sum('views')*100):0) };
  const h=normalizeHist(jget(histKey(plat),[]));

  if(h.length && Math.abs(snap.ts - toSec(h[h.length-1].ts)) < 3600) h[h.length-1]=snap; else h.push(snap);
  const merged = h;
  jset(histKey(plat), merged);
  out.history = merged;
  // per-post curves from this refresh
  if(m.length){
    const mh = appendMediaHistory(plat, m, snap.ts);
    out.media_history = mh;
  }
  return merged;
}

function normalizeHist(hist){
  return (hist||[]).map(h=>({
    ...h,
    ts: toSec(h.ts),
    followers:+h.followers||0,
    views:+h.views||0,
    likes:+h.likes||0,
    interactions:+h.interactions||0,
    posts:+h.posts||+h.n||0,
  })).filter(h=>h.ts>0).sort((a,b)=>a.ts-b.ts);
}


function withHistory(data, plat){
  if(!data) return data;
  plat = plat || data.platform || statsPlat;
  const fromData = normalizeHist(data.history||[]);
  const fromLS = normalizeHist(jget(histKey(plat), []));
  const map = new Map();
  [...fromLS, ...fromData].forEach(h=> map.set(String(Math.round(h.ts)), h));
  const merged = [...map.values()].sort((a,b)=>a.ts-b.ts);
  jset(histKey(plat), merged);
  data.history = merged;
  data.platform = plat;
  data.media_history = mergeMediaHist(
    jget(mhKey(plat), {labels:{},series:{}}),
    data.media_history || {labels:{},series:{}},
  );
  jset(mhKey(plat), data.media_history);
  return data;
}

function mergeHistLists(a, b){
  const map = new Map();
  [...normalizeHist(a), ...normalizeHist(b)].forEach(h=> map.set(String(Math.round(h.ts)), h));
  return [...map.values()].sort((x,y)=>x.ts-y.ts);
}

function setStatsPlat(p){
  if(p!=='instagram' && p!=='tiktok') return;
  statsPlat = p;
  cfg(LS.plat, p);
  document.querySelectorAll('#platChips [data-plat]').forEach(b=>{
    b.classList.toggle('on', b.dataset.plat===p);
    b.classList.toggle('tt', p==='tiktok' && b.dataset.plat==='tiktok');
    b.classList.toggle('ig', p==='instagram' && b.dataset.plat==='instagram');
  });

  if(p==='tiktok') document.documentElement.style.setProperty('--accent','#fe2c55');
  else document.documentElement.style.setProperty('--accent','#df4996');
  insightsLoaded[p]=false;
  loadInsights(false);
}
function setInsTab(t){
  if(t === 'charts' || t === 'changes') t = 'overview';
  if(t === 'top') t = 'timing';
  insTab = t;
  document.querySelectorAll('#insTabs [data-tab]').forEach(b=>b.classList.toggle('on', b.dataset.tab===t));
  if(lastInsights) renderInsights(lastInsights);
}
function setChangesRange(id){
  if(!CHANGES_RANGES.some(r=>r.id===id)) return;
  changesRange = id;
  cfg('aura_changes_range', id);
  cfg('aura_changes_range_ok', '1');
  if(lastInsights) renderInsights(lastInsights);
}

function histTsMs(ts){
  ts = +ts||0;
  return ts > 1e12 ? ts : ts * 1000;
}

/** Range cutoff in ms — from *now*, matching React (not last hist sample). */
function rangeCutMs(rangeId){
  const opt = CHANGES_RANGES.find(r=>r.id===rangeId) || CHANGES_RANGES[CHANGES_RANGES.length-1];
  if(opt.ms == null) return 0;
  return Date.now() - opt.ms;
}
/** Range cutoff in unix seconds. */
function rangeCutSec(rangeId){
  const ms = rangeCutMs(rangeId);
  return ms > 0 ? ms / 1000 : 0;
}

/**
 * Account history in range [now-window, now].
 * Does NOT pull ancient “baseline” samples into the series (that made 6h show July 16).
 * For delta charts, use first point in-window as zero — or valueAtOrBeforeCut for base.
 */
function filterHistByRange(hist, rangeId){
  hist = hist || [];
  if(hist.length < 2) return hist.slice();
  const opt = CHANGES_RANGES.find(r=>r.id===rangeId) || CHANGES_RANGES[CHANGES_RANGES.length-1];
  if(opt.ms == null) return hist.slice();
  const cut = rangeCutMs(rangeId);
  const inRange = hist.filter(h => histTsMs(h.ts) >= cut);
  // Need ≥2 snaps for a curve; if window is empty/thin, fall back to last few recent points
  if(inRange.length >= 2) return inRange;
  if(inRange.length === 1){
    // include immediate previous only if still “recent” (≤ 2× window), else just the one
    const idx = hist.indexOf(inRange[0]);
    if(idx > 0){
      const prev = hist[idx - 1];
      const gap = histTsMs(inRange[0].ts) - histTsMs(prev.ts);
      if(gap <= opt.ms * 2) return [prev, inRange[0]];
    }
    return inRange;
  }
  // nothing in window — last 2 samples only if last is not ancient
  const last = hist[hist.length - 1];
  if(histTsMs(last.ts) < cut - opt.ms) return []; // data too old for this range
  return hist.slice(-Math.min(2, hist.length));
}
function changesRangeChips(){
  return `<div class="chipset" id="chgRangeChips" style="margin:0 0 12px">
    ${CHANGES_RANGES.map(r=>
      `<button type="button" class="chip${r.id===changesRange?' on':''}" data-range="${r.id}" onclick="setChangesRange('${r.id}')">${r.label}</button>`
    ).join('')}
  </div>`;
}
function rngLabelSafe(){
  return (CHANGES_RANGES.find(r=>r.id===changesRange)||{}).label || changesRange;
}
function packHint(n){
  if(n>=10) return ' · pack/pull looks good';
  if(n>=2) return ' · short log (try Setup → Pull or range All)';
  return ' · empty — Setup → Pull';
}

function setChgMetric(m){
  chgMetric = m === 'likes' ? 'likes' : 'views';
  cfg('aura_chg_metric', chgMetric);
  if(lastInsights) renderInsights(lastInsights);
}
function setChgPostSort(k){
  if(chgPostSort === k) chgPostSortDir = chgPostSortDir === 'asc' ? 'desc' : 'asc';
  else {
    chgPostSort = k;
    chgPostSortDir = 'desc';
  }
  if(lastInsights) renderInsights(lastInsights);
}

/** Full ints like React (1,565 not 1.6K). */
function fmtFull(n){
  n = Math.round(+n||0);
  return n.toLocaleString('en-US');
}
function signedFull(n){
  n = +n||0;
  if(n > 0) return '+'+fmtFull(n);
  if(n < 0) return fmtFull(n);
  return '0';
}

/** Per-post Δ over selected range — cut from *now* (React postRangeDelta). */
function postRangeDeltaPortal(pts, rangeId, key){
  pts = (pts || []).slice().sort((a,b)=>toSec(a.ts)-toSec(b.ts));
  if(!pts.length) return null;
  const opt = CHANGES_RANGES.find(r=>r.id===rangeId) || CHANGES_RANGES[CHANGES_RANGES.length-1];
  let inRange = pts;
  if(opt.ms != null){
    const cutMs = rangeCutMs(rangeId);
    inRange = pts.filter(p => histTsMs(p.ts) >= cutMs);
    // baseline = last sample *at or before* cut (for true window delta), not shown as a row
    if(inRange.length){
      const val = p => key === 'likes' ? (+p.likes||0) : (+p.views||0);
      let base = null;
      for(const p of pts){
        if(histTsMs(p.ts) <= cutMs) base = val(p);
        else break;
      }
      const last = val(inRange[inRange.length-1]);
      if(base != null) return last - base;
      return last - val(inRange[0]);
    }
    return null;
  }
  if(inRange.length < 1) return null;
  const val = p => key === 'likes' ? (+p.likes||0) : (+p.views||0);
  return val(inRange[inRange.length-1]) - val(inRange[0]);
}

/** React-compatible all-post totals inside the selected window. */
function postRangeSummaryPortal(d, plat, rangeId){
  const mh = d.media_history || jget(mhKey(plat), {labels:{},series:{}}) || {labels:{},series:{}};
  const series = mh.series || {};
  const ids = Object.keys(series);
  const cut = rangeCutSec(rangeId);
  const times = [...new Set(ids.flatMap(id => (series[id]||[])
    .map(p=>toSec(p.ts)).filter(t=>t>0 && t>=cut)))].sort((a,b)=>a-b);
  const totals = times.map(ts=>{
    let views=0, likes=0, n=0;
    ids.forEach(id=>{
      const pts=(series[id]||[]).slice().sort((a,b)=>toSec(a.ts)-toSec(b.ts));
      let pLast=null;
      for(const p of pts){
        const t=toSec(p.ts);
        if(t<cut) continue;
        if(t>ts) break;
        pLast=p;
      }
      if(pLast){ views += +pLast.views||0; likes += +pLast.likes||0; n++; }
    });
    return {ts,views,likes,n};
  }).filter(x=>x.n>0);
  if(totals.length<2) return null;
  return {
    snaps: totals.length,
    views: totals[totals.length-1].views-totals[0].views,
    likes: totals[totals.length-1].likes-totals[0].likes,
    hours: Math.max(.01,(totals[totals.length-1].ts-totals[0].ts)/3600),
  };
}

/**
 * Combined all-posts curve — single metric (Views | Likes), count delta only.
 * Prefer account history (updated every APK/PC pack push) over per-post ph when
 * history is newer — old APK builds left ph empty so curves stuck on PC timestamps.
 */
function buildCombinedChangesCurve(d, plat, rangeId, forcedMetric, showSwitch=true){
  const metric = forcedMetric || (chgMetric === 'likes' ? 'likes' : 'views');
  const color = metric === 'likes' ? '#fdc468' : '#df4996';
  const chips = showSwitch ? `
    <div class="chipset" style="margin:0 0 10px">
      <button type="button" class="chip${metric==='views'?' on':''}" onclick="setChgMetric('views')">Views</button>
      <button type="button" class="chip${metric==='likes'?' on':''}" onclick="setChgMetric('likes')">Likes</button>
    </div>` : '';

  const opt = CHANGES_RANGES.find(r=>r.id===rangeId) || CHANGES_RANGES[CHANGES_RANGES.length-1];
  const cutSec = rangeCutSec(rangeId);
  const mh = d.media_history || jget(mhKey(plat), {labels:{},series:{}}) || {labels:{},series:{}};
  const postSummary = postRangeSummaryPortal(d, plat, rangeId);

  const buildFromVals = (pts, srcNote) => {
    if(!pts || pts.length < 2) return null;
    const base = +pts[0].val||0;
    const end = +pts[pts.length-1].val||0;
    const gain = end - base;
    const labs = pts.map((p, i) => {
      if(i === 0 && opt.ms != null && Math.abs(toSec(p.ts) - cutSec) < 2){
        return 'start';
      }
      return new Date(histTsMs(p.ts)).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
    });
    const vals = pts.map(p => (+p.val||0) - base);
    const gainNote = Math.abs(gain) >= 1
      ? metric+' '+signedFmt(gain)+' in range'
      : 'no measurable '+metric+' change';
    const lastWhen = new Date(histTsMs(pts[pts.length-1].ts)).toLocaleTimeString();
    return chips + chartCard(
      'All posts · '+metric+' delta',
      'Last '+rngLabelSafe()+' · '+gainNote+' · last snap '+lastWhen+' · '+srcNote,
      curveChart([{name: metric==='likes'?'Likes':'Views', vals, color}], labs, {zeroBase:true}),
    );
  };

  // --- Account history path (pack h[]) — always has APK/PC push timestamps ---
  const histAll = histFor(d);
  let hist = filterHistByRange(histAll, rangeId);
  if(!postSummary && hist.length >= 2){
    let absPts = hist.map(h => ({
      ts: toSec(h.ts),
      val: metric === 'likes' ? (+h.likes||0) : (+h.views||0),
    }));
    // true window open baseline from last point before cut
    if(opt.ms != null){
      const cut = cutSec;
      let baseVal = null;
      for(const h of normalizeHist(histAll)){
        if(toSec(h.ts) <= cut) baseVal = metric === 'likes' ? (+h.likes||0) : (+h.views||0);
        else break;
      }
      absPts = absPts.filter(p => p.ts >= cut - 1);
      if(baseVal != null && absPts.length){
        absPts = [{ts: cut, val: baseVal}, ...absPts];
      }
    }
    if(absPts.length >= 2){
      const html = buildFromVals(absPts, absPts.length+' account snaps · '+rngLabelSafe());
      if(html) return html;
    }
  }

  // --- Fallback: per-post media_history (ph) ---
  const series = mh.series || {};
  let ids = Object.keys(series);
  if(!ids.length) ids = (d.media||[]).map(m=>String(m.id)).filter(Boolean);

  if(!ids.length && !(histAll||[]).length){
    return chips + `<div class="card tiny muted">No curve data yet. Refresh or Pull pack.</div>`;
  }

  const tsSet = new Set();
  ids.forEach(id => (series[id]||[]).forEach(p => {
    const t = toSec(p.ts);
    if(t > 0) tsSet.add(t);
  }));
  // Inject live media totals at pack fetched time so last point isn't stuck on old PC ph
  const liveTs = toSec(d.fetched || Date.now());
  if(liveTs > 0 && (d.media||[]).length){
    tsSet.add(liveTs);
    (d.media||[]).forEach(m => {
      const id = String(m.id||'');
      if(!id) return;
      if(!series[id]) series[id] = [];
      const last = series[id][series[id].length-1];
      if(!last || Math.abs(toSec(last.ts) - liveTs) > 30){
        series[id] = [...series[id], {
          ts: liveTs,
          views: +m.views||0,
          likes: +m.likes||0,
        }];
      }
    });
  }
  let times = [...tsSet].sort((a,b)=>a-b);
  if(opt.ms != null && times.length){
    times = times.filter(t => t >= cutSec);
  }

  if(times.length >= 1){
    const absPts = [];
    times.forEach(ts => {
      let sum = 0, n = 0;
      ids.forEach(id => {
        const pts = (series[id]||[]).slice().sort((a,b)=>toSec(a.ts)-toSec(b.ts));
        if(!pts.some(p => toSec(p.ts) >= cutSec && toSec(p.ts) <= ts)) return;
        let v;
        for(const p of pts){
          if(toSec(p.ts) < cutSec) continue;
          if(toSec(p.ts) > ts) break;
          v = metric === 'likes' ? (+p.likes||0) : (+p.views||0);
        }
        if(v === undefined) return;
        sum += v; n += 1;
      });
      if(n > 0) absPts.push({ts, val:sum});
    });
    const plotPts = absPts;
    if(plotPts.length >= 2){
      const html = buildFromVals(plotPts, absPts.length+' post-curve snaps · '+ids.length+' posts');
      if(html) return html;
    }
  }

  return chips + `<div class="card tiny muted">Need 2+ samples in this range.</div>`;
}

/** Posts table — same layout as React Changes (column headers, full ints + range Δ). */
function changesPostsListHtml(d, plat, rangeId){
  const mh = d.media_history || jget(mhKey(plat), {labels:{},series:{}}) || {labels:{},series:{}};
  const series = mh.series || {};
  const labels = mh.labels || {};
  const media = d.media || [];
  const rows = media.map(m => {
    const id = String(m.id||'');
    const pts = series[id] || series[m.id] || [];
    const last = pts.length ? pts[pts.length-1] : null;
    return {
      id,
      caption: (m.caption || labels[id] || id || '').split('\n')[0],
      permalink: m.permalink || '',
      timestamp: m.timestamp || m.ts || '',
      views: +m.views || (last && +last.views) || 0,
      likes: +m.likes || (last && +last.likes) || 0,
      dViews: postRangeDeltaPortal(pts, rangeId, 'views'),
      dLikes: postRangeDeltaPortal(pts, rangeId, 'likes'),
    };
  });
  const dir = chgPostSortDir === 'asc' ? 1 : -1;
  rows.sort((a,b) => {
    if(chgPostSort === 'views') return (a.views - b.views) * dir;
    if(chgPostSort === 'likes') return (a.likes - b.likes) * dir;
    const ta = a.timestamp ? new Date(typeof a.timestamp === 'number' && a.timestamp < 1e12 ? a.timestamp*1000 : a.timestamp).getTime() : 0;
    const tb = b.timestamp ? new Date(typeof b.timestamp === 'number' && b.timestamp < 1e12 ? b.timestamp*1000 : b.timestamp).getTime() : 0;
    const na = isNaN(ta) ? 0 : ta;
    const nb = isNaN(tb) ? 0 : tb;
    return (na - nb) * dir;
  });

  const deltaCell = (n) => {
    if(n == null || n === 0) return '';
    const cls = n > 0 ? 'up' : 'down';
    return `<span class="delta ${cls} pts-d">(${signedFull(n)})</span>`;
  };
  const th = (key, lab, align) => {
    const on = chgPostSort === key;
    const arrow = on ? (chgPostSortDir === 'asc' ? ' ↑' : ' ↓') : '';
    return `<th class="pts-th ${align}${on?' on':''}" onclick="setChgPostSort('${key}')">${esc(lab)}${arrow}</th>`;
  };

  if(!rows.length){
    return `<div class="card tiny muted">No posts in cache for this platform.</div>`;
  }

  let html = `<div class="card pts-card">
    <div class="pts-head">
      <b>Posts</b>
      <div class="tiny muted">Δ for ${esc(rngLabelSafe())} · tap column headers to sort</div>
    </div>
    <div class="pts-scroll">
      <table class="pts-table">
        <thead><tr>
          ${th('timestamp','Post','left')}
          ${th('views','Views','right')}
          ${th('likes','Likes','right')}
        </tr></thead>
        <tbody>`;
  rows.forEach(r => {
    const cap = esc((r.caption || r.id || '').slice(0, 48));
    let whenTxt = '—';
    try {
      const raw = r.timestamp;
      const ms = typeof raw === 'number'
        ? (raw < 1e12 ? raw*1000 : raw)
        : Date.parse(raw);
      if(ms && !isNaN(ms)) whenTxt = ago(ms);
    } catch{}
    const hrefJs = r.permalink ? JSON.stringify(String(r.permalink)) : 'null';
    html += `<tr class="pts-row" onclick='var u=${hrefJs};if(u)window.open(u,"_blank")'>
      <td class="pts-post">
        <div class="pts-cap" title="${cap}">${cap||'(no caption)'}</div>
        <div class="pts-ago">${esc(whenTxt)}</div>
      </td>
      <td class="pts-num">
        <span class="pts-v">${fmtFull(r.views)}</span>${deltaCell(r.dViews)}
      </td>
      <td class="pts-num">
        <span class="pts-v">${fmtFull(r.likes)}</span>${deltaCell(r.dLikes)}
      </td>
    </tr>`;
  });
  html += `</tbody></table></div></div>`;
  return html;
}

function setPostCurveMode(mode){
  postCurveMode = mode;
  if(lastInsights) renderInsights(lastInsights);
}
function setPostCurveMetric(met){
  postCurveMetric = met === 'likes' ? 'likes' : 'views';
  if(lastInsights) renderInsights(lastInsights);
}
function togglePostPick(id){
  id = String(id);
  const i = postCurvePick.indexOf(id);
  if(i>=0) postCurvePick.splice(i,1);
  else {
    postCurvePick.push(id);
    if(postCurvePick.length > 8) postCurvePick.shift();
  }
  postCurveMode = 'pick';
  if(lastInsights) renderInsights(lastInsights);
}

/** Align per-post series onto shared timestamps in selected range. */
function buildPostCurveHtml(d, plat, rangeId){
  const mh = d.media_history || jget(mhKey(plat), {labels:{},series:{}}) || {labels:{},series:{}};
  const labels = mh.labels || {};
  const series = mh.series || {};
  const idsAll = Object.keys(series);
  if(!idsAll.length && !(d.media||[]).length){
    return `<div class="card tiny muted">No per-post history yet. Pull pack after PC refreshes, or Refresh on portal a few times.</div>`;
  }

  // rank by latest views
  const ranked = (idsAll.length ? idsAll : (d.media||[]).map(x=>String(x.id))).slice().sort((a,b)=>{
    const pa = series[a]||[], pb = series[b]||[];
    const va = pa.length ? +pa[pa.length-1].views||0 : +(d.media||[]).find(m=>String(m.id)===a)?.views||0;
    const vb = pb.length ? +pb[pb.length-1].views||0 : +(d.media||[]).find(m=>String(m.id)===b)?.views||0;
    return vb - va;
  });

  let active = [];
  if(postCurveMode === 'total'){
    active = ['__total__'];
  } else if(postCurveMode === 'pick' && postCurvePick.length){
    active = postCurvePick.slice();
  } else {
    active = ranked.slice(0, 5); // top 5 default when not total
    postCurveMode = postCurveMode === 'pick' ? 'pick' : 'top';
  }

  const opt = CHANGES_RANGES.find(r=>r.id===rangeId) || CHANGES_RANGES.find(r=>r.id==='all');
  // collect timestamps in [now-window, now] only (no ancient baseline)
  let allTs = new Set();
  ranked.forEach(id => (series[id]||[]).forEach(p => allTs.add(toSec(p.ts))));
  let tsList = [...allTs].filter(t=>t>0).sort((a,b)=>a-b);
  if(opt && opt.ms != null && tsList.length){
    const cut = rangeCutSec(rangeId);
    tsList = tsList.filter(t => t >= cut);
  }

  const seriesList = [];
  if(active.includes('__total__') || postCurveMode === 'total'){
    // total = sum of all posts at each ts (step-hold last known)
    const lastVal = {};
    ranked.forEach(id => { lastVal[id] = 0; });
    const ptsById = {};
    ranked.forEach(id => {
      ptsById[id] = (series[id]||[]).slice().sort((a,b)=>toSec(a.ts)-toSec(b.ts));
    });
    const vals = tsList.map(t => {
      let sum = 0;
      ranked.forEach(id => {
        const pts = ptsById[id] || [];
        for(const p of pts){
          if(toSec(p.ts) <= t) lastVal[id] = postCurveMetric==='likes' ? (+p.likes||0) : (+p.views||0);
          else break;
        }
        sum += lastVal[id]||0;
      });
      return sum;
    });
    // if no series history, fall back to account hist views
    if(!tsList.length){
      const hist = filterHistByRange(histFor(d), rangeId);
      return chartCard('Per-post / total over time','using account log (no per-post series yet)',
        curveChart([{name:'Total', vals:hist.map(h=>postCurveMetric==='likes'?h.likes||0:h.views||0), color:'#df4996'}],
          hist.map(h=>new Date(histTsMs(h.ts)).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}))));
    }
    seriesList.push({ name:'Total', vals, color:'#df4996' });
  } else {
    active.forEach((id, i) => {
      const pts = (series[id]||[]).slice().sort((a,b)=>toSec(a.ts)-toSec(b.ts));
      if(!pts.length) return;
      const lastVal = { v:0 };
      const vals = tsList.map(t => {
        for(const p of pts){
          if(toSec(p.ts) <= t) lastVal.v = postCurveMetric==='likes' ? (+p.likes||0) : (+p.views||0);
          else break;
        }
        return lastVal.v;
      });
      const lab = (labels[id] || id).slice(0, 18);
      seriesList.push({ name: lab, vals, color: CURVE_COLORS[i % CURVE_COLORS.length] });
    });
  }

  const labs = tsList.map(t => new Date(histTsMs(t)).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}));
  const modeChips = ['total','top','pick'].map(mode =>
    `<button type="button" class="chip${postCurveMode===mode?' on':''}" onclick="setPostCurveMode('${mode}')">${mode==='total'?'Total':mode==='top'?'Top 5':'Pick'}</button>`
  ).join('');
  const metChips = ['views','likes'].map(met =>
    `<button type="button" class="chip${postCurveMetric===met?' on':''}" onclick="setPostCurveMetric('${met}')">${met}</button>`
  ).join('');

  let pick = '';
  if(postCurveMode === 'pick' || postCurveMode === 'top'){
    pick = `<div class="chipset" style="margin:8px 0;flex-wrap:wrap;max-height:120px;overflow:auto">` +
      ranked.slice(0, 24).map(id => {
        const on = postCurveMode==='pick' ? postCurvePick.includes(id) : active.includes(id);
        const lab = esc((labels[id]||id).slice(0,22));
        const safe = String(id).replace(/[^a-zA-Z0-9_-]/g,'');
        return `<button type="button" class="chip${on?' on':''}" onclick="togglePostPick('${safe}')">${lab}</button>`;
      }).join('') + `</div>`;
  }

  const chart = seriesList.length
    ? curveChart(seriesList, labs)
    : `<div class="tiny muted">No series points in this range</div>`;

  return `<div class="card" style="margin-bottom:14px">
    <div class="between" style="margin-bottom:8px">
      <div><b style="font-size:14px">Posts over time</b>
        <div class="tiny muted">${tsList.length} samples · ${postCurveMode} · ${postCurveMetric}</div>
      </div>
    </div>
    <div class="chipset" style="margin-bottom:6px">${modeChips}</div>
    <div class="chipset" style="margin-bottom:6px">${metChips}</div>
    ${pick}
    ${chart}
  </div>`;
}


async function generateCaption(){
  const key=cfg(LS.gr);
  if(!key) return toast('Add your Groq key in Setup','err');
  const brief = ($('#caption').value.trim()) || prompt('What is this video about? (a few words)') || '';
  if(!brief.trim()) return;

  const btn=$('#genBtn'), lbl=$('#genLbl');
  btn.disabled=true; lbl.textContent='Drafting…';
  try{
    const examples = await bestCaptions(8);
    const sys = `You are the copywriter for the Instagram account @${cfg('aura_user')||'creator'}. `+
      `Write ONE caption for a new reel, imitating the EXACT voice of the example captions below: `+
      `same tone, emoji density and placement, sentence rhythm, line breaks, and hashtag style/count. `+
      `Match how they open and close. Output ONLY the caption text (include hashtags the way they do). No preamble, no quotes.`;
    const usr = `NEW VIDEO: ${brief}\n\n`+
      (examples.length ? `MY BEST RECENT CAPTIONS (highest engagement first):\n`+
        examples.map((c,i)=>`${i+1}. ${c}`).join('\n\n') : `(no past captions available — use a clean, punchy modern reels voice)`)+
      `\n\nWrite the caption now.`;
    const model = cfg(LS.grm)||'llama-3.3-70b-versatile';
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions',{
      method:'POST', headers:{'Authorization':'Bearer '+key,'Content-Type':'application/json'},
      body: JSON.stringify({ model, temperature:0.9, max_tokens:400,
        messages:[{role:'system',content:sys},{role:'user',content:usr}] })
    });
    const j = await r.json();
    if(j.error) throw new Error(j.error.message||'Groq error');
    let out = j.choices?.[0]?.message?.content?.trim();
    if(!out) throw new Error('empty response');
    out = out.replace(/^["']|["']$/g,'');
    $('#caption').value = out; onCaption();

    const tags = (out.match(/#[\p{L}\p{N}_]+/gu)||[]);
    if(tags.length>=3) $('#tags').value = tags.join(' ');
    toast('Caption drafted ✨','ok');
  }catch(e){ toast(e.message||'Generation failed','err'); }
  finally{ btn.disabled=false; lbl.textContent='In your voice'; }
}

async function bestCaptions(n){
  let data = jget(cacheKey('instagram'),null) || jget(LS.cache,null);
  if(!data){ try{ data = await fetchInsights(); }catch{ data=null; } }
  const m = (data?.media||[]).filter(x=>x.caption && x.caption.trim().length>3);
  m.sort((a,b)=> (b.eng-a.eng) || (b.likes-a.likes));
  const seen=new Set(), out=[];
  for(const x of m){ const key=x.caption.slice(0,40); if(seen.has(key))continue; seen.add(key);
    out.push(x.caption.slice(0,600)); if(out.length>=n)break; }
  return out;
}


let picked=null;
if($('#file')) $('#file').addEventListener('change', e=>{
  const f=e.target.files[0]; if(!f) return;
  picked=f;
  const url=URL.createObjectURL(f);
  $('#vid').src=url;
  $('#vidName').textContent=f.name;
  $('#vidSize').textContent=(f.size/1048576).toFixed(1)+' MB';
  $('#pickCard').classList.add('hide');
  $('#previewCard').classList.remove('hide');
  $('#composeCard').classList.remove('hide');
  $('#vid').play().catch(()=>{});
});
function clearVideo(){
  picked=null; $('#file').value=''; $('#vid').removeAttribute('src');
  $('#pickCard').classList.remove('hide');
  $('#previewCard').classList.add('hide');
  $('#composeCard').classList.add('hide');
  $('#postLog').classList.add('hide'); $('#postBar').classList.add('hide');
}
if($('#caption')) $('#caption').addEventListener('input', onCaption);
function onCaption(){ if($('#capCount') && $('#caption')) $('#capCount').textContent = $('#caption').value.length; }

function plog(msg,kind=''){ const l=$('#postLog'); l.classList.remove('hide');
  const s=document.createElement('span'); s.className='l '+kind; s.textContent=msg; l.appendChild(s); l.scrollTop=l.scrollHeight; }
function pbar(v){ $('#postBar').classList.remove('hide'); $('#postBar').firstElementChild.style.width=(v*100)+'%'; }

async function publish(){
  if(!picked) return toast('Pick a video first','err');
  const t=igToken(); if(!t) return toast('Link Instagram in Setup','err');
  let caption=$('#caption').value.trim();
  const tags=$('#tags').value.trim();
  if(tags && !caption.includes('#')) caption=(caption+'\n\n'+tags.split(/\s+/).map(x=>'#'+x.replace(/^#/,'')).join(' ')).trim();

  const btn=$('#postBtn'); btn.disabled=true; $('#postLog').innerHTML='';
  try{
    plog('parking video on temp host (1h)…','step'); pbar(0.1);
    const url = await parkFile(picked);
    plog('hosted ok','dim');

    plog('creating reel container…','step'); pbar(0.35);
    let j = await post(`${G}/me/media`, form({media_type:'REELS', video_url:url, caption, access_token:t}));
    if(!j.id) throw new Error(j.error?.message||'container failed');
    const cid=j.id;

    plog('Instagram is processing…','step'); pbar(0.55);
    const deadline=Date.now()+180e3;
    for(;;){
      await sleep(4000);
      const s=await getJSON(`${G}/${cid}?fields=status_code,status&access_token=${t}`);
      if(s.status_code==='FINISHED'){ pbar(0.85); break; }
      if(s.status_code==='ERROR'||s.status_code==='EXPIRED') throw new Error(s.status||s.status_code);
      if(Date.now()>deadline) throw new Error('processing timed out');
      pbar(Math.min(0.82, 0.55+ (Date.now()-(deadline-180e3))/180e3*0.3));
    }

    plog('publishing…','step'); pbar(0.92);
    j = await post(`${G}/me/media_publish`, form({creation_id:cid, access_token:t}));
    if(!j.id) throw new Error(j.error?.message||'publish failed');

    let link='';
    try{ link=(await getJSON(`${G}/${j.id}?fields=permalink&access_token=${t}`)).permalink||''; }catch{}
    pbar(1); plog('published '+(link||j.id),'ok');
    toast('Posted to Instagram 🎉','ok');
    if(link) plog('open: '+link,'dim');
    insightsLoaded.instagram=false;
  }catch(e){ plog('✗ '+(e.message||e),'err'); toast(e.message||'Post failed','err'); }
  finally{ btn.disabled=false; }
}

async function parkFile(file){
  const fd=new FormData();
  fd.append('reqtype','fileupload'); fd.append('time','1h'); fd.append('fileToUpload',file);
  const r=await fetch('https://litterbox.catbox.moe/resources/internals/api.php',{method:'POST',body:fd});
  const txt=(await r.text()).trim();
  if(r.ok && /^https?:\/\//.test(txt)) return txt;
  throw new Error('temp host failed: '+txt.slice(0,80));
}
const form = o => { const f=new FormData(); for(const k in o) f.append(k,o[k]); return f; };
const sleep = ms => new Promise(r=>setTimeout(r,ms));



async function loadInsights(force){
  const body=$('#insBody');

  document.querySelectorAll('#platChips [data-plat]').forEach(b=>{
    b.classList.toggle('on', b.dataset.plat===statsPlat);
  });
  document.querySelectorAll('#insTabs [data-tab]').forEach(b=>{
    b.classList.toggle('on', b.dataset.tab===insTab);
  });

  const plat = statsPlat;

  // Pack-only portal: never hit IG/TT/YT APIs — only GitHub (or local pack cache).
  let packRes = {ok:false};
  const ic=$('#refreshIc');
  if(force && ic) ic.classList.add('spin');
  try{
    if(lkOk()){
      packRes = await tryLoadPack({force:true});
    } else if(force){
      await askLk(true);
      if(lkOk()) packRes = await tryLoadPack({force:true});
    }
  } finally {
    if(ic) ic.classList.remove('spin');
  }

  let cached2 = withHistory(
    jget(cacheKey(plat), null) || (plat==='instagram' ? jget(LS.cache, null) : null),
    plat
  );
  const histN = (cached2?.history || jget(histKey(plat), []) || []).length;

  if(!cached2?.media?.length && !(cached2?.history||[]).length){
    body.innerHTML = emptyBlock(
      'No pack data yet',
      'Tap Refresh, or wait for PC / phone-sync to upload the public pack.'
    );
    $('#insMeta').textContent = packRes.ok ? 'pack empty' : (packRes.reason||'no pack');
    insightsLoaded[plat]=true;
    return;
  }

  renderInsights(withHistory(cached2, plat));
  const packNote = packRes.ok
    ? `pack ok · log ${histN}`
    : (lkOk() ? `pack ${packRes.reason||'cache'} · log ${histN}` : `locked · log ${histN}`);
  if($('#insMeta')){
    const cur = $('#insMeta').textContent || '';
    if(!/log \d+|pack /.test(cur)) $('#insMeta').textContent = cur + (cur?' · ':'') + packNote;
    else if(force) $('#insMeta').textContent = packNote;
  }
  if(force && packRes.ok){
    const pw = packRes.packW || packRes.counts?.packW || 0;
    const when = pw ? new Date(histTsMs(pw)).toLocaleString() : '?';
    toast('pack '+when+' · log '+histN,'ok');
  }
  insightsLoaded[plat]=true;
}

function histFor(d){
  const plat = d?.platform || statsPlat;

  return mergeHistLists(d?.history||[], jget(histKey(plat), jget(LS.hist, [])));
}


function dayBeforeBase(hist){
  if(!hist || hist.length < 2) return null;
  const now = hist[hist.length-1].ts || 0;
  const thr = now > 1e12 ? 20*3600*1000 : 20*3600;
  for(let i=hist.length-2; i>=0; i--){
    if(now - (hist[i].ts||0) >= thr) return hist[i];
  }
  return hist[hist.length-2];
}

function growthFrom(cur, base){
  if(!cur || !base) return { dViews:0, dLikes:0, dFollowers:0, dInteractions:0, hasBase:false, hours:0 };
  const thrUnit = (cur.ts||0) > 1e12 ? 3600e3 : 3600;
  return {
    dViews: (cur.views||0) - (base.views||0),
    dLikes: (cur.likes||0) - (base.likes||0),
    dFollowers: (cur.followers||0) - (base.followers||0),
    dInteractions: (cur.interactions||0) - (base.interactions||0),
    hasBase: true,
    hours: Math.max(0.01, ((cur.ts||0) - (base.ts||0)) / thrUnit),
  };
}

function signedFmt(n){
  n = +n||0;
  if(n>0) return '+'+fmt(n);
  if(n<0) return fmt(n);
  return '0';
}


function liveNowPoint(d, hist){
  const m = d.media||[];
  const a = d.account||{};
  const sum = k => m.reduce((s,x)=>s+(+x[k]||0),0);
  const last = hist.length ? hist[hist.length-1] : null;
  let ts = d.fetched || Date.now();
  if(ts < 1e12) ts *= 1000;

  if(last && last.ts && last.ts < 1e12 && ts > 1e12) ts = ts/1000;
  return {
    ts,
    followers: a.followers_count||0,
    posts: m.length || a.media_count || 0,
    views: sum('views'),
    likes: sum('likes'),
    shares: sum('shares'),
    saved: sum('saved'),
    interactions: sum('interactions'),
  };
}

function growthStripHtml(g, label){
  if(!g.hasBase){
    return `<div class="card" style="background:var(--grad-soft);border-color:rgba(223,73,150,.25);padding:12px 14px">
      <div style="font-weight:800;font-size:13px;margin-bottom:4px">Since prior day · ${esc(label)}</div>
      <div class="tiny muted">No log (~20h apart) for day-over-day growth. Tap Refresh after linking in Setup.</div>
    </div>`;
  }
  const gap = g.hours < 1.5 ? Math.round(g.hours*60)+'m' : (g.hours < 48 ? g.hours.toFixed(1)+'h' : (g.hours/24).toFixed(1)+'d');
  const cell = (lbl, n) => {
    const cls = n>0?'up':n<0?'down':'flat';
    return `<div style="flex:1;min-width:72px"><div class="tiny muted" style="margin-bottom:2px">${lbl}</div>
      <div style="font-size:18px;font-weight:800" class="delta ${cls}">${signedFmt(n)}</div></div>`;
  };
  return `<div class="card" style="background:var(--grad-soft);border-color:rgba(223,73,150,.25);padding:12px 14px">
    <div class="between" style="margin-bottom:10px">
      <div style="font-weight:800;font-size:13px">Since prior day · ${esc(label)}</div>
      <span class="tiny muted">${gap} window</span>
    </div>
    <div class="row" style="gap:8px;flex-wrap:wrap">
      ${cell('Views', g.dViews)}
      ${cell('Likes', g.dLikes)}
      ${cell('Followers', g.dFollowers)}
    </div>
  </div>`;
}

function renderInsights(d){
  lastInsights = d;
  const a=d.account||{}, m=(d.media||[]).slice().filter(x=>x.ts || x.views);

  m.forEach(x=>{ if(!x.ts && x.timestamp) x.ts = Date.parse(x.timestamp)||0; });
  const plat = d.platform || statsPlat;
  const label = plat==='tiktok' ? 'TikTok' : 'Instagram';
  const user = a.username || (plat==='tiktok'?'tiktok':'ig');
  const histN = histFor(d).length;
  const src = d.source==='pack' ? ' · pack' : d.source==='tiktok' ? ' · TT' : d.source==='graph' ? ' · IG' : '';
  $('#insMeta').textContent = `@${user} · ${m.length} posts · log ${histN} · ${ago(d.fetched)}${src}`;
  if(!m.length){
    $('#insBody').innerHTML = emptyBlock(
      'No posts yet',
      plat==='tiktok'
        ? 'Publish a video and refresh.'
        : 'Publish a reel and refresh.'
    );
    return;
  }

  const chrono=m.slice().sort((x,y)=>(x.ts||0)-(y.ts||0));
  const sum=k=>m.reduce((s,x)=>s+(x[k]||0),0);
  const avg=k=>sum(k)/Math.max(1,m.length);
  const wv=m.filter(x=>x.watch).map(x=>x.watch);
  const sortedV=m.map(x=>x.views||0).sort((a,b)=>a-b);
  const median=sortedV.length%2?sortedV[(sortedV.length-1)/2]:(sortedV[sortedV.length/2-1]+sortedV[sortedV.length/2])/2;
  const maxV=Math.max(...m.map(x=>x.views||0),0);
  const K={
    followers:a.followers_count||0,
    totalViews:sum('views'), avgViews:avg('views'), avgReach:avg('reach'),
    avgEng:avg('eng'), avgWatch: wv.length?wv.reduce((s,x)=>s+x,0)/wv.length:0,
    viral:sum('shares')+sum('saved'), posts:m.length, median, maxV,
    likes:sum('likes'), comments:sum('comments'), shares:sum('shares'), saved:sum('saved'),
    likeRate: sum('views')?sum('likes')/sum('views')*100:0,
    saveRate: sum('views')?sum('saved')/sum('views')*100:0,
  };

  const hist=histFor(d);
  const prev = hist.length>1?hist[hist.length-2]:null;
  const last = hist.length?hist[hist.length-1]:null;
  const dEl=(cur,prevVal)=>{
    if(prevVal==null||prevVal===0) return `<span class="delta flat">–</span>`;
    const dp=(cur-prevVal)/prevVal*100; const cls=dp>0.5?'up':dp<-0.5?'down':'flat';
    const ar=dp>0.5?'+':dp<-0.5?'-':'=';
    return `<span class="delta ${cls}">${ar} ${Math.abs(Math.round(dp))}%</span>`; };
  const dAbs=(cur,prevVal)=>{
    if(prevVal==null) return `<span class="delta flat">–</span>`;
    const d=cur-prevVal; const cls=d>0?'up':d<0?'down':'flat';
    return `<span class="delta ${cls}">${d>0?'+':''}${fmt(d)}</span>`;
  };

  let html='';
  if(insTab === 'charts' || insTab === 'changes') insTab = 'overview';
  if(insTab === 'top') insTab = 'timing';
  const tab = insTab;

  
  const base = dayBeforeBase(hist);
  const nowPt = liveNowPoint(d, hist);
  const g = growthFrom(nowPt, base);

  
  if(tab==='overview'){
    html += `<div class="kpis primary-kpis">
      ${kpi('Views', fmt(K.totalViews), g.hasBase?`<span class="delta ${g.dViews>=0?'up':'down'}">${signedFmt(g.dViews)} d/d</span>`:dAbs(K.totalViews, prev?.views), sparkPath(hist.map(h=>h.views)))}
      ${kpi('Likes', fmt(K.likes), g.hasBase?`<span class="delta ${g.dLikes>=0?'up':'down'}">${signedFmt(g.dLikes)} d/d</span>`:dAbs(K.likes, prev?.likes), sparkPath(hist.map(h=>h.likes)))}
      ${kpi('Followers', fmt(K.followers), g.hasBase?`<span class="delta ${g.dFollowers>=0?'up':'down'}">${signedFmt(g.dFollowers)} d/d</span>`:dEl(K.followers, prev?.followers), sparkPath(hist.map(h=>h.followers)))}
      ${kpi('Shares', fmt(K.shares), dAbs(K.shares, prev?.shares), sparkPath(chrono.map(x=>x.shares)))}
      ${kpi('Saves', fmt(K.saved), dAbs(K.saved, prev?.saved), sparkPath(chrono.map(x=>x.saved)))}
      ${kpi('Comments', fmt(K.comments), dAbs(K.comments, prev?.comments), sparkPath(chrono.map(x=>x.comments)))}
      ${kpi('Posts', fmt(K.posts), dAbs(K.posts, prev?.n||prev?.posts), '')}
    </div>`;
    if(false) html += `<div class="kpis">
      ${kpi('Avg views', fmt(K.avgViews), dEl(K.avgViews, prev?.avgViews), sparkPath(chrono.map(x=>x.views)))}
      ${kpi('Median views', fmt(K.median), '', '')}
      ${kpi('Best post', fmt(K.maxV), '', '')}
      ${kpi('Engagement', pct(K.avgEng), dEl(K.avgEng, prev?.eng), sparkPath(chrono.map(x=>x.eng)))}
      ${kpi('Like rate', pct(K.likeRate), '', sparkPath(chrono.map(x=>x.views?x.likes/x.views*100:0)))}
      ${plat==='instagram'?kpi('Avg reach', fmt(K.avgReach), dEl(K.avgReach, prev?.avgReach), sparkPath(chrono.map(x=>x.reach))):kpi('Shares', fmt(K.shares), dAbs(K.shares, prev?.shares), '')}
      ${plat==='instagram'?kpi('Avg watch', K.avgWatch?K.avgWatch.toFixed(1)+'s':'—', dEl(K.avgWatch, prev?.watch), sparkPath(chrono.map(x=>x.watch))):kpi('Comments', fmt(K.comments), '', '')}
      ${kpi('Saves + shares', fmt(K.viral), dEl(K.viral/m.length, prev?.avgViral), sparkPath(chrono.map(x=>(x.saved||0)+(x.shares||0))))}
      ${plat==='instagram'?kpi('Save rate', pct(K.saveRate), '', ''):''}
    </div>`;
    if(d.blocked) html += `<div class="card" style="border-color:var(--warn);margin-top:14px"><div class="tiny" style="color:var(--warn);font-weight:700">⚠ Insights permission missing</div><div class="tiny muted" style="margin-top:4px">Views/reach need the insights scope. Likes &amp; comments still show.</div></div>`;
    if(false && plat==='instagram') html += analystCard();
    const finds = analyze(m, chrono);
    if(false && finds.length){
      html += `<div class="sec-title">What's working</div>`;
      finds.forEach(f=> html += finding(f.icon,f.title,f.body));
    }
  }

  if(tab==='overview'){
    // Curve first (Views | Likes switch)
    html += '';

    // Range under chart
    html += `<div class="between" style="margin:12px 2px 6px">
      <div class="sec-title" style="margin:0">Range</div>
      <span class="tiny muted">${esc(rngLabelSafe())}</span>
    </div>`;
    html += changesRangeChips();
    html += `<div class="metric-grid">
      ${buildCombinedChangesCurve(d, plat, changesRange, 'views', false)}
      ${buildCombinedChangesCurve(d, plat, changesRange, 'likes', false)}
    </div>`;

    // KPI boxes below range
    if(false){
    const postRange = postRangeSummaryPortal(d, plat, changesRange);
    const hRange = filterHistByRange(hist, changesRange);
    let useRange = hRange;
    if(useRange.length<2 && hist.length>=2) useRange = hist.slice();

    if(postRange){
      const rngLbl = rngLabelSafe();
      const cell = (lbl, n, extra) => {
        const cls = n>0?'up':n<0?'down':'flat';
        return kpi(lbl, signedFmt(n), `<span class="delta ${cls}">${n>0?'â–²':n<0?'â–¼':'â–¬'}</span>${extra?` <span class="tiny muted">${extra}</span>`:''}`, '');
      };
      html += `<div class="kpis" style="margin-top:12px">
        ${cell('Î” Views Â· '+rngLbl, postRange.views, postRange.hours.toFixed(1)+'h')}
        ${cell('Î” Likes', postRange.likes, '')}
        ${kpi('Views/h', fmt(postRange.views/postRange.hours), `<span class="tiny muted">${postRange.snaps} snaps</span>`, '')}
      </div>`;
    } else if(hist.length>=2 && useRange.length>=2){
      const series = useRange;
      const first = series[0], lastH = series[series.length-1];
      const winHours = Math.max(0.01, (histTsMs(lastH.ts)-histTsMs(first.ts))/3600e3);
      const wViews = (lastH.views||0)-(first.views||0);
      const wLikes = (lastH.likes||0)-(first.likes||0);
      const wFoll  = (lastH.followers||0)-(first.followers||0);
      const rngLbl = rngLabelSafe();
      const cell = (lbl, n, extra) => {
        const cls = n>0?'up':n<0?'down':'flat';
        return kpi(lbl, signedFmt(n), `<span class="delta ${cls}">${n>0?'▲':n<0?'▼':'▬'}</span>${extra?` <span class="tiny muted">${extra}</span>`:''}`, '');
      };
      html += `<div class="kpis" style="margin-top:12px">
        ${cell('Δ Views · '+rngLbl, wViews, winHours<48?winHours.toFixed(1)+'h':(winHours/24).toFixed(1)+'d')}
        ${cell('Δ Likes', wLikes, '')}
        ${cell('Δ Followers', wFoll, '')}
        ${kpi('Views/h', fmt(wViews/winHours), `<span class="tiny muted">${series.length} snaps</span>`, '')}
      </div>`;
    } else if(hist.length<2){
      html += `<div class="card tiny muted" style="margin-top:12px">Account log thin — curve may still use per-post history.</div>`;
    }

    }
    html += `<div class="sec-title">Posts</div>`;
    html += changesPostsListHtml(d, plat, changesRange);
  }

  
  if(tab==='timing'){
    if(plat==='instagram') html += analystCard();
    const finds = analyze(m, chrono);
    if(finds.length){
      html += `<div class="sec-title">What's working</div>`;
      finds.forEach(f=> html += finding(f.icon,f.title,f.body));
    }
    html += chartCard('Best time to post', 'Average engagement by day and time', heatmap(m));
    html += `<div class="sec-title">By views</div>`;
    m.slice().sort((x,y)=>y.views-x.views).slice(0,12).forEach((x,i)=> html += postRow(x,i+1));
    html += `<div class="sec-title">By engagement</div>`;
    m.slice().sort((x,y)=>y.eng-x.eng).slice(0,8).forEach((x,i)=> html += postRow(x,i+1));
    html += `<div class="sec-title">By saves + shares</div>`;
    m.slice().sort((x,y)=>(y.saved+y.shares)-(x.saved+x.shares)).slice(0,8).forEach((x,i)=> html += postRow(x,i+1));
  }

  $('#insBody').innerHTML=html;
  bindCurveCharts($('#insBody'));
  if(tab==='timing' && plat==='instagram'){
    const ai=jget(LS.ai,null); if(ai) paintAnalyst(ai);
  }
}


function hBar(vals, names){
  const W=320, rowH=22, pad=4, n=vals.length||1, max=Math.max(...vals,1);
  let y=0, out='';
  vals.forEach((v,i)=>{
    const w=Math.max(4,(v/max)*(W-100));
    const name=esc((names[i]||'').slice(0,18));
    out+=`<g transform="translate(0 ${y})">
      <text x="0" y="14" font-size="10" fill="var(--mut)">${name}</text>
      <rect x="100" y="4" width="${w.toFixed(1)}" height="14" rx="3" fill="url(#bg1)"/>
      <text x="${(100+w+4).toFixed(1)}" y="14" font-size="10" font-weight="700" fill="var(--txt)">${fmt(v)}</text>
    </g>`;
    y+=rowH;
  });
  return `<svg viewBox="0 0 ${W} ${n*rowH+pad}"><defs><linearGradient id="bg1" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fdc468"/><stop offset=".55" stop-color="#df4996"/><stop offset="1" stop-color="#8a3ab9"/></linearGradient></defs>${out}</svg>`;
}


function analystCard(){
  const has=cfg(LS.gr);
  return `<div class="card ai-card" style="margin-top:14px">
    <div class="between" style="align-items:center">
      <div style="display:flex;gap:9px;align-items:center"><span style="font-size:17px">ðŸ§ </span><b style="font-size:14px">AI trend analyst</b></div>
      <button class="btn ghost sm" id="aiBtn" onclick="runAnalyst()"${has?'':' disabled'}>Analyse</button>
    </div>
    <div id="aiBody" style="margin-top:10px"><div class="tiny muted">${has?'Tap Analyse — reads your on-device history &amp; posts, then explains what changed, why, and what to do next.':'Add your Groq key in Setup to enable AI analysis.'}</div></div>
  </div>`;
}


function analystBrief(d){
  const a=d.account, m=d.media.filter(x=>x.ts||x.views);
  const chrono=m.slice().sort((x,y)=>(x.ts||0)-(y.ts||0));
  const hist=histFor(d);
  const cur=hist[hist.length-1], prev=hist.length>1?hist[hist.length-2]:null, first=hist[0];
  const pctd=(c,p)=> (p==null||!p)?null:Math.round((c-p)/p*100);
  const dtxt=(c,p)=>{ const x=pctd(c,p); return x==null?'n/a':(x>=0?'+':'')+x+'%'; };
  const L=[];
  L.push(`ACCOUNT @${a.username}: ${fmt(a.followers_count)} followers, ${a.media_count||m.length} posts total, ${m.length} recent reels analysed.`);
  if(prev && cur){
    L.push(`SINCE LAST CHECK (${ago(prev.ts)}):`);
    [['followers',cur.followers,prev.followers],['avg views',cur.avgViews||cur.views,prev.avgViews||prev.views],
     ['engagement rate %',cur.eng,prev.eng],['avg reach',cur.avgReach||cur.reach,prev.avgReach||prev.reach],
     ['avg watch (s)',cur.watch,prev.watch],['avg saves+shares',cur.avgViral,prev.avgViral]
    ].forEach(([lbl,c,p])=>L.push(`  ${lbl}: ${round1(c)} (${dtxt(c,p)})`));
  }
  if(first && cur && first.ts!==cur.ts){
    const span=Math.max(1,Math.round((cur.ts-first.ts)/86400e3));
    L.push(`OVER ${span}d TRACKED: followers ${fmt(first.followers)}→${fmt(cur.followers)}, eng ${round1(first.eng)}%→${round1(cur.eng)}%, avg views ${fmt(first.avgViews||first.views)}→${fmt(cur.avgViews||cur.views)}.`);
  }
  const byViews=m.slice().sort((x,y)=>y.views-x.views);
  const pline=x=>`views ${fmt(x.views)}, reach ${fmt(x.reach)}, eng ${round1(x.eng)}%, ${fmt(x.saved)} saves, ${fmt(x.shares)} shares — "${(x.caption||'').replace(/\s+/g,' ').slice(0,70)}"`;
  L.push('TOP POSTS:'); byViews.slice(0,3).forEach((x,i)=>L.push(`  ${i+1}. ${pline(x)}`));
  if(byViews.length>4){ L.push('WEAKEST POSTS:'); byViews.slice(-2).forEach((x,i)=>L.push(`  ${i+1}. ${pline(x)}`)); }
  const finds=analyze(m,chrono);
  if(finds.length){ L.push('DETECTED PATTERNS:'); finds.forEach(f=>L.push(`  - ${f.title}: ${f.body.replace(/<[^>]+>/g,'')}`)); }
  return L.join('\n');
}

async function runAnalyst(){
  const key=cfg(LS.gr);
  if(!key) return toast('Add your Groq key in Setup','err');
  const data=lastInsights || jget(cacheKey('instagram'),null) || jget(LS.cache,null);
  if(!data || !data.media?.length) return toast('No insights to analyse yet','err');
  const btn=$('#aiBtn'), bodyEl=$('#aiBody');
  if(btn){ btn.disabled=true; btn.textContent='Analysing…'; }
  if(bodyEl) bodyEl.innerHTML=`<div class="tiny muted">Reading your trend &amp; posts…</div>`;
  try{
    const brief=analystBrief(data);
    const sys=`You are a sharp Instagram growth analyst. You are given a creator's real metrics: how they changed since the last check and over the tracked period, their best/worst reels, and auto-detected patterns. Write a SHORT report with exactly three sections, each label on its own line ending with a colon: "What changed:", "Why (likely):", "Do next:". Reference the actual numbers you were given. NEVER invent numbers, dates, or metrics not present in the data. If history is thin, say so plainly. Keep it under ~140 words, plain text, no markdown symbols.`;
    const usr=`DATA:\n${brief}\n\nWrite the report now.`;
    const model=cfg(LS.grm)||'llama-3.3-70b-versatile';
    const r=await fetch('https://api.groq.com/openai/v1/chat/completions',{ method:'POST',
      headers:{'Authorization':'Bearer '+key,'Content-Type':'application/json'},
      body:JSON.stringify({ model, temperature:0.5, max_tokens:400,
        messages:[{role:'system',content:sys},{role:'user',content:usr}] }) });
    const j=await r.json();
    if(j.error) throw new Error(j.error.message||'Groq error');
    const out=j.choices?.[0]?.message?.content?.trim();
    if(!out) throw new Error('empty response');
    const report={ text:out, ts:Date.now() };
    jset(LS.ai, report);
    paintAnalyst(report);
    toast('Analysis ready ✨','ok');
  }catch(e){
    if(bodyEl) bodyEl.innerHTML=`<div class="tiny" style="color:var(--warn)">${esc(e.message||'Analysis failed')}</div>`;
    toast(e.message||'Analysis failed','err');
  }finally{ if(btn){ btn.disabled=false; btn.textContent='Re-analyse'; } }
}

function paintAnalyst(s){
  const bodyEl=$('#aiBody'); if(!bodyEl||!s) return;
  const html=esc(s.text)
    .replace(/^(What changed|Why[^\n:]*|Do next)\s*:/gim,'<b class="hi">$1:</b>')
    .replace(/\n/g,'<br>');
  bodyEl.innerHTML=`<div class="ai-text">${html}</div><div class="tiny muted" style="margin-top:9px">Generated ${ago(s.ts)} · Groq</div>`;
  const btn=$('#aiBtn'); if(btn) btn.textContent='Re-analyse';
}


function analyze(m, chrono){
  const out=[]; const avg=(arr,k)=>arr.length?arr.reduce((s,x)=>s+(x[k]||0),0)/arr.length:0;
  const withCap=m.filter(x=>x.caption);

  if(withCap.length>=6){
    const med=median(withCap.map(x=>x.caption.length));
    const short=withCap.filter(x=>x.caption.length<=med), long=withCap.filter(x=>x.caption.length>med);
    const es=avg(short,'eng'), el=avg(long,'eng');
    if(es&&el){ const win=el>es?'longer':'shorter'; const d=Math.abs(el-es)/Math.max(es,el)*100;
      if(d>12) out.push({icon:'text',title:`${win==='longer'?'Longer':'Shorter'} captions win`,
        body:`Your <span class="hi">${win}</span> captions average <span class="hi">${pct(win==='longer'?el:es)}</span> engagement vs ${pct(win==='longer'?es:el)}. Lean ${win}.`}); }
  }

  const tagged=m.map(x=>({...x,ht:(x.caption.match(/#/g)||[]).length})).filter(x=>x.reach);
  if(tagged.length>=6){
    const med=median(tagged.map(x=>x.ht))||1;
    const lo=tagged.filter(x=>x.ht<=med), hi=tagged.filter(x=>x.ht>med);
    const rl=avg(lo,'reach'), rh=avg(hi,'reach');
    if(rl&&rh){ const more=rh>rl; const d=Math.abs(rh-rl)/Math.max(rl,rh)*100;
      if(d>12) out.push({icon:'tag',title:`${more?'More':'Fewer'} hashtags reach further`,
        body:`Posts with <span class="hi">${more?'more':'fewer'}</span> hashtags reach <span class="hi">${fmt(more?rh:rl)}</span> on average — ${Math.round(d)}% more than the rest.`}); }
  }

  const buckets={}; m.forEach(x=>{ const dt=new Date(x.ts); const k=dt.getDay()+'|'+Math.floor(dt.getHours()/6);
    (buckets[k]=buckets[k]||[]).push(x); });
  let best=null; for(const k in buckets){ const arr=buckets[k]; if(arr.length<2)continue;
    const e=avg(arr,'eng'); if(!best||e>best.e) best={k,e,n:arr.length}; }
  if(best){ const [dow,b]=best.k.split('|'); const D=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][+dow];
    const T=['night (12–6a)','morning (6–12)','afternoon (12–6p)','evening (6–12a)'][+b];
    out.push({icon:'clock',title:`Sweet spot: ${D} ${T.split(' ')[0]}`,
      body:`Your <span class="hi">${D} ${T}</span> posts average <span class="hi">${pct(best.e)}</span> engagement across ${best.n} reels. Schedule there.`}); }

  const vir=m.slice().sort((x,y)=>(y.shares+y.saved)-(x.shares+x.saved))[0];
  if(vir && (vir.shares+vir.saved)>0)
    out.push({icon:'fire',title:'Most shared',
      body:`One reel pulled <span class="hi">${fmt(vir.saved)}</span> saves &amp; <span class="hi">${fmt(vir.shares)}</span> shares — study what made it spread.`});
  return out.slice(0,4);
}
function median(a){ if(!a.length)return 0; const s=a.slice().sort((x,y)=>x-y); const m=s.length>>1;
  return s.length%2?s[m]:(s[m-1]+s[m])/2; }



function chartCard(title,cap,body){
  return '<div class="chart"><h3>'+title+'</h3><div class="cap">'+cap+'</div>'+body+'</div>';
}

/** Nice Y-axis ticks between min..max (inclusive ends). */
function yTicks(min, max, count){
  count = count || 4;
  if(!(max > min)) return [min, max];
  const out = [];
  for(let i = 0; i < count; i++){
    out.push(min + (max - min) * (i / (count - 1)));
  }
  return out;
}

/**
 * Interactive curve — Y-axis + end labels always visible (no hover required).
 * Hover still shows full multi-series tip + crosshair.
 */
function curveChart(seriesList, labels, opts){
  opts = opts || {};
  seriesList = (seriesList || []).filter(s => s && s.vals && s.vals.length);
  if(!seriesList.length) return '<div class="tiny muted" style="padding:12px">No data</div>';
  const n = Math.max(...seriesList.map(s => s.vals.length));
  if(n < 2) return '<div class="tiny muted" style="padding:12px">Need 2+ points</div>';
  // Room for left Y labels + right end values
  const W = 360, H = 188, padL = 40, padR = 38, padT = 18, padB = 26;
  const all = seriesList.flatMap(s => s.vals.map(Number).filter(v => !isNaN(v)));
  let min = Math.min(...all);
  let max = Math.max(...all);
  if(opts.zeroBase){
    // include 0 baseline; keep room for negative deltas
    min = Math.min(0, min);
    max = Math.max(0, max);
  }
  if(min === max){ min = min > 0 ? 0 : min - 1; max = max + 1; }
  // small headroom so top value pins don't clip
  {
    const pad = (max - min) * 0.08 || 1;
    max += pad;
    if(!opts.zeroBase && min > 0) min = Math.max(0, min - pad * 0.25);
    else if(min < 0) min -= pad * 0.25;
  }
  const rng = max - min || 1;
  const X = i => padL + (i * (W - padL - padR) / Math.max(1, n - 1));
  const Y = v => padT + (1 - ((v - min) / rng)) * (H - padT - padB);
  const id = 'cv' + Math.random().toString(36).slice(2, 9);
  const labs = (labels || []).slice();
  while(labs.length < n) labs.push(String(labs.length + 1));
  const fmtY = (v) => fmt(v);

  // --- vertical axis (Y scale) + grid — always readable without hover ---
  const ticks = yTicks(min, max, 4);
  let axis = '';
  ticks.forEach(tv => {
    const y = Y(tv);
    axis += '<line x1="'+padL+'" y1="'+y.toFixed(1)+'" x2="'+(W-padR).toFixed(1)+'" y2="'+y.toFixed(1)+
      '" stroke="var(--line)" stroke-width="1" opacity="0.85" pointer-events="none"/>';
    axis += '<text x="'+(padL-5)+'" y="'+(y+3.5).toFixed(1)+'" font-size="9.5" font-weight="700" '+
      'fill="var(--mut)" text-anchor="end" pointer-events="none">'+esc(fmtY(tv))+'</text>';
  });
  // left baseline
  axis += '<line x1="'+padL+'" y1="'+padT+'" x2="'+padL+'" y2="'+(H-padB)+
    '" stroke="var(--line2)" stroke-width="1.2" pointer-events="none"/>';

  let paths = '';
  const single = seriesList.length === 1;
  // show per-point value tags when not too dense
  const showPointLabels = single && n <= 14;
  const stepLabel = n <= 8 ? 1 : (n <= 14 ? 2 : 0); // every point / every 2nd / none (end only)

  seriesList.forEach((ser, si) => {
    const color = ser.color || '#df4996';
    const vals = ser.vals;
    let line = '';
    vals.forEach((v, i) => {
      const x = X(i), y = Y(+v || 0);
      line += (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1) + ' ';
    });
    const fill = 'M ' + X(0).toFixed(1) + ' ' + (H - padB) + ' ' +
      vals.map((v, i) => 'L ' + X(i).toFixed(1) + ' ' + Y(+v || 0).toFixed(1)).join(' ') +
      ' L ' + X(vals.length - 1).toFixed(1) + ' ' + (H - padB) + ' Z';
    const gid = id + 'g' + si;
    paths += '<defs><linearGradient id="'+gid+'" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="'+color+'" stop-opacity="0.28"/>' +
      '<stop offset="1" stop-color="'+color+'" stop-opacity="0"/></linearGradient></defs>' +
      '<path d="'+fill+'" fill="url(#'+gid+')" pointer-events="none"/>' +
      '<path d="'+line+'" fill="none" stroke="'+color+'" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" pointer-events="none"/>';

    vals.forEach((v, i) => {
      const x = X(i), y = Y(+v || 0);
      paths += '<circle class="cv-dot" data-i="'+i+'" cx="'+x.toFixed(1)+'" cy="'+y.toFixed(1)+
        '" r="3.5" fill="'+color+'" opacity="0.95" pointer-events="none"/>';
      // permanent value pins on curve (single series, sparse enough)
      if(showPointLabels && stepLabel && (i % stepLabel === 0 || i === n - 1)){
        const ty = Math.max(padT + 9, y - 8);
        paths += '<text class="cv-ptlab" x="'+x.toFixed(1)+'" y="'+ty.toFixed(1)+
          '" font-size="9" font-weight="800" fill="'+color+'" text-anchor="middle" '+
          'paint-order="stroke" stroke="var(--card)" stroke-width="3" pointer-events="none">'+
          esc(fmtY(+v||0))+'</text>';
      }
    });

    // always: last value on the right (multi-series too)
    const last = +vals[vals.length - 1] || 0;
    const lx = X(vals.length - 1), ly = Y(last);
    paths += '<text x="'+(lx + 5).toFixed(1)+'" y="'+(ly + 3.5).toFixed(1)+
      '" font-size="10" font-weight="800" fill="'+color+'" pointer-events="none">'+
      esc(fmtY(last))+'</text>';
  });

  const payload = JSON.stringify({
    series: seriesList.map(ser => ({ name: ser.name || '', vals: ser.vals, color: ser.color || '#df4996' })),
    labels: labs,
    padL, padR, W, padT, padB, H, min, max,
  }).replace(/</g, '\\u003c');

  const t0 = esc(String(labs[0] || ''));
  const t1 = esc(String(labs[n - 1] || 'now'));

  return '<div class="cv-wrap" id="'+id+'" data-cv=\''+payload.replace(/'/g, '&#39;')+'\'>' +
    '<div class="cv-tip hide"></div>' +
    '<svg viewBox="0 0 '+W+' '+H+'" class="cv-svg" preserveAspectRatio="xMidYMid meet">' +
    axis +
    paths +
    '<line class="cv-cross hide" x1="0" y1="'+padT+'" x2="0" y2="'+(H-padB)+'" stroke="var(--mut2)" stroke-width="1" stroke-dasharray="3 3" pointer-events="none"/>' +
    '<rect class="cv-hit" x="'+padL+'" y="'+padT+'" width="'+(W-padL-padR)+'" height="'+(H-padT-padB)+
      '" fill="transparent" style="touch-action:none;cursor:crosshair"/>' +
    '<text x="'+padL+'" y="'+(H-6)+'" font-size="9" fill="var(--mut2)" pointer-events="none">'+t0+'</text>' +
    '<text x="'+(W-padR)+'" y="'+(H-6)+'" font-size="9" fill="var(--mut2)" text-anchor="end" pointer-events="none">'+t1+'</text>' +
    '</svg></div>';
}

function area(vals, ts){
  const labs = (ts || []).map(t => {
    const ms = histTsMs(t);
    return new Date(ms).toLocaleString(undefined, { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' });
  });
  return curveChart([{ name: 'value', vals: vals || [], color: '#df4996' }], labs);
}

function barChart(vals){
  const labs = (vals || []).map((_, i) => String(i + 1));
  return curveChart([{ name: 'value', vals: vals || [], color: '#df4996' }], labs);
}

function hBar(vals, names){
  const labs = (names || []).map((n, i) => (n || ('#' + (i + 1))).slice(0, 14));
  return curveChart([{ name: 'value', vals: vals || [], color: '#8a3ab9' }], labs);
}

function bindCurveCharts(root){
  root = root || document;
  root.querySelectorAll('.cv-wrap').forEach(wrap => {
    if(wrap._cvBound) return;
    wrap._cvBound = true;
    let data;
    try{ data = JSON.parse(wrap.getAttribute('data-cv') || '{}'); }catch(e){ return; }
    const svg = wrap.querySelector('.cv-svg');
    const tip = wrap.querySelector('.cv-tip');
    const cross = wrap.querySelector('.cv-cross');
    const hit = wrap.querySelector('.cv-hit');
    if(!svg || !tip || !hit) return;
    const n = (data.labels || []).length;
    if(n < 1) return;

    const show = (clientX) => {
      const rect = svg.getBoundingClientRect();
      const padL = +data.padL || 40;
      const padR = +data.padR || 38;
      const vbW = +data.W || 360;
      const padT = +data.padT || 18;
      const padB = +data.padB || 26;
      const vbH = +data.H || 188;
      // map client X into plot area (exclude axis pads)
      const scaleX = rect.width / vbW;
      const plotLeft = padL * scaleX;
      const plotW = Math.max(1, (vbW - padL - padR) * scaleX);
      const x = clientX - rect.left;
      const frac = Math.max(0, Math.min(1, (x - plotLeft) / plotW));
      const i = Math.round(frac * (n - 1));
      const lab = (data.labels && data.labels[i]) || ('#' + (i + 1));
      const lines = (data.series || []).map(ser => {
        const v = ser.vals[i];
        return '<span style="color:'+esc(ser.color||'#df4996')+'">●</span> ' +
          esc(ser.name || 'value') + ': <b>' + fmt(v) + '</b>';
      });
      tip.innerHTML = '<div class="cv-tip-lab">'+esc(String(lab))+'</div>' + lines.join('<br>');
      tip.classList.remove('hide');
      const left = Math.max(4, Math.min(rect.width - 130, frac * rect.width - 50));
      tip.style.left = left + 'px';
      if(cross){
        cross.classList.remove('hide');
        const cx = padL + (i * (vbW - padL - padR) / Math.max(1, n - 1));
        cross.setAttribute('x1', String(cx));
        cross.setAttribute('x2', String(cx));
        cross.setAttribute('y1', String(padT));
        cross.setAttribute('y2', String(vbH - padB));
      }
    };
    const hide = () => {
      tip.classList.add('hide');
      if(cross) cross.classList.add('hide');
    };

    hit.addEventListener('pointerdown', e => { try{ hit.setPointerCapture(e.pointerId); }catch(err){} show(e.clientX); });
    hit.addEventListener('pointermove', e => show(e.clientX));
    hit.addEventListener('pointerup', hide);
    hit.addEventListener('pointerleave', hide);
    hit.addEventListener('pointercancel', hide);
  });
}

function donut(items){
  const tot=items.reduce((s,x)=>s+x[1],0)||1, R=54,r=34,cx=70,cy=70; let a=-Math.PI/2, segs='';
  items.forEach(it=>{ const frac=it[1]/tot; const a2=a+frac*2*Math.PI;
    const x1=cx+R*Math.cos(a), y1=cy+R*Math.sin(a), x2=cx+R*Math.cos(a2), y2=cy+R*Math.sin(a2);
    const xi=cx+r*Math.cos(a2), yi=cy+r*Math.sin(a2), xi2=cx+r*Math.cos(a);
    const yi2=cy+r*Math.sin(a); const large=frac>0.5?1:0;
    segs+='<path d="M'+x1+' '+y1+' A'+R+' '+R+' 0 '+large+' 1 '+x2+' '+y2+' L'+xi+' '+yi+' A'+r+' '+r+' 0 '+large+' 0 '+xi2+' '+yi2+' Z" fill="'+it[2]+'"/>';
    a=a2; });
  const legend=items.map(it=>'<span><i style="background:'+it[2]+'"></i>'+it[0]+' '+Math.round(it[1]/tot*100)+'%</span>').join('');
  return '<div style="display:flex;gap:14px;align-items:center"><svg viewBox="0 0 140 140" style="width:140px;flex:none">'+segs+
    '<text x="70" y="66" text-anchor="middle" font-size="15" font-weight="800" fill="var(--txt)">'+fmt(tot)+'</text>'+
    '<text x="70" y="82" text-anchor="middle" font-size="9" fill="var(--mut)">interactions</text></svg>'+
    '<div class="legend" style="flex-direction:column;gap:8px;margin:0">'+legend+'</div></div>';
}

function funnel(rows){
  return curveChart(
    [{ name: 'funnel', vals: rows.map(r => r[1]), color: (rows[0] && rows[0][2]) || '#df4996' }],
    rows.map(r => r[0])
  );
}

function heatmapMini(m){
  // compact 7×4 eng grid
  const days=['M','T','W','T','F','S','S'], cols=['n','m','a','e'];
  const cell={};
  m.forEach(x=>{ const dt=new Date(x.ts); const dow=(dt.getDay()+6)%7; const b=Math.floor(dt.getHours()/6);
    const k=dow+'|'+b; (cell[k]=cell[k]||{s:0,n:0}); cell[k].s+=x.eng; cell[k].n++; });
  let maxAvg=0; Object.values(cell).forEach(c=>maxAvg=Math.max(maxAvg,c.s/c.n));
  maxAvg=maxAvg||1;
  let rows='';
  for(let d=0;d<7;d++){
    rows+='<div class="hm-row"><span class="hm-d">'+days[d]+'</span>';
    for(let b=0;b<4;b++){
      const c=cell[d+'|'+b];
      const v=c?(c.s/c.n)/maxAvg:0;
      const bg=c?('rgba(223,73,150,'+(0.12+v*0.88).toFixed(2)+')'):'var(--line)';
      rows+='<i class="hm-c" style="background:'+bg+'" title="'+(c?pct(c.s/c.n):'—')+'"></i>';
    }
    rows+='</div>';
  }
  return '<div class="hm-mini">'+rows+
    '<div class="hm-axis">'+cols.map(c=>'<span>'+c+'</span>').join('')+'</div></div>';
}
function heatmap(m){ return heatmapMini(m); }


function sparkPath(vals){
  vals=(vals||[]).filter(v=>v!=null); if(vals.length<2) return '';
  const W=56,H=26,min=Math.min(...vals),max=Math.max(...vals),rng=(max-min)||1,n=vals.length;
  let p=''; vals.forEach((v,i)=>{ const x=i*W/(n-1),y=H-2-((v-min)/rng)*(H-6); p+=(i?'L':'M')+x.toFixed(1)+' '+y.toFixed(1)+' '; });
  return `<svg class="spark" viewBox="0 0 ${W} ${H}"><path d="${p}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function kpiIcon(label){
  const key=String(label||'').toLowerCase();
  let path='';
  if(key.includes('view')) path='<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="2.5"/>';
  else if(key.includes('like')) path='<path d="M20.8 4.6a5.5 5.5 0 00-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 00-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 00-.1-7.8z"/>';
  else if(key.includes('follower')) path='<path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 00-3-3.9M16 3.1a4 4 0 010 7.8"/>';
  else if(key.includes('share')) path='<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 10.5l6.8-4M8.6 13.5l6.8 4"/>';
  else if(key.includes('save')) path='<path d="M6 3h12a1 1 0 011 1v17l-7-4-7 4V4a1 1 0 011-1z"/>';
  else if(key.includes('comment')) path='<path d="M21 15a4 4 0 01-4 4H8l-5 3V7a4 4 0 014-4h10a4 4 0 014 4z"/>';
  else path='<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>';
  return `<svg class="k-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
}

function kpi(label,val,delta,spark){
  return `<div class="kpi"><div class="k-head">${kpiIcon(label)}<div class="k-top">${label}</div></div><div class="k-val">${val}</div>
    <div class="k-sub">${delta||''}${delta?' vs last':''}</div>${spark||''}</div>`;
}
function finding(icon,title,body){
  const ic={ text:'<path d="M4 7V5h16v2M9 20h6M12 5v15"/>', tag:'<path d="M20 12l-8 8-9-9V3h8z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
    clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', fire:'<path d="M12 2s5 4 5 9a5 5 0 01-10 0c0-2 1-3 1-3s3 1 4-6z"/>' }[icon]||'';
  return `<div class="finding"><div class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="url(#navgrad)" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ic}</svg></div>
    <div><b>${title}</b><p>${body}</p></div></div>`;
}
function postRow(x,rank){
  const th = x.thumb ? `<img class="th" src="${esc(x.thumb)}" loading="lazy" onerror="this.style.visibility='hidden'">` : `<div class="th"></div>`;
  const cap = esc(x.caption||'(no caption)').split('\n')[0]||'(no caption)';
  return `<a class="post" href="${esc(x.permalink||'#')}" target="_blank" rel="noopener">
    <div class="rank">${rank}</div>${th}
    <div class="body"><div class="cap">${cap}</div>
      <div class="st"><span><b>${fmt(x.views)}</b> views</span><span><b>${pct(x.eng)}</b> eng</span><span><b>${fmt(x.likes)}</b> likes</span></div></div></a>`;
}
function emptyBlock(title,sub,goto){
  return `<div class="empty"><svg viewBox="0 0 24 24" fill="none" stroke="var(--mut)" stroke-width="1.4"><path d="M3 3v18h18M8 15V9M13 15V6M18 15v-4"/></svg>
    <b>${title}</b><div>${esc(sub)}</div>${goto?`<button class="btn grad sm" style="margin-top:16px;width:auto;padding:10px 20px" onclick="show('${goto}')">Open Setup</button>`:''}</div>`;
}
function skeleton(){ return `<div class="kpis">${'<div class="kpi sk" style="height:92px"></div>'.repeat(6)}</div>
  <div class="sk" style="height:170px;margin-top:14px"></div><div class="sk" style="height:170px;margin-top:14px"></div>`; }


function bridgeBase(){ return location.origin; }
async function loadReels(){  return; }

function greeting(){
  const h = new Date().getHours();
  if(h<12) return 'Good morning';
  if(h<18) return 'Good afternoon';
  return 'Good evening';
}

function platSnapshot(plat){
  const d = jget(cacheKey(plat), null);
  const hist = normalizeHist(d?.history?.length ? d.history : jget(histKey(plat), []));
  const media = d?.media || [];
  const a = d?.account || {};
  const sum = k => media.reduce((s,x)=>s+(+x[k]||0),0);
  // The pack ships the newest 50 posts only, while a history row covers the
  // whole account: summing the short list under-reads the totals and turns
  // every day-over-day cell negative. Then the freshest row is the account.
  const row = hist.length ? hist[hist.length-1] : null;
  const posts = media.length || a.media_count || 0;
  const short = !!row && (+row.posts||0) > posts;
  const live = {
    followers: a.followers_count || (short ? +row.followers||0 : 0),
    username: a.username||'',
    posts: short ? +row.posts||0 : posts,
    views: short ? +row.views||0 : sum('views'),
    likes: short ? +row.likes||0 : sum('likes'),
    fetched: d?.fetched,
    source: d?.source||'',
  };
  const nowPt = short ? row : liveNowPoint(d||{media,account:a,fetched:Date.now()}, hist);
  const base = dayBeforeBase(hist);
  const g = growthFrom(nowPt, base);
  return { plat, live, g, hist, d };
}

function homePlatCard(s){
  const label = s.plat==='tiktok'?'TikTok':'Instagram';
  const color = s.plat==='tiktok'?'#fe2c55':'#df4996';
  const u = s.live.username ? '@'+esc(s.live.username) : 'not linked';
  const g = s.g;
  const cell = (lbl, n, total) => {
    const cls = g.hasBase ? (n>0?'up':n<0?'down':'flat') : 'flat';
    const d = g.hasBase ? signedFmt(n) : '—';
    return `<div class="growth-cell"><div class="tiny muted">${lbl}</div>
      <div class="n" style="color:${color}">${fmt(total)}</div>
      <div class="delta ${cls}" style="font-size:12px">${d} d/d</div></div>`;
  };
  return `<div class="card plat-card">
    <div class="plat-hd">
      <div class="plat-name" style="color:${color}">${label}</div>
      <span class="tiny muted">${esc(u)}${s.live.fetched?` · ${ago(s.live.fetched)}`:''}</span>
    </div>
    ${g.hasBase?'':`<div class="tiny muted" style="margin-bottom:8px">No log (~20h) for day-over-day</div>`}
    <div class="growth-row">
      ${cell('Views', g.dViews, s.live.views)}
      ${cell('Likes', g.dLikes, s.live.likes)}
      ${cell('Followers', g.dFollowers, s.live.followers)}
      <div class="growth-cell"><div class="tiny muted">Posts</div>
        <div class="n">${fmt(s.live.posts)}</div>
        <div class="tiny muted">tracked</div></div>
    </div>
  </div>`;
}

async function loadHome(force){
  const body = $('#homeBody');
  if(!body) return;
  if($('#homeGreet')) $('#homeGreet').textContent = greeting();
  renderAcct();

  if(!lkOk()){
    body.innerHTML = `<div class="card" style="text-align:center;padding:28px 16px">
      <b style="font-size:16px">Code</b>
      <div class="tiny muted" style="margin:10px 0 16px;line-height:1.45"></div>
      <button class="btn grad sm" style="width:auto;padding:12px 28px" onclick="askLk(true)">OK</button>
    </div>`;
    const pp=$('#homePackPill');
    if(pp){ pp.textContent='locked'; pp.className='pill warn'; }
    askLk(false);
    return;
  }

  const ic = $('#homeRefreshIc');
  if(ic && force) ic.classList.add('spin');
  try{

    // Pack-only: never live-pull IG/TT APIs from the portal
    const packRes = await tryLoadPack({force:!!force});
    const pp = $('#homePackPill');
    if(pp){
      if(packRes.ok){
        const pw = packRes.packW || packRes.counts?.packW || 0;
        const t = pw ? new Date(histTsMs(pw)).toLocaleTimeString() : 'ok';
        pp.textContent = 'pack '+t;
        pp.className = 'pill ok';
      } else { pp.textContent = packRes.reason||'local'; pp.className = 'pill'; }
    }

    const ig = platSnapshot('instagram');
    const tt = platSnapshot('tiktok');
    const comb = {
      hasBase: ig.g.hasBase || tt.g.hasBase,
      dViews: (ig.g.dViews||0)+(tt.g.dViews||0),
      dLikes: (ig.g.dLikes||0)+(tt.g.dLikes||0),
      dFollowers: (ig.g.dFollowers||0)+(tt.g.dFollowers||0),
    };
    let html = '';
    if(comb.hasBase){
      html += `<div class="card" style="background:var(--grad-soft);border-color:rgba(223,73,150,.25)">
        <div style="font-weight:800;font-size:13px;margin-bottom:8px">Combined · since prior day</div>
        <div class="growth-row">
          <div class="growth-cell"><div class="tiny muted">Views</div><div class="n delta ${comb.dViews>=0?'up':'down'}">${signedFmt(comb.dViews)}</div></div>
          <div class="growth-cell"><div class="tiny muted">Likes</div><div class="n delta ${comb.dLikes>=0?'up':'down'}">${signedFmt(comb.dLikes)}</div></div>
          <div class="growth-cell"><div class="tiny muted">Followers</div><div class="n delta ${comb.dFollowers>=0?'up':'down'}">${signedFmt(comb.dFollowers)}</div></div>
        </div>
      </div>`;
    } else {
      html += `<div class="card tiny muted">Need more data.</div>`;
    }
    html += homePlatCard(ig) + homePlatCard(tt);
    if(!ig.d && !tt.d){
      html += emptyBlock('No pack data yet','Unlock + Setup → Pull pack','setup');
    }
    body.innerHTML = html;
  } finally {
    if(ic) ic.classList.remove('spin');
  }
}


function saveGroq(){
  const k=$('#grKey').value.trim(); if(!k) return toast('Paste a key','err');
  cfg(LS.gr,k); cfg(LS.grm,$('#grModel').value); $('#grKey').value=''; renderAcct(); toast('Groq key saved','ok');
}


(function init(){
  setTheme(cfg(LS.theme)||'auto');
  matchMedia('(prefers-color-scheme:dark)').addEventListener?.('change',()=>{ if((cfg(LS.theme)||'auto')==='auto') setTheme('auto'); });
  if(cfg(LS.grm)) $('#grModel').value=cfg(LS.grm);

  try{
    const legacy=jget(LS.cache,null);
    if(legacy && !jget(cacheKey('instagram'),null)) jset(cacheKey('instagram'), legacy);
    const lh=jget(LS.hist,null);
    if(lh && !jget(histKey('instagram'),null)) jset(histKey('instagram'), lh);
  }catch{}
  document.querySelectorAll('#platChips [data-plat]').forEach(b=>{
    b.classList.toggle('on', b.dataset.plat===statsPlat);
  });
  renderAcct();
  // Fixed public pack source: no GitHub token or setup screen needed.
  cfg(LS.lk, DEFAULT_LK);
  show('insights');

  // iPad rotate / split-view: reflow current view (charts, home grid)
  let _rzT = 0;
  const onViewport = () => {
    clearTimeout(_rzT);
    _rzT = setTimeout(() => {
      loadInsights(false);
    }, 200);
  };
  window.addEventListener('orientationchange', onViewport);
  window.addEventListener('resize', onViewport);
})();
