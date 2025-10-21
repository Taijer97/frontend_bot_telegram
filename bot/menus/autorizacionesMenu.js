function autorizacionesAdminMenu() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🛠️ Generador', callback_data: 'admin_generador_menu' }],
        [{ text: '📋 Listar Autorizaciones Activas', callback_data: 'admin_listar_autorizaciones' }],
        [{ text: '🔙 Volver al Panel Admin', callback_data: 'admin_menu' }]
      ]
    }
  };
}

function generadorMenu() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🔑 Generar Autorización', callback_data: 'admin_generar_autorizacion' }],
        [{ text: '📄 Generar Compa-Venta', callback_data: 'admin_generar_compaventa' }],
        [{ text: '🔙 Volver', callback_data: 'admin_autorizaciones' }]
      ]
    }
  };
}

function confirmarGenerarAutorizacion(dni, userData) {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '✅ Confirmar Generación', callback_data: `admin_confirmar_generar_${dni}` }],
        [{ text: '❌ Cancelar', callback_data: 'admin_autorizaciones' }],
        [{ text: '🔙 Volver', callback_data: 'admin_autorizaciones' }]
      ]
    }
  };
}

function paginacionAutorizaciones(page = 1, totalPages = 1) {
  const buttons = [];
  
  // Botones de navegación
  const navButtons = [];
  if (page > 1) {
    navButtons.push({ text: '⬅️ Anterior', callback_data: `admin_autorizaciones_page_${page - 1}` });
  }
  if (page < totalPages) {
    navButtons.push({ text: '➡️ Siguiente', callback_data: `admin_autorizaciones_page_${page + 1}` });
  }
  
  if (navButtons.length > 0) {
    buttons.push(navButtons);
  }
  
  // Botón de volver
  buttons.push([{ text: '🔙 Volver al Menú', callback_data: 'admin_autorizaciones' }]);
  
  return {
    reply_markup: {
      inline_keyboard: buttons
    }
  };
}

module.exports = {
  autorizacionesAdminMenu,
  generadorMenu,
  confirmarGenerarAutorizacion,
  paginacionAutorizaciones
};