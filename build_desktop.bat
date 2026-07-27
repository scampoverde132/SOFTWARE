@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Build PlanTakeoff Desktop

set "PY=py -3"
where py >nul 2>&1 || set "PY=python"
set "EXE=%~dp0dist\PlanTakeoff\PlanTakeoff.exe"
set "INTERNAL=%~dp0dist\PlanTakeoff\_internal"
set "REQUIRED_JS=job-model.js command-center.js productivity.js finalization.js change-order.js change-order-disk.js daily-logs.js daily-logs-local-date.js settings.js settings-model-defaults.js hardening.js client-updates.js pdf-loader-core.js pdf-loader.js app.js"

echo ============================================
echo   Building PlanTakeoff hybrid desktop suite
echo ============================================
echo.

echo [1/6] Installing build dependencies...
%PY% -m pip install -U pip >nul 2>&1
%PY% -m pip install -r requirements.txt
if errorlevel 1 goto :fail_dependencies

echo [2/6] Validating source files...
%PY% -m py_compile desktop_app.py server.py job_server.py daily_log_server.py client_update_server.py suite_server.py
if errorlevel 1 goto :fail_validation
for %%F in (%REQUIRED_JS%) do (
  if not exist "js\%%F" (
    echo Missing required JavaScript file: js\%%F
    goto :fail_validation
  )
)
where node >nul 2>&1
if not errorlevel 1 (
  for %%F in (%REQUIRED_JS%) do (
    node --check "js\%%F"
    if errorlevel 1 goto :fail_validation
  )
) else (
  echo Node.js not installed; JavaScript syntax check skipped.
)

echo [3/6] Cleaning old build...
if exist build rmdir /s /q build
if exist dist\PlanTakeoff rmdir /s /q dist\PlanTakeoff

echo [4/6] Running PyInstaller...
%PY% -m PyInstaller --noconfirm plan_takeoff.spec
if errorlevel 1 goto :fail_build

echo [5/6] Verifying packaged files...
if not exist "%EXE%" (
  echo Built executable was not found: %EXE%
  goto :fail_package
)
for %%F in (%REQUIRED_JS%) do (
  if not exist "%INTERNAL%\js\%%F" (
    echo Packaged JavaScript file missing: _internal\js\%%F
    goto :fail_package
  )
)
if not exist "%INTERNAL%\suite_server.py" if not exist "%INTERNAL%\suite_server.pyc" (
  REM Hidden imports normally live in the PYZ archive; the executable self-test verifies importability.
  echo suite_server is archived by PyInstaller; continuing to standalone self-test.
)

echo [6/6] Running standalone application self-test...
start "" /wait "%EXE%" --self-test
if errorlevel 1 (
  echo Standalone self-test failed.
  echo Review: %~dp0dist\PlanTakeoff\PlanTakeoff-self-test.log
  goto :fail_package
)

echo.
echo ============================================
echo   BUILD AND SELF-TEST OK
echo   Output: %EXE%
echo ============================================
echo.

REM Create desktop shortcut.
set "LNK=%USERPROFILE%\Desktop\PlanTakeoff.lnk"
powershell -NoProfile -Command ^
  "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%LNK%'); $s.TargetPath = '%EXE%'; $s.WorkingDirectory = '%~dp0dist\PlanTakeoff'; $s.Description = 'PlanTakeoff — WL Painting hybrid takeoff and job management'; $s.Save()"
if errorlevel 1 (
  echo Build succeeded, but the desktop shortcut could not be created.
) else (
  echo Desktop shortcut created: PlanTakeoff.lnk
)

echo Launching app...
start "" "%EXE%"
echo.
pause
exit /b 0

:fail_dependencies
echo.
echo Build dependencies could not be installed.
pause
exit /b 1

:fail_validation
echo.
echo Source validation failed. Fix the reported file before rebuilding.
pause
exit /b 1

:fail_build
echo.
echo PyInstaller build failed.
pause
exit /b 1

:fail_package
echo.
echo The package did not pass verification and should not be shipped.
pause
exit /b 1
