import { COLORS, DURATION, MAX_PLAYERS, DOT_RADIUS, stick, padInput, joinPad, createRound, botInput, step } from './engine.mjs';

const $ = id => document.getElementById(id);
const canvas = $('arena'), ctx = canvas.getContext('2d');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const gamepadIcon = '<svg class="controller" viewBox="0 0 28 20" aria-hidden="true"><path d="M8 3h12c3 0 4 3 5 7l1 5c.6 3-2 4-4 2l-4-3h-8l-4 3c-2 2-4.6 1-4-2l1-5C4 6 5 3 8 3Z"/><path d="M7 7v6m-3-3h6" fill="none" stroke="#f8f2e7" stroke-width="1.7"/><circle cx="20" cy="8" r="1.2" fill="#f8f2e7"/><circle cx="23" cy="11" r="1.2" fill="#f8f2e7"/></svg>';
let roster = Array.from({length:MAX_PLAYERS}, () => ({kind:'bot'}));
let round = createRound(roster, true), state = 'attract', paused = false, pauseReason = '';
let scores = Array(MAX_PLAYERS).fill(0), roundNumber = 0, countdown = 0;
let inputs = [], previousStarts = new Map(), pads = new Map(), keys = new Set();
let width = 0, height = 0, scale = 1, cx = 0, cy = 0;
let particles = [], sound = false, audio = null, lastBump = 0;
let shake = 0, effectTime = 0;
const recentImpacts = new Map();
let last = performance.now(), accumulator = 0, uiTick = 0, cachedStatus = '';

const cards = roster.map((_, i) => {
  const el = document.createElement('article');
  el.className = 'player'; el.style.setProperty('--color',COLORS[i]);
  el.innerHTML = `<div class="player-top"><span class="player-number">P${i+1}</span>${gamepadIcon}<span class="input-meter"><i></i></span></div><div class="player-detail"><span class="source">CPU</span><span class="player-score">0 wins</span></div>`;
  $('players').append(el);
  return { el, source:el.querySelector('.source'), score:el.querySelector('.player-score'), meter:el.querySelector('.input-meter i') };
});

function resize() {
  const rect = canvas.getBoundingClientRect();
  width = rect.width; height = rect.height;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.round(width*dpr); canvas.height = Math.round(height*dpr);
  ctx.setTransform(dpr,0,0,dpr,0,0);
  cx = width/2; cy = height*.48;
  scale = Math.min(height*.43, width*(width<740 ? .44 : .32));
}
new ResizeObserver(resize).observe(canvas);

function tone(frequency, duration = .07, gain = .025) {
  if (!sound || !audio) return;
  const osc = audio.createOscillator(), volume = audio.createGain();
  osc.type = 'sine'; osc.frequency.setValueAtTime(frequency,audio.currentTime);
  osc.frequency.exponentialRampToValueAtTime(frequency*.6,audio.currentTime+duration);
  volume.gain.setValueAtTime(gain,audio.currentTime);
  volume.gain.exponentialRampToValueAtTime(.001,audio.currentTime+duration);
  osc.connect(volume); volume.connect(audio.destination); osc.start(); osc.stop(audio.currentTime+duration);
}

