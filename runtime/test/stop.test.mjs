import test from 'node:test';
import {stopPolicyCases} from '../validation/stop-policy.mjs';
for(const entry of stopPolicyCases)test(entry.name,()=>entry.run());
