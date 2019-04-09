export enum ContentType {
    EPISODE = "EPISODE",
    MOVIE = "MOVIE",
    SEASON = "SEASON",
    SERIES = "SERIES",
}

export interface IHasId {
    id: string;
}

export interface INumbered {
    number: number;
}

export interface IBaseObj extends IHasId {
    cover?: string;
    watchUrl: string;
    title: string;
    type: ContentType;
}

// tslint:disable-next-line no-empty-interface
export interface ISeries extends IBaseObj {
}

export interface ISeason extends IBaseObj, INumbered {
    series?: ISeries;
}

export interface IEpisode extends IBaseObj, INumbered {
    season?: ISeason;
    series?: ISeries;

    // NOTE: these properties never seem to actually mean anything, sadly...
    // watched: boolean;
    // watchCompleted: boolean;
    // watchedPositionMillis: number;
}
