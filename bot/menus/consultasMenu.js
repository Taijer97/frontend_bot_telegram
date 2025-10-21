function consultasMenu() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '📊 Ver mi reporte', callback_data: 'consulta_reporte' }],
        [{ text: '🔄 Quiero una ampliacion!', callback_data: 'consulta_credito' }],
        [{ text: '✍️ Crear autorización', callback_data: 'crear_autorizacion' }]
      ]
    }
  };
}

module.exports = consultasMenu;