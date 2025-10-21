const fs = require('fs');
const path = require('path');

const CHAT_DATA_FILE = path.join(__dirname, '../../data/user_chats.json');

// Función para cargar los datos de chat desde el archivo JSON
function loadChatData() {
  try {
    if (fs.existsSync(CHAT_DATA_FILE)) {
      const data = fs.readFileSync(CHAT_DATA_FILE, 'utf8');
      return JSON.parse(data);
    }
    return {};
  } catch (error) {
    console.error('Error al cargar datos de chat:', error);
    return {};
  }
}

// Función para guardar los datos de chat en el archivo JSON
function saveChatData(data) {
  try {
    console.log(`[ChatManager] Guardando datos en: ${CHAT_DATA_FILE}`);
    console.log(`[ChatManager] Total de usuarios a guardar: ${Object.keys(data).length}`);
    
    // Verificar que el directorio existe
    const dir = path.dirname(CHAT_DATA_FILE);
    if (!fs.existsSync(dir)) {
      console.log(`[ChatManager] Creando directorio: ${dir}`);
      fs.mkdirSync(dir, { recursive: true });
    }
    
    fs.writeFileSync(CHAT_DATA_FILE, JSON.stringify(data, null, 2));
    console.log(`[ChatManager] ✅ Datos guardados exitosamente`);
    return true;
  } catch (error) {
    console.error(`[ChatManager] ❌ Error al guardar datos de chat:`, error);
    console.error(`[ChatManager] Ruta del archivo: ${CHAT_DATA_FILE}`);
    console.error(`[ChatManager] Directorio existe: ${fs.existsSync(path.dirname(CHAT_DATA_FILE))}`);
    return false;
  }
}

// Función para agregar un mensaje de chat a un usuario
function addChatMessage(userId, messageId, messageType = 'bot') {
  const chatData = loadChatData();
  
  if (!chatData[userId]) {
    chatData[userId] = {
      messages: [],
      lastActivity: new Date().toISOString()
    };
  }
  
  // Evitar duplicados
  const existingMessage = chatData[userId].messages.find(msg => msg.messageId === messageId);
  if (!existingMessage) {
    chatData[userId].messages.push({
      messageId: messageId,
      messageType: messageType,
      timestamp: new Date().toISOString()
    });
    
    chatData[userId].lastActivity = new Date().toISOString();
    saveChatData(chatData);
  }
}

// Función para obtener todos los mensajes de un usuario
function getUserMessages(userId) {
  const chatData = loadChatData();
  return chatData[userId] ? chatData[userId].messages : [];
}

// Función para limpiar todos los mensajes de un usuario
function clearUserMessages(userId) {
  const chatData = loadChatData();
  if (chatData[userId]) {
    delete chatData[userId];
    saveChatData(chatData);
    return true;
  }
  return false;
}

// Función para obtener estadísticas de mensajes
function getChatStats() {
  const chatData = loadChatData();
  const stats = {
    totalUsers: Object.keys(chatData).length,
    totalMessages: 0,
    userStats: {}
  };
  
  for (const [userId, userData] of Object.entries(chatData)) {
    const messageCount = userData.messages.length;
    stats.totalMessages += messageCount;
    stats.userStats[userId] = {
      messageCount: messageCount,
      lastActivity: userData.lastActivity
    };
  }
  
  return stats;
}

// Función para limpiar mensajes antiguos (opcional)
function cleanOldMessages(daysOld = 7) {
  const chatData = loadChatData();
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysOld);
  
  let cleaned = 0;
  for (const [userId, userData] of Object.entries(chatData)) {
    const lastActivity = new Date(userData.lastActivity);
    if (lastActivity < cutoffDate) {
      delete chatData[userId];
      cleaned++;
    }
  }
  
  if (cleaned > 0) {
    saveChatData(chatData);
    console.log(`Limpiados ${cleaned} usuarios con actividad antigua`);
  }
  
  return cleaned;
}

