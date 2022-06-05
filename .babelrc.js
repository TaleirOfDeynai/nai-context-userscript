/** @type {import("@babel/core").ConfigFunction} */
module.exports = (api) => {
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
