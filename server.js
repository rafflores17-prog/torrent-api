const express = require("express");
const cors = require("cors");
const axios = require("axios");
const cheerio = require("cheerio");

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;

const TRACKERS = [
  "udp://tracker.openbittorrent.com:80/announce",
  "udp://tracker.opentrackr.org:1337/announce"
].map(tr => `&tr=${encodeURIComponent(tr)}`).join('');

const blacklist = [
  "apk","android","windows","linux","mac","crack",
  "software","game","setup","iso","repack","adobe",
  "xxx","porn","sex"
];

// ================= UTIL =================
function limpar(txt) {
  return txt.toLowerCase().replace(/\./g, " ").replace(/[^\w\s]/g, "");
}

function extrairPalavras(titulo) {
  return limpar(titulo).split(" ").filter(p => p.length > 2);
}

// 🔥 VALIDAÇÃO REAL DO FILME
function ehMesmoFilme(nome, palavras, ano) {
  nome = limpar(nome);

  // precisa ter pelo menos 1 palavra do título
  const bateTitulo = palavras.some(p => nome.includes(p));

  // se tiver ano, melhor ainda
  const bateAno = ano ? nome.includes(ano) : true;

  return bateTitulo && bateAno;
}

function ehFilme(nome) {
  nome = nome.toLowerCase();

  if (blacklist.some(b => nome.includes(b))) return false;

  return /(19|20)\d{2}/.test(nome) || /1080p|720p|4k/i.test(nome);
}

// ==========================================================
// 🏴‍☠️ PIRATE BAY (FILTRADO)
// ==========================================================
async function searchPirateBay(query, palavras, ano) {
  try {
    const { data } = await axios.get(`https://apibay.org/q.php?q=${encodeURIComponent(query)}`);

    let results = [];

    data.forEach(t => {
      if (!t.name) return;

      if (!ehFilme(t.name)) return;

      if (!ehMesmoFilme(t.name, palavras, ano)) return;

      const magnet = `magnet:?xt=urn:btih:${t.info_hash}${TRACKERS}`;

      results.push({
        name: t.name,
        seeders: parseInt(t.seeders),
        size: "N/A",
        magnet,
        origin: "PirateBay"
      });
    });

    return results.slice(0, 5);

  } catch {
    return [];
  }
}

// ==========================================================
// 🕷️ 1337X (AGORA CORRETO)
// ==========================================================
async function search1337x(query, palavras, ano) {
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

      if (!ehFilme(name)) return;

      // 🔥 FILTRO REAL
      if (!ehMesmoFilme(name, palavras, ano)) return;

      results.push({
        name,
        detail: "https://www.1377x.to" + link,
        origin: "1337x"
      });
    });

    return results.slice(0, 5);

  } catch {
    return [];
  }
}

async function getMagnet1337x(url) {
  try {
    const { data } = await axios.get(url, {
      headers: { "User-Agent": "Mozilla/5.0" }
    });

    return cheerio.load(data)('a[href^="magnet:?xt="]').attr("href");

  } catch {
    return null;
  }
}

// ==========================================================
// 🇧🇷 BRAZUCA
// ==========================================================
async function searchBrazuca(imdb, titulo) {
  if (!imdb) return [];

  try {
    const { data } = await axios.get(`https://94c8cb9f702d-brazuca-torrents.baby-beamup.club/stream/movie/${imdb}.json`);

    return (data.streams || []).map(s => ({
      name: `${titulo} ${s.title}`,
      magnet: s.url,
      seeders: 80,
      size: "N/A",
      origin: "Brazuca"
    }));

  } catch {
    return [];
  }
}

// ==========================================================
// 🦖 TORRENTIO
// ==========================================================
async function searchTorrentio(imdb) {
  if (!imdb) return [];

  try {
    const { data } = await axios.get(`https://torrentio.strem.fun/stream/movie/${imdb}.json`);

    return (data.streams || []).map(s => ({
      name: s.title,
      magnet: s.url,
      seeders: 50,
      size: "N/A",
      origin: "Torrentio"
    }));

  } catch {
    return [];
  }
}

// ==========================================================
// 🚀 ROTA PRINCIPAL (INTELIGENTE)
// ==========================================================
app.get("/streams", async (req, res) => {

  const titulo = req.query.orig || req.query.br;
  const imdb = req.query.imdb || "";
  const year = req.query.year || "";

  if (!titulo) return res.json({ streams: [] });

  const palavras = extrairPalavras(titulo);
  const query = `${titulo} ${year}`;

  const [brazuca, torrentio, pirate, x1337] = await Promise.all([
    searchBrazuca(imdb, titulo),
    searchTorrentio(imdb),
    searchPirateBay(query, palavras, year),
    search1337x(query, palavras, year)
  ]);

  let all = [...brazuca, ...torrentio, ...pirate, ...x1337];

  let final = [];

  for (let item of all) {
    let magnet = item.magnet;

    if (!magnet && item.detail) {
      magnet = await getMagnet1337x(item.detail);
    }

    if (!magnet) continue;

    final.push({
      title: `[${item.origin}] ${item.name}`,
      magnet
    });
  }

  res.json({ streams: final.slice(0, 20) });
});

app.listen(PORT, () => console.log("🔥 API FILTRO INTELIGENTE ON"));
