@echo off
setlocal EnableExtensions
chcp 65001 >nul

title Uninstall WL PT TOOL
set "DEST=%LOCALAPPDATA%\Programs\WL PT TOOL"
set "DESKTOP_LINK=%USERPROFILE%\Desktop\WL PT TOOL.lnk"
set "START_LINK=%APPDATA%\Microsoft\Windows\Start Menu\Programs\WL Painting\WL PT TOOL.lnk"

echo ============================================
echo   Uninstall WL PT TOOL
echo ============================================
echo.
echo This removes only WL PT TOOL.
echo PlanTakeoff, EST project folders, backups and job data are not removed.
echo WL PT TOOL settings are preserved under:
echo %LOCALAPPDATA%\WL PT TOOL
echo.
choice /C YN /M "Continue"
if errorlevel 2 exit /b 0

taskkill /IM "WL PT TOOL.exe" /F >nul 2>&1
del /Q "%DESKTOP_LINK%" >nul 2>&1
del /Q "%START_LINK%" >nul 2>&1

REM Leave the program directory before deleting it, including when this copy
REM of the uninstaller was launched from the installed application folder.
cd /d "%TEMP%"
if exist "%DEST%" rmdir /S /Q "%DEST%"

if exist "%DEST%" (
  echo.
  echo Some files could not be removed. Close WL PT TOOL and run again.
  pause
  exit /b 1
)

echo.
echo WL PT TOOL was removed.
echo Existing PlanTakeoff remains installed.
echo Settings remain available for a future reinstall.
echo.
pause
exit /b 0
