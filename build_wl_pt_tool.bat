@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Build WL PT TOOL

set "CI_MODE=0"
if /I "%~1"=="--ci" set "CI_MODE=1"

set "PY=py -3"
where py >nul 2>&1 || set "PY=python"
set "APP_NAME=WL PT TOOL"
set "DIST=%~dp0dist\WL PT TOOL"
set "EXE=%DIST%\WL PT TOOL.exe"
set "INTERNAL=%DIST%\_internal"
set "PACKAGE=%~dp0release\WL-PT-TOOL-Windows"
set "ZIP=%~dp0release\WL-PT-TOOL-Windows.zip"
set "REQUIRED_JS=job-model.js command-center.js productivity.js finalization.js change-order.js change-order-disk.js daily-logs.js daily-logs-local-date.js settings.js settings-model-defaults.js hardening.js client-updates.js wl-brand.js pdf-loader-core.js pdf-loader.js app.js"

echo ============================================
echo   Building WL PT TOOL side-by-side package
echo ============================================
echo.

echo [1/7] Installing build dependencies...
%PY% -m pip install -U pip >nul 2>&1
%PY% -m pip install -r requirements.txt
if errorlevel 1 goto :fail_dependencies

echo [2/7] Validating source files...
%PY% -m py_compile wl_pt_tool_app.py wl_identity_server.py server.py job_server.py daily_log_server.py client_update_server.py suite_server.py
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

echo [3/7] Cleaning only the WL PT TOOL build...
if exist "build\wl_pt_tool" rmdir /s /q "build\wl_pt_tool"
if exist "%DIST%" rmdir /s /q "%DIST%"

echo [4/7] Running PyInstaller...
%PY% -m PyInstaller --noconfirm --clean wl_pt_tool.spec
if errorlevel 1 goto :fail_build

echo [5/7] Verifying packaged files...
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

echo [6/7] Running isolated standalone self-test...
start "" /wait "%EXE%" --self-test
if errorlevel 1 (
  echo Standalone self-test failed.
  echo Review: %DIST%\WL-PT-TOOL-self-test.log
  goto :fail_package
)

echo [7/7] Creating install-ready package...
if exist "%PACKAGE%" rmdir /s /q "%PACKAGE%"
if exist "%ZIP%" del /q "%ZIP%"
mkdir "%PACKAGE%\App"
robocopy "%DIST%" "%PACKAGE%\App" /E /R:2 /W:1 /NFL /NDL /NJH /NJS /NP
if errorlevel 8 goto :fail_package
copy /Y "Install WL PT TOOL.bat" "%PACKAGE%\Install WL PT TOOL.bat" >nul
copy /Y "Uninstall WL PT TOOL.bat" "%PACKAGE%\Uninstall WL PT TOOL.bat" >nul
copy /Y "WL-PT-TOOL-INSTALL.txt" "%PACKAGE%\WL-PT-TOOL-INSTALL.txt" >nul
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$info=@('WL PT TOOL Windows package','Built: '+(Get-Date -Format 'yyyy-MM-dd HH:mm:ss'),'Source branch package; existing PlanTakeoff is not replaced.'); Set-Content -Path '%PACKAGE%\BUILD-INFO.txt' -Value $info -Encoding UTF8; Compress-Archive -Path '%PACKAGE%\*' -DestinationPath '%ZIP%' -Force"
if errorlevel 1 goto :fail_package

echo.
echo ============================================
echo   BUILD, SELF-TEST AND PACKAGE OK
echo   Portable app: %EXE%
echo   Installer ZIP: %ZIP%
echo ============================================
echo.
if "%CI_MODE%"=="0" (
  explorer "%~dp0release"
  pause
)
exit /b 0

:fail_dependencies
echo.
echo Build dependencies could not be installed.
goto :failed

:fail_validation
echo.
echo Source validation failed. Fix the reported file before rebuilding.
goto :failed

:fail_build
echo.
echo PyInstaller build failed.
goto :failed

:fail_package
echo.
echo The WL PT TOOL package did not pass verification and must not be installed.

:failed
if "%CI_MODE%"=="0" pause
exit /b 1
