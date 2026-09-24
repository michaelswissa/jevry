import { contextBridge, ipcRenderer } from "electron";
const call =
  (name: string) =>
  (...args: unknown[]) =>
    ipcRenderer.invoke(`jevry:${name}`, ...args);
const subscribe = (name: string) => (callback: (payload: any) => void) => {
  const listener = (_event: unknown, payload: unknown) => callback(payload);
  ipcRenderer.on(`jevry:${name}`, listener);
  return () => ipcRenderer.removeListener(`jevry:${name}`, listener);
};
contextBridge.exposeInMainWorld("jevry", {
  sendMessage: call("sendMessage"),
  renameConversation: call("renameConversation"),
  deleteConversation: call("deleteConversation"),
  newConversation: call("newConversation"),
  selectConversation: call("selectConversation"),
  state: call("state"),
  status: call("status"),
  connectText: call("connectText"),
  connectJev: call("connectJev"),
  finishSetup: call("finishSetup"),
  disconnect: call("disconnect"),
  setEffects: call("setEffects"),
  newTab: call("newTab"),
  closeTab: call("closeTab"),
  selectTab: call("selectTab"),
  navigate: call("navigate"),
  browserAction: call("browserAction"),
  setBounds: call("setBounds"),
  research: call("research"),
  run: call("run"),
  stop: call("stop"),
  screenshot: call("screenshot"),
  exportTrace: call("exportTrace"),
  openExternal: call("openExternal"),
  windowAction: call("windowAction"),
  onShortcut: subscribe("shortcut"),
  onState: subscribe("state"),
  onEvent: subscribe("event"),
  onAuthProgress: subscribe("authProgress"),
});
