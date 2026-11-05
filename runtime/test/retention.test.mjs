import test from 'node:test';
import {retentionChecks} from '../validation/retention-policy.mjs';
for(const check of retentionChecks())test(check.name,check.run);
