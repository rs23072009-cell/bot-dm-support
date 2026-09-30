const fs = require("node:fs");
const files = ["index.js", "src/store.js", "deploy/bot-dm-support.service", ".env.example"];
const missing = files.filter(file => !fs.existsSync(file));
if (missing.length) { console.error("Fichiers manquants : " + missing.join(", ")); process.exit(1); }
const source = fs.readFileSync('index.js', 'utf8');
for (const forbidden of ["member.id === member.guild.ownerId","member.permissions.has(PermissionFlagsBits.Administrator)",".setDefaultMemberPermissions(PermissionFlagsBits.Administrator)"]) {
  if (source.includes(forbidden)) throw new Error('Accès implicite encore présent : ' + forbidden);
}
console.log('Structure et accès explicites de bot dm support valides.');
