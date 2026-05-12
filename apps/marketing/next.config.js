// eslint-disable-next-line @typescript-eslint/no-require-imports
const nextra = require("nextra").default || require("nextra");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
};

const withNextra = nextra({
  latex: true,
  search: {
    codeblocks: false,
  },
  contentDirBasePath: "/docs",
});

module.exports = withNextra(nextConfig);
