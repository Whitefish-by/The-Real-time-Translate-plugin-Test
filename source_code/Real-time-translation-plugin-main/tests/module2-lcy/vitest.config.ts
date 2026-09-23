import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['tests/module2-lcy/*.test.ts'], fileParallelism: false } });
