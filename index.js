const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");

const TMDB_API_KEY = "5c64e613c6ecd85d8b536feb9e653c9e"; 

const manifest = {
    id: "org.nuvio.perfectcatalog",
    version: "1.0.6",
    name: "Perfect Nuvio Catalog",
    description: "Katalog sepantas kilat: Meta TMDB (Movies/Series) & AniList (Anime)",
    types: ["movie", "series", "anime"],
    catalogs: [
        { type: "movie", id: "movie.trending", name: "Trending Movies", extra: [{ name: "search", isRequired: false }] },
        { type: "series", id: "series.trending", name: "Trending Series", extra: [{ name: "search", isRequired: false }] },
        { type: "anime", id: "anime.trending", name: "Trending Anime", extra: [{ name: "search", isRequired: false }] }
    ],
    resources: ["catalog", "meta"],
    idPrefixes: ["tmdb:", "anilist:"] 
};

const builder = new addonBuilder(manifest);

// FUNGSI PENAPISAN: Buang anime dari Movies dan Series
function isAnime(item) {
    const isJapanese = item.original_language === "ja";
    const isAnimation = item.genre_ids && item.genre_ids.includes(16); 
    return isJapanese && isAnimation;
}

// ---------------- 1. HANDLER KATALOG (POSTER & LIST) ---------------- //
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
            
            // Buang Anime, hantar senarai dengan pantas!
            const filteredResults = response.data.results.filter(item => !isAnime(item));
            metas = filteredResults.map(item => ({
                id: `tmdb:${item.id}`,
                type: args.type,
                name: item.title || item.name,
                poster: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : null,
                background: item.backdrop_path ? `https://image.tmdb.org/t/p/original${item.backdrop_path}` : null,
                description: item.overview,
                releaseInfo: (item.release_date || item.first_air_date || "").substring(0, 4)
            }));
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

// ---------------- 2. HANDLER METADATA (EPISOD & DETAILS) ---------------- //
builder.defineMetaHandler(async (args) => {
    
    // ----- A. TMDB (MOVIES / TV SERIES) -----
    if (args.id.startsWith("tmdb:")) {
        const tmdbId = args.id.split(":")[1];
        const typeUrl = args.type === "movie" ? "movie" : "tv";
        
        try {
            // Ambil Detail, Trailer dan IMDB ID serentak
            const url = `https://api.themoviedb.org/3/${typeUrl}/${tmdbId}?api_key=${TMDB_API_KEY}&append_to_response=videos,external_ids`;
            const response = await axios.get(url);
            const item = response.data;
            
            let trailerId = null;
            if (item.videos && item.videos.results) {
                const trailer = item.videos.results.find(v => v.type === "Trailer" && v.site === "YouTube");
                if (trailer) trailerId = trailer.key;
            }
            const imdbId = (item.external_ids && item.external_ids.imdb_id) ? item.external_ids.imdb_id : null;

            let videos = [];
            // FUNGSI LAJU: Ambil semua Season berbilang secara serentak!
            if (typeUrl === "tv" && item.seasons) {
                const validSeasons = item.seasons.filter(s => s.season_number > 0);
                const seasonPromises = validSeasons.map(s => 
                    axios.get(`https://api.themoviedb.org/3/tv/${tmdbId}/season/${s.season_number}?api_key=${TMDB_API_KEY}`)
                );
                
                try {
                    const seasonsResponses = await Promise.all(seasonPromises);
                    seasonsResponses.forEach(seasonData => {
                        if (seasonData.data && seasonData.data.episodes) {
                            seasonData.data.episodes.forEach(ep => {
                                videos.push({
                                    id: `tmdb:${tmdbId}:${ep.season_number}:${ep.episode_number}`,
                                    title: ep.name || `Episode ${ep.episode_number}`,
                                    season: ep.season_number,
                                    episode: ep.episode_number,
                                    overview: ep.overview,
                                    thumbnail: ep.still_path ? `https://image.tmdb.org/t/p/w500${ep.still_path}` : null,
                                    released: ep.air_date ? new Date(ep.air_date).toISOString() : null
                                });
                            });
                        }
                    });
                } catch (e) { console.error("Error fetching seasons", e.message); }
            }

            return {
                meta: {
                    id: args.id,
                    type: args.type,
                    name: item.title || item.name,
                    imdb_id: imdbId, // PENTING: Suntik IMDB ID untuk Streamer!
                    poster: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : null,
                    
