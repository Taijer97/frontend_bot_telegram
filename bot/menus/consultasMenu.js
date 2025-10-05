function consultasMenu() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '📊 Ver mi reporte', callback_data: 'consulta_reporte' }],
        [{ text: '💳 Ver crédito accesible', callback_data: 'consulta_credito' }],
        [{ text: '✍️ Crear autorización', callback_data: 'crear_autorizacion' }]
      ]
    }
  };
}

module.exports = consultasMenu;