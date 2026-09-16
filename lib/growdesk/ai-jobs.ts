import {growdeskFetch} from "./client";
import {createBackgroundClient} from "./background-client";
export type {BffAiJob} from "./background-client";
export const bffAiJobStore=createBackgroundClient(growdeskFetch);
