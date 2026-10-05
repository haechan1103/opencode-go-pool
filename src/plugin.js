import { Pool } from './pool.js';
import { createHooks } from './hooks.js';

export default async function GoPoolPlugin(input, options = {}) {
  return createHooks(input, new Pool({ options }));
}
