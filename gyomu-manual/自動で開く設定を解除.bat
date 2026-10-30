@echo off
rem 「16時に自動で開く設定.bat」で登録した自動起動を解除します。
schtasks /delete /f /tn "業務マニュアル帳_記録のお知らせ"
if errorlevel 1 (
  echo.
  echo 解除できませんでした（登録されていない可能性があります）。
) else (
  echo.
  echo 自動で開く設定を解除しました。
)
pause
