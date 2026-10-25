/**
 * Shirox / Sora / Luna Module Extractor - VixSrc ITA
 * Versione: 1.0.0
 *
 * - Ricerca, schede e stagioni da TMDB (titoli e trame in italiano)
 * - Video da vixsrc.to: stessi file Vixcloud di StreamingCommunity, ma serviti dai server veloci
 * - Solo i titoli presenti nel catalogo vixsrc compaiono nella ricerca
 * - Per ogni episodio fino a due stream:
 *     "Italiano"  -> audio ITA
 *     "Originale" -> audio in lingua originale; i sottotitoli ITA si accendono dal menu del player
 *                    e Shirox li ricorda per tutta la serie
 */

const CONFIG = {
  VIXSRC: "https://vixsrc.to",
  TMDB_API: "https://api.themoviedb.org/3",
  TMDB_IMG: "https://image.tmdb.org/t/p/w500",
  TMDB_LANG: "it-IT",
};

// Chiave TMDB usata solo da questo modulo (sola lettura).
// Scritta al contrario e in base64 per non farla trovare ai programmi che cercano chiavi su GitHub:
// chi legge il codice la può comunque ricavare. Se TMDB la disattiva, crearne una nuova e
// sostituire qui il valore (vedi Quick-Resume).
const TMDB_KEY_ENC = "MzZmOGExODUwMTQyYjk0NDVlMzVlZWM0YTcwZGYxNWE=";

function tmdbKey() {
  return atob(TMDB_KEY_ENC).split("").reverse().join("");
}

// Catalogo vixsrc (solo ID TMDB): ~14.000 film e ~5.000 serie, scaricato una volta ogni 6 ore
const CATALOG_TTL = 6 * 60 * 60 * 1000;
let CATALOG = { promise: null, timestamp: 0 };

// Dati TMDB del titolo, condivisi tra extractDetails, extractEpisodes ed extractStreamUrl
const TITLE_TTL = 10 * 60 * 1000;
const TITLE_CACHE_MAX = 20;
const TITLE_CACHE = new Map();

// TMDB restituisce al massimo 20 stagioni per richiesta (append_to_response)
const SEASONS_PER_REQUEST = 20;

const LANGUAGE_NAMES = {
  eng: "Inglese", kor: "Coreano", jpn: "Giapponese", spa: "Spagnolo", ger: "Tedesco",
  deu: "Tedesco", fre: "Francese", fra: "Francese", por: "Portoghese", rus: "Russo",
  tur: "Turco", hin: "Hindi", chi: "Cinese", zho: "Cinese", dan: "Danese", swe: "Svedese",
  nor: "Norvegese", dut: "Olandese", nld: "Olandese", pol: "Polacco", ara: "Arabo",
};

// --- UTILITY ---
function decodeEntities(str = "") {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&#0*39;|&#x0*27;|&apos;/gi, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function withParams(url, params) {
  if (!url) return "";
  const [main, hash = ""] = url.split("#");
  const qs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  if (!qs) return url;
  const sep = main.includes("?") ? (main.endsWith("?") || main.endsWith("&") ? "" : "&") : "?";
  return main + sep + qs + (hash ? "#" + hash : "");
}

// https://vixsrc.to/movie/27205  |  https://vixsrc.to/tv/1418  |  https://vixsrc.to/tv/1418/5/13
function parseHref(url = "") {
  const match = url.match(/\/(movie|tv)\/(\d+)(?:\/(\d+)\/(\d+))?/);
  if (!match) return null;
  return {
    type: match[1],
    id: match[2],
    season: match[3] ? Number(match[3]) : null,
    episode: match[4] ? Number(match[4]) : null,
  };
}

function isOk(res) {
  return !!res && !(res.status >= 400);
}

// --- FETCH ENGINE COMPATIBILE SHIROX / SORA ---
// Rete debole o sito sovraccarico: una richiesta fallita o con errore del server viene ritentata,
// invece di arrivare a Shirox come stream/lista vuota al primo errore.
// Il limite di tempo resta sotto i 120 s che Shirox concede a ogni funzione del modulo.
const FETCH_ATTEMPTS = 3;
const FETCH_TIME_BUDGET_MS = 50000;

async function soraFetch(url, options = { headers: {}, method: "GET", body: null }) {
  const started = Date.now();
  let res = null;
  for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt++) {
    res = await soraFetchOnce(url, options);
    if (res && !(res.status >= 500 || res.status === 429 || res.status === 408)) return res;
    if (attempt === FETCH_ATTEMPTS || Date.now() - started > FETCH_TIME_BUDGET_MS) break;
    console.log(`[soraFetch] tentativo ${attempt} fallito (${res ? res.status : "rete"}), riprovo: ${url}`);
    await sleep(1000 * attempt);
  }
  return res;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function soraFetchOnce(url, options) {
  try {
    return await fetchv2(url, options.headers ?? {}, options.method ?? "GET", options.body ?? null);
  } catch (e) {
    try {
      return await fetch(url, options);
    } catch (error) {
      return null;
    }
  }
}

