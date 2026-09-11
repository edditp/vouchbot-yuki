const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder, ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const express = require('express');
const { v4: uuidv4 } = require('uuid');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;

const pendingVerifications = new Map();

const TOKEN = process.env.TOKEN;
const VOUCH_CHANNEL_ID = process.env.VOUCH_CHANNEL_ID;
const WEB_URL = process.env.WEB_URL || `http://localhost:${PORT}`;

const STATS_MEMBERS_ID = '1540564623286214717'; 
const STATS_BOTS_ID = '';

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
        .setDefaultMemberPermissions(0),
    new SlashCommandBuilder()
        .setName('notfall-einladung')
        .setDescription('Sendet den Backup-Einladungslink an alle verifizierten User (Notfall-Befehl)')
        .setDefaultMemberPermissions(0)
        .addStringOption(option =>
            option.setName('link')
                .setDescription('Der Einladungslink zum neuen Backup-Server')
                .setRequired(true))
].map(command => command.toJSON());

// --- WEBSERVER DESIGN ---
app.get('/verify', (req, res) => {
    const { token } = req.query;

    if (!token || !pendingVerifications.has(token)) {
        return res.status(400).send(`
            <!DOCTYPE html>
            <html lang="de">
            <head>
                <meta charset="UTF-8">
                <title>TP STOCK - Fehler</title>
                <style>
                    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #0f1013; color: #fff; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
                    .card { background: #18191c; padding: 40px; border-radius: 12px; text-align: center; box-shadow: 0 8px 24px rgba(0,0,0,0.6); border: 1px solid #2f3136; max-width: 400px; }
                    h2 { color: #ed4245; margin-top: 0; }
                    p { color: #b9bbbe; font-size: 14px; }
                </style>
            </head>
            <body>
                <div class="card">
                    <h2>Ungültiger Link</h2>
                    <p>Dieser Verifizierungslink ist ungültig oder bereits abgelaufen. Bitte generiere in Discord einen neuen Link.</p>
                </div>
            </body>
            </html>
        `);
    }

    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    console.log(`[VERIFY] IP erfasst: ${clientIp}`);

    res.send(`
        <!DOCTYPE html>
        <html lang="de">
        <head>
            <meta charset="UTF-8">
            <title>TP STOCK - Verifizierung</title>
            <style>
                body { 
                    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
                    background: #0f1013; 
                    color: #fff; 
                    display: flex; 
                    justify-content: center; 
                    align-items: center; 
                    height: 100vh; 
                    margin: 0; 
                }
                .card { 
                    background: #18191c; 
                    padding: 40px; 
                    border-radius: 12px; 
                    text-align: center; 
                    box-shadow: 0 8px 24px rgba(0,0,0,0.6); 
                    border: 1px solid #2f3136;
                    width: 100%;
                    max-width: 400px;
                }
                .logo {
                    width: 90px;
                    height: 90px;
                    border-radius: 50%;
                    object-fit: cover;
                    margin-bottom: 15px;
                    border: 2px solid #5865F2;
                    background: #202225;
                }
                h2 { 
                    color: #ffffff; 
                    margin-bottom: 5px;
                    font-size: 24px;
                }
                .subtitle {
                    color: #5865F2;
                    font-size: 14px;
                    font-weight: 600;
                    margin-bottom: 20px;
                    text-transform: uppercase;
                    letter-spacing: 1px;
                }
                p { 
                    color: #b9bbbe; 
                    font-size: 14px; 
                    margin-bottom: 30px;
                }
                button { 
                    background: #5865F2; 
                    color: white; 
                    border: none; 
                    padding: 14px 24px; 
                    font-size: 16px; 
                    font-weight: 600;
                    border-radius: 6px; 
                    cursor: pointer; 
                    width: 100%;
                    transition: background 0.2s;
                }
                button:hover { 
                    background: #4752C4; 
                }
            </style>
        </head>
        <body>
            <div class="card">
                <img src="https://images-ext-1.discordapp.net/external/DGdJiFZo2lPwTLv-ODerl3vhTFxDMU1lCvpGYPaKsrk/https/cdn-longterm.mee6.xyz/plugins/embeds/images/1465511874199290082/c65476a4b64ea487830b218348463234aba630acf560b0e2390ff9430982c49c.png?format=webp&quality=lossless&width=1280&height=512" alt="TP STOCK Logo" class="logo">
                <h2>TP STOCK</h2>
                <div class="subtitle">Sicherheits-Verifizierung</div>
                <p>Klicke auf den Button unten, um deine Verifizierung abzuschließen und die Server-Rolle freizuschalten.</p>
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
            res.send(`
                <!DOCTYPE html>
                <html lang="de">
                <head>
                    <meta charset="UTF-8">
                    <title>TP STOCK - Erfolg</title>
                    <style>
                        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #0f1013; color: #fff; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
                        .card { background: #18191c; padding: 40px; border-radius: 12px; text-align: center; box-shadow: 0 8px 24px rgba(0,0,0,0.6); border: 1px solid #2f3136; max-width: 400px; }
                        h2 { color: #3ba55d; margin-top: 0; }
                        p { color: #b9bbbe; font-size: 14px; }
                    </style>
                </head>
                <body>
                    <div class="card">
                        <h2>Erfolgreich verifiziert!</h2>
                        <p>Du kannst dieses Fenster jetzt schließen und zu TP STOCK zurückkehren.</p>
                    </div>
                </body>
                </html>
            `);
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
    if (interaction.isButton() && interaction.customId === 'start_verification') {
        try {
            await interaction.deferReply({ ephemeral: true });

            const token = uuidv4();
            pendingVerifications.set(token, interaction.user.id);
            
            const verifyLink = `${WEB_URL}/verify?token=${token}`;

            const replyEmbed = new EmbedBuilder()
                .setColor(0x5865F2)
                .setTitle('🛡️ Dein persönlicher Verifizierungs-Link')
                .setDescription('Klicke auf den Button unten, um den Vorgang in deinem Browser zu starten.');

            await interaction.editReply({
                embeds: [replyEmbed],
                components: [
                    new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setLabel('Website öffnen & Verifizieren')
                            .setStyle(ButtonStyle.Link)
                            .setURL(verifyLink)
                            .setEmoji('🌐')
                    )
                ]
            });
        } catch (error) {
            console.error('Fehler beim Verifizierungs-Button:', error);
            await interaction.editReply({ content: 'Ein Fehler ist aufgetreten. Bitte überprüfe die WEB_URL Variable.', components: [] }).catch(() => {});
        }
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
            .setTitle('🔐 · TP STOCK VERIFIZIERUNG')
            .setDescription('Willkommen auf **TP STOCK**! Um vollen Zugriff auf den Server zu erhalten und dich gegen Bot-Accounts zu schützen, klicke bitte auf den Button unten.')
            .addFields(
                { name: '✨ Deine Vorteile nach der Verifizierung', value: '• Zugriff auf alle Kanäle\n• Teilnehme an Giveaways & Deals\n• Automatischer Rollen-Erhalt', inline: false },
                { name: '⚠️ Hinweis', value: 'Der Link ist einmalig und exklusiv für dich generiert.', inline: false }
            )
            .setImage('https://images-ext-1.discordapp.net/external/DGdJiFZo2lPwTLv-ODerl3vhTFxDMU1lCvpGYPaKsrk/https/cdn-longterm.mee6.xyz/plugins/embeds/images/1465511874199290082/c65476a4b64ea487830b218348463234aba630acf560b0e2390ff9430982c49c.png?format=webp&quality=lossless&width=1280&height=512')
            .setFooter({ text: 'TP STOCK Security System', iconURL: client.user.displayAvatarURL() })
            .setTimestamp();

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

    // --- NOTFALL-EINLADUNGS-BEFEHL (SICHER & ABGEFANGEN) ---
    if (commandName === 'notfall-einladung') {
        if (!interaction.guild) {
            return interaction.reply({ content: '❌ Dieser Befehl kann nur direkt auf einem Server ausgeführt werden, nicht in Direktnachrichten!', ephemeral: true });
        }

        const inviteLink = interaction.options.getString('link');

        await interaction.reply({ content: '🚨 Notfall-Aktion gestartet! Lade Mitgliederliste und versende DMs...', ephemeral: true });

        try {
            await interaction.guild.members.fetch({ force: true });

            let successCount = 0;
            let failCount = 0;
            const verifiedRoleId = '1486063719825018913';

            const embed = new EmbedBuilder()
                .setColor(0xed4245)
                .setTitle('🚨 WICHTIG: TP STOCK Notfall-Umzug!')
                .setDescription('Unser Hauptserver wurde leider gewechselt oder gesperrt. Tritt sofort unserem neuen Backup-Server bei, um deine Deals und Community fortzuführen!')
                .addFields({ name: '🔗 Neuer Einladungslink', value: inviteLink })
                .setTimestamp();

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setLabel('Zum neuen Server')
                    .setStyle(ButtonStyle.Link)
                    .setURL(inviteLink)
                    .setEmoji('🚀')
            );

            for (const [memberId, member] of interaction.guild.members.cache) {
                if (member.user.bot) continue;

                if (member.roles.cache.has(verifiedRoleId)) {
                    try {
                        await member.send({ embeds: [embed], components: [row] });
                        successCount++;
                        await new Promise(resolve => setTimeout(resolve, 600));
                    } catch (err) {
                        failCount++;
                    }
                }
            }

            await interaction.followUp({
                content: `✅ Notfall-Aktion beendet!\n- Erfolgreich gesendet: **${successCount}** User\n- Fehlgeschlagen (z.B. DMs geschlossen): **${failCount}** User`,
                ephemeral: true
            });

        } catch (error) {
            console.error('SCHWERER FEHLER IM NOTFALL-BEFEHL:', error);
            await interaction.followUp({ content: `❌ Fehler: \`${error.message}\``, ephemeral: true });
        }
    }
});

client.on('messageCreate', async (message) => {
    if (message.channel.id !== VOUCH_CHANNEL_ID || message.author.bot) return;
    vouchCount++;
    setTimeout(async () => await sendStickyMessage(message.channel), 1000);
});

client.login(TOKEN);