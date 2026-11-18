async (page) => {
  const ctx = await page.context().browser().newContext({viewport:{width:1440,height:1000}});
  const p = await ctx.newPage(); const errors=[], checks=[];
  p.on('pageerror',error=>errors.push(error.message));
  const assert=(condition,message)=>{if(!condition)throw new Error(message);};
  const click=action=>p.locator(`[data-action="${action}"]`).first().click();
  await p.addInitScript(()=>{
    window.testMedia={streams:[],calls:[],outputs:[],deny:false,delay:false,release:null};
    HTMLMediaElement.prototype.setSinkId=async function(id){testMedia.outputs.push(['music',id]);};
    AudioContext.prototype.setSinkId=async function(id){if(id==='broken')throw new DOMException('Disconnected','NotFoundError');testMedia.outputs.push(['context',id]);};
    Object.defineProperty(navigator.mediaDevices,'enumerateDevices',{value:async()=>[
      {kind:'videoinput',deviceId:'camera-a',label:'Test camera A'},
      {kind:'videoinput',deviceId:'camera-b',label:'Test camera B'},
      {kind:'audioinput',deviceId:'mic-a',label:'Test microphone'},
      {kind:'audiooutput',deviceId:'speaker-a',label:'Test speaker'},
      {kind:'audiooutput',deviceId:'broken',label:'Disconnected speaker'}
    ]});
    Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async constraints=>{
      testMedia.calls.push(constraints);
      if(testMedia.deny)throw new DOMException('Test permission denial','NotAllowedError');
      let stream;
      if(constraints.video){const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;const g=canvas.getContext('2d');g.fillStyle='#405951';g.fillRect(0,0,640,360);g.fillStyle='#e8eae7';g.font='24px sans-serif';g.fillText('Synthetic camera test',170,180);stream=canvas.captureStream(15);}
      else {const audio=new AudioContext(),oscillator=audio.createOscillator(),output=audio.createMediaStreamDestination();oscillator.frequency.value=440;oscillator.connect(output);oscillator.start();await audio.resume();stream=output.stream;testMedia.audio=audio;}
      testMedia.streams.push(stream);
      if(testMedia.delay)await new Promise(resolve=>testMedia.release=resolve);
      return stream;
    }});
  });
  try {
    await p.goto('http://127.0.0.1:4173/#lobby');
    assert(await p.evaluate(()=>testMedia.calls.length===0),'Requested a device without user action');
    await p.evaluate(()=>testMedia.deny=true);await click('camera');
    assert((await p.locator('.device-error').innerText()).includes('Allow camera access'),'Permission denial is not actionable');
    await p.evaluate(()=>testMedia.deny=false);await click('camera');
    await p.waitForFunction(()=>document.querySelector('video')?.videoWidth===640);
    assert(await p.evaluate(()=>document.querySelector('video').muted),'Self-video could echo audio');
    await p.locator('#camera-device').selectOption('camera-b');
    await p.waitForFunction(()=>testMedia.streams.length===2 && LocalMedia.state.camera);
    assert(await p.evaluate(()=>testMedia.streams[0].getTracks()[0].readyState==='ended'),'Old camera track leaked on switch');
    await click('mic');await p.waitForFunction(()=>document.querySelector('[data-mic-meter]').value>0);
    await p.locator('#speaker-device').selectOption('speaker-a');
    assert(await p.evaluate(()=>LocalMedia.state.speakerId==='speaker-a'&&testMedia.outputs.some(([kind,id])=>kind==='context'&&id==='speaker-a')),'Speaker selection did not reach both audio paths');
    await p.locator('#speaker-device').selectOption('broken');
    assert(await p.evaluate(()=>LocalMedia.state.speakerId==='speaker-a'&&LocalMedia.state.audioError&&testMedia.outputs.at(-1)[1]==='speaker-a'),'Failed speaker selection did not roll back');
    checks.push('speaker selection and failed-output rollback');
    assert(await p.evaluate(()=>!LocalMedia.state.listen),'Microphone echoed by default');
    await click('sound-check');await click('listen-self');assert(await p.evaluate(()=>LocalMedia.state.listen),'Hear myself failed');
    await click('listen-self');
    checks.push('explicit device request, permission denial, live self-preview, device switch cleanup, real analyser meter, opt-in monitoring');
    await click('speaker-test');await p.waitForFunction(()=>LocalMedia.state.speaker);await p.waitForFunction(()=>!LocalMedia.state.speaker);
    await click('close');await click('lobby-participant');await click('ask-join');await p.waitForFunction(()=>LocalMedia.state.music);
    await click('sound-check');await p.locator('#music-volume').fill('0.1');
    assert(await p.evaluate(()=>LocalMedia.state.volume===.1),'Volume not applied');
    await click('close');await click('join-now');await p.waitForURL('**/#participant');
    assert(await p.evaluate(()=>!LocalMedia.state.music&&!LocalMedia.state.listen&&LocalMedia.state.camera&&LocalMedia.state.mic),'Join did not stop waiting audio or retain device preview');
    await p.locator('.local-tile video').waitFor({state:'visible'});
    await click('session-options');await click('sound-check');await click('listen-self');
    assert(await p.evaluate(()=>LocalMedia.state.listen),'In-session sound check stopped monitoring');
    await p.keyboard.press('Escape');
    await p.waitForFunction(()=>!LocalMedia.state.listen);
    await click('camera');assert(await p.evaluate(()=>!LocalMedia.state.camera),'Camera toggle failed');
    await click('mic');assert(await p.evaluate(()=>testMedia.streams.every(s=>s.getTracks().every(t=>t.readyState==='ended'))),'Disabled devices still active');
    checks.push('speaker test lifecycle, WAV playback, volume, waiting-to-session handoff, camera and mic stop');
    await click('session-options');await click('devices');await p.evaluate(()=>testMedia.delay=true);await click('camera');
    await p.waitForFunction(()=>testMedia.release!==null);await click('camera');
    await p.evaluate(()=>testMedia.release());
    await p.waitForFunction(()=>testMedia.streams.at(-1).getTracks()[0].readyState==='ended');
    assert(await p.evaluate(()=>!LocalMedia.state.camera),'Cancelled request reactivated camera');
    await p.evaluate(()=>testMedia.delay=false);await click('camera');await p.waitForFunction(()=>LocalMedia.state.camera);
    await p.evaluate(()=>testMedia.streams.at(-1).getTracks()[0].dispatchEvent(new Event('ended')));
    assert((await p.locator('.device-error').innerText()).includes('disconnected'),'Disconnect not shown');
    await click('camera');await p.waitForFunction(()=>LocalMedia.state.camera);
    await p.goto('http://127.0.0.1:4173/#build');
    assert(await p.evaluate(()=>testMedia.streams.every(s=>s.getTracks().every(t=>t.readyState==='ended'))),'Navigating away leaked device tracks');
    checks.push('cancelled pending request, disconnect recovery, navigation cleanup');
    await p.goto('http://127.0.0.1:4173/#lobby');await click('theme');
    assert(await p.locator('body').getAttribute('data-theme')==='light','Theme did not change');
    for(const width of [1440,768,390]){await p.setViewportSize({width,height:900});assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Lobby overflow at '+width);}
    assert(errors.length===0,errors.join('\n'));
    return {passed:true,checks,syntheticDevices:true,physicalDevicesTested:false,pageErrors:errors};
  }finally{await ctx.close();}
}
