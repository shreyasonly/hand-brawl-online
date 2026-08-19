import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { MenuScene } from './scenes/MenuScene';
import { LobbyScene } from './scenes/LobbyScene';
import { SetupScene } from './scenes/SetupScene';
import { HowToPlayScene } from './scenes/HowToPlayScene';
import { SelectScene } from './scenes/SelectScene';
import { FightScene } from './scenes/FightScene';
import { GAME_HEIGHT, GAME_WIDTH } from './config/Constants';

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game-canvas-container',
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  pixelArt: true,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH
  },
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { x: 0, y: 900 },
      debug: false
    }
  },
  scene: [BootScene, MenuScene, LobbyScene, SetupScene, SelectScene, HowToPlayScene, FightScene]
};

window.addEventListener('DOMContentLoaded', () => {
  new Phaser.Game(config);
});
