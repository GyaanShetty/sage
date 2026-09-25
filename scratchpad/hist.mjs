const r = await fetch("http://localhost:3301/api/market/history?symbol=%5ENSEI&range=1mo");
const j = await r.json();
console.log(r.status, j.ok, j.ok ? { sym: j.data.symbol, n: j.data.points.length, ccy: j.data.currency, hi: j.data.high, lo: j.data.low } : j.error);
const bad = await fetch("http://localhost:3301/api/market/history?symbol=NVDA&range=bogus");
console.log("bad range:", bad.status, (await bad.json()).error);
