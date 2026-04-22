const express = require("express");
const cors = require("cors");
const axios = require("axios");
const cheerio = require("cheerio");

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;

// 🔎 buscar torrents
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
      const seeders = parseInt($(el).find("td.seeds").text()) || 0;
      const size = $(el).find("td.size").text();

      if (name && link) {
        results.push({
          name,
          seeders,
          size,
          detail: "https://www.1377x.to" + link
        });
      }
    });

    return results;
  } catch {
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

// 🎬 rota principal
app.get("/streams", async (req, res) => {
  const query = req.query.q;

  if (!query) {
    return res.status(400).json({ error: "Informe um filme" });
  }

  try {
    let results = await search1337x(query);
    results = results.slice(0, 10);

    let streams = [];

    for (let item of results) {
      const magnet = await getMagnet(item.detail);

      if (magnet) {
        streams.push({
          title: item.name,
          quality: item.name.match(/1080p|720p|4K|2160p/i)?.[0] || "HD",
          seeders: item.seeders,
          size: item.size,
          magnet
        });
      }
    }

    streams.sort((a, b) => b.seeders - a.seeders);

    res.json({
      query,
      total: streams.length,
      streams
    });

  } catch {
    res.status(500).json({ error: "Erro ao buscar" });
  }
});

app.listen(PORT, () => {
  console.log("API rodando...");
});
