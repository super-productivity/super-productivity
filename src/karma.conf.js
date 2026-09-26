// Karma configuration file, see link for more information
// https://karma-runner.github.io/1.0/config/configuration-file.html

const path = require('node:path');

module.exports = function (config) {
  // NOTE: necessary to fix some of the unit tests with a timezone in them
  // NOTE2: won't work for wallaby, but that's maybe ok for now
  // process.env.TZ = 'Europe/Berlin';
  const isCodeCoverage = Boolean(config.buildWebpack?.options?.codeCoverage);
  const reporters = ['spec', 'running-spec'];

  if (isCodeCoverage) {
    reporters.push('coverage-istanbul');
  }

  config.set({
    basePath: '',
    frameworks: ['jasmine', '@angular-devkit/build-angular'],
    plugins: [
      require('karma-jasmine'),
      require('karma-chrome-launcher'),
      require('@angular-devkit/build-angular/plugins/karma'),
      require('./test-helpers/karma-running-spec-on-disconnect'),
      require('karma-coverage-istanbul-reporter'),
      require('karma-spec-reporter'),
    ],
    client: {
      clearContext: false, // leave Jasmine Spec Runner output visible in browser
      captureConsole: false,
    },
    reporters,
    specReporter: {
      maxLogLines: 5, // limit number of lines logged per test
      suppressSummary: false, // show summary
      suppressErrorSummary: false, // show error summary
      suppressFailed: false, // show failed tests
      suppressPassed: true, // hide passed tests
      suppressSkipped: true, // hide skipped tests
      showBrowser: false, // don't show browser name
      showSpecTiming: false, // don't show spec timing
      failFast: false, // continue after first failure
    },
    coverageIstanbulReporter: {
      dir: path.join(__dirname, '..', 'coverage', 'sp2'),
      reports: ['html', 'text-summary'],
      combineBrowserReports: true,
      fixWebpackSourcePaths: true,
      skipFilesWithNoCoverage: true,
    },
    port: 9876,
    colors: true,
    logLevel: config.LOG_INFO,
    autoWatch: true,
    browsers: ['ChromeHeadless'],
    singleRun: false,
    customLaunchers: {
      ChromeHeadless: {
        base: 'Chrome',
        flags: [
          // We must disable the Chrome sandbox when running Chrome inside Docker
          // (Chrome's sandbox needs more permissions than Docker allows by default)
          '--headless',
          '--no-sandbox',
          '--disable-gpu',
          '--no-default-browser-check',
          '--no-first-run',
          '--disable-default-apps',
          '--disable-popup-blocking',
          '--disable-translate',
          '--disable-background-timer-throttling',
          '--disable-renderer-backgrounding',
          '--disable-device-discovery-notifications',
          // Without a remote debugging port, Google Chrome exits immediately.
          '--remote-debugging-port=9222',
          '--disable-web-security',
          // Additional performance optimizations
          '--disable-dev-shm-usage', // Overcome limited resource problems
          '--disable-software-rasterizer',
          '--disable-extensions',
          '--disable-setuid-sandbox',
          '--disable-logging',
          '--disable-background-networking',
          '--disable-sync',
          '--disable-features=VizDisplayCompositor', // Disable GPU compositor
          '--enable-features=NetworkService,NetworkServiceInProcess',
        ],
        debug: true,
      },
    },
    browserNoActivityTimeout: 30000, // time before killing browser if no signal (30s for CI stability)
    browserDisconnectTimeout: 5000, // time to wait after disconnection
    browserDisconnectTolerance: 2, // retry twice if disconnect occurs
    captureTimeout: 60000, // time to wait for browser to capture (60s for slower CI)
    reportSlowerThan: 500,
  });
};
