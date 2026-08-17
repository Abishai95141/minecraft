// Bootstrap. Finds the two canvases, builds the game, drives the pre-boot
// splash while the textures are painted, then hands over to the title screen.

import { Game } from './game.js';
import { MainMenuScreen } from './ui/screens/mainmenu.js';
import { audio } from './audio/audio.js';

const boot = document.getElementById('boot');
const bootBar = document.getElementById('bootBar');

function progress(fraction, label) {
  if (bootBar) bootBar.style.width = `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%`;
  if (label && boot) boot.setAttribute('data-stage', label);
}

async function main() {
  const canvas = document.getElementById('gl');
  const uiCanvas = document.getElementById('ui');
  if (!canvas || !uiCanvas) throw new Error('Missing the canvas elements in index.html');

  const game = new Game(canvas, uiCanvas);
  // Handy for debugging from the console; nothing in the game reads it.
  window.sowmi = game;

  await game.boot(progress);

  // Fade the pre-boot splash out only once there is something behind it.
  game.openScreen(new MainMenuScreen(game));
  game.start();

  // From here on a stray error is logged, not turned into a crash screen over
  // a game that is otherwise running fine.
  window.__sowmiBooted = true;

  requestAnimationFrame(() => {
    boot?.classList.add('hidden');
    setTimeout(() => { if (boot) boot.style.display = 'none'; }, 300);
  });

  // The audio context is only allowed to start from a user gesture, so the
  // menu music waits for the first click or key press.
  const startAudio = () => {
    audio.init();
    game.audio = audio;
    audio.startMusic('menu');
    window.removeEventListener('pointerdown', startAudio);
    window.removeEventListener('keydown', startAudio);
  };
  window.addEventListener('pointerdown', startAudio, { once: false });
  window.addEventListener('keydown', startAudio, { once: false });
}

main().catch((err) => {
  console.error(err);
  window.__sowmiFatal?.(err);
});
