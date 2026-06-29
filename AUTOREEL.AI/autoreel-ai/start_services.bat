@echo off
echo 🚀 Starting AutoReel.AI — $0.85/video Production Stack...

:: Kill any lingering processes
taskkill /F /IM node.exe >nul 2>&1
taskkill /F /IM python.exe >nul 2>&1
timeout /t 2 >nul

:: Create all storage directories
if not exist "backend\storage\audio"     mkdir "backend\storage\audio"
if not exist "backend\storage\subtitles" mkdir "backend\storage\subtitles"
if not exist "backend\storage\video"     mkdir "backend\storage\video"
if not exist "backend\storage\tmp"       mkdir "backend\storage\tmp"
if not exist "backend\storage\music"     mkdir "backend\storage\music"

echo.
echo Starting Stage 1/2: Script AI + Claude Scene Planner (Port 8015)...
start "Script AI (8015)" cmd /c "cd ai-services\script_ai && venv\Scripts\python.exe -m uvicorn main:app --port 8015 --reload > script_ai.log 2>&1"
timeout /t 2 >nul

echo Starting Stage 5: Voice AI - ElevenLabs (Port 8012)...
start "Voice AI (8012)" cmd /c "cd ai-services\voice_ai && venv\Scripts\python.exe -m uvicorn main:app --port 8012 --reload > voice_ai.log 2>&1"
timeout /t 2 >nul

echo Starting Stage 6: Subtitle AI - Whisper (Port 8003)...
start "Subtitle AI (8003)" cmd /c "cd ai-services\subtitle_ai && venv\Scripts\python.exe -m uvicorn main:app --port 8003 --reload > subtitle_ai.log 2>&1"
timeout /t 2 >nul

echo Starting Stage 3: Image AI - SDXL (Port 8006)...
start "Image AI (8006)" cmd /c "cd ai-services\image_ai && venv\Scripts\python.exe -m uvicorn main:app --port 8006 --reload > image_ai.log 2>&1"
timeout /t 2 >nul

echo Starting Stage 4+7: Video AI - RunwayML + FFmpeg (Port 8014)...
start "Video AI (8014)" cmd /c "cd ai-services\video_ai && venv\Scripts\python.exe -m uvicorn main:app --port 8014 --reload > video_ai.log 2>&1"
timeout /t 2 >nul

echo Starting Backend API (Port 5000)...
start "Backend API (5000)" cmd /k "cd backend && npm start"
timeout /t 3 >nul

echo Starting Frontend (Port 5173)...
start "Frontend (5173)" cmd /k "cd frontend && npm run dev"

echo.
echo ✅ All services launched!
echo.
echo 📌 Service Map:
echo    Script AI (Gemini + Claude):  http://localhost:8015
echo    Voice AI (ElevenLabs):        http://localhost:8012
echo    Subtitle AI (Whisper):        http://localhost:8003
echo    Image AI (SDXL):              http://localhost:8006
echo    Video AI (Runway + FFmpeg):   http://localhost:8014
echo    Backend API:                  http://localhost:5000
echo    Frontend Dashboard:           http://localhost:5173
echo.
pause
