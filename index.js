const { bot } = require('./bot/bot');

console.log('Bot iniciado...');

// Manejar cierre graceful
process.on('SIGINT', () => {
  console.log('\n🛑 Cerrando aplicación...');
  
  if (bot && bot.stopPolling) {
    bot.stopPolling();
    console.log('✅ Bot detenido');
  }
  
  console.log('✅ Aplicación cerrada');
  process.exit(0);
});
