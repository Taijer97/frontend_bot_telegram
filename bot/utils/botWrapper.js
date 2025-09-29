const { trackBotMessage } = require('./session');

// Wrapper para bot que automáticamente trackea todos los mensajes
function createBotWrapper(bot) {
  const originalSendMessage = bot.sendMessage.bind(bot);
  const originalEditMessageText = bot.editMessageText.bind(bot);

  // Wrapper para sendMessage
  bot.sendMessage = async function(chatId, text, options = {}) {
    try {
      const sentMessage = await originalSendMessage(chatId, text, options);
      trackBotMessage(chatId, sentMessage.message_id, 'bot');
      return sentMessage;
    } catch (error) {
      console.error('Error enviando mensaje:', error);
      throw error;
    }
  };

  // Wrapper para editMessageText
  bot.editMessageText = async function(text, options = {}) {
    try {
      const result = await originalEditMessageText(text, options);
      // Para editMessageText, el message_id ya está en options.message_id
      if (options.message_id && options.chat_id) {
        trackBotMessage(options.chat_id, options.message_id, 'bot');
      }
      return result;
    } catch (error) {
      console.error('Error editando mensaje:', error);
      throw error;
    }
  };

  return bot;
}

module.exports = { createBotWrapper };