function setText(id, value) { if ($(id).textContent !== value) $(id).textContent = value; }
function announce(title='', subtitle='') {
  $('announcement').replaceChildren();
  if (!title) return;
  const strong = document.createElement('strong'), small = document.createElement('small');
  strong.textContent = title; small.textContent = subtitle;
  $('announcement').append(strong,small);
}
function syncUI() {
  const initial = state === 'attract', waiting = state === 'lobby', finished = state === 'result';
  const active = state === 'playing' || state === 'countdown';
  const count = roster.filter(Boolean).length;
  $('solo').hidden = !initial; $('local').hidden = !initial;
  $('start').hidden = initial || active;
  $('start').disabled = count < ($('freeplay').checked ? 1 : 2);
  $('start').textContent = finished ? 'Next round →' : $('freeplay').checked ? 'Start free play →' : 'Start round →';
  $('pause').hidden = !active; $('pause').textContent = paused ? 'Resume' : 'Pause';
  $('lobby').hidden = initial; $('lobby').textContent = waiting ? 'Back' : 'Leave round';
  $('add-wasd').disabled = active || finished || roster.some(p=>p?.kind==='keys' && p.layout==='wasd') || count===8;
  $('add-arrows').disabled = active || finished || roster.some(p=>p?.kind==='keys' && p.layout==='arrows') || count===8;
  const mode = $('freeplay').checked;
  setText('status-heading', initial ? 'COME ON IN' : waiting ? 'THE COUCH IS OPEN' : paused ? 'TAKE YOUR TIME' : finished ? 'ONE MORE?' : mode ? 'EVERYONE STAYS IN' : 'A LITTLE FRIENDLY CHAOS');
  setText('status-text', initial ? 'Grab a controller, or take your keyboard for a spin.' : waiting ? `${count}/8 players joined. Press a controller button to join. Keyboard options are under How to play.` : paused ? pauseReason || 'Paused. Catch your breath, then resume.' : finished ? 'Scores stay with your player. Ready for a rematch?' : mode ? 'Move all eight dots. The player cards show live stick and button input.' : 'Left stick to move. Push other dots over the edge. Last dot inside wins.');
  setText('round-label', initial ? 'WARM-UP' : waiting ? 'JOIN THE GAME' : mode ? 'FREE PLAY' : `ROUND ${String(roundNumber).padStart(2,'0')}`);
  setText('arena-caption', initial ? 'Good friends push each other. Literally.' : mode ? 'Room for everyone. No knockouts, no timer.' : 'The solid line is the edge. Keep your dot inside.');
  for (let i=0;i<8;i++) {
    const p=roster[i], card=cards[i], dot=round.dots.find(d=>d.slot===i);
    const source=!p ? 'PRESS TO JOIN' : p.kind==='bot' ? 'CPU' : p.kind==='keys' ? (p.layout==='wasd' ? 'WASD' : p.layout==='both' ? 'WASD / ↑↓←→' : 'ARROW KEYS') : p.connected ? `PAD ${p.padIndex+1}` : 'DISCONNECTED';
    card.source.textContent=source;
    card.score.textContent= p ? `${scores[i]} ${scores[i]===1?'win':'wins'}` : '—';
    card.el.classList.toggle('empty',!p);
    card.el.classList.toggle('out',!!p && ((active||finished) && dot && !dot.alive));
    card.el.title=p?.kind==='pad' ? p.id : source;
    card.el.setAttribute('aria-label',`Player ${i+1}: ${source}${p ? `, ${scores[i]} wins` : ''}`);
  }
}

function enterLocal() {
  roster=Array(8).fill(null); scores=Array(8).fill(0); roundNumber=0;
  state='lobby'; paused=false; particles=[]; round=createRound(roster,true);
  resetImpacts(); announce(); syncUI();
}
function returnAttract() {
  roster=Array.from({length:8},()=>({kind:'bot'})); scores=Array(8).fill(0);
  state='attract'; paused=false; roundNumber=0; particles=[];
  round=createRound(roster,true); resetImpacts(); announce(); syncUI();
}
function refreshLobby() { round=createRound(roster,true); syncUI(); }
function addKeys(layout) {
  if (state==='attract') enterLocal();
  if(state!=='lobby' || roster.some(p=>p?.kind==='keys' && p.layout===layout)) return;
  const slot=roster.findIndex(p=>!p);
  if(slot<0) return;
  roster[slot]={kind:'keys',layout}; refreshLobby();
}
function beginRound() {
  if(roster.filter(Boolean).length<($('freeplay').checked?1:2)) return;
  // A disconnected pad can be removed from the lobby by choosing Back.
  if(roster.some(p=>p?.kind==='pad'&&!p.connected)) {
    setText('status-text','Reconnect your controller, or go Back to set up a new group.'); return;
  }
  round=createRound(roster,$('freeplay').checked); particles=[]; paused=false;
  countdown=3; state='countdown'; roundNumber++; accumulator=0; resetImpacts();
  announce('3','Get comfortable. Then get competitive.'); tone(440); syncUI();
}
function togglePause(reason='') {
  if(!['playing','countdown'].includes(state)) return;
  if(paused && roster.some(p=>p?.kind==='pad'&&!p.connected)) {
    announce('Controller lost','Reconnect it to resume, or leave the round.'); return;
  }
  paused=!paused; pauseReason=reason;
  announce(paused?'Paused':state==='countdown'?String(Math.ceil(countdown)):'',paused ? reason || 'Space or controller Start to resume.' : '');
  syncUI();
}

