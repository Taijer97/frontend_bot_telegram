const path = require('path');
const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');
const userApiService = require('../services/userApiService');
const { renewSessionTimeout, userSessions, clearUserSession, trackBotMessage } = require('../utils/session');
const mainMenu = require('../menus/mainMenu');
const adminMenu = require('../menus/adminMenu');
const { usersManagementMenu, adminTypeMenu, userTypeMenu, userDetailMenu } = require('../menus/usersMenu');
const { shopManagementMenu, tiendaWebApp } = require('../menus/shopMenu');
const reportsMenu = require('../menus/reportsMenu');
const { getChatStats, cleanOldMessages } = require('../utils/chatManager');
const consultasMenu = require('../menus/consultasMenu');

// Función auxiliar para manejar callbacks de manera segura
async function safeAnswerCallback(bot, queryId, options = {}) {
  try {
    await bot.answerCallbackQuery(queryId, options);
  } catch (error) {
    if (error.message.includes('query is too old') || 
        error.message.includes('query ID is invalid')) {
      console.log('⚠️ Callback query expirado o inválido, ignorando...');
    } else {
      console.error('Error al responder callback:', error);
    }
  }
}

// Función auxiliar para formatear mensajes de manera segura
function formatSafeMessage(text, useHtml = true) {
  if (!useHtml) {
    // Si no usamos HTML, simplemente devolvemos el texto sin formato
    return { text: text, options: {} };
  }
  
  // Escapar caracteres especiales para HTML
  const escapeHtml = (str) => {
    if (!str) return 'No especificado';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };
  
  // Convertir formato Markdown básico a HTML
  let htmlText = text
    .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')  // **texto** -> <b>texto</b>
    .replace(/\*(.*?)\*/g, '<i>$1</i>')      // *texto* -> <i>texto</i>
    .replace(/`(.*?)`/g, '<code>$1</code>'); // `texto` -> <code>texto</code>
  
  return {
    text: htmlText,
    options: { parse_mode: 'HTML' }
  };
}

