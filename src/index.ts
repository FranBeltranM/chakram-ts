import request from "request-promise-native";
import { titlesToEpisodes } from "./format";

const URL_ROOT = "https://www.amazon.com";
const ATV_ROOT = "https://atv-ps.amazon.com";
const URLS = {
    notifierResources: URL_ROOT + "/gp/deal/ajax/getNotifierResources.html",
    playerToken: URL_ROOT + "/gp/video/streaming/player-token.json",

    atvContent: ATV_ROOT + "/cdp/",
};

const USER_AGENT =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_12_3) " +
    "AppleWebKit/537.36 (KHTML, like Gecko) " +
    "Chrome/56.0.2924.87 Safari/537.36";

function valWhen<T>(check: boolean, value: T) {
    return check ? value : undefined;
}
const TWhen = (check: boolean | undefined) => check ? "T" : undefined;

export class ChakramApi {

    constructor(private cookies: string) {}

    public async getEpisodes(titleIdOrIds: string | string[]) {
        // TODO paginate?
        const results = await this.getList({
            contentType: "TVEpisode",
            seasonAsins: typeof titleIdOrIds === "string"
                ? [titleIdOrIds]
                : titleIdOrIds,
        });
        const { titles } = results;
        return titlesToEpisodes(titles);
    }

    private async getList(options: {
        asinList?: string[],
        catalog?: string,
        contentType?: "Movie" | "TVEpisode",
        orderBy?: string,
        resultsCount?: number,
        rollupSeason?: boolean,
        seasonAsins?: string[],
    }) {
        const opts = Object.assign({
            catalog: "Browse",
            contentType: undefined,
            orderBy: "MostPopular",
            start: 0,
        }, options || {});

        const isEpisodeContent = opts.contentType === "Episode";
        const qs = {
            ContentType: opts.contentType,
            Detailed: TWhen(opts.catalog === "TVEpisode"),
            IncludeAll: "T",
            IncudeBlacklist: TWhen(isEpisodeContent),
            NumberOfResults: opts.resultsCount,
            OrderBy: valWhen(!!opts.contentType, opts.orderBy),
            RollUpToSeason: TWhen(opts.rollupSeason),
            StartIndex: opts.start,

            SeasonASIN: opts.seasonAsins && opts.seasonAsins.join(","),
            asinList: opts.asinList && opts.asinList.join(","),

            playbackInformationRequired: true,
            tag: valWhen(isEpisodeContent, 1),
            version: 2,
        };

        const result = await this.loadUrl(
            `${URLS.atvContent}catalog/${opts.catalog}`,
            { qs },
        );
        if (result.error) {
            throw result.error;
        }
        return result.message.body;
    }

    private async loadUrl(
        url: string,
        options?: {
            asJson?: boolean,
            body?: any,
            method?: "get" | "post",
            qs: {},
        },
    ) {
        const opts = Object.assign({
            asJson: true,
            body: undefined,
            method: "get",
            qs: {},
        }, options || {});
        const qs = this.fillParams(opts.qs || {});

        return request({
            body: opts.body,
            headers: {
                "Cookies": this.cookies,
                "User-Agent": USER_AGENT,
            },
            json: opts.asJson,
            method: opts.method,
            qs,
            url,
        });
    }

    private fillParams(params: {}) {
        return Object.assign({
            deviceID: "", // TODO ?
            deviceTypeID: "A1MPSLFC7L5AFK",
            firmware: "fmw:15-app:1.1.19",
            format: "json",
        }, params);
    }
}
