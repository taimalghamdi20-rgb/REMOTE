const { Client, GatewayIntentBits } = require('discord.js');
const { exec, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const TOKEN = process.env.TOKEN;          // يُقرأ من متغيرات البيئة
const PREFIX = '!';
const BOT_CHANNEL_ID = process.env.CHANNEL_ID || '';

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ]
});

// دوال النظام (نفس الوظائف السابقة)
function systemRestart() { exec('shutdown /r /t 0'); }
function systemShutdown() { exec('shutdown /s /t 0'); }
function systemSleep() { exec('rundll32.exe powrprof.dll,SetSuspendState 0,1,0'); }
function systemLock() { exec('rundll32.exe user32.dll,LockWorkStation'); }
function systemLogout() { exec('shutdown /l'); }
function getSystemInfo() {
    return `المستخدم: ${os.userInfo().username}\nالمضيف: ${os.hostname()}\nالنظام: ${os.type()} ${os.release()}\nالمعالج: ${os.cpus()[0].model}\nالذاكرة الكلية: ${(os.totalmem()/(1024**3)).toFixed(2)} GB\nالذاكرة الحرة: ${(os.freemem()/(1024**3)).toFixed(2)} GB`;
}
function takeScreenshot() {
    try {
        const screenshot = require('screenshot-desktop');
        const tempPath = path.join(os.tmpdir(), `scr_${Date.now()}.png`);
        screenshot({ filename: tempPath });
        return tempPath;
    } catch(e) { return null; }
}
function execCommand(cmd) {
    try { return execSync(cmd, { encoding: 'utf8', timeout: 5000 }) || 'تم التنفيذ'; }
    catch(err) { return `خطأ: ${err.message}`; }
}

client.on('messageCreate', async (msg) => {
    if (msg.author.bot || !msg.content.startsWith(PREFIX)) return;
    if (BOT_CHANNEL_ID && msg.channel.id !== BOT_CHANNEL_ID) return;
    const args = msg.content.slice(PREFIX.length).trim().split(/ +/);
    const cmd = args.shift().toLowerCase();
    if (cmd === 'restart') { await msg.reply('إعادة تشغيل...'); systemRestart(); }
    else if (cmd === 'shutdown') { await msg.reply('إغلاق...'); systemShutdown(); }
    else if (cmd === 'sleep') { await msg.reply('سكون...'); systemSleep(); }
    else if (cmd === 'lock') { systemLock(); await msg.reply('تم القفل'); }
    else if (cmd === 'logout') { await msg.reply('تسجيل خروج'); systemLogout(); }
    else if (cmd === 'info') { await msg.reply(`\`\`\`\n${getSystemInfo()}\n\`\`\``); }
    else if (cmd === 'screenshot') {
        const p = takeScreenshot();
        if (p && fs.existsSync(p)) { await msg.reply({ files: [p] }); fs.unlinkSync(p); }
        else await msg.reply('فشل التصوير (تحقق من مكتبة screenshot-desktop)');
    }
    else if (cmd === 'exec') {
        const fullCmd = args.join(' ');
        if (!fullCmd) return msg.reply('اكتب أمراً');
        const result = execCommand(fullCmd);
        await msg.reply(`\`\`\`\n${result.slice(0, 1900)}\n\`\`\``);
    }
    else if (cmd === 'ping') { await msg.reply(`Pong! ${client.ws.ping}ms`); }
    else { await msg.reply('أمر غير معروف'); }
});

client.once('ready', () => console.log(`✅ البوت يعمل باسم ${client.user.tag}`));
client.login(TOKEN);