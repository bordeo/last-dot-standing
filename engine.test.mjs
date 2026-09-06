import test from 'node:test';
import assert from 'node:assert/strict';
import {createRound,step,stick,padInput,joinPad,DOT_RADIUS} from './engine.mjs';
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
  const inputs=Array.from({length:8},(_,i)=>({x:(i+1)/10,y:-(i+1)/12}));
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
