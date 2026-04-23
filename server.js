const express = require("express");
const cors = require("cors");
const axios = require("axios");
const cheerio = require("cheerio");

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;

// 🔥 TRACKERS PÚBLICOS
const TRACKERS = [
  "udp://tracker.openbittorrent.com:80/announce",
  "udp://tracker.opentrackr.org:1337/announce",
  "udp://tracker.coppersurfer.tk:6969/announce",
  "udp://p4p.arenabg.com:1337/announce"
].map(tr => `&tr=${encodeURIComponent(tr)}`).join('');

const blacklist = ["apk","android","windows","linux","mac","crack","software","game","setup","tool","plugin","iso","repack", "camrip", "ts"];
const prioridadeBR = ["dublado","dual","pt-br","portuguese"];

function limparNome(nome) { return nome.replace(/\./g, " ").replace(/\s+/g, " ").trim(); }
function ehFilme(nome) {
  return !blacklist.some(b => nome.toLowerCase().includes(b));
}
function scoreBR(nome) { return prioridadeBR.some(p => nome.toLowerCase().includes(p)) ? 1 : 0; }

// ==========================================================
// 🕷️ FONTE 1: 1337X (A VOLTA DOS QUE NÃO FORAM - MODO RÁPIDO)
// ==========================================================
async function search1337x(query) {
  if (!query) return [];
  try {
    const url = `https://www.1377x.to/search/${encodeURIComponent(query)}/1/`;
    const { data } = await axios.get(url, { headers: { "User-Agent": "Mozilla/5.0" }, timeout: 8000 });
    const $ = cheerio.load(data);
    let results = [];
    $("table tbody tr").each((i, el) => {
      const name = $(el).find("td.name a:nth-child(2)").text();
      const link = $(el).find("td.name a:nth-child(2)").attr("href");
      const seeders = parseInt($(el).find("td.seeds").text()) || 0;
      let rawSize = $(el).find("td.size").text();
      let size = rawSize.includes("GB") ? rawSize.split("GB")[0] + " GB" : (rawSize.includes("MB") ? rawSize.split("MB")[0] + " MB" : "N/A");
      if (name && link && ehFilme(name)) {
        results.push({ name, seeders, size, detail: "https://www.1377x.to" + link, origin: "1337x" });
      }
    });
    return results.slice(0, 4);
  } catch (err) { return []; }
}

async function getMagnet1337x(url) {
  try {
    const { data } = await axios.get(url, { headers: { "User-Agent": "Mozilla/5.0" }, timeout: 5000 });
    return cheerio.load(data)('a[href^="magnet:?xt="]').attr("href") || null;
  } catch { return null; }
}

// ==========================================================
// 🏴‍☠️ FONTE 2: THE PIRATE BAY
// ==========================================================
async function searchPirateBay(tituloOriginal) {
  if (!tituloOriginal) return [];
  try {
    const url = `https://apibay.org/q.php?q=${encodeURIComponent(tituloOriginal)}`;
    const { data } = await axios.get(url, { timeout: 6000 });
    if (!data || data[0].id === '0') return [];
    let results = [];
    data.forEach(t => {
      if (t.category.startsWith('2') && ehFilme(t.name)) {
        const magnet = `magnet:?xt=urn:btih:${t.info_hash}&dn=${encodeURIComponent(t.name)}${TRACKERS}`;
        const sizeBytes = parseInt(t.size);
        const sizeFormated = sizeBytes > 1073741824 ? (sizeBytes / 1073741824).toFixed(2) + " GB" : (sizeBytes / 1048576).toFixed(2) + " MB";
        results.push({ name: t.name, seeders: parseInt(t.seeders), size: sizeFormated, magnet, origin: "PirateBay" });
      }
    });
    return results.slice(0, 4);
  } catch (err) { return []; }
}

// ==========================================================
// 🍿 FONTE 3: YTS API
// ==========================================================
async function searchYTS(tituloOriginal) {
  if (!tituloOriginal) return [];
  try {
    const url = `https://yts.mx/api/v2/list_movies.json?query_term=${encodeURIComponent(tituloOriginal)}`;
    const { data } = await axios.get(url, { timeout: 6000 });
    if (!data.data || !data.data.movies) return [];
    let results = [];
    data.data.movies.forEach(movie => {
      movie.torrents.forEach(t => {
        const magnet = `magnet:?xt=urn:btih:${t.hash}&dn=${encodeURIComponent(movie.title)}${TRACKERS}`;
        results.push({ name: `${movie.title} ${t.quality} YTS`, seeders: t.seeds, size: t.size, magnet, origin: "YTS" });
      });
    });
    return results;
  } catch (err) { return []; }
}

