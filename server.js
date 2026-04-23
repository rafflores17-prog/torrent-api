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
  "udp://p4p.arenabg.com:1337/announce",
  "udp://tracker.leechers-paradise.org:6969/announce"
].map(tr => `&tr=${encodeURIComponent(tr)}`).join('');

const blacklist = ["apk","android","windows","linux","mac","crack","software","game","setup","tool","plugin","x64","x86","iso","repack", "camrip", "ts"];
const whitelist = ["1080p","720p","2160p","4k","bluray","webrip","web-dl","hdr","x264","x265"];
const prioridadeBR = ["dublado","dual","pt-br","portuguese"];

function limparNome(nome) { return nome.replace(/\./g, " ").replace(/\s+/g, " ").trim(); }

function ehFilme(nome) {
  nome = nome.toLowerCase();
  if (blacklist.some(b => nome.includes(b))) return false;
  // Whitelist desativada para deixar os clássicos (American Pie) passarem livremente!
  return true;
}

function scoreBR(nome) { return prioridadeBR.some(p => nome.toLowerCase().includes(p)) ? 1 : 0; }

// ==========================================================
// 🕷️ FONTE 1: 1337x
// ==========================================================
async function search1337x(query) {
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
      let size = "N/A";
      if (rawSize.includes("GB")) size = rawSize.split("GB")[0] + " GB";
      else if (rawSize.includes("MB")) size = rawSize.split("MB")[0] + " MB";
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
    const $ = cheerio.load(data);
    return $('a[href^="magnet:?xt="]').attr("href") || null;
  } catch { return null; }
}

// ==========================================================
// 🏴‍☠️ FONTE 2: THE PIRATE BAY
// ==========================================================
async function searchPirateBay(query) {
  try {
    const url = `https://apibay.org/q.php?q=${encodeURIComponent(query)}`;
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
async function searchYTS(query) {
  try {
    const url = `https://yts.mx/api/v2/list_movies.json?query_term=${encodeURIComponent(query)}`;
    const { data } = await axios.get(url, { timeout: 6000 });
    if (!data.data || !data.data.movies) return [];
    let results = [];
    data.data.movies.forEach(movie => {
      movie.torrents.forEach(t => {
        const name = `${movie.title} ${t.quality} ${t.type} YTS`;
        const magnet = `magnet:?xt=urn:btih:${t.hash}&dn=${encodeURIComponent(movie.title)}${TRACKERS}`;
        results.push({ name, seeders: t.seeds, size: t.size, magnet, origin: "YTS" });
      });
    });
    return results;
  } catch (err) { return []; }
}

// ==========================================================
// 🇧🇷 FONTE 4: ADDON BRAZUCA DO STREMIO
// ==========================================================
async function searchBrazucaAddon(imdbId, tituloQuery) {
  if (!imdbId || imdbId === "None") return [];
  try {
    const url = `https://94c8cb9f702d-brazuca-torrents.baby-beamup.club/stream/movie/${imdbId}.json`;
    const { data } = await axios.get(url, { timeout: 8000 });
    let results = [];
    if (data && data.streams) {
      data.streams.forEach(s => {
        let rawTitle = s.title || "";
        let sizeMatch = rawTitle.match(/\d+(?:\.\d+)?\s*(?:GB|MB)/i);
        let size = sizeMatch ? sizeMatch[0] : "N/A";
        let cleanName = `${tituloQuery} ${rawTitle.replace(/\n/g, ' ')} Dublado Dual`;
        let magnet = s.url;
        if (!magnet && s.infoHash) magnet = `magnet:?xt=urn:btih:${s.infoHash}${TRACKERS}`;
        if (magnet) results.push({ name: cleanName, seeders: 50, size: size, magnet: magnet, origin: "Brazuca" });
      });
    }
    return results;
  } catch (err) { return []; }
}

// ==========================================================
// 🦖 FONTE 5: TORRENTIO
// ==========================================================
async function searchTorrentio(imdbId, tituloQuery) {
  if (!imdbId || imdbId === "None") return [];
  try {
    const url = `https://torrentio.strem.fun/stream/movie/${imdbId}.json`;
    const { data } = await axios.get(url, { timeout: 9000 });
    let results = [];
    if (data && data.streams) {
      data.streams.forEach(s => {
        let rawTitle = s.title || "";
        let rawName = s.name || "Torrentio";
        let provider = rawName.split('\n')[0];
        let seedersMatch = rawTitle.match(/👤\s*(\d+)/);
        let seeders = seedersMatch ? parseInt(seedersMatch[1]) : 15;
        let sizeMatch = rawTitle.match(/\d+(?:\.\d+)?\s*(?:GB|MB)/i);
        let size = sizeMatch ? sizeMatch[0] : "N/A";
        let qualMatch = rawTitle.match(/1080p|720p|4k|2160p/i);
        let quality = qualMatch ? qualMatch[0] : "SD";
        let cleanName = `${tituloQuery} ${quality} [Via ${provider}]`;
        let magnet = s.url;
        if (!magnet && s.infoHash) magnet = `magnet:?xt=urn:btih:${s.infoHash}${TRACKERS}`;
        if (magnet) results.push({ name: cleanName, seeders: seeders, size: size, magnet: magnet, origin: `Torrentio` });
      });
    }
    return results.slice(0, 5);
  } catch (err) { return []; }
}

// ==========================================================
// 🚀 ROTA PRINCIPAL (OTIMIZADA PARA NÃO TRAVAR)
// ==========================================================
app.get("/streams", async (req, res) => {
  const query = req.query.q;
  const imdb = req.query.imdb;

  if (!query) return res.status(400).json({ error: "Informe um filme" });

  // 🛡️ REMOVE DOIS PONTOS E VÍRGULAS PRA NÃO QUEBRAR O PIRATEBAY E 1337X
  const safeQuery = query.replace(/[^\w\s-]/gi, '').replace(/\s+/g, ' ').trim();

  try {
    // 🔥 ACELERAÇÃO MÁXIMA: Roda as 5 fontes ao MESMO TEMPO! (Antes o 1337x travava tudo)
    const [resPirateBay, resYTS, resBrazuca, resTorrentio, res1337x] = await Promise.all([
      searchPirateBay(safeQuery),
      searchYTS(safeQuery),
      searchBrazucaAddon(imdb, query),
      searchTorrentio(imdb, query),
      search1337x(safeQuery) // Sem loop maldito
    ]);

    let allResults = [...resBrazuca, ...resTorrentio, ...res1337x, ...resPirateBay, ...resYTS];
    let streams = [];

    for (let item of allResults) {
      let magnet = item.magnet;
      if (!magnet && item.detail) { magnet = await getMagnet1337x(item.detail); }
      if (!magnet) continue;

      streams.push({
        title: `[${item.origin}] ` + limparNome(item.name),
        quality: item.name.match(/1080p|720p|2160p|4k/i)?.[0] || "SD",
        seeders: item.seeders,
        size: item.size,
        magnet,
        br: scoreBR(item.name)
      });
    }

    streams.sort((a, b) => {
      if (a.br !== b.br) return b.br - a.br;
      return b.seeders - a.seeders;
    });

    res.json({ query, total: streams.length, streams });

  } catch (err) {
    res.status(500).json({ error: "Erro geral" });
  }
});

app.listen(PORT, () => {
  console.log("🔥 API ANTI-TIMEOUT RODANDO VOAANDO!");
});
