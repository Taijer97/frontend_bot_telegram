const userSessions = new Map();
const sessionTimeouts = new Map();
const warningTimeouts = new Map();
const { deleteUserMessages } = require('./messages');
const { clearNavigationStack } = require('./navigation');
const { clearUserMessages: clearUserChatData, addChatMessage } = require('./chatManager');

async function clearUserSession(bot, chatId, skipFinalMessage = false) {
  console.log(`🧹 Iniciando limpieza completa de sesión para usuario: ${chatId}`);
  
  try {
    // 1. Limpiar mensajes del bot con estadísticas detalladas
    console.log(`📱 Limpiando mensajes del bot...`);
    const deleteResults = await deleteUserMessages(bot, chatId);
    
    // 2. Limpiar stack de navegación
    console.log(`🧭 Limpiando stack de navegación...`);
    clearNavigationStack(chatId);
    
    // 3. Limpiar timeouts de sesión
    console.log(`⏰ Limpiando timeouts...`);
    if (sessionTimeouts.has(chatId)) {
      clearTimeout(sessionTimeouts.get(chatId));
      sessionTimeouts.delete(chatId);
    }
    if (warningTimeouts.has(chatId)) {
      clearTimeout(warningTimeouts.get(chatId));
      warningTimeouts.delete(chatId);
    }
    
    // 4. Solo resetear teclado si no se va a enviar mensaje después
    if (!skipFinalMessage) {
      console.log(`⌨️ Reseteando teclado persistente...`);
      try {
        await bot.sendMessage(chatId, 
          '🔄 Sesión limpiada.', {
          reply_markup: {
            keyboard: [['🚀 Iniciar']], 
            resize_keyboard: true 
          }
        });
      } catch (keyboardError) {
        console.log(`⚠️ No se pudo resetear el teclado: ${keyboardError.message}`);
      }
    }
    
    // 5. Limpiar datos de chat guardados en JSON
    console.log(`💾 Limpiando datos de chat en JSON...`);
    const jsonCleared = clearUserChatData(chatId.toString());
    
    // 6. Limpiar sesión en memoria (incluyendo estados temporales)
    console.log(`🧠 Limpiando sesión en memoria...`);
    if (userSessions.has(chatId)) {
      const session = userSessions.get(chatId);
      // Limpiar cualquier estado temporal específico
      if (session.waitingForDni) {
        console.log(`🆔 Limpiando estado de espera de DNI...`);
        delete session.waitingForDni;
      }
      if (session.waitingForCleanupUserId) {
        console.log(`🔧 Limpiando estado de espera de limpieza...`);
        delete session.waitingForCleanupUserId;
      }
      // Limpiar cualquier otro estado temporal que pueda existir
      Object.keys(session).forEach(key => {
        if (key.startsWith('waiting') || key.startsWith('temp')) {
          console.log(`🔄 Limpiando estado temporal: ${key}`);
          delete session[key];
        }
      });
    }
    userSessions.delete(chatId);
    
    // 7. Resetear estado del usuario en base de datos (opcional)
    console.log(`🗄️ Verificando estado del usuario en base de datos...`);
    try {
      const { getUserById, updateUserEstado } = require('../../db');
      const user = getUserById(chatId);
      if (user && user.estado !== '1') {
        console.log(`🔄 Reseteando estado del usuario a activo...`);
        updateUserEstado(chatId, '1'); // Resetear a estado activo
      }
    } catch (dbError) {
      console.log(`⚠️ No se pudo verificar/resetear estado en BD: ${dbError.message}`);
    }
    
    // 8. Verificación final
    console.log(`🔍 Verificando limpieza completa...`);
    const verificationResults = {
      sessionTimeouts: !sessionTimeouts.has(chatId),
      warningTimeouts: !warningTimeouts.has(chatId),
      userSessions: !userSessions.has(chatId),
      chatDataCleared: jsonCleared
    };
    
    const allClean = Object.values(verificationResults).every(clean => clean);
    
    // 9. Resumen final con estadísticas de mensajes
    console.log(`\n📊 === RESUMEN DE LIMPIEZA DE SESIÓN ===`);
    console.log(`👤 Usuario: ${chatId}`);
    console.log(`📱 Mensajes procesados: ${deleteResults.total}`);
    console.log(`✅ Mensajes eliminados: ${deleteResults.deleted}`);
    console.log(`❌ Mensajes fallidos: ${deleteResults.failed}`);
    console.log(`📈 Tasa de éxito: ${deleteResults.successRate}%`);
    console.log(`🧭 Stack de navegación: Limpiado`);
    console.log(`⏰ Timeouts: Limpiados`);
    console.log(`⌨️ Teclado persistente: ${skipFinalMessage ? 'Se manejará externamente' : 'Reseteado'}`);
    console.log(`💾 Datos JSON: ${jsonCleared ? 'Limpiados' : 'No existían'}`);
    console.log(`🧠 Sesión en memoria: Limpiada`);
    
    if (allClean) {
      console.log(`✅ Estado general: LIMPIEZA COMPLETA`);
    } else {
      console.log(`⚠️ Estado general: LIMPIEZA PARCIAL`);
      console.log(`📊 Detalles:`, verificationResults);
    }
     
    console.log(`🏁 Limpieza de sesión completada para usuario: ${chatId}\n`);
    return deleteResults;
    
  } catch (error) {
    console.error(`❌ Error durante la limpieza de sesión para usuario ${chatId}:`, error);
    throw error;
  }
}

