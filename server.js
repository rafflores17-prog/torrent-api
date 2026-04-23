const express = require("express");
const cors = require("cors");
const axios = require("axios");

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
// 🏴‍☠️ FONTE 1: THE PIRATE BAY (Usa o Título Original!)
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
// 🍿 FONTE 2: YTS API (Usa o Título Original!)
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
        const name = `${movie.title} ${t.quality} ${t.type} YTS`;
        const magnet = `magnet:?xt=urn:btih:${t.hash}&dn=${encodeURIComponent(movie.title)}${TRACKERS}`;
        results.push({ name, seeders: t.seeds, size: t.size, magnet, origin: "YTS" });
      });
    });
    return results;
  } catch (err) { return []; }
}

// ==========================================================
// 🇧🇷 FONTE 3: BRAZUCA (Usa o IMDB!)
// ==========================================================
async function searchBrazucaAddon(imdbId, tituloBR) {
  if (!imdbId || imdbId === "None" || imdbId === "") return [];
  try {
    const url = `https://94c8cb9f702d-brazuca-torrents.baby-beamup.club/stream/movie/${imdbId}.json`;
    const { data } = await axios.get(url, { timeout: 8000 });
    let results = [];
    if (data && data.streams) {
      data.streams.forEach(s => {
        let rawTitle = s.title || "";
        let sizeMatch = rawTitle.match(/\d+(?:\.\d+)?\s*(?:GB|MB)/i);
        let size = sizeMatch ? sizeMatch[0] : "N/A";
        let cleanName = `${tituloBR} ${rawTitle.replace(/\n/g, ' ')} Dublado Dual`;
        let magnet = s.url;
        if (!magnet && s.infoHash) magnet = `magnet:?xt=urn:btih:${s.infoHash}${TRACKERS}`;
        if (magnet) results.push({ name: cleanName, seeders: 50, size: size, magnet: magnet, origin: "Brazuca" });
      });
    }
    return results;
  } catch (err) { return []; }
}

// ==========================================================
// 🦖 FONTE 4: TORRENTIO (Usa o IMDB!)
// ==========================================================
async function searchTorrentio(imdbId, tituloBR) {
  if (!imdbId || imdbId === "None" || imdbId === "") return [];
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
        // Usa o nome BR para ficar bonito na tela!
        let cleanName = `${tituloBR} ${quality} [Via ${provider}]`;
        let magnet = s.url;
        if (!magnet && s.infoHash) magnet = `magnet:?xt=urn:btih:${s.infoHash}${TRACKERS}`;
        if (magnet) results.push({ name: cleanName, seeders: seeders, size: size, magnet: magnet, origin: `Torrentio` });
      });
    }
    return results.slice(0, 6);
  } catch (err) { return []; }
}

// ==========================================================
// 🚀 ROTA PRINCIPAL UNIVERSAL
// ==========================================================
app.get("/streams", async (req, res) => {
  const titulo_br = req.query.br || "";
  const titulo_orig = req.query.orig || titulo_br;
  const imdb = req.query.imdb || "";

  if (!titulo_br) return res.status(400).json({ error: "Informe um filme" });

  // Limpa caracteres especiais do titulo original para não quebrar o PirateBay
  const safeOrig = titulo_orig.replace(/[^\w\s-]/gi, '').replace(/\s+/g, ' ').trim();

  try {
    // 🚀 LIGA TODOS OS 4 MOTORES (SEM O 1337x QUE TRAVAVA TUDO)
    const [resPirateBay, resYTS, resBrazuca, resTorrentio] = await Promise.all([
      searchPirateBay(safeOrig), // Manda o Inglês
      searchYTS(safeOrig),       // Manda o Inglês
      searchBrazucaAddon(imdb, titulo_br), // Manda o IMDB e o BR
      searchTorrentio(imdb, titulo_br)     // Manda o IMDB e o BR
    ]);

    let allResults = [...resBrazuca, ...resTorrentio, ...resPirateBay, ...resYTS];
    let streams = [];

    for (let item of allResults) {
      if (!item.magnet) continue;
      streams.push({
        title: `[${item.origin}] ` + limparNome(item.name),
        quality: item.name.match(/1080p|720p|2160p|4k/i)?.[0] || "SD",
        seeders: item.seeders,
        size: item.size,
        magnet: item.magnet,
        br: scoreBR(item.name)
      });
    }

    streams.sort((a, b) => {
      if (a.br !== b.br) return b.br - a.br;
      return b.seeders - a.seeders;
    });

    res.json({ query: titulo_br, total: streams.length, streams });
  } catch (err) {
    res.status(500).json({ error: "Erro geral" });
  }
});

app.listen(PORT, () => {
  console.log("🔥 API UNIVERSAL BILÍNGUE (SEM 1337X) RODANDO!");
});