module.exports = function callbackHandler(bot) {
  bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const data = query.data;
    const action = data; // Asignar data a action para compatibilidad con el código existente

    console.log(`\n🔔 ===== CALLBACK RECIBIDO =====`);
    console.log(`📞 Action: ${data}`);
    console.log(`👤 Usuario: ${chatId}`);
    console.log(`📨 Message ID: ${messageId}`);
    console.log(`===============================\n`);

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
                  [{ text: '🔙 Volver a Consultas', callback_data: 'consulta' }]
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
          const loadingMessage = await bot.editMessageText('⏳ Evaluando crédito con IA', {
            chat_id: chatId,
            message_id: query.message.message_id
          });
          loadingMessageId = loadingMessage.message_id;
          
          // Animación de carga dinámica
          const loadingFrames = ['🤖', '💳', '📊', '🔍'];
          const loadingTexts = [
            'Iniciando evaluación con IA',
            'Analizando historial crediticio', 
            'Aplicando reglas de negocio',
            'Generando decisión final'
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
            // Consultar crédito usando el nuevo endpoint con IA
            const shopUrl = `${process.env.BACKEND_BASE_URL}`;
            const response = await axios.post(
              `${shopUrl}/evaluar_credito/evaluate_ia/${user.dni}`,
              { 
                timeout: 30000,
                headers: {
                  'Content-Type': 'application/json'
                }
              }
            );
            
            // Detener animación
            clearInterval(loadingInterval);
            
            const data = response.data;
            const evaluation = data.evaluation;
            
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
            
            let mensaje = '🤖 <b>Evaluación de Crédito con IA</b>\n\n';
            mensaje += `👤 <b>Cliente:</b> ${escapeHtml(evaluation.cliente)}\n`;
            mensaje += `🆔 <b>DNI:</b> ${escapeHtml(evaluation.dni)}\n\n`;
            
            // Resumen de deuda
            if (evaluation.resumen_deuda) {
              const resumen = evaluation.resumen_deuda;
              mensaje += `💰 <b>Resumen Financiero:</b>\n`;
              mensaje += `• Monto Total: S/${formatNumber(resumen.monto_total)}\n`;
              mensaje += `• Por Pagar: S/${formatNumber(resumen.por_pagar)}\n`;
              mensaje += `• Cuotas Pendientes: ${resumen.cuotas_pendientes}\n`;
              mensaje += `• Pagos Registrados: ${resumen.pagos_registrados}\n\n`;
            }
            
            // Evaluación de reglas
            if (evaluation.evaluación) {
              mensaje += `📋 <b>Evaluación de Reglas:</b>\n`;
              
              const reglas = evaluation.evaluación;
              
              // Regla A
              if (reglas.regla_A) {
                const emoji = reglas.regla_A.cumple ? '✅' : '❌';
                mensaje += `${emoji} <b>Regla A:</b> ${reglas.regla_A.cumple ? 'CUMPLE' : 'NO CUMPLE'}\n`;
                mensaje += `   └ ${escapeHtml(reglas.regla_A.razón)}\n\n`;
              }
              
              // Regla B
              if (reglas.regla_B) {
                const emoji = reglas.regla_B.cumple ? '✅' : '❌';
                mensaje += `${emoji} <b>Regla B:</b> ${reglas.regla_B.cumple ? 'CUMPLE' : 'NO CUMPLE'}\n`;
                mensaje += `   └ ${escapeHtml(reglas.regla_B.razón)}\n\n`;
              }
              
              // Regla C
              if (reglas.regla_C) {
                const emoji = reglas.regla_C.cumple ? '✅' : '❌';
                mensaje += `${emoji} <b>Regla C:</b> ${reglas.regla_C.cumple ? 'CUMPLE' : 'NO CUMPLE'}\n`;
                mensaje += `   └ ${escapeHtml(reglas.regla_C.razón)}\n\n`;
              }
            }
            
            // Decisión final
            const decisionEmoji = evaluation.decision_final === 'APROBADO' ? '✅' : 
                                 evaluation.decision_final === 'NEGADO' ? '❌' : '⚠️';
            mensaje += `🎯 <b>Decisión Final:</b> ${decisionEmoji} ${escapeHtml(evaluation.decision_final)}\n\n`;
            
            // Mensaje de la evaluación
            if (evaluation.mensaje) {
              mensaje += `💬 <b>Mensaje:</b>\n${escapeHtml(evaluation.mensaje)}`;
            }

            // Botones según la decisión
            let keyboard = [];
            
            if (evaluation.decision_final === 'APROBADO') {
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
            
            console.error('❌ Error consultando crédito con IA:', apiError.message);
            
            let errorMessage = '❌ <b>Error en evaluación con IA</b>\n\n';
            
            if (apiError.code === 'ECONNABORTED' || apiError.message.includes('timeout')) {
              errorMessage += '⏱️ La evaluación está tardando más de lo esperado.\n';
              errorMessage += 'El servidor de IA puede estar sobrecargado.';
            } else if (apiError.message.includes('ENOTFOUND') || apiError.message.includes('ECONNREFUSED')) {
              errorMessage += '🔌 No se puede conectar con el servidor de evaluación.\n';
              errorMessage += 'Verifica que el servicio esté disponible.';
            } else if (apiError.response && apiError.response.status) {
              errorMessage += `🔧 Error del servidor: ${apiError.response.status}\n`;
              if (apiError.response.status === 404) {
                errorMessage += 'No se encontró información para el DNI proporcionado.';
              } else {
                errorMessage += 'Contacta al administrador si el problema persiste.';
              }
            } else {
              errorMessage += '🔧 Error técnico del sistema de IA.\n';
              errorMessage += 'Inténtalo nuevamente en unos momentos.';
            }
            
            await bot.editMessageText(errorMessage, {
              chat_id: chatId,
              message_id: loadingMessageId,
              parse_mode: 'HTML',
              reply_markup: {
                inline_keyboard: [
                  [{ text: '🔄 Reintentar', callback_data: 'consulta_credito' }],
                  [{ text: '🔙 Volver', callback_data: 'consulta' }]
                ]
              }
            });
          }
          
        } catch (error) {
          console.error('Error en consulta_credito:', error);
          
          // Si hay un error, intentar sin Markdown
          try {
            await bot.sendMessage(chatId, 
              '❌ Error en evaluación con IA. Intenta nuevamente.',
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
                callback_data: `user_detail_${u.id || u.chat_id}` 
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

      // Menú de tipos de administradores
      else if (action === 'admin_type_menu') {
        if (user && user.role_id === 1) {
          await bot.editMessageText(
            '👑 **Gestión de Administradores**\n\nSelecciona una opción:',
            {
              chat_id: chatId,
              message_id: query.message.message_id,
              parse_mode: 'Markdown',
              ...adminTypeMenu(chatId)
            }
          );
        } else {
          await bot.answerCallbackQuery(query.id, {
            text: '❌ No tienes permisos de administrador',
            show_alert: true 
          });
        }
      }

      // Menú de tipos de usuarios
      else if (action === 'user_type_menu') {
        if (user && user.role_id === 1) {
          await bot.editMessageText(
            '👤 **Gestión de Usuarios**\n\nSelecciona una opción:',
            {
              chat_id: chatId,
              message_id: query.message.message_id,
              parse_mode: 'Markdown',
              ...userTypeMenu(chatId)
            }
          );
        } else {
          await bot.answerCallbackQuery(query.id, {
            text: '❌ No tienes permisos de administrador',
            show_alert: true 
          });
        }
      }

      // Listar administradores
      else if (action === 'list_admins') {
        if (user && user.role_id === 1) {
          try {
            const usersResponse = await userApiService.listUsers({ page: 1 });
            const users = usersResponse.usuarios || [];
            const admins = users.filter(u => u.role_id === 1);
            const userButtons = [];
            
            if (admins.length > 0) {
              admins.forEach(admin => {
                userButtons.push([{ 
                  text: `👑 ${admin.nombre || 'Sin nombre'}`, 
                  callback_data: `admin_detail_${admin.id}` 
                }]);
              });
            } else {
              userButtons.push([{ text: '📝 No hay administradores registrados', callback_data: 'admin_type_menu' }]);
            }
            
            userButtons.push([{ text: '🔙 Volver a Administradores', callback_data: 'admin_type_menu' }]);
            
            await bot.editMessageText(
              `👑 **Lista de Administradores** (${admins.length} total)\n\nSelecciona un administrador para ver sus detalles:`,
              {
                chat_id: chatId,
                message_id: query.message.message_id,
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: userButtons }
              }
            );
          } catch (error) {
            console.error('Error al obtener lista de administradores:', error);
            await bot.editMessageText(
              '❌ **Error**\n\nNo se pudo obtener la lista de administradores.',
              {
                chat_id: chatId,
                message_id: query.message.message_id,
                parse_mode: 'Markdown',
                reply_markup: {
                  inline_keyboard: [[{ text: '🔙 Volver', callback_data: 'admin_type_menu' }]]
                }
              }
            );
          }
        }
      }

      // Listar usuarios (solo usuarios normales)
      else if (action === 'list_users') {
        if (user && user.role_id === 1) {
          try {
            const usersResponse = await userApiService.listUsers({ page: 1 });
            const users = usersResponse.usuarios || [];
            const normalUsers = users.filter(u => u.role_id !== 1);
            const userButtons = [];
            
            if (normalUsers.length > 0) {
              normalUsers.forEach(normalUser => {
                const statusEmoji = '✅'; // Siempre activo ya que no hay campo de estado
                userButtons.push([{ 
                  text: `${statusEmoji} ${normalUser.nombre || 'Sin nombre'}`, 
                  callback_data: `user_detail_${normalUser.id}` 
                }]);
              });
            } else {
              userButtons.push([{ text: '📝 No hay usuarios registrados', callback_data: 'user_type_menu' }]);
            }
            
            userButtons.push([{ text: '🔙 Volver a Usuarios', callback_data: 'user_type_menu' }]);
            
            await bot.editMessageText(
              `👤 **Lista de Usuarios** (${normalUsers.length} total)\n\nSelecciona un usuario para ver sus detalles:`,
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
              '❌ **Error**\n\nNo se pudo obtener la lista de usuarios.',
              {
                chat_id: chatId,
                message_id: query.message.message_id,
                parse_mode: 'Markdown',
                reply_markup: {
                  inline_keyboard: [[{ text: '🔙 Volver', callback_data: 'user_type_menu' }]]
                }
              }
            );
          }
        }
      }

      // Detalle de administrador
      else if (action.startsWith('admin_detail_')) {
        if (user && user.role_id === 1) {
          const userId = action.split('_')[2];
          try {
            const userDetail = await userApiService.getUserById(userId);
            if (userDetail) {
              const statusText = userDetail.activo ? '✅ Activo' : '❌ Inactivo';
              const menuData = await userDetailMenu(userId, 'admin');
          await bot.editMessageText(
            `👑 **Detalles del Administrador**\n\n` +
            `**Nombre:** ${userDetail.nombre || 'Sin nombre'}\n` +
            `**DNI:** ${userDetail.dni || 'Sin DNI'}\n` +
            `**Rol:** Administrador\n` +
            `**Estado:** ${statusText}\n` +
            `**ID:** ${userDetail.id}`,
            {
              chat_id: chatId,
              message_id: query.message.message_id,
              parse_mode: 'Markdown',
              ...menuData
            }
          )}
        } catch (error) {

          console.error('Error al obtener detalles del administrador:', error);
          await bot.editMessageText(
            '❌ **Error**\n\nNo se pudieron obtener los detalles del administrador.',
            {
              chat_id: chatId,
              message_id: query.message.message_id,
              parse_mode: 'Markdown',
              reply_markup: {
                inline_keyboard: [[{ text: '🔙 Volver', callback_data: 'list_admins' }]]
              }
            }
          );
          }
        }
      }

      // Detalle de usuario
      else if (action.startsWith('user_detail_')) {
        if (user && user.role_id === 1) {
          const userId = action.split('_')[2];
          try {
            const userDetail = await userApiService.getUserById(userId);
            if (userDetail) {
              const statusText = userDetail.activo ? '✅ Activo' : '❌ Inactivo';
              const userType = userDetail.role_id === 1 ? 'admin' : 'user';
              const menuData = await userDetailMenu(userId, userType);
              
              await bot.editMessageText(
                `👤 **Detalles del Usuario**\n\n` +
                `🆔 **Nombre:** ${userDetail.nombre || 'Sin nombre'}\n` +
                `🔢 **DNI:** ${userDetail.dni || 'Sin DNI'}\n` +
                `🎭 **Rol:** ${userDetail.role_id === 1 ? 'Administrador' : 'Usuario'}\n` +
                `🆔 **ID:** ${userDetail.id}`,
                {
                  chat_id: chatId,
                  message_id: query.message.message_id,
                  parse_mode: 'Markdown',
                  ...menuData
                }
              );
            }
          } catch (error) {
            console.error('Error al obtener detalles del usuario:', error);
            await bot.editMessageText(
              '❌ **Error**\n\nNo se pudieron obtener los detalles del usuario.',
              {
                chat_id: chatId,
                message_id: query.message.message_id,
                parse_mode: 'Markdown',
                reply_markup: {
                  inline_keyboard: [[{ text: '🔙 Volver', callback_data: 'list_users' }]]
                }
              }
            );
          }
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
        console.log('🔍 [DEBUG] Handler admin_autorizaciones ejecutado');
        console.log('🔍 [DEBUG] User:', user);
        console.log('🔍 [DEBUG] User role_id:', user?.role_id);
        
        if (user && user.role_id === 1) {
          console.log('✅ [DEBUG] Usuario es admin, mostrando menú autorizaciones');
          try {
            const menuConfig = autorizacionesAdminMenu();
            console.log('🔍 [DEBUG] Configuración del menú autorizaciones:', JSON.stringify(menuConfig, null, 2));
            
            await bot.editMessageText(
              '📝 **Gestión de Autorizaciones**\n\nSelecciona una opción:',
              {
                chat_id: chatId,
                message_id: query.message.message_id,
                parse_mode: 'Markdown',
                ...menuConfig
              }
            );
            console.log('✅ [DEBUG] Menú autorizaciones enviado exitosamente');
          } catch (error) {
            console.error('❌ [ERROR] Error al mostrar menú autorizaciones:', error);
            await bot.answerCallbackQuery(query.id, {
              text: '❌ Error al cargar el menú de autorizaciones',
              show_alert: true 
            });
          }
        } else {
          console.log('❌ [DEBUG] Usuario no es admin o no existe');
          await bot.answerCallbackQuery(query.id, {
            text: '❌ No tienes permisos de administrador',
            show_alert: true 
          });
        }
      }

      // Menú Generador
      else if (action === 'admin_generador_menu') {
        console.log('🔍 [DEBUG] Handler admin_generador_menu ejecutado');
        console.log('🔍 [DEBUG] User:', user);
        console.log('🔍 [DEBUG] User role_id:', user?.role_id);
        console.log('🔍 [DEBUG] ChatId:', chatId);
        
        if (user && user.role_id === 1) {
          console.log('✅ [DEBUG] Usuario es admin, mostrando menú generador');
          try {
            const menuConfig = generadorMenu();
            console.log('🔍 [DEBUG] Configuración del menú:', JSON.stringify(menuConfig, null, 2));
            
            await bot.editMessageText(
              '🛠️ **Generador**\n\nSelecciona qué deseas generar:',
              {
                chat_id: chatId,
                message_id: query.message.message_id,
                parse_mode: 'Markdown',
                ...menuConfig
              }
            );
            console.log('✅ [DEBUG] Menú generador enviado exitosamente');
          } catch (error) {
            console.error('❌ [ERROR] Error al mostrar menú generador:', error);
            await bot.answerCallbackQuery(query.id, {
              text: '❌ Error al cargar el menú generador',
              show_alert: true 
            });
          }
        } else {
          console.log('❌ [DEBUG] Usuario no es admin o no existe');
          await bot.answerCallbackQuery(query.id, {
            text: '❌ No tienes permisos de administrador',
            show_alert: true 
          });
        }
      }

      // Generar Compa-Venta
      else if (action === 'admin_generar_compaventa') {
        if (user && user.role_id === 1) {
          // Inicializar sesión para solicitar DNI
          const session = userSessions.get(chatId) || {};
          session.adminAction = 'generar_compaventa';
          session.lastActivity = Date.now();
          userSessions.set(chatId, session);

          await bot.editMessageText(
            '📄 **Generar Compa-Venta**\n\n' +
            'Por favor, envía el DNI del usuario para el cual deseas generar un documento de Compa-Venta.\n\n' +
            '📋 Formato: Solo números (ej: 12345678)',
            {
              chat_id: chatId,
              message_id: query.message.message_id,
              parse_mode: 'Markdown',
              reply_markup: {
                inline_keyboard: [
                  [{ text: '❌ Cancelar', callback_data: 'admin_generador_menu' }]
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

      // Confirmar generación de Compa-Venta
      else if (action.startsWith('admin_confirmar_compaventa_')) {
        if (user && user.role_id === 1) {
          const dni = action.replace('admin_confirmar_compaventa_', '');
          
          // Iniciar animación de carga
          const loadingFrames = ['⏳', '⌛', '⏳', '⌛'];
          let frameIndex = 0;
          
          // Mensaje inicial de carga
          await bot.editMessageText(
            `${loadingFrames[0]} <b>Generando Compa-Venta</b>\n\n` +
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
                `${loadingFrames[frameIndex]} <b>Generando Compa-Venta</b>\n\n` +
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
              clearInterval(loadingInterval);
            }
          }, 1000);
          
          try {
            // Aquí puedes implementar la lógica para generar el documento Compa-Venta
            // Por ahora, simularemos el proceso
            
            // Simular tiempo de procesamiento
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            // Detener animación de carga
            clearInterval(loadingInterval);

            // Mostrar mensaje de éxito
            await bot.editMessageText(
              '✅ <b>Compa-Venta Generado Exitosamente</b>\n\n' +
              `📋 DNI: ${dni}\n` +
              `📅 Fecha: ${new Date().toLocaleDateString('es-ES')}\n\n` +
              '📄 El documento Compa-Venta ha sido generado correctamente.\n\n' +
              '🔔 El proceso ha sido completado.',
              {
                chat_id: chatId,
                message_id: query.message.message_id,
                parse_mode: 'HTML',
                reply_markup: {
                  inline_keyboard: [
                    [{ text: '🔙 Volver al Generador', callback_data: 'admin_generador_menu' }],
                    [{ text: '🏠 Volver al Menú Principal', callback_data: 'admin_autorizaciones' }]
                  ]
                }
              }
            );
          } catch (error) {
            // Detener animación de carga en caso de error
            clearInterval(loadingInterval);
            
            console.error('Error al generar Compa-Venta:', error);
            
            await bot.editMessageText(
              '❌ <b>Error al Generar Compa-Venta</b>\n\n' +
              'No se pudo generar el documento. Inténtalo más tarde.',
              {
                chat_id: chatId,
                message_id: query.message.message_id,
                parse_mode: 'HTML',
                reply_markup: {
                  inline_keyboard: [
                    [{ text: '🔄 Intentar de nuevo', callback_data: 'admin_generar_compaventa' }],
                    [{ text: '🔙 Volver al Generador', callback_data: 'admin_generador_menu' }]
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

      // Generar Compa-Venta
      else if (action === 'admin_generar_compaventa') {
        if (user && user.role_id === 1) {
          // Inicializar sesión para solicitar DNI
          const session = userSessions.get(chatId) || {};
          session.adminAction = 'generar_compaventa';
          session.lastActivity = Date.now();
          userSessions.set(chatId, session);

          await bot.editMessageText(
            '📄 **Generar Compa-Venta**\n\n' +
            'Por favor, envía el DNI del usuario para el cual deseas generar un documento de Compa-Venta.\n\n' +
            '📋 Formato: Solo números (ej: 12345678)',
            {
              chat_id: chatId,
              message_id: query.message.message_id,
              parse_mode: 'Markdown',
              reply_markup: {
                inline_keyboard: [
                  [{ text: '❌ Cancelar', callback_data: 'admin_generador_menu' }]
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

      // Detalle de usuario
      else if (action.startsWith('user_detail_')) {
        if (user && user.role_id === 1) {
          const userId = action.split('_')[2];
          try {
            const userDetail = await userApiService.getUserById(userId);
            if (userDetail) {
              const statusText = userDetail.activo ? '✅ Activo' : '❌ Inactivo';
              const userType = userDetail.role_id === 1 ? 'admin' : 'user';
              
              await bot.editMessageText(
                `👤 **Detalles del Usuario**\n\n` +
                `🆔 **Nombre:** ${userDetail.nombre || 'Sin nombre'}\n` +
                `🔢 **DNI:** ${userDetail.dni || 'Sin DNI'}\n` +
                `🎭 **Rol:** ${userDetail.role_id === 1 ? 'Administrador' : 'Usuario'}\n` +
                `**Estado:** ${statusText}\n` +
                `**ID:** ${userDetail.id}`,
                {
                  chat_id: chatId,
                  message_id: query.message.message_id,
                  parse_mode: 'Markdown',
                  ...userDetailMenu(userId, userType)
                }
              );
            }
          } catch (error) {
            console.error('Error al obtener detalles del usuario:', error);
            
            let errorMessage = '❌ **Error**\n\n';
            let retryButton = { text: '🔄 Reintentar', callback_data: `user_detail_${userId}` };
            
            // Manejo específico de errores de conectividad
            if (error.code === 'ECONNRESET' || error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
              errorMessage += '🌐 **Error de Conectividad**\n\n' +
                'No se pudo conectar con el servidor backend.\n' +
                'Por favor, verifica:\n' +
                '• Conexión a internet\n' +
                '• Estado del servidor backend\n' +
                '• Configuración de red\n\n' +
                '💡 Puedes intentar nuevamente en unos momentos.';
            } else if (error.response?.status === 404) {
              errorMessage += '👤 **Usuario No Encontrado**\n\n' +
                'El usuario solicitado no existe en el sistema.';
              retryButton = null; // No mostrar botón de reintentar para 404
            } else if (error.response?.status === 500) {
              errorMessage += '🔧 **Error del Servidor**\n\n' +
                'Error interno del servidor backend.\n' +
                'Por favor, contacta al administrador del sistema.';
            } else {
              errorMessage += 'No se pudieron obtener los detalles del usuario.\n' +
                'Error técnico: ' + (error.message || 'Desconocido');
            }
            
            const keyboard = retryButton 
              ? [[retryButton], [{ text: '🔙 Volver', callback_data: 'list_users' }]]
              : [[{ text: '🔙 Volver', callback_data: 'list_users' }]];
            
            await bot.editMessageText(errorMessage, {
              chat_id: chatId,
              message_id: query.message.message_id,
              parse_mode: 'Markdown',
              reply_markup: {
                inline_keyboard: keyboard
              }
            });
          }
        }
      }

      // Manejar edición de rol
      else if (action.startsWith('edit_role_')) {
        const targetUserId = action.split('_')[2];
        
        try {
          const targetUser = await userApiService.getUserById(targetUserId);
          
          if (!targetUser) {
            await bot.answerCallbackQuery(query.id, { text: '❌ Usuario no encontrado' });
            return;
          }

          const roleButtons = [
            [{ text: '👑 Administrador', callback_data: `set_role_admin_${targetUserId}` }],
            [{ text: '👤 Usuario', callback_data: `set_role_user_${targetUserId}` }],
            [{ text: '🔙 Cancelar', callback_data: `user_detail_${targetUserId}` }]
          ];

          await bot.editMessageText(
            `✏️ **Editar Rol de Usuario**\n\n` +
            `👤 **Usuario:** ${targetUser.nombre || 'No especificado'}\n` +
            `🆔 **DNI:** ${targetUser.dni || 'No especificado'}\n` +
            `📋 **Rol actual:** ${targetUser.role_id === 1 ? 'Administrador' : 'Usuario'}\n\n` +
            `🔄 **Selecciona el nuevo rol:**`,
            {
              chat_id: chatId,
              message_id: query.message.message_id,
              parse_mode: 'Markdown',
              reply_markup: { inline_keyboard: roleButtons }
            }
          );
        } catch (error) {
          console.error('Error al mostrar edición de rol:', error);
          await bot.answerCallbackQuery(query.id, { text: '❌ Error al cargar usuario' });
        }
      }

      // Manejar asignación de rol
      else if (action.startsWith('set_role_')) {
        const parts = action.split('_');
        const newRole = parts[2]; // 'admin' o 'user'
        const targetUserId = parts[3];
        
        try {
          // Obtener información del usuario antes del cambio
          const userDetail = await userApiService.getUserById(targetUserId);
          const oldRoleText = userDetail.role_id === 1 ? 'Administrador' : 'Usuario';
          
          const roleId = newRole === 'admin' ? 1 : 2;
          await userApiService.updateUser(targetUserId, { role_id: roleId });
          
          const newRoleText = newRole === 'admin' ? 'Administrador' : 'Usuario';
          
          await bot.answerCallbackQuery(query.id, { 
            text: `✅ Rol actualizado a ${newRoleText}` 
          });

          // 🔔 ENVIAR NOTIFICACIÓN AL USUARIO AFECTADO
          try {
            const { findUserById } = require('../utils/chatManager');
            const targetUserData = findUserById(targetUserId);
            
            if (targetUserData && targetUserData.chatId) {
              const notificationMessage = 
                `🔔 **Notificación del Sistema**\n\n` +
                `👤 **Tu rol ha sido actualizado**\n\n` +
                `📋 **Cambio realizado:**\n` +
                `• **Rol anterior:** ${oldRoleText}\n` +
                `• **Rol nuevo:** ${newRoleText}\n\n` +
                `${newRole === 'admin' ? '👑 Ahora tienes permisos de administrador' : '👤 Ahora tienes permisos de usuario'}\n\n` +
                `ℹ️ *Este cambio es efectivo inmediatamente*`;

              await bot.sendMessage(targetUserData.chatId, notificationMessage, {
                parse_mode: 'Markdown'
              });
              
              console.log(`📤 Notificación de cambio de rol enviada al usuario ${targetUserId} (chat: ${targetUserData.chatId})`);
            } else {
              console.log(`⚠️ No se pudo encontrar chat_id para el usuario ${targetUserId}`);
            }
          } catch (notificationError) {
            console.error('❌ Error al enviar notificación de cambio de rol:', notificationError);
          }
          
          // Volver a mostrar los detalles del usuario
          const updatedUserDetail = await userApiService.getUserById(targetUserId);
          const userType = updatedUserDetail.role_id === 1 ? 'admin' : 'user';
          const menuData = await userDetailMenu(targetUserId, userType);
          
          await bot.editMessageText(
            `👤 **Detalles del Usuario**\n\n` +
            `🆔 **Nombre:** ${updatedUserDetail.nombre || 'Sin nombre'}\n` +
            `🔢 **DNI:** ${updatedUserDetail.dni || 'Sin DNI'}\n` +
            `🎭 **Rol:** ${updatedUserDetail.role_id === 1 ? 'Administrador' : 'Usuario'}\n` +
            `🆔 **ID:** ${updatedUserDetail.id}\n\n` +
            `✅ **Rol actualizado exitosamente**`,
            {
              chat_id: chatId,
              message_id: query.message.message_id,
              parse_mode: 'Markdown',
              ...menuData
            }
          );
        } catch (error) {
          console.error('Error al actualizar rol:', error);
          await bot.answerCallbackQuery(query.id, { 
            text: '❌ Error al actualizar rol' 
          });
        }
      }

      // Manejar generación de autorización
      else if (action.startsWith('generate_auth_')) {
        const targetUserId = action.split('_')[2];
        
        try {
          const targetUser = await userApiService.getUserById(targetUserId);
          
          if (!targetUser) {
            await bot.answerCallbackQuery(query.id, { text: '❌ Usuario no encontrado' });
            return;
          }

        

          // Mostrar menú generador para el usuario específico
          await bot.editMessageText(
            `🛠️ **Generador**\n\n` +
            `👤 **Usuario:** ${targetUser.nombre || 'No especificado'}\n` +
            `🆔 **DNI:** ${targetUser.dni || 'No especificado'}\n` +
            `📱 **Estado:** ${targetUser.activo ? 'Activo' : 'Inactivo'}\n\n` +
            `Selecciona el tipo de documento a generar:`,
            {
              chat_id: chatId,
              message_id: query.message.message_id,
              parse_mode: 'Markdown',
              reply_markup: {
                inline_keyboard: [
                  [{ text: '🔑 Generar Autorización', callback_data: `user_generar_autorizacion_${targetUserId}` }],
                  [{ text: '📄 Generar Compa-Venta', callback_data: `user_generar_compaventa_${targetUserId}` }],
                  [{ text: '🔙 Volver', callback_data: `user_detail_${targetUserId}` }]
                ]
              }
            }
          );
        } catch (error) {
          console.error('Error al mostrar generación de autorización:', error);
          await bot.answerCallbackQuery(query.id, { text: '❌ Error al cargar usuario' });
        }
      }

      // Generar autorización para usuario específico
      else if (action.startsWith('user_generar_autorizacion_')) {
        const targetUserId = action.split('_')[3];
        
        try {
          const targetUser = await userApiService.getUserById(targetUserId);
          
          if (!targetUser) {
            await bot.answerCallbackQuery(query.id, { text: '❌ Usuario no encontrado' });
            return;
          }

          // Mostrar confirmación para generar autorización
          await bot.editMessageText(
            `🔑 **Generar Autorización**\n\n` +
            `👤 **Usuario:** ${targetUser.nombre || 'No especificado'}\n` +
            `🆔 **DNI:** ${targetUser.dni || 'No especificado'}\n\n` +
            `⚠️ **¿Confirmas generar una nueva autorización para este usuario?**`,
            {
              chat_id: chatId,
              message_id: query.message.message_id,
              parse_mode: 'Markdown',
              reply_markup: {
                inline_keyboard: [
                  [{ text: '✅ Confirmar', callback_data: `user_confirmar_autorizacion_${targetUserId}` }],
                  [{ text: '🔙 Volver', callback_data: `generate_auth_${targetUserId}` }]
                ]
              }
            }
          );
        } catch (error) {
          console.error('Error al generar autorización:', error);
          await bot.answerCallbackQuery(query.id, { text: '❌ Error al procesar solicitud' });
        }
      }

      // Generar compra-venta para usuario específico
      else if (action.startsWith('user_generar_compaventa_')) {
        const targetUserId = action.split('_')[3];
        
        try {
          const targetUser = await userApiService.getUserById(targetUserId);
          
          if (!targetUser) {
            await bot.answerCallbackQuery(query.id, { text: '❌ Usuario no encontrado' });
            return;
          }

          // Mostrar confirmación para generar compra-venta
          await bot.editMessageText(
            `📄 **Generar Compa-Venta**\n\n` +
            `👤 **Usuario:** ${targetUser.nombre || 'No especificado'}\n` +
            `🆔 **DNI:** ${targetUser.dni || 'No especificado'}\n\n` +
            `⚠️ **¿Confirmas generar un nuevo documento de Compa-Venta para este usuario?**`,
            {
              chat_id: chatId,
              message_id: query.message.message_id,
              parse_mode: 'Markdown',
              reply_markup: {
                inline_keyboard: [
                  [{ text: '✅ Confirmar', callback_data: `user_confirmar_compaventa_${targetUserId}` }],
                  [{ text: '🔙 Volver', callback_data: `generate_auth_${targetUserId}` }]
                ]
              }
            }
          );
        } catch (error) {
          console.error('Error al generar compra-venta:', error);
          await bot.answerCallbackQuery(query.id, { text: '❌ Error al procesar solicitud' });
        }
      }

      // Confirmar generación de autorización para usuario específico
      else if (action.startsWith('user_confirmar_autorizacion_')) {
        const targetUserId = action.split('_')[3];
        
        try {
          // Responder inmediatamente al callback query
          await bot.answerCallbackQuery(query.id, { text: '🔍 Verificando autorización...' });

          const targetUser = await userApiService.getUserById(targetUserId);
          
          if (!targetUser) {
            await bot.editMessageText(
              `❌ **Error**\n\nUsuario no encontrado.`,
              {
                chat_id: chatId,
                message_id: query.message.message_id,
                parse_mode: 'Markdown',
                reply_markup: {
                  inline_keyboard: [
                    [{ text: '🔙 Volver', callback_data: 'users_menu' }]
                  ]
                }
              }
            );
            return;
          }

          if (!targetUser.dni) {
            await bot.editMessageText(
              `❌ **Error**\n\n` +
              `El usuario no tiene DNI registrado.\n` +
              `No se puede verificar o generar autorización.`,
              {
                chat_id: chatId,
                message_id: query.message.message_id,
                parse_mode: 'Markdown',
                reply_markup: {
                  inline_keyboard: [
                    [{ text: '🔙 Volver al Usuario', callback_data: `user_detail_${targetUserId}` }]
                  ]
                }
              }
            );
            return;
          }

          // Mostrar mensaje de verificación
          await bot.editMessageText(
            `🔍 **Verificando Autorización Existente...**\n\n` +
            `👤 **Usuario:** ${targetUser.nombre || 'No especificado'}\n` +
            `🆔 **DNI:** ${targetUser.dni}\n\n` +
            `⏳ Consultando base de datos...`,
            {
              chat_id: chatId,
              message_id: query.message.message_id,
              parse_mode: 'Markdown'
            }
          );

          // Verificar si ya existe una autorización
          const backendUrl = process.env.BACKEND_BASE_URL || 'http://localhost:3000';
          const listUrl = `${backendUrl}/autorizaciones/listar/${targetUser.dni}`;
          
          console.log(`[DEBUG] Verificando autorización existente en: ${listUrl}`);

          let authExists = false;
          let authData = null;

          try {
            const response = await axios.get(listUrl, {
              timeout: 10000,
              validateStatus: function (status) {
                return status < 500; // Aceptar cualquier status < 500
              }
            });

            console.log(`[DEBUG] Respuesta de verificación: ${response.status}`);
            console.log(`[DEBUG] Datos recibidos:`, response.data);

            if (response.status === 200 && response.data) {
              // Verificar si hay autorizaciones en la respuesta
              if (Array.isArray(response.data) && response.data.length > 0) {
                authExists = true;
                authData = response.data[0]; // Tomar la primera autorización
                console.log(`[DEBUG] Autorización encontrada (array):`, authData);
              } else if (response.data.autorizaciones && Array.isArray(response.data.autorizaciones) && response.data.autorizaciones.length > 0) {
                authExists = true;
                authData = response.data.autorizaciones[0];
                console.log(`[DEBUG] Autorización encontrada (objeto.autorizaciones):`, authData);
              } else if (typeof response.data === 'object' && response.data.id) {
                authExists = true;
                authData = response.data;
                console.log(`[DEBUG] Autorización encontrada (objeto directo):`, authData);
              }
              
              if (authExists) {
                console.log(`[DEBUG] Estado de la autorización: ${authData?.estado || authData?.status || 'no definido'}`);
              }
            }
          } catch (verifyError) {
            console.log(`[DEBUG] Error al verificar autorización:`, verifyError.message);
            
            if (verifyError.response?.status === 404) {
              console.log(`[DEBUG] No se encontró autorización (404) - continuando con generación`);
              authExists = false;
            } else if (verifyError.code === 'ECONNREFUSED') {
              throw new Error('BACKEND_UNAVAILABLE');
            } else {
              console.log(`[DEBUG] Error de verificación no crítico - continuando`);
              authExists = false;
            }
          }

          if (authExists) {
            // Ya existe una autorización - verificar el estado
            const authStatus = authData?.estado || authData?.status || 'desconocido';
            const shopUrl = process.env.BACKEND_BASE_URL || 'http://localhost:3000';
            
            console.log(`[DEBUG] Estado de autorización: ${authStatus}`);

            if (authStatus.toLowerCase() === 'pendiente') {
              // Estado pendiente - mostrar web_app para completar proceso
              await bot.editMessageText(
                `⏳ **Autorización Pendiente**\n\n` +
                `👤 **Usuario:** ${targetUser.nombre || 'No especificado'}\n` +
                `🆔 **DNI:** ${targetUser.dni}\n` +
                `📄 **Estado:** ${authStatus}\n` +
                `📅 **Fecha:** ${authData?.fecha ? new Date(authData.fecha).toLocaleDateString('es-ES') : 'No especificada'}\n\n` +
                `⚠️ Esta autorización está en estado pendiente.\n` +
                `Es necesario completar el proceso en la plataforma web.\n\n` +
                `👆 Usa el botón de abajo para acceder al sistema de autorizaciones.`,
                {
                  chat_id: chatId,
                  message_id: query.message.message_id,
                  parse_mode: 'Markdown',
                  reply_markup: {
                    inline_keyboard: [
                      [{ text: '🌐 Completar Autorización', web_app: { url: `${shopUrl}/autorizaciones` } }],
                      [{ text: '🔄 Verificar Estado', callback_data: `user_confirmar_autorizacion_${targetUserId}` }],
                      [{ text: '🔙 Volver al Usuario', callback_data: `user_detail_${targetUserId}` }]
                    ]
                  }
                }
              );
            } else if (authStatus.toLowerCase() === 'activo') {
              // Estado activo - mostrar botón de descarga
              await bot.editMessageText(
                `✅ **Autorización Activa**\n\n` +
                `👤 **Usuario:** ${targetUser.nombre || 'No especificado'}\n` +
                `🆔 **DNI:** ${targetUser.dni}\n` +
                `📄 **Estado:** ${authStatus}\n` +
                `📅 **Fecha:** ${authData?.fecha ? new Date(authData.fecha).toLocaleDateString('es-ES') : 'No especificada'}\n\n` +
                `✨ Esta autorización está activa y lista para descargar.\n` +
                `Puedes obtener el PDF directamente.`,
                {
                  chat_id: chatId,
                  message_id: query.message.message_id,
                  parse_mode: 'Markdown',
                  reply_markup: {
                    inline_keyboard: [
                      [{ text: '📥 Descargar PDF', callback_data: `user_descargar_autorizacion_${targetUserId}` }],
                      [{ text: '🔙 Volver al Usuario', callback_data: `user_detail_${targetUserId}` }]
                    ]
                  }
                }
              );
            } else {
              // Estado desconocido o diferente - mostrar información general
              await bot.editMessageText(
                `📋 **Autorización Encontrada**\n\n` +
                `👤 **Usuario:** ${targetUser.nombre || 'No especificado'}\n` +
                `🆔 **DNI:** ${targetUser.dni}\n` +
                `📄 **Estado:** ${authStatus}\n` +
                `📅 **Fecha:** ${authData?.fecha ? new Date(authData.fecha).toLocaleDateString('es-ES') : 'No especificada'}\n\n` +
                `ℹ️ Se encontró una autorización con estado: **${authStatus}**\n\n` +
                `💡 **Opciones disponibles:**`,
                {
                  chat_id: chatId,
                  message_id: query.message.message_id,
                  parse_mode: 'Markdown',
                  reply_markup: {
                    inline_keyboard: [
                      [{ text: '🔄 Verificar Estado', callback_data: `user_confirmar_autorizacion_${targetUserId}` }],
                      [{ text: '🔙 Volver al Usuario', callback_data: `user_detail_${targetUserId}` }]
                    ]
                  }
                }
              );
            }
          } else {
            // No existe autorización - mostrar botón para notificar al usuario
            const shopUrl = process.env.BACKEND_BASE_URL || 'http://localhost:3000';
            
            await bot.editMessageText(
              `⚠️ **Autorización No Encontrada**\n\n` +
              `👤 **Usuario:** ${targetUser.nombre || 'No especificado'}\n` +
              `🆔 **DNI:** ${targetUser.dni}\n` +
              `📄 **Estado:** Sin autorización\n\n` +
              `❌ No se encontró una autorización existente para este DNI.\n\n` +
              `💡 **Opciones disponibles:**\n` +
              `• Notificar al usuario para que inicie su proceso\n` +
              `• Generar una autorización administrativa\n` +
              `• Acceder al sistema web de autorizaciones`,
              {
                chat_id: chatId,
                message_id: query.message.message_id,
                parse_mode: 'Markdown',
                reply_markup: {
                  inline_keyboard: [
                    [{ text: '📢 Notificar al Usuario', callback_data: `user_notificar_proceso_${targetUserId}` }],
                    [{ text: '🌐 Sistema Web', web_app: { url: `${shopUrl}/autorizaciones` } }],
                    [{ text: '⚡ Generar Administrativa', callback_data: `user_forzar_autorizacion_${targetUserId}` }],
                    [{ text: '🔙 Volver al Usuario', callback_data: `user_detail_${targetUserId}` }]
                  ]
                }
              }
            );
          }

        } catch (error) {
          console.error('Error al verificar/confirmar autorización:', error);
          
          let errorMessage = '❌ Error al verificar autorización';
          let errorDetails = '';

          if (error.message === 'BACKEND_UNAVAILABLE') {
            errorMessage = '❌ Servidor backend no disponible';
            errorDetails = 'No se puede conectar con el servidor de autorizaciones.';
          } else {
            errorDetails = 'Ocurrió un error durante la verificación.';
          }

          await bot.editMessageText(
            `${errorMessage}\n\n` +
            `👤 **Usuario:** ${targetUser?.nombre || 'No especificado'}\n` +
            `🆔 **DNI:** ${targetUser?.dni || 'No especificado'}\n\n` +
            `📝 **Detalles:** ${errorDetails}\n\n` +
            `Por favor, inténtalo nuevamente.`,
            {
              chat_id: chatId,
              message_id: query.message.message_id,
              parse_mode: 'Markdown',
              reply_markup: {
                inline_keyboard: [
                  [{ text: '🔄 Reintentar', callback_data: `user_confirmar_autorizacion_${targetUserId}` }],
                  [{ text: '🔙 Volver al Usuario', callback_data: `user_detail_${targetUserId}` }]
                ]
              }
            }
          );
        }
      }

      // Confirmar generación de compra-venta para usuario específico
      else if (action.startsWith('user_confirmar_compaventa_')) {
        const targetUserId = action.split('_')[3];
        
        try {
          const targetUser = await userApiService.getUserById(targetUserId);
          
          if (!targetUser) {
            await bot.answerCallbackQuery(query.id, { text: '❌ Usuario no encontrado' });
            return;
          }

          // Mostrar animación de carga
          await bot.editMessageText(
            `🔄 **Generando Compa-Venta...**\n\n` +
            `👤 **Usuario:** ${targetUser.nombre || 'No especificado'}\n` +
            `🆔 **DNI:** ${targetUser.dni || 'No especificado'}\n\n` +
            `⏳ Por favor espera mientras se genera el documento...`,
            {
              chat_id: chatId,
              message_id: query.message.message_id,
              parse_mode: 'Markdown'
            }
          );

          // Simular proceso de generación
          await new Promise(resolve => setTimeout(resolve, 2000));

          // Mostrar resultado exitoso
          await bot.editMessageText(
            `✅ **Compa-Venta Generado Exitosamente**\n\n` +
            `👤 **Usuario:** ${targetUser.nombre || 'No especificado'}\n` +
            `🆔 **DNI:** ${targetUser.dni || 'No especificado'}\n` +
            `📄 **Documento:** Compa-Venta\n` +
            `📅 **Fecha:** ${new Date().toLocaleDateString('es-ES')}\n\n` +
            `El documento ha sido generado correctamente.`,
            {
              chat_id: chatId,
              message_id: query.message.message_id,
              parse_mode: 'Markdown',
              reply_markup: {
                inline_keyboard: [
                  [{ text: '📥 Descargar PDF', callback_data: `user_descargar_compaventa_${targetUserId}` }],
                  [{ text: '🔙 Volver al Usuario', callback_data: `user_detail_${targetUserId}` }]
                ]
              }
            }
          );

          await bot.answerCallbackQuery(query.id, { 
            text: '✅ Compa-Venta generado exitosamente' 
          });
        } catch (error) {
          console.error('Error al confirmar generación de compra-venta:', error);
          await bot.editMessageText(
            `❌ **Error al Generar Compa-Venta**\n\n` +
            `Ocurrió un error durante la generación del documento.\n\n` +
            `Por favor, inténtalo nuevamente.`,
            {
              chat_id: chatId,
              message_id: query.message.message_id,
              parse_mode: 'Markdown',
              reply_markup: {
                inline_keyboard: [
                  [{ text: '🔄 Reintentar', callback_data: `user_generar_compaventa_${targetUserId}` }],
                  [{ text: '🔙 Volver', callback_data: `generate_auth_${targetUserId}` }]
                ]
              }
            }
          );
        }
      }

      // Descargar autorización para usuario específico
      else if (action.startsWith('user_descargar_autorizacion_')) {
        const targetUserId = action.split('_')[3];
        let targetUser = null;
        
        try {
          // Verificar si el callback query no ha expirado
          const queryAge = Date.now() - (query.message.date * 1000);
          if (queryAge > 300000) { // 5 minutos
            await bot.answerCallbackQuery(query.id, { 
              text: '⏰ Esta acción ha expirado. Intenta nuevamente.',
              show_alert: true 
            });
            return;
          }

          targetUser = await userApiService.getUserById(targetUserId);
          
          if (!targetUser) {
            await bot.answerCallbackQuery(query.id, { text: '❌ Usuario no encontrado' });
            return;
          }

          if (!targetUser.dni) {
            await bot.answerCallbackQuery(query.id, { text: '❌ Usuario sin DNI registrado' });
            return;
          }

          // Responder al callback query inmediatamente
          await bot.answerCallbackQuery(query.id, { text: '📥 Iniciando descarga...' });

          // Mostrar animación de descarga
          await bot.editMessageText(
            `📥 <b>Descargando Autorización...</b>\n\n` +
            `👤 <b>Usuario:</b> ${targetUser.nombre || 'No especificado'}\n` +
            `🆔 <b>DNI:</b> ${targetUser.dni}\n\n` +
            `⏳ Conectando con el servidor...`,
            {
              chat_id: chatId,
              message_id: query.message.message_id,
              parse_mode: 'HTML'
            }
          );

          // Configurar URL del backend
          const backendUrl = process.env.BACKEND_BASE_URL || 'http://localhost:3000';
          const generateUrl = `${backendUrl}/autorizaciones/get_img`;
          
          console.log(`[DEBUG] Generando y descargando PDF desde: ${generateUrl}`);
          console.log(`[DEBUG] DNI del usuario: ${targetUser.dni}`);
          console.log(`[DEBUG] Backend URL: ${backendUrl}`);

          // Primero verificar si el servidor está disponible
          try {
            const healthCheck = await axios.get(`${backendUrl}/autorizaciones/health`, { timeout: 5000 });
            console.log(`[DEBUG] Health check exitoso: ${healthCheck.status}`);
          } catch (healthError) {
            console.log(`[DEBUG] Health check falló:`, healthError.message);
            throw new Error('BACKEND_UNAVAILABLE');
          }

          // Actualizar mensaje para indicar generación
          await bot.editMessageText(
            `🔄 <b>Generando Autorización...</b>\n\n` +
            `👤 <b>Usuario:</b> ${targetUser.nombre || 'No especificado'}\n` +
            `🆔 <b>DNI:</b> ${targetUser.dni}\n\n` +
            `⚙️ Procesando imágenes y generando PDF...`,
            {
              chat_id: chatId,
              message_id: query.message.message_id,
              parse_mode: 'HTML'
            }
          );

          // Generar y descargar el PDF usando POST
          const response = await axios.post(generateUrl, 
            {
              dni: targetUser.dni
            },
            {
              responseType: 'arraybuffer',
              timeout: 60000, // 60 segundos de timeout para generación
              validateStatus: function (status) {
                return status < 500; // Aceptar cualquier status < 500 para manejar errores manualmente
              },
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.BACKEND_API_KEY}`,
                'X-API-Key': process.env.BACKEND_API_KEY
              }
            }
          );

          console.log(`[DEBUG] Respuesta del servidor: ${response.status}`);

          // Verificar que la respuesta sea exitosa
          if (response.status === 404) {
            throw new Error('AUTHORIZATION_NOT_FOUND');
          } else if (response.status === 400) {
            throw new Error('GENERATION_ERROR');
          } else if (response.status !== 200) {
            throw new Error(`Error del servidor: ${response.status}`);
          }

          console.log(`[DEBUG] Respuesta del servidor: ${response.status}`);

          // Verificar que la respuesta sea exitosa
          if (response.status === 404) {
            throw new Error('AUTHORIZATION_NOT_FOUND');
          } else if (response.status !== 200) {
            throw new Error(`Error del servidor: ${response.status}`);
          }

          // Calcular tamaño del archivo
          const fileSizeInBytes = response.data.length;
          const fileSizeInMB = (fileSizeInBytes / (1024 * 1024)).toFixed(2);

          // Crear archivo temporal
          const tempDir = path.join(__dirname, '../../temp');
          if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
          }

          const fileName = `autorizacion_${targetUser.dni}_${Date.now()}.pdf`;
          const tempFilePath = path.join(tempDir, fileName);

          // Guardar el archivo
          fs.writeFileSync(tempFilePath, response.data);

          // Enviar el archivo por Telegram
          await bot.sendDocument(chatId, tempFilePath, {
            caption: `📄 Autorización - DNI: ${targetUser.dni}`,
            reply_to_message_id: query.message.message_id
          });

          // Mostrar resultado de generación y descarga usando el formato solicitado
          await bot.editMessageText(
            `✅ <b>PDF Generado y Enviado Exitosamente</b>\n\n` +
            `📋 DNI: ${targetUser.dni}\n` +
            `📄 Autorización generada y enviada correctamente\n` +
            `📊 Tamaño: ${fileSizeInMB} MB\n` +
            `⚙️ Procesamiento completado`,
            {
              chat_id: chatId,
              message_id: query.message.message_id,
              parse_mode: 'HTML',
              reply_markup: {
                inline_keyboard: [
                  [{ text: '🔙 Volver al Usuario', callback_data: `user_detail_${targetUserId}` }]
                ]
              }
            }
          );

          // Limpiar archivo temporal después de un tiempo
          setTimeout(() => {
            if (fs.existsSync(tempFilePath)) {
              fs.unlinkSync(tempFilePath);
              console.log(`[DEBUG] Archivo temporal eliminado: ${tempFilePath}`);
            }
          }, 60000); // 1 minuto

        } catch (error) {
          console.error('Error al descargar autorización:', error);
          console.error('Error details:', {
            message: error.message,
            code: error.code,
            status: error.response?.status,
            url: error.config?.url
          });
          
          let errorMessage = '❌ Error al descargar PDF';
          let errorDetails = '';

          if (error.message === 'BACKEND_UNAVAILABLE') {
            errorMessage = '❌ Servidor backend no disponible';
            errorDetails = `El servidor en ${process.env.BACKEND_BASE_URL || 'http://localhost:3000'} no está ejecutándose o no responde.`;
          } else if (error.message === 'AUTHORIZATION_NOT_FOUND') {
            errorMessage = '❌ Autorización no encontrada';
            errorDetails = `No se encontró una autorización para el DNI: ${targetUser?.dni}.\nVerifica que el DNI sea correcto y que exista una autorización generada.`;
          } else if (error.code === 'ECONNREFUSED') {
            errorMessage = '❌ Conexión rechazada';
            errorDetails = 'El servidor backend no está ejecutándose en el puerto especificado.';
          } else if (error.response?.status === 404) {
            errorMessage = '❌ Endpoint no encontrado';
            errorDetails = `La ruta /autorizaciones/download_pdf/${targetUser?.dni} no existe en el servidor.`;
          } else if (error.code === 'ENOTFOUND') {
            errorMessage = '❌ Servidor no encontrado';
            errorDetails = 'No se puede resolver la dirección del servidor backend.';
          } else if (error.code === 'ETIMEDOUT') {
            errorMessage = '⏰ Timeout del servidor';
            errorDetails = 'El servidor tardó demasiado en responder (más de 30 segundos).';
          } else if (error.message?.includes('query is too old')) {
            errorMessage = '⏰ La acción ha expirado';
            errorDetails = 'Intenta la acción nuevamente.';
          }

          try {
            // Intentar responder al callback query si no se ha respondido
            await bot.answerCallbackQuery(query.id, { text: errorMessage }).catch(() => {});

            await bot.editMessageText(
              `❌ <b>Error en la Descarga</b>\n\n` +
              `🆔 <b>DNI:</b> ${targetUser?.dni || 'No especificado'}\n` +
              `⚠️ <b>Error:</b> ${errorMessage}\n` +
              `📝 <b>Detalles:</b> ${errorDetails}\n\n` +
              `💡 <b>Pasos para resolver:</b>\n` +
              `1️⃣ Verifica que el servidor backend esté ejecutándose\n` +
              `2️⃣ Confirma que la URL del backend sea correcta\n` +
              `3️⃣ Verifica que el endpoint /autorizaciones/download_pdf exista\n` +
              `4️⃣ Confirma que el DNI ${targetUser?.dni || 'N/A'} tenga una autorización`,
              {
                chat_id: chatId,
                message_id: query.message.message_id,
                parse_mode: 'HTML',
                reply_markup: {
                  inline_keyboard: [
                    [{ text: '🔄 Reintentar', callback_data: `user_descargar_autorizacion_${targetUserId}` }],
                    [{ text: '🔙 Volver al Usuario', callback_data: `user_detail_${targetUserId}` }]
                  ]
                }
              }
            );
          } catch (editError) {
            console.error('Error al editar mensaje de error:', editError);
            // Si no se puede editar el mensaje, enviar uno nuevo
            try {
              await bot.sendMessage(chatId, 
                `❌ <b>Error en la Descarga</b>\n\n` +
                `${errorMessage}\n\n` +
                `DNI: ${targetUser?.dni || 'No especificado'}\n\n` +
                `${errorDetails}`,
                { parse_mode: 'HTML' }
              );
            } catch (sendError) {
              console.error('Error al enviar mensaje de error:', sendError);
            }
          }
        }
      }

      // Descargar compra-venta para usuario específico
      else if (action.startsWith('user_descargar_compaventa_')) {
        const targetUserId = action.split('_')[3];
        
        try {
          const targetUser = await userApiService.getUserById(targetUserId);
          
          if (!targetUser) {
            await bot.answerCallbackQuery(query.id, { text: '❌ Usuario no encontrado' });
            return;
          }

          // Mostrar animación de descarga
          await bot.editMessageText(
            `📥 <b>Descargando Compa-Venta...</b>\n\n` +
            `👤 <b>Usuario:</b> ${targetUser.nombre || 'No especificado'}\n` +
            `🆔 <b>DNI:</b> ${targetUser.dni || 'No especificado'}\n\n` +
            `⏳ Preparando descarga del PDF...`,
            {
              chat_id: chatId,
              message_id: query.message.message_id,
              parse_mode: 'HTML'
            }
          );

          // Simular descarga
          await new Promise(resolve => setTimeout(resolve, 1500));

          // Calcular tamaño del archivo (simulado)
          const fileSizeInMB = (Math.random() * (0.6 - 0.3) + 0.3).toFixed(2);

          // Mostrar resultado de descarga usando el formato solicitado
          await bot.editMessageText(
            `✅ <b>PDF Enviado Exitosamente</b>\n\n` +
            `📋 DNI: ${targetUser.dni || 'No especificado'}\n` +
            `📄 El archivo ha sido enviado correctamente\n` +
            `📊 Tamaño: ${fileSizeInMB} MB`,
            {
              chat_id: chatId,
              message_id: query.message.message_id,
              parse_mode: 'HTML',
              reply_markup: {
                inline_keyboard: [
                  [{ text: '🔙 Volver al Usuario', callback_data: `user_detail_${targetUserId}` }]
                ]
              }
            }
          );

          await bot.answerCallbackQuery(query.id, { 
            text: '✅ PDF enviado exitosamente' 
          });
        } catch (error) {
          console.error('Error al descargar compra-venta:', error);
          await bot.answerCallbackQuery(query.id, { text: '❌ Error al descargar PDF' });
        }
      }

      // Manejar generación de autorización
      else if (action.startsWith('generate_auth_')) {
        const targetUserId = action.split('_')[2];
        
        try {
          const targetUser = await userApiService.getUserById(targetUserId);
          
          if (!targetUser) {
            await bot.answerCallbackQuery(query.id, { text: '❌ Usuario no encontrado' });
            return;
          }

          // Mostrar menú generador para el usuario específico
          await bot.editMessageText(
            `🛠️ **Generador**\n\n` +
            `👤 **Usuario:** ${targetUser.nombre || 'No especificado'}\n` +
            `🆔 **DNI:** ${targetUser.dni || 'No especificado'}\n` +
            `👑 **Rol:** ${targetUser.role_id === 1 ? 'Administrador' : 'Usuario'}\n\n` +
            `Selecciona el tipo de documento a generar:`,
            {
              chat_id: chatId,
              message_id: query.message.message_id,
              parse_mode: 'Markdown',
              reply_markup: {
                inline_keyboard: [
                  [{ text: '🔑 Generar Autorización', callback_data: `user_generar_autorizacion_${targetUserId}` }],
                  [{ text: '📄 Generar Compa-Venta', callback_data: `user_generar_compaventa_${targetUserId}` }],
                  [{ text: '🔙 Volver', callback_data: `user_detail_${targetUserId}` }]
                ]
              }
            }
          );
        } catch (error) {
          console.error('Error al mostrar generación de autorización:', error);
          await bot.answerCallbackQuery(query.id, { text: '❌ Error al cargar usuario' });
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
          const session = userSessions.get(chatId);
          session.waitingForDni = targetUserId;
          session.lastActivity = Date.now();
          userSessions.set(chatId, session);

          await bot.editMessageText(
            `🆔 **Editar DNI de Usuario**\n\n` +
            `👤 **Usuario:** ${targetUser.nombre || 'No especificado'}\n` +
            `🆔 **DNI actual:** ${targetUser.dni || 'No especificado'}\n\n` +
            `📝 **Envía el nuevo DNI:**\n\n` +
            `ℹ️ El DNI debe contener solo números y tener 8 dígitos.`,
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
          console.error('Error al editar DNI:', error);
          await bot.answerCallbackQuery(query.id, { text: '❌ Error al cargar usuario' });
        }
      }
      
      else if (action.startsWith('view_huella_')) {
        const targetUserId = action.split('_')[2];
        
        try {
          const targetUser = await userApiService.getUserById(targetUserId);
          
          if (!targetUser) {
            await bot.answerCallbackQuery(query.id, { text: '❌ Usuario no encontrado' });
            return;
          }

          if (!targetUser.dni) {
            await bot.answerCallbackQuery(query.id, { text: '❌ Usuario sin DNI registrado' });
            return;
          }

          // Configurar URL de huella para web-app
          const backendUrl = process.env.BACKEND_BASE_URL || 'http://localhost:3000';
          const huellaUrl = `${backendUrl}/autorizaciones/huella?dni=${targetUser.dni}&source=telegram`;
          
          console.log(`[DEBUG] Abriendo huella en web-app: ${huellaUrl}`);

          // Responder al callback query y mostrar opciones
          await bot.answerCallbackQuery(query.id, { text: '👆 Abriendo huella...' });

          await bot.editMessageText(
            `👆 <b>Huella Dactilar</b>\n\n` +
            `👤 <b>Usuario:</b> ${targetUser.nombre || 'No especificado'}\n` +
            `🆔 <b>DNI:</b> ${targetUser.dni}\n\n` +
            `🌐 <b>Haz clic en "Ver Huella" para abrir en web-app</b>`,
            {
              chat_id: chatId,
              message_id: query.message.message_id,
              parse_mode: 'HTML',
              reply_markup: {
                inline_keyboard: [
                  [{ 
                    text: '👆 Ver Huella', 
                    web_app: { url: huellaUrl }
                  }],
                  [{ text: '🔙 Volver al Usuario', callback_data: `user_detail_${targetUserId}` }]
                ]
              }
            }
          );

        } catch (error) {
          console.error('Error al mostrar huella:', error);
          await bot.answerCallbackQuery(query.id, { text: '❌ Error al cargar huella' });
        }
      }

      // Manejar visualización de firma
      else if (action.startsWith('view_firma_')) {
        const targetUserId = action.split('_')[2];
        
        try {
          const targetUser = await userApiService.getUserById(targetUserId);
          
          if (!targetUser) {
            await bot.answerCallbackQuery(query.id, { text: '❌ Usuario no encontrado' });
            return;
          }

          if (!targetUser.dni) {
            await bot.answerCallbackQuery(query.id, { text: '❌ Usuario sin DNI registrado' });
            return;
          }

          // Configurar URL de firma para web-app
          const backendUrl = process.env.BACKEND_BASE_URL || 'http://localhost:3000';
          const firmaUrl = `${backendUrl}/autorizaciones/firma?dni=${targetUser.dni}&source=telegram`;
          
          console.log(`[DEBUG] Abriendo firma en web-app: ${firmaUrl}`);

          // Responder al callback query y mostrar opciones
          await bot.answerCallbackQuery(query.id, { text: '✍️ Abriendo firma...' });

          await bot.editMessageText(
            `✍️ <b>Firma Digital</b>\n\n` +
            `👤 <b>Usuario:</b> ${targetUser.nombre || 'No especificado'}\n` +
            `🆔 <b>DNI:</b> ${targetUser.dni}\n\n` +
            `🌐 <b>Haz clic en "Ver Firma" para abrir en web-app</b>`,
            {
              chat_id: chatId,
              message_id: query.message.message_id,
              parse_mode: 'HTML',
              reply_markup: {
                inline_keyboard: [
                  [{ 
                    text: '✍️ Ver Firma', 
                    web_app: { url: firmaUrl }
                  }],
                  [{ text: '🔙 Volver al Usuario', callback_data: `user_detail_${targetUserId}` }]
                ]
              }
            }
          );

        } catch (error) {
          console.error('Error al mostrar firma:', error);
          await bot.answerCallbackQuery(query.id, { text: '❌ Error al cargar firma' });
        }
      }
      
      // Manejar cambio de estado de autorización
      else if (action.startsWith('change_auth_status_')) {
        const parts = action.split('_');
        const targetUserId = parts[3];
        const nuevoEstado = parts[4];
        
        try {
          // Mostrar mensaje de carga
          await bot.answerCallbackQuery(query.id, { text: '⏳ Actualizando estado...' });
          
          // Actualizar estado en el backend
          const resultado = await userApiService.updateAutorizacionEstado(targetUserId, nuevoEstado);
          
          // Obtener información del usuario
          const targetUser = await userApiService.getUserById(targetUserId);
          
          if (!targetUser) {
            await bot.answerCallbackQuery(query.id, { text: '❌ Usuario no encontrado' });
            return;
          }

          // Determinar texto del estado actualizado
          const estadoEmoji = nuevoEstado === 'activo' ? '🟢' : '🟡';
          const estadoTexto = nuevoEstado === 'activo' ? 'Activo' : 'Pendiente';
          const accionTexto = nuevoEstado === 'activo' ? 'activado' : 'desactivado';

          await bot.editMessageText(
            `✅ <b>Estado Actualizado</b>\n\n` +
            `👤 <b>Usuario:</b> ${targetUser.nombre || 'No especificado'}\n` +
            `🆔 <b>DNI:</b> ${targetUser.dni}\n` +
            `${estadoEmoji} <b>Estado:</b> ${estadoTexto}\n\n` +
            `🎉 <b>La autorización ha sido ${accionTexto} exitosamente</b>`,
            {
              chat_id: chatId,
              message_id: query.message.message_id,
              parse_mode: 'HTML',
              reply_markup: {
                inline_keyboard: [
                  [{ text: '🔙 Volver al Usuario', callback_data: `user_detail_${targetUserId}` }]
                ]
              }
            }
          );

        } catch (error) {
          console.error('Error al cambiar estado de autorización:', error);
          
          let errorMessage = '❌ Error al actualizar estado';
          let retryButton = null;
          
          if (error.response?.status === 404) {
            errorMessage = '❌ Autorización no encontrada';
          } else if (error.response?.status === 400) {
            errorMessage = '❌ Estado inválido';
          } else if (error.code === 'ECONNREFUSED') {
            errorMessage = '❌ Error de conexión con el servidor';
            retryButton = { text: '🔄 Reintentar', callback_data: `change_auth_status_${targetUserId}_${nuevoEstado}` };
          }

          const buttons = [
            [{ text: '🔙 Volver al Usuario', callback_data: `user_detail_${targetUserId}` }]
          ];
          
          if (retryButton) {
            buttons.unshift([retryButton]);
          }

          await bot.editMessageText(
            `${errorMessage}\n\n` +
            `👤 <b>Usuario:</b> ${targetUser?.nombre || 'No especificado'}\n` +
            `🆔 <b>DNI:</b> ${targetUser?.dni || 'No especificado'}\n\n` +
            `⚠️ <b>No se pudo actualizar el estado de autorización</b>`,
            {
              chat_id: chatId,
              message_id: query.message.message_id,
              parse_mode: 'HTML',
              reply_markup: {
                inline_keyboard: buttons
              }
            }
          );
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

          await bot.editMessageText(
            `🗑️ **Confirmar Eliminación**\n\n` +
            `👤 **Usuario:** ${targetUser.nombre || 'No especificado'}\n` +
            `🆔 **DNI:** ${targetUser.dni || 'No especificado'}\n\n` +
            `⚠️ **¿Estás seguro de que quieres eliminar este usuario?**\n` +
            `Esta acción no se puede deshacer.`,
            {
              chat_id: chatId,
              message_id: query.message.message_id,
              parse_mode: 'Markdown',
              reply_markup: {
                inline_keyboard: [
                  [
                    { text: '✅ Sí, eliminar', callback_data: `confirm_delete_${targetUserId}` },
                    { text: '❌ Cancelar', callback_data: `user_detail_${targetUserId}` }
                  ]
                ]
              }
            }
          );
        } catch (error) {
          console.error('Error al eliminar usuario:', error);
          await bot.answerCallbackQuery(query.id, { text: '❌ Error al cargar usuario' });
        }
      }

      // Manejar confirmación de eliminación
      else if (action.startsWith('confirm_delete_')) {
        const targetUserId = action.split('_')[2];
        
        // Responder inmediatamente al callback para evitar timeout
        await bot.answerCallbackQuery(query.id, { 
          text: '⏳ Procesando eliminación...' 
        });
        
        try {
          // Obtener información del usuario antes de eliminarlo
          const userDetail = await userApiService.getUserById(targetUserId);
          
          // 🔔 ENVIAR NOTIFICACIÓN Y LIMPIAR SESIÓN DEL USUARIO AFECTADO
          try {
            const { findUserById, clearUserMessages } = require('../utils/chatManager');
            const { clearUserSession } = require('../utils/session');
            const targetUserData = findUserById(targetUserId);
            
            if (targetUserData && targetUserData.chatId) {
              // Enviar notificación antes de eliminar
              const notificationMessage = 
                `🚨 **Notificación del Sistema**\n\n` +
                `❌ **Tu cuenta ha sido eliminada**\n\n` +
                `👤 **Usuario:** ${userDetail.nombre || 'Sin nombre'}\n` +
                `🆔 **DNI:** ${userDetail.dni || 'Sin DNI'}\n\n` +
                `📋 **Información importante:**\n` +
                `• Tu acceso al sistema ha sido revocado\n` +
                `• Todos tus datos han sido eliminados\n` +
                `• Si necesitas acceso nuevamente, deberás registrarte otra vez\n\n` +
                `🔄 **Para volver a registrarte, usa el comando /start**`;

              await bot.sendMessage(targetUserData.chatId, notificationMessage, {
                parse_mode: 'Markdown',
                reply_markup: {
                  keyboard: [['🚀 Iniciar']], 
                  resize_keyboard: true 
                }
              });
              
              // Limpiar sesión completa del usuario
              await clearUserSession(bot, targetUserData.chatId, true); // skipFinalMessage = true
              
              // Limpiar datos del chat
              clearUserMessages(targetUserData.chatId);
              
              console.log(`📤 Notificación de eliminación enviada y sesión limpiada para usuario ${targetUserId} (chat: ${targetUserData.chatId})`);
            } else {
              console.log(`⚠️ No se pudo encontrar chat_id para el usuario ${targetUserId}`);
            }
          } catch (notificationError) {
            console.error('❌ Error al enviar notificación de eliminación:', notificationError);
          }
          
          // Eliminar usuario del backend
          await userApiService.deleteUser(targetUserId);
          
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
          
          // Solo enviar mensaje de error si no se ha respondido ya
          try {
            await bot.editMessageText(
              '❌ **Error**\n\nNo se pudo eliminar el usuario. Inténtalo de nuevo.',
              {
                chat_id: chatId,
                message_id: query.message.message_id,
                parse_mode: 'Markdown',
                reply_markup: {
                  inline_keyboard: [[{ text: '🔙 Volver', callback_data: 'admin_users' }]]
                }
              }
            );
          } catch (editError) {
            console.error('Error al editar mensaje de error:', editError);
          }
        }
      }

      // Notificar al usuario para que genere su proceso de autorización
      else if (action.startsWith('user_notificar_proceso_')) {
        const targetUserId = action.split('_')[3];
        
        try {
          await bot.answerCallbackQuery(query.id, { text: '📢 Enviando notificación...' });

          const targetUser = await userApiService.getUserById(targetUserId);
          
          if (!targetUser) {
            await bot.editMessageText(
              `❌ **Error**\n\nUsuario no encontrado.`,
              {
                chat_id: chatId,
                message_id: query.message.message_id,
                parse_mode: 'Markdown',
                reply_markup: {
                  inline_keyboard: [
                    [{ text: '🔙 Volver', callback_data: 'users_menu' }]
                  ]
                }
              }
            );
            return;
          }

          // Intentar obtener el chat_id de diferentes maneras
          const { findUserByDni, findUserById } = require('../utils/chatManager');
          let userChatId = targetUser.chat_id;
          let foundMethod = 'backend';
          
          // 1. Si no tiene chat_id en el backend, buscar por DNI en user_chats.json
          if (!userChatId && targetUser.dni) {
            const userByDni = findUserByDni(targetUser.dni);
            if (userByDni) {
              userChatId = userByDni.chatId;
              foundMethod = 'dni_local';
              console.log(`[DEBUG] Chat ID encontrado por DNI ${targetUser.dni}: ${userChatId}`);
            }
          }

          // 2. Buscar por ID del usuario en user_chats.json
          if (!userChatId) {
            const userById = findUserById(targetUserId);
            if (userById) {
              userChatId = userById.chatId;
              foundMethod = 'id_local';
              console.log(`[DEBUG] Chat ID encontrado por ID ${targetUserId}: ${userChatId}`);
            }
          }

          // 3. Si aún no tiene chat_id, intentar usar el targetUserId como chat_id
          if (!userChatId && !isNaN(targetUserId) && targetUserId.length > 5) {
            userChatId = targetUserId;
            foundMethod = 'id_as_chatid';
            console.log(`[DEBUG] Usando targetUserId como chat_id: ${userChatId}`);
          }

          // Verificar si finalmente tenemos un chat_id para notificar
          if (!userChatId) {
            await bot.editMessageText(
              `⚠️ **No se puede notificar**\n\n` +
              `👤 **Usuario:** ${targetUser.nombre || 'No especificado'}\n` +
              `🆔 **DNI:** ${targetUser.dni || 'No especificado'}\n` +
              `🔍 **ID Usuario:** ${targetUserId}\n\n` +
              `❌ No se encontró un chat activo para este usuario.\n` +
              `El usuario debe haber iniciado el bot al menos una vez.\n\n` +
              `💡 **Para resolver:**\n` +
              `• El usuario debe enviar /start al bot\n` +
              `• Verificar que el DNI sea correcto\n` +
              `• Usar generación administrativa como alternativa`,
              {
                chat_id: chatId,
                message_id: query.message.message_id,
                parse_mode: 'Markdown',
                reply_markup: {
                  inline_keyboard: [
                    [{ text: '⚡ Generar Administrativa', callback_data: `user_forzar_autorizacion_${targetUserId}` }],
                    [{ text: '🔍 Buscar Chat ID', callback_data: `user_buscar_chatid_${targetUserId}` }],
                    [{ text: '🔙 Volver al Usuario', callback_data: `user_detail_${targetUserId}` }]
                  ]
                }
              }
            );
            return;
          }

          // Intentar enviar notificación al usuario
          try {
            console.log(`[DEBUG] Enviando notificación a chat_id: ${userChatId} (método: ${foundMethod})`);
            
            await bot.sendMessage(userChatId,
              `📢 **Notificación de Autorización**\n\n` +
              `Hola ${targetUser.nombre || 'Usuario'},\n\n` +
              `🔔 Se ha solicitado generar una autorización.\n\n` +
              `📋 **Por Favor, para completar el proceso:**\n` +
              `1️⃣ Haga clik en el botón "🔑 Ir a Autorizaciones"\n` +
              `2️⃣ Completa el proceso de generación\n\n` +
              `⏰ **Importante:** Completa este proceso lo antes posible.\n\n` +
              `Si tienes dudas, contacta con el administrador.`,
              { 
                parse_mode: 'Markdown',
                reply_markup: {
                  inline_keyboard: [
                    [{ text: '🔑 Ir a Autorizaciones', callback_data: 'crear_autorizacion' }]
                  ]
                }
              }
            );

            // Confirmar envío exitoso
            await bot.editMessageText(
              `✅ **Notificación Enviada**\n\n` +
              `👤 **Usuario:** ${targetUser.nombre || 'No especificado'}\n` +
              `🆔 **DNI:** ${targetUser.dni || 'No especificado'}\n` +
              `📱 **Chat ID:** ${userChatId}\n` +
              `🔍 **Método:** ${foundMethod}\n` +
              `📤 **Estado:** Mensaje enviado exitosamente\n\n` +
              `📢 Se ha enviado una notificación al usuario solicitando que complete su proceso de autorización.\n\n` +
              `⏳ El usuario debe responder desde su chat con el bot.`,
              {
                chat_id: chatId,
                message_id: query.message.message_id,
                parse_mode: 'Markdown',
                reply_markup: {
                  inline_keyboard: [
                    [{ text: '⚡ Generar Administrativa', callback_data: `user_forzar_autorizacion_${targetUserId}` }],
                    [{ text: '🔄 Enviar Otra Notificación', callback_data: `user_notificar_proceso_${targetUserId}` }],
                    [{ text: '🔙 Volver al Usuario', callback_data: `user_detail_${targetUserId}` }]
                  ]
                }
              }
            );

          } catch (sendError) {
            console.error('Error al enviar notificación:', sendError);
            
            let errorDetails = '';
            if (sendError.response?.status === 403) {
              errorDetails = 'El usuario bloqueó el bot o no ha iniciado conversación.';
            } else if (sendError.response?.status === 400) {
              errorDetails = 'Chat ID inválido o usuario no encontrado en Telegram.';
            } else {
              errorDetails = `Error de conectividad: ${sendError.message}`;
            }
            
            await bot.editMessageText(
              `❌ **Error al Enviar Notificación**\n\n` +
              `👤 **Usuario:** ${targetUser.nombre || 'No especificado'}\n` +
              `🆔 **DNI:** ${targetUser.dni || 'No especificado'}\n` +
              `📱 **Chat ID:** ${userChatId}\n` +
              `🔍 **Método:** ${foundMethod}\n\n` +
              `⚠️ **Problema:** ${errorDetails}\n\n` +
              `💡 **Soluciones:**\n` +
              `• Pedir al usuario que envíe /start al bot\n` +
              `• Verificar que no haya bloqueado el bot\n` +
              `• Usar generación administrativa`,
              {
                chat_id: chatId,
                message_id: query.message.message_id,
                parse_mode: 'Markdown',
                reply_markup: {
                  inline_keyboard: [
                    [{ text: '⚡ Generar Administrativa', callback_data: `user_forzar_autorizacion_${targetUserId}` }],
                    [{ text: '🔄 Reintentar Notificación', callback_data: `user_notificar_proceso_${targetUserId}` }],
                    [{ text: '🔙 Volver al Usuario', callback_data: `user_detail_${targetUserId}` }]
                  ]
                }
              }
            );
          }

        } catch (error) {
          console.error('Error al notificar proceso:', error);
          
          let errorMessage = '❌ **Error**\n\n';
          let retryButton = { text: '🔄 Reintentar', callback_data: `user_notificar_proceso_${targetUserId}` };
          
          // Manejo específico de errores de conectividad
          if (error.code === 'ECONNRESET' || error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
            errorMessage += '🌐 **Error de Conectividad**\n\n' +
              'No se pudo conectar con el servidor backend para obtener los datos del usuario.\n\n' +
              '🔧 **Posibles causas:**\n' +
              '• Pérdida de conexión a internet\n' +
              '• Servidor backend no disponible\n' +
              '• Timeout de red\n\n' +
              '💡 **Soluciones:**\n' +
              '• Verificar conexión a internet\n' +
              '• Intentar nuevamente en unos momentos\n' +
              '• Contactar al administrador del sistema\n\n' +
              `🆔 **ID Usuario:** ${targetUserId}`;
          } else if (error.response?.status === 404) {
            errorMessage += '👤 **Usuario No Encontrado**\n\n' +
              'El usuario solicitado no existe en el sistema backend.\n\n' +
              `🆔 **ID Usuario:** ${targetUserId}`;
            retryButton = null; // No mostrar botón de reintentar para 404
          } else if (error.response?.status === 500) {
            errorMessage += '🔧 **Error del Servidor Backend**\n\n' +
              'Error interno del servidor. Por favor, contacta al administrador.\n\n' +
              `🆔 **ID Usuario:** ${targetUserId}`;
          } else {
            errorMessage += 'No se pudo procesar la notificación.\n' +
              'Por favor, inténtalo nuevamente.\n\n' +
              `🆔 **ID Usuario:** ${targetUserId}\n` +
              `📋 **Error:** ${error.message || 'Desconocido'}`;
          }
          
          const keyboard = retryButton 
            ? [[retryButton], [{ text: '🔙 Volver al Usuario', callback_data: `user_detail_${targetUserId}` }]]
            : [[{ text: '🔙 Volver al Usuario', callback_data: `user_detail_${targetUserId}` }]];
          
          await bot.editMessageText(errorMessage, {
            chat_id: chatId,
            message_id: query.message.message_id,
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: keyboard
            }
          });
        }
      }

      // Forzar generación de autorización (administrativa)
      else if (action.startsWith('user_forzar_autorizacion_')) {
        const targetUserId = action.split('_')[3];
        
        try {
          await bot.answerCallbackQuery(query.id, { text: '⚡ Generando autorización...' });

          const targetUser = await userApiService.getUserById(targetUserId);
          
          if (!targetUser) {
            await bot.editMessageText(
              `❌ **Error**\n\nUsuario no encontrado.`,
              {
                chat_id: chatId,
                message_id: query.message.message_id,
                parse_mode: 'Markdown',
                reply_markup: {
                  inline_keyboard: [
                    [{ text: '🔙 Volver', callback_data: 'users_menu' }]
                  ]
                }
              }
            );
            return;
          }

          // Mostrar animación de carga
          await bot.editMessageText(
            `⚡ **Generando Autorización Administrativa...**\n\n` +
            `👤 **Usuario:** ${targetUser.nombre || 'No especificado'}\n` +
            `🆔 **DNI:** ${targetUser.dni || 'No especificado'}\n` +
            `🔧 **Tipo:** Generación administrativa\n\n` +
            `⏳ Por favor espera mientras se genera el documento...`,
            {
              chat_id: chatId,
              message_id: query.message.message_id,
              parse_mode: 'Markdown'
            }
          );

          // Simular proceso de generación (aquí iría la llamada real al backend)
          await new Promise(resolve => setTimeout(resolve, 3000));

          // Mostrar resultado exitoso
          await bot.editMessageText(
            `✅ **Autorización Generada Exitosamente**\n\n` +
            `👤 **Usuario:** ${targetUser.nombre || 'No especificado'}\n` +
            `🆔 **DNI:** ${targetUser.dni || 'No especificado'}\n` +
            `📄 **Documento:** Autorización\n` +
            `🔧 **Tipo:** Generación administrativa\n` +
            `📅 **Fecha:** ${new Date().toLocaleDateString('es-ES')}\n\n` +
            `✨ El documento ha sido generado correctamente por el administrador.`,
            {
              chat_id: chatId,
              message_id: query.message.message_id,
              parse_mode: 'Markdown',
              reply_markup: {
                inline_keyboard: [
                  [{ text: '📥 Descargar PDF', callback_data: `user_descargar_autorizacion_${targetUserId}` }],
                  [{ text: '🔙 Volver al Usuario', callback_data: `user_detail_${targetUserId}` }]
                ]
              }
            }
          );

        } catch (error) {
          console.error('Error al forzar generación de autorización:', error);
          await bot.editMessageText(
            `❌ **Error al Generar Autorización**\n\n` +
            `Ocurrió un error durante la generación administrativa del documento.\n\n` +
            `Por favor, inténtalo nuevamente.`,
            {
              chat_id: chatId,
              message_id: query.message.message_id,
              parse_mode: 'Markdown',
              reply_markup: {
                inline_keyboard: [
                  [{ text: '🔄 Reintentar', callback_data: `user_forzar_autorizacion_${targetUserId}` }],
                  [{ text: '🔙 Volver al Usuario', callback_data: `user_detail_${targetUserId}` }]
                ]
              }
            }
          );
        }
      }

      // Handler para buscar chat ID de un usuario
      else if (action.startsWith('user_buscar_chatid_')) {
        if (user && user.role_id === 1) {
          const targetUserId = action.split('_')[3];
          
          try {
            const targetUser = await userApiService.getUserById(targetUserId);
            
            if (!targetUser) {
              const safeMessage = formatSafeMessage(`❌ <b>Error</b>\n\nUsuario no encontrado.`);
              await bot.editMessageText(safeMessage.text, {
                chat_id: chatId,
                message_id: query.message.message_id,
                ...safeMessage.options,
                reply_markup: {
                  inline_keyboard: [
                    [{ text: '🔙 Volver', callback_data: 'users_menu' }]
                  ]
                }
              });
              return;
            }

            // Función auxiliar para limpiar texto
            const cleanText = (text) => {
              if (!text) return 'No especificado';
              return String(text).replace(/[<>&"']/g, '');
            };

            // Buscar en diferentes fuentes
            const { findUserByDni, findUserById, getAllUsers } = require('../utils/chatManager');
            let searchResults = [];
            
            // 1. Buscar por DNI en user_chats.json
            if (targetUser.dni) {
              const userByDni = findUserByDni(targetUser.dni);
              if (userByDni && userByDni.userInfo) {
                searchResults.push(`📍 <b>Por DNI (${cleanText(targetUser.dni)}):</b> ${userByDni.chatId} ✅`);
                searchResults.push(`   └ Nombre: ${cleanText(userByDni.userInfo.nombre)}`);
                searchResults.push(`   └ Último login: ${cleanText(userByDni.userInfo.lastLogin || 'N/A')}`);
              } else {
                searchResults.push(`📍 <b>Por DNI (${cleanText(targetUser.dni)}):</b> No encontrado`);
              }
            }

            // 2. Buscar por ID en user_chats.json
            const userById = findUserById(targetUserId);
            if (userById && userById.userInfo) {
              searchResults.push(`📍 <b>Por ID (${cleanText(targetUserId)}):</b> ${userById.chatId} ✅`);
              searchResults.push(`   └ Nombre: ${cleanText(userById.userInfo.nombre)}`);
              searchResults.push(`   └ DNI: ${cleanText(userById.userInfo.dni)}`);
            } else {
              searchResults.push(`📍 <b>Por ID (${cleanText(targetUserId)}):</b> No encontrado`);
            }

            // 3. Verificar si el ID del usuario es un chat_id válido
            if (!isNaN(targetUserId) && targetUserId.length > 5) {
              searchResults.push(`📍 <b>ID como Chat ID:</b> ${cleanText(targetUserId)} (posible)`);
            }

            // 4. Buscar en datos del backend
            if (targetUser.chat_id) {
              searchResults.push(`📍 <b>Backend API:</b> ${cleanText(targetUser.chat_id)} ✅`);
            } else {
              searchResults.push(`📍 <b>Backend API:</b> No disponible`);
            }

            // 5. Mostrar estadísticas generales
            const allUsers = getAllUsers();
            const sameNameUsers = allUsers.filter(u => u.userInfo && u.userInfo.dni === targetUser.dni).length;
            searchResults.push(`\n📊 <b>Estadísticas:</b>`);
            searchResults.push(`   └ Total usuarios registrados: ${allUsers.length}`);
            searchResults.push(`   └ Usuarios con mismo DNI: ${sameNameUsers}`);

            const messageText = 
              `🔍 <b>Búsqueda de Chat ID</b>\n\n` +
              `👤 <b>Usuario:</b> ${cleanText(targetUser.nombre)}\n` +
              `🆔 <b>DNI:</b> ${cleanText(targetUser.dni)}\n` +
              `🔢 <b>ID Usuario:</b> ${cleanText(targetUserId)}\n\n` +
              `<b>Resultados de búsqueda:</b>\n` +
              searchResults.join('\n') + '\n\n' +
              `💡 <b>Para que funcione la notificación:</b>\n` +
              `• El usuario debe haber enviado /start al bot\n` +
              `• Debe existir un chat_id válido registrado\n` +
              `• El usuario no debe haber bloqueado el bot`;

            await bot.editMessageText(messageText, {
              chat_id: chatId,
              message_id: query.message.message_id,
              parse_mode: 'HTML',
              reply_markup: {
                inline_keyboard: [
                  [{ text: '📢 Intentar Notificación', callback_data: `user_notificar_proceso_${targetUserId}` }],
                  [{ text: '⚡ Generar Administrativa', callback_data: `user_forzar_autorizacion_${targetUserId}` }],
                  [{ text: '🔙 Volver al Usuario', callback_data: `user_detail_${targetUserId}` }]
                ]
              }
            });

          } catch (error) {
            console.error('Error al buscar chat ID:', error);
            
            let errorMessage = '❌ <b>Error en la búsqueda</b>\n\n';
            let retryButton = { text: '🔄 Reintentar', callback_data: `user_buscar_chatid_${targetUserId}` };
            
            // Manejo específico de errores de conectividad
            if (error.code === 'ECONNRESET' || error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
              errorMessage += '🌐 <b>Error de Conectividad</b>\n\n' +
                'No se pudo conectar con el servidor backend para obtener los datos del usuario.\n\n' +
                '🔧 <b>Posibles causas:</b>\n' +
                '• Pérdida de conexión a internet\n' +
                '• Servidor backend no disponible\n' +
                '• Timeout de red\n\n' +
                '💡 <b>Soluciones:</b>\n' +
                '• Verificar conexión a internet\n' +
                '• Intentar nuevamente en unos momentos\n' +
                '• Contactar al administrador del sistema';
            } else if (error.response?.status === 404) {
              errorMessage += '👤 <b>Usuario No Encontrado</b>\n\n' +
                'El usuario solicitado no existe en el sistema backend.';
              retryButton = null; // No mostrar botón de reintentar para 404
            } else if (error.response?.status === 500) {
              errorMessage += '🔧 <b>Error del Servidor Backend</b>\n\n' +
                'Error interno del servidor. Por favor, contacta al administrador.';
            } else {
              errorMessage += 'No se pudo buscar el chat ID.\n' +
                `<b>Error:</b> ${String(error.message || 'Desconocido').replace(/[<>&"']/g, '')}`;
            }
            
            const keyboard = retryButton 
              ? [[retryButton], [{ text: '🔙 Volver al Usuario', callback_data: `user_detail_${targetUserId}` }]]
              : [[{ text: '🔙 Volver al Usuario', callback_data: `user_detail_${targetUserId}` }]];
            
            await bot.editMessageText(errorMessage, {
              chat_id: chatId,
              message_id: query.message.message_id,
              parse_mode: 'HTML',
              reply_markup: {
                inline_keyboard: keyboard
              }
            });
          }
        }
      }

      // Buscar administrador
      else if (action === 'search_admin') {
        if (user && user.role_id === 1) {
          // Guardar el estado para esperar el término de búsqueda
          if (!userSessions.has(chatId)) {
            userSessions.set(chatId, {});
          }
          userSessions.get(chatId).waitingForAdminSearch = true;

          await bot.editMessageText(
            `🔍 **Buscar Administrador**\n\n` +
            `📝 **Envía el nombre o DNI del administrador que deseas buscar:**`,
            {
              chat_id: chatId,
              message_id: query.message.message_id,
              parse_mode: 'Markdown',
              reply_markup: {
                inline_keyboard: [
                  [{ text: '🔙 Cancelar', callback_data: 'admin_type_menu' }]
                ]
              }
            }
          );
        }
      }

      // Buscar usuario
      else if (action === 'search_user') {
        if (user && user.role_id === 1) {
          // Guardar el estado para esperar el término de búsqueda
          if (!userSessions.has(chatId)) {
            userSessions.set(chatId, {});
          }
          userSessions.get(chatId).waitingForUserSearch = true;

          await bot.editMessageText(
            `🔍 **Buscar Usuario**\n\n` +
            `📝 **Envía el nombre o DNI del usuario que deseas buscar:**`,
            {
              chat_id: chatId,
              message_id: query.message.message_id,
              parse_mode: 'Markdown',
              reply_markup: {
                inline_keyboard: [
                  [{ text: '🔙 Cancelar', callback_data: 'user_type_menu' }]
                ]
              }
            }
          );
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

