'use strict';

const { generatedZsyncFiles } = require('./appimage-artifact-built');

module.exports = async function afterAllArtifactBuild(result) {
  // Only publish sidecars actually generated during this process. In
  // particular, don't publish a stale zsync left in the output directory.
  const produced = [...generatedZsyncFiles].filter((file) =>
    result.artifactPaths.includes(file.slice(0, -'.zsync'.length)),
  );
  return produced;
};
