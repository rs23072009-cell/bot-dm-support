require("dotenv").config();
const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, Client, EmbedBuilder,
  Events, GatewayIntentBits, Partials, PermissionFlagsBits, REST, Routes,
  ModalBuilder, SlashCommandBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle
} = require("discord.js");
const Store = require("./src/store");

const token = process.env.DISCORD_TOKEN?.trim();
if (!token) throw new Error("DISCORD_TOKEN manquant.");
const owners = new Set((process.env.OWNER_IDS || "949707800257384498").split(",").map(id => id.trim()).filter(Boolean));
const store = new Store(process.env.DATA_FILE || "./data/dm-support.json");
const COLOR = 0xd63384;
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.DirectMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Channel]
});

const supportCommand = new SlashCommandBuilder().setName("dmsupport").setDescription("Configure et gère Tokina DM Support")
  .addSubcommand(c => c.setName("setup").setDescription("Configure le support")
    .addRoleOption(o => o.setName("role_staff").setDescription("Rôle autorisé à répondre").setRequired(true)))
  .addSubcommand(c => c.setName("pole").setDescription("Associer un motif de demande à un rôle")
    .addStringOption(o => o.setName("raison").setDescription("Motif concerné").setRequired(true).addChoices(
      { name: "Besoin d’aide", value: "aide" },
      { name: "Signalement", value: "signalement" },
      { name: "Partenariat", value: "partenariat" },
      { name: "Autre demande", value: "autre" }
    ))
    .addRoleOption(o => o.setName("role").setDescription("Rôle du pôle à notifier").setRequired(true)))
  .addSubcommand(c => c.setName("modifier-panel").setDescription("Modifier le panneau d'accueil envoyé en DM"))
  .addSubcommand(c => c.setName("tester-panel").setDescription("Prévisualiser le panneau d'accueil sur le serveur"))
  .addSubcommand(c => c.setName("statut").setDescription("Affiche la configuration"))
  .addSubcommand(c => c.setName("fermer").setDescription("Ferme le ticket actuel"));
const memberOption = command => command.addStringOption(o => o.setName("personne")
  .setDescription("Mention ou identifiant Discord").setMinLength(2).setMaxLength(30).setRequired(true));
const addCommand = memberOption(new SlashCommandBuilder().setName("add").setDescription("Ajouter une personne au ticket DM"));
const removeCommand = memberOption(new SlashCommandBuilder().setName("remove").setDescription("Retirer une personne du ticket DM"));
const delCommand = memberOption(new SlashCommandBuilder().setName("del").setDescription("Retirer une personne du ticket DM"));
const renameCommand = new SlashCommandBuilder().setName("rename").setDescription("Renommer le ticket DM")
  .addStringOption(o => o.setName("nom").setDescription("Nouveau nom").setMinLength(1).setMaxLength(90).setRequired(true));
const closeCommand = new SlashCommandBuilder().setName("close").setDescription("Fermer le ticket DM");
const commands = [supportCommand, addCommand, removeCommand, delCommand, renameCommand, closeCommand]
  .map(command => command.toJSON());

const reasons = {
  aide: { label: "Besoin d’aide", emoji: "🛟" },
  signalement: { label: "Signalement", emoji: "🚩" },
  partenariat: { label: "Partenariat", emoji: "🤝" },
  autre: { label: "Autre demande", emoji: "💬" }
};

function canConfigure(member) {
  return Boolean(member && owners.has(member.id));
}
function canManageTicket(member, ticket, config) {
  if (!member || !ticket || !config) return false;
  if (canConfigure(member)) return true;
  const poleRoleId = config.reasonRoles?.[ticket.reason] || config.staffRoleId;
  return member.roles.cache.has(config.staffRoleId) || member.roles.cache.has(poleRoleId);
}
async function resolveMember(guild, raw) {
  const id = String(raw || "").match(/\d{17,20}/)?.[0];
  return id ? guild.members.fetch(id).catch(() => null) : null;
}
function safeChannelName(value) {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 90) || "dm-support";
}
const DEFAULT_WELCOME_PANEL = {
  title: "Tokina — Besoin d’aide",
  description: [
    "Merci d’avoir contacté **Tokina**. Une personne de l’équipe prendra en charge ta demande.",
    "", "Il s’agit d’un humain qui va te répondre, merci de rester respectueux.", "",
    "**Ta demande concerne quelle raison ?**", "Choisis une raison ci-dessous pour ouvrir un ticket."
  ].join("\n"),
  footer: ""
};

