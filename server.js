const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());

const PORT = 3000;

// ================= LIMPEZA =================
function norm(t) {
  return (t || "")
    .toLowerCase()
    .replace(/\./g, " ")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ================= SCORE INTELIGENTE =================
function score(title, query) {
  const t = norm(title);
  const q = norm(query);

  let s = 0;

  const words = q.split(" ");
  for (let w of words) {
    if (t.includes(w)) s += 15;
  }

  if (t.includes("1080p")) s += 5;
  if (t.includes("4k") || t.includes("2160p")) s += 8;
  if (t.includes("dublado")) s += 10;
  if (t.includes("dual")) s += 5;

  return s;
}

// ================= MOCK BASE (SUBSTITUI FUTURO POR FONTES REAIS) =================
async function fetchStreams(title) {

  // 🔥 aqui você depois pluga Brazuca / Torrentio REAL
  return [
    { title: `${title} 1080p Dublado BR`, origin: "Brazuca" },
    { title: `${title} 720p Dual Audio`, origin: "Torrentio" },
    { title: `${title} 4K HDR`, origin: "HighSource" }
  ];
}

// ================= API =================
app.get("/streams", async (req, res) => {

  const title = req.query.title || "";

  if (!title) {
    return res.json({ streams: [] });
  }

  let results = await fetchStreams(title);

  results = results.map(r => ({
    ...r,
    score: score(r.title, title)
  }));

  results.sort((a, b) => b.score - a.score);

  res.json({
    query: title,
    total: results.length,
    streams: results.slice(0, 20)
  });
});

// ================= START =================
app.listen(PORT, () => {
  console.log(`🚀 API rodando em http://127.0.0.1:${PORT}`);
});
