"use client";

/**
 * Computer-vision hand controller. Lazy-loads MediaPipe's HandLandmarker (WASM +
 * model from CDN — only fetched when the user turns Hand Control on), opens the
 * webcam, and reports a normalized fingertip position + pinch state each frame.
 * The Forge maps that onto the 3D scene so you sculpt with your hand, holotable
 * style. Everything is optional and degrades to pointer control on failure.
 */

export interface HandFrame {
  /** Index-fingertip position, normalized 0..1, already mirrored for a selfie view. */
  x: number;
  y: number;
  /** Palm centre (middle-finger base), normalized + mirrored — used for scroll/swipe. */
  palmX: number;
  palmY: number;
  /** True while thumb + index are pinched together (grab). */
  pinch: boolean;
  /** Raw pinch distance (for debugging / thresholds). */
  pinchDist: number;
  /** Roughly how open the hand is (fist ≈ 1, open palm ≳ 1.7). */
  openness: number;
  /** Hand roll in radians — angle of the knuckle line (index→pinky MCP). Twisting
   *  the hand like a knob/ball changes this; used for rotation-based scrolling. */
  roll: number;
  /** Per-finger extension, thumb→pinky. Openness alone cannot tell a shaka
   *  from a fist from an OK sign — they differ only in *which* fingers are
   *  out, not how many. */
  fingers: [thumb: boolean, index: boolean, middle: boolean, ring: boolean, pinky: boolean];
  /** 🤙 thumb and pinky out, the middle three folded. */
  shaka: boolean;
  /** 👌 thumb and index touching, the other three extended. */
  ok: boolean;
}

const WASM = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const MODEL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

export class HandController {
  private video: HTMLVideoElement | null = null;
  private stream: MediaStream | null = null;
  private landmarker: unknown = null;
  private raf = 0;
  private running = false;
  private onFrame: (f: HandFrame | null) => void;

  constructor(onFrame: (f: HandFrame | null) => void) {
    this.onFrame = onFrame;
  }

  /** Attach a <video> element to draw the camera into (small PIP preview). */
  async start(video: HTMLVideoElement): Promise<void> {
    this.video = video;
    const { HandLandmarker, FilesetResolver } = await import("@mediapipe/tasks-vision");
    const vision = await FilesetResolver.forVisionTasks(WASM);
    /**
     * GPU first, CPU if that fails.
     *
     * The GPU delegate needs a WebGL context the browser is willing to give a
     * background task, and on some machines — headless GPUs, Safari with
     * hardware acceleration off, a laptop already running a WebGL page — it
     * throws at creation. Falling back costs frame rate and keeps the feature
     * working, which is the right trade for a control surface.
     */
    const opts = { modelAssetPath: MODEL };
    try {
      this.landmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: { ...opts, delegate: "GPU" },
        runningMode: "VIDEO",
        numHands: 1,
      });
    } catch {
      this.landmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: { ...opts, delegate: "CPU" },
        runningMode: "VIDEO",
        numHands: 1,
      });
    }

    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: 640, height: 480 },
      audio: false,
    });
    video.srcObject = this.stream;
    await video.play();
    this.running = true;
    this.loop();
  }

  private loop = () => {
    if (!this.running || !this.video || !this.landmarker) return;
    const lm = this.landmarker as {
      detectForVideo: (v: HTMLVideoElement, t: number) => { landmarks?: { x: number; y: number; z: number }[][] };
    };
    try {
      if (this.video.readyState >= 2) {
        const res = lm.detectForVideo(this.video, performance.now());
        const hand = res.landmarks?.[0];
        if (hand && hand.length >= 18) {
          const wrist = hand[0];
          const thumb = hand[4];
          const index = hand[8];
          const midMcp = hand[9];
          const midTip = hand[12];
          const indexMcp = hand[5];
          const pinkyMcp = hand[17];
          const dist = Math.hypot(thumb.x - index.x, thumb.y - index.y);
          const handSpan = Math.hypot(midMcp.x - wrist.x, midMcp.y - wrist.y) || 0.001;
          const openness = Math.hypot(midTip.x - wrist.x, midTip.y - wrist.y) / handSpan;

          // A finger is extended when its tip sits further from the wrist than
          // its middle joint — scale-free, so it holds whether the hand is
          // near the camera or far from it.
          const far = (tip: number, pip: number) => {
            const t = hand[tip], p = hand[pip];
            return Math.hypot(t.x - wrist.x, t.y - wrist.y) > Math.hypot(p.x - wrist.x, p.y - wrist.y) * 1.08;
          };
          const fingers: [boolean, boolean, boolean, boolean, boolean] = [
            far(4, 2), far(8, 6), far(12, 10), far(16, 14), far(20, 18),
          ];
          const [fThumb, fIndex, fMiddle, fRing, fPinky] = fingers;
          const shaka = fThumb && fPinky && !fIndex && !fMiddle && !fRing;
          // The OK ring is a pinch, but a fist is also "not extended" — requiring
          // the other three out is what separates them.
          const ok = dist < 0.07 && fMiddle && fRing && fPinky;
          // knuckle line in mirrored space → roll angle
          const roll = Math.atan2(pinkyMcp.y - indexMcp.y, (1 - pinkyMcp.x) - (1 - indexMcp.x));
          this.onFrame({
            x: 1 - index.x, // mirror for selfie view
            y: index.y,
            palmX: 1 - midMcp.x,
            palmY: midMcp.y,
            pinch: dist < 0.06,
            pinchDist: dist,
            openness,
            roll,
            fingers,
            shaka,
            ok,
          });
        } else {
          this.onFrame(null);
        }
      }
    } catch {
      /* skip this frame */
    }
    this.raf = requestAnimationFrame(this.loop);
  };

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    try {
      (this.landmarker as { close?: () => void })?.close?.();
    } catch {
      /* noop */
    }
    this.landmarker = null;
    if (this.video) this.video.srcObject = null;
  }
}
