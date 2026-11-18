'use strict';
const motionButton=document.querySelector('.motion-toggle');
motionButton.addEventListener('click',()=>{
  const paused=document.querySelector('.hs').classList.toggle('still');
  motionButton.setAttribute('aria-pressed',String(paused));
  motionButton.textContent=paused?'Play animation':'Pause animation';
});
