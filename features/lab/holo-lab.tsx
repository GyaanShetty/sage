"use client";

import { useEffect, useRef, useState } from "react";
import "@/features/dashboard/command.css";

interface Part { name: string; role: string; importance: number; connectsTo: string[] }
interface Blueprint { title: string; overview: string; parts: Part[]; howItWorks: string }

const SUGGESTIONS = ["A 4-stroke engine", "The human heart", "A transformer neural network", "A rocket engine", "The water cycle", "A CPU"];

export function HoloLab() {
  const mountRef = useRef<HTMLDivElement>(null);
  const [topic, setTopic] = useState("");
  const [loading, setLoading] = useState(false);
  const [bp, setBp] = useState<Blueprint | null>(null);
  const [selected, setSelected] = useState<Part | null>(null);
  const [exploded, setExploded] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const apiRef = useRef<{ setSpread: (v: number) => void; focus: (name: string) => void } | null>(null);

  const generate = async (t: string) => {
    const q = t.trim();
    if (!q || loading) return;
    setLoading(true); setError(null); setSelected(null);
    try {
      const res = await fetch("/api/lab", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ topic: q }) });
      const j = await res.json();
      if (!j.ok) { setError(j.error ?? "Could not build the blueprint."); setLoading(false); return; }
      setBp(j.data);
    } catch {
      setError("Link error — try again.");
    }
    setLoading(false);
  };

  // Build / rebuild the Three scene when a blueprint arrives.
  useEffect(() => {
    if (!bp || !mountRef.current) return;
    let raf = 0, disposed = false;
    let cleanup = () => {};
    (async () => {
      const THREE = await import("three");
      const { OrbitControls } = await import("three/examples/jsm/controls/OrbitControls.js");
      if (disposed || !mountRef.current) return;
      const mount = mountRef.current;
      mount.innerHTML = "";
      const W = mount.clientWidth, H = mount.clientHeight;

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(50, W / H, 0.1, 1000);
      camera.position.set(0, 0, 46);
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
      renderer.setSize(W, H);
      mount.appendChild(renderer.domElement);

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.autoRotate = true;
      controls.autoRotateSpeed = 0.6;
      controls.enablePan = false;
      controls.minDistance = 18;
      controls.maxDistance = 90;

      const CYAN = new THREE.Color("#5ecfd6");
      const parts = bp.parts;
      const n = parts.length;
      // fibonacci sphere layout, core parts pulled inward
      const nodes = parts.map((p, i) => {
        const y = 1 - (i / (n - 1)) * 2;
        const r = Math.sqrt(1 - y * y);
        const phi = i * Math.PI * (3 - Math.sqrt(5));
        const base = new THREE.Vector3(Math.cos(phi) * r, y, Math.sin(phi) * r).multiplyScalar(18 - p.importance * 2.2);
        const size = 1.1 + p.importance * 0.7;
        const geo = new THREE.IcosahedronGeometry(size, 0);
        const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: CYAN, wireframe: true, transparent: true, opacity: 0.85 }));
        const glow = new THREE.Mesh(new THREE.IcosahedronGeometry(size * 1.25, 0), new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0.06 }));
        mesh.add(glow);
        mesh.userData = { part: p };
        scene.add(mesh);

        // label sprite
        const cv = document.createElement("canvas"); cv.width = 256; cv.height = 64;
        const ctx = cv.getContext("2d")!;
        ctx.font = "600 26px 'JetBrains Mono', monospace";
        ctx.fillStyle = "#eef2f2"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(p.name.slice(0, 22), 128, 34);
        const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthTest: false }));
        spr.scale.set(11, 2.75, 1);
        scene.add(spr);
        return { mesh, glow, spr, base, part: p, size };
      });

      // connection lines
      type Node = (typeof nodes)[number];
      const byName = new Map(nodes.map((nd) => [nd.part.name.toLowerCase(), nd]));
      const lineMat = new THREE.LineBasicMaterial({ color: CYAN, transparent: true, opacity: 0.22 });
      const lines: { line: import("three").Line; a: Node; b: Node }[] = [];
      for (const nd of nodes) {
        for (const c of nd.part.connectsTo) {
          const t = byName.get(c.toLowerCase().trim());
          if (t && t !== nd) {
            const g = new THREE.BufferGeometry().setFromPoints([nd.base, t.base]);
            const line = new THREE.Line(g, lineMat);
            scene.add(line);
            lines.push({ line, a: nd, b: t });
          }
        }
      }

      let spread = 1;
      let targetSpread = exploded ? 1 : 0.34;
      apiRef.current = {
        setSpread: (v: number) => { targetSpread = v; },
        focus: (name: string) => {
          const nd = byName.get(name.toLowerCase());
          if (nd) { controls.autoRotate = false; }
          void nd;
        },
      };

      const ray = new THREE.Raycaster();
      const mouse = new THREE.Vector2();
      const onClick = (e: MouseEvent) => {
        const rect = renderer.domElement.getBoundingClientRect();
        mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        ray.setFromCamera(mouse, camera);
        const hit = ray.intersectObjects(nodes.map((nd) => nd.mesh))[0];
        if (hit) { setSelected(hit.object.userData.part as Part); controls.autoRotate = false; }
      };
      renderer.domElement.addEventListener("click", onClick);

      const resize = () => {
        const w = mount.clientWidth, h = mount.clientHeight;
        camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h);
      };
      const ro = new ResizeObserver(resize); ro.observe(mount);

      const tmp = new THREE.Vector3();
      const loop = () => {
        spread += (targetSpread - spread) * 0.08;
        for (const nd of nodes) {
          tmp.copy(nd.base).multiplyScalar(spread);
          nd.mesh.position.copy(tmp);
          nd.spr.position.copy(tmp).add(new THREE.Vector3(0, nd.size + 1.6, 0));
          nd.mesh.rotation.y += 0.004; nd.mesh.rotation.x += 0.002;
        }
        for (const l of lines) {
          l.line.geometry.setFromPoints([l.a.mesh.position, l.b.mesh.position]);
        }
        controls.update();
        renderer.render(scene, camera);
        raf = requestAnimationFrame(loop);
      };
      loop();

      cleanup = () => {
        cancelAnimationFrame(raf);
        ro.disconnect();
        renderer.domElement.removeEventListener("click", onClick);
        renderer.dispose();
        mount.innerHTML = "";
      };
    })();
    return () => { disposed = true; cleanup(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bp]);

  useEffect(() => { apiRef.current?.setSpread(exploded ? 1 : 0.34); }, [exploded]);

  const explain = async (p: Part) => {
    try {
      const res = await fetch("/api/voice/speak", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: `${p.name}. ${p.role}` }) });
      if (res.ok) { const a = new Audio(URL.createObjectURL(await res.blob())); a.play().catch(() => {}); }
    } catch {}
  };

  return (
    <div className="holo">
      <div className="holo-hud">
        <div className="sectitle" style={{ marginBottom: 12 }}><span className="sn">LAB</span><h2>Holo-Lab</h2><span className="line" /><span className="tag">LEARN ANYTHING IN 3D</span></div>
        <div className="holo-input">
          <input value={topic} onChange={(e) => setTopic(e.target.value)} onKeyDown={(e) => e.key === "Enter" && generate(topic)} placeholder="What do you want to understand?  e.g. a jet engine" />
          <button onClick={() => generate(topic)} disabled={loading}>{loading ? "BUILDING…" : "MATERIALISE"}</button>
        </div>
        {!bp && !loading && (
          <div className="chips" style={{ marginTop: 12 }}>
            {SUGGESTIONS.map((s) => <button key={s} className="chip" onClick={() => { setTopic(s); generate(s); }}>{s}</button>)}
          </div>
        )}
        {error && <p className="lbl" style={{ color: "#e07070", marginTop: 10 }}>{error.toUpperCase()}</p>}
      </div>

      <div className="holo-stage" ref={mountRef} />
      {loading && <div className="holo-loading"><div className="holo-spinner" />COMPILING BLUEPRINT…</div>}

      {bp && (
        <>
          <div className="holo-overview">
            <div className="ho-title">{bp.title}</div>
            <p className="ho-text">{bp.overview}</p>
            <button className="chip" style={{ marginTop: 10 }} onClick={() => setExploded((e) => !e)}>{exploded ? "◍ ASSEMBLE" : "⤢ EXPLODE"}</button>
          </div>
          {selected ? (
            <div className="holo-part">
              <div className="hp-name">{selected.name}</div>
              <p className="hp-role">{selected.role}</p>
              {selected.connectsTo.length > 0 && <p className="hp-conn">CONNECTS TO: {selected.connectsTo.join(" · ")}</p>}
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button className="chip fc-got" onClick={() => explain(selected)}>▶ EXPLAIN ALOUD</button>
                <button className="chip" onClick={() => setSelected(null)}>CLOSE</button>
              </div>
            </div>
          ) : (
            <div className="holo-part holo-howto">
              <div className="hp-name" style={{ fontSize: 11, letterSpacing: 2 }}>HOW IT WORKS</div>
              <p className="hp-role">{bp.howItWorks}</p>
              <p className="lbl" style={{ marginTop: 12, opacity: 0.6 }}>TAP ANY GLOWING PART TO STUDY IT · DRAG TO ROTATE</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
