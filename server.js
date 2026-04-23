const express = require("express");
const cors = require("cors");
const axios = require("axios");
const cheerio = require("cheerio");

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;

// ❌ REMOVE LIXO
const blacklist = [
  "apk","android","windows","linux","mac","crack","software",
  "game","setup","tool","plugin","x64","x86","iso","repack"
];

// ✅ INDICA FILME
const whitelist = [
  "1080p","720p","2160p","4k","bluray","webrip","web-dl","hdr","x264","x265"
];

// 🇧🇷 PRIORIDADE BR
const prioridadeBR = [
  "dublado","dual","pt-br","portuguese","latino"
];

// 🎬 limpa título
function limparNome(nome) {
  return nome
    .replace(/\./g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// 🔎 valida se parece filme
function ehFilme(nome) {
  nome = nome.toLowerCase();

  if (blacklist.some(b => nome.includes(b))) return false;
  if (!whitelist.some(w => nome.includes(w))) return false;

  return true;
}

// 🇧🇷 score BR
function scoreBR(nome) {
  nome = nome.toLowerCase();
  return prioridadeBR.some(p => nome.includes(p)) ? 1 : 0;
}

// 🔎 busca no 1337x
async function search1337x(query) {
  try {
    const url = `https://www.1377x.to/search/${encodeURIComponent(query)}/1/`;

    const { data } = await axios.get(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      timeout: 10000
    });

    const $ = cheerio.load(data);
    let results = [];

    $("table tbody tr").each((i, el) => {
      const name = $(el).find("td.name a:nth-child(2)").text();
      const link = $(el).find("td.name a:nth-child(2)").attr("href");
      const seeders = parseInt($(el).find("td.seeds").text()) || 0;
      const size = $(el).find("td.size").text();

      if (!name || !link) return;

      if (!ehFilme(name)) return;

      results.push({
        name,
        seeders,
        size,
        detail: "https://www.1377x.to" + link
      });
    });

    return results;

  } catch (err) {
    console.log("Erro busca:", err.message);
    return [];
  }
}

// 🔗 magnet
async function getMagnet(url) {
  try {
    const { data } = await axios.get(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      timeout: 8000
    });

    const $ = cheerio.load(data);
    return $('a[href^="magnet:?xt="]').attr("href") || null;

  } catch {
    return null;
  }
}

// 🎬 rota principal
app.get("/streams", async (req, res) => {
  const query = req.query.q;

  if (!query) {
    return res.status(400).json({ error: "Informe um filme" });
  }

  try {

    // 🔥 buscas inteligentes
    const tentativas = [
      `${query} dublado 1080p`,
      `${query} dual audio 1080p`,
      `${query} portuguese 1080p`,
      `${query} 1080p bluray`,
      `${query} movie 1080p`
    ];

    let results = [];

    for (let t of tentativas) {
      const r = await search1337x(t);
      if (r.length > 0) {
        results = r;
        break;
      }
    }

    results = results.slice(0, 15);

    let streams = [];

    for (let item of results) {
      const magnet = await getMagnet(item.detail);

      if (!magnet) continue;

      streams.push({
        title: limparNome(item.name),
        quality: item.name.match(/1080p|720p|2160p|4k/i)?.[0] || "HD",
        seeders: item.seeders,
        size: item.size,
        magnet,
        br: scoreBR(item.name)
      });
    }

    // 🔥 ordenação estilo Torrentio
    streams.sort((a, b) => {
      if (a.br !== b.br) return b.br - a.br;
      return b.seeders - a.seeders;
    });

    // ⚠️ fallback se vazio
    if (streams.length === 0) {
      return res.json({
        query,
        total: 0,
        streams: [],
        message: "Nenhum resultado relevante encontrado"
      });
    }

    res.json({
      query,
      total: streams.length,
      streams
    });

  } catch (err) {
    res.status(500).json({ error: "Erro geral" });
  }
});

app.listen(PORT, () => {
  console.log("🔥 API TORRENT MASTER rodando...");
});
