/**
 * Test runner locale per extractor.js (Node.js 18+)
 *
 * Uso:
 *   node test-module.js "inception"          -> test LIVE (TMDB + vixsrc veri): search, details, episodes, stream
 *   node test-module.js "big bang theory"    -> serie TV: controlla anche stagioni e server dei segmenti
 *   node test-module.js --mock               -> test OFFLINE con risposte finte (non tocca internet)
 *
 * extractor.js viene caricato in un contesto isolato, come fa Shirox con JavaScriptCore.
 * fetchv2 non esiste in Node: soraFetch usa automaticamente fetch come fallback.
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const EXTRACTOR_PATH = process.env.EXTRACTOR || path.join(__dirname, "extractor.js");

function loadExtractor(fetchImpl) {
  const context = vm.createContext({
    fetch: fetchImpl,
    console,
    setTimeout,
    clearTimeout,
    atob,
  });
  vm.runInContext(fs.readFileSync(EXTRACTOR_PATH, "utf8"), context, { filename: "extractor.js" });
  return context;
}

let failures = 0;
function check(label, condition, detail = "") {
  console.log(`${condition ? "✅" : "❌"} ${label}${detail ? "  ->  " + detail : ""}`);
  if (!condition) failures++;
}

// ==========================================
// TEST LIVE
// ==========================================
async function runLive(keyword) {
  const ex = loadExtractor(fetch);
  console.log(`\n🔎 Test LIVE con "${keyword}"\n`);

  let t0 = Date.now();
  const results = JSON.parse(await ex.searchResults(keyword));
  check("search", results.length > 0, `${results.length} risultati in ${Date.now() - t0} ms`);
  if (results.length === 0) return;
  const first = results[0];
  console.log(`   primo risultato: ${first.title}\n   ${first.href}`);

  const details = JSON.parse(await ex.extractDetails(first.href));
  check("details", details.length === 1 && details[0].description !== "N/A",
    details[0] ? details[0].description.slice(0, 80) + "..." : "vuoto");

  t0 = Date.now();
  const episodes = JSON.parse(await ex.extractEpisodes(first.href));
  check("episodes", episodes.length > 0, `${episodes.length} episodi in ${Date.now() - t0} ms`);
  if (episodes.length === 0) return;

  // Ricostruisce le stagioni come fa detectSeasons di Shirox
  const seasons = [[episodes[0]]];
  for (let i = 1; i < episodes.length; i++) {
    if (episodes[i].number <= episodes[i - 1].number) seasons.push([]);
    seasons[seasons.length - 1].push(episodes[i]);
  }
  console.log(`   stagioni viste da Shirox: ${seasons.length} -> [${seasons.map((s) => s.length).join(", ")}] episodi`);

  t0 = Date.now();
  const raw = await ex.extractStreamUrl(episodes[0].href);
  const streams = raw ? JSON.parse(raw).streams || [] : [];
  check("stream", streams.length > 0, `${streams.map((s) => s.title).join(" + ") || "null"} in ${Date.now() - t0} ms`);

  for (const stream of streams) {
    const master = await fetch(stream.streamUrl);
    const text = await master.text();
    const audio = text.split("\n").filter((l) => /TYPE=AUDIO/.test(l))
      .map((l) => (l.match(/LANGUAGE="([^"]+)"/) || [])[1] + (/DEFAULT=YES/.test(l) ? "*" : ""));
    const heights = (text.match(/RESOLUTION=\d+x(\d+)/g) || []).map((r) => r.split("x")[1]);
    check(`stream "${stream.title}": master risponde`, master.status === 200,
      `audio ${audio.join(" ")} | qualità ${heights.join(",")}${stream.details ? " | " + stream.details : ""}`);

    const variant = text.split("\n").find((l) => /type=video/.test(l));
    if (variant) {
      const segments = await (await fetch(variant.trim())).text();
      const host = (segments.match(/^https:\/\/([^/]+)/m) || [])[1] || "?";
      console.log(`   server segmenti: ${host}${/vix-content\.net/.test(host) ? "  ⚠️ server lento" : ""}`);
    }
  }
  if (streams.length === 2) {
    const [it, orig] = streams;
    check("italiano e originale hanno audio predefinito diverso", it.streamUrl.endsWith("lang=it") && orig.streamUrl.endsWith("lang=en"));
  }
}

// ==========================================
// TEST OFFLINE (MOCK)
// ==========================================
const KEY = "a51fd07a4cee53e5449b2410581a8f63";
const FUTURE = "2999-01-01";

function json(body, status = 200) {
  return { status, text: async () => JSON.stringify(body) };
}
function html(body, status = 200) {
  return { status, text: async () => body };
}

function seasonOf(n, count, futureLast = false) {
  return {
    episodes: Array.from({ length: count }, (_, i) => ({
      episode_number: i + 1,
      air_date: futureLast && i === count - 1 ? FUTURE : "2010-01-01",
    })),
  };
}

function embedPage(videoId) {
  return `<script>var tracker = { url: 'https://pubblicita.example/track' };</script>
<script>
  window.video = { id: ${videoId} };
  window.masterPlaylist = {
    params: {
      'token': 'TOK${videoId}',
      'expires': '1999999999',
      'asn': '',
    },
    url: 'https://vixsrc.to/playlist/${videoId}',
  }
  window.canPlayFHD = true
</script>
<script>var other = { 'token': 'SBAGLIATO', url: 'https://pubblicita.example/after' };</script>`;
}

function masterOf(languages) {
  return ["#EXTM3U",
    ...languages.map((l, i) => `#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="${l}",DEFAULT=${i === 0 ? "YES" : "NO"},LANGUAGE="${l}",URI="https://vixsrc.to/playlist/x?type=audio&rendition=${l}"`),
    '#EXT-X-STREAM-INF:BANDWIDTH=4500000,RESOLUTION=1920x1080,AUDIO="audio"',
    "https://vixsrc.to/playlist/x?type=video&rendition=1080p"].join("\n");
}

// Titoli finti:
//   movie/1  originale inglese, audio ita+eng, trama italiana vuota (-> inglese)
//   movie/2  originale giapponese, solo audio jpn
//   tv/10    originale italiano, audio ita+eng, stagioni 0/1/2 (ultimo ep. S2 non ancora uscito)
//   tv/11    non presente nel catalogo vixsrc
//   tv/25    22 stagioni da 1 episodio (serve una seconda richiesta TMDB)
const VIDEO = { "movie/1": 500, "movie/2": 502, "tv/10/1/1": 510, "tv/25/1/1": 525 };
const AUDIO = { 500: ["ita", "eng"], 502: ["jpn"], 510: ["ita", "eng"], 525: ["ita", "kor"] };

function makeMockFetch(stats) {
  return async (url) => {
    stats.requests.push(url);
    const u = new URL(url);

    if (u.host === "api.themoviedb.org") {
      if (u.searchParams.get("api_key") !== KEY) return json({ status_message: "Invalid API key" }, 401);
      const p = u.pathname.replace("/3", "");
      const append = (u.searchParams.get("append_to_response") || "").split(",").filter(Boolean);
      if (p === "/search/multi") {
        if (u.searchParams.get("page") === "2") {
          return json({ results: [{ id: 1, media_type: "movie", title: "Film Uno", poster_path: "/p1.jpg" }] });
        }
        return json({ results: [
          { id: 1, media_type: "movie", title: "Film Uno", poster_path: "/p1.jpg" },
          { id: 10, media_type: "tv", name: "L&#039;amica geniale", poster_path: "/p10.jpg" },
          { id: 11, media_type: "tv", name: "Serie Assente", poster_path: "/p11.jpg" },
          { id: 12, media_type: "movie", title: "Senza Locandina", poster_path: null },
          { id: 99, media_type: "person", name: "Un Attore", profile_path: "/a.jpg" },
        ] });
      }
      if (p === "/movie/1") {
        const english = u.searchParams.get("language") === "en-US";
        return json({ id: 1, overview: english ? "English plot" : "", original_title: "Movie One", original_language: "en", release_date: "2010-07-15" });
      }
      if (p === "/movie/2") return json({ id: 2, overview: "Trama", original_title: "Eiga", original_language: "ja" });
      if (p === "/tv/10") {
        const all = { 0: seasonOf(0, 2), 1: seasonOf(1, 3), 2: seasonOf(2, 2, true) };
        const body = { id: 10, overview: "Trama serie", original_name: "L'amica geniale", original_language: "it",
          first_air_date: "2018-11-18", seasons: [0, 1, 2].map((n) => ({ season_number: n })) };
        for (const a of append) { const n = a.split("/")[1]; if (all[n]) body[a] = all[n]; }
        return json(body);
      }
      if (p === "/tv/25") {
        const body = { id: 25, overview: "Lunga", original_name: "Long", original_language: "ko",
          seasons: Array.from({ length: 22 }, (_, i) => ({ season_number: i + 1 })) };
        for (const a of append) { const n = Number(a.split("/")[1]); if (n >= 1 && n <= 22) body[a] = seasonOf(n, 1); }
        return json(body);
      }
      return json({ status_message: "not found" }, 404);
    }

    if (u.host === "vixsrc.to") {
      if (u.pathname === "/api/list/movie/") return json([{ tmdb_id: 1 }, { tmdb_id: 2 }]);
      if (u.pathname === "/api/list/tv/") return json([{ tmdb_id: 10 }, { tmdb_id: 25 }]);
      if (u.pathname.startsWith("/api/")) {
        const id = VIDEO[u.pathname.replace("/api/", "")];
        return id ? json({ src: `/embed/${id}?token=e${id}&expires=1&lang=it` }) : html("<!DOCTYPE html><title>Not Found</title>", 404);
      }
      const embed = u.pathname.match(/^\/embed\/(\d+)$/);
      if (embed) return html(embedPage(embed[1]));
      const playlist = u.pathname.match(/^\/playlist\/(\d+)$/);
      if (playlist) return html(masterOf(AUDIO[playlist[1]] || []));
    }
    return html("", 404);
  };
}

async function runMock() {
  console.log("\n🧪 Test OFFLINE (mock)\n");

  const ex0 = loadExtractor(async () => null);
  check("chiave TMDB decodificata", ex0.tmdbKey() === KEY);
  check("parseHref episodio", JSON.stringify(ex0.parseHref("https://vixsrc.to/tv/1418/5/13")) ===
    JSON.stringify({ type: "tv", id: "1418", season: 5, episode: 13 }));

  // Ricerca
  let stats = { requests: [] };
  let ex = loadExtractor(makeMockFetch(stats));
  const results = JSON.parse(await ex.searchResults("prova"));
  const titles = results.map((r) => r.title);
  check("search: solo titoli nel catalogo vixsrc, senza persone/locandine mancanti",
    JSON.stringify(titles) === JSON.stringify(["Film Uno", "L'amica geniale"]), titles.join(" | "));
  check("search: href stabili", results[1] && results[1].href === "https://vixsrc.to/tv/10");
  await ex.searchResults("altra");
  const listRequests = stats.requests.filter((r) => r.includes("/api/list/")).length;
  check("catalogo scaricato una sola volta", listRequests === 2, `${listRequests} richieste`);

  // Dettagli + episodi in contemporanea: una sola richiesta TMDB per la serie
  stats = { requests: [] };
  ex = loadExtractor(makeMockFetch(stats));
  const [detailsJson, episodesJson] = await Promise.all([
    ex.extractDetails("https://vixsrc.to/tv/10"),
    ex.extractEpisodes("https://vixsrc.to/tv/10"),
  ]);
  const details = JSON.parse(detailsJson);
  const episodes = JSON.parse(episodesJson);
  const tvRequests = stats.requests.filter((r) => r.includes("/3/tv/10")).length;
  check("cache: scheda serie scaricata una sola volta", tvRequests === 1, `${tvRequests} richieste`);
  check("details serie", details[0] && details[0].description === "Trama serie" && details[0].airdate === "2018-11-18");
  check("episodes: niente stagione 0, niente episodi futuri, ordine S1..Sn",
    JSON.stringify(episodes.map((e) => e.href.replace("https://vixsrc.to/tv/10/", ""))) === JSON.stringify(["1/1", "1/2", "1/3", "2/1"]),
    episodes.map((e) => e.href.split("/tv/10/")[1]).join(" "));

  const movieDetails = JSON.parse(await ex.extractDetails("https://vixsrc.to/movie/1"));
  check("details film: trama inglese se manca l'italiana", movieDetails[0] && movieDetails[0].description === "English plot");
  const movieEpisodes = JSON.parse(await ex.extractEpisodes("https://vixsrc.to/movie/1"));
  check("episodes film: un solo elemento", movieEpisodes.length === 1 && movieEpisodes[0].href === "https://vixsrc.to/movie/1");

  // Serie con più di 20 stagioni
  stats = { requests: [] };
  ex = loadExtractor(makeMockFetch(stats));
  const long = JSON.parse(await ex.extractEpisodes("https://vixsrc.to/tv/25"));
  const longRequests = stats.requests.filter((r) => r.includes("/3/tv/25")).length;
  check("22 stagioni: tutte presenti con 2 richieste", long.length === 22 && longRequests === 2,
    `${long.length} episodi, ${longRequests} richieste`);

  // Stream
  const streamsOf = async (href) => {
    const raw = await ex.extractStreamUrl(href);
    return raw ? JSON.parse(raw).streams : null;
  };
  let s = await streamsOf("https://vixsrc.to/movie/1");
  check("stream film inglese: Italiano + Originale", s && s.map((x) => x.title).join("+") === "Italiano+Originale");
  check("stream: URL dal blocco masterPlaylist con h=1 e lang",
    s && s[0].streamUrl === "https://vixsrc.to/playlist/500?token=TOK500&expires=1999999999&h=1&lang=it" &&
    s[1].streamUrl.endsWith("&h=1&lang=en"), s && s[0].streamUrl);
  check("stream: Originale indica la lingua", s && /Inglese/.test(s[1].details || ""), s && s[1].details);
  check("stream: nessun header (AirPlay diretto)", s && s.every((x) => Object.keys(x.headers).length === 0));

  s = await streamsOf("https://vixsrc.to/tv/10/1/1");
  check("serie italiana: solo Italiano", s && s.map((x) => x.title).join("+") === "Italiano");

  s = await streamsOf("https://vixsrc.to/movie/2");
  check("solo audio giapponese: solo Originale", s && s.map((x) => x.title).join("+") === "Originale" && /Giapponese/.test(s[0].details));

  check("titolo non disponibile su vixsrc -> null", (await ex.extractStreamUrl("https://vixsrc.to/tv/11/1/1")) === null);
  check("href serie senza episodio -> null", (await ex.extractStreamUrl("https://vixsrc.to/tv/10")) === null);

  // Retry: errori temporanei prima della risposta buona
  const flaky = (failures) => {
    const calls = {};
    const base = makeMockFetch({ requests: [] });
    const fetchImpl = async (url, options) => {
      const key = url.split("?")[0];
      calls[key] = (calls[key] || 0) + 1;
      const failure = key.includes("/api/movie/1") ? failures[calls[key] - 1] : undefined;
      if (failure === "rete") throw new Error("network down");
      if (failure) return html("", failure);
      return base(url, options);
    };
    return { calls, fetchImpl };
  };
  const apiKey = "https://vixsrc.to/api/movie/1";

  let f = flaky([503]);
  ex = loadExtractor(f.fetchImpl);
  check("retry: 503 poi ok -> stream", (await ex.extractStreamUrl("https://vixsrc.to/movie/1")) !== null, `richieste api: ${f.calls[apiKey]}`);

  f = flaky(["rete"]);
  ex = loadExtractor(f.fetchImpl);
  check("retry: errore di rete poi ok -> stream", (await ex.extractStreamUrl("https://vixsrc.to/movie/1")) !== null);

  f = flaky([404]);
  ex = loadExtractor(f.fetchImpl);
  const r404 = await ex.extractStreamUrl("https://vixsrc.to/movie/1");
  check("retry: 404 non ritentato", r404 === null && f.calls[apiKey] === 1, `${f.calls[apiKey]} richieste`);

  f = flaky([503, 503, 503, 503]);
  ex = loadExtractor(f.fetchImpl);
  const dead = await ex.extractStreamUrl("https://vixsrc.to/movie/1");
  check("retry: max 3 tentativi poi null", dead === null && f.calls[apiKey] === 3, `${f.calls[apiKey]} richieste`);
}

// ==========================================
(async () => {
  const arg = process.argv[2];
  try {
    if (!arg) {
      console.log('Uso: node test-module.js "titolo"   oppure   node test-module.js --mock');
      process.exit(1);
    }
    if (arg === "--mock") await runMock();
    else await runLive(arg);
  } catch (error) {
    console.error("💥 Errore imprevisto:", error);
    failures++;
  }
  console.log(failures === 0 ? "\n🎉 Tutti i test superati\n" : `\n⚠️  ${failures} test falliti\n`);
  process.exit(failures === 0 ? 0 : 1);
})();
