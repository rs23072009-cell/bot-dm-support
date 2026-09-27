require("dotenv").config();
const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, Client, EmbedBuilder,
  Events, GatewayIntentBits, Partials, PermissionFlagsBits, REST, Routes,
  SlashCommandBuilder, StringSelectMenuBuilder
} = require("discord.js");
const Store = require("./src/store");

const token = process.env.DISCORD_TOKEN?.trim();
if (!token) throw new Error("DISCORD_TOKEN manquant.");
const owners = new Set((process.env.OWNER_IDS || "949707800257384498").split(",").map(id => id.trim()).filter(Boolean));
const store = new Store(process.env.DATA_FILE || "./data/dm-support.json");
const COLOR = 0xf59e0b;
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.DirectMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Channel]
});

const commands = [new SlashCommandBuilder().setName("dmsupport").setDescription("Configure et gère Tokina DM Support")
  .addSubcommand(c => c.setName("setup").setDescription("Configure le support")
    .addChannelOption(o => o.setName("categorie").setDescription("Catégorie des tickets").addChannelTypes(ChannelType.GuildCategory).setRequired(true))
    .addRoleOption(o => o.setName("role_staff").setDescription("Rôle autorisé à répondre").setRequired(true))
    .addChannelOption(o => o.setName("salon_logs").setDescription("Salon des journaux").addChannelTypes(ChannelType.GuildText)))
  .addSubcommand(c => c.setName("statut").setDescription("Affiche la configuration"))
  .addSubcommand(c => c.setName("fermer").setDescription("Ferme le ticket actuel"))].map(command => command.toJSON());

const reasons = {
  aide: { label: "Besoin d’aide", emoji: "🛟" },
  signalement: { label: "Signalement", emoji: "🚩" },
  partenariat: { label: "Partenariat", emoji: "🤝" },
  autre: { label: "Autre demande", emoji: "💬" }
};

function canConfigure(member) {
  return owners.has(member.id) || member.id === member.guild.ownerId || member.permissions.has(PermissionFlagsBits.Administrator);
}
function welcomePayload() {
  const embed = new EmbedBuilder().setColor(COLOR).setTitle("Tokina — Besoin d’aide").setDescription([
    "Merci d’avoir contacté **Tokina**. Une personne de l’équipe prendra en charge ta demande.",
    "", "Il s’agit d’un humain qui va te répondre, merci de rester respectueux.", "",
    "**Ta demande concerne quelle raison ?**", "Choisis une raison ci-dessous pour ouvrir un ticket."
  ].join("\n"));
  const menu = new StringSelectMenuBuilder().setCustomId("dmsupport:reason").setPlaceholder("Choisis une raison")
    .addOptions(Object.entries(reasons).map(([value, item]) => ({ value, label: item.label, emoji: item.emoji })));
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)] };
}
function ticketPayload(user, reason) {
  const close = new ButtonBuilder().setCustomId("dmsupport:close").setLabel("Fermer le ticket").setStyle(ButtonStyle.Danger);
  const embed = new EmbedBuilder().setColor(COLOR).setTitle("Nouvelle demande")
    .setDescription("Membre : <@" + user.id + ">\nUtilisateur : **" + user.tag + "**\nID : " + user.id + "\nRaison : **" + reason.label + "**\n\nRépondez directement dans ce salon.")
    .setThumbnail(user.displayAvatarURL({ extension: "png", size: 128 }));
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(close)], allowedMentions: { parse: [] } };
}
function channelName(user) {
  const name = user.username.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return ("dm-" + (name || user.id)).slice(0, 90);
}
async function targetGuild() {
  for (const [id, config] of Object.entries(store.data.guilds)) {
    const guild = client.guilds.cache.get(id);
    if (guild && config.categoryId && config.staffRoleId) return { guild, config };
  }
  return null;
}
async function log(guild, text) {
  const id = store.guild(guild.id)?.logChannelId;
  const channel = id && await guild.channels.fetch(id).catch(() => null);
  if (channel?.isTextBased()) await channel.send({ embeds: [new EmbedBuilder().setColor(COLOR).setDescription(text).setTimestamp()], allowedMentions: { parse: [] } }).catch(() => {});
}
async function openTicket(user, reasonKey) {
  const current = store.byUser(user.id);
  if (current) return { current: true, ticket: current };
  const target = await targetGuild();
  if (!target) throw new Error("Support non configuré.");
  const { guild, config } = target;
  const channel = await guild.channels.create({
    name: channelName(user), type: ChannelType.GuildText, parent: config.categoryId,
    topic: "DM Support • " + user.tag + " • " + user.id,
    permissionOverwrites: [
      { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: config.staffRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks] },
      { id: guild.members.me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ReadMessageHistory] }
    ]
  });
  const reason = reasons[reasonKey] || reasons.autre;
  await channel.send(ticketPayload(user, reason));
  const ticket = { userId: user.id, guildId: guild.id, channelId: channel.id, reason: reasonKey, open: true, openedAt: Date.now() };
  store.setTicket(user.id, ticket);
  await log(guild, "Ticket ouvert pour **" + user.tag + "** dans " + channel.toString() + ".");
  return { current: false, ticket };
}
async function closeTicket(ticket, actor) {
  const guild = client.guilds.cache.get(ticket.guildId);
  const channel = guild && await guild.channels.fetch(ticket.channelId).catch(() => null);
  const user = await client.users.fetch(ticket.userId).catch(() => null);
  store.close(ticket.userId);
  if (user) await user.send({ embeds: [new EmbedBuilder().setColor(COLOR).setTitle("Demande fermée").setDescription("Ton ticket a été fermé. Tu peux renvoyer un message à Tokina si tu as encore besoin d’aide.")] }).catch(() => {});
  if (guild) await log(guild, "Ticket de <@" + ticket.userId + "> fermé par **" + actor.tag + "**.");
  if (channel) { await channel.send("Ticket fermé. Suppression dans 5 secondes.").catch(() => {}); setTimeout(() => channel.delete("Ticket DM fermé").catch(() => {}), 5000).unref?.(); }
}
async function toTicket(message, ticket) {
  const guild = client.guilds.cache.get(ticket.guildId);
  const channel = guild && await guild.channels.fetch(ticket.channelId).catch(() => null);
  if (!channel?.isTextBased()) { store.close(message.author.id); return message.channel.send(welcomePayload()); }
  const files = [...message.attachments.values()].map(file => file.url);
  const embed = new EmbedBuilder().setColor(COLOR).setAuthor({ name: message.author.tag, iconURL: message.author.displayAvatarURL() }).setDescription(message.content || "*Pièce jointe*").setTimestamp();
  await channel.send({ embeds: [embed], files, allowedMentions: { parse: [] } });
  await message.react("✅").catch(() => {});
}
async function toUser(message, ticket) {
  const user = await client.users.fetch(ticket.userId).catch(() => null);
  if (!user) return;
  const files = [...message.attachments.values()].map(file => file.url);
  const embed = new EmbedBuilder().setColor(COLOR).setAuthor({ name: "Équipe Tokina" }).setDescription(message.content || "*Pièce jointe*").setTimestamp();
  await user.send({ embeds: [embed], files }).catch(() => message.reply("Impossible d’envoyer ce message : les DM du membre sont fermés."));
  await message.react("✅").catch(() => {});
}

