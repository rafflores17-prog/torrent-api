const express = require("express");
const cors = require("cors");
const axios = require("axios");
const cheerio = require("cheerio");

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;

const TRACKERS = [
  "udp://tracker.openbittorrent.com:80/announce",
  "udp://tracker.opentrackr.org:1337/announce",
  "udp://tracker.coppersurfer.tk:6969/announce"
].map(tr => `&tr=${encodeURIComponent(tr)}`).join('');

// ================= UTIL =================
function limpar(txt) {
  return (txt || "")
    .toLowerCase()
    .replace(/\./g, " ")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function palavrasBase(titulo) {
  return limpar(titulo)
    .split(" ")
    .filter(p => p.length > 2);
}

// 🚫 FILTRO LIXO LEVE (não destrói resultados)
const blacklist = [
  "apk","android","windows","linux","mac","crack",
  "software","game","setup","iso","repack","adobe",
  "xxx","porn","sex","driver"
];

function ehValido(nome) {
  const n = limpar(nome);
  if (blacklist.some(b => n.includes(b))) return false;
  return true;
}

// ================= SCORE INTELIGENTE =================
function scoreItem(nome, palavras, ano) {
  const n = limpar(nome);
  let score = 0;

  // match título
  palavras.forEach(p => {
    if (n.includes(p)) score += 12;
  });

  // ano ajuda mas não obriga
  if (ano && n.includes(ano)) score += 8;

  // qualidade
  if (n.includes("1080p")) score += 5;
  if (n.includes("720p")) score += 3;
  if (n.includes("4k") || n.includes("2160p")) score += 7;

  // idioma
  if (n.includes("dublado")) score += 10;
  if (n.includes("dual")) score += 8;

  // fontes fortes
  if (n.includes("brazuca")) score += 30;
  if (n.includes("torrentio")) score += 20;

  return score;
}

// ================= PIRATEBAY =================
async function searchPirateBay(query) {
  try {
    const { data } = await axios.get(
      `https://apibay.org/q.php?q=${encodeURIComponent(query)}`
    );

    if (!Array.isArray(data)) return [];

    return data.slice(0, 10).map(t => ({
      name: t.name,
      magnet: `magnet:?xt=urn:btih:${t.info_hash}${TRACKERS}`,
      seeders: parseInt(t.seeders || 0),
      origin: "PirateBay"
    }));

  } catch {
    return [];
  }
}

// ================= 1337X =================
async function search1337x(query) {
  try {
    const url = `https://www.1377x.to/search/${encodeURIComponent(query)}/1/`;

    const { data } = await axios.get(url, {
      headers: { "User-Agent": "Mozilla/5.0" }
    });

    const $ = cheerio.load(data);
    let results = [];

    $("table tbody tr").each((i, el) => {
      const name = $(el).find("td.name a:nth-child(2)").text();
      const link = $(el).find("td.name a:nth-child(2)").attr("href");

      if (!name || !link) return;

      results.push({
        name,
        detail: "https://www.1377x.to" + link,
        origin: "1337x"
      });
    });

    return results.slice(0, 10);

  } catch {
    return [];
  }
}

async function getMagnet1337x(url) {
  try {
    const { data } = await axios.get(url, {
      headers: { "User-Agent": "Mozilla/5.0" }
    });

    return cheerio.load(data)('a[href^="magnet:?xt="]').attr("href") || null;

  } catch {
    return null;
  }
}

// ================= BRAZUCA =================
async function searchBrazuca(imdb, titulo) {
  if (!imdb) return [];

  try {
    const { data } = await axios.get(
      `https://94c8cb9f702d-brazuca-torrents.baby-beamup.club/stream/movie/${imdb}.json`
    );

    return (data.streams || []).map(s => ({
      name: `${titulo} ${s.title}`,
      magnet: s.url,
      origin: "Brazuca"
    }));

  } catch {
    return [];
  }
}

// ================= TORRENTIO =================
async function searchTorrentio(imdb) {
  if (!imdb) return [];

  try {
    const { data } = await axios.get(
      `https://torrentio.strem.fun/stream/movie/${imdb}.json`
    );

    return (data.streams || []).map(s => ({
      name: s.title,
      magnet: s.url,
      origin: "Torrentio"
    }));

  } catch {
    return [];
  }
}

// ================= MOTOR PRINCIPAL =================
app.get("/streams", async (req, res) => {

  const titulo = req.query.orig || req.query.br;
  const imdb = req.query.imdb || "";
  const year = req.query.year || "";

  if (!titulo) return res.json({ streams: [] });

  const palavras = palavrasBase(titulo);

  // 🔥 múltiplas buscas automáticas
  const queries = [
    `${titulo} ${year}`,
    `${titulo} 1080p`,
    `${titulo} dublado`,
    `${titulo} dual`,
    titulo
  ];

  let all = [];

  for (let q of queries) {
    try {
      const [pb, x] = await Promise.all([
        searchPirateBay(q),
        search1337x(q)
      ]);

      all.push(...pb, ...x);
    } catch {}
  }

  const [brazuca, torrentio] = await Promise.all([
    searchBrazuca(imdb, titulo),
    searchTorrentio(imdb)
  ]);

  all.push(...brazuca, ...torrentio);

  let final = [];

  for (let item of all) {

    if (!item.magnet) {
      if (item.detail) {
        item.magnet = await getMagnet1337x(item.detail);
      }
    }

    if (!item.magnet) continue;

    if (!ehValido(item.name)) continue;

    const score = scoreItem(item.name, palavras, year);

    if (score < 6) continue;

    final.push({
      title: `[${item.origin}] ${item.name}`,
      magnet: item.magnet,
      score
    });
  }

  // remove duplicados
  const seen = new Set();
  final = final.filter(f => {
    if (seen.has(f.magnet)) return false;
    seen.add(f.magnet);
    return true;
  });

  final.sort((a, b) => b.score - a.score);

  res.json({
    query: titulo,
    total: final.length,
    streams: final.slice(0, 25)
  });
});

app.listen(PORT, () => {
  console.log("🔥 MOTOR INTELIGENTE RODANDO");
});
