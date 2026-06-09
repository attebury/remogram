#!/usr/bin/env node
import { runCli } from '../index.js';

runCli(process.argv.slice(2)).catch((err) => {
  console.error(err.message || String(err));
  process.exit(1);
});
