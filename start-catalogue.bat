@echo off
cd /d "%~dp0app"

if "%GEMINI_API_KEY%"=="" if "%GOOGLE_API_KEY%"=="" (
    echo No Gemini key found for this session.
    set /p GEMINI_API_KEY=Paste your Gemini API key and press Enter ^(blank = skip, photo-splitting off this run^):
)

if "%CATALOGUE_ENABLE_AI_FALLBACK%"=="1" (
    if "%OPENAI_API_KEY%"=="" (
        echo AI fallback is explicitly enabled, but no OpenAI key was found.
        set /p OPENAI_API_KEY=Paste your OpenAI API key and press Enter ^(blank = keep AI fallback off^):
    )
) else (
    echo OpenAI fallback is OFF by default; this run will not spend API credit.
    echo To enable it deliberately, set CATALOGUE_ENABLE_AI_FALLBACK=1 before starting.
)

start "GEOMETRA Catalogue AI - server" cmd /k npm start
echo Starting the app, please wait...
timeout /t 6 /nobreak >nul
start "" "http://localhost:5173"