$('solo').onclick=()=>{
  roster=Array.from({length:8},(_,i)=>i===0?{kind:'keys',layout:'both'}:{kind:'bot'});
  scores=Array(8).fill(0); roundNumber=0; beginRound();
};
$('local').onclick=enterLocal;
$('start').onclick=beginRound;
$('pause').onclick=()=>togglePause();
$('lobby').onclick=()=>{
  if(state==='lobby') returnAttract();
  else { state='lobby'; paused=false; roster=roster.map(p=>p?.kind==='pad'&&!p.connected?null:p); announce(); refreshLobby(); }
};
$('add-wasd').onclick=()=>addKeys('wasd'); $('add-arrows').onclick=()=>addKeys('arrows');
$('freeplay').onchange=()=>{
  if(['playing','countdown','result'].includes(state)) beginRound(); else syncUI();
};
$('help-toggle').onclick=()=>{const open=$('help').hidden; $('help').hidden=!open; $('help-toggle').setAttribute('aria-expanded',String(open)); syncUI();};
$('sound').onclick=async()=>{
  sound=!sound;
  if(sound) { try { audio ||= new (window.AudioContext||window.webkitAudioContext)(); await audio.resume(); } catch { sound=false; } }
  $('sound').textContent=sound?'Sound on':'Sound off'; $('sound').setAttribute('aria-pressed',String(sound)); tone(660);
};
$('fullscreen').onclick=async()=>{
  try { if(document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); }
  catch { setText('device-status','Full screen is unavailable here. Open the local link in a browser window.'); }
};
document.addEventListener('fullscreenchange',()=>{$('fullscreen').textContent=document.fullscreenElement?'Exit full screen ↙':'Full screen ↗';});
window.addEventListener('keydown',e=>{
  if(e.target.closest('input,textarea,select')) return;
  if(e.code==='Space' && e.target.closest('button,a')) return;
  if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code)) e.preventDefault();
  keys.add(e.code);
  if(e.repeat) return;
  if(e.code==='Space') togglePause();
  if(e.code==='KeyR'&&state==='result') beginRound();
});
window.addEventListener('keyup',e=>keys.delete(e.code));
window.addEventListener('blur',()=>keys.clear());
document.addEventListener('visibilitychange',()=>{
  keys.clear();
  if(document.hidden && !paused) togglePause('The game paused while this tab was hidden.');
  last=performance.now(); accumulator=0;
});

