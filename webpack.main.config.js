const path = require('path');

module.exports = (env, argv) => ({
  mode: argv.mode || 'development',
  entry: './src/main/index.ts',
  target: 'electron-main',
  devtool: argv.mode === 'production' ? false : 'source-map',
  output: {
    path: path.resolve(__dirname, 'dist/main'),
    filename: 'index.js',
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: { loader: 'ts-loader', options: { configFile: 'tsconfig.main.json' } },
        exclude: /node_modules/,
      },
    ],
  },
  resolve: { extensions: ['.ts', '.js'] },
  externals: {
    'fuse-native': 'commonjs fuse-native',
    keytar: 'commonjs keytar',
  },
  node: { __dirname: false, __filename: false },
});
