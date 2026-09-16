@echo off
cd /d %~dp0

echo Checking required libraries (this may take a moment on first run)...
python -m pip install -r requirements.txt >nul 2>&1
if errorlevel 1 (
    echo.
    echo ERROR: Python was not found, or installing libraries failed.
    echo Please see docs\setup_guide.md for help.
    pause
    exit /b 1
)

echo Starting the server...
start "" cmd /c "timeout /t 2 >nul && start http://127.0.0.1:5000/"

python app.py

echo.
echo The server has stopped. Closing this window will disconnect all users.
pause
