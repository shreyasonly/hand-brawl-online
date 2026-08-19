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

    this.createThunderBurstSheet(scene);
    this.createShadowScribbleSheet(scene);
  }

  /**
   * Deterministic pseudo-random in [0, 1) - classic sine-hash trick. Used
   * instead of Math.random() so the generated VFX sprite sheets are
   * reproducible between runs (and between dev/build) while still looking
   * organic.
   */
  private static hash(seed: number): number {
    const x = Math.sin(seed * 12.9898) * 43758.5453;
    return x - Math.floor(x);
  }

  /**
   * Multi-frame branching lightning burst for Jack's THUNDER PUNCH
   * special/ultimate. Jagged bolts radiate from a centre flash that swells
   * then fades, in the same cyan/white palette as the rest of the game.
   */
  private static createThunderBurstSheet(scene: Phaser.Scene): void {
    const CELL = 96;
    const FRAMES = 6;
    const CENTER = CELL / 2;

    const canvas = document.createElement('canvas');
    canvas.width = CELL * FRAMES;
    canvas.height = CELL;
    const ctx = canvas.getContext('2d')!;

    // 8 base bolt angles, evenly spaced with a small deterministic jitter so
    // the burst does not look perfectly symmetric.
    const angles: number[] = [];
    for (let i = 0; i < 8; i++) {
      const base = (i / 8) * Math.PI * 2;
      const jitter = (this.hash(i * 7.31 + 1) - 0.5) * 0.35;
      angles.push(base + jitter);
    }

    interface ThunderFrameParams {
      boltCount: number;
      length: number;
      coreRadius: number;
      hot: boolean;
      ring: boolean;
    }

    const frames: ThunderFrameParams[] = [
      { boltCount: 3, length: 16, coreRadius: 5, hot: false, ring: false },
      { boltCount: 5, length: 26, coreRadius: 8, hot: false, ring: false },
      { boltCount: 6, length: 36, coreRadius: 11, hot: true, ring: false },
      { boltCount: 8, length: 44, coreRadius: 14, hot: true, ring: true },
      { boltCount: 6, length: 32, coreRadius: 10, hot: false, ring: false },
      { boltCount: 3, length: 18, coreRadius: 6, hot: false, ring: false }
    ];

    const drawBolt = (
      originX: number,
      originY: number,
      angle: number,
      length: number,
      seed: number,
      color: string,
      lineWidth: number
    ): void => {
      const segments = 3;
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(originX, originY);

      const dx = Math.cos(angle);
      const dy = Math.sin(angle);
      // perpendicular direction, for the zig-zag kinks
      const px = -dy;
      const py = dx;

      for (let seg = 1; seg <= segments; seg++) {
        const t = seg / segments;
        const alongX = originX + dx * length * t;
        const alongY = originY + dy * length * t;
        const jitter = (this.hash(seed + seg * 5.7) - 0.5) * (length * 0.22);
        const kinkX = seg === segments ? alongX : alongX + px * jitter;
        const kinkY = seg === segments ? alongY : alongY + py * jitter;
        ctx.lineTo(kinkX, kinkY);
      }
      ctx.stroke();
    };

    for (let f = 0; f < FRAMES; f++) {
      const ox = f * CELL;
      const p = frames[f];

      ctx.save();
      ctx.translate(ox, 0);

      for (let i = 0; i < p.boltCount; i++) {
        const seed = f * 97 + i * 31;
        drawBolt(CENTER, CENTER, angles[i], p.length, seed, '#00fff9', 3);
        if (p.hot) {
          // Bright inner streak along the first third of the bolt.
          drawBolt(CENTER, CENTER, angles[i], p.length * 0.4, seed + 1000, '#ffffff', 1.5);
        }
      }

      if (p.ring) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(CENTER, CENTER, p.length * 0.55, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.fillStyle = p.hot ? '#ffffff' : '#00fff9';
      ctx.beginPath();
      ctx.arc(CENTER, CENTER, p.coreRadius, 0, Math.PI * 2);
      ctx.fill();

      if (p.hot) {
        ctx.fillStyle = 'rgba(0, 255, 249, 0.4)';
        ctx.beginPath();
        ctx.arc(CENTER, CENTER, p.coreRadius * 1.8, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    }

    if (scene.textures.exists('vfx_thunder_burst')) scene.textures.remove('vfx_thunder_burst');
    const texture = scene.textures.addCanvas('vfx_thunder_burst', canvas)!;
    for (let f = 0; f < FRAMES; f++) {
      texture.add(f, 0, f * CELL, 0, CELL, CELL);
    }
  }

  /**
   * Multi-frame chaotic energy scribble for Kira's SHADOW DASH special/
   * ultimate: a single tangled magenta stroke that winds itself up then
   * unravels, evoking a burst of dark/shadow energy.
   */
  private static createShadowScribbleSheet(scene: Phaser.Scene): void {
    const CELL = 96;
    const FRAMES = 8;
    const CENTER = CELL / 2;

    const canvas = document.createElement('canvas');
    canvas.width = CELL * FRAMES;
    canvas.height = CELL;
    const ctx = canvas.getContext('2d')!;

    // One deterministic random-walk path, centred on the origin. Each frame
    // draws a growing (then shrinking) prefix of it, so the scribble reads as
    // one continuous doodle animating itself in and out rather than unrelated
    // squiggles per frame.
    const TOTAL_POINTS = 16;
    const points: Array<{ x: number; y: number }> = [{ x: 0, y: 0 }];
    let heading = this.hash(3.1) * Math.PI * 2;

    for (let i = 1; i < TOTAL_POINTS; i++) {
      heading += (this.hash(i * 4.13 + 2) - 0.5) * 2.4;
      const step = 8 + this.hash(i * 9.77 + 5) * 6;
      const prev = points[i - 1];
      points.push({
        x: prev.x + Math.cos(heading) * step,
        y: prev.y + Math.sin(heading) * step
      });
    }

    interface ScribbleFrameParams {
      pointCount: number;
      lineWidth: number;
      glow: boolean;
    }

    // Build-up (0-4) then dissipate (5-7), mirroring the reference animation.
    const frames: ScribbleFrameParams[] = [
      { pointCount: 4, lineWidth: 4, glow: false },
      { pointCount: 7, lineWidth: 5, glow: false },
      { pointCount: 10, lineWidth: 6, glow: true },
      { pointCount: 14, lineWidth: 6, glow: true },
      { pointCount: 16, lineWidth: 7, glow: true },
      { pointCount: 12, lineWidth: 5, glow: false },
      { pointCount: 7, lineWidth: 4, glow: false },
      { pointCount: 3, lineWidth: 3, glow: false }
    ];

    // Scale the whole walk down so every frame's own bounding box - PLUS the
    // thickest stroke's glow halo - fits inside the cell with margin to spare.
    // Frames are centred on their own prefix (see below), so it is that
    // per-frame half-extent that must fit, not the full path's.
    const maxHalfLineWidth = Math.max(...frames.map((f) => f.lineWidth + (f.glow ? 6 : 0))) / 2;
    const margin = 4;
    let maxHalfExtent = 0;
    for (const f of frames) {
      const slice = points.slice(0, f.pointCount);
      const xs = slice.map((pt) => pt.x);
      const ys = slice.map((pt) => pt.y);
      maxHalfExtent = Math.max(
        maxHalfExtent,
        (Math.max(...xs) - Math.min(...xs)) / 2,
        (Math.max(...ys) - Math.min(...ys)) / 2
      );
    }
    const safeScale = (CENTER - margin - maxHalfLineWidth) / (maxHalfExtent || 1);
    const scale = Math.min(1, safeScale);
    for (const pt of points) {
      pt.x *= scale;
      pt.y *= scale;
    }

    const strokePath = (
      pts: Array<{ x: number; y: number }>,
      color: string,
      lineWidth: number
    ): void => {
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(CENTER + pts[0].x, CENTER + pts[0].y);
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(CENTER + pts[i].x, CENTER + pts[i].y);
      }
      ctx.stroke();
    };

    for (let f = 0; f < FRAMES; f++) {
      const ox = f * CELL;
      const p = frames[f];

      // Each frame is centred on the bounding box of ITS OWN drawn prefix, not
      // the full path - otherwise a short prefix and a long one land in
      // different places within the cell, and the burst visibly drifts instead
      // of staying anchored on the fighter (Phaser centres a sprite on its
      // frame's geometric middle, regardless of where the artwork sits in it).
      const slice = points.slice(0, p.pointCount);
      const xs = slice.map((pt) => pt.x);
      const ys = slice.map((pt) => pt.y);
      const midX = (Math.min(...xs) + Math.max(...xs)) / 2;
      const midY = (Math.min(...ys) + Math.max(...ys)) / 2;
      const frameSlice = slice.map((pt) => ({ x: pt.x - midX, y: pt.y - midY }));

      ctx.save();
      ctx.translate(ox, 0);

      if (p.glow) {
        strokePath(frameSlice, 'rgba(255, 42, 158, 0.35)', p.lineWidth + 6);
      }
      strokePath(frameSlice, '#ff2a9e', p.lineWidth);
      strokePath(frameSlice, p.glow ? '#ffd6f7' : '#ff8fd6', Math.max(1.5, p.lineWidth - 3));

      ctx.restore();
    }

    if (scene.textures.exists('vfx_shadow_scribble')) scene.textures.remove('vfx_shadow_scribble');
    const texture = scene.textures.addCanvas('vfx_shadow_scribble', canvas)!;
    for (let f = 0; f < FRAMES; f++) {
      texture.add(f, 0, f * CELL, 0, CELL, CELL);
    }
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
