'use strict'

const { contextBridge, ipcRenderer } = require('electron')

function exposeListener(channel, callback) {
  ipcRenderer.on(channel, callback)
  return () => {
    ipcRenderer.removeListener(channel, callback)
  }
}

contextBridge.exposeInMainWorld('electronAPI', {
  onNewFile: (listener) => exposeListener('menu:new-file', listener),
  onOpenFile: (listener) => exposeListener('menu:open-file', listener),
  onSaveFile: (listener) => exposeListener('menu:save-file', listener),
  onSaveAsFile: (listener) => exposeListener('menu:save-as-file', listener),
  onVersionHistory: (listener) => exposeListener('menu:version-history', listener),
  saveFile: (content) => ipcRenderer.invoke('file:save', content),
  saveFileAs: (content) => ipcRenderer.invoke('file:save-as', content),
  autoSaveFile: (content) => ipcRenderer.invoke('file:auto-save', content),
  listAutoSaveFiles: () => ipcRenderer.invoke('file:list-autosave'),
  readAutoSaveFile: (filePath) => ipcRenderer.invoke('file:read-autosave', filePath),
  setDirty: (isDirty) => ipcRenderer.send('file:set-dirty', Boolean(isDirty))
})