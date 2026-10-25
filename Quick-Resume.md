# QUICK-RESUME: Modulo Shirox / Sora — VixSrc ITA

> **Documento di ripristino contesto e guida operativa**  
> **Versione modulo:** 1.0.1  
> **Ultimo aggiornamento:** 25 Ottobre 2026  
> **Target:** iOS Media Player **Shirox v1.0.6 (Build 123)** (compatibile anche con Sora / Luna / Mojuru)  
> **Repository GitHub:** [Karelg86/VixSrc_ITA_Karelg](https://github.com/Karelg86/VixSrc_ITA_Karelg)  
> **Link da aggiungere in Shirox:** `https://raw.githubusercontent.com/Karelg86/VixSrc_ITA_Karelg/main/main.json`

---

## 1. PERCHÉ ESISTE QUESTO MODULO
- **vixsrc.to** è un ingresso di Vixcloud basato sugli ID TMDB. È il server "Italy" del sito cinehd.vc.
- Serve **gli stessi file video di StreamingCommunity** (es. Big Bang Theory S5E13 = video `620725` su entrambi), ma dai server veloci `*.boats` (Cloudflare).
- Verifica del 25/10/2026, stesso episodio (S5E13):

| | Modulo StreamingCommunity | VixSrc |
|---|---|---|
| Server segmenti | `sc-u9-01.vix-content.net` (lento) | `sc-u9-01.electricdesert31.boats` |
| Velocità misurata | 0,8–3,3 Mbit/s | 10,7–61,7 Mbit/s |
| Qualità | solo 720p (in quel momento) | fino a 1080p |

- Risolve i blocchi in AirPlay sugli episodi che con SC finivano sul server lento (vedi Quick-Resume di `media-player-config`, sezione F3).
- Il modulo StreamingCommunity resta separato e invariato.

---

## 2. COME FUNZIONA
| Funzione | Fonte | Note |
|---|---|---|
| `searchResults` | TMDB `/search/multi` (pagine 1 e 2, `it-IT`) | Mostra solo film e serie presenti nel catalogo vixsrc (`/api/list/movie/` e `/api/list/tv/`, scaricati una volta ogni 6 ore). Se il catalogo non si scarica, non filtra. |
| `extractDetails` | TMDB `/movie/{id}` o `/tv/{id}` | Trama italiana; se manca, usa quella inglese. |
| `extractEpisodes` | TMDB `/tv/{id}?append_to_response=season/1,...,season/20` | Una richiesta per 20 stagioni (oltre, a blocchi di 20). Esclusi la stagione 0 (speciali) e gli episodi non ancora usciti. Ordine naturale, mai ordinare per `number`. |
| `extractStreamUrl` | `vixsrc.to/api/{movie/ID \| tv/ID/S/E}?lang=it` → `{src}` → pagina embed → `window.masterPlaylist` | Stesso formato di Vixcloud: `url`, `token`, `expires`, `h=1` se `canPlayFHD`. Se il blocco sparisce (pagina cambiata), riserva: primo link `.m3u8` scritto nella pagina (v1.0.1). Nessun header necessario, quindi in AirPlay la TV scarica direttamente. |

- **href stabili** (servono a "Continua a guardare"): `https://vixsrc.to/movie/{tmdb}`, `https://vixsrc.to/tv/{tmdb}`, `https://vixsrc.to/tv/{tmdb}/{stagione}/{episodio}`. Non cambiarli.
- Cache in RAM: dati TMDB del titolo per 10 minuti (condivisi tra scheda, episodi e stream), catalogo vixsrc per 6 ore. Shirox tiene il contesto JS del modulo finché non si cambia modulo.
- Retry su rete debole: 3 tentativi su `5xx`/`429`/`408`/errore di rete, come StreamingCommunity v1.0.8.

---

## 3. LINGUE: "ITALIANO" E "ORIGINALE"
- Ogni video vixsrc contiene già audio ITA, audio originale e circa 10 sottotitoli (incluso italiano).
- Il parametro `lang` aggiunto al master sceglie l'**audio predefinito** (verificato 25/10/2026):
  - `lang=it` → italiano;
  - `lang=en` → l'altra traccia, qualunque lingua sia (inglese, coreano, spagnolo...). `lang=ko`, `lang=es`, `lang=eng` **non** funzionano.
- Nessun parametro accende i sottotitoli (provati `sub`, `subs`, `subtitle`, `cc`).
- Stream restituiti:
  - **"Italiano"** se c'è l'audio ITA;
  - **"Originale"** se c'è un'altra lingua e il titolo non è italiano in origine (TMDB `original_language`), oppure se manca l'audio ITA. Nel campo `details` c'è la lingua, es. "Audio Coreano, sottotitoli ITA dal menu del player".
- Shirox mostra la scelta in ordine alfabetico ("Italiano" prima di "Originale"). Con uno stream solo parte subito.
- **Sottotitoli ITA in "Originale":** si accendono dal menu del player la prima volta. Shirox (`TrackPreferences.swift`) ricorda audio e sottotitoli **per ogni serie**.
- Perché i sottotitoli non sono già accesi dal modulo: il campo `subtitle` di Shirox vale per tutti gli stream dell'episodio e viene sempre caricato, quindi comparirebbe anche su "Italiano".
- Opzione Shirox utile: "ricorda ultimo stream" (`autoPickLastStream`) per non dover scegliere ogni volta.

---

## 4. CHIAVE TMDB
- Chiave API v3 dell'utente, creata solo per questo modulo (app TMDB "VixSrc_ITA_Karelg", tipo "Mobile application").
- Nel codice è scritta **al contrario e in base64** (`TMDB_KEY_ENC`) per non farla trovare ai programmi che cercano chiavi su GitHub. Non è nascosta davvero: chi legge il codice la può ricavare. Un modulo gira sul telefono e il codice è pubblico, quindi nasconderla del tutto non è possibile.
- **Se TMDB la disattiva** (sintomo: la ricerca non trova più niente):
  1. themoviedb.org → Impostazioni → API → rigenera la chiave;
  2. calcolare il nuovo valore: `node -e "const k='NUOVA_CHIAVE'; console.log(Buffer.from(k.split('').reverse().join('')).toString('base64'))"`;
  3. sostituire `TMDB_KEY_ENC` in `extractor.js` e la costante `KEY` in `test-module.js`;
  4. aumentare la versione in `main.json` e nell'intestazione di `extractor.js`.
- Il "Token di accesso in lettura" (quello lungo) non serve al modulo.

---

## 5. LIMITI NOTI
- Il catalogo vixsrc contiene circa 14.000 film e 5.000 serie (25/10/2026). Gli anime mancano quasi tutti (es. One Piece, Frieren, Solo Leveling). Per quelli servono i moduli anime.
- Un titolo nel catalogo può non avere tutti gli episodi: in quel caso l'episodio non parte (stream vuoto).
- Vixcloud può cambiare server col tempo: se un episodio torna su `vix-content.net`, valgono i rimedi del Quick-Resume di `media-player-config` (F3: qualità 720p, Duplica schermo).
- Se vixsrc cambia dominio (vedi sezione 6), i titoli già in "Continua a guardare" continuano a funzionare: `parseHref` legge solo la parte `/movie/ID` o `/tv/ID/S/E` del link e le richieste partono sempre da `CONFIG.VIXSRC`.

---

## 6. STRUTTURA DEI FILE E ROBOT GITHUB

```
VixSrc_ITA_Karelg/
├── main.json                       # Metadati modulo, icona, versione e URL GitHub raw
├── extractor.js                    # Script JS eseguito da JavaScriptCore su Shirox
├── test-module.js                  # Test runner locale (Node.js 18+): --mock offline, oppure live
├── Quick-Resume.md                 # Questa guida tecnica
├── .gitignore                      # Esclude backup/, Image/, report locali
├── .gitattributes                  # Fine riga LF per js/json/md (come Mang_ITA/ENG)
├── .github/
│   ├── workflows/
│   │   ├── check-domain.yml        # Robot: controlla il dominio ogni 6 ore e AVVISA (issue)
│   │   ├── update-domain.yml       # Robot: cambio dominio su richiesta (anche da cellulare)
│   │   └── health-check.yml        # Robot: test completo ogni giorno, AVVISA se il modulo non funziona
│   └── scripts/
│       ├── check-domain.js         # Logica del controllo (uguale a media-player-config)
│       └── update-domain.js        # Sostituzione dominio + versione (tocca anche test-module.js)
├── backup/                         # SOLO sul PC (ignorato da git): versioni precedenti
└── Image/                          # SOLO sul PC (ignorato da git): screenshot e log
```

### 🤖 Controllo dominio (ogni 6 ore)
- Controlla `baseUrl` di `main.json` (`https://vixsrc.to/`). Non modifica nulla.
- Se il dominio reindirizza altrove, oppure non risponde per 2 controlli di fila, apre una **issue** con etichetta `dominio`, assegnata a te: arriva la notifica sull'app GitHub o via email.
- Lancio manuale: *Actions → Controllo dominio → Run workflow*.
- ⚠️ GitHub sospende i workflow programmati dopo **60 giorni senza attività** nel repo (manda una email prima). Per riattivarli: *Actions → workflow → Enable workflow*.

### 🩺 Salute modulo (ogni giorno)
- Test offline + test live con `inception` e `big bang theory` (ricerca → episodi → stream).
- Se fallisce **2 volte di fila** apre una issue con etichetta `salute`. Le cause tipiche, scritte anche nella issue:
  - **ricerca con 0 risultati** → chiave TMDB disattivata (sezione 4);
  - **stream vuoto** → vixsrc ha cambiato le pagine.
- Quando il test torna a funzionare la issue si chiude da sola.

### 📱 Cambio dominio da cellulare
1. Apri `https://github.com/Karelg86/VixSrc_ITA_Karelg/actions/workflows/update-domain.yml` (dall'app GitHub: repo → **Actions** → **Aggiorna dominio**).
2. Premi **Run workflow**, scrivi il nuovo dominio **senza** `https://` (es. `vixsrc.nuovo`) e conferma.
3. Il robot:
   - sostituisce il dominio in `main.json`, `extractor.js`, `test-module.js` e `Quick-Resume.md`;
   - incrementa la versione (es. 1.0.0 → 1.0.1);
   - lancia i test;
   - fa commit e push e chiude la issue.
4. Su Shirox: Moduli → aggiorna.

### 💻 Cambio dominio da PC
```bash
node .github/scripts/update-domain.js vixsrc.nuovo
node test-module.js --mock
node test-module.js "inception"
git add main.json extractor.js test-module.js Quick-Resume.md
git commit -m "Update domain to vixsrc.nuovo - v1.0.1"
git push origin main
```
Script provati il 25/10/2026 su una copia: il controllo dà `HTTP 200, nessun cambio`; il cambio simulato `vixsrc.to → vixsrc.nuovo` aggiorna i 4 file e la versione, e i test offline passano anche dopo.

> ⚠️ **Versione:** Shirox scarica il nuovo script solo se `version` in `main.json` cambia. `update-domain.js` la aumenta da solo; se modifichi i file a mano, ricordatelo. Prima di ogni modifica importante copia i file in `backup/vX.Y.Z/`.

---

## 7. TEST LOCALE
```bash
node test-module.js --mock               # offline, 25 controlli
node test-module.js "big bang theory"    # live: 279 episodi, 12 stagioni
node test-module.js "squid game"         # live: Italiano + Originale (coreano)
node test-module.js "gomorra"            # live: solo Italiano (originale italiano)
node test-module.js "inception"          # live: film
```
Il test live stampa anche il **server dei segmenti** e segnala `⚠️ server lento` se è `vix-content.net`.
Per testare una versione vecchia: `EXTRACTOR=backup/v1.0.0/extractor.js node test-module.js --mock`.

---

## 8. COME AGGIORNARE / TESTARE SU SHIROX
1. Modificare `extractor.js`, aumentare `version` in `main.json` (Shirox aggiorna solo se la versione cambia).
2. `node test-module.js --mock` e un test live.
3. Commit e push su `main`.
4. Su Shirox: chiudere e riaprire l'app, oppure il tasto aggiorna nella schermata Moduli. Non serve aggiungere di nuovo il link.
