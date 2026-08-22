const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder, ChannelType } = require('discord.js');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers // Wichtig für Live-Statistiken
    ]
});

// Nutzt sicher die Umgebungsvariablen für Token & Vouch-Channel von Railway
const TOKEN = process.env.TOKEN;
const VOUCH_CHANNEL_ID = process.env.VOUCH_CHANNEL_ID;

// Direkt eingetragene Statistik-Kanal-ID
const STATS_MEMBERS_ID = '1540564623286214717'; 
const STATS_BOTS_ID = ''; // Optional (leer lassen)

let vouchCount = 0;
let lastStickyMessage = null;

const commands = [
    new SlashCommandBuilder()
        .setName('stripe')
        .setDescription('Berechnet Stripe-Gebühren (Nur für Admins)')
        .setDefaultMemberPermissions(0)
        .addNumberOption(option => 
            option.setName('betrag')
                .setDescription('Der Betrag in Euro (z.B. 180)')
                .setRequired(true)),
    new SlashCommandBuilder()
        .setName('exchange')
        .setDescription('Berechnet den Paysafe-Exchange Kurs (10%)')
        .addNumberOption(option => 
            option.setName('betrag')
                .setDescription('Der Betrag in Euro (z.B. 180)')
                .setRequired(true))
].map(command => command.toJSON());

client.once('ready', async () => {
    console.log(`Eingeloggt als ${client.user.tag}!`);

    // Slash-Commands registrieren
    const rest = new REST({ version: '10' }).setToken(TOKEN);
    try {
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log('Slash-Commands erfolgreich registriert!');
    } catch (error) {
        console.error('Fehler bei Slash-Commands:', error);
    }
    
    // Vouches initialisieren
    const channel = await client.channels.fetch(VOUCH_CHANNEL_ID).catch(() => null);
    if (channel && channel.isTextBased()) {
        const messages = await channel.messages.fetch({ limit: 100 });
        vouchCount = messages.filter(msg => !msg.author.bot).size;
        await sendStickyMessage(channel);
    }

    // Statistiken beim Start einmal aktualisieren
    client.guilds.cache.forEach(guild => updateServerStats(guild));
    
    // Intervall: Alle 15 Minuten Statistiken aktualisieren
    setInterval(() => {
        client.guilds.cache.forEach(guild => updateServerStats(guild));
    }, 15 * 60 * 1000);
});

// Funktion für Server-Statistiken
async function updateServerStats(guild) {
    try {
        if (STATS_MEMBERS_ID) {
            const memberChannel = guild.channels.cache.get(STATS_MEMBERS_ID);
            if (memberChannel && memberChannel.type === ChannelType.GuildVoice) {
                const memberCount = guild.memberCount;
                await memberChannel.setName(`📊 Mitglieder: ${memberCount}`);
                console.log(`Mitglieder-Statistik aktualisiert: ${memberCount}`);
            } else {
                console.log('Mitglieder-Kanal nicht gefunden oder kein Sprachkanal (ChannelType.GuildVoice)!');
            }
        }
        
        if (STATS_BOTS_ID) {
            await guild.members.fetch();
            const botCount = guild.members.cache.filter(member => member.user.bot).size;
            const botChannel = guild.channels.cache.get(STATS_BOTS_ID);
            if (botChannel && botChannel.type === ChannelType.GuildVoice) {
                await botChannel.setName(`🤖 Bots: ${botCount}`);
            }
        }
    } catch (error) {
        console.error('Fehler beim Aktualisieren der Server-Stats:', error);
    }
}

// Events für Live-Update bei Beitritt/Verlassen
client.on('guildMemberAdd', (member) => updateServerStats(member.guild));
client.on('guildMemberRemove', (member) => updateServerStats(member.guild));

async function sendStickyMessage(channel) {
    if (lastStickyMessage) try { await lastStickyMessage.delete(); } catch (err) {}

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

    lastStickyMessage = await channel.send({ embeds: [embed] });
}

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
            );
        await interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (commandName === 'exchange') {
        const pscAusgabe = (amount * 0.90).toFixed(2);
        const embed = new EmbedBuilder()
            .setColor('#00FF00')
            .setTitle(`Paysafe Exchange für ${amount.toFixed(2)} €`)
            .addFields({ name: '🔄 Fester Kurs (10% Abzug)', value: `Der Kunde erhält: **${pscAusgabe} €**`, inline: false });
        await interaction.reply({ embeds: [embed] });
    }
});

client.on('messageCreate', async (message) => {
    if (message.channel.id !== VOUCH_CHANNEL_ID || message.author.bot) return;
    vouchCount++;
    setTimeout(async () => await sendStickyMessage(message.channel), 1000);
});

client.login(TOKEN);