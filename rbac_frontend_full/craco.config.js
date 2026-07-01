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
  devServer: {
    // Required for SharedArrayBuffer, which web-ifc's multi-threaded WASM needs
    // to create WebAssembly.Memory({ shared: true }).
    //
    // We use COEP "credentialless" rather than "require-corp" so that public
    // cross-origin resources without a CORP header (OpenStreetMap map tiles and
    // the OSM embed iframe) still load — they're fetched without credentials,
    // which is fine for public tiles. "require-corp" blocked them with
    // ERR_BLOCKED_BY_RESPONSE.NotSameOriginAfterDefaultedToSameOriginByCoep.
    // Cross-origin isolation (and SharedArrayBuffer) stays enabled.
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "credentialless",
    },
  },
};
