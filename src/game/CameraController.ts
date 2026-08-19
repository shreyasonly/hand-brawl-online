import Phaser from 'phaser';
import { Character } from '../characters/Character';

export class CameraController {
  private camera: Phaser.Cameras.Scene2D.Camera;

  constructor(scene: Phaser.Scene) {
    this.camera = scene.cameras.main;
    this.camera.setBounds(0, 0, 640, 360);
  }

  public update(p1: Character, p2: Character): void {
    if (!p1 || !p2) return;

    // Midpoint between both fighters
    const midX = (p1.x + p2.x) / 2;
    const midY = (p1.y + p2.y) / 2;

    // Distance between fighters
    const distance = Math.abs(p1.x - p2.x);

    // Dynamic Zoom: zoom out when far apart, zoom in when close
    const minZoom = 0.95;
    const maxZoom = 1.15;
    const targetZoom = Phaser.Math.Clamp(1.2 - distance / 500, minZoom, maxZoom);

    this.camera.zoom = Phaser.Math.Linear(this.camera.zoom, targetZoom, 0.05);
    this.camera.scrollX = Phaser.Math.Linear(this.camera.scrollX, midX - this.camera.width / 2, 0.08);
    this.camera.scrollY = Phaser.Math.Linear(this.camera.scrollY, midY - this.camera.height / 2 - 20, 0.08);
  }
}
