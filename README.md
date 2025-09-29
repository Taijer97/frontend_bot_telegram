# Bot de Telegram con Docker

Este proyecto contiene un bot de Telegram con servidor web integrado, configurado para ejecutarse con Docker Compose.

## 🚀 Inicio Rápido

### Prerrequisitos
- Docker
- Docker Compose

### Configuración

1. **Clonar y configurar variables de entorno:**
   ```bash
   # Copiar archivo de ejemplo
   cp .env.example .env
   
   # Editar configuraciones
   nano .env  # o tu editor preferido
   ```

2. **Configurar variables en .env:**
   ```env
   BOT_TOKEN=tu_bot_token_de_telegram
   BACKEND_BASE_URL=https://tu-backend-url.com
   BACKEND_API_KEY=tu-api-key-secreta
   BACKEND_TIMEOUT=10000
   WEB_PORT=3000
   ```

### Ejecución

#### Opción 1: Scripts automáticos
```bash
# Linux/Mac
./start.sh

# Windows
start.bat
```

#### Opción 2: Comandos manuales
```bash
# Construir imagen
docker-compose build

# Iniciar servicios
docker-compose up -d

# Ver logs
docker-compose logs -f

# Detener servicios
docker-compose down
```

## 📊 Servicios

- **Bot de Telegram**: Puerto interno para comunicación con Telegram
- **Servidor Web**: Puerto 3000 (http://localhost:3000)
- **Tienda Web**: http://localhost:3000/tienda
- **Health Check**: http://localhost:3000/health

## 🗂️ Estructura de Volúmenes

- `./data`: Archivos de datos del bot
- `./reportes`: Reportes generados
- `bot_db`: Base de datos SQLite (volumen Docker)

## 🔧 Comandos Útiles

```bash
# Ver estado de servicios
docker-compose ps

# Ver logs en tiempo real
docker-compose logs -f telegram-bot

# Reiniciar servicios
docker-compose restart

# Actualizar imagen
docker-compose build --no-cache
docker-compose up -d

# Limpiar todo (cuidado: elimina volúmenes)
docker-compose down -v
```

## 🐛 Troubleshooting

### El bot no responde
1. Verificar que BOT_TOKEN esté configurado correctamente
2. Revisar logs: `docker-compose logs telegram-bot`

### Error de conexión al backend
1. Verificar BACKEND_BASE_URL en .env
2. Verificar conectividad de red

### Base de datos no persiste
1. Verificar que el volumen `bot_db` esté montado
2. Revisar permisos de escritura

## 📝 Desarrollo

Para desarrollo local sin Docker:
```bash
npm install
npm run dev
```

## 🔒 Seguridad

- No commitear el archivo `.env` con tokens reales
- Usar `.env.example` para plantillas
- Configurar firewalls apropiados para producción