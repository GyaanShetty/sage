import { chromium } from "playwright-core";
const routes = ["/dashboard","/ops","/markets","/mail","/calendar","/health","/career","/portfolio","/board","/memory","/knowledge","/settings","/chat","/read","/workspace","/sitrep","/education","/agents","/graph","/exam","/review","/report","/nonexistent-route-test"];
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1" });
for (const r of routes) {
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", e => errs.push(e.message.slice(0,90)));
  try {
    const resp = await p.goto("http://localhost:3000" + r, { waitUntil: "domcontentloaded", timeout: 45000 });
    await p.waitForTimeout(4500);
    const d = await p.evaluate(() => {
      const de = document.documentElement;
      const over = [];
      for (const el of document.querySelectorAll("body *")) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.right > window.innerWidth + 2) {
          const cs = getComputedStyle(el);
          if (cs.position === "fixed") continue;
          over.push((el.tagName + "." + String(el.className).slice(0,40)).slice(0,60) + " →" + Math.round(rect.right));
        }
      }
      return {
        hscroll: de.scrollWidth > de.clientWidth + 1,
        scrollW: de.scrollWidth, clientW: de.clientWidth,
        over: [...new Set(over)].slice(0, 4),
        title: document.title,
        desc: document.querySelector('meta[name="description"]')?.getAttribute("content")?.slice(0,40) ?? "NONE",
      };
    });
    console.log(`${r.padEnd(24)} ${resp.status()} hscroll=${d.hscroll?("YES "+d.scrollW+"/"+d.clientW):"no"} | ${d.title.slice(0,34)} | desc=${d.desc==="NONE"?"NONE":"ok"}${d.over.length?"\n    over: "+d.over.join(" ; "):""}${errs.length?"\n    ERR: "+errs[0]:""}`);
  } catch (e) { console.log(r, "FAIL", e.message.slice(0,80)); }
  await p.close();
}
await b.close();
