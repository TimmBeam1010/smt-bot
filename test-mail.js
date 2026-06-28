const nodemailer = require('nodemailer');
require('dotenv').config();

console.log('🔍 Проверка SMTP-настроек:');
console.log('Host:', process.env.EMAIL_HOST);
console.log('Port:', process.env.EMAIL_PORT);
console.log('User:', process.env.EMAIL_USER);

const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: parseInt(process.env.EMAIL_PORT),
    secure: process.env.EMAIL_SECURE === 'true',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    },
    connectionTimeout: 10000, // 10 секунд
    greetingTimeout: 10000,
    socketTimeout: 10000
});

transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to: 'info@smtbot.com',
    subject: 'Тест SMTP',
    text: 'Письмо работает'
}).then(() => {
    console.log('✅ Письмо отправлено');
}).catch(err => {
    console.error('❌ Ошибка:', err.message);
});