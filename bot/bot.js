const TelegramBot = require('node-telegram-bot-api');
const { createBotWrapper } = require('./utils/botWrapper');
const { startAutomaticCleanup } = require('./utils/reportsCleanup');
const startHandler = require('./handlers/startHandler');
const messageHandler = require('./handlers/messageHandler');
const callbackHandler = require('./handlers/callbackHandler');

require('dotenv').config();
const TOKEN = process.env.BOT_TOKEN;
if (!TOKEN) {
  console.error('❌ BOT_TOKEN no encontrado');
  process.exit(1);
}

const originalBot = new TelegramBot(TOKEN, { polling: true });
const bot = createBotWrapper(originalBot);

// Inicializar handlers
startHandler(bot);
messageHandler(bot);
callbackHandler(bot);

// Iniciar limpieza automática de reportes
// Ejecutar cada 24 horas, eliminar archivos con más de 24 horas
startAutomaticCleanup(24, 24);

console.log('🤖 Bot iniciado correctamente');
console.log('🧹 Sistema de limpieza automática de reportes activado');

module.exports = { bot };