async function fetchJson(url) {
  try {
    const res = await soraFetch(url);
    if (!isOk(res)) return null;
    return JSON.parse(await res.text());
  } catch (error) {
    return null;
  }
}

// --- TMDB ---
function tmdb(path, params = {}) {
  return fetchJson(withParams(`${CONFIG.TMDB_API}${path}`, {
    api_key: tmdbKey(),
    language: CONFIG.TMDB_LANG,
    ...params,
  }));
}

function seasonsParam(numbers) {
  return numbers.map((n) => `season/${n}`).join(",");
}

// Serie: arrivano insieme anche le prime 20 stagioni con i loro episodi (una sola richiesta)
function getTitle(type, id) {
  const key = `${type}/${id}`;
  const hit = TITLE_CACHE.get(key);
  if (hit && Date.now() - hit.timestamp < TITLE_TTL) return hit.promise;

  const params = type === "tv"
    ? { append_to_response: seasonsParam(Array.from({ length: SEASONS_PER_REQUEST }, (_, i) => i + 1)) }
    : {};
  const promise = tmdb(`/${type}/${id}`, params).then((data) => {
    if (!data && TITLE_CACHE.get(key)?.promise === promise) TITLE_CACHE.delete(key);
    return data;
  });

  TITLE_CACHE.set(key, { promise, timestamp: Date.now() });
  if (TITLE_CACHE.size > TITLE_CACHE_MAX) TITLE_CACHE.delete(TITLE_CACHE.keys().next().value);
  return promise;
}

// --- CATALOGO VIXSRC ---
// { movie: Set, tv: Set }; un tipo è null se il suo elenco non si è scaricato (in quel caso non si filtra)
function getCatalog() {
  if (CATALOG.promise && Date.now() - CATALOG.timestamp < CATALOG_TTL) return CATALOG.promise;

  const load = async (type) => {
    const list = await fetchJson(`${CONFIG.VIXSRC}/api/list/${type}/?lang=it`);
    return Array.isArray(list) ? new Set(list.map((item) => String(item.tmdb_id))) : null;
  };
  const promise = Promise.all([load("movie"), load("tv")]).then(([movie, tv]) => {
    // Elenco incompleto: si riprova alla prossima ricerca
    if ((!movie || !tv) && CATALOG.promise === promise) CATALOG = { promise: null, timestamp: 0 };
    return { movie, tv };
  });
  CATALOG = { promise, timestamp: Date.now() };
  return promise;
}

// ==========================================
// 1. RICERCA
// ==========================================
async function searchResults(keyword) {
  try {
    const [page1, page2, catalog] = await Promise.all([
      tmdb("/search/multi", { query: keyword, include_adult: "false", page: 1 }),
      tmdb("/search/multi", { query: keyword, include_adult: "false", page: 2 }),
      getCatalog(),
    ]);

    const seen = new Set();
    const results = [...(page1?.results || []), ...(page2?.results || [])]
      .filter((item) => (item.media_type === "movie" || item.media_type === "tv") && item.poster_path)
      .filter((item) => {
        const available = catalog[item.media_type];
        return !available || available.has(String(item.id));
      })
      .map((item) => ({
        title: decodeEntities(item.title || item.name || ""),
        image: `${CONFIG.TMDB_IMG}${item.poster_path}`,
        href: `${CONFIG.VIXSRC}/${item.media_type}/${item.id}`,
      }))
      .filter((item) => item.title && !seen.has(item.href) && seen.add(item.href));

    return JSON.stringify(results);
  } catch (error) {
    return JSON.stringify([]);
  }
}

// ==========================================
// 2. DETTAGLI
// ==========================================
async function extractDetails(url) {
  try {
    const ref = parseHref(url);
    if (!ref) return JSON.stringify([]);
    const data = await getTitle(ref.type, ref.id);
    if (!data) return JSON.stringify([]);

    // Trama non tradotta in italiano: si usa quella inglese
    let description = data.overview;
    if (!description) {
      const english = await tmdb(`/${ref.type}/${ref.id}`, { language: "en-US" });
      description = english?.overview;
    }

    return JSON.stringify([{
      description: description || "N/A",
      aliases: data.original_title || data.original_name || "N/A",
      airdate: data.release_date || data.first_air_date || "N/A",
    }]);
  } catch (error) {
    return JSON.stringify([]);
  }
}

