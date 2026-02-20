import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        include: ['{test,tests}/**/*.{test,spec}.ts', 'packages/*/{test,tests}/**/*.{test,spec}.ts'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json', 'html'],
            include: ['src/**/*.ts'],
            exclude: ['src/types.ts', 'src/**/index.ts']
        },
        hookTimeout: 20000,
        testTimeout: 20000
    },
});
