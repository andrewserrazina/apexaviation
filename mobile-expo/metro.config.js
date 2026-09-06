// Apex Advantage mobile client -- Metro monorepo configuration.
//
// The wire-contract types in ../shared/mobile-dto/index.ts live OUTSIDE
// this project directory on purpose (see that file's own header comment):
// it is the one dependency-free source of truth shared with the Deno Edge
// Functions in ../portal/supabase/functions/. This app must import it
// directly, never copy/fork its interfaces -- so Metro needs to be told
// this is a (small, two-package) monorepo: watch the repo root in
// addition to this project so it can resolve a relative import that
// climbs out of mobile-expo/, while still resolving node_modules from
// this project first (never hoisting/duplicating native deps from the
// repo root, which has none).
const { getDefaultConfig } = require('expo/metro-config')
const path = require('path')

const projectRoot = __dirname
const workspaceRoot = path.resolve(projectRoot, '..')

const config = getDefaultConfig(projectRoot)

config.watchFolders = [workspaceRoot]
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, 'node_modules')]

module.exports = config
