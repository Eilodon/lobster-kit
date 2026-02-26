import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
    },
    resolve: {
        alias: {
            '@eidolon/defi-bnb': resolve(__dirname, '../defi-bnb/src'),
            '@eidolon/core': resolve(__dirname, '../core/src'),
            '@eidolon/soul': resolve(__dirname, '../soul/src'),
            '@eidolon/toolkit': resolve(__dirname, '../toolkit/src')
        }
    }
});
