import type {NativeSendIntent,SubmissionContext} from './submission-protocol.js';
export type RouteSource={id:string;sdkConversationId:number;controlGeneration:number;taskId?:number};
export type RouteRequest={actionId:string;source:RouteSource;id:string;text:string;expectedContext:SubmissionContext;expectedControlVersion:number};
/** Trusted runtime capability. Persists independent fixed text + intent atomically; never edits a draft. */
export type RouteAuthority={createRoute(request:RouteRequest):Promise<NativeSendIntent>};
export type RoutingMethod='routing.list'|'routing.query'|'routing.create'|'routing.send';
