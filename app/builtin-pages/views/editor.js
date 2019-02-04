/* globals DatArchive beaker monaco editor diffEditor localStorage hljs confirm sessionStorage location alert history */

import yo from 'yo-yo'
import {FSArchive} from 'beaker-virtual-fs'
import {Archive} from 'builtin-pages-lib'
import _get from 'lodash.get'
import * as sidebar from '../com/editor/sidebar'
import * as tabs from '../com/editor/tabs'
import * as toolbar from '../com/editor/toolbar'
import * as models from '../com/editor/models'
import * as toast from '../com/toast'
import {closeAllToggleables}  from '../com/toggleable2'
import renderFaviconPicker from '../com/settings/favicon-picker'

const DEFAULT_SIDEBAR_WIDTH = 200
const MIN_SIDEBAR_WIDTH = 100

var archive
var workingCheckoutVersion
var workingCheckout
var archiveFsRoot
var currentDiff
var isHistoricalVersion = false

var sidebarWidth
var isDraggingSidebar = false

// which should we use in keybindings?
var osUsesMetaKey = false

// setup
// =

window.addEventListener('editor-created', setup)

async function setupWorkingCheckout () {
  var vi = archive.url.indexOf('+')
  if (vi !== -1) {
    if (archive.url.endsWith('+latest')) {
      // HACK
      // use +latest to show latest
      // -prf
      workingCheckout = new Archive(archive.checkout().url)
      workingCheckoutVersion = 'latest'
    } else {
      // use given version
      workingCheckout = archive
    }

    workingCheckoutVersion = archive.url.slice(vi + 1)
    // is the version a number?
    if (workingCheckoutVersion == +workingCheckoutVersion) {
      isHistoricalVersion = true
    }
  } else if (_get(archive, 'info.userSettings.previewMode') && _get(archive, 'info.userSettings.isSaved')) {
    // HACK
    // default to showing the preview when previewMode is on, even if +preview isnt set
    // -prf
    workingCheckout = new Archive(archive.checkout('preview').url)
    workingCheckoutVersion = 'preview'
  } else {
    // use latest checkout
    workingCheckout = new Archive(archive.checkout().url)
    workingCheckoutVersion = 'latest'
  }
  await workingCheckout.setup()
  console.log(workingCheckout)
}

async function setup () {
  // load data
  let url = await parseLibraryUrl()
  let browserInfo = beaker.browser.getInfo()
  osUsesMetaKey = browserInfo.platform === 'darwin'

  // bind events
  window.addEventListener('beforeunload', onBeforeUnload)
  window.addEventListener('keydown', onGlobalKeydown)
  document.addEventListener('editor-rerender', update)
  document.addEventListener('editor-model-dirtied', update)
  document.addEventListener('editor-model-cleaned', update)
  document.addEventListener('editor-set-active', onSetActive)
  document.addEventListener('editor-save-active-model', onSaveActiveModel)
  document.addEventListener('editor-unload-model', onUnloadModel)
  document.addEventListener('editor-unload-all-models-except', onUnloadAllModelsExcept)
  document.addEventListener('editor-unload-all-models', onUnloadAllModels)
  document.addEventListener('editor-reorder-models', onReorderModels)
  document.addEventListener('editor-create-folder', onCreateFolder)
  document.addEventListener('editor-create-file', onCreateFile)
  document.addEventListener('editor-rename-file', onRenameFile)
  document.addEventListener('editor-delete-file', onDeleteFile)
  document.addEventListener('editor-open-file', onOpenFile)
  document.addEventListener('editor-commit-file', onCommitFile)
  document.addEventListener('editor-revert-file', onRevertFile)
  document.addEventListener('editor-commit-all', onCommitAll)
  document.addEventListener('editor-revert-all', onRevertAll)
  document.addEventListener('editor-diff-active-model', onDiffActiveModel)

  // setup the sidebar resizer
  setSidebarWidth(DEFAULT_SIDEBAR_WIDTH)
  var sidebarDragHandleEl = document.querySelector('#editor-sidebar-drag-handle')
  sidebarDragHandleEl.addEventListener('mousedown', onMousedownSidebarDragHandle)
  document.addEventListener('mouseup', onGlobalMouseup)
  document.addEventListener('mousemove', onGlobalMousemove)

  if (url) {
    ;archive = new Archive(url)
    await archive.setup()
    await setupWorkingCheckout()

    // load the archiveFS
    archiveFsRoot = new FSArchive(null, workingCheckout, archive.info)
    await sidebar.setArchiveFsRoot(archiveFsRoot)
    sidebar.configure({
      version: workingCheckoutVersion,
      previewMode: _get(archive, 'info.userSettings.previewMode')
    })

    let fileActStream = archive.watch()
    fileActStream.addEventListener('changed', onFilesChanged)
    if (_get(archive, 'info.userSettings.previewMode')) {
      fileActStream = workingCheckout.watch()
      fileActStream.addEventListener('changed', onFilesChanged)
    }

    let showDefaultFile = archiveFsRoot._files.find(v => {
      return v.name === 'index.html'
    })
    models.setActive(showDefaultFile)

    document.title = `Editor - ${_get(archive, 'info.title', 'Untitled')}`
  } else {
    let untitled = monaco.editor.createModel('')
    untitled.name = 'untitled'
    untitled.isEditable = true
    editor.setModel(untitled)
  }

  // ready archive diff
  if (workingCheckout.info.userSettings.previewMode) {
    await localCompare()
  }

  update()
}

