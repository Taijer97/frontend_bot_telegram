const userApiService = require('../services/userApiService');
const { renewSessionTimeout, userSessions, trackBotMessage } = require('../utils/session');
const mainMenu = require('../menus/mainMenu');
const adminMenu = require('../menus/adminMenu');
const consultasMenu = require('../menus/consultasMenu');

module.exports = function messageHandler(bot) {
  // Handler para fotos (proceso de autorización)
  bot.on('photo', async (msg) => {
    const chatId = msg.chat.id;
    
    // Trackear mensaje del usuario
    trackBotMessage(chatId, msg.message_id, 'user');
    
    try {
      const user = await userApiService.getUser(chatId);
      
      // Si el usuario no existe, ignorar
      if (!user) {
        console.log(`[FOTO DEBUG] Usuario no encontrado para chatId: ${chatId}`);
        return;
      }

      // Verificar si hay una alerta de sesión activa
      const session = userSessions.get(chatId) || {};
      if (session.warningActive) {
        await bot.sendMessage(chatId, 
          '⚠️ <b>Acción bloqueada</b>\n\n' +
          'Tienes una alerta de sesión pendiente. Debes responder primero si quieres continuar o salir.\n\n' +
          'Solo puedes usar los botones "✅ Sí, continuar" o "❌ No, salir".',
          { parse_mode: 'HTML' }
        );
        return;
      }

      console.log(`[FOTO DEBUG] Usuario encontrado: ${user.nombre}, chatId: ${chatId}`);
      console.log(`[FOTO DEBUG] userSessions.has(${chatId}):`, userSessions.has(chatId));

      // Verificar si el usuario está en proceso de autorización
      if (!userSessions.has(chatId)) {
        console.log(`[FOTO DEBUG] No hay sesión activa para chatId: ${chatId}`);
        await bot.sendMessage(chatId, 
          '📷 Foto recibida, pero no estás en ningún proceso activo.\n\n' +
          'Si quieres crear una autorización, ve a: Consultas → Crear autorización'
        );
        return;
      }

      console.log(`[FOTO DEBUG] Sesión encontrada:`, session);
      console.log(`[FOTO DEBUG] autorizacionStep:`, session.autorizacionStep);
      
      if (!session.autorizacionStep) {
        console.log(`[FOTO DEBUG] No hay autorizacionStep en la sesión`);
        await bot.sendMessage(chatId, 
          '📷 Foto recibida, pero no estás en proceso de autorización.\n\n' +
          'Si quieres crear una autorización, ve a: Consultas → Crear autorización'
        );
        return;
      }

      // Renovar timeout de sesión
      renewSessionTimeout(bot, chatId);

      // Obtener la foto de mayor calidad
      const photo = msg.photo[msg.photo.length - 1];
      const fileId = photo.file_id;

      try {
        // Descargar la foto
        const file = await bot.getFile(fileId);
        const fileUrl = `https://api.telegram.org/file/bot${bot.token}/${file.file_path}`;
        
        const axios = require('axios');
        const response = await axios.get(fileUrl, { 
          responseType: 'arraybuffer',
          timeout: 30000 
        });
        
        const photoBuffer = Buffer.from(response.data);

        if (session.autorizacionStep === 'esperando_firma') {
          // Guardar la firma
          session.autorizacionData.firma = {
            buffer: photoBuffer,
            filename: `firma_${user.dni}.jpg`
          };
          
          // Cambiar al siguiente paso
          session.autorizacionStep = 'esperando_huella';

          await bot.sendMessage(chatId,
            '✅ **Firma recibida correctamente**\n\n' +
            '👆 **Paso 2 de 2: Huella dactilar**\n\n' +
            '📋 **Instrucciones:**\n' +
            '• Coloca tu dedo índice en una superficie blanca\n' +
            '• Toma una foto clara de tu huella\n' +
            '• Asegúrate de que se vean las líneas claramente\n' +
            '• Evita sombras o reflejos\n\n' +
            '📷 **Envía la foto de tu huella ahora:**',
            {
              parse_mode: 'Markdown',
              reply_markup: {
                inline_keyboard: [
                  [{ text: '❌ Cancelar proceso', callback_data: 'autorizacion_cancelar' }]
                ]
              }
            }
          );

        } else if (session.autorizacionStep === 'esperando_huella') {
          // Guardar la huella
          session.autorizacionData.huella = {
            buffer: photoBuffer,
            filename: `huella_${user.dni}_${Date.now()}.jpg`
          };
          
          // Cambiar al paso de confirmación
          session.autorizacionStep = 'confirmacion';

          await bot.sendMessage(chatId,
            '✅ **Huella recibida correctamente**\n\n' +
            '📋 **Resumen de tu autorización:**\n' +
            `👤 **Nombre:** ${user.nombre}\n` +
            `🆔 **DNI:** ${user.dni}\n` +
            `📝 **Firma:** ✅ Recibida\n` +
            `👆 **Huella:** ✅ Recibida\n` +
            `📅 **Fecha:** ${new Date().toLocaleDateString('es-ES')}\n\n` +
            '⚠️ **¿Confirmas que quieres enviar esta autorización?**\n' +
            'Una vez enviada no podrás modificarla.',
            {
              parse_mode: 'Markdown',
              reply_markup: {
                inline_keyboard: [
                  [{ text: '✅ Confirmar y enviar', callback_data: 'autorizacion_enviar' }],
                  [{ text: '❌ Cancelar proceso', callback_data: 'autorizacion_cancelar' }]
                ]
              }
            }
          );

        } else {
          await bot.sendMessage(chatId, 
            '❌ Estado de proceso inválido. Por favor reinicia el proceso.',
            {
              reply_markup: {
                inline_keyboard: [
                  [{ text: '🔙 Volver a Consultas', callback_data: 'consulta' }]
                ]
              }
            }
          );
        }

      } catch (downloadError) {
        console.error('Error descargando foto:', downloadError);
        await bot.sendMessage(chatId,
          '❌ **Error al procesar la foto**\n\n' +
          'No se pudo descargar o procesar la imagen.\n' +
          'Por favor, intenta enviar la foto nuevamente.',
          {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [{ text: '❌ Cancelar proceso', callback_data: 'autorizacion_cancelar' }]
              ]
            }
          }
        );
      }

    } catch (error) {
      console.error('Error en handler de fotos:', error);
      await bot.sendMessage(chatId,
        '❌ Error interno al procesar la foto. Intenta nuevamente.',
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔙 Volver a Consultas', callback_data: 'consulta' }]
            ]
          }
        }
      );
    }
  });

  // Handler para documentos
  bot.on('document', async (msg) => {
    const chatId = msg.chat.id;
    
    // Trackear mensaje del usuario
    trackBotMessage(chatId, msg.message_id, 'user');
    
    try {
      const user = await userApiService.getUser(chatId);
      if (!user) return;

      // Verificar si hay una alerta de sesión activa
      const session = userSessions.get(chatId) || {};
      if (session.warningActive) {
        await bot.sendMessage(chatId, 
          '⚠️ <b>Acción bloqueada</b>\n\n' +
          'Tienes una alerta de sesión pendiente. Debes responder primero si quieres continuar o salir.\n\n' +
          'Solo puedes usar los botones "✅ Sí, continuar" o "❌ No, salir".',
          { parse_mode: 'HTML' }
        );
        return;
      }

      await bot.sendMessage(chatId, 
        '📄 <b>Documento recibido</b>\n\n' +
        'Actualmente solo procesamos fotos para el proceso de autorización.\n\n' +
        'Si necesitas enviar una imagen, por favor envíala como foto, no como documento.',
        { 
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [{ text: '📝 Ir a Consultas', callback_data: 'consulta' }]
            ]
          }
        }
      );
    } catch (error) {
      console.error('Error en handler de documentos:', error);
    }
  });

  // Handler para videos
  bot.on('video', async (msg) => {
    const chatId = msg.chat.id;
    
    // Trackear mensaje del usuario
    trackBotMessage(chatId, msg.message_id, 'user');
    
    try {
      const user = await userApiService.getUser(chatId);
      if (!user) return;

      // Verificar si hay una alerta de sesión activa
      const session = userSessions.get(chatId) || {};
      if (session.warningActive) {
        await bot.sendMessage(chatId, 
          '⚠️ <b>Acción bloqueada</b>\n\n' +
          'Tienes una alerta de sesión pendiente. Debes responder primero si quieres continuar o salir.\n\n' +
          'Solo puedes usar los botones "✅ Sí, continuar" o "❌ No, salir".',
          { parse_mode: 'HTML' }
        );
        return;
      }

      await bot.sendMessage(chatId, 
        '🎥 <b>Video recibido</b>\n\n' +
        'Actualmente solo procesamos fotos para el proceso de autorización.\n\n' +
        'Si necesitas enviar una imagen de tu firma o huella, por favor envíala como foto.',
        { 
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [{ text: '📝 Ir a Consultas', callback_data: 'consulta' }]
            ]
          }
        }
      );
    } catch (error) {
      console.error('Error en handler de videos:', error);
    }
  });

  // Handler para audios
  bot.on('audio', async (msg) => {
    const chatId = msg.chat.id;
    
    // Trackear mensaje del usuario
    trackBotMessage(chatId, msg.message_id, 'user');
    
    try {
      const user = await userApiService.getUser(chatId);
      if (!user) return;

      // Verificar si hay una alerta de sesión activa
      const session = userSessions.get(chatId) || {};
      if (session.warningActive) {
        await bot.sendMessage(chatId, 
          '⚠️ <b>Acción bloqueada</b>\n\n' +
          'Tienes una alerta de sesión pendiente. Debes responder primero si quieres continuar o salir.\n\n' +
          'Solo puedes usar los botones "✅ Sí, continuar" o "❌ No, salir".',
          { parse_mode: 'HTML' }
        );
        return;
      }

      await bot.sendMessage(chatId, 
        '🎤 <b>Audio recibido</b>\n\n' +
        'Actualmente no procesamos mensajes de audio.\n\n' +
        'Usa el menú de abajo para navegar por las opciones disponibles.',
        { 
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [{ text: '📝 Ir a Consultas', callback_data: 'consulta' }]
            ]
          }
        }
      );
    } catch (error) {
      console.error('Error en handler de audios:', error);
    }
  });

  // Handler para stickers
  bot.on('sticker', async (msg) => {
    const chatId = msg.chat.id;
    
    // Trackear mensaje del usuario
    trackBotMessage(chatId, msg.message_id, 'user');
    
    try {
      const user = await userApiService.getUser(chatId);
      
      if (!user) {
        return; // Usuario no registrado, ignorar
      }

      // Verificar si hay una alerta de sesión activa
      const session = userSessions.get(chatId) || {};
      if (session.warningActive) {
        await bot.sendMessage(chatId, 
          '⚠️ <b>Acción bloqueada</b>\n\n' +
          'Tienes una alerta de sesión pendiente. Debes responder primero si quieres continuar o salir.\n\n' +
          'Solo puedes usar los botones "✅ Sí, continuar" o "❌ No, salir".',
          { parse_mode: 'HTML' }
        );
        return;
      }

      await bot.sendMessage(chatId, 
        '😄 <b>Sticker recibido</b>\n\n' +
        '¡Gracias por el sticker! Usa el menú de abajo para navegar por las opciones disponibles.',
        { 
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [{ text: '📝 Ir a Consultas', callback_data: 'consulta' }]
            ]
          }
        }
      );
    } catch (error) {
      console.error('Error en handler de stickers:', error);
    }
  });

  bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    // Ignorar comandos, fotos, documentos, videos, audios, voces, stickers y animaciones
    if (!text || text.startsWith('/') || msg.photo || msg.document || msg.video || msg.audio || msg.voice || msg.sticker || msg.animation) {
      return;
    }
    
    // Trackear mensaje del usuario
    trackBotMessage(chatId, msg.message_id, 'user');

    try {
      const user = await userApiService.getUser(chatId);
      
      // Si el usuario no existe, no procesar el mensaje (está en proceso de registro)
      if (!user) {
        return; // Simplemente ignorar el mensaje sin mostrar error
      }

      // Verificar si hay una alerta de sesión activa
      const session = userSessions.get(chatId) || {};
      if (session.warningActive) {
        await bot.sendMessage(chatId, 
          '⚠️ <b>Acción bloqueada</b>\n\n' +
          'Tienes una alerta de sesión pendiente. Debes responder primero si quieres continuar o salir.\n\n' +
          'Solo puedes usar los botones "✅ Sí, continuar" o "❌ No, salir".',
          { parse_mode: 'HTML' }
        );
        return;
      }

      // Manejar actualización de DNI si el usuario está en estado de espera
      if (userSessions.has(chatId) && userSessions.get(chatId).waitingForDni) {
        const targetUserId = userSessions.get(chatId).waitingForDni;
        
        // Validar DNI (entre 6 y 12 caracteres)
        if (!text || text.length < 6 || text.length > 12) {
          await bot.sendMessage(chatId, 
            '❌ **DNI inválido**\n\nEl DNI debe tener entre 6 y 12 caracteres.\n\nInténtalo nuevamente:',
            { parse_mode: 'Markdown' }
          );
          return;
        }

        try {
          console.log(`Actualizando DNI del usuario ${targetUserId} con nuevo DNI: ${text}`);
          
          // Actualizar DNI en el backend
          const updateResult = await userApiService.updateUser(targetUserId, { dni: text });
          
          if (updateResult && updateResult.success) {
            console.log('DNI actualizado exitosamente:', updateResult);
            
            // Limpiar la sesión de espera
            userSessions.delete(chatId);
            
            // Obtener el usuario actualizado
            const updatedUser = await userApiService.getUserById(targetUserId);
            
            if (updatedUser) {
              console.log('Usuario actualizado obtenido:', updatedUser);
              
              // Determinar el rol y emoji
              const roleName = updatedUser.role_id === 1 ? 'Admin' : 'Usuario';
              const rolEmoji = updatedUser.role_id === 1 ? '👑' : '👤';
              
              // Crear menú de detalles del usuario
              const userDetailMenu = {
                reply_markup: {
                  inline_keyboard: [
                    [
                      { text: '✏️ Editar DNI', callback_data: `edit_dni_${updatedUser.id}` },
                      { text: '🎭 Cambiar Rol', callback_data: `edit_rol_${updatedUser.id}` }
                    ],
                    [{ text: '🔙 Volver a Lista', callback_data: 'admin_users' }]
                  ]
                }
              };
              
              // Usar sendMessage en lugar de editMessageText ya que no tenemos messageId
              await bot.sendMessage(chatId,
                `👤 **Detalles del Usuario**\n\n` +
                `${rolEmoji} **Nombre:** ${updatedUser.nombre || 'No especificado'}\n` +
                `🆔 **DNI:** ${updatedUser.dni || 'No especificado'}\n` +
                `📱 **Telegram ID:** ${updatedUser.telegram_id || 'No especificado'}\n` +
                `🎭 **Rol:** ${roleName}\n` +
                `🏢 **Sede:** ${updatedUser.sede || 'Sin sede'}\n\n` +
                `✅ **DNI actualizado exitosamente**\n\n` +
                `Selecciona una acción:`,
                {
                  parse_mode: 'Markdown',
                  reply_markup: userDetailMenu.reply_markup
                }
              );
            } else {
              console.error('No se pudo obtener el usuario actualizado');
              await bot.sendMessage(chatId, 
                '❌ **Error**\n\nNo se pudo obtener los datos actualizados del usuario.',
                { parse_mode: 'Markdown' }
              );
            }
            
          } else {
            console.error('Error en la respuesta del backend:', updateResult);
            await bot.sendMessage(chatId, 
              '❌ **Error al actualizar DNI**\n\nEl backend devolvió un error. Inténtalo nuevamente.',
              { parse_mode: 'Markdown' }
            );
          }
          
        } catch (error) {
          console.error('Error completo al actualizar DNI:', error);
          console.error('Stack trace:', error.stack);
          await bot.sendMessage(chatId, 
            '❌ **Error al actualizar DNI**\n\nNo se pudo conectar con el backend. Inténtalo nuevamente.',
            { parse_mode: 'Markdown' }
          );
        }
        return;
      }

      // Manejar generación de autorización por DNI (admin)
      if (userSessions.has(chatId) && userSessions.get(chatId).adminAction === 'generar_autorizacion') {
        // Validar DNI (solo números, entre 6 y 12 caracteres)
        if (!text || !/^\d{6,12}$/.test(text)) {
          await bot.sendMessage(chatId, 
            '❌ **DNI inválido**\n\n' +
            'El DNI debe contener solo números y tener entre 6 y 12 dígitos.\n\n' +
            '📋 Ejemplo: 12345678\n\n' +
            'Inténtalo nuevamente:',
            { 
              parse_mode: 'Markdown',
              reply_markup: {
                inline_keyboard: [
                  [{ text: '❌ Cancelar', callback_data: 'admin_autorizaciones' }]
                ]
              }
            }
          );
          return;
        }

        try {
          // Buscar usuario por DNI
          const axios = require('axios');
          const backendUrl = process.env.BACKEND_BASE_URL;
          const response = await axios.get(`${backendUrl}/users/dni/${text}`, {
            headers: {
              'Authorization': `Bearer ${process.env.BACKEND_API_KEY}`,
              'X-API-Key': process.env.BACKEND_API_KEY
            }
          });

          if (response.data.success && response.data.usuario) {
            const userData = response.data.usuario;
            
            // Limpiar la sesión de admin
            userSessions.delete(chatId);
            
            // Mostrar confirmación con datos del usuario
            const { confirmarGenerarAutorizacion } = require('../menus/autorizacionesMenu');
            
            await bot.sendMessage(chatId,
              '👤 **Usuario Encontrado**\n\n' +
              `📛 **Nombre:** ${userData.nombre}\n` +
              `🆔 **DNI:** ${userData.dni}\n` +
              `📱 **Telegram ID:** ${userData.telegram_id}\n` +
              `🏢 **Sede:** ${userData.sede || 'Sin sede'}\n\n` +
              '❓ **¿Deseas generar una autorización para este usuario?**',
              {
                parse_mode: 'Markdown',
                ...confirmarGenerarAutorizacion(text, userData)
              }
            );
          } else {
            await bot.sendMessage(chatId, 
              '❌ **Usuario no encontrado**\n\n' +
              `No se encontró ningún usuario con el DNI: ${text}\n\n` +
              'Verifica que el DNI sea correcto e inténtalo nuevamente:',
              { 
                parse_mode: 'Markdown',
                reply_markup: {
                  inline_keyboard: [
                    [{ text: '❌ Cancelar', callback_data: 'admin_autorizaciones' }]
                  ]
                }
              }
            );
          }
        } catch (error) {
          console.error('Error al buscar usuario por DNI:', error);
          await bot.sendMessage(chatId, 
            '❌ **Error de Conexión**\n\n' +
            'No se pudo conectar con el servidor para buscar el usuario.\n\n' +
            'Inténtalo más tarde.',
            { 
              parse_mode: 'Markdown',
              reply_markup: {
                inline_keyboard: [
                  [{ text: '🔄 Intentar de nuevo', callback_data: 'admin_generar_autorizacion' }],
                  [{ text: '🔙 Volver al Menú', callback_data: 'admin_autorizaciones' }]
                ]
              }
            }
          );
        }
        return;
      }

      // Renovar timeout de sesión
      renewSessionTimeout(bot, chatId);

      switch (text) {
        case '👤 Perfil':
          await bot.sendMessage(chatId, 
            `👤 <b>Tu Perfil</b>\n\n` +
            `📛 <b>Nombre:</b> ${user.nombre}\n` +
            `🆔 <b>DNI:</b> ${user.dni}\n` +
            `📱 <b>Telegram ID:</b> ${user.telegram_id}\n` +
            `🎭 <b>Rol:</b> ${user.role_id === 1 ? 'Administrador' : 'Usuario'}\n` +
            `🏢 <b>Sede:</b> ${user.sede || 'Sin sede'}`,
            { parse_mode: 'HTML' }
          );
          break;

        case '📝 Consultas':
          // Verificar si el usuario es administrador
          if (user.role_id === 1) {
            await bot.sendMessage(chatId, 
              '❌ <b>Acceso restringido</b>\n\n' +
              'Los administradores no tienen acceso a la sección de consultas.\n' +
              'Usa el Panel Admin para gestionar el sistema.',
              { parse_mode: 'HTML' }
            );
            return;
          }
          
          const consultasMenu = require('../menus/consultasMenu');
          await bot.sendMessage(chatId, 'Selecciona una consulta:', consultasMenu());
          break;

        case '🛒 Tienda':
          const { tiendaWebApp } = require('../menus/shopMenu');
          await bot.sendMessage(chatId, 'Bienvenido a la tienda 🛍️', tiendaWebApp());
          break;

        case '📊 Reportes':
          const reportsMenu = require('../menus/reportsMenu');
          await bot.sendMessage(chatId, 'Selecciona un reporte:', reportsMenu());
          break;

        case '🔑 Panel Admin':
          if (user.role_id === 1) {
            const adminMenu = require('../menus/adminMenu');
            await bot.sendMessage(chatId, 'Panel de Administración:', adminMenu());
          } else {
            await bot.sendMessage(chatId, '❌ No tienes permisos de administrador.');
          }
          break;

        case '🚪 Cerrar Sesión':
          // Limpiar sesión y mostrar solo botón de inicio
          const { clearUserSession } = require('../utils/session');
          await clearUserSession(bot, chatId);
          
          const startKeyboard = {
            reply_markup: { 
              keyboard: [['🚀 Iniciar']], 
              resize_keyboard: true 
            }
          };
          
          await bot.sendMessage(chatId, 
            '👋 <b>Sesión cerrada</b>\n\nPresiona "Iniciar" para volver a comenzar.',
            { parse_mode: 'HTML', ...startKeyboard }
          );
          break;

        case '🚀 Iniciar':
          // Recrear sesión
          try {
            const user = await userApiService.getUser(chatId);
            if (user) {
              // Recrear menú persistente
              let keyboard = [
                ['👤 Perfil']
              ];
              
              // Solo agregar consultas si NO es administrador
              if (user.role_id !== 1) {
                keyboard[0].push('📝 Consultas'); // Agregar a la primera fila
                keyboard.push(['🛒 Tienda', '📊 Reportes']); // Segunda fila
              } else {
                keyboard.push(['🛒 Tienda', '📊 Reportes']); // Primera fila para admins
              }
              
              if (user.role_id === 1) {
                keyboard.push(['🔑 Panel Admin']);
              }
              
              keyboard.push(['🚪 Cerrar Sesión']);
              
              const replyKeyboard = {
                reply_markup: { keyboard: keyboard, resize_keyboard: true }
              };
              
              const { startSessionTimeout } = require('../utils/session');
              startSessionTimeout(bot, chatId);
              
              await bot.sendMessage(chatId,
                `¡Hola ${user.nombre}! 👋\n\nUsa el menú de abajo para navegar.`, replyKeyboard);
            }
          } catch (error) {
            await bot.sendMessage(chatId, '❌ Error al iniciar sesión.');
          }
          break;

        default:
          await bot.sendMessage(chatId, 
            '❓ <b>Comando no reconocido</b>\n\n' +
            'Usa las opciones del menú de abajo para navegar:\n\n' +
            '• 👤 Perfil - Ver tu información\n' +
            '• 📝 Consultas - Ver reportes y crédito\n' +
            '• 🛒 Tienda - Acceder a la tienda\n' +
            '• 📊 Reportes - Generar reportes\n' +
            (user.role_id === 1 ? '• 🔑 Panel Admin - Administración\n' : '') +
            '• 🚪 Cerrar Sesión - Salir del sistema',
            { parse_mode: 'HTML' }
          );
          break;
      }

    } catch (error) {
      console.error('Error en messageHandler:', error);
      // Solo mostrar error si el usuario existe (está registrado)
      try {
        const user = await userApiService.getUser(chatId);
        if (user) {
          await bot.sendMessage(chatId,
            '❌ Error interno del servidor. Inténtalo nuevamente.',
            { parse_mode: 'Markdown' });
        }
      } catch (checkError) {
        // Si no se puede verificar el usuario, no mostrar error
        console.log('Usuario no registrado, ignorando error del messageHandler');
      }
    }
  });
};
