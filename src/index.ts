import request from "request-promise-native";
import urllib from "url";

import { formatObj, titlesToEpisodes } from "./format";
import { IBaseObj } from "./model";
import { generateDeviceId } from "./util";

const URL_ROOT = "https://www.amazon.com";
const ATV_ROOT = "https://atv-ps.amazon.com/cdp/";
const URLS = {
    notifierResources: URL_ROOT + "/gp/deal/ajax/getNotifierResources.html",
    playerToken: URL_ROOT + "/gp/video/streaming/player-token.json",
    videoDetail: URL_ROOT + "/gp/video/detail/",

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
    private deviceId: string;

    constructor(
        private cookies: string,
        deviceId?: string,
    ) {
        this.deviceId = deviceId || generateDeviceId(USER_AGENT);
    }

    /**
     * Fetch the license data with the given URL and challengeData,
     * which should either be a Buffer of binary data, or the same
     * type of data base64-encoded as a string.
     */
    public async fetchLicense(
        licenseUrl: string,
        challengeData: Buffer | string,
    ) {
        const base64: string = (challengeData instanceof Buffer)
            ? challengeData.toString("base64")
            : challengeData;
        const response = await this.loadUrl(licenseUrl, {
            asJson: true,
            fillParams: false,
            form: {
                includeHdcpTestKeyInLicense: true,
                widevine2Challenge: base64,
            },
            method: "post",
        });

        if (response.error) {
            throw response.error;
        } else if (response.errorsByResource) {
            throw response.errorsByResource.Widevine2License;
        } else if (typeof response === "string") {
            let json: any;
            try {
                json = JSON.parse(response);
            } catch (e) {
                throw new Error(response);
            }

            if (json.message && json.message.statusCode === "ERROR") {
                throw new Error(json.message.body.message);
            }

            throw new Error(response);
        }

        return response.widevine2License.license;
    }

    /**
     * Given the titleId of an episode or movie, retrieve info on how
     * to play it using DASH and Widevine DRM. This consists of
     * available manifest URLs and the licenseURL.
     *
     * Note that Amazon uses a non-standard method for retrieving the
     * license data, so you cannot simply pass the Widevine DRM directly
     * to the `licenseUrl`—you MUST use fetchLicense.
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

    public async getTitleInfo(titleId: string): Promise<IBaseObj>;
    public async getTitleInfo(titleIds: string[]): Promise<IBaseObj[]>;
    public async getTitleInfo(titleIdOrIds: string | string[]) {
        const results = await this.getList({
            asinList: typeof titleIdOrIds === "string"
                ? [titleIdOrIds]
                : titleIdOrIds,
            catalog: "GetASINDetails",
        });

        const { titles } = results;
        const formatted = titles.map(formatObj);
        if (typeof titleIdOrIds === "string") {
            return formatted[0];
        }

        return formatted;
    }

    /**
     * Attempt to guess the resume info for a given titleId, which
     * could be for a Movie, a Series, or an Episode.  The `id`
     * returned is the resolved title ID to play, which might be for an
     * Episode if `titleId` was for a Series, for example. You can
     * fetch metadata like the Title and a Cover image using
     * `getTitleInfo`.
     *
     * This process scrapes a webpage so it may not be super reliable...
     */
    public async guessResumeInfo(titleId: string) {
        const url = URLS.videoDetail + titleId;
        const html = await this.request.get({
            gzip: true,
            headers: {
                cookie: this.cookies,
            },
            url,
        });

        // would a beautifulsoup-type parser be better here?
        const m = (html as string).match(/type="application\/json">(.+?)<\/script/);
        if (!m) throw new Error("Unable to determine episode to resume");
        const json = JSON.parse(m[1]);
        if (!json.videoConfig) {
            throw new Error("Unable to determine episode to resume");
        }

        return {
            id: json.videoConfig.asin as string,
            startTimeMillis: json.videoConfig.position as number,
        };
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
        const params = this.getPlaybackResourcesParams(vars, episodeTitleId, resourceType);
        return urllib.format(Object.assign(url, {
            query: this.fillParams(params),
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
            deviceID: vars.deviceID,
            deviceProtocolOverride: valWhen(!isWidevineLicense, "Http"),
            deviceStreamingTechnologyOverride: "DASH",
            deviceTypeID: "AOAGZA014O5RE",
            firmware: "1",
            format: valWhen(!isWidevineLicense, "json"),
            gascEnabled: false,
            languageFeature: "MLFv2",
            marketplaceID: vars.marketplaceId,
            resourceUsage: "ImmediateConsumption",
            supportedDRMKeyScheme: valWhen(!isWidevineLicense, "DUAL_KEY"),
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
            form?: any,
            method?: "get" | "post",
            qs?: {},
        },
    ) {
        const opts = Object.assign({
            asJson: true,
            body: undefined,
            fillParams: true,
            form: undefined,
            method: "get",
            qs: {},
        }, options || {});

        const qs = opts.fillParams
            ? this.fillParams(opts.qs || {})
            : opts.qs || {};

        const headers = {
            "Cookie": this.cookies,
            "User-Agent": USER_AGENT,
        } as any;

        if (!opts.asJson) {
            headers.Accept = "text/html,application/xhtml+xml,application/xml;" +
                "q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3";
        }

        return this.request({
            body: opts.body,
            form: opts.form,
            gzip: true,
            headers,
            json: opts.asJson,
            method: opts.method,
            qs,
            url,
        });
    }

    private fillParams(params: {}) {
        const filled: any = Object.assign({
            deviceID: this.deviceId,
            deviceTypeID: "A1MPSLFC7L5AFK",
            firmware: "fmw:15-app:1.1.19",
            format: "json",
        }, params);

        for (const k of Object.keys(filled)) {
            if (filled[k] === undefined) {
                delete filled[k];
            }
        }

        return filled;
    }
}
