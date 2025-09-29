const mainMenu = require('../menus/mainMenu');
const adminMenu = require('../menus/adminMenu');
const userApiService = require('../services/userApiService');
const { startSessionTimeout, clearUserSession, sendMessageWithTracking } = require('../utils/session');
const { trackBotMessage } = require('../utils/messages');

module.exports = function startHandler(bot) {
  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const userName = msg.from.first_name + (msg.from.last_name ? ` ${msg.from.last_name}` : '');
    
    console.log(`Comando /start recibido de: ${userName} (chatId: ${chatId}, telegram_id: ${chatId})`);
    
    await clearUserSession(bot, chatId);

    try {
      console.log(`Buscando usuario existente con telegram_id: ${chatId}`);
      const user = await userApiService.getUser(chatId);
      
      if (user) {
        console.log(`✅ Usuario encontrado: ${user.nombre} (ID: ${user.id}, Role: ${user.role_id})`);
        
        // Crear el teclado base para todos los usuarios
        let keyboard = [['🏠 Menú Principal','📊 Mi Perfil']];
        
        // Si es administrador (role_id = 1), añadir botón de admin
        if (user.role_id === 1) {
          console.log(`🔑 Usuario administrador detectado: ${user.nombre}`);
          keyboard.push(['🔑 Panel Admin']); // Añadir fila con botón de admin
        }
        
        const replyKeyboard = {
          reply_markup: { keyboard: keyboard, resize_keyboard: true }
        };
        
        const sent = await sendMessageWithTracking(bot, chatId,
          `Hola ${user.nombre}! 👋`, { ...mainMenu(user), ...replyKeyboard });
        startSessionTimeout(bot, chatId);
      } else {
        console.log(`❌ Usuario no encontrado, iniciando registro para: ${chatId}`);
        await startRegistrationProcess(bot, chatId);
      }
    } catch (error) {
      console.error('Error en startHandler:', error);
      
      let errorMessage = '❌ Error de conexión.';
      
      if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
        errorMessage = '⏱️ El servidor está tardando en responder.\n\n' +
                     '🔄 Intenta nuevamente en unos momentos.\n\n' +
                     '💡 Si el problema persiste, el servidor puede estar sobrecargado.';
      } else if (error.message.includes('ENOTFOUND') || error.message.includes('ECONNREFUSED')) {
        errorMessage = '🔌 No se puede conectar con el servidor.\n\n' +
                     '📡 Verifica que el backend esté disponible.';
      } else {
        errorMessage = '🔧 Error técnico del sistema.\n\n' +
                     '📞 Contacta al administrador si el problema persiste.';
      }
      
      await sendMessageWithTracking(bot, chatId, errorMessage, { parse_mode: 'Markdown' });
    }
  });

  // Función para iniciar el proceso de registro simplificado
  async function startRegistrationProcess(bot, chatId) {
    const simpleKeyboard = { 
      reply_markup: { 
        keyboard: [['📝 Registrarse']], 
        resize_keyboard: true 
      }
    };
    
    const welcomeMessage = await sendMessageWithTracking(
      bot,
      chatId,
      '¡Bienvenido! 👋\n\nPara comenzar, necesito que te registres.',
      { parse_mode: 'Markdown' }
    );

    await sendMessageWithTracking(bot, chatId, '🪪 Por favor, ingresa tu DNI:');
    bot.once('message', async (m1) => {
      if (m1.text === '📝 Registrarse') {
        await bot.sendMessage(chatId, '🪪 Por favor, ingresa tu DNI:');
        bot.once('message', async (m2) => {
          await handleDniInput(bot, chatId, m2);
        });
      } else {
        await handleDniInput(bot, chatId, m1);
      }
    });
  }

  // Manejar entrada del DNI y completar registro automáticamente
  async function handleDniInput(bot, chatId, msg) {
    const dni = msg.text.trim();
    
    // Validar DNI (básico)
    if (!/^\d{8,12}$/.test(dni)) {
      await bot.sendMessage(chatId, '❌ DNI inválido. Debe contener entre 8 y 12 dígitos.\n\n🪪 Ingresa tu DNI nuevamente:');
      bot.once('message', async (m) => {
        await handleDniInput(bot, chatId, m);
      });
      return;
    }

    // Obtener información del usuario desde Telegram
    const telegramUser = msg.from;
    const nombre = telegramUser.first_name + (telegramUser.last_name ? ` ${telegramUser.last_name}` : '');
    
    // Mostrar mensaje de procesamiento
    const processingMessage = await bot.sendMessage(chatId, '⏳ Registrando usuario...');
    
    try {
      // Registrar usuario directamente con valores por defecto
      await userApiService.addUser(
        chatId,           // telegram_id (tomado del chat)
        dni,              // dni (ingresado por el usuario)
        nombre,           // nombre (tomado de Telegram)
                         // role_id (por defecto 1)
        // sede omitido (será null/undefined y no se enviará)
      );
      
      // Eliminar mensaje de procesamiento
      await bot.deleteMessage(chatId, processingMessage.message_id);
      
      const confirmMessage = await bot.sendMessage(
        chatId, 
        `✅ Registro completado exitosamente!\n\n` +
        `👤 Nombre: ${nombre}\n` +
        `🪪 DNI: ${dni}\n` +
        `🏢 Sede: Sin sede asignada\n` +
        `👥 Rol: Usuario (ID: 1)`
      );
      trackBotMessage(chatId, confirmMessage.message_id);
      
      // Obtener usuario registrado y mostrar menú
      const user = await userApiService.getUser(chatId);
      
      if (user) {
        const fullKeyboard = {
          reply_markup: {
            keyboard: [
              ['🏠 Menú Principal', '📊 Mi Perfil'],
              ['🛒 Tienda', '📋 Reportes'],
              ['❓ Ayuda', '⚙️ Configuración']
            ],
            resize_keyboard: true,
            one_time_keyboard: false
          }
        };
        
        const menuMessage = await bot.sendMessage(
          chatId, 
          `Hola ${user.nombre}! Bienvenido al sistema 🎉`, 
          { ...mainMenu(user), ...fullKeyboard }
        );
        trackBotMessage(chatId, menuMessage.message_id);
        
        // Iniciar timeout de sesión
        startSessionTimeout(bot, chatId);
      }
      
    } catch (error) {
      console.error('Error al registrar usuario:', error);
      
      // Eliminar mensaje de procesamiento
      try {
        await bot.deleteMessage(chatId, processingMessage.message_id);
      } catch (deleteError) {
        // Ignorar error al eliminar mensaje
      }
      
      // Mostrar mensaje de error específico
      let errorMessage = '❌ Error al registrar usuario.';
      
      if (error.message.includes('conectar')) {
        errorMessage += '\n\n🔌 Problema de conectividad con el servidor.';
      } else if (error.message.includes('validación')) {
        errorMessage += '\n\n📝 Error en los datos proporcionados.';
      } else if (error.message.includes('autenticación')) {
        errorMessage += '\n\n🔐 Error de autenticación del sistema.';
      } else if (error.message.includes('configuración del backend')) {
        errorMessage += '\n\n⚙️ Error de configuración del servidor.';
        errorMessage += '\n\n🔧 El administrador debe configurar la base de datos correctamente.';
      } else {
        errorMessage += '\n\n🔧 Error técnico del sistema.';
      }
      
      errorMessage += '\n\nIntenta nuevamente con /start o contacta al administrador.';
      
      await bot.sendMessage(chatId, errorMessage, { parse_mode: 'Markdown' });
    }
  }
};