function startSessionTimeout(bot, chatId) {
  if (sessionTimeouts.has(chatId)) clearTimeout(sessionTimeouts.get(chatId));
  if (warningTimeouts.has(chatId)) clearTimeout(warningTimeouts.get(chatId));

  const warning = setTimeout(async () => {
    const msg = await bot.sendMessage(chatId,
      '⏰ ¿Estás ahí? ¿Hay algo más en lo que te pueda ayudar?\n\n' +
      'Tu sesión se cerrará automáticamente en 2 minutos por inactividad.', {
      reply_markup: {
        inline_keyboard: [
          [{ text: '✅ Sí, continuar', callback_data: 'session_continue' },
           { text: '❌ No, salir', callback_data: 'session_exit' }]
        ]
      }
    });
    
    // Guardar el mensaje de advertencia
    addChatMessage(chatId.toString(), msg.message_id, 'warning');
  }, 3 * 60 * 1000);

  const end = setTimeout(async () => {
    // Primero limpiar la sesión (sin enviar mensaje final)
    await clearUserSession(bot, chatId, true);
    
    // DESPUÉS enviar el mensaje con el botón de inicio
    await bot.sendMessage(chatId,
      '⏱️ Sesión terminada por inactividad.\n\n' +
      'Presiona "Iniciar" para comenzar de nuevo.', {
      reply_markup: {
        keyboard: [['🚀 Iniciar']], 
        resize_keyboard: true 
      }
    });
  }, 5 * 60 * 1000);

  warningTimeouts.set(chatId, warning);
  sessionTimeouts.set(chatId, end);
  userSessions.set(chatId, { lastActivity: Date.now() });
}

function renewSessionTimeout(bot, chatId) {
  if (userSessions.has(chatId)) startSessionTimeout(bot, chatId);
}

// Función para trackear mensajes del bot
function trackBotMessage(chatId, messageId, messageType = 'bot') {
  addChatMessage(chatId.toString(), messageId, messageType);
}

// Función helper para sendMessage con tracking automático
async function sendMessageWithTracking(bot, chatId, text, options = {}, messageType = 'bot') {
  try {
    const sentMessage = await bot.sendMessage(chatId, text, options);
    trackBotMessage(chatId, sentMessage.message_id, messageType);
    return sentMessage;
  } catch (error) {
    console.error('Error enviando mensaje:', error);
    throw error;
  }
}

// Función helper para editMessageText con tracking automático
async function editMessageWithTracking(bot, text, options = {}, messageType = 'bot') {
  try {
    const result = await bot.editMessageText(text, options);
    // Para editMessageText, el message_id ya está en options.message_id
    if (options.message_id && options.chat_id) {
      trackBotMessage(options.chat_id, options.message_id, messageType);
    }
    return result;
  } catch (error) {
    console.error('Error editando mensaje:', error);
    throw error;
  }
}

/**
 * Función para limpieza selectiva de mensajes
 * Permite limpiar solo ciertos tipos de mensajes o mensajes recientes
 */
async function clearUserMessagesSelective(bot, chatId, options = {}) {
  const {
    messageTypes = ['bot', 'warning', 'session_end'], // Tipos de mensaje a eliminar
    maxAge = null, // Edad máxima en horas (null = todos)
    maxCount = null, // Máximo número de mensajes a eliminar (null = todos)
    skipErrors = true // Si continuar cuando hay errores
  } = options;
  
  console.log(`🎯 Limpieza selectiva para usuario ${chatId}:`, options);
  
  try {
    const { getUserMessages } = require('./chatManager');
    const jsonMessages = getUserMessages(chatId.toString());
    
    // Filtrar mensajes según criterios
    let messagesToDelete = jsonMessages.filter(msgData => {
      // Filtrar por tipo
      if (!messageTypes.includes(msgData.messageType)) {
        return false;
      }
      
      // Filtrar por edad
      if (maxAge !== null) {
        const messageAge = (Date.now() - new Date(msgData.timestamp).getTime()) / (1000 * 60 * 60);
        if (messageAge > maxAge) {
          return false;
        }
      }
      
      return true;
    });
    
    // Limitar cantidad si se especifica
    if (maxCount !== null && messagesToDelete.length > maxCount) {
      // Ordenar por timestamp (más recientes primero) y tomar los más recientes
      messagesToDelete.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      messagesToDelete = messagesToDelete.slice(0, maxCount);
    }
    
    console.log(`🎯 Mensajes seleccionados para eliminar: ${messagesToDelete.length}`);
    
    if (messagesToDelete.length === 0) {
      console.log(`ℹ️ No hay mensajes que cumplan los criterios de selección`);
      return { total: 0, deleted: 0, failed: 0, successRate: 100 };
    }
    
    // Eliminar mensajes seleccionados
    const { deleteMessagesBatch } = require('./messages');
    const messageIds = messagesToDelete.map(msg => msg.messageId);
    
    const results = await deleteMessagesBatch(bot, chatId, messageIds, 5, 200);
    
    console.log(`🎯 Limpieza selectiva completada: ${results.deleted}/${results.total} eliminados`);
    return results;
    
  } catch (error) {
    console.error(`❌ Error en limpieza selectiva para usuario ${chatId}:`, error);
    if (!skipErrors) throw error;
    return { total: 0, deleted: 0, failed: 1, successRate: 0, error: error.message };
  }
}

module.exports = { 
  startSessionTimeout, 
  renewSessionTimeout, 
  clearUserSession,
  clearUserMessagesSelective, // Nueva función
  userSessions,
  trackBotMessage,
  sendMessageWithTracking,
  editMessageWithTracking
};
