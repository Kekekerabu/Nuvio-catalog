const { addonBuilder, getRouter } = require("stremio-addon-sdk");
const express = require("express");
const axios = require("axios");

const TMDB_API_KEY = "5c64e613c6ecd85d8b536feb9e653c9e"; 

const manifest = {
    id: "org.nuvio.perfectcatalog.v2",
    version: "2.0.0",
    name: "Perfect Nuvio Catalog v2",
    description: "IMDb Native (Movies/Series) & Kitsu (Sokongan Penuh Ani.pm)",
    types: ["movie", "series", "anime"],
    catalogs: [
        { type: "movie", id: "movie.trending", name: "Trending Movies", extra: [{ name: "search", isRequired: false }] },
        { type: "series", id: "series.trending", name: "Trending Series", extra: [{ name: "search", isRequired: false }] },
        { type: "anime", id: "anime.trending", name: "Trending Anime", extra: [{ name: "search", isRequired: false }] }
    ],
    resources: ["catalog", "meta"],
    // Kunci Rahsia: Nuvio sangat sensitif. Kita mesti bagi ID IMDb ('tt') untuk Series, dan 'kitsu:' untuk Anime.
    idPrefixes: ["tt", "kitsu:"] 
};

const builder = new addonBuilder(manifest);

function isAnime(item) {
    const isJapanese = item.original_language === "ja";
    const isAnimation = item.genre_ids && item.genre_ids.includes(16); 
    return isJapanese && isAnimation;
}

// ---------------- 1. HANDLER KATALOG ---------------- //
builder.defineCatalogHandler(async (args) => {
    let metas = [];

    // --- A. MOVIES & TV SERIES (GUNA TMDB -> TUKAR KE IMDB) ---
    if (args.type === "movie" || args.type === "series") {
        const typeUrl = args.type === "movie" ? "movie" : "tv";
        try {
            let url = `https://api.themoviedb.org/3/trending/${typeUrl}/week?api_key=${TMDB_API_KEY}`;
            if (args.extra.search) {
                url = `https://api.themoviedb.org/3/search/${typeUrl}?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(args.extra.search)}`;
            }
            const response = await axios.get(url);
            
            const filteredResults = response.data.results.filter(item => !isAnime(item));
            
            // Tarik IMDb ID serentak
            const metasPromises = filteredResults.map(async (item) => {
                let imdbId = null;
                try {
                    const extUrl = `https://api.themoviedb.org/3/${typeUrl}/${item.id}/external_ids?api_key=${TMDB_API_KEY}`;
                    const extRes = await axios.get(extUrl);
                    imdbId = extRes.data.imdb_id;
                } catch (e) {}

                // Jika takde IMDb ID, kita tak masukkan dalam list, sebab Nuvio perlukan IMDb ID untuk keluarkan episod
                if (!imdbId) return null; 

                return {
                    id: imdbId, // Guna ID tt... (Contoh: tt0944947)
                    type: args.type,
                    name: item.title || item.name,
                    poster: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : null,
                    description: item.overview,
                    releaseInfo: (item.release_date || item.first_air_date || "").substring(0, 4)
                };
            });
            
            const resolved = await Promise.all(metasPromises);
            metas = resolved.filter(m => m !== null); // Buang yang null

        } catch (error) { console.error(error); }

    // --- B. ANIME (TUKAR KE KITSU API) ---
    } else if (args.type === "anime") {
        try {
            let url = "https://kitsu.io/api/edge/trending/anime";
            if (args.extra.search) {
                url = `https://kitsu.io/api/edge/anime?filter[text]=${encodeURIComponent(args.extra.search)}`;
            }
            const response = await axios.get(url);
            const results = response.data.data || [];

            metas = results.map(item => {
                const attrs = item.attributes;
                return {
                    id: `kitsu:${item.id}`,
                    type: "series",
                    name: attrs.titles.en || attrs.titles.en_jp || attrs.canonicalTitle,
                    poster: attrs.posterImage ? attrs.posterImage.original : null,
                    background: attrs.coverImage ? attrs.coverImage.original : null,
                    description: attrs.synopsis,
                    releaseInfo: attrs.startDate ? attrs.startDate.substring(0, 4) : "N/A"
                };
            });
        } catch (error) { console.error(error); }
    }
    return { metas };
});

// ---------------- 2. HANDLER METADATA ---------------- //
// Kita TAK BUAT meta handler untuk Movies/Series. Bila kita pass IMDb ID dari katalog, Nuvio (Cinemeta) akan automatik uruskan metadata yang sempurna!
builder.defineMetaHandler(async (args) => {
    
    // HANYA URUSKAN ANIME SAHAJA DI SINI
    if (args.id.startsWith("kitsu:")) {
        const kitsuId = args.id.split(":")[1];
        
        try {
            const url = `https://kitsu.io/api/edge/anime/${kitsuId}`;
            const response = await axios.get(url);
            const attrs = response.data.data.attributes;

            // Dapatkan senarai episod dari Kitsu
            let videos = [];
            try {
                const epUrl = `https://kitsu.io/api/edge/anime/${kitsuId}/episodes?page[limit]=200`;
                const epRes = await axios.get(epUrl);
                videos = epRes.data.data.map(ep => {
                    const epAttrs = ep.attributes;
                    return {
                        id: `kitsu:${kitsuId}:${epAttrs.relativeNumber}`,
                        title: epAttrs.titles.en_jp || `Episode ${epAttrs.relativeNumber}`,
                        season: 1,
                        episode: epAttrs.relativeNumber,
                        thumbnail: epAttrs.thumbnail ? epAttrs.thumbnail.original : null
                    };
                });
            } catch (e) { console.error("Error fetching Kitsu episodes"); }

            // Jika tiada senarai episod dari API, buat fallback senarai episod
            if (videos.length === 0) {
                const totalEpisodes = attrs.episodeCount || 24; 
                for (let i = 1; i <= totalEpisodes; i++) {
                    videos.push({
                        id: `kitsu:${kitsuId}:${i}`,
                        title: `Episode ${i}`, 
                        season: 1, 
                        episode: i
                    });
                }
            }

            let trailerInfo = [];
            if (attrs.youtubeVideoId) {
                trailerInfo = [{ source: attrs.youtubeVideoId, type: "Trailer" }];
            }

            return {
                meta: {
                    id: `kitsu:${kitsuId}`,
                    type: "series",
                    name: attrs.titles.en || attrs.titles.en_jp || attrs.canonicalTitle,
                    poster: attrs.posterImage ? attrs.posterImage.original : null,
                    background: attrs.coverImage ? attrs.coverImage.original : null,
                    description: attrs.synopsis,
                    releaseInfo: attrs.startDate ? attrs.startDate.substring(0, 4) : "N/A",
                    trailers: trailerInfo,
                    videos: videos
                }
            };
        } catch (error) { console.error(error); return { meta: {} }; }
    } else {
        return { meta: {} };
    }
});

const app = express();
const port = process.env.PORT || 7000;

app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "*");
    next();
});

app.use("/", getRouter(builder.getInterface()));

app.listen(port, "0.0.0.0", () => {
    console.log(`Nuvio Perfect Catalog v2 Server running on port ${port}`);
});
