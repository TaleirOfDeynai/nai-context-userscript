/** @type {import("@babel/core").ConfigFunction} */
module.exports = (api) => {
  // @ts-ignore - It's own error message says this exists.
  // Why did it start complaining about the cache NOW, months since
  // I started this project and instead of using reasonable defaults?
  // Fuck if I know!
  api.cache(() => process.env.NODE_ENV ?? "production");

  const baseConfig = {
    presets: [
      ["@babel/preset-react"]
    ],
    plugins: [
      "@babel/plugin-proposal-class-properties"
    ]
  };

  return baseConfig;
};
