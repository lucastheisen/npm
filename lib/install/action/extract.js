'use strict'

const path = require('path')
const iferr = require('iferr')
const asyncMap = require('slide').asyncMap
const fs = require('graceful-fs')
const mkdirp = require('mkdirp')
const move = require('../../utils/move.js')
const gentlyRm = require('../../utils/gently-rm.js')
const updatePackageJson = require('../update-package-json')
const npm = require('../../npm.js')
const moduleName = require('../../utils/module-name.js')
const packageId = require('../../utils/package-id.js')
const moduleStagingPath = require('../module-staging-path.js')
const pacote = require('pacote')
const pacoteOpts = require('../../config/pacote')
const readJson = require('read-package-json')

module.exports = extract
function extract (staging, pkg, log, next) {
  log.silly('extract', packageId(pkg))
  const up = npm.config.get('unsafe-perm')
  const user = up ? null : npm.config.get('user')
  const group = up ? null : npm.config.get('group')
  const extractTo = moduleStagingPath(staging, pkg)
  const opts = pacoteOpts({
    uid: user,
    gid: group,
    digest: pkg.package._shasum
  })
  pacote.extract(
    pkg.package._requested,
    extractTo,
    opts
  ).then(
    andUpdatePackageJson(pkg, staging, extractTo,
    andStageBundledChildren(pkg, staging, extractTo, log,
    andRemoveExtraneousBundles(extractTo, next))),
  next)
}

function andUpdatePackageJson (pkg, staging, extractTo, next) {
  return iferr(next, () => {
    readJson(path.join(extractTo, 'package.json'), iferr(next, (json) => {
      // TODO - use the version in @iarna's PR. This is temporary.
      json.version = pkg.package.version
      json.dependencies = pkg.package.dependencies
      json.devDependencies = pkg.package.devDependencies
      json.optionalDependencies = pkg.package.optionalDependencies
      json._requested = pkg.package._requested
      json._resolved = pkg.package._resolved
      json._from = pkg.package._from
      json._shasum = pkg.package._shasum
      pkg.package = json
      updatePackageJson(pkg, extractTo, next)
    }))
  })
}

function andStageBundledChildren (pkg, staging, extractTo, log, next) {
  return iferr(next, () => {
    if (!pkg.package.bundleDependencies) return next()

    asyncMap(pkg.children, andStageBundledModule(pkg, staging, extractTo), next)
  })
}

function andRemoveExtraneousBundles (extractTo, next) {
  return iferr(next, () => {
    gentlyRm(path.join(extractTo, 'node_modules'), next)
  })
}

function andStageBundledModule (bundler, staging, parentPath) {
  return (child, next) => {
    if (child.error) return next(child.error)
    stageBundledModule(bundler, child, staging, parentPath, next)
  }
}

function getTree (pkg) {
  while (pkg.parent) pkg = pkg.parent
  return pkg
}

function warn (pkg, code, msg) {
  const tree = getTree(pkg)
  const err = new Error(msg)
  err.code = code
  tree.warnings.push(err)
}

function stageBundledModule (bundler, child, staging, parentPath, next) {
  const stageFrom = path.join(parentPath, 'node_modules', child.package.name)
  const stageTo = moduleStagingPath(staging, child)

  return asyncMap(child.children, andStageBundledModule(bundler, staging, stageFrom), iferr(next, finishModule))

  function finishModule () {
    // If we were the one's who bundled this module…
    if (child.fromBundle === bundler) {
      return moveModule()
    } else {
      return checkForReplacement()
    }
  }

  function moveModule () {
    return mkdirp(path.dirname(stageTo), iferr(next, () => {
      return move(stageFrom, stageTo, iferr(next, updateMovedPackageJson))
    }))
  }

  function checkForReplacement () {
    return fs.stat(stageFrom, function (notExists, exists) {
      if (exists) {
        warn(bundler, 'EBUNDLEOVERRIDE', 'In ' + packageId(bundler) +
          ' replacing bundled version of ' + moduleName(child) +
          ' with ' + packageId(child))
        return gentlyRm(stageFrom, next)
      } else {
        return next()
      }
    })
  }

  function updateMovedPackageJson () {
    updatePackageJson(child, stageTo, next)
  }
}
