// The React arm's lint: the hooks rules, including the React Compiler's (eslint-plugin-react-hooks 7 `recommended`).
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  { files: ["src/**/*.{ts,tsx}"], languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } } },
  { files: ["src/**/*.{ts,tsx}"], ...reactHooks.configs.flat.recommended },
];
