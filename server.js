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

// 🕵️‍♂️ O DISFARCE: Faz o Node.js fingir que é um navegador de verdade
const FAKE_BROWSER = { 
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" 
};

const blacklist = ["apk","android","windows","linux","mac","crack","software","game","setup","tool","plugin","iso","repack", "camrip", "ts"];
function limparNome(nome) { return nome.replace(/\./g, " ").replace(/\s+/g, " ").trim(); }
function ehFilme(nome) { return !blacklist.some(b => nome.toLowerCase().includes(b)); }
function scoreBR(nome) { return ["dublado","dual","pt-br","portuguese"].some(p => nome.toLowerCase().includes(p)) ? 1 : 0; }

// ==========================================================
// 🏴‍☠️ FONTE 1: THE PIRATE BAY
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
        let size = (parseInt(t.size) > 1073741824) ? (parseInt(t.size) / 1073741824).toFixed(2) + " GB" : (parseInt(t.size) / 1048576).toFixed(2) + " MB";
        results.push({ name: t.name, seeders: parseInt(t.seeders), size: size, magnet, origin: "PirateBay" });
      }
    });
    return results.slice(0, 4);
  } catch (err) { return []; }
}

// ==========================================================
// 🕷️ FONTE 2: 1337X
// ==========================================================
async function search1337x(query) {
  if (!query) return [];
  try {
    const url = `https://www.1377x.to/search/${encodeURIComponent(query)}/1/`;
    const { data } = await axios.get(url, { headers: FAKE_BROWSER, timeout: 8000 });
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
    return results.slice(0, 3);
  } catch (err) { return []; }
}

async function getMagnet1337x(url) {
  try {
    const { data } = await axios.get(url, { headers: FAKE_BROWSER, timeout: 5000 });
    return cheerio.load(data)('a[href^="magnet:?xt="]').attr("href") || null;
  } catch { return null; }
}

// ==========================================================
// 🇧🇷 FONTE 3: BRAZUCA (COM DISFARCE ANTIBLOQUEIO)
// ==========================================================
async function searchBrazuca(imdbId, tituloBR) {
  if (!imdbId || imdbId === "None" || imdbId === "") return [];
  try {
    const { data } = await axios.get(`https://94c8cb9f702d-brazuca-torrents.baby-beamup.club/stream/movie/${imdbId}.json`, { 
      headers: FAKE_BROWSER, timeout: 10000 
    });
    let results = [];
    if (data && data.streams) {
      data.streams.forEach(s => {
        let rawTitle = s.title || "";
        let sizeMatch = rawTitle.match(/\d+(?:\.\d+)?\s*(?:GB|MB)/i);
        let size = sizeMatch ? sizeMatch[0] : "N/A";
        let cleanName = `${tituloBR} ${rawTitle.replace(/\n/g, ' ')} Dublado Dual`;
        let magnet = s.url || (s.infoHash ? `magnet:?xt=urn:btih:${s.infoHash}${TRACKERS}` : null);
        if (magnet) results.push({ name: cleanName, seeders: 60, size, magnet, origin: "Brazuca" });
      });
    }
    return results.slice(0, 6);
  } catch (err) { return []; }
}

// ==========================================================
// 🦖 FONTE 4: TORRENTIO HACKEADO (COMANDO + MICOLEÃO)
// ==========================================================
async function searchTorrentio(imdbId, tituloBR) {
  if (!imdbId || imdbId === "None" || imdbId === "") return [];
  try {
    // 🔥 A SUA URL CUSTOMIZADA EXATA AQUI!
    const config = "providers=yts,eztv,rarbg,1337x,thepiratebay,kickasstorrents,torrentgalaxy,magnetdl,comando,torrent9,micoleaodublado,horriblesubs|language=portuguese,spanish,italian";
    const url = `https://torrentio.strem.fun/${config}/stream/movie/${imdbId}.json`;
    
    // Disfarce e tempo maior para o Torrentio não bloquear a gente
    const { data } = await axios.get(url, { headers: FAKE_BROWSER, timeout: 12000 });
    let results = [];
    if (data && data.streams) {
      data.streams.forEach(s => {
        let rawTitle = s.title || "";
        let rawName = s.name || "Torrentio";
        let provider = rawName.split('\n')[0];
        let seedersMatch = rawTitle.match(/👤\s*(\d+)/);
        let seeders = seedersMatch ? parseInt(seedersMatch[1]) : 20;
        let sizeMatch = rawTitle.match(/\d+(?:\.\d+)?\s*(?:GB|MB)/i);
        let size = sizeMatch ? sizeMatch[0] : "N/A";
        let qualMatch = rawTitle.match(/1080p|720p|4k|2160p/i);
        let quality = qualMatch ? qualMatch[0] : "SD";
        
        let cleanName = `${tituloBR} ${quality} [Via ${provider}]`;
        let magnet = s.url || (s.infoHash ? `magnet:?xt=urn:btih:${s.infoHash}${TRACKERS}` : null);
        
        if (magnet) results.push({ name: cleanName, seeders, size, magnet, origin: "Torrentio" });
      });
    }
    return results.slice(0, 8);
  } catch (err) { return []; }
}

// ==========================================================
// 🚀 ROTA PRINCIPAL
// ==========================================================
app.get("/streams", async (req, res) => {
  const titulo_br = req.query.br || "";
  const titulo_orig = req.query.orig || titulo_br;
  const imdb = req.query.imdb || "";

  if (!titulo_br) return res.status(400).json({ error: "Informe um filme" });

  const safeOrig = titulo_orig.replace(/[^\w\s-]/gi, '').replace(/\s+/g, ' ').trim();

  try {
    const [resBrazuca, resTorrentio, resPirateBay, res1337x] = await Promise.all([
      searchBrazuca(imdb, titulo_br),
      searchTorrentio(imdb, titulo_br), 
      searchPirateBay(safeOrig),
      search1337x(titulo_br)
    ]);

    let allResults = [...resBrazuca, ...resTorrentio, ...resPirateBay, ...res1337x];
    let streams = [];

    for (let item of allResults) {
      let magnet = item.magnet;
      if (!magnet && item.detail) magnet = await getMagnet1337x(item.detail);
      if (!magnet) continue;

      let isBR = item.origin === "Brazuca" || item.name.toLowerCase().includes("comando") || item.name.toLowerCase().includes("micoleao") || scoreBR(item.name);

      streams.push({
        title: `[${item.origin}] ` + limparNome(item.name),
        quality: item.name.match(/1080p|720p|2160p|4k/i)?.[0] || "SD",
        seeders: item.seeders,
        size: item.size,
        magnet: magnet,
        br: isBR ? 1 : 0
      });
    }

    // Filtra duplicatas
    const uniqueStreams = [];
    const seenMagnets = new Set();
    for (let s of streams) {
      if (!seenMagnets.has(s.magnet)) {
        seenMagnets.add(s.magnet);
        uniqueStreams.push(s);
      }
    }

    res.json({ query: titulo_br, total: uniqueStreams.length, streams: uniqueStreams });
  } catch (err) {
    res.status(500).json({ error: "Erro geral" });
  }
});

app.listen(PORT, () => console.log("🔥 API ANTIBLOQUEIO RODANDO!"));
