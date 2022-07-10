const config = require("@src/config")["default"];

// Always enable debug logging during tests.
config.debugLogging = true;

// However, some things we only want to check when testing or
// some things will break testing.  This lets them know when
// we're running in a test environment.
config.inTestEnv = true;