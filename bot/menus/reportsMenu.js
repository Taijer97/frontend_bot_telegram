const { createNavigationButtons } = require('../utils/navigation');

function reportsMenu(chatId) {
  const menuButtons = [
    [{ text: '📊 Reporte de Usuarios', callback_data: 'report_users' }],
    [{ text: '💰 Reporte de Ventas', callback_data: 'report_sales' }],
    [{ text: '📈 Reporte de Actividad', callback_data: 'report_activity' }]
  ];
  return { reply_markup: { inline_keyboard: [...menuButtons, ...createNavigationButtons(chatId, 'admin_reports')] } };
}
module.exports = reportsMenu;