// Función para guardar/actualizar información del usuario
function saveUserInfo(chatId, userInfo) {
  try {
    console.log(`[ChatManager] Intentando guardar información para chat_id: ${chatId}`);
    console.log(`[ChatManager] Datos del usuario:`, userInfo);
    
    const chatData = loadChatData();
    console.log(`[ChatManager] Datos actuales cargados, usuarios existentes: ${Object.keys(chatData).length}`);
    
    if (!chatData[chatId]) {
      chatData[chatId] = {
        messages: [],
        lastActivity: new Date().toISOString()
      };
      console.log(`[ChatManager] Creando nueva entrada para chat_id: ${chatId}`);
    } else {
      console.log(`[ChatManager] Actualizando entrada existente para chat_id: ${chatId}`);
    }
    
    // Actualizar información del usuario
    chatData[chatId].userInfo = {
      id: userInfo.id,
      nombre: userInfo.nombre,
      dni: userInfo.dni,
      role_id: userInfo.role_id,
      telegram_id: chatId,
      lastLogin: new Date().toISOString(),
      ...userInfo // Incluir cualquier otra información adicional
    };
    
    chatData[chatId].lastActivity = new Date().toISOString();
    
    console.log(`[ChatManager] Datos preparados para guardar:`, {
      chatId,
      userInfo: chatData[chatId].userInfo,
      totalUsers: Object.keys(chatData).length
    });
    
    const saved = saveChatData(chatData);
    if (saved) {
      console.log(`[ChatManager] ✅ Información del usuario guardada exitosamente para chat_id: ${chatId}`);
      console.log(`[ChatManager] Usuario: ${userInfo.nombre} (DNI: ${userInfo.dni})`);
    } else {
      console.error(`[ChatManager] ❌ Error al guardar información del usuario para chat_id: ${chatId}`);
    }
    
    return saved;
  } catch (error) {
    console.error(`[ChatManager] ❌ Excepción al guardar información del usuario:`, error);
    return false;
  }
}

// Función para obtener información del usuario por chat_id
function getUserInfo(chatId) {
  const chatData = loadChatData();
  return chatData[chatId] ? chatData[chatId].userInfo : null;
}

// Función para buscar usuario por DNI
function findUserByDni(dni) {
  const chatData = loadChatData();
  
  for (const [chatId, userData] of Object.entries(chatData)) {
    if (userData.userInfo && userData.userInfo.dni === dni) {
      return {
        chatId: chatId,
        userInfo: userData.userInfo
      };
    }
  }
  
  return null;
}

// Función para buscar usuario por ID del backend
function findUserById(userId) {
  const chatData = loadChatData();
  
  for (const [chatId, userData] of Object.entries(chatData)) {
    if (userData.userInfo && userData.userInfo.id == userId) {
      return {
        chatId: chatId,
        userInfo: userData.userInfo
      };
    }
  }
  
  return null;
}

// Función para obtener todos los usuarios registrados
function getAllUsers() {
  const chatData = loadChatData();
  const users = [];
  
  for (const [chatId, userData] of Object.entries(chatData)) {
    if (userData.userInfo) {
      users.push({
        chatId: chatId,
        ...userData.userInfo
      });
    }
  }
  
  return users;
}

// Función para actualizar última actividad
function updateLastActivity(chatId) {
  const chatData = loadChatData();
  
  if (chatData[chatId]) {
    chatData[chatId].lastActivity = new Date().toISOString();
    saveChatData(chatData);
  }
}

// Función para actualizar el chat_id de un usuario existente
function updateUserChatId(userId, chatId) {
  try {
    const chatData = loadChatData();
    
    // Buscar el usuario por ID
    for (const [existingChatId, data] of Object.entries(chatData)) {
      if (data.userInfo && data.userInfo.id === userId) {
        // Actualizar el chat_id si es diferente
        if (existingChatId !== chatId.toString()) {
          console.log(`🔄 Actualizando chat_id del usuario ${userId}: ${existingChatId} -> ${chatId}`);
          
          // Crear nueva entrada con el chat_id correcto
          chatData[chatId.toString()] = {
            ...data,
            userInfo: {
              ...data.userInfo,
              chat_id: chatId.toString(),
              telegram_id: chatId.toString()
            }
          };
          
          // Eliminar la entrada antigua si es diferente
          if (existingChatId !== chatId.toString()) {
            delete chatData[existingChatId];
          }
          
          saveChatData(chatData);
          console.log(`✅ Chat_id actualizado correctamente para usuario ${userId}`);
          return true;
        }
        return true; // Ya está correcto
      }
    }
    
    console.log(`⚠️ No se encontró usuario con ID ${userId} para actualizar chat_id`);
    return false;
  } catch (error) {
    console.error('❌ Error al actualizar chat_id:', error);
    return false;
  }
}

// Función para sincronizar chat_id con el backend
async function syncChatIdWithBackend(userId, chatId) {
  try {
    const userApiService = require('../services/userApiService');
    
    console.log(`🔄 Sincronizando chat_id con backend para usuario ${userId}: ${chatId}`);
    
    const result = await userApiService.updateUserChatId(userId, chatId);
    
    if (result) {
      console.log(`✅ Chat_id sincronizado exitosamente con backend para usuario ${userId}`);
      return true;
    }
    
    return false;
  } catch (error) {
    console.error(`❌ Error al sincronizar chat_id con backend para usuario ${userId}:`, error.message);
    return false;
  }
}

module.exports = {
  addChatMessage,
  getUserMessages,
  clearUserMessages,
  getChatStats,
  cleanOldMessages,
  loadChatData,
  saveChatData,
  saveUserInfo,
  getUserInfo,
  findUserByDni,
  findUserById,
  getAllUsers,
  updateLastActivity,
  updateUserChatId,
  syncChatIdWithBackend
};