'use strict';
// Device streams stay in memory on this page. Nothing is recorded or transmitted.
window.LocalMedia = (() => {
  const state = { camera: false, mic: false, cameraPending: false, micPending: false, cameraError: '', micError: '', audioError: '', devices: [], cameraId: '', micId: '', speakerId: '', music: false, volume: .25, listen: false, speaker: false };
  const streams = { camera: null, mic: null }, generation = { camera: 0, mic: 0 };
  const music = new Audio('assets/Debrio_Lobby_music.wav');
  music.preload = 'none'; music.loop = true; music.volume = state.volume;
  let context, source, analyser, monitor, frame, tone, toneGain;
  const emit = () => window.dispatchEvent(new Event('debrio-media'));
  async function audioContext() {
    if (!context || context.state === 'closed') { context = new AudioContext(); if(state.speakerId && context.setSinkId) await context.setSinkId(state.speakerId); }
    if (context.state === 'suspended') await context.resume();
    return context;
  }
  function stopMicGraph() {
    cancelAnimationFrame(frame); source?.disconnect(); analyser?.disconnect(); monitor?.disconnect();
    source = analyser = monitor = null; state.listen = false;
  }
  function meter() {
    if (!analyser) return;
    const samples = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(samples);
    const rms = Math.sqrt(samples.reduce((sum, v) => sum + v * v, 0) / samples.length);
    const level = Math.min(100, Math.round(rms * 400));
    document.querySelectorAll('[data-mic-meter]').forEach(el => { el.value = level; });
    frame = requestAnimationFrame(meter);
  }
  function explain(error, kind) {
    const device = kind === 'camera' ? 'camera' : 'microphone';
    if (['NotAllowedError','SecurityError'].includes(error.name)) return `Allow ${device} access in your browser’s site settings, then try again.`;
    if (error.name === 'NotFoundError') return `No ${device} found. Connect one and try again.`;
    if (error.name === 'NotReadableError') return `Your ${device} is busy or unavailable. Close other apps using it, then retry.`;
    if (error.name === 'OverconstrainedError') return `That ${device} is unavailable. Choose another device.`;
    return `Could not start the ${device}. Check your device and browser permissions.`;
  }
  function stop(kind) {
    generation[kind]++; streams[kind]?.getTracks().forEach(track => track.stop()); streams[kind] = null;
    state[kind] = false; state[kind + 'Pending'] = false;
    if (kind === 'mic') stopMicGraph();
  }
  async function refreshDevices() {
    try { state.devices = await navigator.mediaDevices.enumerateDevices(); } catch { state.devices = []; }
  }
  async function start(kind, deviceId = state[kind + 'Id']) {
    stop(kind); const ticket = generation[kind];
    state[kind + 'Error'] = ''; state[kind + 'Pending'] = true; emit();
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        state[kind + 'Error'] = 'Open this demo on localhost or HTTPS to use your devices.'; return;
      }
      const constraints = kind === 'camera' ? { video: { ...(deviceId ? {deviceId: {exact: deviceId}} : {}), width: {ideal:1280}, height:{ideal:720} }, audio:false } : { video:false, audio: { ...(deviceId ? {deviceId:{exact:deviceId}} : {}), echoCancellation:true, noiseSuppression:true } };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      if (ticket !== generation[kind]) { stream.getTracks().forEach(t=>t.stop()); return; }
      streams[kind] = stream; state[kind] = true;
      state[kind + 'Id'] = stream.getTracks()[0].getSettings().deviceId || deviceId;
      stream.getTracks()[0].addEventListener('ended', () => {
        if (streams[kind] !== stream) return;
        stop(kind); state[kind + 'Error'] = `${kind === 'camera' ? 'Camera' : 'Microphone'} disconnected. Select a device and try again.`; emit();
      });
      if (kind === 'mic') {
        pauseMusic(); const ctx = await audioContext();
        if (ticket !== generation[kind]) return;
        source = ctx.createMediaStreamSource(stream); analyser = ctx.createAnalyser(); analyser.fftSize = 256;
        source.connect(analyser); monitor = ctx.createGain(); monitor.gain.value = 0;
        source.connect(monitor); monitor.connect(ctx.destination); meter();
      }
      await refreshDevices();
    } catch (error) {
      if (ticket === generation[kind]) { stop(kind); state[kind + 'Error'] = explain(error, kind); }
    } finally { if (ticket === generation[kind]) state[kind + 'Pending'] = false; emit(); }
  }
  async function toggle(kind) { if (state[kind] || state[kind + 'Pending']) { stop(kind); emit(); } else await start(kind); }
  function attach() {
    document.querySelectorAll('[data-local-video]').forEach(video => {
      video.muted = true;
      if (video.srcObject !== streams.camera) { video.srcObject = streams.camera; if (streams.camera) video.play().catch(()=>{}); }
    });
  }
  function pauseMusic() { music.pause(); state.music = false; }
  async function playMusic() {
    state.audioError = ''; if (monitor) monitor.gain.value = 0; state.listen = false;
    try { await music.play(); state.music = !music.paused; }
    catch { state.music = false; state.audioError = 'Music could not play. Check your speakers, then press Play music to retry.'; }
    emit();
  }
  async function toggleMusic() { if (state.music) { pauseMusic(); emit(); } else await playMusic(); }
  async function setOutput(id) {
    const previous=state.speakerId;state.audioError='';
    try {
      if(!music.setSinkId || !AudioContext.prototype.setSinkId){if(id)throw new Error('Unsupported output selection');return;}
      await music.setSinkId(id);if(context)await context.setSinkId(id);state.speakerId=id;
    } catch {
      await music.setSinkId?.(previous).catch(()=>{});await context?.setSinkId?.(previous).catch(()=>{});
      state.audioError='Could not select that speaker. Check its connection or use System default.';
    } finally {emit();}
  }
  async function testSpeaker() {
    pauseMusic(); state.audioError = '';
    try {
      const ctx = await audioContext(); if (tone) tone.stop();
      const oscillator = ctx.createOscillator(), gain = ctx.createGain(); tone = oscillator; toneGain = gain;
      oscillator.type = 'sine'; oscillator.frequency.setValueAtTime(440, ctx.currentTime); oscillator.frequency.setValueAtTime(660, ctx.currentTime+.4);
      gain.gain.setValueAtTime(0,ctx.currentTime); gain.gain.linearRampToValueAtTime(.12,ctx.currentTime+.03); gain.gain.setValueAtTime(.12,ctx.currentTime+.7); gain.gain.linearRampToValueAtTime(0,ctx.currentTime+.85);
      oscillator.connect(gain); gain.connect(ctx.destination); oscillator.start(); oscillator.stop(ctx.currentTime+.9); state.speaker = true;
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); if(tone===oscillator){tone=null;toneGain=null;state.speaker=false;emit();} };
    } catch { state.audioError = 'Speaker test could not start. Check your browser’s sound setting.'; }
    emit();
  }
  function listen() {
    if (!state.mic || !monitor) return;
    pauseMusic(); state.listen = !state.listen; monitor.gain.value = state.listen ? .6 : 0; emit();
  }
  function stopAll() {
    stop('camera'); stop('mic'); pauseMusic(); if(tone){tone.onended=null;tone.stop();tone.disconnect();toneGain?.disconnect();tone=null;toneGain=null;} state.speaker=false;
    context?.close().catch(()=>{}); context=null;
  }
  music.addEventListener('error',()=>{state.music=false;state.audioError='Lobby music could not load. Check assets/Debrio_Lobby_music.wav.';emit();});
  navigator.mediaDevices?.addEventListener('devicechange',async()=>{await refreshDevices();emit();});
  window.addEventListener('pagehide',stopAll);
  return {state,start,toggle,attach,playMusic,pauseMusic,toggleMusic,testSpeaker,listen,stopAll,setOutput,outputSelection:!!music.setSinkId&&!!AudioContext.prototype.setSinkId, setVolume(value){state.volume=Number(value);music.volume=state.volume;}, stopListening(){if(monitor)monitor.gain.value=0;state.listen=false;} };
})();
