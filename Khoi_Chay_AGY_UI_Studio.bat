@echo off
cd /d "%~dp0"
if exist "%~dp0AGY-UI-Studio.exe" (
    start "" "%~dp0AGY-UI-Studio.exe"
) else if exist "%~dp0release\AGY-UI-Studio-win32-x64\AGY-UI-Studio.exe" (
    start "" "%~dp0release\AGY-UI-Studio-win32-x64\AGY-UI-Studio.exe"
) else (
    start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0"
)
