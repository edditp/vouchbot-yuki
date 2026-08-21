const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder } = require('discord.js');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// Nutzt sicher die Umgebungsvariablen von Railway
const TOKEN = process.env.TOKEN;
const VOUCH_CHANNEL_ID = process.env.VOUCH_CHANNEL_ID;

let vouchCount = 0;
let lastStickyMessage = null;

// Befehle definieren
const commands = [
    new SlashCommandBuilder()
        .setName('stripe')
        .setDescription('Berechnet Stripe-Gebühren (Nur für Admins)')
        .setDefaultMemberPermissions(0) // Nur für Administratoren
        .addNumberOption(option => 
            option.setName('betrag')
                .setDescription('Der Betrag in Euro (z.B. 180)')
                .setRequired(true)),

    new SlashCommandBuilder()
        .setName('exchange')
        .setDescription('Berechnet den Paysafe-Exchange Kurs (10%)') // Beschreibung angepasst
        // .setDefaultMemberPermissions(0) -> HIER ENTFERNT, damit jeder den Befehl nutzen kann!
        .addNumberOption(option => 
            option.setName('betrag')
                .setDescription('Der Betrag in Euro (z.B. 180)')
                .setRequired(true))
].map(command => command.toJSON());

client.once('ready', async () => {
    console.log(`Eingeloggt als ${client.user.tag}!`);

    // Slash-Commands global registrieren
    const rest = new REST({ version: '10' }).setToken(TOKEN);
    try {
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: commands },
        );
        console.log('Slash-Commands erfolgreich registriert!');
    } catch (error) {
        console.error('Fehler beim Registrieren der Slash-Commands:', error);
    }
    
    const channel = await client.channels.fetch(VOUCH_CHANNEL_ID).catch(() => null);
    if (channel && channel.isTextBased()) {
        try {
            const messages = await channel.messages.fetch({ limit: 100 });
            vouchCount = messages.filter(msg => !msg.author.bot).size;
            console.log(`Initialisierte Vouches: ${vouchCount}`);
            await sendStickyMessage(channel);
        } catch (error) {
            console.error('Fehler beim Abrufen der Nachrichten:', error);
        }
    }
});

async function sendStickyMessage(channel) {
    if (lastStickyMessage) {
        try {
            await lastStickyMessage.delete();
        } catch (err) {}
    }

    const embed = new EmbedBuilder()
        .setColor(0x2b2d31)
        .setTitle('🌟 · VOUCH SYSTEM & STATISTIK')
        .setDescription('Vielen Dank für dein Vertrauen und die erfolgreichen Deals! Hier siehst du unsere aktuelle Live-Übersicht.')
        .addFields(
            { name: '📊 Gesamte Vouches', value: `\`\`\`fix\n${vouchCount} erfolgreiche Bewertungen\`\`\``, inline: false },
            { name: '💬 Einen Vouch hinterlassen', value: 'Schreibe dein Feedback oder deinen Vouch einfach direkt hier in den Chat.', inline: false }
        )
        .setThumbnail(channel.guild.iconURL({ dynamic: true }))
        .setFooter({ text: 'TP CHECKOUT • Offizielles Bewertungssystem', iconURL: client.user.displayAvatarURL() })
        .setTimestamp();

    try {
        lastStickyMessage = await channel.send({ embeds: [embed] });
    } catch (error) {
        console.error('Fehler beim Senden der Sticky Message:', error);
    }
}

// Event für Slash-Commands
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName } = interaction;
    const amount = interaction.options.getNumber('betrag');

    if (commandName === 'stripe') {
        const stripeStd = (amount - ((amount * 0.015) + 0.25)).toFixed(2);
        const stripeBus = (amount - ((amount * 0.028) + 0.25)).toFixed(2);

        const embed = new EmbedBuilder()
            .setColor('#635BFF')
            .setTitle(`Stripe Gebühren für ${amount.toFixed(2)} €`)
            .addFields(
                { name: '🇪🇺 EWR Standard (1,5% + 0,25 €)', value: `Du erhältst: **${stripeStd} €**`, inline: false },
                { name: '💼 EWR Firmenkarte (2,8% + 0,25 €)', value: `Du erhältst: **${stripeBus} €**`, inline: false }
            )
            .setTimestamp();

        await interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (commandName === 'exchange') {
        const pscAusgabe = (amount * 0.90).toFixed(2);

        const embed = new EmbedBuilder()
            .setColor('#00FF00')
            .setTitle(`Paysafe Exchange für ${amount.toFixed(2)} €`)
            .addFields(
                { name: '🔄 Fester Kurs (10% Abzug)', value: `Der Kunde erhält: **${pscAusgabe} €**\n*(Beispiel: ${amount} € ➔ ${pscAusgabe} €)*`, inline: false }
            )
            .setTimestamp();

        // ephemeral: true entfernt -> Antwort ist jetzt öffentlich im Chat sichtbar!
        await interaction.reply({ embeds: [embed] });
    }
});

// Event für Sticky Messages (Vouches)
client.on('messageCreate', async (message) => {
    if (message.channel.id !== VOUCH_CHANNEL_ID || message.author.bot) return;

    vouchCount++;

    setTimeout(async () => {
        await sendStickyMessage(message.channel);
    }, 1000);
});

client.login(TOKEN);