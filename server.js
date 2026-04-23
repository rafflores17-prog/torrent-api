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

const FAKE_BROWSER = { 
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36" 
};

// 🚫 BLACKLIST PESADA (ANTI LIXO REAL)
const blacklist = [
  "apk","android","windows","linux","mac","crack","software",
  "game","setup","tool","plugin","iso","repack","camrip","ts",
  "adobe","photoshop","office","driver","update","x64","x86"
];

function limparNome(nome) {
  return nome.replace(/\./g, " ").replace(/\s+/g, " ").trim();
}

function ehFilme(nome) {
  nome = nome.toLowerCase();

  if (blacklist.some(b => nome.includes(b))) return false;

  // precisa ter ano OU qualidade OU nome válido
  const temQualidade = /1080p|720p|2160p|4k/i.test(nome);
  const temAno = /(19|20)\d{2}/.test(nome);

  return temQualidade || temAno;
}

function scoreBR(nome) {
  nome = nome.toLowerCase();
  return ["dublado","dual","pt-br","portuguese"].some(p => nome.includes(p)) ? 1 : 0;
}

// ==========================================================
// 🏴‍☠️ PIRATE BAY (COM ANO)
// ==========================================================
async function searchPirateBay(query) {
  if (!query) return [];
  try {
    const url = `https://apibay.org/q.php?q=${encodeURIComponent(query)}`;
    const { data } = await axios.get(url, { timeout: 6000 });

    if (!data || data[0].id === '0') return [];

    let results = [];

    data.forEach(t => {
      if (t.category.startsWith('2') && ehFilme(t.name)) {

        const magnet = `magnet:?xt=urn:btih:${t.info_hash}&dn=${encodeURIComponent(t.name)}${TRACKERS}`;

        let size = (parseInt(t.size) > 1073741824)
          ? (parseInt(t.size) / 1073741824).toFixed(2) + " GB"
          : (parseInt(t.size) / 1048576).toFixed(2) + " MB";

        results.push({
          name: t.name,
          seeders: parseInt(t.seeders),
          size,
          magnet,
          origin: "PirateBay"
        });
      }
    });

    return results.slice(0, 5);

  } catch {
    return [];
  }
}

// ==========================================================
// 🕷️ 1337X (MELHORADO)
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

      if (!name || !link) return;

      if (!ehFilme(name)) return;

      results.push({
        name,
        seeders,
        detail: "https://www.1377x.to" + link,
        origin: "1337x"
      });
    });

    return results.slice(0, 4);

  } catch {
    return [];
  }
}

async function getMagnet1337x(url) {
  try {
    const { data } = await axios.get(url, { headers: FAKE_BROWSER, timeout: 5000 });
    return cheerio.load(data)('a[href^="magnet:?xt="]').attr("href") || null;
  } catch {
    return null;
  }
}

// ==========================================================
// 🇧🇷 BRAZUCA
// ==========================================================
async function searchBrazuca(imdbId, tituloBR) {
  if (!imdbId) return [];

  try {
    const { data } = await axios.get(
      `https://94c8cb9f702d-brazuca-torrents.baby-beamup.club/stream/movie/${imdbId}.json`,
      { headers: FAKE_BROWSER, timeout: 10000 }
    );

    let results = [];

    if (data?.streams) {
      data.streams.forEach(s => {
        let raw = s.title || "";

        let sizeMatch = raw.match(/\d+(?:\.\d+)?\s*(GB|MB)/i);
        let size = sizeMatch ? sizeMatch[0] : "N/A";

        let magnet = s.url || (s.infoHash
          ? `magnet:?xt=urn:btih:${s.infoHash}${TRACKERS}`
          : null
        );

        if (magnet) {
          results.push({
            name: `${tituloBR} ${raw}`,
            seeders: 80,
            size,
            magnet,
            origin: "Brazuca"
          });
        }
      });
    }

    return results.slice(0, 8);

  } catch {
    return [];
  }
}