function pollControllers() {
  let raw=[];
  try { raw=Array.from(navigator.getGamepads?.() || []).filter(p=>p?.connected); } catch { /* No exposed gamepads. Keyboard remains available. */ }
  pads=new Map(raw.map(p=>[p.index,p]));
  let changed=false;
  for(const p of roster) if(p?.kind==='pad') {
    const connected=pads.get(p.padIndex)?.id===p.id;
    if(p.connected!==connected) {
      p.connected=connected; changed=true;
      if(!connected && !paused) togglePause(`Player ${roster.indexOf(p)+1} disconnected. Reconnect the controller to resume.`);
    }
  }
  for(const pad of raw) {
    const input=padInput(pad);
    let joinedNow=false;
    if(input.button && (state==='attract'||state==='lobby')) {
      if(state==='attract') enterLocal();
      const slot=joinPad(roster,pad);
      if(slot>=0) { joinedNow=true; changed=true; tone(380+slot*60); refreshLobby(); }
    }
    const belongs=roster.some(p=>p?.kind==='pad'&&p.padIndex===pad.index&&p.id===pad.id);
    if(input.start&&!previousStarts.get(pad.index)&&belongs&&!joinedNow) {
      if(state==='lobby'||state==='result') beginRound(); else togglePause();
    }
    previousStarts.set(pad.index,input.start);
  }
  for(const index of previousStarts.keys()) if(!pads.has(index)) previousStarts.delete(index);
  if(changed) syncUI();
  const unassigned=raw.filter(pad=>!roster.some(p=>p?.kind==='pad'&&p.padIndex===pad.index)).length;
  const count=raw.length;
  const message=count ? `${count} physical controller${count===1?'':'s'} visible to this browser.${unassigned&&['playing','countdown','result'].includes(state)?' New controllers can join in the lobby.':count>8?' The arena has eight slots; extra controllers stay out.':' Press a button to join in the lobby.'}` : 'Controllers join when you press a button. Nothing leaves this device.';
  if(message!==cachedStatus) { cachedStatus=message; setText('device-status',message); }
}

function collectInputs() {
  inputs=roster.map((p,i)=>{
    if(!p) return {x:0,y:0};
    if(p.kind==='pad') return p.connected && pads.has(p.padIndex) ? padInput(pads.get(p.padIndex)) : {x:0,y:0};
    if(p.kind==='bot') {
      const dot=round.dots.find(d=>d.slot===i);
      if(!dot) return {x:0,y:0};
      if(state==='attract') {
        const angle=i/8*Math.PI*2-Math.PI/2+round.elapsed*.22;
        const orbit=.58+Math.sin(round.elapsed*.7+i)*.14;
        return stick((Math.cos(angle)*orbit-dot.x)*3,(Math.sin(angle)*orbit-dot.y)*3);
      }
      return botInput(dot,round);
    }
    const wasd=p.layout!=='arrows', arrows=p.layout!=='wasd';
    return stick(Number((wasd&&keys.has('KeyD'))||(arrows&&keys.has('ArrowRight')))-Number((wasd&&keys.has('KeyA'))||(arrows&&keys.has('ArrowLeft'))), Number((wasd&&keys.has('KeyS'))||(arrows&&keys.has('ArrowDown')))-Number((wasd&&keys.has('KeyW'))||(arrows&&keys.has('ArrowUp'))));
  });
}
function resetImpacts() {
  shake=0; recentImpacts.clear();
}

function sprinkleImpact(event) {
  if(reducedMotion) return;
  const key=event.slots.join(':');
  // A pair can stay in contact for several physics steps. Make one clear burst.
  if(effectTime-(recentImpacts.get(key) ?? -Infinity)<.09) return;
  recentImpacts.set(key,effectTime);
  const count=18+Math.round(event.strength*8);
  const palette=event.slots.map(slot=>COLORS[slot]);
  particles.push({x:event.x,y:event.y,life:.16,max:.16,color:'#242522',burst:false});
  for(let i=0;i<count;i++) {
    const angle=i/count*Math.PI*2+(Math.random()-.5)*.4;
    const speed=.3+Math.random()*.7+event.strength*.18;
    const life=.3+Math.random()*.32;
    particles.push({kind:'sprinkle',x:event.x,y:event.y,
      vx:Math.cos(angle)*speed,vy:Math.sin(angle)*speed,
      life,max:life,color:i%6===0?'#242522':palette[i%2],
      size:1.7+Math.random()*1.9,angle,spin:(Math.random()-.5)*16,
      round:i%3===0});
  }
  // Keep crowded eight-player collisions cheap and the shake very small.
  if(particles.length>560) particles.splice(0,particles.length-560);
  if(state==='playing') shake=Math.min(2,Math.max(shake,1.2+event.strength*.8));
}

