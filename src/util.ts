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
    const seen: {[id: string]: boolean} = {};
    for (const obj of objs) {
        if (seen[obj.id]) continue;

        // most common:
        if (obj.type === ContentType.SEASON) {
            const series = (obj as ISeason).series;
            if (!series) continue;
            if (seen[series.id]) continue;

            seen[series.id] = true;
            yield Object.assign({
                type: ContentType.SERIES,
            }, series);
        }

        // rarely happens
        if (!seen[obj.id] && obj.type === ContentType.SERIES) {
            seen[obj.id] = true;
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
        for (const title of unique(objs)) {
            if (type && title.type !== type) {
                continue;
            }
            const score = this.score(title.title);
            if (score > 0) {
                matches.push([title, score]);
            }
        }

        // sort by score in descending order
        const sorted = matches.sort(([, scoreA], [, scoreB]) => {
            return scoreB - scoreA;
        });
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
