import { configDefaults, defineProject } from 'vitest/config';

export default defineProject({
  test: {
    // A deployment copies the voice agent, tests included, into cdk.out as a Docker build context.
    exclude: [...configDefaults.exclude, 'cdk.out/**'],
  },
});
