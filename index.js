const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");

const TMDB_API_KEY = "5c64e613c6ecd85d8b536feb9e653c9e"; 

const manifest = {
    id: "org.nuvio.perfectcatalog",
    version: "1.0.5",
    name: "Perfect Nuvio Catalog",
    description: "Katalog sempurna dengan Native IMDB Meta & Anilist Meta",
    types: ["movie", "series", "anime"],
    catalogs: [
        { type: "movie", id: "movie.trending", name: "Trending Movies", extra: [{ name: "search", isRequired: false }] },
        { type: "series", id: "series.trending", name: "Trending Series", extra: [{ name: "search", isRequired: false }] },
        { type: "anime", id: "anime.trending", name: "Trending Anime", extra: [{ name: "search", isRequired: false }] }
    ],
    resources: ["catalog", "meta"],
    // Hanya anime yang perlukan metadata khas dari kita
    idPrefixes: ["anilist:"] 
};

const builder = new addonBuilder(manifest);

function isAnime(item) {
    const isJapanese = item.original_language === "ja";
    const isAnimation = item.genre_ids && item.genre_ids.includes(16); 
    return isJapanese && isAnimation;
}

// ---------------- HANDLER UNTUK KATALOG ---------------- //
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

            // FUNGSI MAGIK: Tukar TMDB ID kepada IMDB ID secara automatik supaya Nuvio boleh proses episod
            const metasPromises = filteredResults.map(async (item) => {
                let finalId = `tmdb:${item.id}`; // Backup ID kalau tak jumpa IMDB
                try {
                    const extUrl = `https://api.themoviedb.org/3/${typeUrl}/${item.id}/external_ids?api_key=${TMDB_API_KEY}`;
                    const extRes = await axios.get(extUrl);
                    if (extRes.data && extRes.data.imdb_id) {
                        finalId = extRes.data.imdb_id; // Guna IMDB ID (contoh: tt1234567)
                    }
                } catch (e) {
                    // Abaikan jika ralat luaran
                }

                return {
                    id: finalId,
                    type: args.type,
                    name: item.title || item.name,
                    poster: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : null,
                    background: item.backdrop_path ? `https://image.tmdb.org/t/p/original${item.backdrop_path}` : null,
                    description: item.overview,
                    releaseInfo: (item.release_date || item.first_air_date || "").substring(0, 4)
                };
            });

            metas = await Promise.all(metasPromises);

        } catch (error) { console.error(error); }

    } else if (args.type === "anime") {
        try {
            const query = `
            query ($search: String, $sort: [MediaSort]) {
                Page(perPage: 30) {
                    media(search: $search, type: ANIME, sort: $sort) {
                        id title { romaji english } coverImage { extraLarge } bannerImage description startDate { year }
                    }
                }
            }`;
            let variables = { sort: ["TRENDING_DESC"] };
            if (args.extra.search) variables = { search: args.extra.search };

            const response = await axios.post("https://graphql.anilist.co", { query, variables });
            metas = response.data.data.Page.media.map(item => ({
                id: `anilist:${item.id}`,
                type: "series",
                name: item.title.english || item.title.romaji,
                poster: item.coverImage.extraLarge,
                background: item.bannerImage,
                description: (item.description || "").replace(/<[^>]*>?/gm, ''),
                releaseInfo: item.startDate.year ? item.startDate.year.toString() : "N/A"
            }));
        } catch (error) { console.error(error); }
    }
    return { metas };
});

// ---------------- HANDLER UNTUK METADATA (KHAS ANIME SAHAJA) ---------------- //
builder.defineMetaHandler(async (args) => {
    
    // Metadata untuk Movies/Series tak perlu ditulis di sini, Nuvio akan buat secara automatik guna IMDB ID
    if (args.id.startsWith("anilist:")) {
        const alId = args.id.split(":")[1];
        
        try {
            const query = `
            query ($id: Int) {
                Media(id: $id, type: ANIME) {
                    id title { romaji english } coverImage { extraLarge } bannerImage description startDate { year } episodes trailer { id site }
                }
            }`;

            const response = await axios.post("https://graphql.anilist.co", { query, variables: { id: parseInt(alId) } });
            const item = response.data.data.Media;

            let trailerInfo = [];
            if (item.trailer && item.trailer.site === "youtube") {
                trailerInfo = [{ source: item.trailer.id, type: "Trailer" }];
            }

            const totalEpisodes = item.episodes || 24; 
            let videos = [];
            for (let i = 1; i <= totalEpisodes; i++) {
                videos.push({
                    id: `anilist:${item.id}:${i}`,
                    title: `Episode ${i}`, 
                    season: 1, 
                    episode: i
                });
            }

            return {
                meta: {
                    id: `anilist:${item.id}`,
                    type: "series",
                    name: item.title.english || item.title.romaji,
                    poster: item.coverImage.extraLarge,
                    background: item.bannerImage,
                    description: (item.description || "").replace(/<[^>]*>?/gm, ''),
                    releaseInfo: item.startDate.year ? item.startDate.year.toString() : "N/A",
                    trailers: trailerInfo,
                    videos: videos
                }
            };
        } catch (error) { console.error(error); return { meta: {} }; }
    } else {
        return { meta: {} };
    }
});

serveHTTP(builder.getInterface(), { port: process.env.PORT || 7000 });
console.log("Nuvio Perfect Catalog Addon is running!");
