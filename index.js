const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder, ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

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
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 3000;

const pendingVerifications = new Map();
const cooldowns = new Map();
const recentIps = new Map();

const DATA_FILE = path.join(__dirname, 'verified_users.json');

function loadVerifiedUsers() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const data = fs.readFileSync(DATA_FILE, 'utf8');
            return JSON.parse(data);
        }
    } catch (err) {
        console.error('Fehler beim Laden der verifizierten User:', err);
    }
    return [];
}

function saveVerifiedUser(userId) {
    const users = loadVerifiedUsers();
    if (!users.includes(userId)) {
        users.push(userId);
        try {
            fs.writeFileSync(DATA_FILE, JSON.stringify(users, null, 2), 'utf8');
        } catch (err) {
            console.error('Fehler beim Speichern des verifizierten Users:', err);
        }
    }
}

const TOKEN = process.env.TOKEN;
const VOUCH_CHANNEL_ID = process.env.VOUCH_CHANNEL_ID;
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID || '';
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
        .setDescription('Sendet den Einladungslink an alle gespeicherten verifizierten User')
        .setDefaultMemberPermissions(0)
        .addStringOption(option =>
            option.setName('link')
                .setDescription('Der Einladungslink zum neuen Backup-Server')
                .setRequired(true))
].map(command => command.toJSON());

