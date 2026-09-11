const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder, ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const express = require('express');
const { v4: uuidv4 } = require('uuid');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers // Wichtig für Live-Statistiken
    ]
});

const app = express();
app.set('trust proxy', 1); // Wichtig für Railway/Proxies
const PORT = process.env.PORT || 3000;

// Speichert aktive Verifizierungen: Token -> Discord User ID
const pendingVerifications = new Map();

// Umgebungsvariablen von Railway
const TOKEN = process.env.TOKEN;
const VOUCH_CHANNEL_ID = process.env.VOUCH_CHANNEL_ID;
// Optional: Web-URL für den Link (wichtig für Railway, z.B. https://dein-projekt.up.railway.app)
const WEB_URL = process.env.WEB_URL || `http://localhost:${PORT}`;

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
                .setRequired(true)),
    new SlashCommandBuilder()
        .setName('setup-verify')
        .setDescription('Sendet das Verifizierungs-Embed mit Button in den Kanal (Nur Admins)')
        .setDefaultMemberPermissions(0)
].map(command => command.toJSON());

// --- EXPRESS WEBSEITE (VERIFIZIERUNG & IP-ERFASSUNG) ---
app.get('/verify', (req, res) => {
    const { token } = req.query;

    if (!token || !pendingVerifications.has(token)) {
        return res.status(400).send('<h1>Ungültiger oder abgelaufener Link.</h1>');
    }

    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    console.log(`[VERIFY] IP erfasst: ${clientIp}`);

    res.send(`
        <!DOCTYPE html>
        <html lang="de">
        <head>
            <meta charset="UTF-8">
            <title>Discord Verifizierung</title>
            <style>
                body { font-family: Arial, sans-serif; background: #121212; color: #fff; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
                .card { background: #1e1e1e; padding: 40px; border-radius: 8px; text-align: center; box-shadow: 0 4px 15px rgba(0,0,0,0.5); }
                button { background: #5865F2; color: white; border: none; padding: 12px 24px; font-size: 16px; border-radius: 4px; cursor: pointer; margin-top: 20px; }
                button:hover { background: #4752C4; }
            </style>
        </head>
        <body>
            <div class="card">
                <h2>Server Verifizierung</h2>
                <p>Klicke unten, um deine Verifizierung abzuschließen.</p>
                <form action="/complete?token=${token}" method="POST">
                    <button type="submit">Jetzt verifizieren</button>
                </form>
            </div>
        </body>
        </html>
    `);
});

app.post('/complete', async (req, res) => {
    const { token } = req.query;

    if (!token || !pendingVerifications.has(token)) {
        return res.status(400).send('<h1>Fehler: Ungültiger oder abgelaufener Link.</h1>');
    }

    const userId = pendingVerifications.get(token);
    pendingVerifications.delete(token);

    try {
        const guild = await client.guilds.fetch('1465511874199290082');
        const member = await guild.members.fetch(userId);
        const role = guild.roles.cache.get('1486063719825018913');

        if (member && role) {
            await member.roles.add(role);
            res.send('<h1>Erfolgreich verifiziert! Du kannst dieses Fenster jetzt schließen und zu Discord zurückkehren.</h1>');
        } else {
            res.send('<h1>Fehler: Konnte Rolle nicht zuweisen (Mitglied oder Rolle nicht gefunden).</h1>');
        }
    } catch (error) {
        console.error(error);
        res.send('<h1>Ein interner Fehler ist aufgetreten.</h1>');
    }
});

app.listen(PORT, () => {
    console.log(`Webserver läuft auf Port ${PORT}`);
});


// --- DISCORD BOT LOGIK ---
client.once('ready', async () => {
    console.log(`Eingeloggt als ${client.user.tag}!`);

    const rest = new REST({ version: '10' }).setToken(TOKEN);
    try {
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log('Slash-Commands erfolgreich registriert!');
    } catch (error) {
        console.error('Fehler bei Slash-Commands:', error);
    }
    
    const channel = await client.channels.fetch(VOUCH_CHANNEL_ID).catch(() => null);
    if (channel && channel.isTextBased()) {
        const messages = await channel.messages.fetch({ limit: 100 });
        vouchCount = messages.filter(msg => !msg.author.bot).size;
        await sendStickyMessage(channel);
    }

    client.guilds.cache.forEach(guild => updateServerStats(guild));
    
    setInterval(() => {
        client.guilds.cache.forEach(guild => updateServerStats(guild));
    }, 15 * 60 * 1000);
});

async function updateServerStats(guild) {
    try {
        if (STATS_MEMBERS_ID) {
            const memberChannel = guild.channels.cache.get(STATS_MEMBERS_ID);
            if (memberChannel && memberChannel.type === ChannelType.GuildVoice) {
                const memberCount = guild.memberCount;
                await memberChannel.setName(`📊 Mitglieder: ${memberCount}`);
            }
        }
    } catch (error) {
        console.error('Fehler beim Aktualisieren der Server-Stats:', error);
    }
}

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
    // Buttons verarbeiten (Direktantwort ohne Hängenbleiben)
    if (interaction.isButton() && interaction.customId === 'start_verification') {
        const token = uuidv4();
        pendingVerifications.set(token, interaction.user.id);
        
        const verifyLink = `${WEB_URL}/verify?token=${token}`;

        await interaction.reply({
            content: `Klicke auf den folgenden Button, um dich zu verifizieren:`,
            components: [
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setLabel('Website öffnen & Verifizieren')
                        .setStyle(ButtonStyle.Link)
                        .setURL(verifyLink)
                        .setEmoji('🌐')
                )
            ],
            ephemeral: true
        });
        return;
    }

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

    if (commandName === 'setup-verify') {
        const embed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle('🔐 Server-Verifizierung')
            .setDescription('Klicke auf den Button unten, um dich zu verifizieren und Zugang zum Server zu erhalten.');

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('start_verification')
                .setLabel('Jetzt verifizieren')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('✅')
        );

        await interaction.channel.send({ embeds: [embed], components: [row] });
        await interaction.reply({ content: 'Verifizierungs-Nachricht erfolgreich gesendet!', ephemeral: true });
    }
});

client.on('messageCreate', async (message) => {
    if (message.channel.id !== VOUCH_CHANNEL_ID || message.author.bot) return;
    vouchCount++;
    setTimeout(async () => await sendStickyMessage(message.channel), 1000);
});

client.login(TOKEN);