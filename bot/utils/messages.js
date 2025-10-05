const userMessages = new Map();
const { addChatMessage, getUserMessages } = require('./chatManager');

function trackBotMessage(chatId, messageId, messageType = 'bot') {
  // Trackear en memoria (sistema existente)
  if (!userMessages.has(chatId)) userMessages.set(chatId, []);
  const arr = userMessages.get(chatId);
  arr.push(messageId);
  if (arr.length > 50) arr.splice(0, arr.length - 50);
  
  // Trackear en JSON (nuevo sistema)
  addChatMessage(chatId.toString(), messageId, messageType);
}

async function deleteUserMessages(bot, chatId) {
  console.log(`🗑️ Iniciando eliminación de mensajes para usuario: ${chatId}`);
  
  let totalMessages = 0;
  let deletedMessages = 0;
  let failedMessages = 0;
  const failedReasons = new Map();
  
  // Función helper para manejar eliminación individual
  async function deleteMessageSafely(messageId, source = 'unknown') {
    totalMessages++;
    try {
      await bot.deleteMessage(chatId, messageId);
      deletedMessages++;
      console.log(`✅ Mensaje ${messageId} eliminado (${source})`);
      return true;
    } catch (error) {
      failedMessages++;
      const reason = error.message || 'Error desconocido';
      
      // Categorizar errores comunes
      if (reason.includes('message to delete not found')) {
        console.log(`⚠️ Mensaje ${messageId} ya no existe (${source})`);
        failedReasons.set('not_found', (failedReasons.get('not_found') || 0) + 1);
      } else if (reason.includes('message can\'t be deleted')) {
        console.log(`⚠️ Mensaje ${messageId} no se puede eliminar (${source})`);
        failedReasons.set('cant_delete', (failedReasons.get('cant_delete') || 0) + 1);
      } else if (reason.includes('message is too old')) {
        console.log(`⚠️ Mensaje ${messageId} es muy antiguo (${source})`);
        failedReasons.set('too_old', (failedReasons.get('too_old') || 0) + 1);
      } else {
        console.log(`❌ Error eliminando mensaje ${messageId} (${source}): ${reason}`);
        failedReasons.set('other', (failedReasons.get('other') || 0) + 1);
      }
      return false;
    }
  }
  
  // Eliminar mensajes trackeados en memoria
  if (userMessages.has(chatId)) {
    const memoryMessages = userMessages.get(chatId);
    console.log(`📱 Eliminando ${memoryMessages.length} mensajes de memoria...`);
    
    for (let messageId of memoryMessages) {
      await deleteMessageSafely(messageId, 'memoria');
      // Pequeña pausa para evitar rate limiting
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    
    userMessages.delete(chatId);
    console.log(`🧠 Limpieza de memoria completada`);
  }
  
  // Eliminar mensajes trackeados en JSON
  const jsonMessages = getUserMessages(chatId.toString());
  if (jsonMessages.length > 0) {
    console.log(`💾 Eliminando ${jsonMessages.length} mensajes de JSON...`);
    
    // Crear un Set para evitar duplicados
    const uniqueMessages = new Map();
    jsonMessages.forEach(msgData => {
      uniqueMessages.set(msgData.messageId, msgData);
    });
    
    for (let [messageId, msgData] of uniqueMessages) {
      await deleteMessageSafely(messageId, `JSON-${msgData.messageType}`);
      // Pequeña pausa para evitar rate limiting
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    
    console.log(`💾 Limpieza de JSON completada`);
  }
  
  // Resumen final
  console.log(`\n📊 === RESUMEN DE LIMPIEZA ===`);
  console.log(`👤 Usuario: ${chatId}`);
  console.log(`📱 Total de mensajes procesados: ${totalMessages}`);
  console.log(`✅ Mensajes eliminados exitosamente: ${deletedMessages}`);
  console.log(`❌ Mensajes que fallaron: ${failedMessages}`);
  
  if (failedReasons.size > 0) {
    console.log(`\n📋 Desglose de errores:`);
    if (failedReasons.has('not_found')) {
      console.log(`   ⚠️ No encontrados: ${failedReasons.get('not_found')}`);
    }
    if (failedReasons.has('cant_delete')) {
      console.log(`   🚫 No eliminables: ${failedReasons.get('cant_delete')}`);
    }
    if (failedReasons.has('too_old')) {
      console.log(`   ⏰ Muy antiguos: ${failedReasons.get('too_old')}`);
    }
    if (failedReasons.has('other')) {
      console.log(`   ❓ Otros errores: ${failedReasons.get('other')}`);
    }
  }
  
  const successRate = totalMessages > 0 ? ((deletedMessages / totalMessages) * 100).toFixed(1) : 100;
  console.log(`📈 Tasa de éxito: ${successRate}%`);
  console.log(`🧹 Limpieza de mensajes completada para usuario: ${chatId}\n`);
  
  return {
    total: totalMessages,
    deleted: deletedMessages,
    failed: failedMessages,
    successRate: parseFloat(successRate),
    failedReasons: Object.fromEntries(failedReasons)
  };
}

/**
 * Función para eliminar mensajes de forma masiva con mejor control
 * @param {Object} bot - Instancia del bot
 * @param {number} chatId - ID del chat
 * @param {Array} messageIds - Array de IDs de mensajes a eliminar
 * @param {number} batchSize - Tamaño del lote (default: 10)
 * @param {number} delay - Delay entre lotes en ms (default: 100)
 */
async function deleteMessagesBatch(bot, chatId, messageIds, batchSize = 10, delay = 100) {
  console.log(`🔄 Eliminación en lotes: ${messageIds.length} mensajes, lotes de ${batchSize}`);
  
  const results = {
    total: messageIds.length,
    deleted: 0,
    failed: 0,
    errors: []
  };
  
  // Dividir en lotes
  for (let i = 0; i < messageIds.length; i += batchSize) {
    const batch = messageIds.slice(i, i + batchSize);
    console.log(`📦 Procesando lote ${Math.floor(i/batchSize) + 1}/${Math.ceil(messageIds.length/batchSize)}`);
    
    // Procesar lote en paralelo
    const batchPromises = batch.map(async (messageId) => {
      try {
        await bot.deleteMessage(chatId, messageId);
        results.deleted++;
        return { messageId, success: true };
      } catch (error) {
        results.failed++;
        results.errors.push({ messageId, error: error.message });
        return { messageId, success: false, error: error.message };
      }
    });
    
    await Promise.all(batchPromises);
    
    // Pausa entre lotes
    if (i + batchSize < messageIds.length) {
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  console.log(`✅ Eliminación en lotes completada: ${results.deleted}/${results.total} exitosos`);
  return results;
}

/**
 * Función optimizada que solo elimina mensajes del bot (más eficiente)
 * @param {Object} bot - Instancia del bot
 * @param {number} chatId - ID del chat
 */
async function deleteBotMessagesOnly(bot, chatId) {
  console.log(`🤖 Eliminando solo mensajes del bot para usuario: ${chatId}`);
  
  let totalMessages = 0;
  let deletedMessages = 0;
  let failedMessages = 0;
  
  // Función helper para manejar eliminación individual
  async function deleteMessageSafely(messageId, source = 'unknown') {
    totalMessages++;
    try {
      await bot.deleteMessage(chatId, messageId);
      deletedMessages++;
      console.log(`✅ Mensaje del bot ${messageId} eliminado (${source})`);
      return true;
    } catch (error) {
      failedMessages++;
      console.log(`❌ Error eliminando mensaje del bot ${messageId} (${source}): ${error.message}`);
      return false;
    }
  }
  
  // Eliminar solo mensajes del bot de memoria
  if (userMessages.has(chatId)) {
    const memoryMessages = userMessages.get(chatId);
    console.log(`📱 Eliminando ${memoryMessages.length} mensajes del bot de memoria...`);
    
    for (let messageId of memoryMessages) {
      await deleteMessageSafely(messageId, 'memoria-bot');
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    
    userMessages.delete(chatId);
  }
  
  // Eliminar solo mensajes del bot del JSON
  const jsonMessages = getUserMessages(chatId.toString());
  const botMessagesFromJson = jsonMessages.filter(msg => 
    msg.messageType === 'bot' || !msg.messageType // Asumir que sin tipo es del bot
  );
  
  if (botMessagesFromJson.length > 0) {
    console.log(`💾 Eliminando ${botMessagesFromJson.length} mensajes del bot de JSON...`);
    
    for (let msgData of botMessagesFromJson) {
      await deleteMessageSafely(msgData.messageId, 'JSON-bot');
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
  
  console.log(`\n🤖 === RESUMEN LIMPIEZA BOT ===`);
  console.log(`👤 Usuario: ${chatId}`);
  console.log(`📱 Mensajes del bot procesados: ${totalMessages}`);
  console.log(`✅ Mensajes del bot eliminados: ${deletedMessages}`);
  console.log(`❌ Mensajes del bot que fallaron: ${failedMessages}`);
  
  const successRate = totalMessages > 0 ? ((deletedMessages / totalMessages) * 100).toFixed(1) : 100;
  console.log(`📈 Tasa de éxito: ${successRate}%`);
  console.log(`🧹 Limpieza de mensajes del bot completada\n`);
  
  return {
    total: totalMessages,
    deleted: deletedMessages,
    failed: failedMessages,
    successRate: parseFloat(successRate)
  };
}

module.exports = { 
  trackBotMessage, 
  deleteUserMessages,
  deleteBotMessagesOnly,
  deleteMessagesBatch
};
