@echo off
cd /d %~dp0

echo 必要なライブラリを確認しています(初回のみ時間がかかります)...
python -m pip install -r requirements.txt >nul 2>&1
if errorlevel 1 (
    echo.
    echo Pythonが見つからないか、ライブラリのインストールに失敗しました。
    echo docs\setup_guide.md を確認してください。
    pause
    exit /b 1
)

echo サーバーを起動しています...
start "" cmd /c "timeout /t 2 >nul && start http://127.0.0.1:5000/"

python app.py

echo.
echo サーバーが終了しました。このウィンドウを閉じるとアクセスできなくなります。
pause
