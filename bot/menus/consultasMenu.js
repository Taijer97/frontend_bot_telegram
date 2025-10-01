function consultasMenu() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '📊 Ver mi reporte', callback_data: 'consulta_reporte' }],
        [{ text: '💳 Ver crédito accesible', callback_data: 'consulta_credito' }],
        [{ text: '🔙 Atrás', callback_data: 'main_menu' }],
        [{ text: '🏠 Menú Principal', callback_data: 'main_menu' }]
      ]
    }
  };
}

module.exports = consultasMenu;