client.once(Events.ClientReady, async ready => {
  await new REST({ version: "10" }).setToken(token).put(Routes.applicationCommands(ready.user.id), { body: commands });
  console.log("Tokina DM Support connecté : " + ready.user.tag);
});
client.on(Events.MessageCreate, async message => {
  if (message.author.bot) return;
  if (!message.guild) {
    const ticket = store.byUser(message.author.id);
    return ticket ? toTicket(message, ticket) : message.channel.send(welcomePayload());
  }
  const ticket = store.byChannel(message.channel.id);
  if (ticket) return toUser(message, ticket);
});
client.on(Events.InteractionCreate, async interaction => {
  if (interaction.isStringSelectMenu() && interaction.customId === "dmsupport:reason") {
    await interaction.deferReply({ ephemeral: true });
    try {
      const result = await openTicket(interaction.user, interaction.values[0]);
      return interaction.editReply(result.current ? "Tu as déjà une demande ouverte. Ton prochain message sera transmis." : "Ta demande est ouverte. Envoie maintenant ton message ici, en DM.");
    } catch (error) { console.error(error); return interaction.editReply("Le support n’est pas encore configuré."); }
  }
  if (interaction.isButton() && interaction.customId === "dmsupport:close") {
    const ticket = store.byChannel(interaction.channelId);
    if (!ticket) return interaction.reply({ content: "Ce ticket est déjà fermé.", ephemeral: true });
    await interaction.reply({ content: "Fermeture du ticket…", ephemeral: true });
    return closeTicket(ticket, interaction.user);
  }
  if (!interaction.isChatInputCommand() || interaction.commandName !== "dmsupport" || !interaction.guild) return;
  const action = interaction.options.getSubcommand();
  if (action === "fermer") {
    const ticket = store.byChannel(interaction.channelId);
    if (!ticket) return interaction.reply({ content: "Utilise cette commande dans un ticket.", ephemeral: true });
    await interaction.reply({ content: "Fermeture du ticket…", ephemeral: true });
    return closeTicket(ticket, interaction.user);
  }
  if (!canConfigure(interaction.member)) return interaction.reply({ content: "Tu n’as pas accès à cette commande.", ephemeral: true });
  if (action === "setup") {
    const category = interaction.options.getChannel("categorie", true);
    const role = interaction.options.getRole("role_staff", true);
    const logs = interaction.options.getChannel("salon_logs");
    store.setGuild(interaction.guildId, { categoryId: category.id, staffRoleId: role.id, logChannelId: logs?.id || null });
    return interaction.reply({ content: "Support configuré dans **" + category.name + "** pour " + role.toString() + ".", ephemeral: true });
  }
  const config = store.guild(interaction.guildId);
  return interaction.reply({ content: config ? "Catégorie : <#" + config.categoryId + ">\nRôle staff : <@&" + config.staffRoleId + ">\nLogs : " + (config.logChannelId ? "<#" + config.logChannelId + ">" : "désactivés") : "Support non configuré.", ephemeral: true, allowedMentions: { parse: [] } });
});
client.login(token);