async function localCompare () {
  currentDiff = await beaker.archives.diffLocalSyncPathListing(archive.url, {compareContent: true, shallow: true})
  sidebar.setCurrentDiff(currentDiff)

  // attach add/mod changes to the existing tree
  const checkNode = async (node) => {
    // check for diff
    var diff = currentDiff.find(diff => {
      if (diff.path === node._path) return true
      if (node._path.startsWith(diff.path + '/')) return true // is a child of this item
      return false
    })
    node.change = diff ? diff.change : false

    // recurse
    if (node.isContainer) {
      for (let c of node.children) {
        await checkNode(c)
      }
    }
  }
  await checkNode(archiveFsRoot)
}

async function parseLibraryUrl () {
  return window.location.pathname.slice(1)
}

function setSidebarWidth (width) {
  sidebarWidth = width

  var actualWidth = getActualSidebarWidth()
  if (actualWidth === 0) {
    document.querySelector('#editor-sidebar-drag-handle').classList.add('wide')
  } else {
    document.querySelector('#editor-sidebar-drag-handle').classList.remove('wide')
  }

  const setWidth = (sel, v) => {
    /** @type HTMLElement */(document.querySelector(sel)).style.width = v
  }
  setWidth('.editor-sidebar', `${actualWidth}px`)
  setWidth('.editor-container', `calc(100vw - ${actualWidth}px)`) // allows monaco to resize properly
}

function getActualSidebarWidth () {
  // if the width gets under the minimum, just hide
  return (sidebarWidth > MIN_SIDEBAR_WIDTH) ? sidebarWidth : 0
}

function getActiveFile () {
  var activeModel = models.getActive()
  return activeModel ? findArchiveFile(activeModel.uri.path.slice(1)) : null
}

function findArchiveFile (path) {
  var node = archiveFsRoot
  var pathParts = path.split(/[\\\/]/g)
  for (let filename of pathParts) {
    if (filename.length === 0) continue // first item in array might be empty
    if (!node.isContainer) return null // node not found (we ran into a file prematurely)
    node = node._files.find(n => n.name === filename) // move to next child in the tree
  }
  return node
}

// rendering
// =

function update () {
  if (archive) {
    yo.update(
      document.querySelector('.editor-sidebar'),
      yo`
        <div class="editor-sidebar" style="width: ${getActualSidebarWidth()}px">
          ${sidebar.render()}
        </div>
      `)
  } else {
    yo.update(
      document.querySelector('.editor-sidebar'),
      yo`
        <div class="editor-sidebar" style="width: ${getActualSidebarWidth()}px">
          <button class="btn primary">Open dat archive</button>
        </div>
      `
    )
  }
  yo.update(document.querySelector('.editor-tabs'), tabs.render(models.getModels()))
  updateToolbar()
}

function updateToolbar () {
  var opts = {
    previewMode: _get(archive, 'info.userSettings.previewMode')
  }
  yo.update(
    document.querySelector('.editor-toolbar'),
    toolbar.render(getActiveFile(), models.getActive(), opts)
  )
}

// event handlers
// =

function onMousedownSidebarDragHandle (e) {
  isDraggingSidebar = true
}

function onGlobalMouseup (e) {
  isDraggingSidebar = false
}

function onGlobalMousemove (e) {
  if (!isDraggingSidebar) return
  setSidebarWidth(e.clientX)
}

function onBeforeUnload (e) {
  if (models.checkForDirtyFiles()) {
    e.returnValue = 'You have unsaved changes, are you sure you want to leave?'
  }
}

function onGlobalKeydown (e) {
  var ctrlOrMeta = osUsesMetaKey ? e.metaKey : e.ctrlKey
  // cmd/ctrl + s
  if (ctrlOrMeta && e.keyCode == 83) {
    e.preventDefault()
    e.stopPropagation()
    onSaveActiveModel()
  }
}

async function onFilesChanged () {
  await sidebar.reloadTree()
  await localCompare()
  sidebar.rerender()
  updateToolbar()
}

