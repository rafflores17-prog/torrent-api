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
// 🇧🇷 FONTE 4: ADDON BRAZUCA DO STREMIO (SUA DESCOBERTA!)
// ==========================================================
async function searchBrazucaAddon(imdbId, tituloQuery) {
  if (!imdbId) return [];
  try {
    // O pulo do gato: Acessamos o Stremio deles usando o ID do IMDB!
    const url = `https://94c8cb9f702d-brazuca-torrents.baby-beamup.club/stream/movie/${imdbId}.json`;
    const { data } = await axios.get(url, { timeout: 8000 });
    let results = [];
    
    if (data && data.streams) {
      data.streams.forEach(s => {
        // O Stremio manda o nome cheio de quebras de linha (\n)
        let rawTitle = s.title || "";
        
        // Extrai o tamanho se houver
        let sizeMatch = rawTitle.match(/\d+(?:\.\d+)?\s*(?:GB|MB)/i);
        let size = sizeMatch ? sizeMatch[0] : "N/A";
        
        // Monta o nome para ficar bonito
        let cleanName = `${tituloQuery} ${rawTitle.replace(/\n/g, ' ')} Dublado Dual`;
        
        let magnet = s.url;
        if (!magnet && s.infoHash) {
            magnet = `magnet:?xt=urn:btih:${s.infoHash}${TRACKERS}`;
        }

        if (magnet) {
            results.push({ 
                name: cleanName, 
                seeders: 50, // Stremio não manda seeders exatos, fixamos 50
                size: size, 
                magnet: magnet, 
                origin: "Brazuca" 
            });
        }
      });
    }
    return results;
  } catch (err) { return []; }
}

app.get("/streams", async (req, res) => {
  const query = req.query.q;
  const imdb = req.query.imdb; // AGORA RECEBE O ID DO IMDB!

  if (!query) return res.status(400).json({ error: "Informe um filme" });

  try {
    let res1337x = [];
    const tentativas = [`${query} dublado`, `${query} dual`, `${query}`];
    for (let t of tentativas) {
      const r = await search1337x(t);
      if (r.length > 0) { res1337x = r; break; }
    }

    // 🚀 O MEGAZORD AGORA TEM 4 PERNAS (Busca tudo ao mesmo tempo)
    const [resPirateBay, resYTS, resBrazuca] = await Promise.all([
      searchPirateBay(query),
      searchYTS(query),
      searchBrazucaAddon(imdb, query) // Chama a sua descoberta!
    ]);

    let allResults = [...resBrazuca, ...res1337x, ...resPirateBay, ...resYTS];
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
  console.log("🔥 API MEGAZORD + BRAZUCA rodando!");
});
