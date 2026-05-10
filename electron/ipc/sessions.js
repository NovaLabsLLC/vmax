// IPC: chat / agent sessions persistence.

const { app, ipcMain } = require("electron");
const sessions = require("../../utils/sessions.js");
const { sendToCommandCenter } = require("../ipcBus.js");

function broadcastSessionsUpdated() {
  sendToCommandCenter("sessions:updated");
}

function register() {
  ipcMain.handle("sessions:list", () => sessions.list(app));
  ipcMain.handle("sessions:get", (_evt, id) => sessions.get(app, id));
  ipcMain.handle("sessions:save", (_evt, s) => {
    const out = sessions.save(app, s);
    broadcastSessionsUpdated();
    return out;
  });
  ipcMain.handle("sessions:delete", (_evt, id) => {
    sessions.remove(app, id);
    broadcastSessionsUpdated();
  });
  ipcMain.handle("sessions:new", (_evt, seed) => {
    const out = sessions.create(app, seed || {});
    broadcastSessionsUpdated();
    return out;
  });
}

module.exports = { register };
