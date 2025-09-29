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
    fs.writeFileSync(CHAT_DATA_FILE, JSON.stringify(data, null, 2));
    return true;
  } catch (error) {
    console.error('Error al guardar datos de chat:', error);
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

module.exports = {
  addChatMessage,
  getUserMessages,
  clearUserMessages,
  getChatStats,
  cleanOldMessages,
  loadChatData,
  saveChatData
};