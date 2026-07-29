const path = require("path");

module.exports = {
  webpack: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
    configure: (webpackConfig) => {
      webpackConfig.ignoreWarnings = webpackConfig.ignoreWarnings || [];
      webpackConfig.ignoreWarnings.push({
        module: /web-ifc-api\.js$/,
        message:
          /Critical dependency: require function is used in a way in which dependencies cannot be statically extracted/,
      });
      return webpackConfig;
    },
  },
  // No COOP/COEP headers here on purpose. web-ifc-api.js picks its
  // multi-threaded WASM build whenever `self.crossOriginIsolated` is true,
  // but that build's worker script (web-ifc-mt.worker.js) isn't shipped as a
  // fetchable file in the web-ifc npm package — enabling cross-origin
  // isolation just makes the loader request a worker script that 404s.
  // Staying non-isolated keeps web-ifc on its single-threaded build
  // (web-ifc.wasm only, no worker needed), which is what useModelLoader.js
  // is set up for. See public/wasm/README.md.
};