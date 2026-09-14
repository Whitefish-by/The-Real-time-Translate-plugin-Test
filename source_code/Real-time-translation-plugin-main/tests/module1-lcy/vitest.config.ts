import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['tests/module1-lcy/*.test.ts'], testTimeout: 10000, hookTimeout: 10000, fileParallelism: false } });
