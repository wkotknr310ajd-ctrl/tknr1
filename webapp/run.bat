@echo off
cd /d %~dp0

python --version >nul 2>&1
if errorlevel 1 (
    echo.
    echo ERROR: Python was not found.
    echo Please install Python from https://www.python.org/downloads/
    echo IMPORTANT: On the install screen, check the box "Add python.exe to PATH".
    echo After installing, close this window and double-click run.bat again.
    echo See docs\setup_guide.md for more detail.
    pause
    exit /b 1
)

echo Checking required libraries (this may take a moment on first run)...
python -m pip install -r requirements.txt
if errorlevel 1 (
    echo.
    echo ERROR: Installing libraries failed. See the message above for details.
    pause
    exit /b 1
)

echo Starting the server...
start "" cmd /c "timeout /t 2 >nul && start http://127.0.0.1:5000/"

python app.py

echo.
echo The server has stopped. Closing this window will disconnect all users.
pause
