import request from "request-promise-native";
import urllib from "url";

import { titlesToEpisodes } from "./format";

const URL_ROOT = "https://www.amazon.com";
const ATV_ROOT = "https://atv-ps.amazon.com/cdp/";
const URLS = {
    notifierResources: URL_ROOT + "/gp/deal/ajax/getNotifierResources.html",
    playerToken: URL_ROOT + "/gp/video/streaming/player-token.json",

    atvContent: ATV_ROOT,
    atvPlayback: ATV_ROOT + "catalog/GetPlaybackResources",
};

const USER_AGENT =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_12_3) " +
    "AppleWebKit/537.36 (KHTML, like Gecko) " +
    "Chrome/56.0.2924.87 Safari/537.36";

function valWhen<T>(check: boolean, value: T) {
    return check ? value : undefined;
}
const TWhen = (check: boolean | undefined) => check ? "T" : undefined;

export interface IManifestInfo {
    /** The CDN providing this resource */
    cdn: string;

    /** The URL of the manifest (.mpd) */
    url: string;
}

interface IPlaybackVars {
    customerId: string;
    deviceID: string;
    marketplaceId: string;
    token: string;
}

enum ResourceType {
    Widevine2License = "Widevine2License",
    PlaybackUrls = "AudioVideoUrls,SubtitleUrls",
}

export class ChakramApi {

    private request = request.defaults({});

    constructor(private cookies: string) {}

    /**
     * Given the titleId of an episode, retrieve available
     * manifest URLs and the licenseURL
     */
    public async getPlaybackInfo(
        episodeTitleId: string,
    ) {
        const vars = await this.getPlaybackVars();
        const licenseUrl = this.getPlaybackResourcesUrl(
            vars, episodeTitleId, ResourceType.Widevine2License,
        );
        const playbackData = await this.loadUrl(
            URLS.atvPlayback,
            {
                method: "post",
                qs: this.getPlaybackResourcesParams(
                    vars, episodeTitleId, ResourceType.PlaybackUrls,
                ),
            },
        );

        return {
            licenseUrl,
            manifests: playbackData.audioVideoUrls.avCdnUrlSets
                .filter((s: any) => s.streamingTechnology === "DASH"
                    && s.drm === "CENC")
                .map((rawSet: any) => ({
                    cdn: rawSet.cdn.toLowerCase(),
                    url: rawSet.avUrlInfoList[0].url,
                })) as IManifestInfo[],
        };
    }

    /**
     * Fetch episodes for a TV show season (or seasons) given its
     * titleID (or a list of seasons' titleIDs). This will return
     * an empty list if a series' titleID was provided instead of
     * a season's.
     */
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

    private async getPlaybackVars() {
        const callback = `onWebToken_${Math.floor(Math.random() * 484)}`;

        const [ notifierResources, tokenRaw ] = await Promise.all([
            this.loadUrl(URLS.notifierResources),
            this.loadUrl(URLS.playerToken, {
                asJson: false,
                fillParams: false,
                qs: { callback },
            }),
        ]);

        // the token is wrapped as `CALLBACK(<token>);`
        const tokenJson = (tokenRaw as string).substring(
            callback.length + 1,
            (tokenRaw as string).length - 2,
        );

        const token = JSON.parse(tokenJson).token;
        if (!token) {
            throw new Error("Not authorized");
        }

        const customerData = notifierResources.resourceData.GBCustomerData;
        return this.fillParams(Object.assign({
            token,
        }, customerData)) as any as IPlaybackVars;
    }

    private getPlaybackResourcesUrl(
        vars: IPlaybackVars,
        episodeTitleId: string,
        resourceType: ResourceType,
    ) {
        const url = urllib.parse(URLS.atvPlayback);
        return urllib.format(Object.assign(url, {
            query: this.getPlaybackResourcesParams(vars, episodeTitleId, resourceType),
        }));
    }

    private getPlaybackResourcesParams(
        vars: IPlaybackVars,
        episodeTitleId: string,
        resourceType: ResourceType,
    ) {
        const isWidevineLicense = resourceType === ResourceType.Widevine2License;
        return {
            asin: episodeTitleId,
            audioTrackId: "all",
            consumptionType: "Streaming",
            customerID: vars.customerId,
            desiredResources: resourceType,
            deviceBitrateAdaptationsOverride: valWhen(!isWidevineLicense, "CVBR,CBR"),
            deviceDrmOverride: "CENC",
            deviceProtocolOverride: valWhen(!isWidevineLicense, "Http"),
            deviceStreamingTechnologyOverride: "DASH",
            deviceTypeID: "AOAGZA014O5RE",
            firmware: "1",
            format: valWhen(!isWidevineLicense, "json"),
            gascEnabled: false,
            languageFeature: "MLFv2",
            marketplaceID: vars.marketplaceId,
            resourceUsage: "ImmediateConsumption",
            supportedDRMKeyScheme: "DUAL_KEY",
            titleDecorationScheme: valWhen(!isWidevineLicense, "primary-content"),
            token: vars.token,
            version: "1",
            videoMaterialType: "Feature",

            // NOTE: OS is important to get HD streams back
            operatingSystemName: "Mac OS X",
            operatingSystemVersion: "10.14.2",
        };
    }

    private async loadUrl(
        url: string,
        options?: {
            asJson?: boolean,
            body?: any,
            fillParams?: boolean,
            method?: "get" | "post",
            qs?: {},
        },
    ) {
        const opts = Object.assign({
            asJson: true,
            body: undefined,
            fillParams: true,
            method: "get",
            qs: {},
        }, options || {});
        const qs = opts.fillParams
            ? this.fillParams(opts.qs || {})
            : opts.qs || {};

        return this.request({
            body: opts.body,
            gzip: true,
            headers: {
                "Accept": "text/html,application/xhtml+xml,application/xml;" +
                    "q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3",
                "Cookie": this.cookies,
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
