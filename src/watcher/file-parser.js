const path = require("path");

const FILENAME_REGEX = /^(cdr|cmr)_(\w+)_(\d+)_(\d+)_(\d+)$/;

function parseFilename(filename) {
  const basename = path.basename(filename);
  const match = basename.match(FILENAME_REGEX);
  if (!match) return null;
  return {
    type: match[1],
    cluster: match[2],
    node: match[3],
    date: match[4],
    sequence: match[5],
  };
}

module.exports = { parseFilename };