function processEvents(events) {
  for(const e of events) {
    if(e.type==='bump') {
      if(performance.now()-lastBump>90 && state!=='attract') { tone(190,.045,.018); lastBump=performance.now(); }
      sprinkleImpact(e);
    }
    if(e.type==='out') {
      tone(120,.22,.035);
      if(!reducedMotion) particles.push({x:e.x,y:e.y,life:.6,max:.6,color:COLORS[e.slot],burst:true});
      syncUI();
    }
    if(e.type==='end') {
      state='result';
      for(const slot of e.winners) scores[slot]++;
      const title=e.winners.length===1?`P${e.winners[0]+1} wins!`:e.winners.length?'Shared win!':'Nobody wins!';
      const subtitle=e.winners.length>1?`Players ${e.winners.map(s=>s+1).join(', ')} survived. Next round?`:e.winners.length?'Friendship: temporarily on hold.':'A spectacular mutual misunderstanding.';
      announce(title,subtitle); tone(780,.4,.04); syncUI();
    }
  }
}

function circle(x,y,r) { ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); }
function draw() {
  ctx.clearRect(0,0,width,height);
  const r=round.radius*scale;
  const shakeX=!paused&&state==='playing'?Math.sin(effectTime*93)*shake:0;
  const shakeY=!paused&&state==='playing'?Math.cos(effectTime*117)*shake*.65:0;
  ctx.save(); ctx.translate(cx+shakeX,cy+shakeY);
  // The dashed line records the original arena; the solid line is the live boundary.
  ctx.setLineDash([8,13]); ctx.strokeStyle='#242522'; ctx.lineWidth=1.6;
  circle(0,0,scale+15); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle='#24252204'; circle(0,0,r); ctx.fill();
  ctx.save(); circle(0,0,r); ctx.clip();
  ctx.fillStyle='#a29b8b30';
  for(let x=-scale;x<scale;x+=15) for(let y=-scale;y<scale;y+=15){ctx.fillRect(x,y,1,1);}
  ctx.restore();
  ctx.strokeStyle='#242522'; ctx.lineWidth=3; circle(0,0,r); ctx.stroke();
  for(const side of [-1,1]) {
    const x=side*(scale+17);
    ctx.beginPath(); ctx.moveTo(x-side*2,0); ctx.lineTo(x+side*11,-6); ctx.lineTo(x+side*11,6); ctx.closePath(); ctx.fillStyle='#242522'; ctx.fill();
  }
  for(const d of round.dots) {
    const color=COLORS[d.slot], radius=DOT_RADIUS*scale;
    if(!reducedMotion) for(let i=0;i<d.trail.length;i++) {
      const t=d.trail[i]; ctx.globalAlpha=(i/d.trail.length)*.13*(d.alive?1:.35);
      ctx.fillStyle=color; circle(t.x*scale,t.y*scale,radius*(.4+.45*i/d.trail.length)); ctx.fill();
    }
    ctx.globalAlpha=d.alive?1:.15;
    const x=d.x*scale,y=d.y*scale;
    ctx.fillStyle=color; circle(x,y,radius*(d.bump>0?1.06:1)); ctx.fill();
    ctx.lineWidth=1.5; ctx.strokeStyle='#ffffffa0'; ctx.stroke();
    ctx.fillStyle=[2,7].includes(d.slot)?'#202923':'#fffaf1';
    ctx.font=`700 ${Math.max(14,radius*1.15)}px Arial`; ctx.textAlign='center'; ctx.textBaseline='middle';ctx.fillText(String(d.slot+1),x,y+1);
    const owner=roster[d.slot];
    if(owner?.kind==='keys'&&state!=='attract') {
      ctx.fillStyle='#242522'; ctx.font='700 8px Arial'; ctx.fillText('YOU',x,y-radius-10);
    }
    ctx.globalAlpha=1;
  }
  for(const p of particles) {
    const progress=1-p.life/p.max;
    if(p.kind==='sprinkle') {
      ctx.save(); ctx.translate(p.x*scale,p.y*scale); ctx.rotate(p.angle);
      ctx.globalAlpha=Math.min(1,p.life/.18); ctx.fillStyle=p.color;
      if(p.round) { circle(0,0,p.size*.65); ctx.fill(); }
      else { ctx.fillRect(-p.size,-p.size*.38,p.size*2,p.size*.76); }
      ctx.restore(); continue;
    }
    ctx.globalAlpha=1-progress; ctx.strokeStyle=p.color; ctx.lineWidth=p.burst?2:1.4;
    for(let i=0;i<8;i++) {
      const a=i*Math.PI/4, inner=(p.burst?15:5)+progress*22, outer=inner+(p.burst?9:5);
      ctx.beginPath();ctx.moveTo(p.x*scale+Math.cos(a)*inner,p.y*scale+Math.sin(a)*inner);ctx.lineTo(p.x*scale+Math.cos(a)*outer,p.y*scale+Math.sin(a)*outer);ctx.stroke();
    }
  }
  ctx.restore(); ctx.globalAlpha=1;
}

