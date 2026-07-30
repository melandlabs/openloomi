import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    cli: "src/cli.ts",
    server: "src/server.ts",
  },
  dts: true,
  format: ["esm"],
  platform: "node",
  target: "node18",
  splitting: false,
  clean: true,
});
