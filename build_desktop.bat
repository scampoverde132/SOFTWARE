@echo off
setlocal
cd /d "%~dp0"
title Build PlanTakeoff Desktop

echo ============================================
echo   Building PlanTakeoff desktop software
echo ============================================
echo.

set "PY=py -3"
where py >nul 2>&1 || set "PY=python"

echo [1/3] Installing build dependencies...
%PY% -m pip install -U pip >nul 2>&1
%PY% -m pip install -r requirements.txt
if errorlevel 1 (
  echo pip install failed.
  pause
  exit /b 1
)

echo [2/3] Cleaning old build...
if exist build rmdir /s /q build
if exist dist\PlanTakeoff rmdir /s /q dist\PlanTakeoff

echo [3/3] Running PyInstaller...
%PY% -m PyInstaller --noconfirm plan_takeoff.spec
if errorlevel 1 (
  echo Build failed.
  pause
  exit /b 1
)

echo.
echo ============================================
echo   BUILD OK
echo   Output: %~dp0dist\PlanTakeoff\PlanTakeoff.exe
echo ============================================
echo.

REM Create desktop shortcut
set "EXE=%~dp0dist\PlanTakeoff\PlanTakeoff.exe"
set "LNK=%USERPROFILE%\Desktop\PlanTakeoff.lnk"
powershell -NoProfile -Command ^
  "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%LNK%'); $s.TargetPath = '%EXE%'; $s.WorkingDirectory = '%~dp0dist\PlanTakeoff'; $s.Description = 'PlanTakeoff — WL Painting takeoff software'; $s.Save()"

echo Desktop shortcut created: PlanTakeoff.lnk
echo.
echo Launching app...
start "" "%EXE%"
pause
endlocal
