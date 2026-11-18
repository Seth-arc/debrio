async (page) => {
  const ctx=await page.context().browser().newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  const p=await ctx.newPage(),errors=[],checks=[];
  const assert=(ok,message)=>{if(!ok)throw new Error(message);};
  const click=action=>p.locator(`[data-action="${action}"]`).first().click();
  p.on('pageerror',e=>errors.push(e.message));
  try {
    await p.goto('http://127.0.0.1:4173/#build');
    await p.locator('#stage-title').fill('Keep this activity draft');
    await click('theme');
    assert(await p.locator('#stage-title').inputValue()==='Keep this activity draft','Theme erased activity edits');
    assert(await p.locator('#activity-save-status').innerText()==='Unsaved edits','Unsaved activity presented as saved');
    await click('edit-1');await click('edit-0');
    assert(await p.locator('#stage-title').inputValue()==='Keep this activity draft','Changing activities erased edits');
    await p.getByRole('button',{name:'Save activity',exact:true}).click();await p.reload();
    assert(await p.locator('#stage-title').inputValue()==='Keep this activity draft','Activity save failed');
    assert(await p.locator('#activity-save-status').innerText()==='Saved on this browser','Saved activity remains marked unsaved');
    checks.push('activity drafts survive theme and activity switches; explicit save persists and clears dirty state');

    await p.goto('http://127.0.0.1:4173/#run');await click('panel-messages');
    await p.locator('#message-text').fill('Keep this message draft');
    await p.locator('#message-text').evaluate(el=>el.setSelectionRange(5,5));
    await p.evaluate(()=>window.dispatchEvent(new Event('debrio-media')));
    assert(await p.locator('#message-text').inputValue()==='Keep this message draft','Media update erased message');
    assert(await p.locator('#message-text').evaluate(el=>document.activeElement===el&&el.selectionStart===5),'Media update lost text focus or caret');
    await click('panel-activity');await click('panel-messages');
    assert(await p.locator('#message-text').inputValue()==='Keep this message draft','Panel switch erased message');
    await p.locator('#message-form button').click();
    assert(await p.locator('#message-text').inputValue()==='','Sent message draft was restored');
    await click('close-panel');
    assert(await p.evaluate(()=>document.activeElement.dataset.action==='panel-messages'),'Closing panel lost keyboard focus');
    checks.push('message drafts, caret and keyboard focus survive refreshes; successful send clears draft');

    await p.goto('http://127.0.0.1:4173/#settings');await p.locator('#settings-name').fill('Workshop host');await click('theme');
    assert(await p.locator('#settings-name').inputValue()==='Workshop host','Theme erased settings edits');
    await p.goto('http://127.0.0.1:4173/#lobby');
    const sound=p.getByRole('button',{name:'Test sound',exact:true});
    const bounds=await sound.boundingBox();assert(bounds.width>=44&&bounds.height>=40,'Sound check is too small');
    await sound.focus();await p.keyboard.press('Enter');await p.getByRole('dialog').waitFor();await p.keyboard.press('Escape');
    assert(await sound.evaluate(el=>document.activeElement===el),'Sound dialog lost return focus');
    assert(await p.locator('[data-action="lobby-facilitator"]').getAttribute('aria-pressed')==='true','Role selection is not announced');
    checks.push('discoverable sound check, keyboard dialog flow, selected role semantics, settings draft retention');

    for(const width of [1440,768,390,320]){
      await p.setViewportSize({width,height:1000});
      for(const route of ['lobby','build','run','participant','review']){
        await p.goto('http://127.0.0.1:4173/#'+route);
        assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${route} overflows at ${width}`);
        if(width<=900&&['run','participant'].includes(route)){
          if(!await p.locator('.meeting-panel').count())await click('panel-activity');
          const footer=await p.locator('.meeting-footer').boundingBox(),panel=await p.locator('.meeting-panel').boundingBox();
          assert(footer.y>=panel.y+panel.height-1,'Meeting dock overlaps Activity');
          assert((await p.locator('.participant-strip').boundingBox()).height<120,'Mobile participant strip pushes work too far down');
        }
      }
    }
    checks.push('desktop/tablet/mobile layout, compact participant strip and unobstructed Activity panel');
    await p.goto('http://127.0.0.1:4173/#build');await click('details');
    await p.locator('#workshop-title').fill('W'.repeat(100));
    await p.getByRole('button',{name:'Save details',exact:true}).click();
    for(const route of ['home','build','run']){
      await p.goto('http://127.0.0.1:4173/#'+route);
      assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Long workshop title overflows '+route);
    }
    checks.push('maximum-length workshop title remains usable on narrow screens');
    assert(!errors.length,errors.join('\n'));
    return {passed:true,checks,pageErrors:errors};
  } finally {await ctx.close();}
}
