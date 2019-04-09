import { createHmac } from "crypto";
import randomUuid from "uuid/v4";
import { ContentType, IBaseObj, ISeason } from "./model";

/**
 * Generate a 'unique' client/device id for requests
 */
export function generateDeviceId(
    userAgent: string,
    uuid: string = randomUuid(),
) {
    const hmac = createHmac("sha224", userAgent);
    hmac.update(uuid);
    return hmac.digest("hex");
}

export function *unique(objs: Iterable<IBaseObj>) {
    const seen = new Set<string>();
    for (const obj of objs) {
        if (seen.has(obj.id)) continue;

        // most common:
        if (obj.type === ContentType.SEASON) {
            const series = (obj as ISeason).series;
            if (!series) continue;
            if (seen.has(series.id)) continue;

            seen.add(series.id);
            yield Object.assign({
                type: ContentType.SERIES,
            }, series);
        }

        // rarely happens
        if (!seen.has(obj.id) && obj.type === ContentType.SERIES) {
            seen.add(obj.id);
            yield obj;
        }

        if (obj.type === ContentType.MOVIE) {
            // should only come up once
            yield obj;
        }
    }
}

export function titleToSlug(title: string) {
    return title.toLowerCase().replace(/(( |[^a-z0-9])+)/g, " ").trim();
}

export class TitleQuery {
    private slug: string;
    private parts: string[];

    constructor(title: string) {
        this.slug = titleToSlug(title);
        this.parts = this.slug.split(" ");
    }

    public filter(
        objs: Iterable<IBaseObj>,
        type?: ContentType,
    ) {
        const matches: Array<[IBaseObj, number]> = [];
        const uhdTitles = new Set<string>();
        for (const title of unique(objs)) {
            if (type && title.type !== type) {
                continue;
            }

            if (title.title.includes("4K UHD")) {
                uhdTitles.add(title.title.replace("(4K UHD)", "").trim());
            } else if (uhdTitles.has(title.title)) {
                // there's a higher-def version of this title
                continue;
            }

            const score = this.score(title.title);
            if (score > 0) {
                matches.push([title, score]);
            }
        }

        // filter out dups caused by having a separate title for the 4k version
        // that came *before* the 4k version in the results
        const filtered = matches.filter(it => !uhdTitles.has(it[0].title));

        // sort by score in descending order
        const sorted = filtered.sort(([, scoreA], [, scoreB]) => {
            return scoreB - scoreA;
        });

        // drop the scores and return the titles
        return sorted.map(it => it[0]);
    }

    public score(candidateTitle: string) {
        let bonuses = 0;
        let candidate = titleToSlug(candidateTitle);

        if (candidate.endsWith("4k uhd")) {
            bonuses += 0.5;
            candidate = candidate.replace("4k uhd", "").trim();
        }

        if (candidate.includes(this.slug)) {
            return bonuses + this.slug.length / candidateTitle.length;
        }

        let score = 0;
        let lastIdx = 0;
        for (const p of this.parts) {
            if (p.length <= 3) continue; // skip stop words

            const foundAt = candidate.indexOf(p, lastIdx);
            if (foundAt >= 0) {
                lastIdx = foundAt;
                score += p.length / candidate.length;
            }
        }

        if (score > 0) {
            return bonuses + score;
        }

        return 0;
    }
}