function frame(now) {
  const dt=Math.min((now-last)/1000,.05); last=now;
  pollControllers(); collectInputs();
  if(!paused) {
    effectTime+=dt;
    shake=Math.max(0,shake-dt*16);
    if(state==='countdown') {
      const before=Math.ceil(countdown); countdown-=dt;
      if(countdown<=0) {state='playing';announce();tone(700,.15);syncUI();}
      else if(Math.ceil(countdown)!==before) {announce(String(Math.ceil(countdown)),'Get comfortable. Then get competitive.');tone(440);}
    } else if(state==='playing'||state==='attract') {
      accumulator+=dt;
      while(accumulator>=1/120) {
        processEvents(step(round,inputs,1/120)); accumulator-=1/120;
        if(state==='result') {accumulator=0;break;}
      }
    }
    for(const p of particles) {
      p.life-=dt;
      if(p.kind==='sprinkle') {
        const drag=Math.exp(-3*dt);
        p.vx*=drag; p.vy=p.vy*drag+.35*dt;
        p.x+=p.vx*dt; p.y+=p.vy*dt; p.angle+=p.spin*dt;
      }
    }
    particles=particles.filter(p=>p.life>0);
  }
  for(const d of round.dots) if(!paused&&!reducedMotion) {
    d.trail.push({x:d.x,y:d.y}); if(d.trail.length>12)d.trail.shift();
  }
  uiTick+=dt;
  if(uiTick>.08) {
    uiTick=0;
    setText('timer',round.freePlay&&state!=='attract'&&state!=='lobby'?'∞':`00:${String(state==='attract'||state==='lobby'?30:Math.max(0,Math.ceil(DURATION-round.elapsed))).padStart(2,'0')}`);
    setText('clock-caption',round.freePlay&&!['attract','lobby'].includes(state)?'ROOM FOR EVERYONE':'SECONDS TO SURVIVE');
    const alive=round.dots.filter(d=>d.alive).length;
    setText('alive',state==='attract'?'8 dots. No hard feelings.':`${alive} of ${round.dots.length} in the arena`);
    cards.forEach((c,i)=>{
      const input=inputs[i]||{x:0,y:0};
      c.meter.style.transform=`translate(${input.x*7}px,${input.y*7}px)`;
      c.el.classList.toggle('signal',!!input.button);
    });
  }
  draw(); requestAnimationFrame(frame);
}
syncUI(); resize(); requestAnimationFrame(frame);
