const fs = require("node:fs");
const path = require("node:path");
class Store {
  constructor(file) {
    this.file = path.resolve(file);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    this.data = { guilds: {}, tickets: {} };
    try { this.data = { ...this.data, ...JSON.parse(fs.readFileSync(this.file, "utf8")) }; }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  save() { const tmp = this.file + ".tmp"; fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2)); fs.renameSync(tmp, this.file); }
  guild(id) { return this.data.guilds[id] || null; }
  setGuild(id, value) { this.data.guilds[id] = { ...(this.data.guilds[id] || {}), ...value }; this.save(); }
  byUser(id) { return Object.values(this.data.tickets).find(item => item.userId === id && item.open) || null; }
  byChannel(id) { return Object.values(this.data.tickets).find(item => item.channelId === id && item.open) || null; }
  setTicket(id, value) { this.data.tickets[id] = value; this.save(); }
  close(id) { if (this.data.tickets[id]) this.data.tickets[id].open = false; this.save(); }
}
module.exports = Store;

