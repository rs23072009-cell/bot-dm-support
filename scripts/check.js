const fs = require("node:fs");
const files = ["index.js", "src/store.js", "deploy/bot-dm-support.service", ".env.example"];
const missing = files.filter(file => !fs.existsSync(file));
if (missing.length) { console.error("Fichiers manquants : " + missing.join(", ")); process.exit(1); }
console.log("Structure du bot DM Support valide.");

