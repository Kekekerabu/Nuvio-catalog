const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");

const TMDB_API_KEY = "5c64e613c6ecd85d8b536feb9e653c9e"; 

const manifest = {
    id: "org.nuvio.perfectcatalog",
    version: "1.0.3", // Versi diperbarui
    name: "Perfect Nuvio Catalog",
    description: "Katalog sempurna dengan perbaikan Episode TV Series & Anime",
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

// ---------------- HANDLER UNTUK METADATA & EPISODE ---------------- //
builder.defineMetaHandler(async (args) => {
    if (args.id.startsWith("tmdb:")) {
        const tmdbId = args.id.split(":")[1];
        const typeUrl = args.type === "movie" ? "movie" : "tv";
        
        try {
            const url = `https://api.themoviedb.org/3/${typeUrl}/${tmdbId}?api_key=${TMDB_API_KEY}&append_to_response=videos`;
            const response = await axios.get(url);
            const item = response.data;
            
            let trailerId = null;
            if (item.videos && item.videos.results) {
                const trailer = item.videos.results.find(v => v.type === "Trailer" && v.site === "YouTube");
                if (trailer) trailerId = trailer.key;
            }

            let videos = [];
            // PERBAIKAN: Menarik data musim dan episode untuk TV Series
            if (typeUrl === "tv" && item.seasons) {
                for (let season of item.seasons) {
                    if (season.season_number > 0) { // Lewati season 0 (Special)
                        try {
                            const seasonUrl = `https://api.themoviedb.org/3/tv/${tmdbId}/season/${season.season_number}?api_key=${TMDB_API_KEY}`;
                            const seasonData = await axios.get(seasonUrl);
                            for (let ep of seasonData.data.episodes) {
                                videos.push({
                                    id: `tmdb:${tmdbId}:${season.season_number}:${ep.episode_number}`,
                                    title: ep.name || `Episode ${ep.episode_number}`,
                                    season: season.season_number,
                                    episode: ep.episode_number,
                                    thumbnail: ep.still_path ? `https://image.tmdb.org/t/p/w500${ep.still_path}` : null,
                                    overview: ep.overview
                                });
                            }
                        } catch (e) { console.error(`Gagal memuat musim ${season.season_number}`); }
                    }
                }
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
                    trailers: trailerId ? [{ source: trailerId, type: "Trailer" }] : [],
                    videos: typeUrl === "tv" ? videos : undefined
                }
            };
        } catch (error) { console.error(error); return { meta: {} }; }

    } else if (args.id.startsWith("anilist:")) {
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
    }
});

serveHTTP(builder.getInterface(), { port: process.env.PORT || 7000 });
console.log("Nuvio Perfect Catalog Addon is running!");
