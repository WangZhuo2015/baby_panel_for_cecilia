import {growdeskFetch} from "./client";
import {createBackgroundClient} from "./background-client";
export type {BffVoiceLog} from "./background-client";
export const bffVoiceLogStore=createBackgroundClient(growdeskFetch);
