const express = require("express");
const cors = require("cors");
const axios = require("axios");
const cheerio = require("cheerio");

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;

// 🔥 TRACKERS PÚBLICOS (O Nitro)
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
  if (!whitelist.some(w => nome.includes(w))) return false;
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
  if (!imdbId) return [];
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

        if (magnet) {
            results.push({ name: cleanName, seeders: 50, size: size, magnet: magnet, origin: "Brazuca" });
        }
      });
    }
    return results;
  } catch (err) { return []; }
}

// ==========================================================
// 🦖 FONTE 5: TORRENTIO (O GODZILLA MUNDIAL)
// ==========================================================
async function searchTorrentio(imdbId, tituloQuery) {
  if (!imdbId) return [];
  try {
    const url = `https://torrentio.strem.fun/stream/movie/${imdbId}.json`;
    // Timeout um pouco maior porque o Torrentio varre a internet inteira
    const { data } = await axios.get(url, { timeout: 10000 });
    let results = [];
    
    if (data && data.streams) {
      data.streams.forEach(s => {
        let rawTitle = s.title || "";
        let rawName = s.name || "Torrentio";
        
        // Extrai o provedor (ex: TorrentGalaxy, RARBG)
        let provider = rawName.split('\n')[0];

        // Tenta achar o número de seeders pelo ícone 👤
        let seedersMatch = rawTitle.match(/👤\s*(\d+)/);
        let seeders = seedersMatch ? parseInt(seedersMatch[1]) : 15;

        // Extrai o tamanho
        let sizeMatch = rawTitle.match(/\d+(?:\.\d+)?\s*(?:GB|MB)/i);
        let size = sizeMatch ? sizeMatch[0] : "N/A";

        // Extrai a qualidade para colocar no nome
        let qualMatch = rawTitle.match(/1080p|720p|4k|2160p/i);
        let quality = qualMatch ? qualMatch[0] : "HD";

        let cleanName = `${tituloQuery} ${quality} [Via ${provider}]`;

        let magnet = s.url;
        if (!magnet && s.infoHash) magnet = `magnet:?xt=urn:btih:${s.infoHash}${TRACKERS}`;

        if (magnet) {
            results.push({ 
                name: cleanName, 
                seeders: seeders, 
                size: size, 
                magnet: magnet, 
                origin: `Torrentio` 
            });
        }
      });
    }
    // Retorna os 5 melhores resultados do Torrentio para não afogar a sua tela
    return results.slice(0, 5);
  } catch (err) { return []; }
}

// ==========================================================
// 🚀 ROTA PRINCIPAL (AS 5 FONTES)
// ==========================================================
app.get("/streams", async (req, res) => {
  const query = req.query.q;
  const imdb = req.query.imdb;

  if (!query) return res.status(400).json({ error: "Informe um filme" });

  try {
    let res1337x = [];
    const tentativas = [`${query} dublado`, `${query} dual`, `${query}`];
    for (let t of tentativas) {
      const r = await search1337x(t);
      if (r.length > 0) { res1337x = r; break; }
    }

    // 🚀 LIGA TODOS OS MOTORES AO MESMO TEMPO
    const [resPirateBay, resYTS, resBrazuca, resTorrentio] = await Promise.all([
      searchPirateBay(query),
      searchYTS(query),
      searchBrazucaAddon(imdb, query),
      searchTorrentio(imdb, query) // O Godzilla foi ativado!
    ]);

    // Junta as 5 listas de torrents numa só
    let allResults = [...resBrazuca, ...resTorrentio, ...res1337x, ...resPirateBay, ...resYTS];
    let streams = [];

    for (let item of allResults) {
      let magnet = item.magnet;
      if (!magnet && item.detail) { magnet = await getMagnet1337x(item.detail); }
      if (!magnet) continue;

      streams.push({
        title: `[${item.origin}] ` + limparNome(item.name),
        quality: item.name.match(/1080p|720p|2160p|4k/i)?.[0] || "HD",
        seeders: item.seeders,
        size: item.size,
        magnet,
        br: scoreBR(item.name)
      });
    }

    // Ordenação Implacável: Brasil > Seeders
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
  console.log("🔥 API 5 MOTORES (INCLUINDO TORRENTIO) RODANDO!");
});
