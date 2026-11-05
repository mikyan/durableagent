import {defineConfig} from 'vitest/config';
import react from '@vitejs/plugin-react';
export default defineConfig({
  base:'./', plugins:[react()],
  build:{target:'es2022',sourcemap:false},
  test:{include:['test/**/*.test.ts','test/**/*.test.tsx','test/**/*.test.mjs'],restoreMocks:true}
});
