import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

// `npm run deck-bench`: the deck benchmark (src/recommend/bench/local.bench.ts),
// kept out of `npm test` because it reads local deck corpora and takes minutes
// once playtest judges are in.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/recommend/bench/**/*.bench.ts'],
  },
});
