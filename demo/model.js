(function (root) {
  'use strict';
  const names = ['Amara Okafor', 'Theo Bennett', 'Priya Raman', 'Mateo Silva', 'Nia Brooks', 'Oliver Park', 'Leila Haddad', 'Ethan Cole', 'Zuri Mensah', 'Finn Walsh', 'Sana Mirza', 'Luca Moretti', 'Maya Chen', 'Noah Adeyemi', 'Ines Duarte', 'Arjun Mehta', 'Elena Torres', 'Kai Nakamura', 'Freya Lind', 'Darius Reed'];
  const templates = {
    custom: { name: 'Custom stage', subtitle: 'Your structure. Your way.', steps: [['Welcome & set the scene', 5, 'main', 'Share one conversation you have been putting off. What makes it difficult?']] },
    peer: { name: 'Peer instruction', subtitle: 'Think. Discuss. Think again.', steps: [['Make your first call', 3, 'individual', 'A colleague has missed two deadlines. How would you open the conversation? Write your opening and explain your reasoning.'], ['Compare perspectives', 6, 'home', 'Discuss your opening lines. What is an observation, and what is an assumption? Agree on one principle to keep.'], ['Reconsider your answer', 3, 'individual', 'Write your opening again after hearing your group. Explain what you changed and why.'], ['Reveal & discuss', 4, 'main', 'Compare the two approaches. Notice what became more specific without assuming that a changed answer proves learning.']] },
    practice: { name: 'Role practice', subtitle: 'Practice with purpose. Retry with feedback.', steps: [['Read your role brief', 3, 'practice', 'Practitioner: address two missed deadlines. Counterpart: you are balancing unclear priorities. Observers: notice specific evidence, curiosity, and an agreed next step.'], ['Try the conversation', 6, 'practice', 'Practitioner opens the conversation. Counterpart responds. Observers capture exact language against the feedback checklist.'], ['Give useful feedback', 4, 'practice', 'Give one concrete example of what worked and one suggestion. Use the three criteria: specific observation, open question, agreed next step.'], ['Retry with intention', 5, 'practice', 'Repeat the opening using the feedback. Save a new attempt; keep the original intact. Rotate roles for another practice round.']] },
    jigsaw: { name: 'Jigsaw', subtitle: 'Become the expert. Bring it home.', steps: [['Meet your home group', 2, 'home', 'Each person takes one lens: observation, impact, curiosity, or next steps. You will bring this expertise back to your home group.'], ['Explore with experts', 7, 'expert', 'Meet others with your topic. Write two practical guidelines and one example to teach your home group.'], ['Teach your home group', 7, 'home', 'Return to your original group. Each expert teaches their lens. Combine the four lenses into a conversation guide.'], ['Individual transfer', 4, 'individual', 'Apply your group’s guide to a different situation: a teammate repeatedly interrupts others. What would you say first, and why?']] }
  };
  function stages(kind) { return templates[kind].steps.map(([title, minutes, grouping, instructions], i) => ({ id: `${kind}-${Date.now()}-${i}-${Math.random().toString(36).slice(2,7)}`, kind, title, minutes, grouping, instructions })); }
  function seed() {
    const agenda = [...stages('custom'), ...stages('peer'), ...stages('practice'), ...stages('jigsaw'), { id: 'debrief', kind: 'custom', title: 'Bring it all together', minutes: 8, grouping: 'main', instructions: 'Look at the selected work. What changed? What will you try in your next real conversation?' }];
    return { version: 1, demoMode: true, title: 'Conversations that move work forward', description: 'A practical workshop for thoughtful, confident feedback.', client: 'Northstar People Studio', agenda, current: 0, started: false, ended: false, remaining: 300, deadline: null, round: 0, participants: names.map((name, i) => ({ id: i, name, admitted: i < 18 })), drafts: {}, attempts: [
      { id: 'sample-1', author: 3, stage: agenda[1].id, title: 'Make your first call', text: 'You keep missing deadlines. We need to talk about your performance.', version: 1, previous: null, approved: false, pinned: false, feedback: 'Name the two specific deadlines instead of generalizing. Invite their perspective.', criteria: [true, false, false], audience: 'workshop' },
      { id: 'sample-2', author: 3, stage: agenda[3].id, title: 'Reconsider your answer', text: 'The last two reports arrived after our agreed date, which left the team little time to review. What got in the way, and how can we plan the next one together?', version: 2, previous: 'sample-1', approved: true, pinned: true, feedback: 'Specific observation, a genuine question, and a shared next step.', criteria: [true, true, true], audience: 'workshop' },
      { id: 'sample-3', author: 8, stage: agenda[11].id, title: 'Home-group conversation guide', text: 'Start with what you observed. Describe the impact without assigning intent. Ask a real question, then agree one next step together.', version: 1, previous: null, approved: true, pinned: true, feedback: '', criteria: [], audience: 'workshop', group: 'Cedar' }
    ], resources: [
      { id: 'r1', title: 'The conversation field guide', type: 'Guide', audience: 'all', released: true, body: '1. Observation: describe what happened, without a label.\n2. Impact: name the effect on people or work.\n3. Curiosity: ask a question you do not already know the answer to.\n4. Next step: agree something specific, together.' },
      { id: 'r2', title: 'Practitioner brief', type: 'Role brief', audience: 'practitioner', released: true, body: 'You lead a small project team. Two reports arrived late, affecting the review cycle. You want to understand what happened and agree a workable plan. Begin with an observation, not a judgment.' },
      { id: 'r3', title: 'Counterpart brief', type: 'Role brief', audience: 'counterpart', released: true, body: 'Two managers have given you conflicting priorities. You have been reluctant to ask which work matters most. Respond honestly when the practitioner invites your perspective.' },
      { id: 'r4', title: 'A new piece of context', type: 'Scenario update', audience: 'all', released: false, body: 'The reporting deadlines moved by two days, but the updated schedule was only shared with half the team. Revisit your assumptions before continuing.' }
    ], messages: [{ id: 'welcome', author: 'Rowan Ellis', target: 'all', text: 'Welcome, everyone. Take a moment to settle in. You will find everything you need here.', time: '10:00' }], help: [{ id: 'h1', author: 8, room: 'Cedar', text: 'Could we get an example of an observation versus a judgment?', resolved: false }], poll: { question: 'What makes feedback conversations hardest?', options: ['Finding the right words', 'Managing emotions', 'Agreeing what happens next'], votes: { 1: 0, 2: 1, 3: 0, 4: 2, 5: 1, 6: 0, 7: 0 }, open: true, revealed: false }, settings: { name: 'Rowan Ellis', workspace: 'Rowan’s workspace', captions: true }, published: false };
  }
  const homeNames = ['Willow', 'Birch', 'Cedar', 'Maple', 'Oak'];
  const topics = ['Observation', 'Impact', 'Curiosity', 'Next steps'];
  function assignment(id, grouping, round = 0) {
    if (grouping === 'practice') {
      const group = id < 12 ? Math.floor(id / 3) : 4 + Math.floor((id - 12) / 4);
      const size = group < 4 ? 3 : 4;
      const offset = id < 12 ? id % 3 : (id - 12) % 4;
      return { room: ['Willow', 'Birch', 'Cedar', 'Maple', 'Oak', 'Elm'][group], role: ['practitioner', 'counterpart', 'observer', 'observer'][(offset + round) % size] };
    }
    if (grouping === 'expert') return { room: topics[id % 4], role: id < 4 ? 'recorder' : 'expert' };
    return { room: grouping === 'main' || grouping === 'individual' ? 'Main room' : homeNames[Math.floor(id / 4)], role: id % 4 === 0 ? 'recorder' : 'participant' };
  }
  function submit(state, author, text) {
    if (!text.trim()) throw new Error('Write a response before submitting.');
    if (state.ended) throw new Error('This session has ended. Your draft is still saved.');
    const stage = state.agenda[state.current];
    const revision = /reconsider|retry/i.test(stage.title);
    const stageKind = id => state.agenda.find(s => s.id === id)?.kind;
    const prior = state.attempts.filter(a => a.author === author && !a.group && (a.stage === stage.id || revision && stageKind(a.stage) === stage.kind)).at(-1);
    const item = { id: `a-${Date.now()}-${Math.random().toString(36).slice(2,8)}`, author, stage: stage.id, title: stage.title, text: text.trim(), version: prior ? prior.version + 1 : 1, previous: prior?.id || null, approved: false, pinned: false, feedback: '', criteria: [], audience: 'workshop' };
    state.attempts.push(item); return item;
  }
  function curated(state) { return state.attempts.filter(a => a.pinned && a.approved); }
  function submitGroup(state, author, text) {
    const stage = state.agenda[state.current], assigned = assignment(author, stage.grouping, state.round);
    if (!['home','expert'].includes(stage.grouping) || assigned.role !== 'recorder') throw new Error('Only the assigned recorder can submit this group’s work.');
    if (!text.trim()) throw new Error('Write the group output before submitting.');
    if (state.ended) throw new Error('This session has ended.');
    const prior = state.attempts.filter(a => a.group === assigned.room && a.stage === stage.id).at(-1);
    const contributors = state.participants.filter(p => assignment(p.id, stage.grouping, state.round).room === assigned.room).map(p=>p.id);
    const item = { id: `g-${Date.now()}-${Math.random().toString(36).slice(2,8)}`, author, stage: stage.id, title: stage.title, text: text.trim(), version: prior ? prior.version + 1 : 1, previous: prior?.id || null, group: assigned.room, contributors, approved: true, pinned: false, feedback: '', criteria: [], audience: 'workshop' };
    state.attempts.push(item); return item;
  }
  function visibleResources(state, author) { const role = assignment(author, state.agenda[state.current].grouping, state.round).role; return state.resources.filter(r => r.released && (r.audience === 'all' || r.audience === role)); }
  function remaining(state, now = Date.now()) { return state.deadline ? Math.max(0, Math.ceil((state.deadline - now) / 1000)) : state.remaining; }
  const api = { seed, templates, stages, assignment, submit, submitGroup, curated, visibleResources, remaining };
  if (typeof module !== 'undefined') module.exports = api;
  else root.Debrio = api;
})(typeof window !== 'undefined' ? window : globalThis);
