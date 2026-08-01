const { Client, GatewayIntentBits } = require('discord.js');
const { exec, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ========== قراءة المتغيرات من بيئة Railway ==========
const TOKEN = process.env.BOT_TOKEN;
const PREFIX = '!';
const ROOM_ID = process.env.ROOM_ID || null;   // تم التعديل هنا

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ]
});

// ========== دوال النظام ==========
function systemRestart() { exec('shutdown /r /t 0', (err) => { if (err) console.error(err); }); }
function systemShutdown() { exec('shutdown /s /t 0', (err) => { if (err) console.error(err); }); }
function systemSleep() { exec('rundll32.exe powrprof.dll,SetSuspendState 0,1,0', (err) => { if (err) console.error(err); }); }
function systemLock() { exec('rundll32.exe user32.dll,LockWorkStation', (err) => { if (err) console.error(err); }); }
function systemLogout() { exec('shutdown /l', (err) => { if (err) console.error(err); }); }

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

// ========== دالة التحقق من صلاحية الغرفة ==========
function isAuthorized(member) {
    if (!ROOM_ID) return true; // إذا لم يُحدد معرف، يُسمح للجميع
    return member.roles.cache.has(ROOM_ID);
}

// ========== معالج الرسائل ==========
client.on('messageCreate', async (msg) => {
    if (msg.author.bot || !msg.content.startsWith(PREFIX)) return;
    const args = msg.content.slice(PREFIX.length).trim().split(/ +/);
    const cmd = args.shift().toLowerCase();

    // الأوامر العامة (لا تحتاج صلاحية)
    if (cmd === 'ping') {
        await msg.reply(`Pong! ${client.ws.ping}ms`);
        return;
    }
    if (cmd === 'info') {
        await msg.reply(`\`\`\`\n${getSystemInfo()}\n\`\`\``);
        return;
    }

    // ===== الأوامر الخطيرة (تتطلب صلاحية الغرفة) =====
    if (!isAuthorized(msg.member)) {
        await msg.reply('⛔ ليس لديك الصلاحية لاستخدام هذا الأمر.');
        return;
    }

    switch (cmd) {
        case 'restart':
            await msg.reply('جاري إعادة التشغيل...');
            systemRestart();
            break;
        case 'shutdown':
            await msg.reply('جاري الإغلاق...');
            systemShutdown();
            break;
        case 'sleep':
            await msg.reply('دخول في وضع السكون...');
            systemSleep();
            break;
        case 'lock':
            systemLock();
            await msg.reply('تم قفل الجهاز');
            break;
        case 'logout':
            await msg.reply('تسجيل الخروج...');
            systemLogout();
            break;
        case 'screenshot': {
            const p = takeScreenshot();
            if (p && fs.existsSync(p)) {
                await msg.reply({ files: [p] });
                fs.unlinkSync(p);
            } else {
                await msg.reply('فشل التصوير (تحقق من مكتبة screenshot-desktop)');
            }
            break;
        }
        case 'exec': {
            const fullCmd = args.join(' ');
            if (!fullCmd) return msg.reply('يرجى كتابة الأمر المراد تنفيذه');
            const result = execCommand(fullCmd);
            await msg.reply(`\`\`\`\n${result.slice(0, 1900)}\n\`\`\``);
            break;
        }
        default:
            await msg.reply('أمر غير معروف (للأوامر الخطيرة تحتاج صلاحية)');
    }
});

client.once('ready', () => {
    console.log(`✅ البوت يعمل باسم ${client.user.tag}`);
    if (ROOM_ID) {
        console.log(`🔒 الصلاحية مطلوبة للدور ذو المعرف: ${ROOM_ID}`);
    } else {
        console.log('⚠️ جميع الأوامر متاحة للجميع (لم يُحدد ROOM_ID)');
    }
});

client.login(TOKEN);
