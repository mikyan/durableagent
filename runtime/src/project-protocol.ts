/** Shared data only. Project metadata is current; adopted execution bindings retain versions. */
export const PROJECTS_EXTENSION={id:'projects',actions:['projects.get','projects.create','projects.rename','projects.select','workspaces.create','workspaces.update']} as const;
export type ProjectMethod=typeof PROJECTS_EXTENSION.actions[number];
export type LocationState='available'|'unverified'|'missing'|'revoked'|'environment-changed'|'ambiguous';
export type PositionState={state:LocationState;identity?:string;reason?:string};
export type ProjectRecord={id:string;name:string;workspaceId:string};
export type WorkspaceRecord={id:string;name:string;version:number;path:string;environment:string};
export type WorkspaceView=WorkspaceRecord&{position:PositionState};
export type ProjectSelection={id:string;projectId:string|null;workspaceId:string;associationVersion:number;position:PositionState};
export type ProjectCatalog={version:number;projects:ProjectRecord[];workspaces:WorkspaceView[];selection?:ProjectSelection};
export type LocationEditAuthority={
 beginLocationEdit(operationId:string):Promise<{operationId:string}>;
 readLocationEdit():Promise<{operationId:string}|null>;
 finishLocationEdit(operationId:string,contexts:{id:string;context:import('./submission-protocol.js').SubmissionContext}[]):Promise<void>;
};
/** projects.get {id?} -> ProjectCatalog (optional selected conversation).
 * All changes carry operationId + expectedVersion (catalog.version).
 * projects.create {id,name,workspaceId}; projects.rename {id,name};
 * projects.select {id:conversationId,projectId:string|null};
 * workspaces.create {id,name,path}; workspaces.update {id,name?,path?}.
 * Refused edits are never queued. Retry is a fresh explicit action with current version.
 * Location configuration is not proof of actual directory access/identity or a sandbox.
 */
