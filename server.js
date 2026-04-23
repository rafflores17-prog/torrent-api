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
  "game","setup","tool","plugin","x64","x86","iso","repack", "camrip", "ts"
];

// ✅ INDICA FILME
const whitelist = [
  "1080p","720p","2160p","4k","bluray","webrip","web-dl","hdr","x264","x265"
];

// 🇧🇷 PRIORIDADE BR
const prioridadeBR = [
  "dublado","dual","pt-br","portuguese"
];

function limparNome(nome) {
  return nome.replace(/\./g, " ").replace(/\s+/g, " ").trim();
}

function ehFilme(nome) {
  nome = nome.toLowerCase();
  if (blacklist.some(b => nome.includes(b))) return false;
  if (!whitelist.some(w => nome.includes(w))) return false;
  return true;
}

function scoreBR(nome) {
  nome = nome.toLowerCase();
  return prioridadeBR.some(p => nome.includes(p)) ? 1 : 0;
}

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
      
      // 🔥 Conserta o bug do tamanho pegando lixo
      let rawSize = $(el).find("td.size").text();
      let size = "N/A";
      if (rawSize.includes("GB")) size = rawSize.split("GB")[0] + " GB";
      else if (rawSize.includes("MB")) size = rawSize.split("MB")[0] + " MB";

      if (!name || !link) return;
      if (!ehFilme(name)) return;

      results.push({ name, seeders, size, detail: "https://www.1377x.to" + link });
    });

    return results;
  } catch (err) {
    return [];
  }
}

async function getMagnet(url) {
  try {
    const { data } = await axios.get(url, { headers: { "User-Agent": "Mozilla/5.0" }, timeout: 8000 });
    const $ = cheerio.load(data);
    return $('a[href^="magnet:?xt="]').attr("href") || null;
  } catch {
    return null;
  }
}

app.get("/streams", async (req, res) => {
  const query = req.query.q;
  if (!query) return res.status(400).json({ error: "Informe um filme" });

  try {
    // 🔥 BUSCAS INTELIGENTES (Removi o 'movie' em inglês para não vir espanhol)
    const tentativas = [
      `${query} dublado`,
      `${query} dual`,
      `${query} pt-br`,
      `${query} 1080p`,
      `${query}` // Se não achar nada, tenta só o nome limpo
    ];

    let results = [];
    for (let t of tentativas) {
      const r = await search1337x(t);
      if (r.length > 0) {
        results = r;
        break; // Achou? Para de pesquisar para ser rápido!
      }
    }

    results = results.slice(0, 10); // Pega só os 10 primeiros para não travar
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
  console.log("🔥 API TORRENT MASTER rodando...");
});
