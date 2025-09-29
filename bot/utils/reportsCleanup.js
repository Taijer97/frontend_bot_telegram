const fs = require('fs');
const path = require('path');

const REPORTS_DIR = path.join(__dirname, '../../reportes');

/**
 * Función para limpiar archivos PDF antiguos
 * @param {number} hoursOld - Horas de antigüedad para considerar un archivo como "antiguo"
 * @returns {number} Número de archivos eliminados
 */
function cleanOldReports(hoursOld = 24) {
  try {
    // Verificar que la carpeta existe
    if (!fs.existsSync(REPORTS_DIR)) {
      console.log('📁 Carpeta de reportes no existe');
      return 0;
    }

    const files = fs.readdirSync(REPORTS_DIR);
    const pdfFiles = files.filter(file => file.endsWith('.pdf'));
    
    if (pdfFiles.length === 0) {
      console.log('📄 No hay archivos PDF para limpiar');
      return 0;
    }

    const cutoffTime = Date.now() - (hoursOld * 60 * 60 * 1000);
    let deletedCount = 0;

    console.log(`🧹 Iniciando limpieza de reportes antiguos (más de ${hoursOld} horas)...`);

    for (const file of pdfFiles) {
      const filePath = path.join(REPORTS_DIR, file);
      
      try {
        const stats = fs.statSync(filePath);
        const fileAge = stats.mtime.getTime();
        
        if (fileAge < cutoffTime) {
          fs.unlinkSync(filePath);
          deletedCount++;
          console.log(`🗑️ Eliminado: ${file} (${Math.round((Date.now() - fileAge) / (1000 * 60 * 60))} horas de antigüedad)`);
        } else {
          console.log(`✅ Conservado: ${file} (${Math.round((Date.now() - fileAge) / (1000 * 60 * 60))} horas de antigüedad)`);
        }
      } catch (error) {
        console.error(`❌ Error procesando archivo ${file}:`, error.message);
      }
    }

    console.log(`🧹 Limpieza completada: ${deletedCount} archivos eliminados de ${pdfFiles.length} totales`);
    return deletedCount;

  } catch (error) {
    console.error('❌ Error en limpieza de reportes:', error);
    return 0;
  }
}

/**
 * Función para obtener estadísticas de la carpeta de reportes
 * @returns {Object} Estadísticas de archivos
 */
function getReportsStats() {
  try {
    if (!fs.existsSync(REPORTS_DIR)) {
      return { totalFiles: 0, totalSize: 0, oldestFile: null, newestFile: null };
    }

    const files = fs.readdirSync(REPORTS_DIR);
    const pdfFiles = files.filter(file => file.endsWith('.pdf'));
    
    if (pdfFiles.length === 0) {
      return { totalFiles: 0, totalSize: 0, oldestFile: null, newestFile: null };
    }

    let totalSize = 0;
    let oldestTime = Date.now();
    let newestTime = 0;
    let oldestFile = '';
    let newestFile = '';

    for (const file of pdfFiles) {
      const filePath = path.join(REPORTS_DIR, file);
      const stats = fs.statSync(filePath);
      
      totalSize += stats.size;
      
      if (stats.mtime.getTime() < oldestTime) {
        oldestTime = stats.mtime.getTime();
        oldestFile = file;
      }
      
      if (stats.mtime.getTime() > newestTime) {
        newestTime = stats.mtime.getTime();
        newestFile = file;
      }
    }

    return {
      totalFiles: pdfFiles.length,
      totalSize: Math.round(totalSize / 1024), // KB
      oldestFile: {
        name: oldestFile,
        age: Math.round((Date.now() - oldestTime) / (1000 * 60 * 60)) // horas
      },
      newestFile: {
        name: newestFile,
        age: Math.round((Date.now() - newestTime) / (1000 * 60 * 60)) // horas
      }
    };

  } catch (error) {
    console.error('❌ Error obteniendo estadísticas de reportes:', error);
    return { totalFiles: 0, totalSize: 0, oldestFile: null, newestFile: null };
  }
}

/**
 * Iniciar limpieza automática programada
 * @param {number} intervalHours - Intervalo en horas para ejecutar la limpieza
 * @param {number} fileAgeHours - Edad en horas para considerar archivos como antiguos
 */
function startAutomaticCleanup(intervalHours = 24, fileAgeHours = 24) {
  console.log(`🕐 Iniciando limpieza automática de reportes cada ${intervalHours} horas`);
  console.log(`📅 Se eliminarán archivos con más de ${fileAgeHours} horas de antigüedad`);
  
  // Ejecutar limpieza inicial
  cleanOldReports(fileAgeHours);
  
  // Programar limpieza periódica
  const intervalMs = intervalHours * 60 * 60 * 1000;
  
  setInterval(() => {
    console.log('⏰ Ejecutando limpieza automática programada...');
    cleanOldReports(fileAgeHours);
  }, intervalMs);
  
  console.log(`✅ Limpieza automática configurada correctamente`);
}

module.exports = {
  cleanOldReports,
  getReportsStats,
  startAutomaticCleanup
};