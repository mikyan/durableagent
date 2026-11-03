import {CONVERSATION_EXTENSION} from '../../runtime/src/application-protocol';
// Each side loads its own implementation for this shared data-only identity.
export const builtInUiExtensions={[CONVERSATION_EXTENSION.id]:{descriptor:CONVERSATION_EXTENSION,load:()=>import('./extensions/conversation')}} as const;
