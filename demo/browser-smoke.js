async (page) => {
  const context = await page.context().browser().newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const tab = await context.newPage();
  const errors = [], checks = [];
  tab.on('pageerror', error => errors.push(error.message));
  const click = action => tab.locator(`[data-action="${action}"]`).first().click();
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const panel = async name => { if (!(await tab.locator(`.meeting-panel[aria-label="${name[0].toUpperCase()+name.slice(1)}"]`).count())) await click(`panel-${name}`); };
  const jump = async index => {
    await tab.goto('http://127.0.0.1:4173/#run');
    await panel('activity');
    await click(`jump-${index}`);
    await tab.locator('#transition-confirm').check();
    await click(`advance-${index}`);
  };
  try {
    await tab.goto('http://127.0.0.1:4173/');
    await tab.getByRole('heading',{level:1,name:'Every group, back in one room.'}).waitFor();
    assert(!/simulation|white cell/i.test(await tab.locator('body').innerText()),'Non-workshop feature remains on landing page');
    await tab.getByRole('button',{name:'Pause animation'}).click();
    assert(await tab.locator('.motion-toggle').getAttribute('aria-pressed')==='true','Landing animation did not pause');
    await tab.getByRole('button',{name:'Play animation'}).click();
    await tab.emulateMedia({reducedMotion:'reduce'});
    assert(await tab.locator('.hs-mark').evaluate(el=>getComputedStyle(el).animationName)==='none','Reduced motion ignored');
    for(const img of await tab.locator('img').all()){await img.scrollIntoViewIfNeeded();await img.evaluate(el=>el.decode());}
    assert(await tab.locator('img').evaluateAll(images=>images.length===2&&images.every(i=>i.complete&&i.naturalWidth>0)),'Landing screenshot asset missing');
    assert(await tab.locator('a[href^="#"]').evaluateAll(links=>links.every(a=>document.getElementById(a.hash.slice(1)))),'Broken landing section link');
    for(const width of [1440,768,390,320]){await tab.setViewportSize({width,height:1000});assert(await tab.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Landing overflow at '+width);}
    await tab.setViewportSize({width:1440,height:1000});
    await tab.getByRole('link',{name:'Explore demo',exact:true}).first().click();
    await tab.locator('.lobby-video').waitFor();
    await tab.locator('.brand').click();await tab.getByRole('link',{name:'Website',exact:true}).click();
    await tab.getByRole('heading',{level:1,name:'Every group, back in one room.'}).waitFor();
    checks.push('landing entry, assets, section links, animation control, reduced motion, responsive layout and app return link');
    await tab.goto('http://127.0.0.1:4173/#lobby');
    assert(await tab.getByRole('button',{name:'Simulation',exact:true}).count()===0,'Simulation switch remains');
    const preview=await tab.locator('.lobby-video').boundingBox();
    assert(Math.abs(preview.x-218)<1 && Math.abs(preview.y-311.5)<1 && Math.abs(preview.width-587.3)<1, 'Lobby moved away from reference geometry');
    assert((await tab.locator('.role-switch').boundingBox()).y<60, 'Role switch left the topbar');
    await tab.goto('http://127.0.0.1:4173/#run');
    const slide=await tab.locator('.presentation').boundingBox(),footer=await tab.locator('.meeting-footer').boundingBox();
    assert(slide.x===112 && slide.y===136 && slide.width===916, 'Session canvas moved away from reference geometry');
    assert(footer.x===76 && footer.y===927 && footer.height===73, 'Full-width footer moved outside viewport');
    assert(await tab.locator('.meeting-panel #timer').count()===1, 'Timer is outside Activity');
    await click('close-panel');assert(await tab.locator('.meeting-panel').count()===0,'Panel did not close');await panel('activity');
    checks.push('mockup lobby and session geometry, header roles, Activity timer, panel dock');
    await tab.goto('http://127.0.0.1:4173/#build');
    await tab.locator('#stage-title').fill('Welcome and get curious');
    await tab.getByRole('button', {name:'Save activity', exact:true}).click();
    await tab.reload();
    assert(await tab.locator('#stage-title').inputValue() === 'Welcome and get curious', 'Edited agenda did not persist');
    await click('add-stage'); await click('template-custom');
    assert(await tab.locator('.agenda-row').count() === 15, 'Template did not add its activity');
    checks.push('agenda editing, reload persistence, template insertion');

    await tab.goto('http://127.0.0.1:4173/#run');
    await click('panel-people'); await click('admit-all'); await panel('activity');
    await jump(1); await click('lobby-participant');
    await tab.locator('#response').fill('The last report arrived late. What got in the way?');
    await tab.getByRole('button',{name:'Submit response',exact:true}).click();
    await tab.getByRole('button',{name:'Allow this version in workshop debrief',exact:true}).click();
    await panel('polls'); await click('vote-1'); await panel('activity');
    await click('help'); await tab.locator('#help-text').fill('Could you visit us?');
    await tab.getByRole('button',{name:'Request help in demo',exact:true}).click();
    await tab.goto('http://127.0.0.1:4173/#review');
    await tab.getByRole('button',{name:'Feedback',exact:true}).last().click();
    await tab.locator('#feedback-text').fill('Good observation. Add a shared next step.');
    await tab.getByRole('button',{name:'Save feedback',exact:true}).click();
    await tab.getByRole('button',{name:'Pin',exact:true}).last().click(); await click('debrief');
    assert((await tab.locator('dialog').innerText()).includes('The last report arrived late.'), 'Approved response absent from debrief');
    await click('close');
    await tab.goto('http://127.0.0.1:4173/#participant');
    await tab.getByRole('button',{name:'Withdraw workshop sharing',exact:true}).click();
    await tab.goto('http://127.0.0.1:4173/#review'); await click('debrief');
    assert(!(await tab.locator('dialog').innerText()).includes('The last report arrived late.'), 'Withdrawn response still published');
    await click('close'); checks.push('admission, response, poll, help, feedback, debrief approval and withdrawal');

    await jump(2); await click('lobby-participant');
    await tab.locator('#group-response').fill('Our group will separate observations from assumptions.');
    await panel('rooms'); await tab.locator('#preview-person').selectOption('1'); await panel('activity');
    assert(await tab.locator('#group-response').inputValue() === 'Our group will separate observations from assumptions.', 'Group draft missing for contributor');
    assert(await tab.locator('#group-form button').isDisabled(), 'Non-recorder can submit');
    await panel('rooms'); await tab.locator('#preview-person').selectOption('0'); await panel('activity');
    await tab.getByRole('button',{name:'Submit group output',exact:true}).click();
    assert((await tab.locator('.panel-content').innerText()).includes('Group output submitted'), 'Group submission missing');
    checks.push('shared local group draft and recorder-only snapshot');

    await jump(5); await click('lobby-participant'); await click('panel-resources');
    assert((await tab.locator('.panel-content').innerText()).includes('Practitioner brief'), 'Practitioner brief missing');
    assert(!(await tab.locator('.panel-content').innerText()).includes('Counterpart brief'), 'Counterpart resource leaked');
    assert(!(await tab.locator('.panel-content').innerText()).includes('A new piece of context'), 'Unreleased resource leaked');
    await click('lobby-facilitator'); await panel('activity'); await click('rotate'); await click('confirm-rotate');
    await click('lobby-participant'); await click('panel-resources');
    assert((await tab.locator('.panel-content').innerText()).includes('Counterpart brief'), 'Role rotation failed to update resources');
    await click('lobby-facilitator'); await click('venue-breakouts'); await click('listen-0');
    assert((await tab.locator('.monitor-banner').innerText()).includes('Listening'), 'Listening notice absent');
    await click('stop-monitor'); await click('announce');
    await tab.locator('#announcement-text').fill('Two minutes left. Capture your next step.');
    await tab.getByRole('button',{name:'Announce in demo',exact:true}).click();
    assert((await tab.locator('.message-list').innerText()).includes('Two minutes left.'), 'Announcement missing');
    checks.push('private resource visibility, role rotation, visible listening, announcement');

    await tab.goto('http://127.0.0.1:4173/#resources'); await click('add-resource');
    await tab.locator('#resource-title').fill('A useful prompt'); await tab.locator('#resource-body').fill('What would a useful next step look like?');
    await tab.locator('#resource-form').getByRole('button',{name:'Add resource',exact:true}).click();
    assert((await tab.locator('.resource-table').innerText()).includes('A useful prompt'), 'Resource creation failed');
    await tab.goto('http://127.0.0.1:4173/#review'); await click('export');
    const downloaded=tab.waitForEvent('download'); await click('export-csv');
    assert((await downloaded).suggestedFilename()==='debrio-responses.csv','CSV download failed');
    await click('close');
    await tab.locator('#evidence-search').fill('nonexistent-evidence');
    assert(await tab.locator('.evidence-card').count()===0,'Evidence filter failed');
    checks.push('resource creation, CSV download, evidence search empty state');

    const overflow=[];
    for (const width of [1440,768,390]) {
      await tab.setViewportSize({width,height:900});
      for (const route of ['lobby','home','build','run','participant','review','resources','templates','settings']) {
        await tab.goto(`http://127.0.0.1:4173/#${route}`);
        const dimensions=await tab.evaluate(()=>({scroll:document.documentElement.scrollWidth,width:innerWidth}));
        if(dimensions.scroll>dimensions.width+1)overflow.push({route,width,...dimensions});
      }
    }
    assert(!overflow.length,JSON.stringify({overflow}));
    checks.push('all nine routes at 1440, 768 and 390 pixels without page overflow');
    await tab.setViewportSize({width:1440,height:1000}); await tab.goto('http://127.0.0.1:4173/#run');
    await click('end'); await click('confirm-end');
    await tab.goto('http://127.0.0.1:4173/#participant'); await panel('activity');
    assert(await tab.locator('#response').isDisabled(),'Ended session still accepts response');
    checks.push('session end closes submissions');
    assert(errors.length===0,errors.join('\n'));
    return {passed:true,checks,pageErrors:errors};
  } finally { await context.close(); }
}
