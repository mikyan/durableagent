import {CONVERSATION_EXTENSION} from '../../runtime/src/application-protocol';
import {MODELS_EXTENSION} from '../../runtime/src/model-protocol';
import {PROJECTS_EXTENSION} from '../../runtime/src/project-protocol';
// Each side loads its own implementation for this shared data-only identity.
export const builtInUiExtensions={
  [CONVERSATION_EXTENSION.id]:{descriptor:CONVERSATION_EXTENSION,load:()=>import('./extensions/conversation')},
  [MODELS_EXTENSION.id]:{descriptor:MODELS_EXTENSION,load:()=>import('./extensions/models')},
  [PROJECTS_EXTENSION.id]:{descriptor:PROJECTS_EXTENSION,load:()=>import('./extensions/projects')}
} as const;
