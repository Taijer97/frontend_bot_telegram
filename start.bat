@echo off
echo 🚀 Iniciando Bot de Telegram con Docker...

REM Verificar que existe el archivo .env
if not exist .env (
    echo ❌ Archivo .env no encontrado
    echo 📝 Copia .env.example a .env y configura las variables
    copy .env.example .env
    echo ✅ Archivo .env creado desde .env.example
    echo ⚠️ Por favor, edita el archivo .env con tus configuraciones antes de continuar
    pause
    exit /b 1
)

REM Construir y ejecutar con Docker Compose
echo 🔨 Construyendo imagen Docker...
docker-compose build

echo 🚀 Iniciando servicios...
docker-compose up -d

echo 📊 Estado de los servicios:
docker-compose ps

echo 📝 Para ver los logs en tiempo real:
echo    docker-compose logs -f

echo 🛑 Para detener los servicios:
echo    docker-compose down

echo ✅ Bot iniciado correctamente!
echo 🌐 Servidor web disponible en: http://localhost:3000
echo 📱 Tienda disponible en: http://localhost:3000/tienda
pause