// ==========================================================
// 🦖 TORRENTIO
// ==========================================================
async function searchTorrentio(imdbId, tituloBR) {
  if (!imdbId) return [];

  try {
    const config = "providers=yts,eztv,rarbg,1337x,thepiratebay,kickasstorrents,torrentgalaxy,magnetdl,comando,micoleaodublado|language=portuguese";

    const url = `https://torrentio.strem.fun/${config}/stream/movie/${imdbId}.json`;

    const { data } = await axios.get(url, { headers: FAKE_BROWSER, timeout: 12000 });

    let results = [];

    if (data?.streams) {
      data.streams.forEach(s => {

        let raw = s.title || "";
        let provider = (s.name || "Torrentio").split('\n')[0];

        let seeders = parseInt(raw.match(/👤\s*(\d+)/)?.[1] || 30);

        let sizeMatch = raw.match(/\d+(?:\.\d+)?\s*(GB|MB)/i);
        let size = sizeMatch ? sizeMatch[0] : "N/A";

        let quality = raw.match(/1080p|720p|2160p|4k/i)?.[0] || "SD";

        let magnet = s.url || (s.infoHash
          ? `magnet:?xt=urn:btih:${s.infoHash}${TRACKERS}`
          : null
        );

        if (magnet) {
          results.push({
            name: `${tituloBR} ${quality} [${provider}]`,
            seeders,
            size,
            magnet,
            origin: "Torrentio"
          });
        }
      });
    }

    return results.slice(0, 10);

  } catch {
    return [];
  }
}

// ==========================================================
// 🚀 ROTA PRINCIPAL (INTELIGENTE)
// ==========================================================
app.get("/streams", async (req, res) => {
  const titulo_br = req.query.br || "";
  const titulo_orig = req.query.orig || titulo_br;
  const imdb = req.query.imdb || "";
  const year = req.query.year || "";

  if (!titulo_br) {
    return res.status(400).json({ error: "Informe um filme" });
  }

  const query = `${titulo_orig} ${year}`.trim();

  try {
    const [brazuca, torrentio, piratebay, x1337] = await Promise.all([
      searchBrazuca(imdb, titulo_br),
      searchTorrentio(imdb, titulo_br),
      searchPirateBay(query),
      search1337x(query)
    ]);

    let all = [...brazuca, ...torrentio, ...piratebay, ...x1337];

    let streams = [];

    for (let item of all) {
      let magnet = item.magnet;

      if (!magnet && item.detail) {
        magnet = await getMagnet1337x(item.detail);
      }

      if (!magnet) continue;

      let nome = limparNome(item.name.toLowerCase());

      if (!ehFilme(nome)) continue;

      let isBR =
        item.origin === "Brazuca" ||
        nome.includes("dublado") ||
        nome.includes("dual");

      let score = 0;

      if (item.origin === "Brazuca") score += 100;
      else if (item.origin === "Torrentio") score += 80;

      if (isBR) score += 20;

      score += item.seeders || 0;

      streams.push({
        title: `[${item.origin}] ${item.name}`,
        quality: item.name.match(/1080p|720p|2160p|4k/i)?.[0] || "SD",
        seeders: item.seeders || 0,
        size: item.size || "N/A",
        magnet,
        br: isBR ? 1 : 0,
        score
      });
    }

    // remove duplicados
    const seen = new Set();
    const unique = streams.filter(s => {
      if (seen.has(s.magnet)) return false;
      seen.add(s.magnet);
      return true;
    });

    // 🔥 ORDENA INTELIGENTE
    unique.sort((a, b) => b.score - a.score);

    res.json({
      query: titulo_br,
      total: unique.length,
      streams: unique.slice(0, 20)
    });

  } catch (err) {
    res.status(500).json({ error: "Erro geral" });
  }
});

app.listen(PORT, () => {
  console.log("🔥 API PRO ANTILIXO RODANDO!");
});
