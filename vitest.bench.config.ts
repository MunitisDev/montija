import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Benchmarks, kept out of the ordinary test run.
 *
 * They take minutes rather than seconds and report measurements rather than
 * asserting them, because a threshold that depends on the machine it ran on has
 * no business failing a build.
 */
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    // The measurements are the whole output; the default reporter hides them.
    reporters: ['verbose'],
    include: ['bench/**/*.bench.ts'],
    // Benchmarks measure each other's noise if they share a process.
    fileParallelism: false,
    testTimeout: 300_000,
  },
});