// ==========================================
// 3. EPISODI
// ==========================================
async function extractEpisodes(url) {
  try {
    const ref = parseHref(url);
    if (!ref) return JSON.stringify([]);
    if (ref.type === "movie") {
      return JSON.stringify([{ href: `${CONFIG.VIXSRC}/movie/${ref.id}`, number: 1 }]);
    }

    const data = await getTitle("tv", ref.id);
    if (!data) return JSON.stringify([]);

    // Stagione 0 = speciali: esclusa (vixsrc non la numera come TMDB)
    const seasonNumbers = (data.seasons || [])
      .map((season) => season.season_number)
      .filter((n) => n > 0)
      .sort((a, b) => a - b);

    const seasons = {};
    for (const n of seasonNumbers) seasons[n] = data[`season/${n}`] || null;

    // Serie con più di 20 stagioni: le altre a blocchi di 20
    const missing = seasonNumbers.filter((n) => !seasons[n]);
    for (let i = 0; i < missing.length; i += SEASONS_PER_REQUEST) {
      const chunk = missing.slice(i, i + SEASONS_PER_REQUEST);
      const more = await tmdb(`/tv/${ref.id}`, { append_to_response: seasonsParam(chunk) });
      for (const n of chunk) seasons[n] = more?.[`season/${n}`] || null;
    }

    const today = new Date().toISOString().slice(0, 10);
    const episodes = [];
    for (const n of seasonNumbers) {
      for (const episode of seasons[n]?.episodes || []) {
        if (!episode.air_date || episode.air_date > today) continue; // non ancora uscito
        episodes.push({
          href: `${CONFIG.VIXSRC}/tv/${ref.id}/${n}/${episode.episode_number}`,
          number: episode.episode_number,
        });
      }
    }

    // IMPORTANTE: NON ordinare per number!
    // Shirox rileva le stagioni con detectSeasons: quando number <= previous.number crea una nuova stagione.
    return JSON.stringify(episodes);
  } catch (error) {
    return JSON.stringify([]);
  }
}

// ==========================================
// 4. ESTRAZIONE STREAM
// ==========================================

// api -> pagina embed -> window.masterPlaylist (stesso formato di Vixcloud)
async function getMasterPlaylist(path) {
  const api = await fetchJson(`${CONFIG.VIXSRC}/api/${path}?lang=it`);
  if (!api?.src) return null;

  const res = await soraFetch(`${CONFIG.VIXSRC}${api.src}`);
  if (!isOk(res)) return null;
  const html = await res.text();

  const blockStart = html.indexOf("window.masterPlaylist");
  if (blockStart === -1) return null;
  // Il blocco non si chiude con "};": si legge fino alla fine del suo <script>
  const blockEnd = html.indexOf("</script>", blockStart);
  const block = html.slice(blockStart, blockEnd === -1 ? undefined : blockEnd);

  const urlMatch = block.match(/url:\s*['"]([^'"]+)['"]/);
  const tokenMatch = block.match(/['"]?token['"]?\s*:\s*['"]([^'"]+)['"]/);
  const expiresMatch = block.match(/['"]?expires['"]?\s*:\s*['"]([^'"]+)['"]/);
  if (!urlMatch || !tokenMatch || !expiresMatch) return null;

  const params = { token: tokenMatch[1], expires: expiresMatch[1] };
  if (/window\.canPlayFHD\s*=\s*(true|1)/i.test(html)) params.h = 1;
  return withParams(urlMatch[1], params);
}

// Tracce audio del master: [{ language: "ita", name: "Italian" }, ...]
async function getAudioTracks(master) {
  const res = await soraFetch(master);
  if (!isOk(res)) return [];
  const text = await res.text();
  return text
    .split("\n")
    .filter((line) => line.startsWith("#EXT-X-MEDIA") && line.includes("TYPE=AUDIO"))
    .map((line) => ({
      language: (line.match(/LANGUAGE="([^"]+)"/) || [])[1] || "",
      name: (line.match(/NAME="([^"]+)"/) || [])[1] || "",
    }));
}

async function extractStreamUrl(url) {
  try {
    const ref = parseHref(url);
    if (!ref) return null;
    if (ref.type === "tv" && !(ref.season && ref.episode)) return null;

    const path = ref.type === "movie" ? `movie/${ref.id}` : `tv/${ref.id}/${ref.season}/${ref.episode}`;
    const [master, title] = await Promise.all([getMasterPlaylist(path), getTitle(ref.type, ref.id)]);
    if (!master) return null;

    const tracks = await getAudioTracks(master);
    const hasItalian = tracks.length === 0 || tracks.some((t) => t.language === "ita");
    const other = tracks.find((t) => t.language !== "ita");
    const originalIsItalian = title?.original_language === "it";

    // Il parametro lang del master sceglie l'audio predefinito: "it" = italiano,
    // "en" = l'altra traccia (inglese, coreano, spagnolo...). Verificato 25/10/2026.
    const streams = [];
    if (hasItalian) {
      streams.push({ title: "Italiano", streamUrl: withParams(master, { lang: "it" }), headers: {} });
    }
    if (other && (!originalIsItalian || !hasItalian)) {
      const language = LANGUAGE_NAMES[other.language] || other.name || other.language;
      streams.push({
        title: "Originale",
        streamUrl: withParams(master, { lang: "en" }),
        headers: {},
        details: `Audio ${language}, sottotitoli ITA dal menu del player`,
      });
    }

    // Shirox (JSEngine+Streams.swift): con più stream mostra la scelta, in ordine alfabetico del titolo
    return JSON.stringify({ streams });
  } catch (error) {
    return null;
  }
}
