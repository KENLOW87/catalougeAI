@echo off
cd /d "%~dp0app"

if "%GEMINI_API_KEY%"=="" if "%GOOGLE_API_KEY%"=="" (
    echo No Gemini key found for this session.
    set /p GEMINI_API_KEY=Paste your Gemini API key and press Enter ^(blank = skip, photo-splitting off this run^):
)

start "GEOMETRA Catalogue AI - server" cmd /k npm start
echo Starting the app, please wait...
timeout /t 6 /nobreak >nul
start "" "http://localhost:5173"
