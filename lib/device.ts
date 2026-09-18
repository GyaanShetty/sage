"use client";

/**
 * What a page can actually measure about the machine it is running on.
 *
 * I had been saying a browser cannot read the hardware, and used that to
 * argue the reference's systems panel could not be built honestly. That was
 * half right: it cannot read CPU load or GPU load, and nothing here pretends
 * to. But heap, storage quota, frame rate, battery, core count and link speed
 * are all real, all exposed, and all more useful than the invented
 * percentages the mockup shows.
 *
 * Everything is optional and everything is feature-detected. A reading the
 * browser does not offer comes back null and the panel says so, rather than
 * defaulting to a number that looks like a measurement.
 */

export interface DeviceReading {
  heapUsed: number | null;   // bytes
  heapLimit: number | null;  // bytes
  storeUsed: number | null;  // bytes
  storeQuota: number | null; // bytes
  cores: number | null;
  ramGb: number | null;
  downlinkMbps: number | null;
  netKind: string | null;
  rtt: number | null;        // ms
  battery: number | null;    // 0..1
  charging: boolean | null;
  fps: number | null;
}

type PerfMemory = { usedJSHeapSize: number; jsHeapSizeLimit: number };
type NetInfo = { downlink?: number; effectiveType?: string; rtt?: number };
type BatteryLike = { level: number; charging: boolean };

/**
 * Frame rate, sampled over a second.
 *
 * Not a hardware reading — it is how smoothly THIS page is running, which is
 * the thing you would actually want to know from a panel on it.
 */
export function sampleFps(cb: (fps: number) => void) {
  let frames = 0;
  let start = performance.now();
  let raf = 0;
  let stop = false;
  const tick = (t: number) => {
    if (stop) return;
    frames++;
    if (t - start >= 1000) {
      cb(Math.round((frames * 1000) / (t - start)));
      frames = 0;
      start = t;
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => { stop = true; cancelAnimationFrame(raf); };
}

export async function readDevice(): Promise<Omit<DeviceReading, "fps">> {
  const nav = navigator as Navigator & {
    deviceMemory?: number;
    connection?: NetInfo;
    getBattery?: () => Promise<BatteryLike>;
  };
  const perf = performance as Performance & { memory?: PerfMemory };

  let storeUsed: number | null = null;
  let storeQuota: number | null = null;
  try {
    if (navigator.storage?.estimate) {
      const e = await navigator.storage.estimate();
      storeUsed = e.usage ?? null;
      storeQuota = e.quota ?? null;
    }
  } catch { /* Safari private mode refuses; null is the honest answer */ }

  let battery: number | null = null;
  let charging: boolean | null = null;
  try {
    if (nav.getBattery) {
      const b = await nav.getBattery();
      battery = b.level;
      charging = b.charging;
    }
  } catch { /* Firefox removed this; null again */ }

  return {
    heapUsed: perf.memory?.usedJSHeapSize ?? null,
    heapLimit: perf.memory?.jsHeapSizeLimit ?? null,
    storeUsed, storeQuota,
    cores: nav.hardwareConcurrency ?? null,
    ramGb: nav.deviceMemory ?? null,
    downlinkMbps: nav.connection?.downlink ?? null,
    netKind: nav.connection?.effectiveType ?? null,
    rtt: nav.connection?.rtt ?? null,
    battery, charging,
  };
}
