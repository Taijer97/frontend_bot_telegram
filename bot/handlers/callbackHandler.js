const path = require('path');
const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');
const userApiService = require('../services/userApiService');
const { renewSessionTimeout, userSessions, clearUserSession, trackBotMessage } = require('../utils/session');
const mainMenu = require('../menus/mainMenu');
const adminMenu = require('../menus/adminMenu');
const usersManagementMenu = require('../menus/usersMenu');
const { shopManagementMenu, tiendaWebApp } = require('../menus/shopMenu');
const reportsMenu = require('../menus/reportsMenu');
const { getChatStats, cleanOldMessages } = require('../utils/chatManager');
const consultasMenu = require('../menus/consultasMenu');
const { autorizacionesAdminMenu, confirmarGenerarAutorizacion, paginacionAutorizaciones } = require('../menus/autorizacionesMenu');

module.exports = function callbackHandler(bot) {
  bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const data = query.data;
    const action = data; // Asignar data a action para compatibilidad con el código existente

    console.log(`📞 Callback recibido: ${data} de usuario: ${chatId}`);

    // Trackear la interacción del usuario (el callback query en sí)
    // Nota: Los callback queries no tienen message_id propio, pero podemos trackear el mensaje original
    trackBotMessage(chatId, messageId, 'user_interaction');

    // Responder al callback query para evitar el loading
    await bot.answerCallbackQuery(query.id);

    try {
      // Obtener usuario actual
      const user = await userApiService.getUser(chatId);
      
      // Verificar si hay una alerta de sesión activa
      const session = userSessions.get(chatId) || {};
      if (session.warningActive && action !== 'session_continue' && action !== 'session_exit') {
        await bot.answerCallbackQuery(query.id, {
          text: '⚠️ Debes responder a la alerta de sesión primero. Solo puedes elegir "Sí, continuar" o "No, salir".',
          show_alert: true
        });
        return;
      }

      // Navegación principal
      if (action === 'main_menu') {
        await bot.editMessageText(
          'Menú Principal',
          {
            chat_id: chatId,
            message_id: query.message.message_id,
            ...mainMenu(user)
          }
        );
      }

      // Perfil de usuario
      else if (action === 'perfil') {
        if (user) {
          await bot.editMessageText(
            `👤 **Tu Perfil**\n\n` +
            `**Nombre:** ${user.nombre}\n` +
            `**DNI:** ${user.dni}\n` +
            `**Rol:** ${user.rol}\n`,
            {
              chat_id: chatId,
              message_id: query.message.message_id,
              parse_mode: 'Markdown',
              reply_markup: {
                inline_keyboard: [
                  [{ text: '🔙 Atrás', callback_data: 'back' }]
                ]
              }
            }
          );
        } else {
          await bot.editMessageText(
            '❌ No se pudo cargar tu perfil. Intenta de nuevo.',
            {
              chat_id: chatId,
              message_id: query.message.message_id,
              reply_markup: {
                inline_keyboard: [
                  [{ text: '🔙 Atrás', callback_data: 'back' }]
                ]
              }
            }
          );
        }
      }

      // Consulta - Mostrar menú de consultas (bloqueado para admins)
      else if (action === 'consulta') {
        // Verificar si el usuario es administrador
        if (user && (user.role_id === 1 || user.rol === 'admin')) {
          await bot.answerCallbackQuery(query.id, { 
            text: '❌ Los administradores no tienen acceso a consultas',
            show_alert: true 
          });
          return;
        }
        
        try {
          await bot.editMessageText(
            '📝 **Mis Consultas**\n\n' +
            'Selecciona una opción:',
            {
              chat_id: chatId,
              message_id: query.message.message_id,
              parse_mode: 'Markdown',
              ...consultasMenu()
            }
          );
        } catch (error) {
          console.error('Error mostrando menú de consultas:', error);
          await bot.sendMessage(chatId, 
            '📝 **Mis Consultas**\n\nSelecciona una opción:', 
            { parse_mode: 'Markdown', ...consultasMenu() }
          );
        }
      }

      // Consulta - Ver reporte (generar) - bloqueado para admins
      else if (action === 'consulta_reporte') {
        // Verificar si el usuario es administrador
        if (user && (user.role_id === 1 || user.rol === 'admin')) {
          await bot.answerCallbackQuery(query.id, { 
            text: '❌ Los administradores no tienen acceso a consultas',
            show_alert: true 
          });
          return;
        }
        
        let loadingMessageId;
        
        try {
          // Editar mensaje inicial con animación
          const loadingMessage = await bot.editMessageText('⏳ Generando reporte', {
            chat_id: chatId,
            message_id: query.message.message_id
          });
          loadingMessageId = loadingMessage.message_id;
          
          // Animación de carga
          const loadingFrames = ['⏳', '⌛', '⏳', '⌛'];
          let frameIndex = 0;
          
          const loadingInterval = setInterval(async () => {
            try {
              await bot.editMessageText(
                `${loadingFrames[frameIndex]} Generando reporte${'.'.repeat((frameIndex % 3) + 1)}`,
                {
                  chat_id: chatId,
                  message_id: loadingMessageId
                }
              );
              frameIndex = (frameIndex + 1) % loadingFrames.length;
            } catch (err) {
              // Ignorar errores de edición durante la animación
            }
          }, 1000);

          // Generar PDF desde API
          const reportsDir = path.join(__dirname, '../../reportes');
          fs.mkdirSync(reportsDir, { recursive: true });
          const pdfPath = path.join(reportsDir, `reporte_${user.dni}.pdf`);

          try {
            const shopUrl = `${process.env.BACKEND_BASE_URL}`;
            const res = await axios.post(
              `${shopUrl}/pdf/generate-and-download`,
              { dni: user.dni },
              { responseType: 'arraybuffer', timeout: 60000 }
            );
            
            // Detener animación
            clearInterval(loadingInterval);
            
            // Actualizar mensaje a "completado"
            await bot.editMessageText('✅ Reporte generado exitosamente', {
              chat_id: chatId,
              message_id: loadingMessageId
            });
            
            // Guardar y enviar PDF
            fs.writeFileSync(pdfPath, res.data);
            await bot.sendDocument(chatId, pdfPath, {
              caption: `📄 Reporte para DNI: ${user.dni}`
            }, {
              filename: `reporte_${user.dni}.pdf`,
              contentType: 'application/pdf'
            });
            
            // Enviar menú de consultas nuevamente
            setTimeout(async () => {
              try {
                await bot.deleteMessage(chatId, loadingMessageId);
                await bot.sendMessage(chatId, 
                  '📝 **Mis Consultas**\n\n¿Necesitas algo más?', 
                  { parse_mode: 'Markdown', ...consultasMenu() }
                );
              } catch (err) {
                // Ignorar si no se puede eliminar
              }
            }, 3000);
            
          } catch (err) {
            // Detener animación en caso de error
            clearInterval(loadingInterval);
            
            console.error('❌ Error generando reporte:', err.message);
            
            // Actualizar mensaje con error y botón para volver
            await bot.editMessageText(
              '❌ Error generando el reporte. Intenta nuevamente.',
              {
                chat_id: chatId,
                message_id: loadingMessageId,
                reply_markup: {
                  inline_keyboard: [
                    [{ text: '🔄 Reintentar', callback_data: 'consulta_reporte' }],
                    [{ text: '🔙 Volver', callback_data: 'consulta' }]
                  ]
                }
              }
            );
          }
          
        } catch (error) {
          console.log('⚠️ Error editando mensaje:', error.message);
          // Fallback: enviar nuevo mensaje si no se puede editar
          await bot.sendMessage(chatId, '⏳ Generando reporte...');
          
          // Continuar con la lógica normal...
          const reportsDir = path.join(__dirname, '../../reportes');
          fs.mkdirSync(reportsDir, { recursive: true });
          const pdfPath = path.join(reportsDir, `reporte_${user.dni}.pdf`);

          try {
            const shopUrl = `${process.env.BACKEND_BASE_URL}`;
            const res = await axios.post(
              `${shopUrl}/pdf/generate-and-download`,
              { dni: user.dni },
              { responseType: 'arraybuffer', timeout: 60000 }
            );
            fs.writeFileSync(pdfPath, res.data);
            await bot.sendDocument(chatId, pdfPath, {
              caption: '✅ Reporte generado con éxito'
            }, {
              filename: `reporte_${user.dni}.pdf`,
              contentType: 'application/pdf'
            });
            
            // Enviar menú de consultas
            await bot.sendMessage(chatId, 
              '📝 **Mis Consultas**\n\n¿Necesitas algo más?', 
              { parse_mode: 'Markdown', ...consultasMenu() }
            );
          } catch (err) {
            console.error('❌ Error generando reporte:', err.message);
            await bot.sendMessage(chatId, 
              '❌ Error generando el reporte.',
              {
                reply_markup: {
                  inline_keyboard: [
                    [{ text: '🔄 Reintentar', callback_data: 'consulta_reporte' }],
                    [{ text: '🔙 Volver', callback_data: 'consulta' }]
                  ]
                }
              }
            );
          }
        }
      }

      // Crear autorización - Proceso de captura de firma y huella
      else if (action === 'crear_autorizacion') {
        // Verificar si el usuario es administrador (los admins no tienen acceso a consultas)
        if (user && (user.role_id === 1 || user.rol === 'admin')) {
          await bot.answerCallbackQuery(query.id, { 
            text: '❌ Los administradores no tienen acceso a consultas',
            show_alert: true 
          });
          return;
        }

        try {
          await bot.editMessageText(
            '✍️ **Crear Autorización**\n\n' +
            '📋 Para crear una autorización necesitamos:\n' +
            '• 📝 Foto de tu firma\n' +
            '• 👆 Foto de tu huella dactilar\n\n' +
            '⚠️ **Importante:** Las fotos deben ser claras y legibles.\n\n' +
            'Presiona "Comenzar" para iniciar el proceso.',
            {
              chat_id: chatId,
              message_id: query.message.message_id,
              parse_mode: 'Markdown',
              reply_markup: {
                inline_keyboard: [
                  [{ text: '🚀 Comenzar proceso', callback_data: 'autorizacion_iniciar' }],
                  [{ text: '🔙 Volver a Consultas', callback_data: 'consulta' }]
                ]
              }
            }
          );
        } catch (error) {
          console.error('Error mostrando crear autorización:', error);
          await bot.sendMessage(chatId, 
            '✍️ **Crear Autorización**\n\nPresiona "Comenzar" para iniciar el proceso.', 
            { 
              parse_mode: 'Markdown',
              reply_markup: {
                inline_keyboard: [
                  [{ text: '🚀 Comenzar proceso', callback_data: 'autorizacion_iniciar' }],
                  [{ text: '🔙 Volver a Consultas', callback_data: 'consulta' }]
                ]
              }
            }
          );
        }
      }

      // Iniciar proceso de autorización - Solicitar firma
      else if (action === 'autorizacion_iniciar') {
        console.log(`[AUTORIZACION DEBUG] Handler autorizacion_iniciar ejecutado para chatId: ${chatId}`);
        console.log(`[AUTORIZACION DEBUG] Usuario:`, user);
        console.log(`[AUTORIZACION DEBUG] role_id:`, user?.role_id);
        console.log(`[AUTORIZACION DEBUG] rol:`, user?.rol);
        
        // Verificar si el usuario es administrador
        if (user && (user.role_id === 1 || user.rol === 'admin')) {
          console.log(`[AUTORIZACION DEBUG] Usuario es administrador, bloqueando acceso`);
          await bot.answerCallbackQuery(query.id, { 
            text: '❌ Los administradores no tienen acceso a consultas',
            show_alert: true 
          });
          return;
        }

        console.log(`[AUTORIZACION DEBUG] Usuario no es administrador, continuando...`);

        try {
          // Guardar el estado en la sesión del usuario
          if (!userSessions.has(chatId)) {
            userSessions.set(chatId, {});
          }
          const session = userSessions.get(chatId);
          session.autorizacionStep = 'esperando_firma';
          session.autorizacionData = {};
          
          console.log(`[AUTORIZACION DEBUG] Configurando sesión para chatId: ${chatId}`);
          console.log(`[AUTORIZACION DEBUG] autorizacionStep establecido:`, session.autorizacionStep);
          console.log(`[AUTORIZACION DEBUG] Sesión completa:`, session);

          await bot.editMessageText(
            '📝 **Paso 1 de 2: Firma**\n\n' +
            '✍️ Por favor, envía una foto clara de tu firma.\n\n' +
            '📋 **Instrucciones:**\n' +
            '• Firma en una hoja blanca\n' +
            '• Asegúrate de que la foto sea clara\n' +
            '• La firma debe ser legible\n' +
            '• Evita sombras o reflejos\n\n' +
            '📷 **Envía la foto ahora:**',
            {
              chat_id: chatId,
              message_id: query.message.message_id,
              parse_mode: 'Markdown',
              reply_markup: {
                inline_keyboard: [
                  [{ text: '❌ Cancelar proceso', callback_data: 'autorizacion_cancelar' }]
                ]
              }
            }
          );
        } catch (error) {
          console.error('Error iniciando proceso de autorización:', error);
          await bot.sendMessage(chatId, 
            '❌ Error al iniciar el proceso. Intenta nuevamente.',
            {
              reply_markup: {
                inline_keyboard: [
                  [{ text: '🔙 Volver a Consultas', callback_data: 'consulta' }]
                ]
              }
            }
          );
        }
      }

      // Cancelar proceso de autorización
      else if (action === 'autorizacion_cancelar') {
        try {
          // Limpiar el estado de la sesión
          if (userSessions.has(chatId)) {
            const session = userSessions.get(chatId);
            delete session.autorizacionStep;
            delete session.autorizacionData;
          }

          await bot.editMessageText(
            '❌ **Proceso cancelado**\n\n' +
            'El proceso de creación de autorización ha sido cancelado.\n' +
            'Puedes iniciarlo nuevamente cuando desees.',
            {
              chat_id: chatId,
              message_id: query.message.message_id,
              parse_mode: 'Markdown',
              reply_markup: {
                inline_keyboard: [
                  [{ text: '🔙 Volver a Consultas', callback_data: 'consulta' }]
                ]
              }
            }
          );
        } catch (error) {
          console.error('Error cancelando proceso:', error);
        }
      }

      // Confirmar envío de autorización al backend
      else if (action === 'autorizacion_enviar') {
        try {
          const session = userSessions.get(chatId);
          
          if (!session || !session.autorizacionData || !session.autorizacionData.firma || !session.autorizacionData.huella) {
            await bot.answerCallbackQuery(query.id, { 
              text: '❌ Faltan datos. Reinicia el proceso.',
              show_alert: true 
            });
            return;
          }

          // Mostrar mensaje de envío
          await bot.editMessageText(
            '📤 **Enviando autorización...**\n\n' +
            '⏳ Por favor espera mientras procesamos tu autorización.',
            {
              chat_id: chatId,
              message_id: query.message.message_id,
              parse_mode: 'Markdown'
            }
          );

          // Preparar datos para enviar al backend
          const formData = new FormData();
          formData.append('user_id', user.id);
          formData.append('telegram_id', chatId);
          formData.append('nombre', user.nombre);
          formData.append('dni', user.dni);
          
          // Agregar las fotos
          formData.append('firma', session.autorizacionData.firma.buffer, {
            filename: `firma_${user.dni}.jpg`,
            contentType: 'image/jpeg'
          });
          formData.append('huella', session.autorizacionData.huella.buffer, {
            filename: `huella_${user.dni}.jpg`,
            contentType: 'image/jpeg'
          });

          // Enviar al backend
          const backendUrl = process.env.BACKEND_BASE_URL || 'http://localhost:3000';
          const response = await axios.post(`${backendUrl}/autorizaciones/recibir`, formData, {
            headers: {
              'Content-Type': 'multipart/form-data',
              ...formData.getHeaders()
            },
            timeout: parseInt(process.env.BACKEND_TIMEOUT) || 10000
          });

          // Limpiar datos de la sesión
          delete session.autorizacionStep;
          delete session.autorizacionData;

          await bot.editMessageText(
            '✅ **Autorización creada exitosamente**\n\n' +
            '📋 Tu autorización ha sido enviada y procesada correctamente.\n\n' +
            `📄 **ID de autorización:** ${response.data.id || 'N/A'}\n` +
            `📅 **Fecha:** ${new Date().toLocaleDateString('es-ES')}\n` +
            `⏰ **Hora:** ${new Date().toLocaleTimeString('es-ES')}\n\n` +
            '✨ Podrás consultar el estado de tu autorización en el futuro.',
            {
              chat_id: chatId,
              message_id: query.message.message_id,
              parse_mode: 'Markdown',
              reply_markup: {
                inline_keyboard: [
                  [{ text: '🔙 Volver a Consultas', callback_data: 'consulta' }],
                  [{ text: '🏠 Menú Principal', callback_data: 'main_menu' }]
                ]
              }
            }
          );

        } catch (error) {
          console.error('Error enviando autorización al backend:', error);
          
          let errorMessage = '❌ **Error al enviar autorización**\n\n';
          
          if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
            errorMessage += '⏱️ El envío está tardando más de lo esperado.\n';
            errorMessage += 'El servidor puede estar sobrecargado.';
          } else if (error.message.includes('ENOTFOUND') || error.message.includes('ECONNREFUSED')) {
            errorMessage += '🔌 No se puede conectar con el servidor.\n';
            errorMessage += 'Verifica que el servicio esté disponible.';
          } else if (error.response && error.response.status) {
            errorMessage += `🔧 Error del servidor: ${error.response.status}\n`;
            if (error.response.data && error.response.data.message) {
              errorMessage += `📝 ${error.response.data.message}`;
            }
          } else {
            errorMessage += '🔧 Error técnico del sistema.\n';
            errorMessage += 'Inténtalo nuevamente en unos momentos.';
          }

          await bot.editMessageText(errorMessage, {
            chat_id: chatId,
            message_id: query.message.message_id,
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [{ text: '🔄 Reintentar envío', callback_data: 'autorizacion_enviar' }],
                [{ text: '🔙 Volver a Consultas', callback_data: 'consulta' }]
              ]
            }
          });
        }
      }

      // Consulta - Ver crédito accesible - bloqueado para admins
      else if (action === 'consulta_credito') {
        // Verificar si el usuario es administrador
        if (user && (user.role_id === 1 || user.rol === 'admin')) {
          await bot.answerCallbackQuery(query.id, { 
            text: '❌ Los administradores no tienen acceso a consultas',
            show_alert: true 
          });
          return;
        }
        
        let loadingMessageId;
        
        try {
          // Mostrar mensaje de carga inicial
          const loadingMessage = await bot.editMessageText('⏳ Evaluando crédito', {
            chat_id: chatId,
            message_id: query.message.message_id
          });
          loadingMessageId = loadingMessage.message_id;
          
          // Animación de carga dinámica
          const loadingFrames = ['💳', '💰', '📊', '🔍'];
          const loadingTexts = [
            'Consultando historial crediticio',
            'Analizando capacidad de pago',
            'Evaluando reglas de negocio',
            'Calculando monto disponible'
          ];
          let frameIndex = 0;
          
          const loadingInterval = setInterval(async () => {
            try {
              await bot.editMessageText(
                `${loadingFrames[frameIndex]} ${loadingTexts[frameIndex]}${'.'.repeat((frameIndex % 3) + 1)}`,
                {
                  chat_id: chatId,
                  message_id: loadingMessageId
                }
              );
              frameIndex = (frameIndex + 1) % loadingFrames.length;
            } catch (err) {
              // Ignorar errores de edición durante la animación
            }
          }, 1500);

          try {
            // Consultar crédito usando la API real
            const shopUrl = `${process.env.BACKEND_BASE_URL}`;
            const response = await axios.post(
              `${shopUrl}/evaluar_credito/evaluar_credito`,
              { dni: user.dni },
              { 
                timeout: 30000,
                headers: {
                  'Content-Type': 'application/json'
                }
              }
            );
            
            // Detener animación
            clearInterval(loadingInterval);
            
            const creditoData = response.data;
            
            // Función para escapar caracteres HTML
            const escapeHtml = (text) => {
              if (typeof text !== 'string') return String(text);
              return text
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');
            };
            
            // Función para formatear números
            const formatNumber = (num) => {
              if (typeof num === 'number') {
                return num.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
              }
              return String(num);
            };
            
            let mensaje = '💳 <b>Evaluación de Crédito</b>\n\n';
            mensaje += `👤 <b>DNI:</b> ${escapeHtml(creditoData.dni)}\n\n`;
            
            if (creditoData.encontrado) {
              // Información financiera
              mensaje += `💰 <b>Monto Total:</b> S/${formatNumber(creditoData.monto_total)}\n`;
              mensaje += `💳 <b>Cuota Mensual:</b> S/${formatNumber(creditoData.cuota)}\n`;
              mensaje += `💸 <b>Por Pagar:</b> S/${formatNumber(creditoData.por_pagar)}\n\n`;
              
              // Evaluación de reglas
              mensaje += `📋 <b>Evaluación de Reglas:</b>\n`;              mensaje += `• Deuda menor al 50%: ${creditoData.regla_A ? '✅' : '❌'}\n`;              mensaje += `• Salieron descuentos seguidos: ${creditoData.regla_B ? '✅' : '❌'}\n`;              mensaje += `• Salieron descuentos completos: ${creditoData.regla_C ? '✅' : '❌'}\n\n`;              
              // Historial de últimos 3 pagos
              if (creditoData.historial && creditoData.historial.length > 0) {
                mensaje += `📊 <b>Historial de Pagos:</b>\n`;
                creditoData.historial.forEach((pago, index) => {
                  const estadoPago = pago.estado === 'PAGADO' ? '✅' : '❌';
                  mensaje += `• Cuota ${pago.numero_cuota}: ${estadoPago} ${pago.fecha}\n`;
                });
                mensaje += '\n';
              }
              
              
              // Decisión final
              const decisionEmoji = creditoData.decision_final === 'APROBADO' ? '✅' : 
                                   creditoData.decision_final === 'NEGADO' ? '❌' : '⚠️';
              mensaje += `🎯 <b>Su Credito esta:</b> ${decisionEmoji} ${escapeHtml(creditoData.decision_final)}\n\n`;
              
              // Mensaje adicional según la decisión
              if (creditoData.decision_final === 'APROBADO') {
                mensaje += `🎉 ¡Felicidades! Tienes crédito disponible.\n`;
                mensaje += `🛒 Puedes realizar compras en nuestra tienda.`;
              } else if (creditoData.decision_final === 'NEGADO') {
                mensaje += `😔 Lo sentimos, no tienes crédito disponible en este momento.\n\n`;
                mensaje += `📞 Contacta a un agente para más información.`;
              }
              
            } else {
              mensaje += `❌ <b>No encontrado</b>\n\n`;
              mensaje += `No se encontró información crediticia para el DNI ${escapeHtml(creditoData.dni)}.\n`;
              mensaje += `📞 Contacta a un agente para más información.`;
            }

            // Botones según la decisión
            let keyboard = [];
            
            if (creditoData.encontrado && creditoData.decision_final === 'APROBADO') {
              keyboard = [
                [{ text: '🛒 Ir a Tienda', callback_data: 'tienda' }],
                [{ text: '📊 Ver mi reporte', callback_data: 'consulta_reporte' }],
                [{ text: '🔙 Volver', callback_data: 'consulta' }]
              ];
            } else {
              keyboard = [
                [{ text: '📞 Contactar Agente', url: 'https://wa.me/1234567890' }],
                [{ text: '📊 Ver mi reporte', callback_data: 'consulta_reporte' }],
                [{ text: '🔙 Volver', callback_data: 'consulta' }]
              ];
            }

            await bot.editMessageText(mensaje, {
              chat_id: chatId,
              message_id: loadingMessageId,
              parse_mode: 'HTML',
              reply_markup: {
                inline_keyboard: keyboard
              }
            });
            
          } catch (apiError) {
            // Detener animación en caso de error
            clearInterval(loadingInterval);
            
            console.error('❌ Error consultando crédito:', apiError.message);
            
            let errorMessage = '❌ <b>Error consultando el crédito</b>\n\n';
            
            if (apiError.code === 'ECONNABORTED' || apiError.message.includes('timeout')) {
              errorMessage += '⏱️ La consulta está tardando más de lo esperado.\n';
              errorMessage += 'El servidor puede estar sobrecargado.';
            } else if (apiError.message.includes('ENOTFOUND') || apiError.message.includes('ECONNREFUSED')) {
              errorMessage += '🔌 No se puede conectar con el servidor de créditos.\n';
              errorMessage += 'Verifica que el servicio esté disponible.';
            } else if (apiError.response && apiError.response.status) {
              errorMessage += `🔧 Error del servidor: ${apiError.response.status}\n`;
              errorMessage += 'Contacta al administrador si el problema persiste.';
            } else {
              errorMessage += '🔧 Error técnico del sistema.\n';
              errorMessage += 'Inténtalo nuevamente en unos momentos.';
            }
            
            await bot.editMessageText(errorMessage, {
              chat_id: chatId,
              message_id: loadingMessageId,
              parse_mode: 'HTML',
              reply_markup: {
                inline_keyboard: [
                  [{ text: '🔄 Reintentar', callback_data: 'consulta_credito' }],
                  [{ text: '🔙 Volver', callback_data: 'consulta' }],
                  [{ text: '🏠 Menú Principal', callback_data: 'main_menu' }]
                ]
              }
            });
          }
          
        } catch (error) {
          console.error('Error en consulta_credito:', error);
          
          // Si hay un error, intentar sin Markdown
          try {
            await bot.sendMessage(chatId, 
              '❌ Error consultando el crédito. Intenta nuevamente.',
              {
                reply_markup: {
                  inline_keyboard: [
                    [{ text: '🔄 Reintentar', callback_data: 'consulta_credito' }],
                    [{ text: '🔙 Volver', callback_data: 'consulta' }]
                  ]
                }
              }
            );
          } catch (fallbackError) {
            console.error('Error en fallback:', fallbackError);
          }
        }
      }

      // Tienda
      else if (action === 'tienda') {
        await bot.editMessageText(
          '🛒 **Tienda**\n\nBienvenido a nuestra tienda online.',
          {
            chat_id: chatId,
            message_id: query.message.message_id,
            parse_mode: 'Markdown',
            ...tiendaWebApp()
          }
        );
      }

      // Panel de administración
      else if (action === 'admin') {
        if (user && user.role_id === 1) {
          await bot.editMessageText(
            '🔐 **Panel de Administración**\n\nSelecciona una opción:',
            {
              chat_id: chatId,
              message_id: query.message.message_id,
              parse_mode: 'Markdown',
              ...adminMenu()
            }
          );
        } else {
          await bot.answerCallbackQuery(query.id, { 
            text: '❌ No tienes permisos de administrador',
            show_alert: true 
          });
        }
      }

      // Panel de administración principal
      else if (action === 'admin_menu') {
        if (user && user.role_id === 1) {
          await bot.editMessageText(
            '🔐 **Panel de Administración**\n\nSelecciona una opción:',
            {
              chat_id: chatId,
              message_id: query.message.message_id,
              parse_mode: 'Markdown',
              ...adminMenu()
            }
          );
        } else {
          await bot.answerCallbackQuery(query.id, {
            text: '❌ No tienes permisos de administrador',
            show_alert: true 
          });
        }
      }

      // Gestión de usuarios
      else if (action === 'admin_users') {
        if (user && user.role_id === 1) {
          await bot.editMessageText(
            '👥 **Gestión de Usuarios**\n\nSelecciona una opción:',
            {
              chat_id: chatId,
              message_id: query.message.message_id,
              parse_mode: 'Markdown',
              ...usersManagementMenu(chatId)
            }
          );
        } else {
          await bot.answerCallbackQuery(query.id, {
            text: '❌ No tienes permisos de administrador',
            show_alert: true 
          });
        }
      }

      // Lista de usuarios
      else if (action === 'users_list') {
        if (user && user.role_id === 1) {
          try {
            const usersResponse = await userApiService.listUsers({ page: 1 });
            
            // Usar la estructura correcta del backend
            const users = usersResponse.usuarios || [];
            const totalUsuarios = usersResponse.total_usuarios || 0;
            const userButtons = [];
            
            if (Array.isArray(users) && users.length > 0) {
              users.forEach(u => {
                const rolEmoji = u.role_id === 1 ? '👑' : '👤';
                userButtons.push([{ 
                  text: `${rolEmoji} ${u.nombre || 'Sin nombre'}`, 
                  callback_data: `user_detail_${u.id}` 
                }]);
              });
            } else {
              userButtons.push([{ text: '📝 No hay usuarios registrados', callback_data: 'admin_users' }]);
            }
            
            userButtons.push([{ text: '🔙 Volver a Gestión', callback_data: 'admin_users' }]);
            
            await bot.editMessageText(
              `👥 **Lista de Usuarios** (${totalUsuarios} total)\n\nSelecciona un usuario para ver su reporte detallado:`,
              {
                chat_id: chatId,
                message_id: query.message.message_id,
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: userButtons }
              }
            );
          } catch (error) {
            console.error('Error al obtener lista de usuarios:', error);
            await bot.editMessageText(
              '❌ **Error**\n\nNo se pudo obtener la lista de usuarios. Verifica la conexión con el backend.',
              {
                chat_id: chatId,
                message_id: query.message.message_id,
                parse_mode: 'Markdown',
                reply_markup: {
                  inline_keyboard: [[{ text: '🔙 Volver', callback_data: 'admin_users' }]]
                }
              }
            );
          }
        } else {
          await bot.answerCallbackQuery(query.id, {
            text: '❌ No tienes permisos de administrador',
            show_alert: true 
          });
        }
      }

      // Navegación home (actualizado para el menú persistente)
      else if (action === 'nav_home') {
        await bot.answerCallbackQuery(query.id, {
          text: 'Usa el menú persistente de abajo para navegar',
          show_alert: false
        });
      }

      // Gestión de tienda
      else if (action === 'admin_shop') {
        if (user && user.role_id === 1) {
          await bot.editMessageText(
            '🛒 **Gestión de Tienda**\n\nSelecciona una opción:',
            {
              chat_id: chatId,
              message_id: query.message.message_id,
              parse_mode: 'Markdown',
              ...shopManagementMenu(chatId)
            }
          );
        } else {
          await bot.answerCallbackQuery(query.id, {
            text: '❌ No tienes permisos de administrador',
            show_alert: true 
          });
        }
      }

      // Opciones de tienda
      else if (action === 'shop_list') {
        if (user && user.role_id === 1) {
          await bot.editMessageText(
            '📦 **Lista de Productos**\n\nAquí se mostrarían los productos disponibles en la tienda.',
            {
              chat_id: chatId,
              message_id: query.message.message_id,
              parse_mode: 'Markdown',
              reply_markup: {
                inline_keyboard: [
                  [{ text: '🔙 Volver', callback_data: 'admin_shop' }]
                ]
              }
            });
        }
      }

      else if (action === 'shop_add') {
        if (user && user.role_id === 1) {
          await bot.editMessageText(
            '➕ **Agregar Producto**\n\nFuncionalidad en desarrollo.',
            {
              chat_id: chatId,
              message_id: query.message.message_id,
              parse_mode: 'Markdown',
              reply_markup: {
                inline_keyboard: [
                  [{ text: '🔙 Volver', callback_data: 'admin_shop' }]
                ]
              }
            });
        }
      }

      else if (action === 'shop_edit') {
        if (user && user.role_id === 1) {
          await bot.editMessageText(
            '✏️ **Editar Producto**\n\nFuncionalidad en desarrollo.',
            {
              chat_id: chatId,
              message_id: query.message.message_id,
              parse_mode: 'Markdown',
              reply_markup: {
                inline_keyboard: [
                  [{ text: '🔙 Volver', callback_data: 'admin_shop' }]
                ]
              }
            });
        }
      }

      else if (action === 'shop_delete') {
        if (user && user.role_id === 1) {
          await bot.editMessageText(
            '🗑️ **Eliminar Producto**\n\nFuncionalidad en desarrollo.',
            {
              chat_id: chatId,
              message_id: query.message.message_id,
              parse_mode: 'Markdown',
              reply_markup: {
                inline_keyboard: [
                  [{ text: '🔙 Volver', callback_data: 'admin_shop' }]
                ]
              }
            });
        }
      }

      // Manejar solicitudes de crédito
      else if (action === 'shop_solicitudes') {
        try {
          const shopUrl = process.env.BACKEND_BASE_URL;
          const response = await axios.get(`${shopUrl}/shop/solicitudes-detalle/${chatId}`, {
            headers: {
              'Authorization': `Bearer ${process.env.BACKEND_API_KEY}`,
              'X-API-Key': process.env.BACKEND_API_KEY,
              'ngrok-skip-browser-warning': 'true',
              'User-Agent': 'TelegramBot/1.0'
            }
          });

          const data = response.data;
          
          if (data.success && data.solicitudes && data.solicitudes.length > 0) {
            let mensaje = '📋 MIS SOLICITUDES DE CRÉDITO\n\n';
            
            // Mostrar estadísticas
            const stats = data.estadisticas;
            mensaje += `📊 RESUMEN:\n`;
            mensaje += `• Total solicitudes: ${stats.total_solicitudes}\n`;
            mensaje += `• Pendientes: ${stats.solicitudes_pendientes}\n`;
            mensaje += `• Aprobadas: ${stats.solicitudes_aprobadas}\n`;
            mensaje += `• Rechazadas: ${stats.solicitudes_rechazadas}\n`;
            mensaje += `• Monto total: S/${stats.monto_total_solicitado.toLocaleString()}\n\n`;
            mensaje += `Selecciona una solicitud para ver los detalles:`;

            // Crear botones para cada solicitud
            const solicitudButtons = [];
            data.solicitudes.forEach(solicitud => {
              const estadoEmoji = solicitud.estado === 'PENDIENTE' ? '⏳' : 
                                 solicitud.estado === 'APROBADA' ? '✅' : 
                                 solicitud.estado === 'RECHAZADA' ? '❌' : '📋';
              
              const buttonText = `Solicitud ${solicitud.id.split('_')[1]} ${estadoEmoji} ${solicitud.estado}`;
              solicitudButtons.push([{ 
                text: buttonText, 
                callback_data: `shop_solicitud_detail_${solicitud.id}` 
              }]);
            });

            // Añadir botones de navegación
            solicitudButtons.push([{ text: '🔄 Actualizar', callback_data: 'shop_solicitudes' }]);
            solicitudButtons.push([{ text: '🔙 Volver a Tienda', callback_data: 'tienda' }]);

            await bot.editMessageText(mensaje, {
              chat_id: chatId,
              message_id: query.message.message_id,
              reply_markup: {
                inline_keyboard: solicitudButtons
              }
            });

          } else {
            await bot.editMessageText(
              '📋 MIS SOLICITUDES DE CRÉDITO\n\n' +
              'No hay solicitudes pendientes\n\n' +
              'Visite nuestra tienda para ver nuevas novedades',
              {
                chat_id: chatId,
                message_id: query.message.message_id,
                reply_markup: {
                  inline_keyboard: [
                    [{ text: '🛒 Ir a Tienda', web_app: { url: `${shopUrl}/shop/html` } }],
                    [{ text: '🔙 Volver', callback_data: 'tienda' }]
                  ]
                }
              });
          }

        } catch (error) {
          console.error('Error al obtener solicitudes:', error);
          await bot.editMessageText(
            '❌ ERROR AL CARGAR SOLICITUDES\n\n' +
            'No se pudieron obtener las solicitudes de crédito.\n' +
            'Inténtalo nuevamente más tarde.',
            {
              chat_id: chatId,
              message_id: query.message.message_id,
              reply_markup: {
                inline_keyboard: [
                  [{ text: '🔄 Reintentar', callback_data: 'shop_solicitudes' }],
                  [{ text: '🔙 Volver', callback_data: 'tienda' }]
                ]
              }
            });
        }
      }

      // Manejar detalles de solicitud específica
      else if (action.startsWith('shop_solicitud_detail_')) {
        try {
          const solicitudId = action.replace('shop_solicitud_detail_', '');
          const shopUrl = process.env.BACKEND_BASE_URL;
          
          // Obtener todas las solicitudes para encontrar la específica
          const response = await axios.get(`${shopUrl}/shop/solicitudes-detalle/${chatId}`, {
            headers: {
              'Authorization': `Bearer ${process.env.BACKEND_API_KEY}`,
              'X-API-Key': process.env.BACKEND_API_KEY,
              'ngrok-skip-browser-warning': 'true',
              'User-Agent': 'TelegramBot/1.0'
            }
          });

          const data = response.data;
          
          const solicitud = data.solicitudes.find(s => s.id === solicitudId);

          if (solicitud) {
            
            let mensaje = '';
            let keyboard = [];

            // Manejar según el estado de la solicitud
            if (solicitud.estado === 'PENDIENTE') {
              mensaje = `⏳ SOLICITUD ${solicitud.id.split('_')[1]}\n\n`;
              mensaje += `Su solicitud aun esta siendo revisada`;
              
              keyboard = [
                [{ text: '📋 Ver Todas las Solicitudes', callback_data: 'shop_solicitudes' }],
                [{ text: '🔙 Volver a Tienda', callback_data: 'tienda' }]
              ];

            } else if (solicitud.estado === 'RECHAZADA') {
              mensaje = `❌ SOLICITUD ${solicitud.id.split('_')[1]}\n\n`;
              mensaje += `Lo sentimos por ahora no es posible realizar una ampliacion con su peticion o contactese a un agente de ventas`;
              
              keyboard = [
                [{ text: '📞 Contactar Agente', url: 'https://wa.me/1234567890' }], // Cambiar por el número real
                [{ text: '📋 Ver Todas las Solicitudes', callback_data: 'shop_solicitudes' }],
                [{ text: '🔙 Volver a Tienda', callback_data: 'tienda' }]
              ];

            } else if (solicitud.estado === 'APROBADA') {
              // Solo si está aprobada, mostrar todos los detalles
              const fecha = new Date(solicitud.fecha_solicitud).toLocaleDateString('es-ES');
              
              mensaje = `✅ SOLICITUD ${solicitud.id.split('_')[1]}\n\n`;
              mensaje += `Estado: ${solicitud.estado}\n`;
              mensaje += `📅 Fecha: ${fecha}\n`;
              mensaje += `📦 Productos: ${solicitud.total_productos}\n`;
              mensaje += `📅 Financiamiento: ${solicitud.meses_financiamiento} meses\n`;
              mensaje += `💳 Cuota mensual: S/${solicitud.cuota_mensual.toLocaleString()}\n`;
              mensaje += `💰 Total: S/${solicitud.precio_total.toLocaleString()}\n`;
              mensaje += `📈 Tasa: ${solicitud.tasa_mensual}\n\n`;
              
              mensaje += `PRODUCTOS:\n`;
              if (solicitud.productos && solicitud.productos.length > 0) {
                solicitud.productos.forEach(producto => {
                  mensaje += `• ${producto.nombre} x${producto.cantidad} - S/${producto.subtotal.toLocaleString()}\n`;
                });
              }

              keyboard = [
                [{ text: '📋 Ver Todas las Solicitudes', callback_data: 'shop_solicitudes' }],
                [{ text: '🔙 Volver a Tienda', callback_data: 'tienda' }]
              ];
            } else {
              // Caso por defecto para estados no reconocidos
              mensaje = `📋 SOLICITUD ${solicitud.id.split('_')[1]}\n\n`;
              mensaje += `Estado: ${solicitud.estado}\n\n`;
              mensaje += `Estado no reconocido. Contacte al administrador.`;
              
              keyboard = [
                [{ text: '📋 Ver Todas las Solicitudes', callback_data: 'shop_solicitudes' }],
                [{ text: '🔙 Volver a Tienda', callback_data: 'tienda' }]
              ];
            }

            // Verificar que el mensaje no esté vacío antes de enviarlo
            if (!mensaje || mensaje.trim() === '') {
              mensaje = `📋 SOLICITUD ${solicitud.id.split('_')[1]}\n\nError: No se pudo cargar la información de la solicitud.`;
              keyboard = [
                [{ text: '📋 Ver Todas las Solicitudes', callback_data: 'shop_solicitudes' }],
                [{ text: '🔙 Volver a Tienda', callback_data: 'tienda' }]
              ];
            }

            await bot.editMessageText(mensaje, {
              chat_id: chatId,
              message_id: query.message.message_id,
              reply_markup: {
                inline_keyboard: keyboard
              }
            });

          } else {
            await bot.editMessageText(
              '❌ ERROR\n\n' +
              'No se encontró la solicitud especificada.',
              {
                chat_id: chatId,
                message_id: query.message.message_id,
                reply_markup: {
                  inline_keyboard: [
                    [{ text: '📋 Ver Solicitudes', callback_data: 'shop_solicitudes' }],
                    [{ text: '🔙 Volver', callback_data: 'tienda' }]
                  ]
                }
              });
          }

        } catch (error) {
          console.error('Error al obtener detalles de solicitud:', error);
          await bot.editMessageText(
            '❌ ERROR AL CARGAR DETALLES\n\n' +
            'No se pudieron obtener los detalles de la solicitud.',
            {
              chat_id: chatId,
              message_id: query.message.message_id,
              reply_markup: {
                inline_keyboard: [
                  [{ text: '📋 Ver Solicitudes', callback_data: 'shop_solicitudes' }],
                  [{ text: '🔙 Volver', callback_data: 'tienda' }]
                ]
              }
            });
        }
      }

      // Reportes
      else if (action === 'admin_reports') {
        if (user && user.role_id === 1) {
          await bot.editMessageText(
            '📊 **Reportes**\n\nSelecciona un tipo de reporte:',
            {
              chat_id: chatId,
              message_id: query.message.message_id,
              parse_mode: 'Markdown',
              ...reportsMenu(chatId)
            }
          );
        }
      }

      else if (action === 'report_users') {
        try {
          const stats = await userApiService.getStats();
          const statsText = stats.total_users ? 
            `📊 **Estadísticas de Usuarios**\n\n` +
            `👥 **Total de usuarios:** ${stats.total_users}\n` +
            `👑 **Administradores:** ${stats.admin_users || 0}\n` +
            `👤 **Usuarios regulares:** ${stats.regular_users || 0}\n` +
            `❌ **Usuarios inactivos:** ${stats.inactive_users || 0}` :
            '📊 **Reporte de Usuarios**\n\nNo se pudieron obtener las estadísticas.';

          await bot.editMessageText(
            statsText,
            {
              chat_id: chatId,
              message_id: query.message.message_id,
              parse_mode: 'Markdown',
              reply_markup: {
                inline_keyboard: [
                  [{ text: '🔙 Volver', callback_data: 'admin_reports' }]
                ]
              }
            }
          );
        } catch (error) {
          await bot.editMessageText(
            '📊 **Reporte de Usuarios**\n\nError al obtener estadísticas.',
            {
              chat_id: chatId,
              message_id: query.message.message_id,
              parse_mode: 'Markdown',
              reply_markup: {
                inline_keyboard: [
                  [{ text: '🔙 Volver', callback_data: 'admin_reports' }]
                ]
              }
            }
          );
        }
      }

      else if (action === 'report_sales') {
        await bot.editMessageText(
          '💰 **Reporte de Ventas**\n\nFuncionalidad en desarrollo.',
          {
            chat_id: chatId,
            message_id: query.message.message_id,
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [{ text: '🔙 Volver', callback_data: 'admin_reports' }]
              ]
            }
          });
      }

      else if (action === 'report_activity') {
        await bot.editMessageText(
          '📈 **Reporte de Actividad**\n\nFuncionalidad en desarrollo.',
          {
            chat_id: chatId,
            message_id: query.message.message_id,
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [{ text: '🔙 Volver', callback_data: 'admin_reports' }]
              ]
            }
          });
      }
      
      // Manejar estadísticas de chat
      else if (action === 'admin_chat_stats') {
        const stats = getChatStats();
        
        let statsMessage = '📊 **Estadísticas de Chat**\n\n';
        statsMessage += `👥 **Total de usuarios:** ${stats.totalUsers}\n`;
        statsMessage += `💬 **Total de mensajes:** ${stats.totalMessages}\n\n`;
        
        if (stats.totalUsers > 0) {
          statsMessage += '**Top 5 usuarios más activos:**\n';
          const sortedUsers = Object.entries(stats.userStats)
            .sort(([,a], [,b]) => b.messageCount - a.messageCount)
            .slice(0, 5);
          
          for (let i = 0; i < sortedUsers.length; i++) {
            const [userId, userData] = sortedUsers[i];
            const lastActivity = new Date(userData.lastActivity).toLocaleDateString('es-ES');
            statsMessage += `${i + 1}. Usuario ${userId}: ${userData.messageCount} mensajes (${lastActivity})\n`;
          }
        } else {
          statsMessage += 'No hay datos de usuarios disponibles.';
        }
        
        await bot.editMessageText(statsMessage, {
          chat_id: chatId,
          message_id: query.message.message_id,
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔄 Actualizar', callback_data: 'admin_chat_stats' }],
              [{ text: '🔙 Volver', callback_data: 'admin_menu' }]
            ]
          }
        });
      }

      // Manejar limpieza de chats antiguos
      else if (action === 'admin_clean_chats') {
        const cleaned = cleanOldMessages(7); // Limpiar mensajes de más de 7 días
        
        let cleanMessage = '🧹 **Limpieza de Chats Antiguos**\n\n';
        if (cleaned > 0) {
          cleanMessage += `✅ Se limpiaron ${cleaned} usuarios con actividad antigua (más de 7 días).\n\n`;
          cleanMessage += 'Los mensajes de estos usuarios han sido eliminados del registro.';
        } else {
          cleanMessage += '✨ No hay chats antiguos para limpiar.\n\n';
          cleanMessage += 'Todos los usuarios tienen actividad reciente.';
        }
        
        await bot.editMessageText(cleanMessage, {
          chat_id: chatId,
          message_id: query.message.message_id,
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔄 Limpiar de nuevo', callback_data: 'admin_clean_chats' }],
              [{ text: '📊 Ver estadísticas', callback_data: 'admin_chat_stats' }],
              [{ text: '🔙 Volver', callback_data: 'admin_menu' }]
            ]
          }
        });
      }

      // Gestión de autorizaciones
      else if (action === 'admin_autorizaciones') {
        if (user && user.role_id === 1) {
          await bot.editMessageText(
            '📝 **Gestión de Autorizaciones**\n\nSelecciona una opción:',
            {
              chat_id: chatId,
              message_id: query.message.message_id,
              parse_mode: 'Markdown',
              ...autorizacionesAdminMenu()
            }
          );
        } else {
          await bot.answerCallbackQuery(query.id, {
            text: '❌ No tienes permisos de administrador',
            show_alert: true 
          });
        }
      }

      // Generar autorización
      else if (action === 'admin_generar_autorizacion') {
        if (user && user.role_id === 1) {
          // Inicializar sesión para solicitar DNI
          const session = userSessions.get(chatId) || {};
          session.adminAction = 'generar_autorizacion';
          session.lastActivity = Date.now();
          userSessions.set(chatId, session);

          await bot.editMessageText(
            '📝 **Generar Autorización**\n\n' +
            'Por favor, envía el DNI del usuario para el cual deseas generar una autorización.\n\n' +
            '📋 Formato: Solo números (ej: 12345678)',
            {
              chat_id: chatId,
              message_id: query.message.message_id,
              parse_mode: 'Markdown',
              reply_markup: {
                inline_keyboard: [
                  [{ text: '❌ Cancelar', callback_data: 'admin_autorizaciones' }]
                ]
              }
            }
          );
        } else {
          await bot.answerCallbackQuery(query.id, {
            text: '❌ No tienes permisos de administrador',
            show_alert: true 
          });
        }
      }

      // Confirmar generación de autorización
      else if (action.startsWith('admin_confirmar_generar_')) {
        if (user && user.role_id === 1) {
          const dni = action.replace('admin_confirmar_generar_', '');
          const buttons = [];
          
          // Iniciar animación de carga
          const loadingFrames = ['⏳', '⌛', '⏳', '⌛'];
          let frameIndex = 0;
          
          // Mensaje inicial de carga
          await bot.editMessageText(
            `${loadingFrames[0]} <b>Generando Autorización</b>\n\n` +
            `📋 DNI: ${dni}\n` +
            `🔄 Procesando solicitud...\n\n` +
            `<i>Por favor espera, esto puede tomar unos momentos.</i>`,
            {
              chat_id: chatId,
              message_id: query.message.message_id,
              parse_mode: 'HTML'
            }
          );

          // Configurar animación de carga
          const loadingInterval = setInterval(async () => {
            frameIndex = (frameIndex + 1) % loadingFrames.length;
            try {
              await bot.editMessageText(
                `${loadingFrames[frameIndex]} <b>Generando Autorización</b>\n\n` +
                `📋 DNI: ${dni}\n` +
                `🔄 Procesando solicitud...\n\n` +
                `<i>Por favor espera, esto puede tomar unos momentos.</i>`,
                {
                  chat_id: chatId,
                  message_id: query.message.message_id,
                  parse_mode: 'HTML'
                }
              );
            } catch (editError) {
              // Si hay error al editar, detener la animación
              clearInterval(loadingInterval);
            }
          }, 1000); // Cambiar frame cada segundo
          
          // Función para realizar reintentos con backoff exponencial
          const makeRequestWithRetry = async (url, headers, maxRetries = 3) => {
            for (let attempt = 1; attempt <= maxRetries; attempt++) {
              try {
                console.log(`[ADMIN DEBUG] Intento ${attempt}/${maxRetries} - URL: ${url}`);
                
                const response = await axios.get(url, {
                  headers: {
                    ...headers,
                    'ngrok-skip-browser-warning': 'true', // Para evitar la página de advertencia de ngrok
                    'User-Agent': 'TelegramBot/1.0'
                  },
                  timeout: 30000, // 30 segundos de timeout
                  validateStatus: function (status) {
                    return status < 500; // Resolver para códigos de estado < 500
                  }
                });
                
                return response;
              } catch (error) {
                console.log(`[ADMIN DEBUG] Error en intento ${attempt}:`, error.code || error.message);
                
                if (attempt === maxRetries) {
                  throw error; // Lanzar error en el último intento
                }
                
                // Actualizar mensaje con información del reintento
                try {
                  await bot.editMessageText(
                    `⚠️ <b>Reintentando Conexión</b>\n\n` +
                    `📋 DNI: ${dni}\n` +
                    `🔄 Intento ${attempt + 1}/${maxRetries}...\n\n` +
                    `<i>Problema de conexión detectado, reintentando...</i>`,
                    {
                      chat_id: chatId,
                      message_id: query.message.message_id,
                      parse_mode: 'HTML'
                    }
                  );
                } catch (editError) {
                  console.log('[ADMIN DEBUG] Error al actualizar mensaje de reintento:', editError.message);
                }
                
                // Esperar antes del siguiente intento (backoff exponencial)
                const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000); // Max 5 segundos
                await new Promise(resolve => setTimeout(resolve, delay));
              }
            }
          };
          
          try {
            // Llamar al backend para generar la autorización con reintentos
            const backendUrl = process.env.BACKEND_BASE_URL;
            console.log(`[ADMIN DEBUG] Generando autorización para DNI: ${dni}`);
            console.log(`[ADMIN DEBUG] URL: ${backendUrl}/autorizaciones/generar/${dni}`);
            
            const response = await makeRequestWithRetry(
              `${backendUrl}/autorizaciones/generar/${dni}`,
              {
                'Authorization': `Bearer ${process.env.BACKEND_API_KEY}`,
                'X-API-Key': process.env.BACKEND_API_KEY
              }
            );

            // Detener animación de carga
            clearInterval(loadingInterval);

            console.log(`[ADMIN DEBUG] Respuesta del backend:`, response.data);
            console.log(`[ADMIN DEBUG] Status code:`, response.status);

            // Verificar si la respuesta es exitosa
            if (response.status >= 200 && response.status < 300 && response.data && response.data.success) {
              let mensaje = '✅ <b>Autorización Generada Exitosamente</b>\n\n' +
                `📋 DNI: ${dni}\n` +
                `📅 Fecha: ${new Date().toLocaleDateString('es-ES')}\n\n`;
              
              if (response.data.pdf_generated) {
                mensaje += '📄 PDF generado correctamente\n';
                // Si el PDF fue generado, agregar botón de descarga
                buttons.unshift([{ text: '📥 Descargar PDF', callback_data: `admin_download_pdf_${dni}` }]);
              } else {
                mensaje += '⚠️ PDF no generado automáticamente\n\n';
              }
              
              mensaje += '🔔 El proceso de autorización ha sido iniciado.';

              buttons.push([{ text: '🔙 Volver al Menú', callback_data: 'admin_autorizaciones' }]);

              await bot.editMessageText(mensaje, {
                chat_id: chatId,
                message_id: query.message.message_id,
                parse_mode: 'HTML',
                reply_markup: {
                  inline_keyboard: buttons
                }
              });
            } else {
              // Manejar respuestas no exitosas del servidor
              let errorMessage = 'Error desconocido del servidor';
              
              if (response.status === 404) {
                errorMessage = 'Usuario no encontrado con ese DNI';
              } else if (response.status === 400) {
                errorMessage = response.data?.message || 'Datos inválidos enviados al servidor';
              } else if (response.status >= 500) {
                errorMessage = 'Error interno del servidor';
              } else if (response.data && response.data.message) {
                errorMessage = response.data.message;
              }
              
              console.log(`[ADMIN DEBUG] Error en respuesta: status=${response.status}, success=${response.data?.success}, message=${response.data?.message}`);
              
              await bot.editMessageText(
                '❌ <b>Error al Generar Autorización</b>\n\n' +
                `${errorMessage}\n\n` +
                `<i>Código de estado: ${response.status}</i>`,
                {
                  chat_id: chatId,
                  message_id: query.message.message_id,
                  parse_mode: 'HTML',
                  reply_markup: {
                    inline_keyboard: [
                      [{ text: '🔄 Intentar de nuevo', callback_data: 'admin_generar_autorizacion' }],
                      [{ text: '🔙 Volver al Menú', callback_data: 'admin_autorizaciones' }]
                    ]
                  }
                }
              );
            }
          } catch (error) {
            // Detener animación de carga en caso de error
            clearInterval(loadingInterval);
            
            console.error('[ADMIN DEBUG] Error completo al generar autorización:', error);
            console.error('[ADMIN DEBUG] Error response:', error.response?.data);
            console.error('[ADMIN DEBUG] Error code:', error.code);
            console.error('[ADMIN DEBUG] Error status:', error.response?.status);
            
            let errorMessage = 'Error de conexión con el servidor';
            let errorDetails = '';
            
            if (error.code === 'ECONNRESET') {
              errorMessage = 'Conexión interrumpida por el servidor';
              errorDetails = 'El servidor cerró la conexión inesperadamente. Esto puede deberse a:\n• Problemas de red\n• Servidor sobrecargado\n• Timeout del servidor';
            } else if (error.code === 'ECONNREFUSED') {
              errorMessage = 'No se pudo conectar al servidor';
              errorDetails = 'El servidor no está disponible o no responde.';
            } else if (error.code === 'ETIMEDOUT') {
              errorMessage = 'Timeout de conexión';
              errorDetails = 'El servidor tardó demasiado en responder.';
            } else if (error.response?.status === 404) {
              errorMessage = 'Usuario no encontrado con ese DNI';
              errorDetails = 'Verifica que el DNI sea correcto.';
            } else if (error.response?.status === 400) {
              errorMessage = error.response.data?.message || 'Datos inválidos';
              errorDetails = 'Los datos enviados no son válidos.';
            } else if (error.response?.status >= 500) {
              errorMessage = 'Error interno del servidor';
              errorDetails = 'Hay un problema en el servidor backend.';
            } else if (error.message.includes('ngrok')) {
              errorMessage = 'Problema con el túnel ngrok';
              errorDetails = 'El túnel ngrok puede estar inactivo o tener problemas.';
            }

            await bot.editMessageText(
              '❌ <b>Error al Generar Autorización</b>\n\n' +
              `🔍 <b>Problema:</b> ${errorMessage}\n\n` +
              `📝 <b>Detalles:</b>\n${errorDetails}\n\n` +
              `⚠️ <b>Código:</b> ${error.code || 'N/A'}\n` +
              `📊 <b>Estado HTTP:</b> ${error.response?.status || 'N/A'}`,
              {
                chat_id: chatId,
                message_id: query.message.message_id,
                parse_mode: 'HTML',
                reply_markup: {
                  inline_keyboard: [
                    [{ text: '🔄 Intentar de nuevo', callback_data: 'admin_generar_autorizacion' }],
                    [{ text: '🔙 Volver al Menú', callback_data: 'admin_autorizaciones' }]
                  ]
                }
              }
            );
          }
        } else {
          await bot.answerCallbackQuery(query.id, {
            text: '❌ No tienes permisos de administrador',
            show_alert: true 
          });
        }
      }

      // Descargar PDF de autorización
      else if (action.startsWith('admin_download_pdf_')) {
        if (user && user.role_id === 1) {
          const dni = action.replace('admin_download_pdf_', '');
          
          // Animación de carga para descarga
          const downloadFrames = ['📥', '📄', '📥', '📄'];
          let frameIndex = 0;
          
          // Mensaje inicial de descarga
          await bot.editMessageText(
            `${downloadFrames[0]} <b>Preparando Descarga</b>\n\n` +
            `📋 DNI: ${dni}\n` +
            `🔄 Obteniendo archivo PDF...\n\n` +
            `<i>Por favor espera...</i>`,
            {
              chat_id: chatId,
              message_id: query.message.message_id,
              parse_mode: 'HTML'
            }
          );

          // Configurar animación de descarga
          const downloadInterval = setInterval(async () => {
            frameIndex = (frameIndex + 1) % downloadFrames.length;
            try {
              await bot.editMessageText(
                `${downloadFrames[frameIndex]} <b>Preparando Descarga</b>\n\n` +
                `📋 DNI: ${dni}\n` +
                `🔄 Obteniendo archivo PDF...\n\n` +
                `<i>Por favor espera...</i>`,
                {
                  chat_id: chatId,
                  message_id: query.message.message_id,
                  parse_mode: 'HTML'
                }
              );
            } catch (editError) {
              clearInterval(downloadInterval);
            }
          }, 800); // Cambiar frame cada 800ms
          
          try {
            const backendUrl = process.env.BACKEND_BASE_URL;
            console.log(`[ADMIN DEBUG] Descargando PDF para DNI: ${dni}`);
            
            // Obtener el PDF del backend
            const response = await axios.get(`${backendUrl}/autorizaciones/download_pdf/${dni}`, {
              headers: {
                'Authorization': `Bearer ${process.env.BACKEND_API_KEY}`,
                'X-API-Key': process.env.BACKEND_API_KEY
              },
              responseType: 'stream'
            });

            // Detener animación de descarga
            clearInterval(downloadInterval);

            // Actualizar mensaje a "enviando"
            await bot.editMessageText(
              `📤 <b>Enviando Archivo</b>\n\n` +
              `📋 DNI: ${dni}\n` +
              `📄 Preparando envío del PDF...`,
              {
                chat_id: chatId,
                message_id: query.message.message_id,
                parse_mode: 'HTML'
              }
            );

            // Crear un archivo temporal para enviar
            const fs = require('fs');
            const path = require('path');
            const tempDir = path.join(__dirname, '../../temp');
            
            // Crear directorio temporal si no existe
            if (!fs.existsSync(tempDir)) {
              fs.mkdirSync(tempDir, { recursive: true });
            }

            const tempFilePath = path.join(tempDir, `autorizacion_${dni}_${Date.now()}.pdf`);
            const writer = fs.createWriteStream(tempFilePath);

            response.data.pipe(writer);

            writer.on('finish', async () => {
              try {
                // Iniciar animación de envío
                const sendingFrames = ['📤', '📨', '📧', '📩'];
                let sendFrameIndex = 0;
                
                // Mensaje inicial de envío
                await bot.editMessageText(
                  `${sendingFrames[0]} <b>Enviando Archivo</b>\n\n` +
                  `📋 DNI: ${dni}\n` +
                  `📄 Subiendo PDF a Telegram...\n\n` +
                  `<i>Esto puede tomar unos momentos...</i>`,
                  {
                    chat_id: chatId,
                    message_id: query.message.message_id,
                    parse_mode: 'HTML'
                  }
                );

                // Configurar animación de envío
                const sendingInterval = setInterval(async () => {
                  sendFrameIndex = (sendFrameIndex + 1) % sendingFrames.length;
                  try {
                    await bot.editMessageText(
                      `${sendingFrames[sendFrameIndex]} <b>Enviando Archivo</b>\n\n` +
                      `📋 DNI: ${dni}\n` +
                      `📄 Subiendo PDF a Telegram...\n\n` +
                      `<i>Esto puede tomar unos momentos...</i>`,
                      {
                        chat_id: chatId,
                        message_id: query.message.message_id,
                        parse_mode: 'HTML'
                      }
                    );
                  } catch (editError) {
                    clearInterval(sendingInterval);
                  }
                }, 600); // Cambiar frame cada 600ms para envío

                // Obtener información del archivo para mostrar progreso
                const fs = require('fs');
                const stats = fs.statSync(tempFilePath);
                const fileSizeInMB = (stats.size / (1024 * 1024)).toFixed(2);

                // Actualizar mensaje con información del archivo
                setTimeout(async () => {
                  try {
                    await bot.editMessageText(
                      `${sendingFrames[sendFrameIndex]} <b>Enviando Archivo</b>\n\n` +
                      `📋 DNI: ${dni}\n` +
                      `📄 Archivo: ${fileSizeInMB} MB\n` +
                      `🔄 Subiendo a Telegram...\n\n` +
                      `<i>Procesando documento...</i>`,
                      {
                        chat_id: chatId,
                        message_id: query.message.message_id,
                        parse_mode: 'HTML'
                      }
                    );
                  } catch (editError) {
                    console.log('[ADMIN DEBUG] Error al actualizar mensaje con tamaño:', editError.message);
                  }
                }, 1500);

                // Enviar el PDF al usuario
                await bot.sendDocument(chatId, tempFilePath, {
                  caption: `📄 <b>Autorización Completa</b>\n\n📋 DNI: ${dni}\n📅 Generado: ${new Date().toLocaleDateString('es-ES')}\n📊 Tamaño: ${fileSizeInMB} MB`,
                  parse_mode: 'HTML'
                });

                // Detener animación de envío
                clearInterval(sendingInterval);

                // Actualizar mensaje de éxito con animación final
                const successFrames = ['✅', '🎉', '✅', '🎉'];
                let successFrameIndex = 0;
                
                const successInterval = setInterval(async () => {
                  try {
                    await bot.editMessageText(
                      `${successFrames[successFrameIndex]} <b>PDF Enviado Exitosamente</b>\n\n` +
                      `📋 DNI: ${dni}\n` +
                      `📄 Archivo enviado correctamente\n` +
                      `📊 Tamaño: ${fileSizeInMB} MB`,
                      {
                        chat_id: chatId,
                        message_id: query.message.message_id,
                        parse_mode: 'HTML',
                        reply_markup: {
                          inline_keyboard: [
                            [{ text: '🔙 Volver al Menú', callback_data: 'admin_autorizaciones' }]
                          ]
                        }
                      }
                    );
                    successFrameIndex = (successFrameIndex + 1) % successFrames.length;
                  } catch (editError) {
                    clearInterval(successInterval);
                  }
                }, 500);

                // Detener animación de éxito después de 3 segundos
                setTimeout(() => {
                  clearInterval(successInterval);
                  // Mensaje final estático
                  bot.editMessageText(
                    `✅ <b>PDF Enviado Exitosamente</b>\n\n` +
                    `📋 DNI: ${dni}\n` +
                    `📄 El archivo ha sido enviado correctamente\n` +
                    `📊 Tamaño: ${fileSizeInMB} MB`,
                    {
                      chat_id: chatId,
                      message_id: query.message.message_id,
                      parse_mode: 'HTML',
                      reply_markup: {
                        inline_keyboard: [
                          [{ text: '🔙 Volver al Menú', callback_data: 'admin_autorizaciones' }]
                        ]
                      }
                    }
                  ).catch(err => console.log('[ADMIN DEBUG] Error en mensaje final:', err.message));
                }, 3000);

                // Limpiar archivo temporal después de un tiempo
                setTimeout(() => {
                  if (fs.existsSync(tempFilePath)) {
                    fs.unlinkSync(tempFilePath);
                    console.log(`[ADMIN DEBUG] Archivo temporal eliminado: ${tempFilePath}`);
                  }
                }, 30000); // 30 segundos

              } catch (sendError) {
                console.error('[ADMIN DEBUG] Error al enviar PDF:', sendError);
                
                // Determinar tipo de error específico
                let errorMessage = 'No se pudo enviar el archivo.';
                let errorDetails = '';
                
                if (sendError.message.includes('file size')) {
                  errorMessage = 'El archivo es demasiado grande';
                  errorDetails = 'El PDF excede el límite de tamaño de Telegram (50MB).';
                } else if (sendError.message.includes('network')) {
                  errorMessage = 'Error de conexión';
                  errorDetails = 'Problema de red al subir el archivo.';
                } else if (sendError.message.includes('timeout')) {
                  errorMessage = 'Timeout al enviar';
                  errorDetails = 'El envío tardó demasiado tiempo.';
                }
                
                await bot.editMessageText(
                  `❌ <b>Error al Enviar PDF</b>\n\n` +
                  `🔍 <b>Problema:</b> ${errorMessage}\n` +
                  `📝 <b>Detalles:</b> ${errorDetails}\n\n` +
                  `<i>Inténtalo más tarde o contacta al administrador.</i>`,
                  {
                    chat_id: chatId,
                    message_id: query.message.message_id,
                    parse_mode: 'HTML',
                    reply_markup: {
                      inline_keyboard: [
                        [{ text: '🔄 Intentar de nuevo', callback_data: `admin_download_pdf_${dni}` }],
                        [{ text: '🔙 Volver al Menú', callback_data: 'admin_autorizaciones' }]
                      ]
                    }
                  }
                );
              }
            });

            writer.on('error', async (writeError) => {
              clearInterval(downloadInterval);
              console.error('[ADMIN DEBUG] Error al escribir archivo temporal:', writeError);
              await bot.editMessageText(
                '❌ <b>Error al Procesar PDF</b>\n\nNo se pudo procesar el archivo. Inténtalo más tarde.',
                {
                  chat_id: chatId,
                  message_id: query.message.message_id,
                  parse_mode: 'HTML',
                  reply_markup: {
                    inline_keyboard: [
                      [{ text: '🔄 Intentar de nuevo', callback_data: `admin_download_pdf_${dni}` }],
                      [{ text: '🔙 Volver al Menú', callback_data: 'admin_autorizaciones' }]
                    ]
                  }
                }
              );
            });

          } catch (error) {
            clearInterval(downloadInterval);
            console.error('[ADMIN DEBUG] Error al descargar PDF:', error);
            
            let errorMessage = 'No se pudo descargar el PDF.';
            
            if (error.response?.status === 404) {
              errorMessage = 'PDF no encontrado para este DNI.';
            } else if (error.response?.status === 500) {
              errorMessage = 'Error interno del servidor.';
            }

            await bot.editMessageText(
              `❌ <b>Error de Descarga</b>\n\n${errorMessage}`,
              {
                chat_id: chatId,
                message_id: query.message.message_id,
                parse_mode: 'HTML',
                reply_markup: {
                  inline_keyboard: [
                    [{ text: '🔄 Intentar de nuevo', callback_data: `admin_download_pdf_${dni}` }],
                    [{ text: '🔙 Volver al Menú', callback_data: 'admin_autorizaciones' }]
                  ]
                }
              }
            );
          }
        } else {
          await bot.answerCallbackQuery(query.id, {
            text: '❌ No tienes permisos de administrador',
            show_alert: true 
          });
        }
      }

      // Listar autorizaciones activas
      else if (action === 'admin_listar_autorizaciones' || action.startsWith('admin_autorizaciones_page_')) {
        if (user && user.role_id === 1) {
          let page = 1;
          if (action.startsWith('admin_autorizaciones_page_')) {
            page = parseInt(action.split('_')[3]) || 1;
          }

          try {
            const backendUrl = process.env.BACKEND_BASE_URL;
            const response = await axios.get(`${backendUrl}/autorizaciones/activas?page=${page}&limit=5`, {
              headers: {
                'Authorization': `Bearer ${process.env.BACKEND_API_KEY}`,
                'X-API-Key': process.env.BACKEND_API_KEY
              }
            });

            if (response.data.success) {
              const { autorizaciones, total, totalPages, currentPage } = response.data;
              
              let mensaje = '📋 **Autorizaciones Activas**\n\n';
              
              if (autorizaciones.length === 0) {
                mensaje += '📭 No hay autorizaciones activas en este momento.';
              } else {
                mensaje += `📊 Total: ${total} autorizaciones\n`;
                mensaje += `📄 Página ${currentPage} de ${totalPages}\n\n`;
                
                autorizaciones.forEach((auth, index) => {
                  const numero = ((currentPage - 1) * 5) + index + 1;
                  const fecha = new Date(auth.fecha_creacion).toLocaleDateString('es-ES');
                  const estado = auth.completada ? '✅ Completada' : '⏳ Pendiente';
                  
                  mensaje += `${numero}. **${auth.usuario.nombre}**\n`;
                  mensaje += `   📋 DNI: ${auth.usuario.dni}\n`;
                  mensaje += `   🆔 ID: ${auth.id}\n`;
                  mensaje += `   📅 Fecha: ${fecha}\n`;
                  mensaje += `   📊 Estado: ${estado}\n\n`;
                });
              }

              await bot.editMessageText(mensaje, {
                chat_id: chatId,
                message_id: query.message.message_id,
                parse_mode: 'Markdown',
                ...paginacionAutorizaciones(currentPage, totalPages)
              });
            } else {
              await bot.editMessageText(
                '❌ **Error al Obtener Autorizaciones**\n\n' +
                `${response.data.message || 'Error desconocido'}`,
                {
                  chat_id: chatId,
                  message_id: query.message.message_id,
                  parse_mode: 'Markdown',
                  reply_markup: {
                    inline_keyboard: [
                      [{ text: '🔄 Intentar de nuevo', callback_data: 'admin_listar_autorizaciones' }],
                      [{ text: '🔙 Volver al Menú', callback_data: 'admin_autorizaciones' }]
                    ]
                  }
                }
              );
            }
          } catch (error) {
            console.error('Error al listar autorizaciones:', error);
            await bot.editMessageText(
              '❌ **Error de Conexión**\n\n' +
              'No se pudo conectar con el servidor. Inténtalo más tarde.',
              {
                chat_id: chatId,
                message_id: query.message.message_id,
                parse_mode: 'Markdown',
                reply_markup: {
                  inline_keyboard: [
                    [{ text: '🔄 Intentar de nuevo', callback_data: 'admin_listar_autorizaciones' }],
                    [{ text: '🔙 Volver al Menú', callback_data: 'admin_autorizaciones' }]
                  ]
                }
              }
            );
          }
        } else {
          await bot.answerCallbackQuery(query.id, {
            text: '❌ No tienes permisos de administrador',
            show_alert: true 
          });
        }
      }

      // Manejar detalles de usuario específico
      else if (action.startsWith('user_detail_')) {
        const targetUserId = action.split('_')[2];
    
        
        try {
          const targetUser = await userApiService.getUserById(targetUserId);
          
          if (!targetUser) {
            console.log('ERROR: targetUser es null o undefined');
            await bot.answerCallbackQuery(query.id, { text: '❌ Usuario no encontrado' });
            return;
          }
          
          // Usar la estructura correcta del backend
          const rolEmoji = targetUser.role_id === 1 ? '👑' : '👤';
          const roleName = targetUser.role_id === 1 ? 'Admin' : 'Usuario';
          

          
          const userDetailMenu = {
            reply_markup: {
              inline_keyboard: [
                [
                  { text: '✏️ Editar Rol', callback_data: `edit_rol_${targetUserId}` },
                  { text: '🆔 Editar DNI', callback_data: `edit_dni_${targetUserId}` }
                ],
                [
                  { text: '🗑️ Eliminar Usuario', callback_data: `delete_user_${targetUserId}` }
                ],
                [
                  { text: '🔙 Volver a Lista', callback_data: 'users_list' }
                ]
              ]
            }
          };

          await bot.editMessageText(
            `👤 **Detalles del Usuario**\n\n` +
            `${rolEmoji} **Nombre:** ${targetUser.nombre || 'No especificado'}\n` +
            `🆔 **DNI:** ${targetUser.dni || 'No especificado'}\n` +
            `📱 **Telegram ID:** ${targetUser.telegram_id || 'No especificado'}\n` +
            `🎭 **Rol:** ${roleName}\n` +
            `🏢 **Sede:** ${targetUser.sede || 'Sin sede'}\n` +
            `Selecciona una acción:`,
            {
              chat_id: chatId,
              message_id: query.message.message_id,
              parse_mode: 'Markdown',
              ...userDetailMenu
            }
          );
        } catch (error) {
          console.error('Error al obtener detalles del usuario:', error);
          console.error('Error completo:', JSON.stringify(error, null, 2));
          await bot.answerCallbackQuery(query.id, { text: '❌ Error al obtener usuario' });
        }
      }

      // Manejar edición de rol
      else if (action.startsWith('edit_rol_')) {
        const targetUserId = action.split('_')[2];
        
        try {
          const targetUser = await userApiService.getUserById(targetUserId);
          
          if (!targetUser) {
            await bot.answerCallbackQuery(query.id, { text: '❌ Usuario no encontrado' });
            return;
          }

          // Crear botón para el rol contrario al actual
          const roleButtons = [];
          const currentRoleId = targetUser.role_id;
          
          if (currentRoleId === 1) {
            // Si es admin, mostrar opción para cambiar a usuario
            roleButtons.push([{ 
              text: '👤 Cambiar a Usuario', 
              callback_data: `set_rol_${targetUserId}_2` 
            }]);
          } else {
            // Si es usuario (o cualquier otro rol), mostrar opción para cambiar a admin
            roleButtons.push([{ 
              text: '👑 Cambiar a Admin', 
              callback_data: `set_rol_${targetUserId}_1` 
            }]);
          }
          
          roleButtons.push([{ text: '🔙 Volver', callback_data: `user_detail_${targetUserId}` }]);

          const rolMenu = {
            reply_markup: {
              inline_keyboard: roleButtons
            }
          };

          // Determinar el nombre del rol actual para mostrar
          const currentRoleName = currentRoleId === 1 ? 'Admin' : 'Usuario';
          const currentRoleEmoji = currentRoleId === 1 ? '👑' : '👤';

          await bot.editMessageText(
            `🎭 **Cambiar Rol de Usuario**\n\n` +
            `👤 **Usuario:** ${targetUser.nombre || 'No especificado'}\n` +
            `${currentRoleEmoji} **Rol actual:** ${currentRoleName}\n\n` +
            `Selecciona el nuevo rol:`,
            {
              chat_id: chatId,
              message_id: query.message.message_id,
              parse_mode: 'Markdown',
              ...rolMenu
            }
          );
        } catch (error) {
          console.error('Error al mostrar menú de rol:', error);
          await bot.answerCallbackQuery(query.id, { text: '❌ Error al cargar roles' });
        }
      }

      // Manejar establecimiento de rol
      else if (action.startsWith('set_rol_')) {
        const parts = action.split('_');
        const targetUserId = parts[2];
        const newRoleId = parseInt(parts[3]); // Convertir a número
        
        console.log(`Intentando cambiar rol del usuario ${targetUserId} a role_id: ${newRoleId}`);
        
        try {
          // Usar la estructura correcta del backend
          const updateResult = await userApiService.updateUser(targetUserId, { role_id: newRoleId });
          console.log('Resultado de actualización:', updateResult);
          
          // Determinar el nombre del rol para el mensaje
          const roleName = newRoleId === 1 ? 'Admin' : 'Usuario';
          
          await bot.answerCallbackQuery(query.id, { 
            text: `✅ Rol actualizado a ${roleName}` 
          });
          
          // Volver a mostrar detalles del usuario
          const updatedUser = await userApiService.getUserById(targetUserId);
          console.log('Usuario actualizado completo:', JSON.stringify(updatedUser, null, 2));
          
          // Verificar si el usuario existe
          if (!updatedUser) {
            throw new Error('Usuario no encontrado después de la actualización');
          }
          
          const rolEmoji = updatedUser.role_id === 1 ? '👑' : '👤';
          const currentRoleName = updatedUser.role_id === 1 ? 'Admin' : 'Usuario';
          
          const userDetailMenu = {
            reply_markup: {
              inline_keyboard: [
                [
                  { text: '✏️ Editar Rol', callback_data: `edit_rol_${targetUserId}` },
                  { text: '🆔 Editar DNI', callback_data: `edit_dni_${targetUserId}` }
                ],
                [
                  { text: '🗑️ Eliminar Usuario', callback_data: `delete_user_${targetUserId}` }
                ],
                [
                  { text: '🔙 Volver a Lista', callback_data: 'users_list' }
                ]
              ]
            }
          };

          await bot.editMessageText(
            `👤 **Detalles del Usuario**\n\n` +
            `${rolEmoji} **Nombre:** ${updatedUser.nombre || 'No especificado'}\n` +
            `🆔 **DNI:** ${updatedUser.dni || 'No especificado'}\n` +
            `📱 **Telegram ID:** ${updatedUser.telegram_id || 'No especificado'}\n` +
            `🎭 **Rol:** ${currentRoleName}\n` +
            `🏢 **Sede:** ${updatedUser.sede || 'Sin sede'}\n` +
            `✅ **Rol actualizado exitosamente**\n\n` +
            `Selecciona una acción:`,
            {
              chat_id: chatId,
              message_id: query.message.message_id,
              parse_mode: 'Markdown',
              ...userDetailMenu
            }
          );
        } catch (error) {
          console.error('Error al actualizar rol:', error);
          console.error('Detalles del error:', error.response?.data || error.message);
          await bot.answerCallbackQuery(query.id, { 
            text: '❌ Error al actualizar rol' 
          });
        }
      }

      // Manejar edición de DNI
      else if (action.startsWith('edit_dni_')) {
        const targetUserId = action.split('_')[2];
        
        try {
          const targetUser = await userApiService.getUserById(targetUserId);
          
          if (!targetUser) {
            await bot.answerCallbackQuery(query.id, { text: '❌ Usuario no encontrado' });
            return;
          }

          // Guardar el estado para esperar el nuevo DNI
          if (!userSessions.has(chatId)) {
            userSessions.set(chatId, {});
          }
          userSessions.get(chatId).waitingForDni = targetUserId;

          await bot.editMessageText(
            `🆔 **Editar DNI de Usuario**\n\n` +
            `👤 **Usuario:** ${targetUser.nombre || 'No especificado'}\n` +
            `🆔 **DNI actual:** ${targetUser.dni || 'No especificado'}\n\n` +
            `📝 **Envía el nuevo DNI:**`,
            {
              chat_id: chatId,
              message_id: query.message.message_id,
              parse_mode: 'Markdown',
              reply_markup: {
                inline_keyboard: [
                  [{ text: '🔙 Cancelar', callback_data: `user_detail_${targetUserId}` }]
                ]
              }
            }
          );
        } catch (error) {
          console.error('Error al mostrar edición de DNI:', error);
          await bot.answerCallbackQuery(query.id, { text: '❌ Error al cargar usuario' });
        }
      }

      // Manejar eliminación de usuario
      else if (action.startsWith('delete_user_')) {
        const targetUserId = action.split('_')[2];
        
        try {
          const targetUser = await userApiService.getUserById(targetUserId);
          
          if (!targetUser) {
            await bot.answerCallbackQuery(query.id, { text: '❌ Usuario no encontrado' });
            return;
          }

          const confirmMenu = {
            reply_markup: {
              inline_keyboard: [
                [
                  { text: '✅ Sí, Eliminar', callback_data: `confirm_delete_${targetUserId}` },
                  { text: '❌ Cancelar', callback_data: `user_detail_${targetUserId}` }
                ]
              ]
            }
          };

          await bot.editMessageText(
            `🗑️ **Confirmar Eliminación**\n\n` +
            `👤 **Usuario:** ${targetUser.nombre || 'No especificado'}\n` +
            `🆔 **DNI:** ${targetUser.dni || 'No especificado'}\n` +
            `📱 **Telegram ID:** ${targetUser.chat_id}\n\n` +
            `⚠️ **¿Estás seguro de que quieres eliminar este usuario?**\n` +
            `Esta acción no se puede deshacer.`,
            {
              chat_id: chatId,
              message_id: query.message.message_id,
              parse_mode: 'Markdown',
              ...confirmMenu
            }
          );
        } catch (error) {
          console.error('Error al mostrar confirmación de eliminación:', error);
          await bot.answerCallbackQuery(query.id, { text: '❌ Error al cargar usuario' });
        }
      }

      // Manejar confirmación de eliminación
      else if (action.startsWith('confirm_delete_')) {
        const targetUserId = action.split('_')[2];
        
        try {
          await userApiService.deleteUser(targetUserId);
          await bot.answerCallbackQuery(query.id, { 
            text: '✅ Usuario eliminado exitosamente' 
          });
          
          // Volver a la lista de usuarios
          const usersResponse = await userApiService.listUsers({ limit: 50 });
          const users = usersResponse.users || usersResponse.data || usersResponse;
          const userButtons = [];
          
          if (Array.isArray(users) && users.length > 0) {
            users.forEach(u => {
              const rolEmoji = u.rol === 'admin' ? '👑' : '👤';
              const estadoEmoji = u.estado === 'activo' ? '🟢' : '🔴';
              userButtons.push([{ 
                text: `${rolEmoji} ${u.nombre || 'Sin nombre'} ${estadoEmoji}`, 
                callback_data: `user_detail_${u.id || u.chat_id}` 
              }]);
            });
          }
          
          userButtons.push([{ text: '🔙 Volver a Gestión', callback_data: 'admin_users' }]);
          
          await bot.editMessageText(
            '👥 **Lista de Usuarios**\n\n✅ **Usuario eliminado exitosamente**\n\nSelecciona un usuario para ver su reporte detallado:',
            {
              chat_id: chatId,
              message_id: query.message.message_id,
              parse_mode: 'Markdown',
              reply_markup: { inline_keyboard: userButtons }
            }
          );
        } catch (error) {
          console.error('Error al eliminar usuario:', error);
          await bot.answerCallbackQuery(query.id, { 
            text: '❌ Error al eliminar usuario' 
          });
        }
      }

      // Manejar callbacks de sesión
      if (action === 'session_continue') {
        // Limpiar el estado de warning
        if (session.warningActive) {
          session.warningActive = false;
          userSessions.set(chatId, session);
        }
        
        await bot.editMessageText(
          '✅ Sesión renovada. ¡Continuemos!\n\n' +
          'Usa el menú persistente de abajo para navegar.',
          {
            chat_id: chatId,
            message_id: query.message.message_id
          }
        );
        
        // Renovar la sesión
        renewSessionTimeout(bot, chatId);
        return;
      }

      else if (action === 'session_exit') {
        // Limpiar el estado de warning
        if (session.warningActive) {
          session.warningActive = false;
          userSessions.set(chatId, session);
        }
        
        await bot.editMessageText(
          '👋 ¡Hasta luego! Usa /start cuando quieras volver.',
          {
            chat_id: chatId,
            message_id: query.message.message_id
          }
        );
        
        // Cambiar el teclado persistente a solo botón de inicio
        await bot.sendMessage(chatId, 
          '🔄 Sesión cerrada correctamente.', {
          reply_markup: {
            keyboard: [['🚀 Iniciar']], 
            resize_keyboard: true 
          }
        });
        
        // Limpiar la sesión después de 3 segundos
        setTimeout(async () => {
          await clearUserSession(bot, chatId, false); // false = enviar mensaje final
        }, 3000);
        return;
      }

    } catch (error) {
      console.error('Error en callbackHandler:', error);
      await bot.answerCallbackQuery(query.id, { 
        text: '❌ Error interno del servidor' 
      });
    }

    // Renovar timeout de sesión
    if (userSessions.has(chatId)) {
      renewSessionTimeout(bot, chatId);
    }

    // El tracking se hace automáticamente con el botWrapper
    // Ya no necesitamos llamar trackBotMessage manualmente
  });
};

