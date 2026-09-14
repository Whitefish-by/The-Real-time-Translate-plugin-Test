import { build } from 'esbuild';
await build({ entryPoints: ['apps/extension/src/realtime-client.ts'], bundle: true, platform: 'browser', format: 'iife', globalName: 'LCYClient', outfile: 'tests/module1-lcy/generated/client.js' });
