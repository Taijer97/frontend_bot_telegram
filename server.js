const { bot } = require('./bot/bot');

console.log('🚀 Aplicación iniciada...');
console.log('🤖 Bot de Telegram: ✅');

// Manejar cierre graceful
const gracefulShutdown = (signal) => {
  console.log(`\n🛑 Recibida señal ${signal}, cerrando aplicación...`);
  
  // Cerrar bot
  if (bot && bot.stopPolling) {
    bot.stopPolling();
    console.log('✅ Bot detenido');
  }
  
  console.log('✅ Aplicación cerrada correctamente');
  process.exit(0);
  
  // Forzar cierre después de 10 segundos
  setTimeout(() => {
    console.log('⚠️ Forzando cierre de la aplicación');
    process.exit(1);
  }, 10000);
};

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Manejar errores no capturados
process.on('uncaughtException', (error) => {
  console.error('❌ Error no capturado:', error);
  gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Promesa rechazada no manejada:', reason);
  gracefulShutdown('unhandledRejection');
});