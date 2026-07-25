@echo off
title PlanTakeoff
cd /d "%~dp0"

REM Prefer compiled desktop build if present
if exist "%~dp0dist\PlanTakeoff\PlanTakeoff.exe" (
  start "" "%~dp0dist\PlanTakeoff\PlanTakeoff.exe"
  exit /b 0
)

REM Dev mode: run desktop shell with Python
set "PY="
where py >nul 2>&1 && set "PY=py -3"
if not defined PY if exist "%LOCALAPPDATA%\Programs\Python\Python312\python.exe" set "PY=%LOCALAPPDATA%\Programs\Python\Python312\python.exe"
if not defined PY set "PY=python"

%PY% -c "import webview" >nul 2>&1
if errorlevel 1 (
  echo Installing desktop dependencies...
  %PY% -m pip install -r requirements.txt
)

start "PlanTakeoff" %PY% "%~dp0desktop_app.py"