// --- WEBSERVER MIT INTERNATIONALES CAPTCHA ---
app.get('/verify', (req, res) => {
    const { token } = req.query;

    if (!token || !pendingVerifications.has(token)) {
        return res.status(400).send(`
            <!DOCTYPE html>
            <html lang="de">
            <head>
                <meta charset="UTF-8">
                <title>TP STOCK - Error</title>
                <style>
                    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #0f1013; color: #fff; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
                    .card { background: #18191c; padding: 40px; border-radius: 12px; text-align: center; box-shadow: 0 8px 24px rgba(0,0,0,0.6); border: 1px solid #2f3136; max-width: 400px; }
                    h2 { color: #ed4245; margin-top: 0; }
                    p { color: #b9bbbe; font-size: 14px; }
                </style>
            </head>
            <body>
                <div class="card">
                    <h2>Invalid Link</h2>
                    <p>This verification link is invalid or has expired. Please generate a new one in Discord.</p>
                </div>
            </body>
            </html>
        `);
    }

    const verificationData = pendingVerifications.get(token);
    
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const now = Date.now();
    if (recentIps.has(clientIp) && now - recentIps.get(clientIp) < 15 * 60 * 1000) {
        return res.status(429).send(`
            <!DOCTYPE html>
            <html lang="en">
            <head><meta charset="UTF-8"><title>Too Many Requests</title></head>
            <body style="background:#0f1013;color:#fff;font-family:sans-serif;text-align:center;padding-top:100px;">
                <h2>⚠️ Too Many Requests</h2>
                <p>A verification was recently completed from your IP address. Please wait a moment.</p>
            </body>
            </html>
        `);
    }

    // Universelles Captcha (Zahlen und einfache Mathe-Syntax, weltweit verständlich)
    const num1 = Math.floor(Math.random() * 8) + 2;
    const num2 = Math.floor(Math.random() * 8) + 2;
    const captchaAnswer = num1 + num2;
    verificationData.captchaAnswer = captchaAnswer;

    res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <title>TP STOCK - Security Check</title>
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
                    margin-bottom: 20px; 
                }
                input { 
                    background: #202225; 
                    border: 1px solid #4f545c; 
                    color: white; 
                    padding: 12px; 
                    font-size: 18px; 
                    border-radius: 6px; 
                    width: 80%; 
                    text-align: center; 
                    margin-bottom: 20px; 
                    outline: none; 
                }
                input:focus { border-color: #5865F2; }
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
                button:hover { background: #4752C4; }
            </style>
        </head>
        <body>
            <div class="card">
                <img src="https://images-ext-1.discordapp.net/external/DGdJiFZo2lPwTLv-ODerl3vhTFxDMU1lCvpGYPaKsrk/https/cdn-longterm.mee6.xyz/plugins/embeds/images/1465511874199290082/c65476a4b64ea487830b218348463234aba630acf560b0e2390ff9430982c49c.png?format=webp&quality=lossless&width=1280&height=512" alt="TP STOCK Logo" class="logo">
                <h2>TP STOCK</h2>
                <div class="subtitle">Security Check</div>
                <p>Please solve this to prove you are human:</p>
                <form action="/complete?token=${token}" method="POST">
                    <p style="font-weight: bold; color: #fff; font-size: 20px; margin-bottom: 12px; letter-spacing: 2px;">${num1} + ${num2} = ?</p>
                    <input type="number" name="captcha" placeholder="Answer" required autocomplete="off">
                    <button type="submit">Complete Verification</button>
                </form>
            </div>
        </body>
        </html>
    `);
});

app.post('/complete', async (req, res) => {
    const { token } = req.query;
    const userAnswer = parseInt(req.body.captcha, 10);

    if (!token || !pendingVerifications.has(token)) {
        return res.status(400).send('<h1>Error: Invalid or expired link.</h1>');
    }

    const verificationData = pendingVerifications.get(token);

    if (userAnswer !== verificationData.captchaAnswer) {
        return res.status(400).send(`
            <!DOCTYPE html>
            <html lang="en">
            <head><meta charset="UTF-8"><title>Wrong Answer</title></head>
            <body style="background:#0f1013;color:#fff;font-family:sans-serif;text-align:center;padding-top:100px;">
                <h2 style="color:#ed4245;">❌ Incorrect Answer</h2>
                <p>You solved the math problem incorrectly. Please go back to Discord and start the verification again.</p>
            </body>
            </html>
        `);
    }

    const userId = verificationData.userId;
    pendingVerifications.delete(token);

    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    recentIps.set(clientIp, Date.now());

    try {
        const guild = await client.guilds.fetch('1465511874199290082');
        const member = await guild.members.fetch(userId);
        const role = guild.roles.cache.get('1486063719825018913');

        if (member && role) {
            await member.roles.add(role);
            saveVerifiedUser(userId);

            if (LOG_CHANNEL_ID) {
                const logChannel = await client.channels.fetch(LOG_CHANNEL_ID).catch(() => null);
                if (logChannel && logChannel.isTextBased()) {
                    const logEmbed = new EmbedBuilder()
                        .setColor(0x3ba55d)
                        .setTitle('🛡️ New Successful Verification')
                        .addFields(
                            { name: 'Member', value: `<@${userId}> (${userId})`, inline: true },
                            { name: 'IP Address', value: `\`${clientIp}\``, inline: true }
                        )
                        .setTimestamp();
                    await logChannel.send({ embeds: [logEmbed] }).catch(() => {});
                }
            }

            res.send(`
                <!DOCTYPE html>
                <html lang="en">
                <head>
                    <meta charset="UTF-8">
                    <title>TP STOCK - Success</title>
                    <style>
                        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #0f1013; color: #fff; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
                        .card { background: #18191c; padding: 40px; border-radius: 12px; text-align: center; box-shadow: 0 8px 24px rgba(0,0,0,0.6); border: 1px solid #2f3136; max-width: 400px; }
                        h2 { color: #3ba55d; margin-top: 0; }
                        p { color: #b9bbbe; font-size: 14px; }
                    </style>
                </head>
                <body>
                    <div class="card">
                        <h2>Successfully Verified!</h2>
                        <p>You can now close this window and return to Discord.</p>
                    </div>
                </body>
                </html>
            `);
        } else {
            res.send('<h1>Error: Could not assign role (Member or role not found).</h1>');
        }
    } catch (error) {
        console.error(error);
        res.send('<h1>An internal error occurred.</h1>');
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
            const now = Date.now();
            if (cooldowns.has(interaction.user.id)) {
                const expirationTime = cooldowns.get(interaction.user.id) + 5000;
                if (now < expirationTime) {
                    const timeLeft = ((expirationTime - now) / 1000).toFixed(1);
                    return interaction.reply({ content: `⏳ Please wait ${timeLeft} seconds before requesting a new link.`, ephemeral: true });
                }
            }
            cooldowns.set(interaction.user.id, now);

            await interaction.deferReply({ ephemeral: true });

            const token = uuidv4();
            pendingVerifications.set(token, { userId: interaction.user.id });
            
            const verifyLink = `${WEB_URL}/verify?token=${token}`;

            const replyEmbed = new EmbedBuilder()
                .setColor(0x5865F2)
                .setTitle('🛡️ Your Verification Link')
                .setDescription('Click the button below to start the security check in your browser.');

            await interaction.editReply({
                embeds: [replyEmbed],
                components: [
                    new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setLabel('Open Website & Verify')
                            .setStyle(ButtonStyle.Link)
                            .setURL(verifyLink)
                            .setEmoji('🌐')
                    )
                ]
            });
        } catch (error) {
            console.error('Fehler beim Verifizierungs-Button:', error);
            await interaction.editReply({ content: 'An error occurred. Please check the WEB_URL variable.', components: [] }).catch(() => {});
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
            .setTitle('🔐 · TP STOCK VERIFICATION')
            .setDescription('Welcome to **TP STOCK**! To get full access to the server and protect against bot accounts, please click the button below.')
            .addFields(
                { name: '✨ Your Benefits', value: '• Access to all channels\n• Participate in giveaways & deals\n• Automatic role assignment', inline: false },
                { name: '⚠️ Notice', value: 'This link is unique and generated exclusively for you.', inline: false }
            )
            .setImage('https://images-ext-1.discordapp.net/external/DGdJiFZo2lPwTLv-ODerl3vhTFxDMU1lCvpGYPaKsrk/https/cdn-longterm.mee6.xyz/plugins/embeds/images/1465511874199290082/c65476a4b64ea487830b218348463234aba630acf560b0e2390ff9430982c49c.png?format=webp&quality=lossless&width=1280&height=512')
            .setFooter({ text: 'TP STOCK Security System', iconURL: client.user.displayAvatarURL() })
            .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('start_verification')
                .setLabel('Verify Now')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('✅')
        );

        await interaction.channel.send({ embeds: [embed], components: [row] });
        await interaction.reply({ content: 'Verification message sent successfully!', ephemeral: true });
    }

    if (commandName === 'notfall-einladung') {
        if (!interaction.guild) {
            return interaction.reply({ content: '❌ This command can only be used on a server!', ephemeral: true });
        }

        const inviteLink = interaction.options.getString('link');
        const verifiedUserIds = loadVerifiedUsers();

        if (verifiedUserIds.length === 0) {
            return interaction.reply({ content: '❌ No verified users found in the database.', ephemeral: true });
        }

        await interaction.reply({ content: `🚨 Emergency action started! Sending DMs to ${verifiedUserIds.length} verified users...`, ephemeral: true });

        let successCount = 0;
        let failCount = 0;

        const embed = new EmbedBuilder()
            .setColor(0xed4245)
            .setTitle('🚨 IMPORTANT: TP STOCK Emergency Move!')
            .setDescription('Our main server has unfortunately changed or been banned. Join our new backup server immediately to continue your deals and community!')
            .addFields({ name: '🔗 New Invite Link', value: inviteLink })
            .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setLabel('Join New Server')
                .setStyle(ButtonStyle.Link)
                .setURL(inviteLink)
                .setEmoji('🚀')
        );

        for (const userId of verifiedUserIds) {
            try {
                const user = await client.users.fetch(userId);
                if (user) {
                    await user.send({ embeds: [embed], components: [row] });
                    successCount++;
                    await new Promise(resolve => setTimeout(resolve, 600));
                }
            } catch (err) {
                failCount++;
            }
        }

        await interaction.followUp({
            content: `✅ Emergency action completed!\n- Successfully sent: **${successCount}** users\n- Failed (e.g., closed DMs): **${failCount}** users`,
            ephemeral: true
        });
    }
});

client.on('messageCreate', async (message) => {
    if (message.channel.id !== VOUCH_CHANNEL_ID || message.author.bot) return;
    vouchCount++;
    setTimeout(async () => await sendStickyMessage(message.channel), 1000);
});

client.login(TOKEN);