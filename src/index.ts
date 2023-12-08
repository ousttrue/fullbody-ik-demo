import * as THREE from 'three';
import { ThreeApp } from './app.js';
import {
  initImGui, beginImGui, endImGui
} from './gui.js';


window.onload = async () => {
  const canvas = document.getElementById("canvas") as HTMLCanvasElement;
  await initImGui(canvas);

  const res = await fetch('/models/Soldier.glb');
  const modelfile = await res.arrayBuffer();

  const app = new ThreeApp(
    new THREE.WebGLRenderer({ antialias: true, canvas: canvas }),
    modelfile,
  );

  function loop(time: number) {
    beginImGui(time);
    app.render(time);
    endImGui();
    requestAnimationFrame(loop);
  }

  loop(0);
}
