import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { ESLint } from "eslint";

const require = createRequire(import.meta.url);
const legacy = require("minimatch");
for (const name of ["eslint", "@eslint/config-array", "@eslint/eslintrc",
  "eslint-plugin-import", "eslint-plugin-react", "eslint-plugin-jsx-a11y"]) {
  const consumer = createRequire(require.resolve(name));
  assert.equal(consumer("minimatch"), legacy, `${name} must use the compatibility adapter`);
}
const upstream = createRequire(require.resolve("minimatch"));
assert.equal(upstream("minimatch/package.json").version, "11.0.3");
assert.equal(legacy.Minimatch, upstream("minimatch").Minimatch);

for (const [file, pattern, options, expected] of [
  ["app/page.tsx", "**/*.{ts,tsx}", {}, true],
  ["app/page.js", "**/*.{ts,tsx}", {}, false],
  [".next/server.js", "**/*.js", {}, false],
  [".next/server.js", "**/*.js", { dot: true }, true],
  ["app/page.tsx", "*.tsx", { matchBase: true }, true],
  ["app/page.tsx", "!**/*.js", {}, true],
  ["app/page.tsx", "**/+(page|layout).tsx", {}, true],
  ["C:/repo/app/page.tsx", "C:/**/*.tsx", {}, true],
]) {
  assert.equal(legacy(file, pattern, options), expected);
  assert.equal(new legacy.Minimatch(pattern, options).match(file), expected);
  assert.equal(legacy.makeRe(pattern, options).test(file), expected);
}
assert.deepEqual(legacy.match(["a.ts", "b.js"], "*.ts"), ["a.ts"]);
assert.deepEqual(["a.ts", "b.js"].filter(legacy.filter("*.ts")), ["a.ts"]);
assert.equal(legacy.defaults({ dot: true })(".hidden.ts", "*.ts"), true);

const eslint = new ESLint();
assert.equal(await eslint.isPathIgnored(".next/server.js"), true);
assert.equal(await eslint.isPathIgnored("app/page.tsx"), false);
const [configured] = await eslint.lintText("const unused: number = 1;\n", { filePath: "app/lint-fixture.ts" });
assert.equal(configured.fatalErrorCount, 0);
assert(configured.messages.some((m) => m.ruleId === "@typescript-eslint/no-unused-vars"));

// Exercise plugin paths that invoke the legacy callable and makeRe().test API.
const pluginLint = new ESLint({
  overrideConfigFile: true,
  overrideConfig: [{
    files: ["**/*.{js,jsx}"],
    languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: {
      import: require("eslint-plugin-import"),
      react: require("eslint-plugin-react"),
      "jsx-a11y": require("eslint-plugin-jsx-a11y"),
    },
    rules: {
      "import/no-internal-modules": ["error", { forbid: ["private/**"] }],
      "import/no-unassigned-import": ["error", { allow: ["**/*.css"] }],
      "react/jsx-pascal-case": ["error", { ignore: ["Allowed_*"] }],
      "jsx-a11y/label-has-associated-control": ["error", { controlComponents: ["Field*"] }],
    },
  }],
});
const [valid] = await pluginLint.lintText(
  'import "./styles.css"; const v = <><Allowed_Name/><label>Name<FieldInput/></label></>;',
  { filePath: "fixture.jsx" },
);
assert.deepEqual(valid.messages, []);
const [invalid] = await pluginLint.lintText(
  'import x from "private/secret"; const v = <><Bad_Name/><label>Name</label></>;',
  { filePath: "fixture.jsx" },
);
assert.equal(invalid.fatalErrorCount, 0);
for (const rule of ["import/no-internal-modules", "react/jsx-pascal-case", "jsx-a11y/label-has-associated-control"]) {
  assert(invalid.messages.some((m) => m.ruleId === rule), `${rule} must still reject violations`);
}
console.log("ESLint dependency compatibility and active rule checks passed");