function welcomePanel(config) {
  return { ...DEFAULT_WELCOME_PANEL, ...(config?.welcomePanel || {}) };
}
function welcomePayload(config, options = {}) {
  const content = welcomePanel(config);
  const embed = new EmbedBuilder().setColor(COLOR).setTitle(content.title).setDescription(content.description);
  if (content.footer) embed.setFooter({ text: content.footer });
  const menu = new StringSelectMenuBuilder().setCustomId("dmsupport:reason").setPlaceholder("Choisis une raison")
    .setDisabled(Boolean(options.disabled))
    .addOptions(Object.entries(reasons).map(([value, item]) => ({ value, label: item.label, emoji: item.emoji })));
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)] };
}
async function showWelcomeEditor(interaction) {
  const content = welcomePanel(store.guild(interaction.guildId));
  const modal = new ModalBuilder().setCustomId("dmsupport:welcome-edit").setTitle("Modifier le panneau d’accueil")
    .addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("title").setLabel("Titre")
        .setStyle(TextInputStyle.Short).setMinLength(1).setMaxLength(256).setRequired(true).setValue(content.title.slice(0, 256))),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("description").setLabel("Contenu Markdown")
        .setStyle(TextInputStyle.Paragraph).setMinLength(1).setMaxLength(4000).setRequired(true).setValue(content.description.slice(0, 4000))),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("footer").setLabel("Pied de page facultatif")
        .setStyle(TextInputStyle.Short).setMaxLength(2000).setRequired(false).setValue(content.footer.slice(0, 2000)))
    );
  return interaction.showModal(modal);
}
async function saveWelcomeEditor(interaction) {
  if (!canConfigure(interaction.member)) {
    return interaction.reply({ content: "Tu n’as pas accès à cette commande.", ephemeral: true });
  }
  const welcomePanel = {
    title: interaction.fields.getTextInputValue("title").trim(),
    description: interaction.fields.getTextInputValue("description").trim(),
    footer: interaction.fields.getTextInputValue("footer").trim()
  };
  store.setGuild(interaction.guildId, { welcomePanel });
  return interaction.reply({
    content: "✅ Panneau enregistré. Voici sa prévisualisation :",
    ...welcomePayload({ welcomePanel }, { disabled: true }),
    ephemeral: true
  });
}
function ticketPayload(user, reason, roleId) {
  const close = new ButtonBuilder().setCustomId("dmsupport:close").setLabel("🔒 Fermer").setStyle(ButtonStyle.Danger);
  const embed = new EmbedBuilder().setColor(COLOR)
    .setAuthor({ name: "Tokina • DM Support", iconURL: user.client.user.displayAvatarURL() })
    .setTitle(`${reason.emoji} ${reason.label}`)
    .setDescription([
      `Bienvenue <@${user.id}> dans ton espace de support privé.`,
      "Explique clairement ta demande : le pôle concerné te répondra directement ici.",
      "",
      "**Demandeur**",
      `> <@${user.id}> • \`${user.id}\``,
      "",
      "**Pôle contacté**",
      `> <@&${roleId}>`,
      "",
      "**Prise en charge**",
      "> *En attente d’un membre du pôle*"
    ].join("\n"))
    .setThumbnail(user.displayAvatarURL({ extension: "png", size: 256 }))
    .setFooter({ text: "Tokina • Support privé" })
    .setTimestamp();
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(close)] };
}
function channelName(user) {
  const name = user.username.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return ("dm-" + (name || user.id)).slice(0, 90);
}
async function targetGuild() {
  for (const [id, config] of Object.entries(store.data.guilds)) {
    const guild = client.guilds.cache.get(id);
    if (guild && config.staffRoleId) return { guild, config };
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
  let category = config.categoryId && await guild.channels.fetch(config.categoryId).catch(() => null);
  if (!category || category.type !== ChannelType.GuildCategory) {
    category = guild.channels.cache.find(channel => channel.type === ChannelType.GuildCategory && channel.name === "DM・SUPPORT");
  }
  if (!category) {
    category = await guild.channels.create({
      name: "DM・SUPPORT",
      type: ChannelType.GuildCategory,
      permissionOverwrites: [
        { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: config.staffRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
        { id: guild.members.me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.MentionEveryone] }
      ]
    });
  }
  store.setGuild(guild.id, { categoryId: category.id });
  const reason = reasons[reasonKey] || reasons.autre;
  const poleRoleId = config.reasonRoles?.[reasonKey] || config.staffRoleId;
  const channel = await guild.channels.create({
    name: channelName(user), type: ChannelType.GuildText, parent: category.id,
    topic: "DM Support • " + user.tag + " • " + user.id + " • " + reason.label,
    permissionOverwrites: [
      { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: poleRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks] },
      ...(poleRoleId !== config.staffRoleId ? [{ id: config.staffRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }] : []),
      { id: guild.members.me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.MentionEveryone] }
    ]
  });
  await channel.send({
    content: `🔔 <@&${poleRoleId}> • Nouvelle demande **${reason.label}**`,
    ...ticketPayload(user, reason, poleRoleId),
    allowedMentions: { roles: [poleRoleId] }
  });
  const ticket = { userId: user.id, guildId: guild.id, channelId: channel.id, reason: reasonKey, open: true, openedAt: Date.now() };
  store.setTicket(user.id, ticket);
  await log(guild, "Ticket ouvert pour **" + user.tag + "** dans " + channel.toString() + ".");
  return { current: false, ticket };
}
async function manageTicketCommand(interaction) {
  const ticket = store.byChannel(interaction.channelId);
  if (!ticket) {
    return interaction.reply({ content: "Cette commande fonctionne uniquement dans un ticket DM ouvert.", ephemeral: true });
  }
  const config = store.guild(interaction.guildId);
  if (!canManageTicket(interaction.member, ticket, config)) {
    return interaction.reply({ content: "Seuls le pôle configuré, le staff général et les Owners peuvent gérer ce ticket.", ephemeral: true });
  }
  const command = interaction.commandName;
  if (command === "close") {
    await interaction.reply({ content: "Fermeture du ticket…", ephemeral: true });
    return closeTicket(ticket, interaction.user);
  }
  if (command === "rename") {
    const name = safeChannelName(interaction.options.getString("nom", true));
    await interaction.channel.setName(name, "Ticket DM renommé par " + interaction.user.tag);
    return interaction.reply({ content: "✅ Ticket renommé en **" + name + "**.", ephemeral: true });
  }
  const member = await resolveMember(interaction.guild, interaction.options.getString("personne", true));
  if (!member) return interaction.reply({ content: "Membre introuvable. Utilise une mention ou son identifiant Discord.", ephemeral: true });
  if (command === "add") {
    await interaction.channel.permissionOverwrites.edit(member.id, {
      ViewChannel: true, SendMessages: true, ReadMessageHistory: true, AttachFiles: true, EmbedLinks: true
    }, { reason: "Ajout au ticket DM par " + interaction.user.tag });
    return interaction.reply({ content: "✅ " + member.toString() + " a été ajouté au ticket.", allowedMentions: { parse: [] } });
  }
  await interaction.channel.permissionOverwrites.edit(member.id, {
    ViewChannel: false, SendMessages: false
  }, { reason: "Retrait du ticket DM par " + interaction.user.tag });
  return interaction.reply({ content: "✅ " + member.toString() + " a été retiré du ticket.", allowedMentions: { parse: [] } });
}

