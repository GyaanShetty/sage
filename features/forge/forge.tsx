"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  Box, Circle, Cone, Cylinder, Hand, Trash2, Layers, RotateCw,
  Plus, Minus, Sparkles, Torus as TorusIcon, Video, VideoOff,
} from "lucide-react";
import { HandController, type HandFrame } from "./hands";
import "@/features/dashboard/command.css";

type ShapeKind = "box" | "sphere" | "cylinder" | "cone" | "torus" | "pyramid";

interface Persisted { kind: ShapeKind; p: [number, number, number]; r: [number, number, number]; s: number; color: number }

const LIVE = 0x5ecfd6;
const PALETTE: { kind: ShapeKind; icon: typeof Box; label: string }[] = [
  { kind: "box", icon: Box, label: "Cube" },
  { kind: "sphere", icon: Circle, label: "Sphere" },
  { kind: "cylinder", icon: Cylinder, label: "Cylinder" },
  { kind: "cone", icon: Cone, label: "Cone" },
  { kind: "torus", icon: TorusIcon, label: "Torus" },
  { kind: "pyramid", icon: Layers, label: "Pyramid" },
];
const COLORS = [0x5ecfd6, 0xe8a13a, 0xe86a6a, 0x9a7bff, 0x6ae88f, 0xe8e9ec];
const LS_KEY = "sage-forge-scene";

function geometryFor(kind: ShapeKind): THREE.BufferGeometry {
  switch (kind) {
    case "box": return new THREE.BoxGeometry(1, 1, 1);
    case "sphere": return new THREE.SphereGeometry(0.7, 32, 24);
    case "cylinder": return new THREE.CylinderGeometry(0.6, 0.6, 1.2, 32);
    case "cone": return new THREE.ConeGeometry(0.7, 1.3, 32);
    case "torus": return new THREE.TorusGeometry(0.6, 0.24, 20, 40);
    case "pyramid": return new THREE.ConeGeometry(0.8, 1.3, 4);
  }
}

/**
 * The Forge — a holographic 3D sandbox. Spawn primitives, then drag them around
 * the grid, rotate, scale, raise and lower. Turn on Hand Control and MediaPipe
 * tracks your hand through the webcam: point to aim, pinch to grab and move an
 * object in mid-air — the Tony-Stark holotable. Scenes persist per device.
 */
