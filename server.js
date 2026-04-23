const express = require("express");
const cors = require("cors");
const axios = require("axios");
const cheerio = require("cheerio");

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;

// 🎯 filtro inteligente (remove lixo)
function isValidMovie(name) {
  const blacklist = [
    "x64", "crack", "apk", "setup", "windows", "linux",
    "macos", "game", "android", "software", "app"
  ];

  const lower = name.toLowerCase();

  // bloqueia lixo
  if (blacklist.some(b => lower.includes(b))) return false;

  // precisa ter qualidade de vídeo
  if (!/(720p|1080p|2160p|4k)/i.test(name)) return false;

  return true;
}

// 🔎 buscar torrents (AGORA FILTRADO POR FILMES)
async function search1337x(query) {
  try {
    const url = `https://www.1377x.to/category-search/${encodeURIComponent(query)}/Movies/1/`;

    const { data } = await axios.get(url, {
      headers: { "User-Agent": "Mozilla/5.0" }
    });

    const $ = cheerio.load(data);
    let results = [];

    $("table tbody tr").each((i, el) => {
      const name = $(el).find("td.name a:nth-child(2)").text();
      const link = $(el).find("td.name a:nth-child(2)").attr("href");
      const seeders = parseInt($(el).find("td.seeds").text()) || 0;
      const size = $(el).find("td.size").text();

      if (name && link && isValidMovie(name)) {
        results.push({
          name,
          seeders,
          size,
          detail: "https://www.1377x.to" + link
        });
      }
    });

    return results;
  } catch (err) {
    console.log("Erro busca:", err.message);
    return [];
  }
}

// 🔗 pegar magnet
async function getMagnet(url) {
  try {
    const { data } = await axios.get(url, {
      headers: { "User-Agent": "Mozilla/5.0" }
    });

    const $ = cheerio.load(data);
    return $('a[href^="magnet:?xt="]').attr("href") || null;
  } catch {
    return null;
  }
}

// 🎬 rota principal estilo Torrentio
app.get("/streams", async (req, res) => {
  const query = req.query.q;

  if (!query) {
    return res.status(400).json({ error: "Informe um filme" });
  }

  try {
    // 🔥 tenta dublado primeiro
    let results = await search1337x(query + " dublado");

    // fallback
    if (results.length === 0) {
      results = await search1337x(query + " 1080p");
    }

    results = results.slice(0, 8);

    let streams = [];

    for (let item of results) {
      const magnet = await getMagnet(item.detail);

      if (magnet) {
        streams.push({
          title: item.name,
          quality: item.name.match(/2160p|4K|1080p|720p/i)?.[0] || "HD",
          seeders: item.seeders,
          size: item.size,
          magnet
        });
      }
    }

    // 🔥 ordena por seeders (melhores primeiro)
    streams.sort((a, b) => b.seeders - a.seeders);

    res.json({
      query,
      total: streams.length,
      streams
    });

  } catch (err) {
    console.log("Erro geral:", err.message);
    res.status(500).json({ error: "Erro ao buscar torrents" });
  }
});

app.listen(PORT, () => {
  console.log("🚀 API Torrent rodando...");
});
