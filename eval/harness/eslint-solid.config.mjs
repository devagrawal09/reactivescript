// The Solid arm's lint: eslint-plugin-solid's Solid 2 config.
import tseslint from "typescript-eslint";
import solid from "eslint-plugin-solid/configs/v2";

export default [
  { files: ["src/**/*.{ts,tsx}"], languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } } },
  { files: ["src/**/*.{ts,tsx}"], ...solid },
];
