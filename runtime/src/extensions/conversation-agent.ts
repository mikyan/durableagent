import {CONVERSATION_EXTENSION,type ApplicationMethod} from '../application-protocol.js';

/** Bundled Agent-side registration. The fixed core retains storage, startup gates and stop. */
export function installConversationAgent(register:(extension:{id:string;actions:readonly ApplicationMethod[]})=>void) {
  register(CONVERSATION_EXTENSION);
}
