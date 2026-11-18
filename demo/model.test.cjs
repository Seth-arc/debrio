const { test } = require('node:test');
const assert = require('node:assert/strict');
const D = require('./model.js');
test('20 people have balanced home, expert and practice assignments', () => {
  for (const [mode, sizes] of [['home',[4,4,4,4,4]],['expert',[5,5,5,5]],['practice',[3,3,3,3,4,4]]]) {
    const groups = Object.groupBy(D.seed().participants, p=>D.assignment(p.id,mode).room);
    assert.deepEqual(Object.values(groups).map(g=>g.length).sort(),sizes);
    for (const members of Object.values(groups)) {
      const roles=members.map(p=>D.assignment(p.id,mode).role);
      if(mode==='practice'){assert.equal(roles.filter(r=>r==='practitioner').length,1);assert.equal(roles.filter(r=>r==='counterpart').length,1);}
      else assert.equal(roles.filter(r=>r==='recorder').length,1);
    }
  }
});
test('role rotations give every participant a practitioner turn', () => {
  for(let id=0;id<20;id++) assert.ok(Array.from({length:4},(_,round)=>D.assignment(id,'practice',round).role).includes('practitioner'));
});
test('private and unreleased resources remain assignment scoped', () => {
  const s=D.seed();s.current=5;
  assert.deepEqual(D.visibleResources(s,0).map(r=>r.id),['r1','r2']);
  assert.deepEqual(D.visibleResources(s,1).map(r=>r.id),['r1','r3']);
  s.round=1;assert.deepEqual(D.visibleResources(s,0).map(r=>r.id),['r1','r3']);
  s.resources.find(r=>r.id==='r4').released=true;
  assert.ok(D.visibleResources(s,0).some(r=>r.id==='r4'));
});
test('individual revisions preserve originals and never inherit approval', () => {
  const s=D.seed();s.current=1;const first=D.submit(s,0,'First opening');first.approved=true;first.pinned=true;
  s.current=3;const second=D.submit(s,0,'Revised opening');
  assert.equal(second.previous,first.id);assert.equal(second.version,2);assert.equal(first.text,'First opening');assert.equal(second.approved,false);
  s.current=12;const transfer=D.submit(s,0,'Transfer to a new situation');assert.equal(transfer.previous,null);
  second.pinned=true;assert.ok(!D.curated(s).includes(second));first.approved=false;assert.ok(!D.curated(s).includes(first));
});
test('group submissions require recorder and retain contributor snapshots', () => {
  const s=D.seed();s.current=2;
  assert.throws(()=>D.submitGroup(s,1,'Group guide'),/recorder/);
  const first=D.submitGroup(s,0,'Group guide');assert.deepEqual(first.contributors,[0,1,2,3]);assert.equal(first.group,'Willow');
  const second=D.submitGroup(s,0,'Refined guide');assert.equal(second.previous,first.id);assert.equal(first.text,'Group guide');
});
test('empty and ended-session submissions are rejected without creating records', () => {
  const s=D.seed(),count=s.attempts.length;assert.throws(()=>D.submit(s,0,'   '));s.ended=true;assert.throws(()=>D.submit(s,0,'An answer'));assert.equal(s.attempts.length,count);
});
test('timer clamps at zero and does not advance or submit work', () => {
  const s=D.seed();s.deadline=10000;assert.equal(D.remaining(s,5000),5);assert.equal(D.remaining(s,11000),0);assert.equal(s.current,0);assert.equal(s.attempts.length,3);
  s.deadline=null;s.remaining=42;assert.equal(D.remaining(s),42);
});