// ==========================================================
// 🇧🇷 FONTE 4: BRAZUCA E TORRENTIO (IMDB)
// ==========================================================
async function searchStremioAddon(imdbId, tituloBR, addonUrl, originName) {
  if (!imdbId || imdbId === "None" || imdbId === "") return [];
  try {
    const { data } = await axios.get(`${addonUrl}${imdbId}.json`, { timeout: 8000 });
    let results = [];
    if (data && data.streams) {
      data.streams.forEach(s => {
        let rawTitle = s.title || "";
        let rawName = s.name || originName;
        let provider = rawName.split('\n')[0];
        let seedersMatch = rawTitle.match(/👤\s*(\d+)/);
        let seeders = seedersMatch ? parseInt(seedersMatch[1]) : (originName === "Brazuca" ? 50 : 15);
        let sizeMatch = rawTitle.match(/\d+(?:\.\d+)?\s*(?:GB|MB)/i);
        let size = sizeMatch ? sizeMatch[0] : "N/A";
        let qualMatch = rawTitle.match(/1080p|720p|4k|2160p/i);
        let quality = qualMatch ? qualMatch[0] : "SD";
        
        let cleanName = originName === "Brazuca" ? `${tituloBR} ${rawTitle.replace(/\n/g, ' ')} Dublado Dual` : `${tituloBR} ${quality} [Via ${provider}]`;
        let magnet = s.url || (s.infoHash ? `magnet:?xt=urn:btih:${s.infoHash}${TRACKERS}` : null);
        
        if (magnet) results.push({ name: cleanName, seeders, size, magnet, origin: originName });
      });
    }
    return results.slice(0, 6);
  } catch (err) { return []; }
}

// ==========================================================
// 🚀 ROTA PRINCIPAL: AS 5 FONTES AO MESMO TEMPO
// ==========================================================
app.get("/streams", async (req, res) => {
  const titulo_br = req.query.br || "";
  const titulo_orig = req.query.orig || titulo_br;
  const imdb = req.query.imdb || "";

  if (!titulo_br) return res.status(400).json({ error: "Informe um filme" });

  const safeOrig = titulo_orig.replace(/[^\w\s-]/gi, '').replace(/\s+/g, ' ').trim();

  try {
    // 🔥 LIGA TUDO EM PARALELO (Sem loop, super rápido!)
    const [resPirateBay, resYTS, resBrazuca, resTorrentio, res1337x] = await Promise.all([
      searchPirateBay(safeOrig),
      searchYTS(safeOrig),
      searchStremioAddon(imdb, titulo_br, "https://94c8cb9f702d-brazuca-torrents.baby-beamup.club/stream/movie/", "Brazuca"),
      searchStremioAddon(imdb, titulo_br, "https://torrentio.strem.fun/stream/movie/", "Torrentio"),
      search1337x(titulo_br) // Busca o BR no 1337x pra garantir
    ]);

    let allResults = [...resBrazuca, ...resTorrentio, ...resPirateBay, ...res1337x, ...resYTS];
    let streams = [];

    for (let item of allResults) {
      let magnet = item.magnet;
      if (!magnet && item.detail) magnet = await getMagnet1337x(item.detail);
      if (!magnet) continue;

      streams.push({
        title: `[${item.origin}] ` + limparNome(item.name),
        quality: item.name.match(/1080p|720p|2160p|4k/i)?.[0] || "SD",
        seeders: item.seeders,
        size: item.size,
        magnet: magnet,
        br: scoreBR(item.name)
      });
    }

    streams.sort((a, b) => (b.br - a.br) || (b.seeders - a.seeders));
    res.json({ query: titulo_br, total: streams.length, streams });
  } catch (err) {
    res.status(500).json({ error: "Erro geral" });
  }
});

app.listen(PORT, () => console.log("🔥 API 5 MOTORES BLINDADA RODANDO!"));
