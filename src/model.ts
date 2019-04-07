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
}

// tslint:disable-next-line no-empty-interface
export interface ISeries extends IBaseObj {
}

export interface ISeason extends IBaseObj, INumbered {
}

export interface IEpisode extends IBaseObj, INumbered {
    season?: ISeason;
    series?: ISeries;

    watched: boolean;
    watchCompleted: boolean;
    watchedPositionMillis: number;
}
