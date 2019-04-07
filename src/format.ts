import { IEpisode, ISeason, ISeries } from "./model";

function findCover(input: any) {
    if (!input.formats) return;
    let format: any | undefined;
    for (const f of input.formats) {
        if (f.videoFormatType === "HD") {
            format = f;
            break;
        }
    }

    if (!format) {
        // no HD format? fallback
        format = input.formats[0];
    }

    // make sure it has images
    if (!format || !format.images) return;

    // pick the first matching
    for (const image of format.images) {
        if (image.type === "COVER_ART_TV" || image.type === "COVER_ART_MOVIE") {
            return image.uri as string;
        }
    }
}

function findSeason(input: any) {
    if (!input.ancestorTitles) return;
    for (const ancestor of input.ancestorTitles) {
        if (ancestor.contentType === "SEASON") {
            return {
                id: ancestor.titleId,
                number: ancestor.number,
                title: ancestor.title,
            } as ISeason;
        }
    }
}

function findSeries(input: any) {
    if (!input.ancestorTitles) return;
    for (const ancestor of input.ancestorTitles) {
        if (ancestor.contentType === "SERIES") {
            return {
                id: ancestor.titleId,
                title: ancestor.title,
            } as ISeries;
        }
    }
}

function formatWatchUrl(titleId: string) {
    return `https://www.amazon.com/dp/${titleId}/?autoplay=1`;
}

export function formatObj(input: any) {
    return {
        cover: findCover(input),
        id: input.titleId as string,
        number: input.number as number,
        title: input.title as string,

        season: findSeason(input),
        series: findSeries(input),

        watchUrl: formatWatchUrl(input.titleId),

        watchCompleted: input.watchCompleted,
        watched: input.watched,
        watchedPositionMillis: input.watchedPositionMillis
            ? input.watchedPositionMillis.valueMillis
            : undefined,
    };
}

export function titlesToEpisodes(titles: any[]) {
    const mapped = titles.map(formatObj)
        .filter(v => v.number !== 0);
    mapped.sort((first, second) => {
        if (
            first.season
            && second.season
            && first.season.number !== second.season.number
        ) {
            return first.season.number - second.season.number;
        }

        return first.number - second.number;
    });
    return mapped as IEpisode[];
}