export function Forge() {
  const mountRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const three = useRef<{
    renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera;
    controls: OrbitControls; raycaster: THREE.Raycaster; ground: THREE.Mesh;
    objects: THREE.Mesh[]; selected: THREE.Mesh | null; grabbed: THREE.Mesh | null;
  } | null>(null);

  const [kind, setKind] = useState<ShapeKind>("box");
  const [color, setColor] = useState(0x5ecfd6);
  const [handOn, setHandOn] = useState(false);
  const [handStatus, setHandStatus] = useState<string | null>(null);
  const [count, setCount] = useState(0);
  const handCtrl = useRef<HandController | null>(null);

  const persist = useCallback(() => {
    const t = three.current;
    if (!t) return;
    const data: Persisted[] = t.objects.map((o) => ({
      kind: o.userData.kind as ShapeKind,
      p: [o.position.x, o.position.y, o.position.z],
      r: [o.rotation.x, o.rotation.y, o.rotation.z],
      s: o.scale.x,
      color: (o.userData.color as number) ?? LIVE,
    }));
    try { localStorage.setItem(LS_KEY, JSON.stringify(data)); } catch { /* full */ }
  }, []);

  const select = useCallback((mesh: THREE.Mesh | null) => {
    const t = three.current; if (!t) return;
    if (t.selected) {
      const m = t.selected.material as THREE.MeshStandardMaterial;
      m.emissiveIntensity = 0.35;
    }
    t.selected = mesh;
    if (mesh) {
      const m = mesh.material as THREE.MeshStandardMaterial;
      m.emissiveIntensity = 0.9;
    }
  }, []);

  const addShape = useCallback((k: ShapeKind, col: number, at?: THREE.Vector3) => {
    const t = three.current; if (!t) return;
    const geo = geometryFor(k);
    const mat = new THREE.MeshStandardMaterial({
      color: col, emissive: col, emissiveIntensity: 0.35,
      metalness: 0.3, roughness: 0.35, transparent: true, opacity: 0.86,
    });
    const mesh = new THREE.Mesh(geo, mat);
    // glowing wireframe overlay
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geo),
      new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.5 }),
    );
    mesh.add(edges);
    if (at) {
      mesh.position.copy(at);
    } else {
      // scatter new shapes a little so they don't stack on the origin
      mesh.position.set((Math.random() - 0.5) * 3, 0.6, (Math.random() - 0.5) * 3);
    }
    mesh.userData = { kind: k, color: col };
    t.scene.add(mesh);
    t.objects.push(mesh);
    select(mesh);
    setCount(t.objects.length);
    persist();
  }, [select, persist]);

  const removeSelected = useCallback(() => {
    const t = three.current; if (!t || !t.selected) return;
    t.scene.remove(t.selected);
    t.objects = t.objects.filter((o) => o !== t.selected);
    t.selected = null;
    setCount(t.objects.length);
    persist();
  }, [persist]);

  const clearAll = useCallback(() => {
    const t = three.current; if (!t) return;
    t.objects.forEach((o) => t.scene.remove(o));
    t.objects = []; t.selected = null;
    setCount(0);
    persist();
  }, [persist]);

  const transformSelected = useCallback((fn: (m: THREE.Mesh) => void) => {
    const t = three.current; if (!t || !t.selected) return;
    fn(t.selected);
    persist();
  }, [persist]);

  // ---- scene setup ----
  useEffect(() => {
    const mount = mountRef.current; if (!mount) return;
    const W = mount.clientWidth, H = mount.clientHeight;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x07080a, 0.045);

    const camera = new THREE.PerspectiveCamera(55, W / H, 0.1, 100);
    camera.position.set(4.5, 4, 6.5);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.setSize(W, H);
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = 0.08;
    controls.minDistance = 3; controls.maxDistance = 24;
    controls.maxPolarAngle = Math.PI / 2.05;

    scene.add(new THREE.AmbientLight(0x88aaff, 0.6));
    const key = new THREE.PointLight(0x5ecfd6, 60, 40); key.position.set(6, 10, 6); scene.add(key);
    const rim = new THREE.PointLight(0x9a7bff, 30, 40); rim.position.set(-8, 6, -6); scene.add(rim);

    const grid = new THREE.GridHelper(40, 40, 0x5ecfd6, 0x1c2b2e);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.4;
    scene.add(grid);

    // invisible ground plane for drag raycasting
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 200),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);

    const raycaster = new THREE.Raycaster();
    three.current = { renderer, scene, camera, controls, raycaster, ground, objects: [], selected: null, grabbed: null };

    // restore persisted scene
    try {
      const saved = JSON.parse(localStorage.getItem(LS_KEY) ?? "null") as Persisted[] | null;
      if (saved?.length) {
        for (const s of saved) {
          addShape(s.kind, s.color, new THREE.Vector3(...s.p));
          const t = three.current!;
          const m = t.objects[t.objects.length - 1];
          m.rotation.set(...s.r); m.scale.setScalar(s.s);
        }
        select(null);
      }
    } catch { /* ignore */ }

    // ---- pointer interaction: click to select, drag to move ----
    const ndc = new THREE.Vector2();
    let dragging = false;
    const setNdc = (e: PointerEvent) => {
      const r = renderer.domElement.getBoundingClientRect();
      ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      ndc.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    };
    const onDown = (e: PointerEvent) => {
      const t = three.current!; setNdc(e);
      t.raycaster.setFromCamera(ndc, t.camera);
      const hit = t.raycaster.intersectObjects(t.objects, false)[0];
      if (hit) {
        select(hit.object as THREE.Mesh);
        dragging = true;
        t.controls.enabled = false;
      } else {
        select(null);
      }
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      const t = three.current!; setNdc(e);
      t.raycaster.setFromCamera(ndc, t.camera);
      const hit = t.raycaster.intersectObject(t.ground, false)[0];
      if (hit && t.selected) {
        const y = t.selected.position.y;
        t.selected.position.set(hit.point.x, y, hit.point.z);
      }
    };
    const onUp = () => {
      const t = three.current!;
      if (dragging) { dragging = false; t.controls.enabled = true; persist(); }
    };
    renderer.domElement.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);

    // keyboard shortcuts
    const onKey = (e: KeyboardEvent) => {
      const t = three.current!; if (!t.selected) return;
      if (e.key === "Delete" || e.key === "Backspace") { removeSelected(); }
      else if (e.key === "r" || e.key === "R") { t.selected.rotation.y += 0.4; persist(); }
      else if (e.key === "q" || e.key === "Q") { t.selected.position.y = Math.max(0.2, t.selected.position.y - 0.3); persist(); }
      else if (e.key === "e" || e.key === "E") { t.selected.position.y += 0.3; persist(); }
      else if (e.key === "+" || e.key === "=") { t.selected.scale.multiplyScalar(1.15); persist(); }
      else if (e.key === "-" || e.key === "_") { t.selected.scale.multiplyScalar(0.87); persist(); }
    };
    window.addEventListener("keydown", onKey);

    let raf = 0;
    const animate = () => { controls.update(); renderer.render(scene, camera); raf = requestAnimationFrame(animate); };
    animate();

    const onResize = () => {
      const w = mount.clientWidth, h = mount.clientHeight;
      camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h);
    };
    const ro = new ResizeObserver(onResize); ro.observe(mount);

    return () => {
      cancelAnimationFrame(raf); ro.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("keydown", onKey);
      handCtrl.current?.stop(); handCtrl.current = null;
      renderer.dispose();
      mount.removeChild(renderer.domElement);
      three.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- hand control ----
  const applyHandFrame = useCallback((f: HandFrame | null) => {
    const t = three.current; if (!t) return;
    if (!f) { t.grabbed = null; return; }
    // Map normalized fingertip → NDC → ground point.
    const ndc = new THREE.Vector2(f.x * 2 - 1, -(f.y * 2 - 1));
    t.raycaster.setFromCamera(ndc, t.camera);
    if (f.pinch) {
      if (!t.grabbed) {
        // grab the object nearest the pointer ray
        const hit = t.raycaster.intersectObjects(t.objects, false)[0];
        t.grabbed = (hit?.object as THREE.Mesh) ?? t.selected ?? t.objects[t.objects.length - 1] ?? null;
        if (t.grabbed) select(t.grabbed);
      }
      if (t.grabbed) {
        const hit = t.raycaster.intersectObject(t.ground, false)[0];
        if (hit) t.grabbed.position.set(hit.point.x, t.grabbed.position.y, hit.point.z);
      }
    } else if (t.grabbed) {
      t.grabbed = null; persist();
    }
  }, [select, persist]);

  const toggleHand = useCallback(async () => {
    if (handOn) {
      handCtrl.current?.stop(); handCtrl.current = null;
      setHandOn(false); setHandStatus(null);
      return;
    }
    setHandStatus("Loading vision model…");
    try {
      const ctrl = new HandController(applyHandFrame);
      await ctrl.start(videoRef.current!);
      handCtrl.current = ctrl;
      setHandOn(true);
      setHandStatus("Pinch to grab · point to move");
    } catch (err) {
      setHandStatus(
        /denied|NotAllowed/i.test(String(err))
          ? "Camera blocked — allow access to use Hand Control."
          : "Couldn't start Hand Control on this device.",
      );
      setHandOn(false);
    }
  }, [handOn, applyHandFrame]);

  return (
    <div className="holo">
      <div className="holo-hud" style={{ maxWidth: "none", right: 22 }}>
        <div className="sectitle" style={{ marginBottom: 8 }}>
          <span className="sn">FG</span><h2>Forge</h2><span className="line" />
          <span className="tag">{count} OBJECT{count === 1 ? "" : "S"} · HOLOGRAPHIC SANDBOX</span>
        </div>

        {/* palette + colors */}
        <div className="fg-bar">
          {PALETTE.map(({ kind: k, icon: Icon, label }) => (
            <button
              key={k}
              title={label}
              onClick={() => { setKind(k); addShape(k, color); }}
              className={`fg-chip${kind === k ? " on" : ""}`}
            >
              <Icon className="size-4" /><span>{label}</span>
            </button>
          ))}
        </div>
        <div className="fg-bar">
          {COLORS.map((c) => (
            <button
              key={c}
              onClick={() => { setColor(c); const t = three.current; if (t?.selected) { const m = t.selected.material as THREE.MeshStandardMaterial; m.color.setHex(c); m.emissive.setHex(c); t.selected.userData.color = c; persist(); } }}
              className="fg-swatch"
              style={{ background: `#${c.toString(16).padStart(6, "0")}`, outline: color === c ? "2px solid var(--live)" : "none" }}
              aria-label="color"
            />
          ))}
          <span className="fg-sep" />
          <button className="fg-chip" title="Rotate (R)" onClick={() => transformSelected((m) => (m.rotation.y += 0.4))}><RotateCw className="size-4" /></button>
          <button className="fg-chip" title="Bigger (+)" onClick={() => transformSelected((m) => m.scale.multiplyScalar(1.15))}><Plus className="size-4" /></button>
          <button className="fg-chip" title="Smaller (−)" onClick={() => transformSelected((m) => m.scale.multiplyScalar(0.87))}><Minus className="size-4" /></button>
          <button className="fg-chip" title="Delete (Del)" onClick={removeSelected}><Trash2 className="size-4" /></button>
          <button className="fg-chip" title="Clear all" onClick={clearAll}><Sparkles className="size-4" /></button>
          <span className="fg-sep" />
          <button className={`fg-chip${handOn ? " on" : ""}`} title="Hand control (webcam)" onClick={toggleHand}>
            {handOn ? <VideoOff className="size-4" /> : <Video className="size-4" />}<span>Hands</span>
          </button>
        </div>
        {handStatus && <p className="fg-status"><Hand className="size-3.5" /> {handStatus}</p>}
      </div>

      <div ref={mountRef} className="holo-stage" style={{ background: "#07080a" }} />

      {/* webcam PIP (only visible while hand control is on) */}
      <video
        ref={videoRef}
        muted
        playsInline
        className="fg-cam"
        style={{ display: handOn ? "block" : "none" }}
      />

      <p className="fg-help">DRAG TO MOVE · SCROLL TO ZOOM · R ROTATE · Q/E LOWER-RAISE · +/− SCALE</p>
    </div>
  );
}
