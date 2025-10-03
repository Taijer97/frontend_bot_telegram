const axios = require('axios');
require('dotenv').config();

class UserApiService {
  constructor() {
    this.baseURL = process.env.BACKEND_BASE_URL;
    this.apiKey = process.env.BACKEND_API_KEY;
    this.timeout = parseInt(process.env.BACKEND_TIMEOUT) || 30000; // Aumentado a 30 segundos
    
    console.log('Configuración UserApiService:');
    console.log('- Base URL:', this.baseURL);
    console.log('- API Key:', this.apiKey ? 'Configurada' : 'No configurada');
    console.log('- Timeout:', this.timeout);
    
    // Configurar axios con valores por defecto
    this.api = axios.create({
      baseURL: this.baseURL,
      timeout: this.timeout,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
        'X-API-Key': this.apiKey,
        'ngrok-skip-browser-warning': 'true',  // Evitar página de advertencia de ngrok
        'User-Agent': 'TelegramBot/1.0'       // Header personalizado para ngrok
      }
    });

    // Interceptor simplificado para manejo de errores
    this.api.interceptors.response.use(
      (response) => response,
      (error) => {
        // Solo loggear errores críticos, no todos los errores
        if (error.response?.status >= 500) {
          console.error('Error crítico del servidor:', error.response?.status, error.response?.statusText);
        }
        throw error;
      }
    );
  }

  // CRUD Básico

  /**
   * Listar usuarios con filtros y paginación
   * @param {Object} params - Parámetros de filtro y paginación
   * @returns {Promise<Object>} Lista de usuarios
   */
  async listUsers(params = {}) {
    try {
      const response = await this.api.get('/users/', { params });
      return response.data;
    } catch (error) {
      console.error('Error al listar usuarios:', error);
      throw new Error('No se pudieron obtener los usuarios');
    }
  }

  /**
   * Obtener usuario por ID
   * @param {string} id - ID del usuario
   * @returns {Promise<Object>} Usuario encontrado
   */
  async getUserById(id) {
    try {
      const response = await this.api.get(`/users/id/${id}`);
      const data = response.data;
      
      // Manejar diferentes estructuras de respuesta
      if (data && data.usuario) {
        return data.usuario; // Devolver directamente el objeto usuario
      } else if (data && !data.success) {
        return data; // Si no tiene estructura anidada, devolver tal como está
      } else {
        console.warn('Estructura de usuario no reconocida:', data);
        return null;
      }
    } catch (error) {
      if (error.response?.status === 404) {
        return null;
      }
      console.error('Error al obtener usuario por ID:', error);
      throw new Error('No se pudo obtener el usuario');
    }
  }

  /**
   * Obtener usuario por DNI
   * @param {string} dni - DNI del usuario
   * @returns {Promise<Object>} Usuario encontrado
   */
  async getUserByDni(dni) {
    try {
      const response = await this.api.get(`/users/dni/${dni}`);
      return response.data;
    } catch (error) {
      if (error.response?.status === 404) {
        return null;
      }
      console.error('Error al obtener usuario por DNI:', error);
      throw new Error('No se pudo obtener el usuario');
    }
  }

  /**
   * Obtener usuario por chat_id (Telegram ID)
   * @param {string} chatId - Chat ID de Telegram
   * @returns {Promise<Object>} Usuario encontrado
   */
  async getUserByChatId(chatId) {
    try {
      console.log(`Buscando usuario con telegram_id: ${chatId}`);
      console.log(`URL de búsqueda: ${this.baseURL}/users/${chatId}`);
      
      // Usar el endpoint directo: GET /users/{telegram_id}
      const response = await this.api.get(`/users/${chatId}`);
      
      console.log('Respuesta de búsqueda:', JSON.stringify(response.data, null, 2));
      
      // La API devuelve el usuario en response.data.usuario
      const user = response.data.usuario || response.data.user || response.data;
      
      if (user && user.id) {
        console.log(`✅ Usuario encontrado: ${user.nombre} (ID: ${user.id})`);
        return user;
      } else {
        console.log('❌ No se encontró usuario con ese telegram_id');
        return null;
      }
      
    } catch (error) {
      console.error('Error al obtener usuario por telegram_id:', error.message);
      
      // Si es un error 404, significa que el usuario no existe
      if (error.response && error.response.status === 404) {
        console.log('Usuario no encontrado (404) - no está registrado');
        return null;
      }
      
      // Para otros errores, también retornar null pero logear el error
      console.error('Error de conexión o servidor:', error.response?.status || 'Sin respuesta');
      return null;
    }
  }

  /**
   * Crear nuevo usuario (simplificado)
   * @param {Object} userData - Datos del usuario
   * @returns {Promise<Object>} Usuario creado
   */
  async createUser(userData) {
    try {
      const cleanUserData = {
        telegram_id: userData.telegram_id,
        dni: userData.dni,
        nombre: userData.nombre,
        role_id: userData.role_id,
        sede: userData.sede
      };
      
      const response = await this.api.post('/users/', cleanUserData);
      return response.data;
    } catch (error) {
      // Manejo simplificado de errores
      if (error.response?.status === 400 && 
          error.response.data?.detail?.includes("Field 'id' doesn't have a default value")) {
        throw new Error('configuración del backend');
      }
      
      if (error.response?.status === 422) {
        throw new Error('validación');
      } else if (error.response?.status === 401) {
        throw new Error('autenticación');
      } else if (error.response?.status === 404) {
        throw new Error('conectar');
      } else {
        throw new Error('Error del servidor');
      }
    }
  }

  /**
   * Actualizar usuario
   * @param {string} id - ID del usuario
   * @param {Object} userData - Datos a actualizar
   * @returns {Promise<Object>} Usuario actualizado
   */
  async updateUser(id, userData) {
    try {
      const response = await this.api.put(`/users/${id}`, userData);
      return response.data;
    } catch (error) {
      console.error('Error al actualizar usuario:', error);
      throw new Error('No se pudo actualizar el usuario');
    }
  }

  /**
   * Eliminar usuario
   * @param {string} id - ID del usuario
   * @returns {Promise<boolean>} Resultado de la eliminación
   */
  async deleteUser(id) {
    try {
      await this.api.delete(`/users/${id}`);
      return true;
    } catch (error) {
      console.error('Error al eliminar usuario:', error);
      throw new Error('No se pudo eliminar el usuario');
    }
  }

  // Utilidades

  /**
   * Listar sedes disponibles
   * @returns {Promise<Array>} Lista de sedes
   */
  async getSedes() {
    try {
      const response = await this.api.get('/users/utils/sedes');
      const data = response.data;
      
      // Manejar diferentes estructuras de respuesta
      if (Array.isArray(data)) {
        return data;
      } else if (data && Array.isArray(data.sedes)) {
        return data.sedes;
      } else if (data && Array.isArray(data.data)) {
        return data.data;
      } else {
        console.warn('Estructura de sedes no reconocida:', data);
        return ['Atalaya', 'Puerto Bermúdez', 'Coronel Portillo', 'Sin sede']; // Fallback con sedes específicas
      }
    } catch (error) {
      console.error('Error al obtener sedes:', error);
      return ['Atalaya', 'Puerto Bermúdez', 'Coronel Portillo', 'Sin sede']; // Fallback con sedes específicas
    }
  }

  /**
   * Listar roles disponibles
   * @returns {Promise<Array>} Lista de roles
   */
  async getRoles() {
    try {
      const response = await this.api.get('/users/utils/roles');
      const data = response.data;
      
      // Manejar diferentes estructuras de respuesta
      if (Array.isArray(data)) {
        return data;
      } else if (data && Array.isArray(data.roles)) {
        return data.roles;
      } else if (data && Array.isArray(data.data)) {
        return data.data;
      } else {
        console.warn('Estructura de roles no reconocida:', data);
        return [{ id: 1, name: 'Usuario' }]; // Fallback con rol por defecto
      }
    } catch (error) {
      console.error('Error al obtener roles:', error);
      return [{ id: 1, name: 'Usuario' }]; // Fallback con rol por defecto
    }
  }

  /**
   * Obtener estadísticas de usuarios
   * @returns {Promise<Object>} Estadísticas
   */
  async getStats() {
    try {
      const response = await this.api.get('/users/utils/stats');
      return response.data;
    } catch (error) {
      console.error('Error al obtener estadísticas:', error);
      return {};
    }
  }

  /**
   * Verificar estado del módulo
   * @returns {Promise<Object>} Estado del health check
   */
  async healthCheck() {
    try {
      const response = await this.api.get('/users/health/check');
      const result = response.data;
      
      // Si el health check indica error, lanzar excepción
      if (result.status === 'error') {
        throw new Error(result.message || 'Backend no disponible');
      }
      
      return result;
    } catch (error) {
      console.error('Error en health check:', error);
      // Lanzar excepción en lugar de devolver objeto de error
      throw new Error('Backend no disponible');
    }
  }

  // Métodos de compatibilidad con la implementación anterior

  /**
   * Método de compatibilidad: getUser (por chat_id) con manejo de timeout
   * @param {string} chatId - Chat ID de Telegram
   * @returns {Promise<Object>} Usuario encontrado
   */
  async getUser(chatId) {
    try {
      return await this.getUserByChatId(chatId);
    } catch (error) {
      if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
        console.error('Timeout al obtener usuario. El servidor puede estar lento.');
        return null;
      }
      throw error;
    }
  }

  /**
   * Método de compatibilidad: addUser (simplificado y sin logs excesivos)
   * @param {string} chatId - Chat ID del usuario (telegram_id)
   * @param {string} dni - DNI del usuario
   * @param {string} nombre - Nombre del usuario (tomado de Telegram)
   * @param {number} roleId - ID del rol (por defecto 2)
   * @param {string|null} sede - Sede del usuario (por defecto null, se omite del payload)
   * @returns {Promise<Object>} Usuario creado
   */
  async addUser(chatId, dni, nombre, roleId = 2, sede = null) {
    const userData = {
      telegram_id: chatId.toString(),
      dni: dni,
      nombre: nombre,
      role_id: roleId,
      sede: sede || "Sin sede"
    };
    
    try {
      // Llamada directa sin logs excesivos
      const response = await this.api.post('/users/', userData);
      return response.data;
    } catch (error) {
      // Solo loggear errores reales, no warnings
      if (error.response?.status >= 500) {
        console.error('Error del servidor:', error.response?.status);
      }
      
      // Manejo específico de errores sin mostrar detalles técnicos al usuario
      if (error.response?.status === 400) {
        throw new Error('Datos de usuario inválidos');
      } else if (error.response?.status === 409) {
        throw new Error('El usuario ya existe');
      } else if (error.response?.status >= 500) {
        throw new Error('Error interno del servidor');
      } else if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
        throw new Error('Timeout de conexión');
      } else if (error.message.includes('ENOTFOUND') || error.message.includes('ECONNREFUSED')) {
        throw new Error('No se puede conectar con el servidor');
      } else {
        throw new Error('Error al registrar usuario');
      }
    }
  }

  /**
   * Registrar usuario con proceso completo (solicitar sede y rol)
   * @param {string} chatId - Chat ID del usuario
   * @param {string} dni - DNI del usuario
   * @param {string} nombre - Nombre del usuario
   * @returns {Promise<Object>} Datos para completar registro
   */
  async initUserRegistration(chatId, dni, nombre) {
    try {
      const [sedes, roles] = await Promise.all([
        this.getSedes(),
        this.getRoles()
      ]);
      
      // Asegurar que siempre sean arrays con valores específicos
      const sedesArray = Array.isArray(sedes) ? sedes : ['Atalaya', 'Puerto Bermúdez', 'Coronel Portillo', 'Sin sede'];
      const rolesArray = Array.isArray(roles) ? roles : [{ id: 1, name: 'Usuario' }];
      
      return {
        chatId,
        dni,
        nombre,
        sedes: sedesArray,
        roles: rolesArray
      };
    } catch (error) {
      console.error('Error al inicializar registro:', error);
      // Retornar valores por defecto específicos si falla la API
      return {
        chatId,
        dni,
        nombre,
        sedes: ['Atalaya', 'Puerto Bermúdez', 'Coronel Portillo', 'Sin sede'],
        roles: [{ id: 1, name: 'Usuario' }]
      };
    }
  }

  /**
   * Método de compatibilidad: updateUserRol
   * @param {string} chatId - Chat ID del usuario
   * @param {string} newRol - Nuevo rol
   * @returns {Promise<Object>} Usuario actualizado
   */
  async updateUserRol(chatId, newRol) {
    const user = await this.getUserByChatId(chatId);
    if (!user) {
      throw new Error('Usuario no encontrado');
    }
    return await this.updateUser(user.id, { rol: newRol });
  }

  /**
   * Método de compatibilidad: updateUserDni
   * @param {string} chatId - Chat ID del usuario
   * @param {string} newDni - Nuevo DNI
   * @returns {Promise<Object>} Usuario actualizado
   */
  async updateUserDni(chatId, newDni) {
    const user = await this.getUserByChatId(chatId);
    if (!user) {
      throw new Error('Usuario no encontrado');
    }
    return await this.updateUser(user.id, { dni: newDni });
  }

  /**
   * Método de compatibilidad: updateUserEstado
   * @param {string} chatId - Chat ID del usuario
   * @param {string} estado - Nuevo estado
   * @returns {Promise<Object>} Usuario actualizado
   */
  async updateUserEstado(chatId, estado) {
    const user = await this.getUserByChatId(chatId);
    if (!user) {
      throw new Error('Usuario no encontrado');
    }
    return await this.updateUser(user.id, { estado: estado });
  }
}

// Crear instancia singleton
const userApiService = new UserApiService();

module.exports = userApiService;