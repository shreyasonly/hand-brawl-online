import Phaser from 'phaser';

export class PixelSpriteGenerator {
  public static generateAll(scene: Phaser.Scene): void {
    this.createJackSpriteSheet(scene);
    this.createKiraSpriteSheet(scene);
    this.createVFXSpriteSheets(scene);
    this.createStageTextures(scene);
  }

  private static createJackSpriteSheet(scene: Phaser.Scene): void {
    const frameW = 64;
    const frameH = 64;
    const cols = 8;
    const rows = 12;

    const canvas = document.createElement('canvas');
    canvas.width = frameW * cols;
    canvas.height = frameH * rows;
    const ctx = canvas.getContext('2d')!;

    const skin = '#f4c297';
    const skinDark = '#d49b6a';
    const gi = '#e8e8e8';
    const giDark = '#b5b5b5';
    const headband = '#ff2a6d';
    const gloves = '#d90429';
    const pants = '#1d3557';
    const belt = '#000000';

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = c * frameW;
        const y = r * frameH;

        ctx.save();
        ctx.translate(x, y);

        this.drawJackPose(ctx, r, c, { skin, skinDark, gi, giDark, headband, gloves, pants, belt });

        ctx.restore();
      }
    }

    if (scene.textures.exists('jack_sprites')) {
      scene.textures.remove('jack_sprites');
    }

    const texture = scene.textures.addCanvas('jack_sprites', canvas)!;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const frameIdx = r * cols + c;
        texture.add(frameIdx, 0, c * frameW, r * frameH, frameW, frameH);
      }
    }
  }

  private static drawJackPose(
    ctx: CanvasRenderingContext2D,
    row: number,
    col: number,
    p: any
  ): void {
    ctx.imageSmoothingEnabled = false;

    const idleBounce = row === 0 ? Math.sin((col / 4) * Math.PI) * 2 : 0;
    const walkOffset = row === 1 ? Math.sin((col / 6) * Math.PI * 2) * 3 : 0;
    const isJump = row === 2;
    const isPunch = row === 3;
    const isKick = row === 4;
    const isBlock = row === 5;
    const isGrab = row === 6;
    const isSpecial = row === 7;
    const isUltimate = row === 8;
    const isHurt = row === 9;
    const isKO = row === 10;
    const isVictory = row === 11;

    if (isKO) {
      const fallY = Math.min(col * 8, 20);
      ctx.fillStyle = p.pants;
      ctx.fillRect(16 + col * 4, 44 + fallY, 28, 12);
      ctx.fillStyle = p.gi;
      ctx.fillRect(12 + col * 2, 40 + fallY, 20, 14);
      ctx.fillStyle = p.skin;
      ctx.fillRect(8, 42 + fallY, 10, 10);
      ctx.fillStyle = p.headband;
      ctx.fillRect(8, 40 + fallY, 10, 4);
      return;
    }

    if (isVictory) {
      ctx.fillStyle = p.skin;
      ctx.fillRect(20, 8, 8, 16);
      ctx.fillRect(36, 8, 8, 16);
      ctx.fillStyle = p.gloves;
      ctx.fillRect(18, 4, 12, 8);
      ctx.fillRect(34, 4, 12, 8);

      ctx.fillStyle = p.skin;
      ctx.fillRect(26, 16, 12, 12);
      ctx.fillStyle = p.headband;
      ctx.fillRect(24, 14, 16, 4);

      ctx.fillStyle = p.gi;
      ctx.fillRect(22, 28, 20, 18);
      ctx.fillStyle = p.belt;
      ctx.fillRect(22, 44, 20, 4);
      ctx.fillStyle = p.pants;
      ctx.fillRect(22, 48, 8, 14);
      ctx.fillRect(34, 48, 8, 14);
      return;
    }

    const baseY = 16 - idleBounce - (isJump ? 8 : 0);

    const headX = 26 + (isHurt ? -4 : 0);
    ctx.fillStyle = p.skin;
    ctx.fillRect(headX, baseY, 12, 12);
    ctx.fillStyle = p.headband;
    ctx.fillRect(headX - 2, baseY - 2, 16, 4);
    ctx.fillRect(headX - 6, baseY, 6, 3);

    ctx.fillStyle = '#000';
    ctx.fillRect(headX + 8, baseY + 4, 3, 3);

    const bodyX = 24 + (isHurt ? -6 : 0);
    ctx.fillStyle = p.gi;
    ctx.fillRect(bodyX, baseY + 12, 16, 18);

    ctx.fillStyle = p.belt;
    ctx.fillRect(bodyX, baseY + 28, 16, 4);

    ctx.fillStyle = p.pants;
    if (isKick && col >= 2) {
      ctx.fillRect(bodyX, baseY + 32, 8, 16);
      ctx.fillRect(bodyX + 8, baseY + 26, 24, 8);
      ctx.fillStyle = p.gloves;
      ctx.fillRect(bodyX + 28, baseY + 24, 10, 12);
    } else {
      ctx.fillRect(bodyX - walkOffset, baseY + 32, 7, 16);
      ctx.fillRect(bodyX + 9 + walkOffset, baseY + 32, 7, 16);
    }

    ctx.fillStyle = p.skin;
    ctx.fillStyle = p.gloves;

    if (isPunch && col >= 2) {
      ctx.fillStyle = p.gi;
      ctx.fillRect(bodyX + 12, baseY + 14, 10, 8);
      ctx.fillStyle = p.gloves;
      ctx.fillRect(bodyX + 22, baseY + 12, 14, 12);
    } else if (isBlock) {
      ctx.fillStyle = p.gloves;
      ctx.fillRect(bodyX + 10, baseY + 10, 10, 14);
      ctx.fillStyle = p.gi;
      ctx.fillRect(bodyX + 4, baseY + 12, 8, 10);
    } else if (isGrab && col >= 2) {
      ctx.fillStyle = p.gloves;
      ctx.fillRect(bodyX + 14, baseY + 10, 18, 10);
    } else if (isSpecial) {
      ctx.fillStyle = '#00fff9';
      ctx.fillRect(bodyX + 12, baseY + 8, 20, 16);
      ctx.fillStyle = p.gloves;
      ctx.fillRect(bodyX + 24, baseY + 6, 12, 14);
    } else if (isUltimate) {
      ctx.fillStyle = '#ff2a6d';
      ctx.fillRect(bodyX - 6, baseY - 6, 28, 48);
      ctx.fillStyle = '#ffb703';
      ctx.fillRect(bodyX - 2, baseY - 2, 20, 40);
    } else {
      ctx.fillStyle = p.gloves;
      ctx.fillRect(bodyX + 12, baseY + 14, 8, 8);
    }
  }

  private static createKiraSpriteSheet(scene: Phaser.Scene): void {
    const frameW = 64;
    const frameH = 64;
    const cols = 8;
    const rows = 12;

    const canvas = document.createElement('canvas');
    canvas.width = frameW * cols;
    canvas.height = frameH * rows;
    const ctx = canvas.getContext('2d')!;

    const skin = '#fceade';
    const visor = '#00fff9';
    const jacket = '#7209b7';
    const jacketLight = '#b5179e';
    const accents = '#f72585';
    const pants = '#10002b';
    const boots = '#4cc9f0';

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = c * frameW;
        const y = r * frameH;

        ctx.save();
        ctx.translate(x, y);

        this.drawKiraPose(ctx, r, c, { skin, visor, jacket, jacketLight, accents, pants, boots });

        ctx.restore();
      }
    }

    if (scene.textures.exists('kira_sprites')) {
      scene.textures.remove('kira_sprites');
    }

    const texture = scene.textures.addCanvas('kira_sprites', canvas)!;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const frameIdx = r * cols + c;
        texture.add(frameIdx, 0, c * frameW, r * frameH, frameW, frameH);
      }
    }
  }

  private static drawKiraPose(
    ctx: CanvasRenderingContext2D,
    row: number,
    col: number,
    p: any
  ): void {
    ctx.imageSmoothingEnabled = false;

    const idleBounce = row === 0 ? Math.cos((col / 4) * Math.PI) * 2 : 0;
    const walkOffset = row === 1 ? Math.sin((col / 6) * Math.PI * 2) * 4 : 0;
    const isJump = row === 2;
    const isPunch = row === 3;
    const isKick = row === 4;
    const isBlock = row === 5;
    const isGrab = row === 6;
    const isSpecial = row === 7;
    const isUltimate = row === 8;
    const isHurt = row === 9;
    const isKO = row === 10;
    const isVictory = row === 11;

    if (isKO) {
      ctx.fillStyle = p.pants;
      ctx.fillRect(16 + col * 4, 44, 28, 12);
      ctx.fillStyle = p.jacket;
      ctx.fillRect(12 + col * 2, 40, 20, 14);
      ctx.fillStyle = p.visor;
      ctx.fillRect(8, 42, 10, 6);
      return;
    }

    if (isVictory) {
      ctx.fillStyle = p.skin;
      ctx.fillRect(24, 16, 12, 12);
      ctx.fillStyle = p.visor;
      ctx.fillRect(26, 18, 10, 4);

      ctx.fillStyle = p.jacketLight;
      ctx.fillRect(22, 28, 20, 18);
      ctx.fillStyle = p.accents;
      ctx.fillRect(18, 12, 8, 18);
      ctx.fillRect(36, 8, 8, 22);

      ctx.fillStyle = p.pants;
      ctx.fillRect(22, 46, 8, 16);
      ctx.fillRect(34, 46, 8, 16);
      return;
    }

    const baseY = 16 - idleBounce - (isJump ? 10 : 0);

    const headX = 26 + (isHurt ? -4 : 0);
    ctx.fillStyle = p.accents;
    ctx.fillRect(headX - 2, baseY - 4, 16, 8);
    ctx.fillStyle = p.skin;
    ctx.fillRect(headX, baseY, 12, 12);
    ctx.fillStyle = p.visor;
    ctx.fillRect(headX + 4, baseY + 3, 10, 4);

    const bodyX = 24 + (isHurt ? -6 : 0);
    ctx.fillStyle = p.jacket;
    ctx.fillRect(bodyX, baseY + 12, 16, 18);
    ctx.fillStyle = p.jacketLight;
    ctx.fillRect(bodyX + 2, baseY + 14, 6, 14);

    ctx.fillStyle = p.pants;
    if (isKick && col >= 2) {
      ctx.fillRect(bodyX, baseY + 30, 8, 18);
      ctx.fillRect(bodyX + 8, baseY + 24, 26, 8);
      ctx.fillStyle = p.boots;
      ctx.fillRect(bodyX + 30, baseY + 22, 10, 12);
    } else {
      ctx.fillRect(bodyX - walkOffset, baseY + 30, 7, 18);
      ctx.fillRect(bodyX + 9 + walkOffset, baseY + 30, 7, 18);
    }

    if (isPunch && col >= 2) {
      ctx.fillStyle = p.boots;
      ctx.fillRect(bodyX + 12, baseY + 12, 22, 8);
    } else if (isBlock) {
      ctx.fillStyle = p.visor;
      ctx.fillRect(bodyX + 10, baseY + 8, 8, 18);
    } else if (isGrab) {
      ctx.fillStyle = p.accents;
      ctx.fillRect(bodyX + 12, baseY + 10, 20, 10);
    } else if (isSpecial) {
      ctx.fillStyle = 'rgba(76, 201, 240, 0.6)';
      ctx.fillRect(bodyX - 12, baseY, 40, 40);
      ctx.fillStyle = p.accents;
      ctx.fillRect(bodyX + 16, baseY + 10, 24, 12);
    } else if (isUltimate) {
      ctx.fillStyle = 'rgba(247, 37, 133, 0.7)';
      ctx.fillRect(bodyX - 16, baseY - 8, 48, 50);
      ctx.fillStyle = 'rgba(0, 255, 249, 0.7)';
      ctx.fillRect(bodyX - 8, baseY - 4, 36, 46);
    }
  }

  private static createVFXSpriteSheets(scene: Phaser.Scene): void {
    const sparkCanvas = document.createElement('canvas');
    sparkCanvas.width = 128;
    sparkCanvas.height = 32;
    const sCtx = sparkCanvas.getContext('2d')!;
    sCtx.imageSmoothingEnabled = false;

    for (let f = 0; f < 4; f++) {
      const ox = f * 32;
      const size = (f + 1) * 6;
      sCtx.fillStyle = f % 2 === 0 ? '#ffb703' : '#ff2a6d';
      sCtx.fillRect(ox + 16 - size / 2, 16 - size / 2, size, size);
      sCtx.fillStyle = '#ffffff';
      sCtx.fillRect(ox + 16 - size / 4, 16 - size / 4, size / 2, size / 2);
    }
    if (scene.textures.exists('vfx_spark')) scene.textures.remove('vfx_spark');
    const sparkTexture = scene.textures.addCanvas('vfx_spark', sparkCanvas)!;
    for (let f = 0; f < 4; f++) {
      sparkTexture.add(f, 0, f * 32, 0, 32, 32);
    }

    const shieldCanvas = document.createElement('canvas');
    shieldCanvas.width = 64;
    shieldCanvas.height = 64;
    const shCtx = shieldCanvas.getContext('2d')!;
    shCtx.strokeStyle = '#00fff9';
    shCtx.lineWidth = 4;
    shCtx.beginPath();
    shCtx.arc(32, 32, 24, -Math.PI / 3, Math.PI / 3);
    shCtx.stroke();
    shCtx.fillStyle = 'rgba(0, 255, 249, 0.3)';
    shCtx.fill();
    if (scene.textures.exists('vfx_shield')) scene.textures.remove('vfx_shield');
    scene.textures.addCanvas('vfx_shield', shieldCanvas);

    const boltCanvas = document.createElement('canvas');
    boltCanvas.width = 128;
    boltCanvas.height = 32;
    const bCtx = boltCanvas.getContext('2d')!;
    bCtx.fillStyle = '#00fff9';
    bCtx.fillRect(0, 10, 128, 12);
    bCtx.fillStyle = '#ffffff';
    bCtx.fillRect(0, 14, 128, 4);
    if (scene.textures.exists('vfx_lightning')) scene.textures.remove('vfx_lightning');
    scene.textures.addCanvas('vfx_lightning', boltCanvas);
  }

  private static createStageTextures(scene: Phaser.Scene): void {
    const skyCanvas = document.createElement('canvas');
    skyCanvas.width = 640;
    skyCanvas.height = 360;
    const sCtx = skyCanvas.getContext('2d')!;
    const grad = sCtx.createLinearGradient(0, 0, 0, 360);
    grad.addColorStop(0, '#0b091a');
    grad.addColorStop(0.6, '#240046');
    grad.addColorStop(1, '#5a189a');
    sCtx.fillStyle = grad;
    sCtx.fillRect(0, 0, 640, 360);

    sCtx.fillStyle = '#ff2a6d';
    sCtx.beginPath();
    sCtx.arc(320, 140, 60, 0, Math.PI * 2);
    sCtx.fill();

    if (scene.textures.exists('stage_sky')) scene.textures.remove('stage_sky');
    scene.textures.addCanvas('stage_sky', skyCanvas);

    const cityCanvas = document.createElement('canvas');
    cityCanvas.width = 640;
    cityCanvas.height = 360;
    const cCtx = cityCanvas.getContext('2d')!;

    cCtx.fillStyle = '#10002b';
    cCtx.fillRect(20, 120, 80, 240);
    cCtx.fillRect(120, 80, 110, 280);
    cCtx.fillRect(260, 140, 90, 220);
    cCtx.fillRect(380, 90, 120, 270);
    cCtx.fillRect(520, 130, 100, 230);

    cCtx.fillStyle = '#00fff9';
    cCtx.fillRect(140, 100, 70, 16);
    cCtx.fillStyle = '#ff2a6d';
    cCtx.fillRect(400, 120, 80, 20);
    cCtx.fillStyle = '#ffb703';
    cCtx.fillRect(280, 160, 50, 14);

    if (scene.textures.exists('stage_city')) scene.textures.remove('stage_city');
    scene.textures.addCanvas('stage_city', cityCanvas);

    const streetCanvas = document.createElement('canvas');
    streetCanvas.width = 640;
    streetCanvas.height = 360;
    const gCtx = streetCanvas.getContext('2d')!;

    gCtx.fillStyle = '#121224';
    gCtx.fillRect(0, 290, 640, 70);

    gCtx.fillStyle = '#ff2a6d';
    gCtx.fillRect(0, 288, 640, 4);

    gCtx.strokeStyle = 'rgba(0, 255, 249, 0.3)';
    gCtx.lineWidth = 2;
    for (let x = 0; x <= 640; x += 40) {
      gCtx.beginPath();
      gCtx.moveTo(x, 290);
      gCtx.lineTo(x, 360);
      gCtx.stroke();
    }

    if (scene.textures.exists('stage_street')) scene.textures.remove('stage_street');
    scene.textures.addCanvas('stage_street', streetCanvas);
  }
}
