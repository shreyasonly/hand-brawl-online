import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { MenuScene } from './scenes/MenuScene';
import { LobbyScene } from './scenes/LobbyScene';
import { SetupScene } from './scenes/SetupScene';
import { HowToPlayScene } from './scenes/HowToPlayScene';
import { SelectScene } from './scenes/SelectScene';
import { FightScene } from './scenes/FightScene';
import { GAME_HEIGHT, GAME_WIDTH } from './config/Constants';
import { GameManager } from './game/GameManager';
import { Action, Gesture } from './gestures/GestureConfig';

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
  const game = new Phaser.Game(config);

  // Debug handle. Lets you inspect the live match from the browser console:
  //   __HB.gm.vision.status          -> camera / face / hand / gesture
  //   __HB.scene('FightScene').p1    -> the fighter itself
  //   __HB.punch()                   -> inject a PUNCH as if you had gestured
  (window as unknown as Record<string, unknown>).__HB = {
    game,
    gm: () => GameManager.getInstance(),
    scene: (key: string) => game.scene.getScene(key),
    punch: () => GameManager.getInstance().inputManager.feedIntent({
      handPresent: true,
      moveDirection: 'STOP',
      blocking: false,
      events: [Action.PUNCH],
      gesture: Gesture.FIST,
      confidence: 0.95,
      smoothedX: 0.5,
      smoothedY: 0.5
    })
  };
});
