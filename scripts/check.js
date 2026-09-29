const fs = require("node:fs");
const files = ["index.js", "src/store.js", "deploy/bot-dm-support.service", ".env.example"];
const missing = files.filter(file => !fs.existsSync(file));
if (missing.length) { console.error("Fichiers manquants : " + missing.join(", ")); process.exit(1); }
console.log("Structure du bot DM Support valide.");


const source = fs.readFileSync("index.js", "utf8");
for (const feature of ["modifier-panel", "tester-panel", "dmsupport:welcome-edit", "setName(\"pole\")", "reasonRoles", "setName(\"add\")", "setName(\"remove\")", "setName(\"del\")", "setName(\"rename\")", "setName(\"close\")", "canManageTicket"]) {
  if (!source.includes(feature)) {
    console.error("Fonctionnalité DM Support manquante : " + feature);
    process.exit(1);
  }
}
console.log("Configuration, aperçu et routage des pôles validés.");
