@echo off
setlocal EnableExtensions
chcp 65001 >nul

title Install WL PT TOOL
set "APP_NAME=WL PT TOOL"
set "SOURCE=%~dp0App"
set "DEST=%LOCALAPPDATA%\Programs\WL PT TOOL"
set "EXE=%DEST%\WL PT TOOL.exe"
set "DESKTOP_LINK=%USERPROFILE%\Desktop\WL PT TOOL.lnk"
set "START_DIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\WL Painting"
set "START_LINK=%START_DIR%\WL PT TOOL.lnk"

if not exist "%SOURCE%\WL PT TOOL.exe" (
  echo.
  echo Installation files are incomplete.
  echo Expected: %SOURCE%\WL PT TOOL.exe
  echo Extract the entire download before running this installer.
  echo.
  pause
  exit /b 1
)

echo ============================================
echo   Installing WL PT TOOL side-by-side
echo ============================================
echo.
echo Existing PlanTakeoff files will not be changed.
echo Destination: %DEST%
echo.

if not exist "%DEST%" mkdir "%DEST%"
robocopy "%SOURCE%" "%DEST%" /E /R:2 /W:1 /NFL /NDL /NJH /NJS /NP
set "RC=%ERRORLEVEL%"
if %RC% GEQ 8 (
  echo.
  echo Copy failed with Robocopy code %RC%.
  pause
  exit /b 1
)

copy /Y "%~dp0Uninstall WL PT TOOL.bat" "%DEST%\Uninstall WL PT TOOL.bat" >nul
copy /Y "%~dp0WL-PT-TOOL-INSTALL.txt" "%DEST%\WL-PT-TOOL-INSTALL.txt" >nul
if not exist "%START_DIR%" mkdir "%START_DIR%"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ws=New-Object -ComObject WScript.Shell;" ^
  "$s=$ws.CreateShortcut('%DESKTOP_LINK%');$s.TargetPath='%EXE%';$s.WorkingDirectory='%DEST%';$s.Description='WL Painting takeoff and job operations suite';$s.Save();" ^
  "$m=$ws.CreateShortcut('%START_LINK%');$m.TargetPath='%EXE%';$m.WorkingDirectory='%DEST%';$m.Description='WL Painting takeoff and job operations suite';$m.Save()"
if errorlevel 1 (
  echo The program was installed, but shortcuts could not be created.
)

if not exist "%EXE%" (
  echo.
  echo Installation verification failed. The executable is missing.
  pause
  exit /b 1
)

echo.
echo WL PT TOOL installed successfully.
echo Existing PlanTakeoff installation remains unchanged.
echo.
start "" "%EXE%"
exit /b 0
