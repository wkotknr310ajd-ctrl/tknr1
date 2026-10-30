@echo off
rem 平日の決まった時刻に「業務マニュアル帳」を自動で開くよう、Windows のタスク スケジューラに登録します。
rem 時刻を変えたいときは、下の TIME_AT= の値を書き換えてから実行してください。
set "TIME_AT=16:00"
set "TASK=業務マニュアル帳_記録のお知らせ"
set "APP=%~dp0業務マニュアル帳.html"

if not exist "%APP%" (
  echo 同じフォルダに 業務マニュアル帳.html が見つかりません。
  echo この bat ファイルは 業務マニュアル帳.html と同じフォルダに置いて実行してください。
  pause
  exit /b 1
)

schtasks /create /f /tn "%TASK%" /sc weekly /d MON,TUE,WED,THU,FRI /st %TIME_AT% /tr "explorer.exe \"%APP%\""
if errorlevel 1 (
  echo.
  echo 登録に失敗しました。
) else (
  echo.
  echo 登録しました。平日の %TIME_AT% に業務マニュアル帳が開きます。
  echo 業務マニュアル帳.html を別の場所に移した場合は、移した先でもう一度実行してください。
)
pause
