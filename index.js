const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");

// Gantikan dengan TMDB API Key anda (Dapatkan percuma di the-moviedb.org)
const TMDB_API_KEY = "8d6d91941230817f7807d643736e8a49"; // Placeholder key, for production replace with own key

const manifest = {
    id: "org.nuvio.perfectcatalog",
    version: "1.0.0",
    name: "Perfect Nuvio Catalog",
    description: "Katalog sempurna: Movies & Series (Tanpa Anime) + Anime Khusus (Sokongan Ani.pm)",
    types: ["movie", "series", "anime"],
    catalogs: [
        { type: "movie", id: "movie.trending", name: "Trending Movies", extra: [{ name: "search", isRequired: false }] },
        { type: "series", id: "series.trending", name: "Trending Series", extra: [{ name: "search", isRequired: false }] },
        { type: "anime", id: "anime.trending", name: "Trending Anime", extra: [{ name: "search", isRequired: false }] }
    ],
    resources: ["catalog", "meta"],
    idPrefixes: ["tmdb:", "al:"]
};

const builder = new addonBuilder(manifest);

// FUNGSI PENAPISAN: Buang anime dari Movies dan Series
function isAnime(item) {
    // Di TMDB, Anime biasanya adalah Bahasa Jepun (ja) dan mempunyai genre 16 (Animation)
    const isJapanese = item.original_language === "ja";
    const isAnimation = item.genre_ids && item.genre_ids.includes(16);
    return isJapanese && isAnimation;
}

// ---------------- HANDLER UNTUK KATALOG ---------------- //
builder.defineCatalogHandler(async (args) => {
    let metas = [];

    if (args.type === "movie" || args.type === "series") {
        const isMovie = args.type === "movie";
        const typeUrl = isMovie ? "movie" : "tv";
        
        try {
            let url = `https://api.themoviedb.org/3/trending/${typeUrl}/week?api_key=${TMDB_API_KEY}`;
            if (args.extra.search) {
                url = `https://api.themoviedb.org/3/search/${typeUrl}?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(args.extra.search)}`;
            }

            const response = await axios.get(url);
            const results = response.data.results;

            // KUNCI UTAMA: Penapisan (Filter) supaya Anime tak masuk dalam Movies/Series
            const filteredResults = results.filter(item => !isAnime(item));

            metas = filteredResults.map(item => ({
                id: `tmdb:${item.id}`,
                type: args.type,
                name: item.title || item.name,
                poster: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : null,
                background: item.backdrop_path ? `https://image.tmdb.org/t/p/original${item.backdrop_path}` : null,
                description: item.overview,
                releaseInfo: (item.release_date || item.first_air_date || "").substring(0, 4)
            }));
        } catch (error) {
            console.error("Error fetching TMDB:", error.message);
        }

    } else if (args.type === "anime") {
        // PANGGILAN ANILIST API (Serasi 100% dengan Ani.pm)
        try {
            const query = `
            query ($search: String, $sort: [MediaSort]) {
                Page(perPage: 30) {
                    media(search: $search, type: ANIME, sort: $sort) {
                        id
                        title { romaji english }
                        coverImage { extraLarge }
                        bannerImage
                        description
                        startDate { year }
                    }
                }
            }`;

            let variables = { sort: ["TRENDING_DESC"] };
            if (args.extra.search) {
                variables = { search: args.extra.search };
            }

            const response = await axios.post("https://graphql.anilist.co", { query, variables });
            const results = response.data.data.Page.media;

            metas = results.map(item => ({
                id: `al:${item.id}`,
                type: "anime",
                name: item.title.english || item.title.romaji,
                poster: item.coverImage.extraLarge,
                background: item.bannerImage,
                description: (item.description || "").replace(/<[^>]*>?/gm, ''), // Buang HTML tags
                releaseInfo: item.startDate.year ? item.startDate.year.toString() : "N/A"
            }));
        } catch (error) {
            console.error("Error fetching AniList:", error.message);
        }
    }

    return { metas };
});

// ---------------- HANDLER UNTUK METADATA (Details) ---------------- //
builder.defineMetaHandler(async (args) => {
    if (args.id.startsWith("tmdb:")) {
        const tmdbId = args.id.split(":")[1];
        const typeUrl = args.type === "movie" ? "movie" : "tv";
        
        try {
            const url = `https://api.themoviedb.org/3/${typeUrl}/${tmdbId}?api_key=${TMDB_API_KEY}&append_to_response=videos`;
            const response = await axios.get(url);
            const item = response.data;
            
            // Dapatkan trailer (YouTube)
            let trailerId = null;
            if (item.videos && item.videos.results) {
                const trailer = item.videos.results.find(v => v.type === "Trailer" && v.site === "YouTube");
                if (trailer) trailerId = trailer.key;
            }

            return {
                meta: {
                    id: args.id,
                    type: args.type,
                    name: item.title || item.name,
                    poster: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : null,
                    background: item.backdrop_path ? `https://image.tmdb.org/t/p/original${item.backdrop_path}` : null,
                    description: item.overview,
                    releaseInfo: (item.release_date || item.first_air_date || "").substring(0, 4),
                    trailers: trailerId ? [{ source: trailerId, type: "Trailer" }] : []
                }
            };
        } catch (error) {
            console.error("TMDB Meta Error:", error.message);
            return { meta: {} };
        }
    } else if (args.id.startsWith("al:")) {
        const alId = args.id.split(":")[1];
        
        try {
            const query = `
            query ($id: Int) {
                Media(id: $id, type: ANIME) {
                    id
                    title { romaji english }
                    coverImage { extraLarge }
                    bannerImage
                    description
                    startDate { year }
                    trailer { id site }
                }
            }`;

            const response = await axios.post("https://graphql.anilist.co", { query, variables: { id: parseInt(alId) } });
            const item = response.data.data.Media;

            let trailerInfo = [];
            if (item.trailer && item.trailer.site === "youtube") {
                trailerInfo = [{ source: item.trailer.id, type: "Trailer" }];
            }

            return {
                meta: {
                    id: `al:${item.id}`,
                    type: "anime",
                    name: item.title.english || item.title.romaji,
                    poster: item.coverImage.extraLarge,
                    background: item.bannerImage,
                    description: (item.description || "").replace(/<[^>]*>?/gm, ''),
                    releaseInfo: item.startDate.year ? item.startDate.year.toString() : "N/A",
                    trailers: trailerInfo
                }
            };
        } catch (error) {
            console.error("AniList Meta Error:", error.message);
            return { meta: {} };
        }
    }
});

serveHTTP(builder.getInterface(), { port: process.env.PORT || 7000 });
console.log("Nuvio Perfect Catalog Addon is running!");
