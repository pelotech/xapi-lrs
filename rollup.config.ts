import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import swc from '@rollup/plugin-swc';
import { defineConfig } from 'rollup';

const external = ['pg', 'pino', 'pino-http', 'express'];

export default defineConfig({
  input: 'src/main.ts',
  output: {
    file: 'dist/main.js',
    format: 'es',
  },

  external: (id: string) => {
    for (const name of external) {
      if (id === name || id.startsWith(`${name}/`)) return true;
    }
    return id.startsWith('node:');
  },

  plugins: [
    nodeResolve({
      preferBuiltins: true,
      extensions: ['.ts', '.js', '.mjs', '.json'],
    }),
    commonjs(),
    json(),
    swc(),
  ],
});
