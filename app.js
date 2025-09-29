// app.js
const TelegramBot = require('node-telegram-bot-api');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const personas = require('./data/personas.json'); // debe ser un arreglo
const TOKEN = '7971892958:AAFa9dr7oqaUeTqd0TLKcatpH61TvDsi460';
const bot = new TelegramBot(TOKEN, { polling: true });

const userSteps = {}; // para guardar el estado de cada usuario

// ====== Comando /start ======
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  userSteps[chatId] = { step: 'selectRemitente' };

  bot.sendMessage(chatId, 'Selecciona el **Remitente**:', {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: personas.map(p => [{
        text: `${p.nombre} (${p.sede})`,
        callback_data: `remitente_${p.id}`
      }])
    }
  });
});

// ====== Manejo de botones ======
bot.on('callback_query', (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;
  const state = userSteps[chatId];
  if (!state) return;

  // ---- Remitente ----
  if (state.step === 'selectRemitente' && data.startsWith('remitente_')) {
    state.remitente = personas.find(p => p.id === data.split('_')[1]);
    state.step = 'selectReceptor';

    bot.editMessageText(
      `Remitente: *${state.remitente.nombre}*\nAhora selecciona el **Receptor**:`,
      {
        chat_id: chatId,
        message_id: query.message.message_id,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: personas
            .filter(p => p.id !== state.remitente.id)
            .map(p => [{
              text: `${p.nombre} (${p.sede})`,
              callback_data: `receptor_${p.id}`
            }])
        }
      }
    );
  }

  // ---- Receptor ----
  else if (state.step === 'selectReceptor' && data.startsWith('receptor_')) {
    state.receptor = personas.find(p => p.id === data.split('_')[1]);
    state.step = 'done';

    bot.editMessageText(
      `Receptor: *${state.receptor.nombre}*\nGenerando PDF...`,
      {
        chat_id: chatId,
        message_id: query.message.message_id,
        parse_mode: 'Markdown'
      }
    );

    generarPDF(state.remitente, state.receptor, chatId);
  }
});

// ====== Función para generar PDF ======
function generarPDF(remitente, receptor, chatId) {
  const doc = new PDFDocument({ size: 'A4', margin: 30, layout: 'landscape' });
  const filename = `guia_envio_${Date.now()}.pdf`;
  const writeStream = fs.createWriteStream(filename);
  doc.pipe(writeStream);

  // Logo opcional
  const logoPath = path.join(__dirname, 'logo.ico');
  if (fs.existsSync(logoPath)) {
    doc.image(logoPath, 60, 50, { width: 120 });
  }

  // Encabezado
  doc.fontSize(20).fillColor('#0b1d5c').font('Helvetica-Bold')
     .text('COOPERATIVA DE SERVICIOS MÚLTIPLES CB', 150, 40, { width: 600, align: 'center' })
     .fontSize(12).fillColor('#000')
     .text('RUC: 20393948125', { align: 'center' })
     .moveDown(0.5)
     .fillColor('#d00')
     .text('PRINCIPAL: AV.CENTENARIO MZ.145 LT.12-A // UCAYALI - CORONEL PORTILLO - CALLERIA', { align: 'center' })
     .text('TELÉFONOS: 985712705 / 920307704 / 977122276 / 917984165', { align: 'center' });

  doc.moveDown(1);

  // Fecha / Origen / Destino
  const yStart = doc.y + 15;
  const cellWidth = (doc.page.width - 60) / 3;
  const fecha = new Date().toLocaleDateString('es-PE');

  const drawCell = (text, x, y, w, h) => {
    doc.rect(x, y, w, h).stroke();
    doc.font('Helvetica-Bold').fontSize(18).fillColor('#000')
       .text(text, x, y + 4, { width: w, align: 'center' });
  };

  drawCell('FECHA', 30, yStart, cellWidth, 20);
  drawCell('ORIGEN', 30 + cellWidth, yStart, cellWidth, 20);
  drawCell('DESTINO', 30 + cellWidth * 2, yStart, cellWidth, 20);

  drawCell(fecha, 30, yStart + 20, cellWidth, 40);
  drawCell(remitente.sede, 30 + cellWidth, yStart + 20, cellWidth, 40);
  drawCell(receptor.sede, 30 + cellWidth * 2, yStart + 20, cellWidth, 40);

  // Secciones remitente / consignado
  const half = (doc.page.width - 60) / 2;
  const infoY = yStart + 90;

  const drawSection = (title, person, x, y) => {
    doc.rect(x, y, half, 25).fillAndStroke('#3b73af', '#000');
    doc.fillColor('#fff').font('Helvetica-Bold').fontSize(16)
       .text(title, x, y + 6, { width: half, align: 'center' });

    doc.fillColor('#000').font('Helvetica-Bold').fontSize(13);
    let textY = y + 35;
    const lineH = 20;
    doc.rect(x, textY - 5, half, lineH * 5 + 5).stroke();

    doc.text(`NOMBRE:  ${person.nombre}`, x + 10, textY); textY += lineH;
    doc.text(`D.N.I.:  ${person.dni}`, x + 10, textY);    textY += lineH;
    doc.text(`TELÉFONO:  ${person.telefono}`, x + 10, textY); textY += lineH;
    doc.text(`DIRECCIÓN:  ${person.direccion || '---'}`, x + 10, textY); textY += lineH;
  };

  drawSection('REMITENTE', remitente, 30, infoY);
  drawSection('DESTINATARIO', receptor, 30 + half, infoY);

  doc.end();

  writeStream.on('finish', () => {
    console.log(`PDF generado: ${filename}`);
    bot.sendDocument(chatId, filename)
      .then(() => {
        bot.editMessageText(
          `📄 PDF generado y enviado correctamente.`,
          { chat_id: chatId, message_id: messageId }
        );
        // Borrar archivo después de enviarlo
        fs.unlink(filename, (err) => {
          if (err) console.error('Error al eliminar PDF:', err);
          else console.log(`Archivo eliminado: ${filename}`);
        });
      })
      .catch(err => console.error('Error al enviar PDF:', err));
  });
}