async function onSelectFavicon (imageData) {
  let archive2 = await DatArchive.load('dat://' + archive.info.key) // instantiate a new archive with no version
  if (imageData) {
    await archive2.writeFile('/favicon.ico', imageData)
  } else {
    await archive2.unlink('/favicon.ico').catch(e => null)
    await beaker.sitedata.set(archive.url, 'favicon', '') // clear cache
  }
  closeAllToggleables()
  //render() will need to call this once we get the archive change issues fixed. That way the favicon will be updated whenever you open it.
}

function onSetActive (e) {
  models.setActive(e.detail.model)
}

function onUnloadModel (e) {
  models.unload(e.detail.model)
}

function onUnloadAllModelsExcept (e) {
  models.unloadOthers(e.detail.model)
}

function onUnloadAllModels (e) {
  models.unloadAllModels()
}

function onReorderModels (e) {
  models.reorderModels(e.detail.srcModel, e.detail.dstModel)
}

async function onCreateFile (e) {
  await op('Saving...', async () => {
    const {path} = e.detail
    await workingCheckout.writeFile(path, '')
    // TODO open the new file
  })
}

async function onCreateFolder (e) {
  await op('Saving...', async () => {
    const {path} = e.detail
    await workingCheckout.mkdir(path)
  })
}

async function onRenameFile (e) {
  await op('Renaming...', async () => {
    const {oldPath, newPath} = e.detail
    await workingCheckout.rename(oldPath, newPath)
  })
}

async function onDeleteFile (e) {
  await op('Deleting...', async () => {
    const {path, isFolder} = e.detail
    if (isFolder) {
      await workingCheckout.rmdir(path, {recursive: true})
    } else {
      await workingCheckout.unlink(path)
    }
    toast.create(`Deleted ${path}`, 1e3)
  })
}

function onOpenFile (e) {
  window.open(workingCheckout.url + e.detail.path)
}

async function onCommitFile (e) {
  await op('Committing...', async () => {
    const path = e.detail.path
    await beaker.archives.publishLocalSyncPathListing(archive.url, {paths: [path]})
    models.exitDiff()
    toast.create(`Committed ${path}`, 'success', 1e3)
  })
}

async function onRevertFile (e) {
  await op('Reverting...', async () => {
    const path = e.detail.path
    await beaker.archives.revertLocalSyncPathListing(archive.url, {paths: [path]})
    models.reload(findArchiveFile(path))
    models.exitDiff()
    toast.create(`Reverted ${path}`, 'success', 1e3)
  })
}

async function onCommitAll (e) {
  await op('Committing...', async () => {
    var paths = fileDiffsToPaths(currentDiff)
    await beaker.archives.publishLocalSyncPathListing(archive.url, {shallow: false, paths})
    models.exitDiff()
    toast.create(`Committed all changes`, 'success', 1e3)
  })
}

async function onRevertAll (e) {
  await op('Reverting...', async () => {
    var paths = fileDiffsToPaths(currentDiff)
    await beaker.archives.revertLocalSyncPathListing(archive.url, {shallow: false, paths})
    models.exitDiff()
    toast.create(`Reverted all changes`, 'success', 1e3)
  })
}

async function onDiffActiveModel (e) {
  await op('Diffing...', async () => {
    if (models.isShowingDiff()) {
      // toggle
      models.setActive(models.getActive())
      return
    }

    var active = models.getActive()
    var rightContent = active.getValue()

    // get left hand content
    var leftContent = ''
    if (workingCheckout.url.includes('+')) {
      // left is preview or historic, right should be latest
      leftContent = await workingCheckout.checkout().readFile(active.uri.path)
    } else {
      // left is latest, right should be preview
      leftContent = await workingCheckout.checkout('preview').readFile(active.uri.path)
    }

    models.setActiveDiff(leftContent, rightContent)
  })
}

async function onSaveActiveModel () {
  await op('Saving...', async () => {
    let model = models.getActive()
    let fileContent = model.getValue()
    let filePath = model.uri.path
    if (!filePath.startsWith('/')) {
      filePath = '/' + filePath
    }

    models.setVersionIdOnSave(model)
    await workingCheckout.writeFile(filePath, fileContent, 'utf8')
  })
}

// internal methods
// =

async function op (msg, fn) {
  const to = setTimeout(() => toast.create(msg), 500) // if it takes a while, toast
  try {
    await fn()
    update()
  } catch (e) {
    toast.create(e.toString(), 'error', 5e3)
  }
  clearTimeout(to)
}

function fileDiffsToPaths (filediff) {
  return filediff.map(d => {
    if (d.type === 'dir') return d.path + '/' // indicate that this is a folder
    return d.path
  })
}