async function closeTicket(ticket, actor) {
  const guild = client.guilds.cache.get(ticket.guildId);
  const channel = guild && await guild.channels.fetch(ticket.channelId).catch(() => null);
  const user = await client.users.fetch(ticket.userId).catch(() => null);
  store.close(ticket.userId);
  if (user) await user.send({ embeds: [new EmbedBuilder().setColor(COLOR).setTitle("Demande fermée").setDescription("Ton ticket a été fermé. Tu peux renvoyer un message à Tokina si tu as encore besoin d’aide.")] }).catch(() => {});
  if (guild) await log(guild, "Ticket de <@" + ticket.userId + "> fermé par **" + actor.tag + "**.");
  if (channel) {
    await channel.send("Ticket fermé. Suppression dans 5 secondes.").catch(() => {});
    const timer = setTimeout(async () => {
      await channel.delete("Ticket DM fermé").catch(() => {});
      const hasOpenTicket = Object.values(store.data.tickets).some(item => item.guildId === ticket.guildId && item.open);
      if (hasOpenTicket) return;
      const currentConfig = store.guild(ticket.guildId);
      const category = currentConfig?.categoryId && await guild.channels.fetch(currentConfig.categoryId).catch(() => null);
      if (category?.type === ChannelType.GuildCategory && category.children.cache.size === 0) {
        await category.delete("Dernier ticket DM fermé").catch(() => {});
        store.setGuild(ticket.guildId, { categoryId: null });
      }
    }, 5000);
    timer.unref?.();
  }
}
async function toTicket(message, ticket) {
  const guild = client.guilds.cache.get(ticket.guildId);
  const channel = guild && await guild.channels.fetch(ticket.channelId).catch(() => null);
  if (!channel?.isTextBased()) {
    store.close(message.author.id);
    const target = await targetGuild();
    return message.channel.send(welcomePayload(target?.config));
  }
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
    if (ticket) return toTicket(message, ticket);
    const target = await targetGuild();
    return message.channel.send(welcomePayload(target?.config));
  }
  const ticket = store.byChannel(message.channel.id);
  if (ticket) return toUser(message, ticket);
});
client.on(Events.InteractionCreate, async interaction => {
  if (interaction.isModalSubmit() && interaction.customId === "dmsupport:welcome-edit" && interaction.guild) {
    return saveWelcomeEditor(interaction);
  }
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
    const config = store.guild(interaction.guildId);
    if (!canManageTicket(interaction.member, ticket, config)) {
      return interaction.reply({ content: "Tu n’as pas accès à ce ticket.", ephemeral: true });
    }
    await interaction.reply({ content: "Fermeture du ticket…", ephemeral: true });
    return closeTicket(ticket, interaction.user);
  }
  if (!interaction.isChatInputCommand() || !interaction.guild) return;
  if (["add", "remove", "del", "rename", "close"].includes(interaction.commandName)) {
    return manageTicketCommand(interaction);
  }
  if (interaction.commandName !== "dmsupport") return;
  const action = interaction.options.getSubcommand();
  if (action === "fermer") {
    const ticket = store.byChannel(interaction.channelId);
    if (!ticket) return interaction.reply({ content: "Utilise cette commande dans un ticket.", ephemeral: true });
    const config = store.guild(interaction.guildId);
    if (!canManageTicket(interaction.member, ticket, config)) {
      return interaction.reply({ content: "Tu n’as pas accès à ce ticket.", ephemeral: true });
    }
    await interaction.reply({ content: "Fermeture du ticket…", ephemeral: true });
    return closeTicket(ticket, interaction.user);
  }
  if (!canConfigure(interaction.member)) return interaction.reply({ content: "Tu n’as pas accès à cette commande.", ephemeral: true });
  if (action === "pole") {
    const reason = interaction.options.getString("raison", true);
    const role = interaction.options.getRole("role", true);
    const current = store.guild(interaction.guildId);
    if (!current?.staffRoleId) {
      return interaction.reply({ content: "Configure d’abord le bot avec `/dmsupport setup`.", ephemeral: true });
    }
    store.setGuild(interaction.guildId, {
      reasonRoles: { ...(current.reasonRoles || {}), [reason]: role.id }
    });
    return interaction.reply({
      content: `✅ Le motif **${reasons[reason].label}** notifiera désormais ${role}.`,
      ephemeral: true,
      allowedMentions: { parse: [] }
    });
  }
  if (action === "modifier-panel") return showWelcomeEditor(interaction);
  if (action === "tester-panel") {
    return interaction.reply({
      content: "Prévisualisation du panneau envoyé en message privé :",
      ...welcomePayload(store.guild(interaction.guildId), { disabled: true }),
      ephemeral: true
    });
  }
  if (action === "setup") {
    const role = interaction.options.getRole("role_staff", true);
    const previous = store.guild(interaction.guildId);
    const oldCategory = previous?.categoryId && await interaction.guild.channels.fetch(previous.categoryId).catch(() => null);
    const hasOpenTicket = Object.values(store.data.tickets).some(item => item.guildId === interaction.guildId && item.open);
    if (oldCategory?.type === ChannelType.GuildCategory && !hasOpenTicket && oldCategory.children.cache.size === 0) await oldCategory.delete("Aucun ticket DM ouvert").catch(() => {});
    store.setGuild(interaction.guildId, { categoryId: hasOpenTicket ? oldCategory?.id || null : null, staffRoleId: role.id, logChannelId: null });
    return interaction.reply({ content: "Support configuré pour " + role.toString() + ". La catégorie sera créée automatiquement au premier ticket.", ephemeral: true });
  }
  const config = store.guild(interaction.guildId);
  const mappings = config
    ? Object.entries(reasons).map(([key, reason]) => `${reason.emoji} **${reason.label}** : <@&${config.reasonRoles?.[key] || config.staffRoleId}>`).join("\n")
    : "";
  return interaction.reply({
    content: config
      ? "Rôle staff général : <@&" + config.staffRoleId + ">\nCatégorie actuelle : " + (config.categoryId ? "<#" + config.categoryId + ">" : "aucune — créée au prochain ticket") + "\n\n**Pôles configurés**\n" + mappings
      : "Support non configuré.",
    ephemeral: true,
    allowedMentions: { parse: [] }
  });
});
client.login(token);

