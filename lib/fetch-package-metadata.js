'use strict'

const log = require('npmlog')
const readPackageTree = require('read-package-tree')
const rimraf = require('rimraf')
const validate = require('aproba')
const normalizePackageData = require('normalize-package-data')
const npm = require('./npm')
const npmlog = require('npmlog')
const limit = require('call-limit')
const tempFilename = require('./utils/temp-filename.js')
const pacote = require('pacote')
const pacoteOpts = require('./config/pacote')

function andLogAndFinish (spec, tracker, done) {
  validate('SF', [spec, done])
  return (er, pkg) => {
    if (er) {
      log.silly('fetchPackageMetaData', 'error for ' + spec, er)
      if (tracker) tracker.finish()
    }
    return done(er, pkg)
  }
}

module.exports = limit(fetchPackageMetadata, npm.limit.fetch)
function fetchPackageMetadata (spec, where, tracker, done) {
  if (!done) {
    done = tracker || where
    tracker = null
    if (done === where) where = null
  }
  if (typeof spec === 'object') {
    var dep = spec
    spec = dep.raw
  }
  const logAndFinish = andLogAndFinish(spec, tracker, done)
  pacote.manifest(dep, pacoteOpts({
    where: where,
    log: tracker || npmlog
  })).then((pkg) => {
    if (pkg) {
      pkg._from = pkg._from || dep.raw
    }
    addRequestedAndFinish(null, pkg)
  }, logAndFinish)
  function addRequestedAndFinish (er, pkg) {
    if (pkg) annotateMetadata(pkg, dep, spec, where)
    logAndFinish(er, pkg)
  }
}

module.exports.annotateMetadata = annotateMetadata
function annotateMetadata (pkg, requested, spec, where) {
  validate('OOSS', arguments)
  pkg._requested = requested
  pkg._spec = spec
  pkg._where = where
  if (!pkg._args) pkg._args = []
  pkg._args.push([requested, where])
  // non-npm registries can and will return unnormalized data, plus
  // even the npm registry may have package data normalized with older
  // normalization rules. This ensures we get package data in a consistent,
  // stable format.
  try {
    normalizePackageData(pkg)
  } catch (ex) {
    // don't care
  }
}

module.exports.addBundled = addBundled
function addBundled (pkg, next) {
  validate('OF', arguments)
  if (pkg._bundled !== undefined) return next(null, pkg)
  if (!pkg.bundleDependencies) return next(null, pkg)
  pkg._bundled = null
  const pkgname = pkg.name
  const ver = pkg.version
  const target = tempFilename('unpack')
  const opts = pacoteOpts({digest: pkg._shasum})
  pacote.extract(pkgname + '@' + ver, target, opts).then(() => {
    log.silly('addBundled', 'read tarball')
    readPackageTree(target, function (er, tree) {
      log.silly('cleanup', 'remove extracted module')
      rimraf(target, function () {
        if (tree) {
          pkg._bundled = tree.children
        }
        next(null, pkg)
      })
    })
  }, next)
}
