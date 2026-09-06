export const COLORS = ['#e65d44','#327fe4','#edbc24','#8953ad','#7a9e42','#f58b1d','#e57491','#209e9c'];
export const DURATION = 30;
export const MAX_PLAYERS = 8;
export const DOT_RADIUS = 0.075;

export function stick(x = 0, y = 0) {
  const length = Math.hypot(x, y);
  if (length < 0.16) return { x: 0, y: 0 };
  const scale = Math.min(1, (length - 0.16) / 0.84) / length;
  return { x: x * scale, y: y * scale };
}

export function padInput(pad) {
  const pressed = i => !!pad.buttons?.[i]?.pressed;
  const analog = stick(pad.axes?.[0], pad.axes?.[1]);
  const dx = Number(pressed(15)) - Number(pressed(14));
  const dy = Number(pressed(13)) - Number(pressed(12));
  const movement = dx || dy ? stick(dx, dy) : analog;
  return { ...movement, button: pad.buttons?.some(b => b.pressed) ?? false, start: pressed(9) };
}

// Controller indices are browser identifiers, not player numbers. Keep them intact.
export function joinPad(roster, pad) {
  if (roster.some(p => p?.kind === 'pad' && p.padIndex === pad.index)) return -1;
  const slot = roster.findIndex(p => !p || p.kind === 'bot');
  if (slot < 0) return -1;
  roster[slot] = { kind: 'pad', padIndex: pad.index, id: pad.id, connected: true };
  return slot;
}

export function createRound(roster, freePlay = false) {
  const active = roster.map((p, slot) => p ? slot : -1).filter(slot => slot >= 0);
  return { elapsed: 0, radius: 1, freePlay, done: false, winners: [],
    dots: active.map((slot, i) => {
      const a = i / active.length * Math.PI * 2 - Math.PI / 2;
      return { slot, x: Math.cos(a) * 0.62, y: Math.sin(a) * 0.62,
        vx: 0, vy: 0, alive: true, trail: [], bump: 0 };
    }) };
}

export function botInput(dot, round) {
  const others = round.dots.filter(other => other !== dot && other.alive);
  let target = others.reduce((nearest, other) => !nearest || Math.hypot(other.x-dot.x, other.y-dot.y) < Math.hypot(nearest.x-dot.x, nearest.y-dot.y) ? other : nearest, null);
  const nearEdge = Math.hypot(dot.x, dot.y) > round.radius * 0.62;
  const wiggle = Math.sin(round.elapsed * 1.5 + dot.slot * 1.7) * .26;
  const x = nearEdge ? -dot.x : (target?.x ?? 0) - dot.x + wiggle;
  const y = nearEdge ? -dot.y : (target?.y ?? 0) - dot.y - wiggle;
  const length = Math.hypot(x,y) || 1;
  return { x: x/length * .84, y: y/length * .84 };
}

export function step(round, inputs, dt) {
  if (round.done) return [];
  // Callers use fixed substeps. Bound standalone callers too.
  dt = Math.max(0, Math.min(dt, 1 / 60));
  round.elapsed += dt;
  round.radius = round.freePlay ? 1 : 1 - 0.79 * Math.min(1, round.elapsed / DURATION);
  const events = [];
  for (const d of round.dots) {
    d.bump = Math.max(0, d.bump - dt);
    if (!d.alive) continue;
    const input = inputs[d.slot] || { x: 0, y: 0 };
    d.vx += input.x * 2.7 * dt;
    d.vy += input.y * 2.7 * dt;
    const friction = Math.exp(-3 * dt);
    d.vx *= friction; d.vy *= friction;
    d.x += d.vx * dt; d.y += d.vy * dt;
  }
  for (let i = 0; i < round.dots.length; i++) {
    const a = round.dots[i];
    if (!a.alive) continue;
    for (let j = i + 1; j < round.dots.length; j++) {
      const b = round.dots[j];
      if (!b.alive) continue;
      const dx = b.x-a.x, dy = b.y-a.y, distance = Math.hypot(dx,dy);
      if (distance >= DOT_RADIUS*2) continue;
      const nx = distance > 1e-8 ? dx/distance : 1;
      const ny = distance > 1e-8 ? dy/distance : 0;
      const overlap = (DOT_RADIUS*2-distance)/2;
      a.x -= nx*overlap; a.y -= ny*overlap;
      b.x += nx*overlap; b.y += ny*overlap;
      const closing = (a.vx-b.vx)*nx + (a.vy-b.vy)*ny;
      if (closing > 0) {
        const impulse = Math.min(1.6, closing * 0.95 + 0.16);
        a.vx -= nx*impulse; a.vy -= ny*impulse;
        b.vx += nx*impulse; b.vy += ny*impulse;
        a.bump = b.bump = .18;
        events.push({ type:'bump', x:(a.x+b.x)/2, y:(a.y+b.y)/2,
          slots:[a.slot,b.slot], strength:Math.min(1,closing) });
      }
    }
  }
  for (const d of round.dots) {
    if (!d.alive) continue;
    const distance = Math.hypot(d.x,d.y);
    if (round.freePlay && distance > round.radius - DOT_RADIUS) {
      const nx = d.x/distance, ny = d.y/distance;
      d.x = nx*(round.radius-DOT_RADIUS); d.y = ny*(round.radius-DOT_RADIUS);
      const outward = d.vx*nx+d.vy*ny;
      if (outward > 0) { d.vx -= 1.6*outward*nx; d.vy -= 1.6*outward*ny; }
    } else if (!round.freePlay && distance > round.radius + DOT_RADIUS*.3) {
      d.alive = false;
      events.push({ type:'out', slot:d.slot, x:d.x, y:d.y });
    }
  }
  if (!round.freePlay) {
    const survivors = round.dots.filter(d => d.alive);
    if (survivors.length <= 1 || round.elapsed >= DURATION) {
      round.done = true;
      round.winners = survivors.map(d => d.slot);
      events.push({ type:'end', winners:round.winners });
    }
  }
  return events;
}
