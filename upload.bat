@echo off
setlocal enabledelayedexpansion
title GitHub Full Tree Uploader
color 0A

echo.
echo  ================================================================
echo   GitHub Full Project Uploader
echo   Automates: init + add all subfolders + commit + push
echo  ================================================================
echo.

:: -------------------------------------------------
:: 1. Check Git is available
:: -------------------------------------------------
git --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Git is not installed or not in PATH.
    echo         Download: https://git-scm.com/download/win
    echo.
    pause
    exit /b 1
)

echo [OK] Git detected
echo.

:: -------------------------------------------------
:: 2. Get repo URL (with your default)
:: -------------------------------------------------
set "DEFAULT_REPO=https://github.com/scampoverde132/SOFTWARE.git"
set /p REPO_URL="Repo URL [!DEFAULT_REPO!]: "
if "!REPO_URL!"=="" set "REPO_URL=!DEFAULT_REPO!"

:: -------------------------------------------------
:: 3. Optional commit message
:: -------------------------------------------------
set /p COMMIT_MSG="Commit message [Initial commit - full project tree]: "
if "!COMMIT_MSG!"=="" set "COMMIT_MSG=Initial commit - full project tree"

echo.
echo Working directory : %CD%
echo Target repository : !REPO_URL!
echo Commit message    : !COMMIT_MSG!
echo.

:: -------------------------------------------------
:: 4. Handle existing .git (ask before wiping)
:: -------------------------------------------------
if exist .git (
    echo Existing .git folder found.
    choice /C YN /M "Wipe it and start fresh? (Y = re-init, N = use existing)"
    if errorlevel 2 (
        echo Using existing repository...
        goto :add_and_push
    )
    if errorlevel 1 (
        echo Removing old .git...
        rmdir /s /q .git 2>nul
        if exist .git (
            echo [ERROR] Could not remove .git (permissions?)
            pause
            exit /b 1
        )
    )
)

:: -------------------------------------------------
:: 5. Fresh init
:: -------------------------------------------------
echo Initializing new repository...
git init
if errorlevel 1 goto :fail

git branch -M main
if errorlevel 1 goto :fail

:add_and_push
echo Staging all files and subfolders...
git add .
if errorlevel 1 goto :fail

echo Creating commit...
git commit -m "!COMMIT_MSG!"
if errorlevel 1 (
    echo.
    echo [INFO] Nothing new to commit (or empty repo). Continuing...
)

:: Clean any previous remote
git remote remove origin 2>nul
git remote add origin !REPO_URL!
if errorlevel 1 goto :fail

echo.
echo Pushing entire tree to GitHub...
echo (This may take a while if you have many files)
echo.
git push -u origin main

if errorlevel 1 (
    echo.
    echo ================================================================
    echo  [ERROR] Push failed
    echo ================================================================
    echo Common causes:
    echo   1. Repo on GitHub is NOT empty  → delete README/.gitignore
    echo   2. Authentication required     → use Personal Access Token
    echo      or set up SSH keys
    echo   3. File larger than 100 MB     → use Git LFS
    echo.
    pause
    exit /b 1
)

echo.
echo ================================================================
echo  SUCCESS
echo  Entire folder tree (all subfolders) is now on GitHub
echo ================================================================
echo.
pause
exit /b 0

:fail
echo.
echo [ERROR] A git command failed. Check the messages above.
pause
exit /b 1