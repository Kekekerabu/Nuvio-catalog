const { addonBuilder, getRouter } = require("stremio-addon-sdk");
const express = require("express");
const axios = require("axios");

const TMDB_API_KEY = "5c64e613c6ecd85d8b536feb9e653c9e"; 

const manifest = {
    id: "org.nuvio.perfectcatalog.v3",
    version: "3.0.0",
    name: "Perfect Nuvio Catalog v3",
    description: "Katalog Auto-Meta: TV Series Cepat & Anime 1000+ Episod",
    types: ["movie", "series", "anime"],
    catalogs: [
        { type: "movie", id: "movie.trending", name: "Trending Movies", extra: [{ name: "search", isRequired: false }] },
        { type: "series", id: "series.trending", name: "Trending Series", extra: [{ name: "search", isRequired: false }] },
        { type: "anime", id: "anime.trending", name: "Trending Anime", extra: [{ name: "search", isRequired: false }] }
    ],
    resources: ["catalog", "meta"],
    // FIX BESAR 1: Kita sengaja BUANG "tt" kat sini. Bila kita tak letak "tt", Nuvio takkan minta details movie/series dari kita. 
    // Dia akan automatik rujuk pangkalan datanya sendiri (Cinemeta) yang jauh lebih laju dan lengkap episodnya!
    idPrefixes: ["kitsu:"] 
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

    if (args.type === "movie" || args.type === "series") {
        const typeUrl = args.type === "movie" ? "movie" : "tv";
        try {
            let url = `https://api.themoviedb.org/3/trending/${typeUrl}/week?api_key=${TMDB_API_KEY}`;
            if (args.extra.search) {
                url = `https://api.themoviedb.org/3/search/${typeUrl}?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(args.extra.search)}`;
            }
            const response = await axios.get(url);
            
            const filteredResults = response.data.results.filter(item => !isAnime(item));
            
            const metasPromises = filteredResults.map(async (item) => {
                let imdbId = null;
                try {
                    const extUrl = `https://api.themoviedb.org/3/${typeUrl}/${item.id}/external_ids?api_key=${TMDB_API_KEY}`;
                    const extRes = await axios.get(extUrl);
                    imdbId = extRes.data.imdb_id;
                } catch (e) {}

                if (!imdbId) return null; 

                return {
                    id: imdbId, 
                    type: args.type,
                    name: item.title || item.name,
                    poster: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : null,
                    description: item.overview,
                    releaseInfo: (item.release_date || item.first_air_date || "").substring(0, 4)
                };
            });
            
            const resolved = await Promise.all(metasPromises);
            metas = resolved.filter(m => m !== null); 

        } catch (error) { console.error(error); }

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
builder.defineMetaHandler(async (args) => {
    
    // HANYA URUSKAN ANIME (KITSU) SAHAJA. (Movies/Series diuruskan automatik oleh Nuvio sebab kita tak letak 'tt' kat idPrefixes atas)
    if (args.id.startsWith("kitsu:")) {
        const kitsuId = args.id.split(":")[1];
        
        try {
            const url = `https://kitsu.io/api/edge/anime/${kitsuId}`;
            const response = await axios.get(url);
            const attrs = response.data.data.attributes;

            let totalEpisodes = attrs.episodeCount;

            // FIX BESAR 2: Kalau anime macam One Piece masih Ongoing, episodeCount di Kitsu adalah "null".
            // Kita selesaikan dengan buat carian berbalik (reverse search) untuk cari episod yang paling terkini!
            if (!totalEpisodes) {
                try {
                    const lastEpUrl = `https://kitsu.io/api/edge/anime/${kitsuId}/episodes?sort=-number&page[limit]=1`;
                    const lastEpRes = await axios.get(lastEpUrl);
                    if (lastEpRes.data && lastEpRes.data.data && lastEpRes.data.data.length > 0) {
                        totalEpisodes = lastEpRes.data.data[0].attributes.number;
                    }
                } catch (e) {
                    console.error("Gagal cari episod terkini dari Kitsu");
                }
            }

            // Fallback terakhir jika semua gagal
            totalEpisodes = totalEpisodes || 24; 

            // Bina senarai episod (Dari 1 sampai 1000+ dengan laju)
            let videos = [];
            for (let i = 1; i <= totalEpisodes; i++) {
                videos.push({
                    id: `kitsu:${kitsuId}:${i}`,
                    title: `Episode ${i}`, 
                    season: 1, 
                    episode: i
                });
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
    console.log(`Nuvio Perfect Catalog v3 Server running on port ${port}`);
});
