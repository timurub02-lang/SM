// eslint-disable-next-line @typescript-eslint/no-require-imports -- These consumers require a callable CommonJS export.
const { minimatch, Minimatch } = require("minimatch");

// Legacy ESLint plugins call the default export; all matching uses upstream v11.
module.exports = Object.assign((...args) => minimatch(...args), minimatch, {
  // import/no-internal-modules only consumes makeRe(...).test(path).
  makeRe(pattern, options) {
    const matcher = new Minimatch(pattern, options);
    return { test: (path) => matcher.match(path) };
  },
});
