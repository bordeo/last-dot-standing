import test from 'node:test';
import assert from 'node:assert/strict';
import {createRound,step,stick,padInput,joinPad,DOT_RADIUS,MAX_MOVE_SPEED} from './engine.mjs';
const players = n => Array.from({length:n},()=>({kind:'pad'}));

test('eight physical controllers keep distinct slots, including sparse browser indices; a ninth cannot join',()=>{
  const roster=Array(8).fill(null);
  const indices=[0,1,2,3,5,7,10,14];
  indices.forEach((index,i)=>assert.equal(joinPad(roster,{index,id:`pad-${index}`}),i));
  assert.deepEqual(roster.map(p=>p.padIndex),indices);
  assert.equal(joinPad(roster,{index:14,id:'pad-14'}),-1);
  assert.equal(joinPad(roster,{index:20,id:'ninth'}),-1);
  assert.equal(roster.length,8);
});
test('all eight slots receive their own simultaneous inputs',()=>{
  const round=createRound(players(8),true);
  const before=round.dots.map(d=>({x:d.x,y:d.y}));
  const inputs=Array.from({length:8},(_,i)=>({x:(i+1)/12,y:-(i+1)/14}));
  step(round,inputs,1/120);
  round.dots.forEach((d,i)=>{
    assert.ok(d.x>before[i].x && d.y<before[i].y);
    assert.ok(Math.abs(d.vx/inputs[i].x-round.dots[0].vx/inputs[0].x)<1e-10);
  });
});
test('dead zone, diagonal normalization, D-pad and buttons',()=>{
  assert.deepEqual(stick(.05,-.05),{x:0,y:0});
  assert.ok(Math.abs(Math.hypot(...Object.values(stick(1,1)))-1)<1e-10);
  const buttons=Array.from({length:16},(_,i)=>({pressed:[9,12,15].includes(i)}));
  const input=padInput({axes:[0,0],buttons});
  assert.ok(input.x>0 && input.y<0 && input.start && input.button);
});
test('a collision transfers motion and separates both circles',()=>{
  const round=createRound(players(2),true);
  Object.assign(round.dots[0],{x:-.04,y:0,vx:1,vy:0});
  Object.assign(round.dots[1],{x:.04,y:0,vx:0,vy:0});
  const events=step(round,[],1/120);
  assert.ok(events.some(e=>e.type==='bump'));
  assert.ok(round.dots[1].vx>0);
  assert.ok(round.dots[1].x-round.dots[0].x>=DOT_RADIUS*2-1e-10);
});

function accelerate(seconds, input={x:1,y:0}, dt=1/120) {
  const round=createRound(players(1),true);
  for(let i=0;i<Math.round(seconds/dt);i++) {
    // Isolate acceleration from arena walls.
    round.dots[0].x=round.dots[0].y=0;
    step(round,[input],dt);
  }
  return round;
}

test('holding movement builds speed gradually, with equal speed in every direction',()=>{
  const tap=accelerate(.15).dots[0];
  const run=accelerate(1).dots[0];
  const full=accelerate(5).dots[0];
  const diagonal=accelerate(5,{x:1,y:1}).dots[0];
  assert.ok(tap.vx>0 && run.vx>tap.vx*3);
  assert.ok(full.vx>MAX_MOVE_SPEED*.99 && full.vx<=MAX_MOVE_SPEED);
  assert.ok(Math.abs(Math.hypot(diagonal.vx,diagonal.vy)-full.vx)<1e-10);
  assert.ok(Math.abs(accelerate(1,{x:1,y:0},1/60).dots[0].vx-run.vx)<1e-10);
});

test('release brakes smoothly and reversing first cancels forward momentum',()=>{
  const round=accelerate(.8),dot=round.dots[0],before=dot.vx;
  dot.x=dot.y=0;
  step(round,[],1/120);
  assert.ok(dot.vx>0 && dot.vx<before);
  step(round,[{x:-1,y:0}],1/120);
  assert.ok(dot.vx>0);
  for(let i=0;i<120;i++)step(round,[{x:-1,y:0}],1/120);
  assert.ok(dot.vx<-.7);
});

test('a longer run-up hits harder and pushes the opponent farther',()=>{
  function hit(speed) {
    const round=createRound(players(2),true);
    Object.assign(round.dots[0],{x:-DOT_RADIUS,y:0,vx:speed,vy:0});
    Object.assign(round.dots[1],{x:DOT_RADIUS,y:0,vx:0,vy:0});
    const event=step(round,[],1/120).find(e=>e.type==='bump');
    const target=round.dots[1],velocity=target.vx,start=target.x;
    // Measure the target's coast after this single impact.
    round.dots[0].alive=false;
    for(let i=0;i<30;i++)step(round,[],1/120);
    return {velocity,distance:target.x-start,strength:event.strength};
  }
  const gentle=hit(accelerate(.15).dots[0].vx);
  const fast=hit(accelerate(1).dots[0].vx);
  assert.ok(fast.velocity>gentle.velocity*3);
  assert.ok(fast.distance>gentle.distance*3);
  assert.ok(fast.strength>gentle.strength);
});

test('sideways speed and resting contact do not create a forward shove',()=>{
  const round=createRound(players(2),true);
  Object.assign(round.dots[0],{x:-.06,y:0,vx:0,vy:1});
  Object.assign(round.dots[1],{x:.06,y:0,vx:0,vy:1});
  assert.equal(step(round,[],1/120).some(e=>e.type==='bump'),false);
  assert.equal(round.dots[0].vx,0);assert.equal(round.dots[1].vx,0);
  round.dots.forEach(d=>{d.x=0;d.y=0;d.vx=0;d.vy=0;});
  assert.equal(step(round,[],1/120).some(e=>e.type==='bump'),false);
});
test('knockout awards the survivor and finishes only once',()=>{
  const round=createRound(players(2));
  round.dots[0].x=1.2;
  const events=step(round,[],1/120);
  assert.equal(round.dots[0].alive,false); assert.equal(round.done,true);
  assert.deepEqual(round.winners,[1]);
  assert.ok(events.some(e=>e.type==='end'));
  assert.deepEqual(step(round,[],1/120),[]);
});
test('free play preserves all eight dots for more than 30 seconds',()=>{
  const round=createRound(players(8),true);
  for(let tick=0;tick<4000;tick++) step(round,Array.from({length:8},(_,i)=>({x:i%2?1:-1,y:1})),1/120);
  assert.equal(round.done,false); assert.equal(round.radius,1);
  assert.equal(round.dots.filter(d=>d.alive).length,8);
  for(const d of round.dots) assert.ok(Math.hypot(d.x,d.y)<=1-DOT_RADIUS+1e-10);
});
test('time limit permits a shared win, and simultaneous knockouts permit no winner',()=>{
  const round=createRound(players(2));
  round.elapsed=30-1/240;
  Object.assign(round.dots[0],{x:-.08,y:0}); Object.assign(round.dots[1],{x:.08,y:0});
  step(round,[],1/120); assert.deepEqual(round.winners,[0,1]);
  const empty=createRound(players(2)); empty.dots.forEach(d=>{d.x=2;});
  step(empty,[],1/120); assert.equal(empty.done,true); assert.deepEqual(empty.winners,[]);
});
